import { describe, expect, it } from 'vitest'
import { Parser } from './parser'
import { copyView, hiddenViewsIn, hideView, insertView, moveViewTo, showView } from './edits'
import { HIDDEN_MARKER } from './studio-markers'

/**
 * Dragging, copying and hiding.
 *
 * The three that a canvas needs beyond move and delete, and the two that are easy to
 * get subtly wrong: a drop is a cut and a paste whose offsets move under it, and a
 * hide has to be *reversible* - a view that is commented out is a view the parser
 * can no longer see, so the text has to carry enough to bring it back.
 */

const FILE = 'Sources/ContentView.swift'

const APP = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Text("One")
                .font(.title)
            Text("Two")
            HStack {
                Text("Inner")
            }
            Text("Three")
        }
    }
}
`

function offsetOf(text: string, needle: string): number {
  const at = text.indexOf(needle)
  expect(at, needle).toBeGreaterThan(-1)
  return at
}

const parses = (text: string) =>
  Parser.parse(text, FILE).diagnostics.filter((d) => d.severity === 'error').length === 0

describe('dropping a view somewhere else', () => {
  it('moves it after a later sibling', () => {
    const moved = moveViewTo(APP, FILE, offsetOf(APP, 'Text("One")'), offsetOf(APP, 'Text("Three")'), 'after')!
    expect(moved.text).toContain(`            Text("Two")
            HStack {
                Text("Inner")
            }
            Text("Three")
            Text("One")
                .font(.title)`)
    expect(moved.text.slice(moved.offset)).toMatch(/^Text\("One"\)/)
    expect(parses(moved.text)).toBe(true)
  })

  it('moves it before an earlier sibling', () => {
    const moved = moveViewTo(APP, FILE, offsetOf(APP, 'Text("Three")'), offsetOf(APP, 'Text("One")'), 'before')!
    expect(moved.text).toContain(`        VStack {
            Text("Three")
            Text("One")`)
    expect(moved.text.slice(moved.offset)).toMatch(/^Text\("Three"\)/)
    expect(parses(moved.text)).toBe(true)
  })

  it('moves it into another container, and back out of it', () => {
    const into = moveViewTo(APP, FILE, offsetOf(APP, 'Text("Two")'), offsetOf(APP, 'Text("Inner")'), 'after')!
    expect(into.text).toContain(`            HStack {
                Text("Inner")
                Text("Two")
            }`)
    expect(parses(into.text)).toBe(true)

    const out = moveViewTo(into.text, FILE, into.offset, offsetOf(into.text, 'Text("Three")'), 'before')!
    expect(out.text).toContain(`            HStack {
                Text("Inner")
            }
            Text("Two")
            Text("Three")`)
    expect(parses(out.text)).toBe(true)
  })

  it('carries a container and its children to a new place', () => {
    const moved = moveViewTo(APP, FILE, offsetOf(APP, 'HStack'), offsetOf(APP, 'Text("One")'), 'before')!
    expect(moved.text).toContain(`        VStack {
            HStack {
                Text("Inner")
            }
            Text("One")`)
    expect(parses(moved.text)).toBe(true)
  })

  it('refuses to drop a view inside itself, or onto itself', () => {
    expect(moveViewTo(APP, FILE, offsetOf(APP, 'HStack'), offsetOf(APP, 'Text("Inner")'), 'after')).toBeNull()
    expect(moveViewTo(APP, FILE, offsetOf(APP, 'Text("One")'), offsetOf(APP, 'Text("One")'), 'after')).toBeNull()
  })
})

describe('copying a view', () => {
  it('returns the Swift that draws it, modifiers and all, at the left margin', () => {
    expect(copyView(APP, FILE, offsetOf(APP, 'Text("One")'))).toBe('Text("One")\n    .font(.title)')
    expect(copyView(APP, FILE, offsetOf(APP, 'HStack'))).toBe('HStack {\n    Text("Inner")\n}')
    expect(copyView(APP, FILE, 2)).toBeNull()
  })

  it('pastes back as a sibling, indented where it lands', () => {
    const copied = copyView(APP, FILE, offsetOf(APP, 'Text("One")'))!
    const pasted = insertView(APP, FILE, offsetOf(APP, 'Text("Inner")'), copied)!
    expect(pasted.text).toContain(`            HStack {
                Text("Inner")
                Text("One")
                    .font(.title)
            }`)
    expect(parses(pasted.text)).toBe(true)
  })
})

describe('hiding a view', () => {
  it('comments it out, and says where it was', () => {
    const hidden = hideView(APP, FILE, offsetOf(APP, 'Text("Two")'))!
    expect(hidden.text).toContain(`            ${HIDDEN_MARKER}
            // Text("Two")`)
    expect(parses(hidden.text)).toBe(true)

    const [view, ...rest] = hiddenViewsIn(hidden.text, FILE)
    expect(rest).toEqual([])
    expect(view!.name).toBe('Two')
    expect(view!.type).toBe('Text')
    // The lines exactly as they were, indentation included, so showing it again is
    // a reversal rather than a re-formatting.
    expect(view!.source).toBe('            Text("Two")')
    // The container it came out of, so the tree can still show it in its place.
    expect(view!.container).toBe(offsetOf(hidden.text, 'VStack'))
  })

  it('brings it back exactly as it was', () => {
    const hidden = hideView(APP, FILE, offsetOf(APP, 'Text("One")'))!
    const view = hiddenViewsIn(hidden.text, FILE)[0]!
    expect(view.source).toBe('            Text("One")\n                .font(.title)')

    const shown = showView(hidden.text, FILE, view.start)!
    expect(shown.text).toBe(APP)
    expect(shown.text.slice(shown.offset)).toMatch(/^Text\("One"\)/)
  })

  it('hides a container with everything inside it', () => {
    const hidden = hideView(APP, FILE, offsetOf(APP, 'HStack'))!
    expect(hidden.text).toContain(`            // HStack {
            //     Text("Inner")
            // }`)
    const view = hiddenViewsIn(hidden.text, FILE)[0]!
    expect(view.type).toBe('HStack')
    expect(showView(hidden.text, FILE, view.start)!.text).toBe(APP)
  })

  it('leaves ordinary comments alone', () => {
    const commented = APP.replace('        VStack {', '        // just a note\n        VStack {')
    expect(hiddenViewsIn(commented, FILE)).toEqual([])
  })

  it('refuses what it cannot put back', () => {
    // The only view of a body: hiding it would leave nothing to draw.
    const single = `import SwiftUI

struct ContentView: View {
    var body: some View {
        Text("Only")
    }
}
`
    expect(hideView(single, FILE, offsetOf(single, 'Text("Only")'))).toBeNull()

    // Sharing a line: a `//` would take the neighbour with it.
    const inline = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack { Text("A"); Text("B") }
    }
}
`
    expect(hideView(inline, FILE, offsetOf(inline, 'Text("A")'))).toBeNull()
  })

  it('hides several, and shows them back one at a time', () => {
    let text = hideView(APP, FILE, offsetOf(APP, 'Text("One")'))!.text
    text = hideView(text, FILE, offsetOf(text, 'Text("Three")'))!.text
    const hidden = hiddenViewsIn(text, FILE)
    expect(hidden.map((view) => view.name)).toEqual(['One', 'Three'])
    expect(parses(text)).toBe(true)

    text = showView(text, FILE, hidden[1]!.start)!.text
    expect(hiddenViewsIn(text, FILE).map((view) => view.name)).toEqual(['One'])
    text = showView(text, FILE, hiddenViewsIn(text, FILE)[0]!.start)!.text
    expect(text).toBe(APP)
  })
})
