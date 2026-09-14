import { describe, expect, it } from 'vitest'
import { Lexer } from './lexer'
import type { Token } from './tokens'

const FILE = 'Test.swift'

function lex(source: string) {
  return Lexer.tokenize(source, FILE)
}

/** Token kinds and texts, with the EOF sentinel dropped. */
function shape(source: string): [string, string][] {
  return lex(source)
    .tokens.filter((t) => t.kind !== 'endOfFile')
    .map((t) => [t.kind, t.text] as [string, string])
}

function texts(source: string): string[] {
  return shape(source).map(([, text]) => text)
}

function segmentsOf(source: string): Token['segments'] {
  return lex(source).tokens[0]?.segments
}

describe('identifiers and keywords', () => {
  it('separates keywords from identifiers', () => {
    expect(shape('struct Foo')).toEqual([
      ['keyword', 'struct'],
      ['identifier', 'Foo'],
    ])
  })

  it('treats a keyword prefix as an identifier', () => {
    expect(shape('structure')).toEqual([['identifier', 'structure']])
  })

  it('accepts $ for closure shorthand and property-wrapper projections', () => {
    expect(shape('$0 $count')).toEqual([
      ['identifier', '$0'],
      ['identifier', '$count'],
    ])
  })

  it('unwraps backtick-escaped keywords into plain identifiers', () => {
    expect(shape('`default`')).toEqual([['identifier', 'default']])
  })

  it('accepts non-ASCII identifiers', () => {
    expect(shape('let café = 1').slice(0, 2)).toEqual([
      ['keyword', 'let'],
      ['identifier', 'café'],
    ])
  })
})

describe('numbers', () => {
  it.each([
    ['42', 42],
    ['0', 0],
    ['1_000_000', 1_000_000],
    ['0xFF', 255],
    ['0b1010', 10],
    ['0o17', 15],
  ])('lexes integer %s', (source, value) => {
    const token = lex(source).tokens[0]!
    expect(token.kind).toBe('integerLiteral')
    expect(token.numericValue).toBe(value)
  })

  it.each([
    ['1.5', 1.5],
    ['0.25', 0.25],
    ['1e3', 1000],
    ['1.5e-2', 0.015],
    ['1_000.5', 1000.5],
  ])('lexes float %s', (source, value) => {
    const token = lex(source).tokens[0]!
    expect(token.kind).toBe('floatLiteral')
    expect(token.numericValue).toBeCloseTo(value)
  })

  it('does not swallow a range operator as a decimal point', () => {
    // The classic lexer bug: `1...5` becoming `1.` `..5`.
    expect(shape('1...5')).toEqual([
      ['integerLiteral', '1'],
      ['operator', '...'],
      ['integerLiteral', '5'],
    ])
  })

  it('handles the half-open range operator the same way', () => {
    expect(shape('0..<10')).toEqual([
      ['integerLiteral', '0'],
      ['operator', '..<'],
      ['integerLiteral', '10'],
    ])
  })
})

describe('operators and punctuation', () => {
  it('lexes multi-character operators greedily', () => {
    expect(texts('a <= b != c ?? d')).toEqual(['a', '<=', 'b', '!=', 'c', '??', 'd'])
  })

  it('lexes the function arrow as one token', () => {
    expect(texts('() -> Int')).toEqual(['(', ')', '->', 'Int'])
  })

  it('separates optional chaining into ? and .', () => {
    // `?.` must not lex as a single operator, or the member chain breaks.
    expect(shape('a?.b')).toEqual([
      ['identifier', 'a'],
      ['operator', '?'],
      ['punctuation', '.'],
      ['identifier', 'b'],
    ])
  })

  it('treats a lone dot as punctuation', () => {
    expect(shape('a.b')).toEqual([
      ['identifier', 'a'],
      ['punctuation', '.'],
      ['identifier', 'b'],
    ])
  })

  it('lexes attributes as single tokens', () => {
    expect(shape('@State var')).toEqual([
      ['attribute', '@State'],
      ['keyword', 'var'],
    ])
  })
})

describe('comments', () => {
  it('skips line comments', () => {
    expect(texts('let a = 1 // trailing\nlet b = 2')).toEqual([
      'let', 'a', '=', '1', 'let', 'b', '=', '2',
    ])
  })

  it('skips block comments', () => {
    expect(texts('let /* mid */ a = 1')).toEqual(['let', 'a', '=', '1'])
  })

  it('handles nested block comments', () => {
    // Swift block comments nest; a naive scan for the first `*/` ends too early.
    expect(texts('let /* outer /* inner */ still outer */ a = 1')).toEqual(['let', 'a', '=', '1'])
  })

  it('reports an unterminated block comment', () => {
    const { diagnostics } = lex('let a = 1 /* never closed')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]!.code).toBe('unterminated_block')
  })
})

