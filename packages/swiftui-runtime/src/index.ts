/**
 * The SwiftUI runtime: View protocol, @ViewBuilder, property wrappers, view
 * identity and the observation graph.
 *
 * Phase 3. The load-bearing idea is ViewIdentity (docs/02-ARCHITECTURE.md §6.2):
 * `@State` boxes are keyed by a view's structural path rather than by object
 * reference, which is what makes state survive both a re-render and a hot reload.
 *
 * Until then, `stub-pipeline` stands in so the rest of the system has something
 * real to integrate against.
 */

export {
  stubCompile,
  applyStubEvent,
  resetStubState,
  getStubCount,
} from './stub-pipeline'

// TODO(phase 3): ViewNode, ViewIdentity, ViewBuilder, StateBox, the observation
// graph and subtree invalidation.
