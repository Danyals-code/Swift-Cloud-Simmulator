/**
 * Swift lexer, parser and AST.
 *
 * Covers the subset in docs/04-SWIFT-SUBSET.md. Two properties matter more than
 * completeness:
 *
 * - **Error recovery.** The user is mid-keystroke most of the time, so a missing
 *   brace produces an `errorDecl` and a resync rather than an empty tree.
 * - **Honest gaps.** A construct outside the subset parses to an `unsupportedDecl`
 *   or `unsupportedStmt` carrying the feature name, so the diagnostic can say
 *   exactly what is missing (FR-3.9) instead of failing cryptically.
 */

export * from './ast'
export * from './tokens'
export { Lexer, type LexResult } from './lexer'
export { Parser, typeName, type ParseResult } from './parser'

export * from './conformance'
