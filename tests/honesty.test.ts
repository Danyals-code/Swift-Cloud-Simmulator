import { describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, SourceFile } from '@studio/shared'
import { applyEvent, compile, referencesFor, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES, getDevice } from '@studio/sim-shell'
import { decodeProject, encodeProject, type Project } from '@studio/project-model'

/**
 * The preview may be imperfect; it may not be dishonest.
 *
 * Every case here is one where the studio used to report success and show something
 * untrue - a modifier accepted and ignored, a formatted number rendered raw, a tap
 * that crashed and looked like it worked - or where it destroyed something quietly.
 * They are grouped by that property rather than by which package they touch, because
 * what they have in common is the promise they break, not the code they run through.
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

const errors = (result: CompileResult): string[] =>
  result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)

const warnings = (result: CompileResult): string[] =>
  result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)

/** Taps the first button by the path the worker actually takes. */
function tapFirstButton(source: string): CompileResult {
  resetPipelineState()
  const request: CompileRequest = {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  }
  const before = compile(request)
  const button = (before.renderTree?.nodes ?? []).find((n) => n.hitTarget?.role === 'button')
  expect(button?.hitTarget, 'no button to tap').toBeDefined()
  applyEvent({ kind: 'tap', handlerId: button!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(revision++)
}

/** A button whose label shows the array, so a mutation is visible in the render tree. */
function mutating(statement: string): string {
  return app(
    `    @State private var a = [1, 2]\n    var body: some View { Button("go \\(a.description)") { ${statement} } }`,
  )
}

describe('nothing is destroyed quietly', () => {
  it('keeps what removeAll(where:) was told to keep', () => {
    // The predicate used to be ignored and the array truncated, which looks exactly
    // like a successful call.
    expect(texts(tapFirstButton(mutating('a.removeAll { $0 > 1 }')))).toContain('go [1]')
  })

  it('flattens append(contentsOf:) rather than nesting it', () => {
    expect(texts(tapFirstButton(mutating('a.append(contentsOf: [7, 8])')))).toContain('go [1, 2, 7, 8]')
  })

  it('drops the duplicates a Set annotation asks it to drop', () => {
    expect(texts(run(view('Text("\\(s.count)")', 'let s: Set<Int> = [1, 2, 2]')))).toContain('2')
  })

  it('honours a dictionary default instead of answering nil', () => {
    expect(texts(run(view('Text("\\(d["b", default: 9])")', 'let d = ["a": 1]')))).toContain('9')
  })

  it('flattens joined() on nested collections instead of stringifying', () => {
    expect(texts(run(view('Text("\\([[1], [2]].joined().count)")')))).toContain('2')
  })
})

describe('rename edits the symbol and not its namesakes', () => {
  const at = (text: string, needle: string, into = 4) => {
    const files: SourceFile[] = [{ id: 'Sources/App.swift', text }]
    return referencesFor(files, 'Sources/App.swift', text.indexOf(needle) + into)
  }

  it('leaves an unrelated local of the same name alone', () => {
    // Two functions, each with its own `x`. Renaming one used to rename both, which
    // is a refactor that silently breaks code the user was not looking at.
    const found = at(
      'struct A {\n    func f() {\n        let x = 1\n        print(x)\n    }\n}\nstruct B {\n    func g() {\n        let x = 2\n        print(x)\n    }\n}\n',
      'let x',
    )
    expect(found.spans).toHaveLength(2)
  })

  it('leaves the same member name on another type alone', () => {
    const found = at('struct A { var id = 1 }\nstruct B { var id = 2 }\n', 'struct A { var id', 15)
    expect(found.spans).toHaveLength(1)
  })

  it('follows a member no other type declares', () => {
    const found = at(
      'struct Row { var title = "" }\nfunc f(_ r: Row) -> String { r.title }\n',
      'var title',
      4,
    )
    expect(found.spans).toHaveLength(2)
  })

  it('renames the $ projection with the property', () => {
    // `@State var draft` is also `$draft`. Leaving the projection behind produces a
    // file referring to a name that no longer exists - the failure rename exists to
    // prevent.
    const text =
      'struct V: View {\n    @State private var draft = ""\n    var body: some View {\n        TextField("New", text: $draft)\n    }\n}\n'
    const found = at(text, 'var draft')
    expect(found.spans).toHaveLength(2)
    expect(found.spans.some((s) => text[s.start - 1] === '$')).toBe(true)
  })
})

describe('what the preview cannot do, it says', () => {
  it('reports a modifier it does not recognise at all', () => {
    const found = warnings(run(view('Text("a").thisIsNotARealModifier(1)')))
    expect(found[0]).toContain('thisIsNotARealModifier')
  })

  it('reports a real modifier it accepts and ignores', () => {
    expect(warnings(run(view('Text("a").blendMode(.multiply)')))[0]).toContain('blendMode')
    expect(warnings(run(view('ZStack { Text("a").zIndex(5) }')))[0]).toContain('zIndex')
    expect(warnings(run(view('Text("a").containerRelativeFrame(.horizontal)')))[0]).toContain(
      'containerRelativeFrame',
    )
  })

  it('reports an argument label the modifier does not take', () => {
    expect(warnings(run(view('Text("a").frame(wdith: 10)')))[0]).toContain('wdith')
  })

  it('counts an unrecognised modifier as a discovery, so telemetry can rank it', () => {
    const found = run(view('Text("a").shimmerEffect()')).diagnostics.find(
      (d) => d.code === 'unsupported_swiftui_modifier',
    )
    expect(found?.feature).toBe('.shimmerEffect')
  })

  it('draws a placeholder for real SwiftUI it does not implement', () => {
    // `Map` rather than a view a later phase might draw: it is declined outright -
    // Apple's tiles are not redistributable - so this stays true as coverage grows.
    const result = run(view('Map()'))
    expect(errors(result)).toEqual([])
    expect((result.renderTree?.nodes ?? []).some((n) => n.placeholder?.feature === 'Map')).toBe(true)
  })

  it('does not warn about a modifier it does apply', () => {
    expect(warnings(run(view('Text("a").monospaced()')))).toEqual([])
  })

  it('renders a PreviewProvider rather than reporting a missing entry point', () => {
    // It used to report one. The older spelling names a view to show exactly as
    // `#Preview` does, and every project written before Xcode 15 still carries it -
    // so sending the user to add `@main` was sending them to fix what was not wrong.
    const result = run(
      [
        'import SwiftUI',
        'struct C: View { var body: some View { Text("c") } }',
        'struct C_Previews: PreviewProvider {',
        '    static var previews: some View { C() }',
        '}',
      ].join('\n'),
    )
    expect(errors(result)).toEqual([])
    expect(texts(result)).toContain('c')
  })
})

describe('what the preview draws is what the code says', () => {
  it('applies a format style to a number', () => {
    expect(texts(run(view('Text(1234.5, format: .currency(code: "EUR"))')))[0]).toContain('1,234.50')
    expect(texts(run(view('Text(0.25, format: .percent)')))).toContain('25%')
  })

  it('applies String(format:) rather than rendering the format', () => {
    expect(texts(run(view('Text(String(format: "%.2f", 1.5))')))).toContain('1.50')
  })

  it('repeats what String(repeating:count:) was asked to repeat', () => {
    expect(texts(run(view('Text(String(repeating: "ab", count: 3))')))).toContain('ababab')
  })

  it('answers contains(where:) and firstIndex(where:) from the predicate', () => {
    expect(texts(run(view('Text("\\([1, 2].contains { $0 > 1 })")')))).toContain('true')
    expect(texts(run(view('Text("\\([1, 2].firstIndex { $0 > 1 } ?? -1)")')))).toContain('1')
  })

  it('takes the size from a custom font', () => {
    const node = (run(view('Text("a").font(.custom("Courier", size: 40))')).renderTree?.nodes ?? []).find(
      (n) => n.text,
    )
    expect(node?.text?.runs[0]?.font.size).toBe(40)
  })

  it('leaves an untitled navigation bar untitled', () => {
    // It used to say "Home", a word that appears nowhere in the user's code.
    expect(texts(run(view('NavigationStack { Text("content") }')))).not.toContain('Home')
  })

  it('evaluates as?, as! and is', () => {
    expect(
      texts(run(view('Text(f())', 'struct S {}\nfunc f() -> String { let v: Any = S()\n return (v as? S) != nil ? "yes" : "no" }'))),
    ).toContain('yes')
    expect(texts(run(view('Text("\\(f())")', 'func f() -> Bool { let v: Any = "s"\n return v is Int }')))).toContain(
      'false',
    )
  })
})

describe('a failure is reported where the user is looking', () => {
  it('marks a failed action as an error, not as a print', () => {
    const result = tapFirstButton(app('    @State private var a = [1]\n    var body: some View { Button("go") { _ = a[9] } }'))
    expect(result.logs.some((l) => l.level === 'error')).toBe(true)
  })

  it('reports a trap in a top-level initialiser instead of losing the compile', () => {
    // These run during the load, outside the render pass, so the throw used to escape
    // `compile` entirely and surface as "the compiler worker stopped".
    const result = run(view('Text("ok")', 'let bad = [1][9]'))
    expect(errors(result)[0]).toContain('Index out of range')
  })

  it('reports a self-recursive view instead of blowing the stack', () => {
    const result = run(view('ContentView()'))
    expect(errors(result)[0]).toContain('body contains the view itself')
  })

  it('reads a file that starts with a byte-order mark', () => {
    expect(errors(run('\uFEFF' + view('Text("a")')))).toEqual([])
  })
})

describe('untrusted input does not take the studio down', () => {
  it('falls back to a real device for an unknown key', () => {
    expect(getDevice('not-a-device' as never).key).toBe('iphone-15')
  })

  it('survives a share link naming a device this build does not have', () => {
    const project: Project = {
      id: 'p',
      manifest: {
        name: 'MyApp',
        bundleId: 'com.example.MyApp',
        deploymentTarget: '17.0',
        device: 'nope' as never,
        colorScheme: 'light',
      },
      files: [{ id: 'Sources/A.swift', text: 'import SwiftUI\n' }],
      createdAt: 0,
      updatedAt: 0,
    }
    const decoded = decodeProject(encodeProject(project)!, 1)
    expect(getDevice(decoded!.manifest.device).width).toBeGreaterThan(0)
  })
})

describe('none of it fires on ordinary SwiftUI', () => {
  const clean = (source: string) => {
    const result = run(source)
    expect([...errors(result), ...warnings(result)]).toEqual([])
  }

  it('says nothing about a plain modifier chain', () => {
    clean(view('Text("a").padding().font(.title).foregroundStyle(.red).frame(maxWidth: .infinity)'))
  })

  it('says nothing about a modifier the project declared itself', () => {
    clean(view('Text("a").card()', 'extension View { func card() -> some View { padding() } }'))
  })

  it('says nothing about a gesture builder chain', () => {
    clean(view('Text("a").gesture(DragGesture().onChanged { _ in }.onEnded { _ in })'))
  })

  it('says nothing about the project’s own views and methods', () => {
    clean(app('    var body: some View { VStack { Row(item: 1) } }', 'struct Row: View { let item: Int\n var body: some View { Text("\\(item)").bold() } }'))
    clean(
      app(
        '    @StateObject private var s = Store()\n    var body: some View { Button("x") { s.bump() } }',
        'class Store: ObservableObject { @Published var n = 0\n func bump() { n += 1 } }',
      ),
    )
  })

  it('says nothing about a colour or shape chain', () => {
    clean(view('Rectangle().fill(Color.red.opacity(0.5)).frame(width: 10, height: 10)'))
  })
})
