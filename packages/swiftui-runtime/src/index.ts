/**
 * The SwiftUI runtime: the host that turns evaluated Swift into views, and the
 * pipeline that drives parse -> check -> evaluate -> render.
 *
 * Phase 2 runs the user's code for real: interpolations resolve, `@State` lives on a
 * persistent root instance that survives edits, and tapping a `Button` runs its
 * actual Swift closure.
 *
 * Phase 3 adds what is still missing — view identity, identity-keyed state boxes,
 * the proposal/response layout engine, and drawing.
 */

export { compile, rerender, applyEvent, resetPipelineState } from './pipeline'
export { AppRuntime, actionId, type EvaluationResult, type RuntimeFailure } from './app-runtime'
export { SwiftUIHost } from './swiftui-host'
export * from './view-value'
export {
  outlineExpression,
  outlineStatements,
  flattenOutline,
  type OutlineNode,
} from './outline'

// TODO(phase 3): ViewIdentity, StateBox, the observation graph, subtree invalidation.
