import { describe, expect, it } from 'vitest'
import { Parser } from '@studio/swift-syntax'
import { completionsAt, definitionAt, hoverAt, nameAt, referencesAt } from './symbols'

/**
 * The symbol index - Phase 8f.
 *
 * Every test here is written from the caret's point of view, because that is the only
 * thing the feature is ever asked about. The fixtures put the caret at a marker
 * rather than a hand-counted offset: an off-by-one in a test offset produces a
 * plausible-looking failure that sends you looking in the wrong file.
 */

const FILE = 'Sources/App.swift'

/** Splits a fixture at `|`, returning the text without it and the caret offset. */
function at(source: string): { text: string; offset: number } {
  const offset = source.indexOf('|')
  expect(offset, 'the fixture needs a | for the caret').toBeGreaterThanOrEqual(0)
  return { text: source.slice(0, offset) + source.slice(offset + 1), offset }
}

function parse(text: string) {
  return [Parser.parse(text, FILE).sourceFile]
}

function complete(source: string): string[] {
  const { text, offset } = at(source)
  return completionsAt(parse(text), FILE, text, offset).items.map((i) => i.name)
}

function completeDetailed(source: string) {
  const { text, offset } = at(source)
  return completionsAt(parse(text), FILE, text, offset)
}

function define(source: string) {
  const { text, offset } = at(source)
  return definitionAt(parse(text), FILE, text, offset)
}

function hover(source: string) {
  const { text, offset } = at(source)
  return hoverAt(parse(text), FILE, text, offset)
}

describe('completion in identifier position', () => {
  it('offers a property of the enclosing type', () => {
    expect(
      complete(`struct ContentView: View {
    @State private var count = 0
    var body: some View {
        Text("\\(c|)")
    }
}`),
    ).toContain('count')
  })

  it('offers a local declared above the caret', () => {
    expect(
      complete(`func go() {
    let greeting = "hi"
    print(g|)
}`),
    ).toContain('greeting')
  })

  it('does not offer a local declared below the caret', () => {
    // A function body reads top to bottom, unlike a type body. Offering `later` here
    // would suggest code that does not compile.
    expect(
      complete(`func go() {
    print(l|)
    let later = 1
}`),
    ).not.toContain('later')
  })

  it('offers a function parameter', () => {
    expect(
      complete(`func greet(name: String) {
    print(n|)
}`),
    ).toContain('name')
  })

  it('offers a loop variable inside the loop', () => {
    expect(
      complete(`func go() {
    for item in items {
        print(i|)
    }
}`),
    ).toContain('item')
  })

  it('offers a binding from if-let', () => {
    expect(
      complete(`func go() {
    if let user = maybeUser {
        print(u|)
    }
}`),
    ).toContain('user')
  })

  it('offers a caught error by the name the clause chose', () => {
    expect(
      complete(`func go() {
    do {
        try load()
    } catch let problem {
        print(p|)
    }
}`),
    ).toContain('problem')
  })

  it('offers the project’s own types', () => {
    expect(
      complete(`struct Card: View {
    var body: some View { Text("x") }
}

struct ContentView: View {
    var body: some View {
        C|
    }
}`),
    ).toContain('Card')
  })

  it('offers SwiftUI views', () => {
    const items = complete(`struct ContentView: View {
    var body: some View {
        V|
    }
}`)
    expect(items).toContain('VStack')
    expect(items).toContain('Text')
  })

  it('puts what is in scope before the built-ins', () => {
    // The editor filters but keeps the order it is given, and what the user just
    // wrote is likelier than `Capsule`.
    const items = complete(`struct ContentView: View {
    @State private var title = ""
    var body: some View {
        Text(t|)
    }
}`)
    expect(items.indexOf('title')).toBeLessThan(items.indexOf('Text'))
  })

  it('offers a method of the enclosing type from inside another', () => {
    expect(
      complete(`struct ContentView: View {
    func helper() -> String { "x" }
    func other() -> String { h| }
    var body: some View { Text("x") }
}`),
    ).toContain('helper')
  })

  it('offers a member an extension added', () => {
    expect(
      complete(`struct Card {
    var title: String
}

extension Card {
    var shout: String { t| }
}`),
    ).toContain('title')
  })
})

describe('completion after a dot', () => {
  it('offers the cases of a named enum', () => {
    const items = complete(`enum Tab {
    case home
    case profile
}

func go() {
    let t = Tab.|
}`)
    expect(items).toContain('home')
    expect(items).toContain('profile')
  })

  it('offers the members of a type a variable was annotated with', () => {
    const items = complete(`struct Card {
    var title: String
    func shout() -> String { title }
}

func go() {
    let card: Card = make()
    card.|
}`)
    expect(items).toContain('title')
    expect(items).toContain('shout')
  })

  it('offers the members of a type a variable was constructed from', () => {
    const items = complete(`struct Card {
    var title: String
}

func go() {
    let card = Card(title: "x")
    card.|
}`)
    expect(items).toContain('title')
  })

  it('offers modifiers when the receiver cannot be resolved', () => {
    // The honest answer. Inventing members for an unknown receiver is the one thing
    // this must never do - a name that does not exist is worse than a missing one.
    const items = complete(`struct ContentView: View {
    var body: some View {
        Text("hi").|
    }
}`)
    expect(items).toContain('padding')
    expect(items).toContain('frame')
  })

  it('offers modifiers for contextual member syntax it cannot type', () => {
    const items = complete(`struct ContentView: View {
    var body: some View {
        Text("hi").font(.|)
    }
}`)
    expect(items.length).toBeGreaterThan(0)
  })

  it('replaces from after the dot, not from the receiver', () => {
    const result = completeDetailed(`struct ContentView: View {
    var body: some View {
        Text("hi").pad|
    }
}`)
    const { text } = at(`struct ContentView: View {
    var body: some View {
        Text("hi").pad|
    }
}`)
    expect(text.slice(result.from)).toBe('pad\n    }\n}')
  })
})

