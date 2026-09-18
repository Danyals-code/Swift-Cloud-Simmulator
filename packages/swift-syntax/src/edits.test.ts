import { describe, expect, it } from 'vitest'
import { Parser } from './parser'
import { deleteView, insertView, moveView, viewSiteAt } from './edits'

/**
 * The canvas's edits, at the level they actually happen: text in, text out.
 *
 * Two things are checked of every edit. The obvious one is that the result says what
 * it should. The one that matters more is that the result still *parses* - an edit
 * that produces a file the parser cannot read would take the preview down from a
 * single click, and no amount of it looking right in a diff would make up for that.
 */

const FILE = 'Sources/ContentView.swift'

const APP = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 16) {
            Text("Title")
                .font(.largeTitle)
            Text("Subtitle")
            Button("Press") { count += 1 }
                .padding()
        }
        .padding()
    }
}
`

/** Where a view starts, the way the studio finds it: the span the hierarchy carries. */
function offsetOf(text: string, needle: string): number {
  const at = text.indexOf(needle)
  expect(at, needle).toBeGreaterThan(-1)
  return at
}

function parses(text: string): boolean {
  return Parser.parse(text, FILE).diagnostics.filter((d) => d.severity === 'error').length === 0
}

describe('finding the statement a view belongs to', () => {
  it('reports its place among its siblings, and whether it can take children', () => {
    const title = viewSiteAt(APP, FILE, offsetOf(APP, 'Text("Title")'))!
    expect(title.index).toBe(0)
    expect(title.siblings).toBe(3)
    expect(title.container).toBe(false)
    expect(title.inContent).toBe(true)
    // The statement runs to the end of the modifier chain, not to the end of `Text(…)`.
    expect(APP.slice(title.start, title.end)).toBe('Text("Title")\n                .font(.largeTitle)')

    const stack = viewSiteAt(APP, FILE, offsetOf(APP, 'VStack'))!
    expect(stack.container).toBe(true)
    expect(stack.siblings).toBe(1)
    // The body is not a container's content, which is what stops it being emptied.
    expect(stack.inContent).toBe(false)
  })

  it('answers nothing for an offset outside any statement', () => {
    expect(viewSiteAt(APP, FILE, APP.length + 10)).toBeNull()
    expect(viewSiteAt(APP, FILE, 0)).toBeNull()
  })
})

describe('moving a view', () => {
  it('swaps it with the next sibling, modifiers and all', () => {
    const moved = moveView(APP, FILE, offsetOf(APP, 'Text("Title")'), 1)!
    expect(moved.text).toContain(`        VStack(spacing: 16) {
            Text("Subtitle")
            Text("Title")
                .font(.largeTitle)
            Button("Press") { count += 1 }
                .padding()
        }`)
    expect(parses(moved.text)).toBe(true)
    // The caller re-selects by offset, so it has to name the view that moved.
    expect(moved.text.slice(moved.offset)).toMatch(/^Text\("Title"\)/)
  })

  it('swaps it with the previous sibling, and back is the file it started as', () => {
    const down = moveView(APP, FILE, offsetOf(APP, 'Text("Subtitle")'), -1)!
    const up = moveView(down.text, FILE, down.offset, 1)!
    expect(up.text).toBe(APP)
    expect(down.text.slice(down.offset)).toMatch(/^Text\("Subtitle"\)/)
  })

  it('carries a whole nested container with its children', () => {
    const nested = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Text("First")
            HStack {
                Text("Inner one")
                Text("Inner two")
            }
            Text("Last")
        }
    }
}
`
    const moved = moveView(nested, FILE, offsetOf(nested, 'HStack'), 1)!
    expect(moved.text).toContain(`            Text("First")
            Text("Last")
            HStack {
                Text("Inner one")
                Text("Inner two")
            }`)
    expect(parses(moved.text)).toBe(true)
  })

  it('refuses at either end of the block, rather than doing nothing on a press', () => {
    expect(moveView(APP, FILE, offsetOf(APP, 'Text("Title")'), -1)).toBeNull()
    expect(moveView(APP, FILE, offsetOf(APP, 'Button("Press")'), 1)).toBeNull()
    // The root view has no siblings at all.
    expect(moveView(APP, FILE, offsetOf(APP, 'VStack'), 1)).toBeNull()
  })

  it('leaves the comments and blank lines around it where they were', () => {
    const spaced = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            // the heading
            Text("One")

            Text("Two")
        }
    }
}
`
    const moved = moveView(spaced, FILE, offsetOf(spaced, 'Text("One")'), 1)!
    expect(moved.text).toContain(`            // the heading
            Text("Two")

            Text("One")`)
  })

  it('handles two views written on one line', () => {
    const inline = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack { Text("A"); Text("B") }
    }
}
`
    const moved = moveView(inline, FILE, offsetOf(inline, 'Text("A")'), 1)!
    expect(moved.text).toContain('VStack { Text("B"); Text("A") }')
    expect(parses(moved.text)).toBe(true)
  })
})

