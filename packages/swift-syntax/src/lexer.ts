import type { Diagnostic, FileId, SourceSpan } from '@studio/shared'
import {
  isIdentifierContinue,
  isIdentifierStart,
  isKeyword,
  isOperatorChar,
  type StringSegment,
  type Token,
  type TokenKind,
} from './tokens'

export interface LexResult {
  readonly tokens: readonly Token[]
  readonly diagnostics: readonly Diagnostic[]
}

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '0': '\0',
  '\\': '\\',
  '"': '"',
  "'": "'",
}

/**
 * Swift lexer.
 *
 * Trivia (whitespace and comments) is discarded rather than attached to tokens.
 * The architecture doc originally called for preserving it, but that exists to
 * support a source printer - and this system never prints Swift. The editor text
 * *is* the source of truth (decision D3), so the only facts the parser needs from
 * trivia are "was there a newline before this token" and "is there a space either
 * side", both of which are recorded as flags.
 */
export class Lexer {
  private pos = 0
  private readonly tokens: Token[] = []
  private readonly diagnostics: Diagnostic[] = []

  constructor(
    private readonly text: string,
    private readonly file: FileId,
    /** Added to every emitted offset. Non-zero when lexing inside a string interpolation. */
    private readonly baseOffset = 0,
  ) {}

  static tokenize(text: string, file: FileId, baseOffset = 0): LexResult {
    return new Lexer(text, file, baseOffset).run()
  }

  private run(): LexResult {
    let newlineBefore = false
    // A file's first token behaves as if preceded by whitespace, so a leading `-`
    // classifies as prefix rather than infix.
    let spaceBefore = true

    for (;;) {
      const trivia = this.skipTrivia()
      newlineBefore ||= trivia.sawNewline
      spaceBefore ||= trivia.sawSpace

      if (this.pos >= this.text.length) {
        this.push('endOfFile', '', this.pos, this.pos, newlineBefore, spaceBefore, true)
        break
      }

      const start = this.pos
      const token = this.scanToken()
      if (!token) continue

      const spaceAfter =
        this.pos >= this.text.length || /\s/.test(this.text[this.pos] ?? '') ||
        this.text.startsWith('//', this.pos) || this.text.startsWith('/*', this.pos)

      this.tokens.push({
        ...token,
        span: this.span(start, this.pos),
        newlineBefore,
        spaceBefore,
        spaceAfter,
        column: this.columnAt(start),
      })

      newlineBefore = false
      spaceBefore = false
    }

    return { tokens: this.tokens, diagnostics: this.diagnostics }
  }

  // ---------------------------------------------------------------- trivia

