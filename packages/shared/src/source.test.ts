import { describe, expect, it } from 'vitest'
import { LineIndex, mergeSpans, span, spanContains, spanLength } from './source'

describe('LineIndex', () => {
  const text = 'import SwiftUI\n\nstruct ContentView: View {\n    var body: some View {\n'
  const index = new LineIndex(text)

  it('counts lines including the trailing empty one', () => {
    expect(index.lineCount).toBe(5)
  })

  it('locates the start of the file', () => {
    expect(index.locate(0)).toEqual({ line: 1, column: 1 })
  })

  it('locates a position mid-line', () => {
    // 'SwiftUI' starts at offset 7, on line 1
    expect(index.locate(7)).toEqual({ line: 1, column: 8 })
  })

  it('locates the start of a later line', () => {
    const structOffset = text.indexOf('struct')
    expect(index.locate(structOffset)).toEqual({ line: 3, column: 1 })
  })

  it('locates an indented position', () => {
    const varOffset = text.indexOf('var body')
    expect(index.locate(varOffset)).toEqual({ line: 4, column: 5 })
  })

  it('handles an empty line', () => {
    expect(index.locate(text.indexOf('\n') + 1)).toEqual({ line: 2, column: 1 })
  })

  it('clamps an offset past the end', () => {
    expect(index.locate(10_000).line).toBe(index.lineCount)
  })

  it('clamps a negative offset', () => {
    expect(index.locate(-5)).toEqual({ line: 1, column: 1 })
  })

  it('round-trips offset -> locate -> offsetAt', () => {
    for (let offset = 0; offset <= text.length; offset++) {
      const { line, column } = index.locate(offset)
      expect(index.offsetAt(line, column), `offset ${offset}`).toBe(offset)
    }
  })

  it('returns line text without the newline', () => {
    expect(index.lineText(1)).toBe('import SwiftUI')
    expect(index.lineText(2)).toBe('')
    expect(index.lineText(3)).toBe('struct ContentView: View {')
  })

  it('returns empty text for an out-of-range line', () => {
    expect(index.lineText(0)).toBe('')
    expect(index.lineText(99)).toBe('')
  })

  it('handles an empty file', () => {
    const empty = new LineIndex('')
    expect(empty.lineCount).toBe(1)
    expect(empty.locate(0)).toEqual({ line: 1, column: 1 })
    expect(empty.lineText(1)).toBe('')
  })

  it('treats CRLF as one line break, leaving CR in the line text', () => {
    // The lexer normalises; LineIndex only splits on \n so that offsets stay
    // aligned with the raw buffer CodeMirror holds.
    const crlf = new LineIndex('a\r\nb')
    expect(crlf.lineCount).toBe(2)
    expect(crlf.locate(3)).toEqual({ line: 2, column: 1 })
  })

  it('counts astral characters as two UTF-16 units, matching CodeMirror', () => {
    const withEmoji = new LineIndex('let a = "👋"\nlet b = 1')
    const secondLine = 'let a = "👋"\n'.length
    expect(withEmoji.locate(secondLine)).toEqual({ line: 2, column: 1 })
  })
})

describe('SourceSpan helpers', () => {
  it('computes length', () => {
    expect(spanLength(span('a.swift', 4, 10))).toBe(6)
  })

  it('treats the end offset as exclusive', () => {
    const s = span('a.swift', 4, 10)
    expect(spanContains(s, 4)).toBe(true)
    expect(spanContains(s, 9)).toBe(true)
    expect(spanContains(s, 10)).toBe(false)
    expect(spanContains(s, 3)).toBe(false)
  })

  it('merges to the outer bounds regardless of argument order', () => {
    const a = span('a.swift', 10, 20)
    const b = span('a.swift', 4, 12)
    expect(mergeSpans(a, b)).toEqual({ file: 'a.swift', start: 4, end: 20 })
    expect(mergeSpans(b, a)).toEqual({ file: 'a.swift', start: 4, end: 20 })
  })
})
