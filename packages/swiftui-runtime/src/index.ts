/**
 * The SwiftUI runtime.
 *
 * Three responsibilities, in order: a host that turns evaluated Swift into views,
 * identity-keyed `@State` storage that outlives the view structs, and the pipeline
 * that drives parse -> check -> evaluate -> lay out -> render.
 *
 * The layout itself belongs to `@studio/swiftui-layout`, which knows nothing about
 * SwiftUI - this package translates between the two.
 */

export { compile, rerender, applyEvent, resetPipelineState, setFontMetrics } from './pipeline'
export { AppRuntime, actionId, type EvaluationResult, type RuntimeFailure } from './app-runtime'
export { SwiftUIHost } from './swiftui-host'
export { IdentityPath, StateStore, fingerprint } from './identity'
export { viewsToLayout, type ConversionResult } from './to-layout'
export { placedToRenderTree } from './to-render'
export * from './style'
export * from './view-value'
export * from './language-service'
