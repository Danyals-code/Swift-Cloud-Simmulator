import * as Comlink from 'comlink'
import {
  applyEvent,
  compile,
  rerender,
  resetPipelineState,
  setFontMetrics,
} from '@studio/swiftui-runtime'
import type {
  CompileRequest,
  CompileResult,
  CompilerApi,
  MeasuredFontData,
  UIEvent,
} from '@studio/shared'

/**
 * The compiler worker.
 *
 * Everything Swift-related happens here and nowhere else (decision D5): the main
 * thread must stay at 60 fps while typing, and user code must be terminable — a
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
    setFontMetrics(fonts)
  },
}

Comlink.expose(api)