describe('completion after an @', () => {
  it('offers property wrappers', () => {
    const items = complete(`struct ContentView: View {
    @|
    var body: some View { Text("x") }
}`)
    expect(items).toContain('State')
    expect(items).toContain('Binding')
  })

  it('offers ViewBuilder and main', () => {
    const items = complete(`@|
struct DemoApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}`)
    expect(items).toContain('main')
    expect(items).toContain('ViewBuilder')
  })
})

describe('go to definition', () => {
  it('finds a property of the enclosing type', () => {
    const found = define(`struct ContentView: View {
    @State private var count = 0
    var body: some View {
        Text("\\(cou|nt)")
    }
}`)
    expect(found?.name).toBe('count')
    expect(found?.kind).toBe('property')
  })

  it('finds a type declared elsewhere in the file', () => {
    const found = define(`struct Card: View {
    var body: some View { Text("x") }
}

struct ContentView: View {
    var body: some View { Ca|rd() }
}`)
    expect(found?.name).toBe('Card')
    expect(found?.kind).toBe('type')
  })

  it('prefers the innermost binding when a name is shadowed', () => {
    // Shadowing is why the scope is an ordered list and not a map.
    const found = define(`struct ContentView: View {
    var value = "outer"
    func go() {
        let value = "inner"
        print(val|ue)
    }
    var body: some View { Text("x") }
}`)
    expect(found?.kind).toBe('local')
  })

  it('finds an unambiguous enum case written contextually', () => {
    const found = define(`enum Tab {
    case home
    case profile
}

func go(tab: Tab) {
    if tab == .ho|me { }
}`)
    expect(found?.detail).toBe('Tab.home')
  })

  it('declines an ambiguous contextual case', () => {
    // Two enums both declare `home`. Jumping to the wrong one is worse than not
    // jumping at all, which is this file's whole rule in one test.
    const found = define(`enum Tab {
    case home
}

enum Screen {
    case home
}

func go(tab: Tab) {
    if tab == .ho|me { }
}`)
    expect(found).toBeNull()
  })

  it('returns nothing for a name that resolves nowhere', () => {
    expect(define('func go() { print(mys|tery) }')).toBeNull()
  })
})

describe('hover', () => {
  it('describes a SwiftUI view the preview draws', () => {
    const found = hover(`struct ContentView: View {
    var body: some View { VSt|ack { Text("x") } }
}`)
    expect(found).toMatchObject({ name: 'VStack', kind: 'view' })
  })

  it('says when a view is real SwiftUI the preview cannot draw', () => {
    // The honest gap, surfaced where the user is already looking rather than only in
    // the diagnostics panel.
    const found = hover(`struct ContentView: View {
    var body: some View { Ta|ble { Text("x") } }
}`)
    expect(found?.doc).toMatch(/the preview does not draw/i)
  })

  it('shows a function’s signature', () => {
    const found = hover(`func greet(name: String) -> String { name }

func go() { print(gre|et(name: "a")) }`)
    expect(found?.detail).toBe('(name: String) -> String')
  })

  it('shows a property wrapper on the property it wraps', () => {
    const found = hover(`struct ContentView: View {
    @State private var count = 0
    var body: some View { Text("\\(cou|nt)") }
}`)
    expect(found?.doc).toBe('@State')
  })
})

describe('references, for rename', () => {
  it('finds every occurrence of the identifier', () => {
    const text = `struct ContentView: View {
    @State private var count = 0
    var body: some View {
        Button("add") { count += 1 }
    }
}`
    const spans = referencesAt(text, text.indexOf('count'), FILE)
    expect(spans).toHaveLength(2)
    for (const span of spans) expect(text.slice(span.start, span.end)).toBe('count')
  })

  it('does not match a longer name that contains it', () => {
    const text = 'let count = 1\nlet counter = 2\nlet discount = 3'
    const spans = referencesAt(text, text.indexOf('count'), FILE)
    expect(spans).toHaveLength(1)
  })
})

describe('nameAt', () => {
  it('reads the identifier the caret sits inside', () => {
    expect(nameAt('let value = 1', 6)).toBe('value')
  })

  it('reads the identifier the caret sits just after', () => {
    expect(nameAt('let value = 1', 9)).toBe('value')
  })

  it('returns nothing in whitespace', () => {
    // Two spaces, caret between them: nothing to the left, nothing to the right.
    expect(nameAt('let  value = 1', 4)).toBeNull()
  })

  it('does not return a number as a name', () => {
    expect(nameAt('let value = 12', 14)).toBeNull()
  })
})