  private skipTrivia(): { sawNewline: boolean; sawSpace: boolean } {
    let sawNewline = false
    let sawSpace = false

    for (;;) {
      const ch = this.text[this.pos]
      if (ch === undefined) return { sawNewline, sawSpace }

      if (ch === '\n') {
        sawNewline = true
        sawSpace = true
        this.pos++
        continue
      }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') {
        sawSpace = true
        this.pos++
        continue
      }
      if (this.text.startsWith('//', this.pos)) {
        sawSpace = true
        while (this.pos < this.text.length && this.text[this.pos] !== '\n') this.pos++
        continue
      }
      if (this.text.startsWith('/*', this.pos)) {
        sawSpace = true
        if (this.skipBlockComment()) sawNewline = true
        continue
      }
      return { sawNewline, sawSpace }
    }
  }

  /** Swift block comments nest. Returns whether the comment spanned a newline. */
  private skipBlockComment(): boolean {
    const start = this.pos
    let depth = 0
    let sawNewline = false

    while (this.pos < this.text.length) {
      if (this.text.startsWith('/*', this.pos)) {
        depth++
        this.pos += 2
      } else if (this.text.startsWith('*/', this.pos)) {
        depth--
        this.pos += 2
        if (depth === 0) return sawNewline
      } else {
        if (this.text[this.pos] === '\n') sawNewline = true
        this.pos++
      }
    }

    this.error(start, this.pos, 'unterminated_block', 'Unterminated block comment.')
    return sawNewline
  }

  // ---------------------------------------------------------------- tokens

  private scanToken(): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> | null {
    const ch = this.text[this.pos]!

    if (ch === '@') return this.scanAttribute()
    if (ch === '"') return this.scanString(0)
    if (ch === '#' && this.isRawStringStart()) return this.scanRawString()
    if (ch === '#' && isIdentifierStart(this.text[this.pos + 1] ?? '')) return this.scanMacro()
    if (ch >= '0' && ch <= '9') return this.scanNumber()
    if (isIdentifierStart(ch)) return this.scanIdentifier()
    if (ch === '`') return this.scanBacktickIdentifier()

    // `.` is member access unless it begins a range operator.
    if (ch === '.' && this.text[this.pos + 1] !== '.') {
      this.pos++
      return { kind: 'punctuation', text: '.' }
    }

    // Backslash leads a key path (`\.colorScheme`). Lexing it as punctuation keeps
    // it out of the "unexpected character" path; key paths themselves are Phase 4.
    if ('()[]{},:;\\'.includes(ch)) {
      this.pos++
      return { kind: 'punctuation', text: ch }
    }

    if (isOperatorChar(ch)) return this.scanOperator()

    this.pos++
    this.error(this.pos - 1, this.pos, 'unexpected_token', `Unexpected character '${ch}'.`)
    return { kind: 'unknown', text: ch }
  }

  private scanIdentifier(): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> {
    const start = this.pos
    while (this.pos < this.text.length && isIdentifierContinue(this.text[this.pos]!)) this.pos++
    const text = this.text.slice(start, this.pos)
    return { kind: isKeyword(text) ? 'keyword' : 'identifier', text }
  }

  /** Backtick-escaped identifiers: `` `default` `` is a name, not a keyword. */
  private scanBacktickIdentifier(): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> {
    const start = this.pos
    this.pos++ // opening backtick
    while (this.pos < this.text.length && this.text[this.pos] !== '`') this.pos++
    const text = this.text.slice(start + 1, this.pos)
    if (this.text[this.pos] === '`') this.pos++
    return { kind: 'identifier', text }
  }

  /**
   * `#Preview`, `#if`, `#available`, `#selector`.
   *
   * Lexed like an attribute and for the same reason: without it, `#` is an unexpected
   * character and the three errors that follow are blocking - so a file with a
   * `#Preview` block, which is most modern SwiftUI, would not render at all.
   */
  private scanMacro(): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> {
    const start = this.pos
    this.pos++ // '#'
    while (this.pos < this.text.length && isIdentifierContinue(this.text[this.pos]!)) this.pos++
    return { kind: 'macro', text: this.text.slice(start + 1, this.pos) }
  }

  private scanAttribute(): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> {
    const start = this.pos
    this.pos++ // '@'
    while (this.pos < this.text.length && isIdentifierContinue(this.text[this.pos]!)) this.pos++
    return { kind: 'attribute', text: this.text.slice(start, this.pos) }
  }

  private scanOperator(): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> {
    const start = this.pos
    while (this.pos < this.text.length && isOperatorChar(this.text[this.pos]!)) {
      // `?.` and `!.` are optional-chaining postfixes followed by member access, not
      // three-character operators. Stop before the dot so the parser sees the chain.
      const ch = this.text[this.pos]!
      if (ch === '.' && this.pos > start) {
        const soFar = this.text.slice(start, this.pos)
        if (soFar !== '.' && soFar !== '..') break
      }
      this.pos++
    }
    return { kind: 'operator', text: this.text.slice(start, this.pos) }
  }

  // --------------------------------------------------------------- numbers

  private scanNumber(): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> {
    const start = this.pos

    // Radix prefixes.
    if (this.text[this.pos] === '0') {
      const marker = this.text[this.pos + 1]
      const radix = marker === 'x' ? 16 : marker === 'b' ? 2 : marker === 'o' ? 8 : 0
      if (radix !== 0) {
        this.pos += 2
        while (this.pos < this.text.length && /[0-9a-fA-F_]/.test(this.text[this.pos]!)) this.pos++
        const raw = this.text.slice(start + 2, this.pos).replace(/_/g, '')
        const value = parseInt(raw, radix)
        if (raw.length === 0 || Number.isNaN(value)) {
          this.error(start, this.pos, 'unexpected_token', 'Invalid numeric literal.')
        }
        return { kind: 'integerLiteral', text: this.text.slice(start, this.pos), numericValue: value }
      }
    }

    while (this.pos < this.text.length && /[0-9_]/.test(this.text[this.pos]!)) this.pos++

    let isFloat = false
    // A dot only starts a fraction when a digit follows - otherwise `1...5` would
    // lex as `1.` followed by `..5`.
    if (this.text[this.pos] === '.' && /[0-9]/.test(this.text[this.pos + 1] ?? '')) {
      isFloat = true
      this.pos++
      while (this.pos < this.text.length && /[0-9_]/.test(this.text[this.pos]!)) this.pos++
    }

    if (this.text[this.pos] === 'e' || this.text[this.pos] === 'E') {
      const save = this.pos
      this.pos++
      if (this.text[this.pos] === '+' || this.text[this.pos] === '-') this.pos++
      if (/[0-9]/.test(this.text[this.pos] ?? '')) {
        isFloat = true
        while (this.pos < this.text.length && /[0-9_]/.test(this.text[this.pos]!)) this.pos++
      } else {
        this.pos = save
      }
    }

    const text = this.text.slice(start, this.pos)
    return {
      kind: isFloat ? 'floatLiteral' : 'integerLiteral',
      text,
      numericValue: Number(text.replace(/_/g, '')),
    }
  }

  // --------------------------------------------------------------- strings

  private isRawStringStart(): boolean {
    let i = this.pos
    while (this.text[i] === '#') i++
    return this.text[i] === '"'
  }

  private scanRawString(): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> {
    const start = this.pos
    let hashes = 0
    while (this.text[this.pos] === '#') {
      hashes++
      this.pos++
    }
    const token = this.scanString(hashes)
    return { ...token, text: this.text.slice(start, this.pos) }
  }

  /**
   * Scans `"…"`, `"""…"""`, and their raw `#"…"#` forms.
   *
   * `hashCount` is the number of `#` before the opening quote. In a raw string the
   * escape introducer becomes `\` + that many `#`, so `\(x)` is literal text but
   * `\#(x)` interpolates.
   */
  private scanString(hashCount: number): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> {
    const start = this.pos
    const hashes = '#'.repeat(hashCount)
    const multiline = this.text.startsWith('"""', this.pos)
    const delimiter = multiline ? '"""' : '"'
    const closing = delimiter + hashes
    const escape = '\\' + hashes

    this.pos += delimiter.length

    const segments: StringSegment[] = []
    let literal = ''
    let literalStart = this.pos

    const flushLiteral = () => {
      if (literal.length > 0) {
        segments.push({ kind: 'text', value: literal, span: this.span(literalStart, this.pos) })
        literal = ''
      }
    }

    while (this.pos < this.text.length) {
      if (this.text.startsWith(closing, this.pos)) {
        flushLiteral()
        this.pos += closing.length
        return this.finishString(start, segments, multiline)
      }

      if (!multiline && this.text[this.pos] === '\n') break

      if (this.text.startsWith(escape, this.pos)) {
        const afterEscape = this.pos + escape.length
        const next = this.text[afterEscape]

        if (next === '(') {
          flushLiteral()
          const exprStart = afterEscape + 1
          const exprEnd = this.findInterpolationEnd(exprStart)
          segments.push({
            kind: 'interpolation',
            value: this.text.slice(exprStart, exprEnd),
            span: this.span(exprStart, exprEnd),
          })
          // +1 to step past the closing ')', unless we ran off the end.
          this.pos = Math.min(exprEnd + 1, this.text.length)
          literalStart = this.pos
          continue
        }

        if (next !== undefined && next in ESCAPES) {
          literal += ESCAPES[next]
          this.pos = afterEscape + 1
          continue
        }

        if (next === 'u' && this.text[afterEscape + 1] === '{') {
          const close = this.text.indexOf('}', afterEscape + 2)
          if (close > 0) {
            const code = parseInt(this.text.slice(afterEscape + 2, close), 16)
            if (!Number.isNaN(code)) {
              literal += String.fromCodePoint(code)
              this.pos = close + 1
              continue
            }
          }
        }

        this.error(
          this.pos,
          afterEscape + 1,
          'unexpected_token',
          `Invalid escape sequence '\\${next ?? ''}' in string literal.`,
        )
        literal += next ?? ''
        this.pos = afterEscape + 1
        continue
      }

      literal += this.text[this.pos]
      this.pos++
    }

    flushLiteral()
    this.error(start, this.pos, 'unterminated_string', 'Unterminated string literal.')
    return this.finishString(start, segments, multiline)
  }

  /**
   * Finds the `)` closing an interpolation, tracking nested parens and nested
   * string literals so that `"\(f(a), "x)y")"` terminates in the right place.
   */
  private findInterpolationEnd(from: number): number {
    let depth = 1
    let i = from

    while (i < this.text.length) {
      const ch = this.text[i]!
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) return i
      } else if (ch === '"') {
        i = this.skipNestedString(i)
        continue
      }
      i++
    }
    return this.text.length
  }

  /** Steps over a string literal starting at `i`, returning the index just past it. */
  private skipNestedString(i: number): number {
    const multiline = this.text.startsWith('"""', i)
    const delimiter = multiline ? '"""' : '"'
    let j = i + delimiter.length

    while (j < this.text.length) {
      if (this.text[j] === '\\') {
        j += 2
        continue
      }
      if (this.text.startsWith(delimiter, j)) return j + delimiter.length
      if (!multiline && this.text[j] === '\n') return j
      j++
    }
    return this.text.length
  }

  private finishString(
    start: number,
    segments: StringSegment[],
    multiline: boolean,
  ): Omit<Token, 'span' | 'newlineBefore' | 'spaceBefore' | 'spaceAfter' | 'column'> {
    return {
      kind: 'stringLiteral',
      text: this.text.slice(start, this.pos),
      segments: multiline ? stripMultilineIndentation(segments) : segments,
    }
  }

  // ----------------------------------------------------------------- utils

  /**
   * 1-based column, computed by scanning back to the previous newline.
   *
   * Deliberately not tracked incrementally: multiline strings and block comments
   * both advance past newlines inside their own scanners, so an incremental
   * line-start counter silently drifts after either of them. This is O(column),
   * which is negligible, and cannot go stale.
   */
  private columnAt(offset: number): number {
    return offset - (this.text.lastIndexOf('\n', offset - 1) + 1) + 1
  }

  private span(start: number, end: number): SourceSpan {
    return { file: this.file, start: start + this.baseOffset, end: end + this.baseOffset }
  }

  private push(
    kind: TokenKind,
    text: string,
    start: number,
    end: number,
    newlineBefore: boolean,
    spaceBefore: boolean,
    spaceAfter: boolean,
  ): void {
    this.tokens.push({
      kind,
      text,
      span: this.span(start, end),
      newlineBefore,
      spaceBefore,
      spaceAfter,
      column: this.columnAt(start),
    })
  }

  private error(
    start: number,
    end: number,
    code: Diagnostic['code'],
    message: string,
  ): void {
    this.diagnostics.push({ span: this.span(start, end), severity: 'error', code, message })
  }
}

