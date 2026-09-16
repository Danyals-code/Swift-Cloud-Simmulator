import { describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Swift that used to stop at the parser.
 *
 * Every case here was a syntax error or an unsupported report, and each is ordinary
 * modern Swift - the kind of thing that appears in the first file of a real project.
 * They are grouped by construct rather than by package because that is how they were
 * found and how they will be read: someone wondering "does this parse yet" looks for
 * the construct, not for the file that happens to handle it.
 */

const device = DEVICES['iphone-15']
let revision = 1

function run(source: string): CompileResult {
  resetPipelineState()
  return compile({
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  } satisfies CompileRequest)
}

function app(body: string, extra = ''): string {
  return [
    'import SwiftUI',
    '@main',
    'struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }',
    'struct ContentView: View {',
    body,
    '}',
    extra,
  ].join('\n')
}

const view = (expr: string, extra = ''): string => app(`    var body: some View { ${expr} }`, extra)

const texts = (result: CompileResult): string[] =>
  (result.renderTree?.nodes ?? [])
    .filter((n) => n.text)
    .map((n) => n.text!.runs.map((r) => r.text).join(''))

/** Compiles, asserts no errors, and returns every string the screen drew. */
function drew(source: string): string[] {
  const result = run(source)
  expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
  return texts(result)
}

describe('multiple trailing closures', () => {
  it('builds a Button whose label is a labelled closure', () => {
    expect(drew(view('Button { } label: { Text("Save") }'))).toContain('Save')
  })

  it('builds a Label from its title and icon closures', () => {
    expect(drew(view('Label { Text("Title") } icon: { Image(systemName: "star") }'))).toContain('Title')
  })

  it('builds a Section from its header closure', () => {
    // A grouped list uppercases its header, as iOS does.
    expect(drew(view('List { Section { Text("row") } header: { Text("Head") } }'))).toContain('HEAD')
  })

  it('builds a Menu from its label closure', () => {
    expect(drew(view('Menu { Button("a") {} } label: { Text("Options") }'))).toContain('Options')
  })

  it('shows an alert’s message closure', () => {
    const body =
      '    @State private var shown = true\n' +
      '    var body: some View { Text("a").alert("Title", isPresented: $shown) { Button("OK") {} } message: { Text("Explanation") } }'
    expect(drew(app(body))).toContain('Explanation')
  })

  it('still reads a single trailing closure as content', () => {
    expect(drew(view('Button("Plain") { }'))).toContain('Plain')
    expect(drew(view('VStack { Text("a") }'))).toContain('a')
  })
})

describe('property accessors', () => {
  it('runs an explicit getter', () => {
    expect(drew(view('Text("\\(S().v)")', 'struct S { var v: Int { get { 1 } } }'))).toContain('1')
  })

  it('runs an explicit setter, so the assignment reaches the storage', () => {
    const extra =
      'struct S { var n = 0\n var v: Int { get { n } set { n = newValue } } }\n' +
      'func f() -> Int { var s = S()\n s.v = 5\n return s.n }'
    expect(drew(view('Text("\\(f())")', extra))).toContain('5')
  })

  it('leaves an implicit getter and a protocol requirement alone', () => {
    expect(drew(view('Text("\\(S().v)")', 'struct S { var v: Int { 1 } }'))).toContain('1')
    expect(drew(view('Text("ok")', 'protocol P { var n: Int { get } }\nstruct S: P { var n = 1 }'))).toContain('ok')
  })

  it('accepts property observers rather than mistaking them for a trailing closure', () => {
    const extra = 'class C { var n = 0 { didSet { print("d") } } }\nfunc f() -> Int { let c = C()\n c.n = 3\n return c.n }'
    expect(drew(view('Text("\\(f())")', extra))).toContain('3')
  })
})

describe('declarations', () => {
  it('parses an attribute on a parameter, so a custom container view works', () => {
    const extra =
      'struct Box<C: View>: View {\n' +
      '    let content: () -> C\n' +
      '    init(@ViewBuilder content: @escaping () -> C) { self.content = content }\n' +
      '    var body: some View { VStack { content() } }\n' +
      '}'
    expect(drew(view('Box { Text("inside") }', extra))).toContain('inside')
  })

  it('declares and dispatches an operator written as a static method', () => {
    const equatable = 'struct P: Equatable { var x: Int\n static func == (a: P, b: P) -> Bool { a.x == b.x } }'
    expect(drew(view('Text("\\(P(x: 1) == P(x: 1))")', equatable))).toContain('true')

    const comparable = 'struct S: Comparable { var n: Int\n static func < (a: S, b: S) -> Bool { a.n < b.n } }'
    expect(drew(view('Text("\\(S(n: 1) < S(n: 2))")', comparable))).toContain('true')
  })

  it('declares a custom infix operator and gives it a precedence', () => {
    const extra = 'infix operator **: MultiplicationPrecedence\nfunc ** (a: Int, b: Int) -> Int { a * b }'
    // The whole expression is evaluated, rather than stopping at the unknown operator
    // and quietly answering with the left operand.
    expect(drew(view('Text("\\(2 ** 3)")', extra))).toContain('6')
  })

  it('binds a variadic parameter as an array', () => {
    expect(drew(view('Text("\\(f(1, 2, 3))")', 'func f(_ xs: Int...) -> Int { xs.count }'))).toContain('3')
  })

  it('accepts a typealias, a subscript and a deinit', () => {
    expect(drew(view('Text("\\(n)")', 'typealias Num = Int\nlet n: Num = 3'))).toContain('3')
    expect(drew(view('Text("\\(Num(3))")', 'typealias Num = Int'))).toContain('3')
    expect(drew(view('Text(Box()[0])', 'struct Box { subscript(i: Int) -> String { "x" } }'))).toContain('x')
    expect(drew(view('Text("ok")', 'class C { deinit { print("gone") } }'))).toContain('ok')
  })

  it('accepts an indirect enum and an actor', () => {
    expect(drew(view('Text("ok")', 'indirect enum E { case leaf, node(E) }'))).toContain('ok')
    expect(drew(view('Text("ok")', 'actor A { var n = 0 }'))).toContain('ok')
  })

  it('accepts a contextual keyword as a property name', () => {
    for (const name of ['open', 'some', 'any']) {
      expect(drew(view('Text("ok")', `struct S { private var ${name} = 1 }`))).toContain('ok')
    }
  })

  it('reads one back, which declaring it never implied', () => {
    // Declaring worked and reading did not: every position that asks for a *name*
    // consulted the contextual-keyword list, and expression position did not. So a
    // property could be declared and never used, and the error pointed at the name.
    const names = [
      'open', 'some', 'any', 'final', 'lazy', 'weak', 'dynamic', 'optional',
      'indirect', 'required', 'where', 'prefix', 'postfix', 'infix', 'mutating',
      'override', 'convenience',
    ]
    for (const name of names) {
      const source = app(
        [
          `    private var ${name} = 21`,
          `    private var doubled: Int { ${name} * 2 }`,
          '    var body: some View { Text("\\(doubled)") }',
        ].join('\n'),
      )
      expect(drew(source), name).toContain('42')
    }
  })

  it('reads `get` and `set` everywhere but where an accessor block begins', () => {
    // `var n: Int { get * 2 }` is an accessor block in Swift too, so this is the
    // language's own boundary rather than one of ours. Anywhere else they are names.
    const source = app(
      [
        '    private var get = 21',
        '    private var set = 2',
        '    private var doubled: Int { return get * set }',
        '    var body: some View { Text("\\(doubled) \\(get) \\(set)") }',
      ].join('\n'),
    )
    expect(drew(source)).toContain('42 21 2')
  })

  it('resolves Self to the enclosing type', () => {
    expect(drew(app('    static let name = "s"\n    var body: some View { Text(Self.name) }'))).toContain('s')
  })
})

describe('tuples', () => {
  it('reaches an element by position and by label', () => {
    expect(drew(view('Text("\\(t.0)")', 'let t = (1, 2)'))).toContain('1')
    expect(drew(view('Text("\\(p.x)")', 'let p = (x: 1, y: 2)'))).toContain('1')
  })

  it('returns one from a function', () => {
    expect(drew(view('Text("\\(f().0)")', 'func f() -> (Int, Int) { (1, 2) }'))).toContain('1')
    expect(
      drew(view('Text(f().name)', 'func f() -> (name: String, age: Int) { (name: "a", age: 1) }')),
    ).toContain('a')
  })

  it('destructures in a let and in a for-in', () => {
    expect(drew(view('Text("\\(a) \\(b)")', 'let (a, b) = (1, 2)'))).toContain('1 2')

    const overDictionary = 'func f() -> Int { var n = 0\n for (_, v) in ["a": 1, "b": 2] { n += v }\n return n }'
    expect(drew(view('Text("\\(f())")', overDictionary))).toContain('3')
  })

  it('compares by value and matches a tuple pattern', () => {
    expect(drew(view('Text("\\((1, 2) == (1, 2))")'))).toContain('true')

    const switched = 'func f() -> String { let t = (1, 2)\n switch t { case (1, _): return "a"\n default: return "b" } }'
    expect(drew(view('Text(f())', switched))).toContain('a')
  })
})

describe('operators as values', () => {
  it('passes an operator where a closure is expected', () => {
    expect(drew(view('Text("\\([1, 2, 3].reduce(0, +))")'))).toContain('6')
    expect(drew(view('Text("\\([1, 3, 2].sorted(by: >).first ?? 0)")'))).toContain('3')
  })
})

describe('control flow', () => {
  it('runs a defer block when the scope exits', () => {
    // The deferred write happens *after* the return value is computed, which is the
    // whole reason the statement exists.
    const extra = 'func f() -> String { var s = "a"\n defer { s = "b" }\n return s }'
    expect(drew(view('Text(f())', extra))).toContain('a')
  })

  it('falls through to the next case', () => {
    const extra = 'func f(_ n: Int) -> String { switch n { case 1: fallthrough\n case 2: return "b"\n default: return "c" } }'
    expect(drew(view('Text(f(1))', extra))).toContain('b')
  })

  it('accepts a labelled loop and an async let', () => {
    expect(drew(view('Text("ok")', 'func f() { outer: for i in 0..<3 { for _ in 0..<3 { break outer }\n _ = i } }'))).toContain('ok')
    expect(
      drew(view('Text("ok")', 'func g() async -> Int { 1 }\nfunc f() async -> Int { async let a = g()\n return await a }')),
    ).toContain('ok')
  })
})
