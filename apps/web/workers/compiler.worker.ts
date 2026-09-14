import * as Comlink from 'comlink'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import type { CompileRequest, CompileResult, CompilerApi, UIEvent } from '@studio/shared'

/**
 * The compiler worker.
 *
 * Everything Swift-related happens here and nowhere else (decision D5): the main
 * thread must stay at 60 fps while typing, and user code must be terminable — a
 * runaway loop kills a worker we can respawn instead of freezing the tab.
 *
 * Phase 2 runs lex -> parse -> check -> evaluate. Phase 3 adds layout behind the
 * same `compile` call; nothing outside this file changes, which is the whole reason
 * the boundary was wired before the work existed.
 */

const api: CompilerApi = {
  async compile(request: CompileRequest): Promise<CompileResult> {
    return compile(request)
  },

  async dispatch(event: UIEvent): Promise<CompileResult> {
    // Interactions re-evaluate but never re-parse: the source has not changed, and
    // re-parsing would discard the live `@State` the tap just mutated.
    applyEvent(event)
    return rerender()
  },

  async reset(): Promise<CompileResult> {
    resetPipelineState()
    return rerender()
  },
}

Comlink.expose(api)
