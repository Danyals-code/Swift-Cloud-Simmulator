import type { Diagnostic } from '@studio/shared'

/**
 * What a state phone on the canvas says when it can't show its state, or null.
 *
 * Errors are the reason only when they kept the state from being drawn: a view that
 * stopped is drawn as a placeholder in a state that otherwise draws, and saying the
 * state "cannot be drawn" over it would be wrong.
 */
export function stateProblem({ page, compiled, diagnostics, drawn, stale, workerError }: {
  readonly page: string
  readonly compiled: boolean
  readonly diagnostics: readonly Diagnostic[]
  readonly drawn: boolean
  readonly stale: boolean
  readonly workerError?: string | null
}): string | null {
  const mismatch = `This state no longer matches ${page}. Open Screen › States to change or remove it.`
  if (workerError) return workerError
  // A state is a set of values for this screen. When the screen no longer has them -
  // renamed, removed, retyped - that is what to say, not that the code is broken.
  if (diagnostics.some((d) => d.severity === 'error' && d.code === 'invalid_preview_scenario')) return mismatch
  if (!drawn && diagnostics.some((d) => d.severity === 'error')) return 'This state cannot be drawn while the code has errors.'
  if (compiled && !stale && !drawn) return mismatch
  return null
}
