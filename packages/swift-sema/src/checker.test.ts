import { describe, expect, it } from 'vitest'
import { Parser } from '@studio/swift-syntax'
import type { Diagnostic } from '@studio/shared'
import { Checker } from './checker'

const FILE = 'Test.swift'

function analyse(source: string): readonly Diagnostic[] {
  const { sourceFile, diagnostics } = Parser.parse(source, FILE)
  const model = Checker.check([sourceFile])
  return [...diagnostics, ...model.diagnostics]
}

function errors(source: string): string[] {
  return analyse(source)
    .filter((d) => d.severity === 'error')
    .map((d) => d.message)
}

function warnings(source: string): Diagnostic[] {
  return analyse(source).filter((d) => d.severity === 'warning')
}

function model(source: string) {
  const { sourceFile } = Parser.parse(source, FILE)
  return Checker.check([sourceFile])
}

/** A minimal well-formed app, so tests can focus on one thing at a time. */
function app(body: string, extra = ''): string {
  return `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    var body: some View {
${body}
    }
}
${extra}
`
}

// --------------------------------------------------------------------------

describe('the false-positive gate (Phase 1 gate 4)', () => {
  const REFERENCE = `import SwiftUI

@main
struct CounterApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var count = 0
    @State private var name = "World"

    var body: some View {
        VStack(spacing: 16) {
            Text("Hello, \\(name)!")
                .font(.largeTitle)
                .foregroundStyle(.primary)

            Text("Count: \\(count)")
                .font(.title2)
                .foregroundStyle(count < 0 ? Color.red : Color.primary)

            HStack(spacing: 12) {
                Button("Minus") {
                    count -= 1
                }
                .padding()
                .background(Color.red.opacity(0.15))

                Spacer()

                Button("Plus") {
                    count += 1
                }
                .padding()
                .background(Color.green.opacity(0.15))
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
        .padding()
        .background(Color(white: 0.95))
    }
}
`

  it('reports nothing at all on the reference app', () => {
    // The single most important assertion in this package. Anything reported here
    // is a false positive on code that is unambiguously correct.
    expect(analyse(REFERENCE).map((d) => `${d.severity}: ${d.message}`)).toEqual([])
  })

  it.each([
    ['forward references', 'struct A: View { var body: some View { B() } }\nstruct B: View { var body: some View { Text("x") } }'],
    ['a property used above its declaration', 'struct A: View { var body: some View { Text(label) }\n  let label = "x" }'],
    ['a method called from body', 'struct A: View { func make() -> String { "x" }\n  var body: some View { Text(make()) } }'],
    ['closure shorthand', 'struct A: View { var body: some View { Text(["a"].map { $0 }.first ?? "") } }'],
    ['a for-in loop variable', 'struct A: View { func f() { for i in 0..<3 { print(i) } } \n var body: some View { Text("x") } }'],
    ['a local let', 'struct A: View { var body: some View { Text("x") }\n func f() { let v = 1; print(v) } }'],
    ['a shadowed name', 'struct A: View { let v = 1\n var body: some View { Text("x") }\n func f() { let v = 2; print(v) } }'],
    ['closure parameters', 'struct A: View { var body: some View { Text("x") }\n func f() { [1].forEach { item in print(item) } } }'],
    ['a State projection', 'struct A: View { @State var on = false\n var body: some View { Text("x").onTapGesture { on = !on } } }'],
  ])('reports no error for %s', (_label, source) => {
    // Each of these is valid Swift that a naive resolver gets wrong.
    expect(errors(`@main struct M: App { var body: some Scene { WindowGroup { } } }\n${source}`)).toEqual([])
  })
})

describe('name resolution', () => {
  it('reports an identifier that resolves nowhere', () => {
    expect(errors(app('        Text(missingName)'))).toEqual([
      "Cannot find 'missingName' in scope.",
    ])
  })

  it('uses Swift-matching wording', () => {
    // G5: what someone learns here should transfer to Xcode.
    expect(errors(app('        Text(nope)'))[0]).toMatch(/^Cannot find '\w+' in scope\.$/)
  })

  it('does not resolve a local from a sibling scope', () => {
    const source = app('        Text("x")', `
struct Other: View {
    var body: some View {
        Text("y")
    }
    func a() { let secret = 1; print(secret) }
    func b() { print(secret) }
}
`)
    expect(errors(source)).toEqual(["Cannot find 'secret' in scope."])
  })

  it('does not report member names', () => {
    // Member existence needs type information; guessing here would be a false positive.
    expect(errors(app('        Text("x").foregroundStyle(Color.someNewColor)'))).toEqual([])
  })

  it('does not report implicit member syntax', () => {
    expect(errors(app('        Text("x").font(.someUnknownFont)'))).toEqual([])
  })

  it('flags a redeclared type', () => {
    const source = app('        Text("x")', 'struct ContentView: View { var body: some View { Text("dup") } }')
    expect(errors(source)).toContain("Invalid redeclaration of 'ContentView'.")
  })
})

