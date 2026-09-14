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
    // `NavigationStack` is perfectly valid Swift. Saying "cannot find in scope" would
    // be both wrong and unhelpful — it is the preview that cannot draw it.
    const [warning] = warnings(app('        NavigationStack { Text("x") }'))
    expect(warning?.code).toBe('unsupported_swiftui_view')
    expect(warning?.feature).toBe('NavigationStack')
    expect(warning?.message).toContain('Phase 6')
    expect(errors(app('        NavigationStack { Text("x") }'))).toEqual([])
  })

  it('names an unimplemented modifier', () => {
    const [warning] = warnings(app('        Text("x").shadow(radius: 4)'))
    expect(warning?.code).toBe('unsupported_swiftui_modifier')
    expect(warning?.feature).toBe('.shadow')
  })

  it('says nothing about supported modifiers', () => {
    expect(warnings(app('        Text("x").padding().font(.title)'))).toEqual([])
  })

  it('says nothing about a member that merely looks unfamiliar', () => {
    // `.red` is a member access like any modifier; with no type information the
    // checker must stay quiet rather than guess.
    expect(warnings(app('        Text("x").foregroundStyle(Color.red)'))).toEqual([])
  })

  it('flags an unsupported property wrapper by name', () => {
    const source = `@main struct M: App { var body: some Scene { WindowGroup { } } }
struct V: View {
    @ObservedObject var store = Store()
    var body: some View { Text("x") }
}`
    const wrapper = warnings(source).find((d) => d.feature === '@ObservedObject')
    expect(wrapper).toBeDefined()
    expect(wrapper!.message).toContain('Phase 4')
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
            Text("a").shadow(radius: 1)
            Text("b").shadow(radius: 1)
        }`)
    expect(warnings(source).filter((d) => d.feature === '.shadow')).toHaveLength(2)
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
