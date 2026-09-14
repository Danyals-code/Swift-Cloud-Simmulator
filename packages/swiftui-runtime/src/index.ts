/**
 * The SwiftUI runtime: View protocol, @ViewBuilder, property wrappers, view
 * identity and the observation graph.
 *
 * Phase 3. The load-bearing idea is ViewIdentity (docs/02-ARCHITECTURE.md §6.2):
 * `@State` boxes are keyed by a view's structural path rather than by object
 * reference, which is what makes state survive both a re-render and a hot reload.
 *
 * Phase 1 ships the parse-and-outline pipeline in its place — real output derived
 * from the user's real source, rather than a demo tree pretending to be a preview.
 */

export { compile, applyEvent, resetPipelineState } from './pipeline'
export {
  outlineExpression,
  outlineStatements,
  flattenOutline,
  type OutlineNode,
} from './outline'

// TODO(phase 3): ViewNode, ViewIdentity, ViewBuilder, StateBox, the observation
// graph and subtree invalidation.