describe('coverage diagnostics are honest, not wrong', () => {
  it('names an unimplemented view rather than calling it unresolved', () => {
    // `Chart` is perfectly valid Swift. Saying "cannot find in scope" would be both
    // wrong and unhelpful - it is the preview that cannot draw it. The name checked
    // here moves as coverage grows; what must not change is that a real SwiftUI name
    // is never reported as unresolved.
    const [warning] = warnings(app('        Chart { }'))
    expect(warning?.code).toBe('unsupported_swiftui_view')
    expect(warning?.feature).toBe('Chart')
    expect(warning?.message).toContain('does not draw')
    expect(errors(app('        Chart { }'))).toEqual([])
  })

  it('names an unimplemented modifier', () => {
    const [warning] = warnings(app('        Text("x").mask(Circle())'))
    expect(warning?.code).toBe('unsupported_swiftui_modifier')
    expect(warning?.feature).toBe('.mask')
  })

  it('says nothing about the views Phase 6 added', () => {
    // The guard against the coverage matrix and the checker drifting apart: every
    // name here renders, so warning about any of them would be a false positive.
    const source = app(`        NavigationStack {
            List {
                NavigationLink("Detail") { Text("there") }
            }
            .navigationTitle("Home")
        }`)
    expect(warnings(source)).toEqual([])
    expect(errors(source)).toEqual([])
  })

  it('says nothing about supported modifiers', () => {
    expect(warnings(app('        Text("x").padding().font(.title)'))).toEqual([])
  })

  it('says nothing about a member that merely looks unfamiliar', () => {
    // `.red` is a member access like any modifier; with no type information the
    // checker must stay quiet rather than guess.
    expect(warnings(app('        Text("x").foregroundStyle(Color.red)'))).toEqual([])
  })

  it('says nothing about a property wrapper it implements', () => {
    // `@AppStorage` warned here, and the warning said "arriving in Phase 7" after
    // Phase 7 had shipped. It is storage now, so there is nothing to say.
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }
struct V: View {
    @AppStorage("seen") var seen = false
    var body: some View { Text("x") }
}`
    expect(warnings(source).find((d) => d.feature === '@AppStorage')).toBeUndefined()
  })

  it('still flags a wrapper it has never heard of', () => {
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }
struct V: View {
    @FetchRequest var rows: [Int]
    var body: some View { Text("x") }
}`
    const found = warnings(source).find((d) => d.feature === '@FetchRequest')
    expect(found).toBeDefined()
    expect(found!.message).toContain('exported unchanged')
  })

  it('promises no phase number in any diagnostic it emits', () => {
    // Every unimplemented diagnostic used to promise Phase 7, and kept promising it
    // after Phase 10 shipped. This is the assertion that stops it coming back.
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }
struct V: View {
    @FetchRequest var rows: [Int]
    var body: some View { Text("x").blendMode(.multiply).madeUpModifier() }
}`
    for (const diagnostic of analyse(source)) {
      expect(diagnostic.message, diagnostic.message).not.toMatch(/Phase \d/)
    }
  })

  it('knows a user enum as a type annotation', () => {
    // The checker warned "the preview does not know the type 'Step'" for an enum it
    // had just collected - a false positive on a declaration in the same file.
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }

enum Step: String {
    case first, second
}

struct V: View {
    @State private var step: Step = .first
    var body: some View { Text(step.rawValue) }
}`
    expect(warnings(source)).toEqual([])
    expect(errors(source)).toEqual([])
  })

  it('says nothing about the observation wrappers Phase 7 added', () => {
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }

class Store: ObservableObject {
    @Published var count = 0
}

struct V: View {
    @StateObject private var store = Store()
    @Environment(\\.colorScheme) private var scheme
    var body: some View { Text("\\(store.count)") }
}`
    expect(warnings(source)).toEqual([])
    expect(errors(source)).toEqual([])
  })

  it('accepts @State without comment', () => {
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }
struct V: View {
    @State private var count = 0
    var body: some View { Text("x") }
}`
    expect(warnings(source).filter((d) => d.feature === '@State')).toEqual([])
  })

  it('reports an unknown type as a warning, never an error', () => {
    // The known-type list is necessarily incomplete, so this can never be an error
    // without eventually firing on valid code.
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }
struct V: View {
    var value: SomeUnknownType? = nil
    var body: some View { Text("x") }
}`
    expect(errors(source)).toEqual([])
    expect(warnings(source).some((d) => d.message.includes('SomeUnknownType'))).toBe(true)
  })

  it('reports each coverage warning once per site', () => {
    // `.padding()` appears repeatedly in real code; a warning per occurrence would
    // bury everything else in the problems panel.
    const source = app(`        VStack {
            Text("a").mask(Circle())
            Text("b").mask(Circle())
        }`)
    expect(warnings(source).filter((d) => d.feature === '.mask')).toHaveLength(2)
  })
})

describe('entry point', () => {
  it('requires one', () => {
    expect(errors('struct V: View { var body: some View { Text("x") } }')).toContain(
      "This project has no entry point. Add '@main' to a struct that conforms to 'App'.",
    )
  })

  it('rejects two', () => {
    const source = `@main struct A: App { var body: some Scene { WindowGroup { } } }
@main struct B: App { var body: some Scene { WindowGroup { } } }`
    expect(errors(source).some((m) => m.includes('more than one entry point'))).toBe(true)
  })

  it('requires the entry point to conform to App', () => {
    expect(errors('@main struct A { }')).toContain("'@main' type 'A' must conform to 'App'.")
  })

  it('resolves the entry point into the model', () => {
    const result = model('@main struct MyApp: App { var body: some Scene { WindowGroup { } } }')
    expect(result.entryPoint?.name).toBe('MyApp')
    expect(result.entryPoint?.isApp).toBe(true)
  })
})

describe('View conformance', () => {
  it('requires a body', () => {
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }
struct V: View { let title = "x" }`
    expect(errors(source)).toContain(
      "Type 'V' does not conform to protocol 'View'. Add a 'body' property.",
    )
  })

  it('accepts a struct with a body', () => {
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }
struct V: View { var body: some View { Text("x") } }`
    expect(errors(source)).toEqual([])
  })
})

describe('the semantic model', () => {
  const SOURCE = `@main struct M: App { var body: some Scene { WindowGroup { } } }
struct Card: View {
    @State private var count = 0
    let title: String
    var subtitle: String { "n = \\(count)" }
    func bump() { count += 1 }
    var body: some View { Text(title) }
}`

  it('records types, properties and methods', () => {
    const card = model(SOURCE).types.get('Card')!
    expect(card.isView).toBe(true)
    expect(card.conformances).toEqual(['View'])
    expect(card.properties.map((p) => p.name)).toEqual(['count', 'title', 'subtitle', 'body'])
    expect(card.methods.map((m) => m.name)).toEqual(['bump'])
  })

  it('records property wrappers and computed-ness', () => {
    const card = model(SOURCE).types.get('Card')!
    const byName = new Map(card.properties.map((p) => [p.name, p]))
    expect(byName.get('count')).toMatchObject({ propertyWrapper: 'State', isComputed: false })
    expect(byName.get('title')).toMatchObject({ propertyWrapper: null, isLet: true })
    expect(byName.get('subtitle')).toMatchObject({ isComputed: true })
    expect(byName.get('body')).toMatchObject({ isComputed: true })
  })
})

describe('protocols and extensions (Phase 8a)', () => {
  it('resolves a protocol named as a conformance', () => {
    expect(
      errors(
        app(
          'Text("x")',
          `protocol Titled { var title: String { get } }
struct Card: Titled { var title: String }`,
        ),
      ),
    ).toEqual([])
  })

  it('does not warn that a user protocol is an unknown type', () => {
    expect(
      warnings(
        app(
          'Text("x")',
          `protocol Shape { func area() -> Double }
struct Box: Shape {
    var side: Double
    func area() -> Double { side * side }
}`,
        ),
      ).map((d) => d.message),
    ).toEqual([])
  })

  it('accepts a View whose body is written in an extension', () => {
    // The reason `describeStruct` reads the merged member list. Splitting a long view
    // across extensions is ordinary style, and reporting "add a body" for one is the
    // exact false positive gate 4 forbids.
    expect(
      errors(
        app(
          'Text("x")',
          `struct Split: View {}
extension Split {
    var body: some View { Text("hi") }
}`,
        ),
      ),
    ).toEqual([])
  })

  it('accepts a conformance added by an extension', () => {
    expect(
      errors(
        app(
          'Text("x")',
          `struct Late {}
extension Late: View {
    var body: some View { Text("hi") }
}`,
        ),
      ),
    ).toEqual([])
  })

  it('still reports a View with no body anywhere', () => {
    // The check has to stay capable of firing, or widening it to extensions would
    // have quietly turned it off.
    expect(errors(app('Text("x")', 'struct Empty: View {}'))).toEqual([
      "Type 'Empty' does not conform to protocol 'View'. Add a 'body' property.",
    ])
  })

  it('resolves a method one extension adds from inside another', () => {
    expect(
      errors(
        app(
          'Text("x")',
          `struct Chain {}
extension Chain { func first() -> String { "a" } }
extension Chain { func second() -> String { first() } }`,
        ),
      ),
    ).toEqual([])
  })

  it('resolves an associated type used inside its protocol', () => {
    expect(
      warnings(
        app(
          'Text("x")',
          `protocol Container {
    associatedtype Item
    func first() -> Item
}`,
        ),
      ).map((d) => d.message),
    ).toEqual([])
  })

  it('records extension members on the type', () => {
    const info = model(
      app(
        'Text("x")',
        `struct Card: View {
    var title: String
}
extension Card {
    var body: some View { Text(title) }
    func shout() -> String { title }
}`,
      ),
    ).types.get('Card')!
    expect(info.properties.map((p) => p.name)).toEqual(['title', 'body'])
    expect(info.methods.map((m) => m.name)).toEqual(['shout'])
    expect(info.isView).toBe(true)
  })

  it('records a conformance reached through a refined protocol', () => {
    const info = model(
      app(
        'Text("x")',
        `protocol Base {}
protocol Refined: Base {}
struct Impl: Refined {}`,
      ),
    ).types.get('Impl')!
    expect([...info.conformances].sort()).toEqual(['Base', 'Refined'])
  })
})

describe('quick fixes (Phase 8g)', () => {
  it('suggests the name the user probably meant', () => {
    const found = analyse(app('Text(titel)', 'let title = "x"')).find(
      (d) => d.code === 'unresolved_identifier',
    )
    expect(found?.message).toContain("Did you mean 'title'?")
    expect(found?.fixIts?.[0]?.edits[0]?.newText).toBe('title')
  })

  it('suggests a SwiftUI view for a near miss', () => {
    const found = analyse(app('VStak { Text("x") }')).find(
      (d) => d.code === 'unresolved_identifier',
    )
    expect(found?.fixIts?.[0]?.edits[0]?.newText).toBe('VStack')
  })

  it('does not suggest anything for a name that resembles nothing', () => {
    // A fix the user has to undo costs more than no fix. A three-letter typo must not
    // reach for an unrelated three-letter name.
    const found = analyse(app('Text(zqx)')).find((d) => d.code === 'unresolved_identifier')
    expect(found?.message).toBe("Cannot find 'zqx' in scope.")
    expect(found?.fixIts).toBeUndefined()
  })

  it('offers to add a missing body', () => {
    const found = analyse(app('Text("x")', 'struct Empty: View {}')).find(
      (d) => d.code === 'not_conformant',
    )
    expect(found?.fixIts?.[0]?.title).toBe("Add a 'body' property")
    expect(found?.fixIts?.[0]?.edits[0]?.newText).toContain('var body: some View')
  })

  it('inserts the body inside the type it belongs to', () => {
    const source = app('Text("x")', 'struct Empty: View {}')
    const found = analyse(source).find((d) => d.code === 'not_conformant')!
    const edit = found.fixIts![0]!.edits[0]!

    // Applying the edit has to produce something that parses, or the fix is a trap.
    const fixed = source.slice(0, edit.span.start) + edit.newText + source.slice(edit.span.end)
    expect(fixed).toContain('struct Empty: View {\n    var body: some View')
    expect(errors(fixed)).toEqual([])
  })
})
