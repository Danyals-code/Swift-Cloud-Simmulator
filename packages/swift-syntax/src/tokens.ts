import type { SourceSpan } from '@studio/shared'

export type TokenKind =
  | 'identifier'
  | 'keyword'
  | 'attribute' // @main, @State, @ViewBuilder
  | 'integerLiteral'
  | 'floatLiteral'
  | 'stringLiteral'
  | 'operator'
  | 'punctuation'
  | 'endOfFile'
  | 'unknown'

/**
 * A piece of a string literal.
 *
 * Interpolations keep their *raw source text* plus the span it occupies, rather
 * than a pre-parsed expression. The parser re-enters itself on that slice, which
 * keeps the token stream flat and means an error inside an interpolation still
 * reports a span that points at the real file position.
 */
export interface StringSegment {
  readonly kind: 'text' | 'interpolation'
  /** For text: the value with escapes already resolved. For interpolation: raw source. */
  readonly value: string
  readonly span: SourceSpan
}

export interface Token {
  readonly kind: TokenKind
  readonly text: string
  readonly span: SourceSpan
  /**
   * Whether a newline appears in the trivia immediately before this token.
   *
   * Swift is newline-sensitive for statement separation but *not* for member
   * chains — `Text("x")\n  .font(.largeTitle)` is one expression. The parser needs
   * both facts, so it needs this flag rather than newline tokens.
   */
  readonly newlineBefore: boolean
  /** Whether whitespace precedes/follows. Swift uses this to classify prefix vs infix operators. */
  readonly spaceBefore: boolean
  readonly spaceAfter: boolean
  /**
   * 1-based column. Used only by error recovery: a type declaration at column 1
   * inside a body is a near-certain missing brace rather than a nested type.
   */
  readonly column: number
  /** Present on `stringLiteral` tokens. */
  readonly segments?: readonly StringSegment[]
  /** Present on numeric literals; already parsed. */
  readonly numericValue?: number
}

/**
 * Full Swift keyword set — the lexer recognises all of them even though the slice
 * only *parses* some. Recognising `class` as a keyword is what lets the parser emit
 * "classes are not supported yet" instead of a baffling "unexpected identifier".
 */
export const SWIFT_KEYWORDS: ReadonlySet<string> = new Set([
  // declarations
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func',
  'import', 'init', 'inout', 'internal', 'let', 'open', 'operator', 'private',
  'protocol', 'public', 'static', 'struct', 'subscript', 'typealias', 'var',
  // statements
  'break', 'case', 'continue', 'default', 'defer', 'do', 'else', 'fallthrough',
  'for', 'guard', 'if', 'in', 'repeat', 'return', 'switch', 'where', 'while',
  // expressions and types
  'as', 'catch', 'false', 'is', 'nil', 'rethrows', 'self', 'Self', 'super',
  'throw', 'throws', 'true', 'try', 'async', 'await', 'some', 'any',
  // modifiers
  'mutating', 'nonmutating', 'override', 'convenience', 'required', 'lazy',
  'weak', 'unowned', 'indirect', 'final', 'dynamic', 'optional',
])

/** Keywords that can begin a declaration — the parser's error-recovery resync points. */
export const DECLARATION_KEYWORDS: ReadonlySet<string> = new Set([
  'import', 'struct', 'class', 'enum', 'protocol', 'extension', 'func', 'var',
  'let', 'init', 'deinit', 'subscript', 'typealias', 'operator',
  'public', 'private', 'fileprivate', 'internal', 'open', 'static', 'final',
])

/** Keywords that can begin a statement. */
export const STATEMENT_KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'guard', 'for', 'while', 'repeat', 'switch', 'return', 'break',
  'continue', 'defer', 'do', 'throw', 'var', 'let', 'fallthrough',
])

/** Characters Swift allows in operators. */
const OPERATOR_CHARS = new Set('/=-+!*%<>&|^~?.'.split(''))

export function isOperatorChar(ch: string): boolean {
  return OPERATOR_CHARS.has(ch)
}

/**
 * Swift identifiers allow a large slice of Unicode. Rather than transcribe the
 * grammar's code-point tables — long, easy to get subtly wrong, and impossible to
 * review — anything non-ASCII that is not whitespace is accepted. The lexer's job
 * is to tokenise real code, and an over-permissive identifier rule cannot
 * mis-tokenise valid Swift; it can only accept an exotic name Swift would reject,
 * which the exported build would catch anyway.
 */
export function isIdentifierStart(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  if (code > 0x7f) return !/\s/.test(ch)
  // `$` leads closure shorthand ($0) and property-wrapper projections ($count).
  return /[A-Za-z_$]/.test(ch)
}

export function isIdentifierContinue(ch: string): boolean {
  return isIdentifierStart(ch) || (ch >= '0' && ch <= '9')
}

export function isKeyword(text: string): boolean {
  return SWIFT_KEYWORDS.has(text)
}

/**
 * Swift's standard precedence groups, lowest binding first.
 *
 * Custom `precedencegroup` declarations are out of scope; the standard library's
 * groups cover everything in the supported subset.
 */
export const PRECEDENCE: Readonly<Record<string, number>> = {
  // AssignmentPrecedence (right)
  '=': 1, '+=': 1, '-=': 1, '*=': 1, '/=': 1, '%=': 1,
  // TernaryPrecedence is handled structurally in the parser, at 2.
  // LogicalDisjunction (left)
  '||': 3,
  // LogicalConjunction (left)
  '&&': 4,
  // Comparison (non-associative)
  '==': 5, '!=': 5, '<': 5, '<=': 5, '>': 5, '>=': 5, '===': 5, '!==': 5, '~=': 5,
  // NilCoalescing (right)
  '??': 6,
  // Casting (`is` / `as`) sits at 7; handled by keyword in the parser.
  // RangeFormation (non-associative)
  '..<': 8, '...': 8,
  // Addition (left)
  '+': 9, '-': 9, '|': 9, '^': 9,
  // Multiplication (left)
  '*': 10, '/': 10, '%': 10, '&': 10,
  // BitwiseShift (non-associative)
  '<<': 11, '>>': 11,
}

export const TERNARY_PRECEDENCE = 2
export const CASTING_PRECEDENCE = 7

/** Right-associative operators. Everything else in `PRECEDENCE` is left or non-associative. */
export const RIGHT_ASSOCIATIVE: ReadonlySet<string> = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '??',
])

export const ASSIGNMENT_OPERATORS: ReadonlySet<string> = new Set([
  '=', '+=', '-=', '*=', '/=', '%=',
])

export function precedenceOf(op: string): number | undefined {
  return PRECEDENCE[op]
}

export function tokenDescription(token: Token): string {
  switch (token.kind) {
    case 'endOfFile':
      return 'end of file'
    case 'stringLiteral':
      return 'string literal'
    case 'integerLiteral':
    case 'floatLiteral':
      return 'numeric literal'
    default:
      return `'${token.text}'`
  }
}
