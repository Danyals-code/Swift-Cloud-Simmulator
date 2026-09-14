import * as Comlink from 'comlink'
import { applyStubEvent, resetStubState, stubCompile } from '@studio/swiftui-runtime'
import type { CompileRequest, CompileResult, CompilerApi, UIEvent } from '@studio/shared'

/**
 * The compiler worker.
 *
 * Everything Swift-related happens here and nowhere else (decision D5): the main
 * thread must stay at 60 fps while typing, and user code must be terminable — a
 * runaway `while true` kills a worker we can respawn instead of freezing the tab.
 *
 * Phase 0 delegates to the stub pipeline. Phases 1-3 replace the body of `compile`
 * with parse -> check -> evaluate -> layout; nothing outside this file changes,
 * which is the whole reason for wiring the boundary before the work exists.
 */

/**
 * Kept so `dispatch` and `reset` can re-run the pipeline without the main thread
 * having to resend every file on each tap.
 */
let lastRequest: CompileRequest | null = null

function recompile(revisionBump = 1): CompileResult {
  if (!lastRequest) {
    throw new Error('Worker received an interaction before any compile request.')
  }
  lastRequest = { ...lastRequest, revision: lastRequest.revision + revisionBump }
  return stubCompile(lastRequest)
}

const api: CompilerApi = {
  async compile(request: CompileRequest): Promise<CompileResult> {
    lastRequest = request
    return stubCompile(request)
  },

  async dispatch(event: UIEvent): Promise<CompileResult> {
    applyStubEvent(event)
    return recompile()
  },

  async reset(): Promise<CompileResult> {
    resetStubState()
    return recompile()
  },
}

Comlink.expose(api)
