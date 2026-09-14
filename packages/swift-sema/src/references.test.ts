import { describe, expect, it } from 'vitest'
import { referencesAt, referencesOf } from './symbols'

/**
 * Project-wide references - Phase 10a.
 *
 * These exist to pin down one decision: matching happens on **identifier tokens**, not
 * on text. Half the tests below are places where the two disagree, and every one of
 * them is a place a textual rename corrupts something quietly - a comment and a string
 * literal leave no compile error behind to notice the damage by.
 */

const FILE = 'Sources/App.swift'

function spansIn(text: string, name: string) {
  return referencesOf([{ id: FILE, text }], name)
}

describe('what counts as a reference', () => {
  it('finds a declaration and its uses', () => {
    const text = 'let count = 1\nprint(count)\nprint(count + 1)\n'
    expect(spansIn(text, 'count')).toHaveLength(3)
  })

  it('ignores the name inside a line comment', () => {
    const text = 'let count = 1\n// the count so far\n'
    expect(spansIn(text, 'count')).toHaveLength(1)
  })

  it('ignores the name inside a block comment', () => {
    const text = 'let count = 1\n/* count them all */\n'
    expect(spansIn(text, 'count')).toHaveLength(1)
  })

  it('ignores the name inside a string literal', () => {
    const text = 'let count = 1\nlet label = "count"\n'
    expect(spansIn(text, 'count')).toHaveLength(1)
  })

  it('finds the name inside a string interpolation', () => {
    // Interpolation is code, not text - exactly the distinction the lexer draws and a
    // regex cannot. Missing it would leave a rename half-applied.
    const text = 'let count = 1\nlet label = "total: \\(count)"\n'
    expect(spansIn(text, 'count')).toHaveLength(2)
  })

  it('does not match a longer name that contains it', () => {
    const text = 'let count = 1\nlet counter = 2\nlet discount = 3\n'
    expect(spansIn(text, 'count')).toHaveLength(1)
  })

  it('matches a name that is a keyword in some positions', () => {
    // `some` is a keyword in `some View` and an ordinary case name after a dot.
    const text = 'enum M {\n    case some(Int)\n}\nlet v = M.some(1)\n'
    expect(spansIn(text, 'some')).toHaveLength(2)
  })

  it('reports spans that select exactly the name', () => {
    const text = 'let count = 1\nprint(count)\n'
    for (const span of spansIn(text, 'count')) {
      expect(text.slice(span.start, span.end)).toBe('count')
    }
  })
})

describe('across files', () => {
  const files = [
    { id: 'Sources/A.swift', text: 'struct Card {\n    let title: String\n}\n' },
    { id: 'Sources/B.swift', text: 'let a = Card(title: "x")\nlet b = Card(title: "y")\n' },
    { id: 'Sources/C.swift', text: '// Card is declared in A\nlet unrelated = 1\n' },
  ]

  it('finds every use in every file', () => {
    const spans = referencesOf(files, 'Card')
    expect(spans).toHaveLength(3)
    expect(spans.filter((s) => s.file === 'Sources/A.swift')).toHaveLength(1)
    expect(spans.filter((s) => s.file === 'Sources/B.swift')).toHaveLength(2)
  })

  it('does not count the one in a comment', () => {
    expect(referencesOf(files, 'Card').some((s) => s.file === 'Sources/C.swift')).toBe(false)
  })

  it('returns nothing for a name that appears nowhere', () => {
    expect(referencesOf(files, 'Nowhere')).toEqual([])
  })

  it('returns nothing for an empty name', () => {
    expect(referencesOf(files, '')).toEqual([])
  })
})

describe('applying a rename', () => {
  it('produces text that still parses when the edits are applied back to front', () => {
    // Back to front, because every edit before a span shifts the ones after it. This
    // is the whole of what makes a multi-span rewrite correct, so it is asserted
    // rather than assumed.
    const text = 'let count = 1\nprint(count)\nlet other = count + count\n'
    const spans = referencesOf([{ id: FILE, text }], 'count')

    let renamed = text
    for (const span of [...spans].sort((a, b) => b.start - a.start)) {
      renamed = renamed.slice(0, span.start) + 'total' + renamed.slice(span.end)
    }

    expect(renamed).toBe('let total = 1\nprint(total)\nlet other = total + total\n')
  })

  it('leaves a same-spelled string alone when the rename is applied', () => {
    const text = 'let count = 1\nlet label = "count"\nprint(count)\n'
    const spans = referencesOf([{ id: FILE, text }], 'count')

    let renamed = text
    for (const span of [...spans].sort((a, b) => b.start - a.start)) {
      renamed = renamed.slice(0, span.start) + 'total' + renamed.slice(span.end)
    }

    expect(renamed).toBe('let total = 1\nlet label = "count"\nprint(total)\n')
  })
})

describe('the single-file entry point still works', () => {
  it('resolves the name at an offset', () => {
    const text = 'let count = 1\nprint(count)\n'
    expect(referencesAt(text, text.indexOf('count'), FILE)).toHaveLength(2)
  })

  it('returns nothing when the caret is not on a name', () => {
    expect(referencesAt('let  count = 1\n', 4, FILE)).toEqual([])
  })
})