describe('deleting a view', () => {
  it('takes the statement and the line it had to itself', () => {
    const deleted = deleteView(APP, FILE, offsetOf(APP, 'Text("Subtitle")'))!
    expect(deleted.text).toContain(`            Text("Title")
                .font(.largeTitle)
            Button("Press") { count += 1 }`)
    expect(deleted.text).not.toContain('Subtitle')
    expect(deleted.text.split('\n').length).toBe(APP.split('\n').length - 1)
    expect(parses(deleted.text)).toBe(true)
  })

  it('takes a container with everything in it', () => {
    const nested = APP.replace('Text("Subtitle")', 'HStack {\n                Text("Inner")\n            }')
    const deleted = deleteView(nested, FILE, offsetOf(nested, 'HStack'))!
    expect(deleted.text).not.toContain('Inner')
    expect(deleted.text).not.toContain('HStack')
    expect(parses(deleted.text)).toBe(true)
  })

  it('will empty a container, because an empty container is a view', () => {
    let text = APP
    for (const view of ['Text("Title")', 'Text("Subtitle")', 'Button("Press")']) {
      const edit = deleteView(text, FILE, offsetOf(text, view))
      expect(edit, view).not.toBeNull()
      text = edit!.text
    }
    expect(text).toContain('VStack(spacing: 16) {\n        }')
    expect(parses(text)).toBe(true)
  })

  it('refuses to empty a body, which would not compile', () => {
    expect(deleteView(APP, FILE, offsetOf(APP, 'VStack'))).toBeNull()
  })

  it('takes only its own half of a shared line', () => {
    const inline = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack { Text("A"); Text("B") }
    }
}
`
    const deleted = deleteView(inline, FILE, offsetOf(inline, 'Text("A")'))!
    expect(deleted.text).toContain('VStack { Text("B") }')
    expect(parses(deleted.text)).toBe(true)
  })
})

describe('adding a view', () => {
  it('puts it after the view that was selected, at the same indentation', () => {
    const added = insertView(APP, FILE, offsetOf(APP, 'Text("Title")'), 'Text("New")')!
    expect(added.text).toContain(`            Text("Title")
                .font(.largeTitle)
            Text("New")
            Text("Subtitle")`)
    expect(added.text.slice(added.offset)).toMatch(/^Text\("New"\)/)
    expect(parses(added.text)).toBe(true)
  })

  it('puts it inside the container that was selected, as its last child', () => {
    const added = insertView(APP, FILE, offsetOf(APP, 'VStack'), 'Spacer()')!
    expect(added.text).toContain(`            Button("Press") { count += 1 }
                .padding()
            Spacer()
        }`)
    expect(parses(added.text)).toBe(true)
  })

  it('opens an empty container onto its own lines', () => {
    const empty = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack { }
    }
}
`
    const added = insertView(empty, FILE, offsetOf(empty, 'VStack'), 'Text("First")')!
    expect(added.text).toContain(`        VStack {
            Text("First")
        }`)
    expect(added.text.slice(added.offset)).toMatch(/^Text\("First"\)/)
    expect(parses(added.text)).toBe(true)
  })

  it('indents every line of a multi-line snippet', () => {
    const added = insertView(APP, FILE, offsetOf(APP, 'Text("Subtitle")'), 'HStack {\n    Text("One")\n    Text("Two")\n}')!
    expect(added.text).toContain(`            Text("Subtitle")
            HStack {
                Text("One")
                Text("Two")
            }`)
    expect(parses(added.text)).toBe(true)
  })

  it('follows a file written with tabs', () => {
    const tabbed = 'import SwiftUI\n\nstruct ContentView: View {\n\tvar body: some View {\n\t\tVStack { }\n\t}\n}\n'
    const added = insertView(tabbed, FILE, offsetOf(tabbed, 'VStack'), 'Text("Tabbed")')!
    expect(added.text).toContain('\t\tVStack {\n\t\t\tText("Tabbed")\n\t\t}')
    expect(parses(added.text)).toBe(true)
  })

  it('adds beside a view on a shared line without breaking it', () => {
    const inline = `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack { Text("A"); Text("B") }
    }
}
`
    const added = insertView(inline, FILE, offsetOf(inline, 'Text("A")'), 'Spacer()')!
    expect(added.text).toContain('VStack { Text("A"); Spacer(); Text("B") }')
    expect(parses(added.text)).toBe(true)
  })
})

describe('what it declines to touch', () => {
  it('knows a Button’s trailing closure is an action, not content', () => {
    const site = viewSiteAt(APP, FILE, offsetOf(APP, 'Button("Press")'))!
    expect(site.container).toBe(false)
    // So Add puts a view beside the button rather than inside its action.
    const added = insertView(APP, FILE, offsetOf(APP, 'Button("Press")'), 'Text("After")')!
    expect(added.text).toContain(`            Button("Press") { count += 1 }
                .padding()
            Text("After")`)
    expect(parses(added.text)).toBe(true)
  })

  it('answers null for an offset in no view at all', () => {
    expect(deleteView(APP, FILE, 2)).toBeNull()
    expect(moveView(APP, FILE, 2, 1)).toBeNull()
    expect(insertView(APP, FILE, 2, 'Text("x")')).toBeNull()
  })
})
