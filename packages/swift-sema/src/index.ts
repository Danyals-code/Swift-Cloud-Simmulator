/**
 * Name resolution and type checking.
 *
 * Phase 1. A simplified bidirectional checker, not Swift's constraint solver —
 * see docs/02-ARCHITECTURE.md §4.3 for what it deliberately does not do, and
 * docs/04-SWIFT-SUBSET.md §"Deliberate permissiveness" for the accepted gaps.
 *
 * Its job is to catch the mistakes people actually make (wrong type, missing
 * argument, unknown member, missing conformance) and to power completions. It is
 * allowed to be more permissive than swiftc; the Phase 6 strictness linter closes
 * the feedback gap so nobody is surprised at export.
 */

export const PHASE = 1 as const

// TODO(phase 1): Scope, SymbolTable, Type, check() -> TypedAST + Diagnostic[].
export {}