describe('strings', () => {
  it('resolves escape sequences', () => {
    expect(segmentsOf('"a\\nb\\tc\\\\d\\"e"')).toEqual([
      expect.objectContaining({ kind: 'text', value: 'a\nb\tc\\d"e' }),
    ])
  })

  it('resolves unicode escapes', () => {
    expect(segmentsOf('"\\u{1F44B}"')).toEqual([
      expect.objectContaining({ kind: 'text', value: '👋' }),
    ])
  })

  it('splits interpolation into segments', () => {
    const segments = segmentsOf('"Hello, \\(name)!"')!
    expect(segments.map((s) => [s.kind, s.value])).toEqual([
      ['text', 'Hello, '],
      ['interpolation', 'name'],
      ['text', '!'],
    ])
  })

  it('handles an interpolation containing parentheses', () => {
    const segments = segmentsOf('"v=\\(max(a, b))"')!
    expect(segments[1]).toMatchObject({ kind: 'interpolation', value: 'max(a, b)' })
  })

  it('handles a string nested inside an interpolation', () => {
    // The close-paren scan must not stop at the `)` inside the nested literal.
    const segments = segmentsOf('"a\\(f(")"))b"')!
    expect(segments.map((s) => s.kind)).toEqual(['text', 'interpolation', 'text'])
    expect(segments[1]!.value).toBe('f(")")')
    expect(segments[2]!.value).toBe('b')
  })

  it('gives interpolation segments spans that point at the real source offsets', () => {
    const source = 'let s = "Hi \\(name)"'
    const token = lex(source).tokens.find((t) => t.kind === 'stringLiteral')!
    const interpolation = token.segments!.find((s) => s.kind === 'interpolation')!
    expect(source.slice(interpolation.span.start, interpolation.span.end)).toBe('name')
  })

  it('reports an unterminated string', () => {
    const { diagnostics } = lex('let a = "oops')
    expect(diagnostics.map((d) => d.code)).toContain('unterminated_string')
  })

  it('does not let an unterminated string swallow the next line', () => {
    const { tokens } = lex('let a = "oops\nlet b = 2')
    expect(tokens.map((t) => t.text)).toContain('b')
  })

  it('strips indentation from multiline strings', () => {
    const source = ['let s = """', '    line one', '    line two', '    """'].join('\n')
    const token = lex(source).tokens.find((t) => t.kind === 'stringLiteral')!
    expect(token.segments![0]!.value).toBe('line one\nline two')
  })

  it('treats interpolation as literal text in a raw string', () => {
    const segments = segmentsOf('#"no \\(escape) here"#')!
    expect(segments).toHaveLength(1)
    expect(segments[0]!.value).toBe('no \\(escape) here')
  })

  it('interpolates in a raw string when the escape carries a hash', () => {
    const segments = segmentsOf('#"value \\#(x)"#')!
    expect(segments.map((s) => s.kind)).toEqual(['text', 'interpolation'])
    expect(segments[1]!.value).toBe('x')
  })
})

describe('trivia flags', () => {
  it('marks the first token on a new line', () => {
    const tokens = lex('let a = 1\nlet b = 2').tokens
    const second = tokens.findIndex((t, i) => t.text === 'let' && i > 0)
    expect(tokens[second]!.newlineBefore).toBe(true)
    expect(tokens[1]!.newlineBefore).toBe(false)
  })

  it('marks a member-access dot on a continuation line', () => {
    // SwiftUI modifier chains rely on the parser continuing across this newline.
    const tokens = lex('Text("x")\n    .font(.largeTitle)').tokens
    const dot = tokens.find((t) => t.text === '.' && t.newlineBefore)
    expect(dot).toBeDefined()
  })

  it('records whitespace either side of an operator', () => {
    const tokens = lex('a - b').tokens
    const minus = tokens.find((t) => t.text === '-')!
    expect(minus.spaceBefore).toBe(true)
    expect(minus.spaceAfter).toBe(true)
  })

  it('distinguishes a prefix minus by the absence of trailing space', () => {
    const tokens = lex('f(-1)').tokens
    const minus = tokens.find((t) => t.text === '-')!
    expect(minus.spaceAfter).toBe(false)
  })
})

describe('spans', () => {
  it('gives every token a span that slices back to its own text', () => {
    const source = 'struct Foo { var x = 1 }'
    for (const token of lex(source).tokens) {
      if (token.kind === 'endOfFile') continue
      expect(source.slice(token.span.start, token.span.end)).toBe(token.text)
    }
  })

  it('offsets spans by baseOffset when lexing a fragment', () => {
    const { tokens } = Lexer.tokenize('name', FILE, 100)
    expect(tokens[0]!.span).toMatchObject({ start: 100, end: 104 })
  })
})
