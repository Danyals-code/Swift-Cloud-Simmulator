import * as Comlink from 'comlink'
import {
  applyEvent,
  compile,
  completionsFor,
  definitionFor,
  hoverFor,
  referencesFor,
  rerender,
  resetPipelineState,
  setFontMetrics,
  setTextMeasurements,
  relayout,
  setAllPages,
} from '@studio/swiftui-runtime'
import { copyView, deleteView, hiddenViewsIn, hideView, insertView, moveView, moveViewTo, showView, viewSiteAt } from '@studio/swift-syntax'
import type {
  CompileRequest,
  CompileResult,
  CompilerApi,
  HiddenViewInfo,
  ViewEditRequest,
  ViewEditResult,
  ViewSiteInfo,
  CompletionResult,
  FileId,
  MeasuredFontData,
  SourceFile,
  SourceSpan,
  SymbolInfo,
  UIEvent,
} from '@studio/shared'
import { workerTextMeasurer } from '../lib/workerFontMetrics'

/**
 * The compiler worker.
 *
 * Everything Swift-related happens here and nowhere else (decision D5): the main
 * thread must stay at 60 fps while typing, and user code must be terminable - a
 * runaway loop kills a worker we can respawn instead of freezing the tab.
 *
 * The full pipeline now lives behind one `compile` call: lex, parse, check,
 * evaluate, lay out. Nothing outside this file has changed across three phases,
 * which is what the Phase 0 boundary was for.
 */

const api: CompilerApi = {
  async compile(request: CompileRequest): Promise<CompileResult> {
    return compile(request)
  },

  async dispatch(event: UIEvent, revision: number): Promise<CompileResult> {
    // Interactions re-evaluate but never re-parse: the source has not changed, and
    // re-parsing would discard the live `@State` the tap just mutated.
    applyEvent(event)
    return rerender(revision)
  },

  async reset(revision: number): Promise<CompileResult> {
    resetPipelineState()
    return rerender(revision)
  },

  async setFontMetrics(fonts: readonly MeasuredFontData[]): Promise<void> {
    setFontMetrics(fonts, workerTextMeasurer(fonts), true)
  },
  async setTextMeasurements(data, revision, generation) { return setTextMeasurements(data, revision, generation) },
  async relayout(revision) { return relayout(revision) },
  async setAllPages(enabled, revision) { return setAllPages(enabled, revision) },

  // Editing the source from the canvas. Every operation is a text transform over the
  // file the user wrote, so what comes back is a file, and applying it is the same
  // path as typing would have taken.
  async editView({ text, file, offset, edit }: ViewEditRequest): Promise<ViewEditResult | null> {
    if (edit.kind === 'delete') return deleteView(text, file, offset)
    if (edit.kind === 'move') return moveView(text, file, offset, edit.direction)
    if (edit.kind === 'moveTo') return moveViewTo(text, file, offset, edit.targetOffset, edit.position)
    if (edit.kind === 'hide') return hideView(text, file, offset)
    if (edit.kind === 'show') return showView(text, file, offset)
    return insertView(text, file, offset, edit.snippet)
  },

  async copyView(text: string, file: FileId, offset: number): Promise<string | null> {
    return copyView(text, file, offset)
  },

  async hiddenViews(files: readonly SourceFile[]): Promise<readonly HiddenViewInfo[]> {
    return files.flatMap((source) =>
      hiddenViewsIn(source.text, source.id).map((view) => ({
        file: source.id,
        offset: view.start,
        name: view.name,
        type: view.type,
        container: view.container,
      })),
    )
  },

  async describeView(text: string, file: FileId, offset: number): Promise<ViewSiteInfo | null> {
    const site = viewSiteAt(text, file, offset)
    return site && { index: site.index, siblings: site.siblings, container: site.container, inContent: site.inContent }
  },

  // Editor intelligence. Here for the same reason as everything else Swift-shaped:
  // the main thread must stay at 60 fps while typing, and re-parsing a project on
  // every completion request is work that does not belong on it.
  async complete(
    files: readonly SourceFile[],
    fileId: FileId,
    offset: number,
  ): Promise<CompletionResult> {
    return completionsFor(files, fileId, offset)
  },

  async definition(
    files: readonly SourceFile[],
    fileId: FileId,
    offset: number,
  ): Promise<SymbolInfo | null> {
    return definitionFor(files, fileId, offset)
  },

  async hover(
    files: readonly SourceFile[],
    fileId: FileId,
    offset: number,
  ): Promise<SymbolInfo | null> {
    return hoverFor(files, fileId, offset)
  },

  async references(
    files: readonly SourceFile[],
    fileId: FileId,
    offset: number,
  ): Promise<{ readonly name: string; readonly spans: readonly SourceSpan[] }> {
    return referencesFor(files, fileId, offset)
  },
}

Comlink.expose(api)