/**
 * Applies Swift's multiline-string rules: drop the newline that follows the opening
 * delimiter and the one preceding the closing delimiter, then strip the closing
 * delimiter's indentation from every line.
 */
function stripMultilineIndentation(segments: StringSegment[]): StringSegment[] {
  const first = segments[0]
  const last = segments[segments.length - 1]
  if (!first || !last) return segments

  const out = segments.map((s) => ({ ...s }))

  if (out[0]!.kind === 'text' && out[0]!.value.startsWith('\n')) {
    out[0] = { ...out[0]!, value: out[0]!.value.slice(1) }
  }

  const tail = out[out.length - 1]!
  if (tail.kind === 'text') {
    const match = /\n([ \t]*)$/.exec(tail.value)
    const indent = match?.[1] ?? ''
    out[out.length - 1] = { ...tail, value: tail.value.slice(0, tail.value.length - (indent.length + 1)) }

    if (indent.length > 0) {
      for (let i = 0; i < out.length; i++) {
        const seg = out[i]!
        if (seg.kind !== 'text') continue
        const lines = seg.value.split('\n')
        const stripped = lines.map((line, idx) => {
          // Indentation is only stripped at the start of a line. Within the first
          // segment, index 0 *is* a line start because the opening newline was just
          // removed. In any later segment, index 0 continues the line an
          // interpolation interrupted, so it must be left alone.
          const isLineStart = idx > 0 || i === 0
          if (!isLineStart) return line
          return line.startsWith(indent) ? line.slice(indent.length) : line
        })
        out[i] = { ...seg, value: stripped.join('\n') }
      }
    }
  }

  return out
}
