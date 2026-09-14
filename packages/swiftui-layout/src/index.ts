/**
 * The SwiftUI layout engine.
 *
 * SwiftUI layout is a negotiation, not a cascade: a parent *proposes* a size, each
 * child *responds* with what it wants, then the parent *places* them. CSS flexbox
 * resolves a different algorithm and diverges on exactly the cases people hit first
 * - `Spacer`, `.frame(maxWidth: .infinity)`, `.fixedSize()`. See decision D2 in
 * docs/02-ARCHITECTURE.md.
 *
 * The package deliberately knows nothing about SwiftUI itself. It consumes plain
 * `LayoutElement` trees, which keeps the engine testable with hand-built fixtures
 * and keeps the dependency pointing one way: `swiftui-runtime` -> `swiftui-layout`.
 */

export * from './proposal'
export * from './elements'
export * from './metrics'
export { LayoutEngine, type PlacedNode, type PaintSpec } from './engine'
