import type { SourceSpan } from '@studio/shared'

/**
 * Swift lexer, parser and AST.
 *
 * Phase 0 defines only the token vocabulary; the lexer and recursive-descent
 * parser land in Phase 1. See docs/04-SWIFT-SUBSET.md for the grammar scope and
 * docs/02-ARCHITECTURE.md §4 for the error-recovery requirements — error nodes
 * are first-class here, because the user is mid-keystroke most of the time and a
 * single unbalanced brace must not invalidate the whole file.
 */

export type TokenKind =
  | 'identifier'
  | 'keyword'
  | 'integerLiteral'
  | 'floatLiteral'
  | 'stringLiteral'
  | 'stringInterpolationStart'
  | 'stringInterpolationEnd'
  | 'booleanLiteral'
  | 'nilLiteral'
  | 'operator'
  | 'attribute'
  | 'punctuation'
  | 'comment'
  | 'whitespace'
  | 'newline'
  | 'endOfFile'
  | 'unknown'

export interface Token {
  readonly kind: TokenKind
  readonly text: string
  readonly span: SourceSpan
}

/** Keywords the Phase 1 lexer recognises. Anything outside this set lexes as an identifier. */
export const SWIFT_KEYWORDS = new Set([
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func',
  'import', 'init', 'inout', 'internal', 'let', 'open', 'operator', 'private',
  'protocol', 'public', 'rethrows', 'static', 'struct', 'subscript', 'typealias', 'var',
  'break', 'case', 'continue', 'default', 'defer', 'do', 'else', 'fallthrough',
  'for', 'guard', 'if', 'in', 'repeat', 'return', 'switch', 'where', 'while',
  'as', 'catch', 'false', 'is', 'nil', 'self', 'Self', 'super', 'throw', 'throws',
  'true', 'try', 'async', 'await', 'some', 'any', 'mutating', 'nonmutating',
  'override', 'convenience', 'required', 'lazy', 'weak', 'unowned', 'indirect',
])

export function isKeyword(text: string): boolean {
  return SWIFT_KEYWORDS.has(text)
}

// TODO(phase 1): tokenize(), parse() -> SourceFileNode, incremental reparse driven
// by CodeMirror change sets, and the golden-test corpus.
