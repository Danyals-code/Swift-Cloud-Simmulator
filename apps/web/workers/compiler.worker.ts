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
} from '@studio/swiftui-runtime'
import type {
  CompileRequest,
  CompileResult,
  CompilerApi,
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
