import * as Comlink from 'comlink'
import { applyEvent, compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { CompileRequest, CompileResult, CompilerApi, UIEvent } from '@studio/shared'

/**
 * The compiler worker.
 *
 * Everything Swift-related happens here and nowhere else (decision D5): the main
 * thread must stay at 60 fps while typing, and user code must be terminable — a
 * runaway `while true` kills a worker we can respawn instead of freezing the tab.
 *
 * Phase 1 runs lex -> parse -> check and renders a structural outline. Phases 2-3
 * add evaluation and layout behind the same `compile` call; nothing outside this
 * file changes, which is the whole reason the boundary was wired before the work
 * existed.
 */

/**
 * Kept so `dispatch` and `reset` can re-run the pipeline without the main thread
 * having to resend every file on each interaction.
 */
let lastRequest: CompileRequest | null = null

function recompile(): CompileResult {
  if (!lastRequest) {
    throw new Error('Worker received an interaction before any compile request.')
  }
  lastRequest = { ...lastRequest, revision: lastRequest.revision + 1 }
  return compile(lastRequest)
}

const api: CompilerApi = {
  async compile(request: CompileRequest): Promise<CompileResult> {
    lastRequest = request
    return compile(request)
  },

  async dispatch(event: UIEvent): Promise<CompileResult> {
    applyEvent(event)
    return recompile()
  },

  async reset(): Promise<CompileResult> {
    resetPipelineState()
    return recompile()
  },
}

Comlink.expose(api)
