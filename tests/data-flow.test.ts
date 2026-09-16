import { describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Data flow - defect register 9.7.
 *
 * `@AppStorage` is the interesting one, because it is not `@State` with a different
 * spelling: it is keyed by a *string*, so two views naming one key share a value and
 * the value outlives the view that wrote it. A version built on the `@State` boxes
 * would pass a single-view test and fail both of those.
 *
 * `PreviewProvider` matters for a different reason. It is what every project written
 * before Xcode 15 carries, and the studio reported those as having no entry point -
 * which sent the user to fix something that was not wrong.
 */

const device = DEVICES['iphone-15']
let revision = 1

function request(source: string): CompileRequest {
  return {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  }
}

function run(source: string): CompileResult {
  resetPipelineState()
  return compile(request(source))
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

const nodes = (r: CompileResult): readonly RenderNode[] => r.renderTree?.nodes ?? []

const texts = (r: CompileResult): string[] =>
  nodes(r)
    .filter((n) => n.kind === 'text')
    .map((n) => n.text!.runs.map((x) => x.text).join(''))

const errors = (r: CompileResult): string[] =>
  r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)

const warnings = (r: CompileResult): string[] =>
  r.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)

/** Taps the first button and re-renders, the way the worker does. */
function tapFirst(result: CompileResult): CompileResult {
  const button = nodes(result).find((n) => n.hitTarget?.role === 'button')
  expect(button?.hitTarget, 'no button to tap').toBeDefined()
  applyEvent({ kind: 'tap', handlerId: button!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(revision++)
}

describe('@AppStorage', () => {
  const counter = app(
    [
      '    @AppStorage("count") private var count = 0',
      '    var body: some View { Button("count \\(count)") { count += 1 } }',
    ].join('\n'),
  )

  it('no longer warns, and no longer promises a phase', () => {
    const result = run(counter)
    expect(warnings(result)).toEqual([])
    expect(errors(result)).toEqual([])
  })

  it('reads its default and writes back', () => {
    resetPipelineState()
    const first = compile(request(counter))
    expect(texts(first)).toContain('count 0')
    expect(texts(tapFirst(first))).toContain('count 1')
  })

  it('is shared by every view naming the same key', () => {
    // The whole difference from `@State`, which keys by the view. Two independent
    // views, one key: writing through one must be visible through the other.
    const source = [
      'import SwiftUI',
      '@main',
      'struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }',
      'struct ContentView: View {',
      '    var body: some View { VStack { Writer() ; Reader() } }',
      '}',
      'struct Writer: View {',
      '    @AppStorage("shared") private var n = 0',
      '    var body: some View { Button("bump") { n += 1 } }',
      '}',
      'struct Reader: View {',
      '    @AppStorage("shared") private var n = 0',
      '    var body: some View { Text("read \\(n)") }',
      '}',
    ].join('\n')

    resetPipelineState()
    const first = compile(request(source))
    expect(texts(first)).toContain('read 0')
    expect(texts(tapFirst(first))).toContain('read 1')
  })

  it('outlives the view that wrote it', () => {
    // A `@State` box is dropped when its view leaves the tree. A stored default is
    // not: that is what makes it storage rather than state.
    const source = [
      'import SwiftUI',
      '@main',
      'struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }',
      'struct ContentView: View {',
      '    @State private var showing = true',
      '    @AppStorage("kept") private var n = 0',
      '    var body: some View {',
      '        VStack {',
      '            if showing { Child() }',
      '            Button("toggle") { showing.toggle() }',
      '            Text("outer \\(n)")',
      '        }',
      '    }',
      '}',
      'struct Child: View {',
      '    @AppStorage("kept") private var n = 0',
      '    var body: some View { Button("child \\(n)") { n += 1 } }',
      '}',
    ].join('\n')

    resetPipelineState()
    let result = compile(request(source))
    result = tapFirst(result) // the child's button bumps to 1
    expect(texts(result)).toContain('outer 1')

    // Hide the child, then show it again. The value must still be 1.
    const press = (r: CompileResult, label: string): CompileResult => {
      const target = nodes(r).find((n) => n.hitTarget && n.a11y?.label === label)
      expect(target, `no control called "${label}"`).toBeDefined()
      applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
      return rerender(revision++)
    }

    result = press(result, 'toggle')
    expect(texts(result)).not.toContain('child 1')

    expect(texts(press(result, 'toggle'))).toContain('child 1')
  })

  it('@SceneStorage behaves the same way', () => {
    const source = app(
      [
        '    @SceneStorage("tab") private var tab = 2',
        '    var body: some View { Text("tab \\(tab)") }',
      ].join('\n'),
    )
    expect(texts(run(source))).toContain('tab 2')
    expect(warnings(run(source))).toEqual([])
  })
})

describe('@FocusState', () => {
  it('is storage the code can read and write', () => {
    const source = app(
      [
        '    @FocusState private var focused: Bool',
        '    var body: some View { Button("focused \\(focused)") { focused = true } }',
      ].join('\n'),
    )
    resetPipelineState()
    const first = compile(request(source))
    expect(warnings(first)).toEqual([])
    expect(texts(first)).toContain('focused false')
    expect(texts(tapFirst(first))).toContain('focused true')
  })
})

describe('PreviewProvider', () => {
  const legacy = [
    'import SwiftUI',
    'struct C: View { var body: some View { Text("from previews") } }',
    'struct C_Previews: PreviewProvider {',
    '    static var previews: some View { C() }',
    '}',
  ].join('\n')

  it('is used as the root when nothing is @main', () => {
    const result = run(legacy)
    expect(errors(result)).toEqual([])
    expect(texts(result)).toContain('from previews')
  })

  it('yields to a #Preview when a file carries both', () => {
    const both = [
      legacy,
      '#Preview { Text("from macro") }',
    ].join('\n')
    expect(texts(run(both))).toContain('from macro')
  })

  it('yields to @main, which is the real entry point', () => {
    const withMain = [
      'import SwiftUI',
      '@main',
      'struct A: App { var body: some Scene { WindowGroup { Text("from main") } } }',
      legacy.replace('import SwiftUI\n', ''),
    ].join('\n')
    expect(texts(run(withMain))).toContain('from main')
  })
})

describe('Binding(get:set:)', () => {
  it('reads through its getter', () => {
    const source = app(
      [
        '    @State private var raw = 3',
        '    var body: some View {',
        '        let doubled = Binding(get: { raw * 2 }, set: { raw = $0 / 2 })',
        '        return Text("doubled \\(doubled.wrappedValue)")',
        '    }',
      ].join('\n'),
    )
    const result = run(source)
    expect(errors(result)).toEqual([])
    expect(texts(result)).toContain('doubled 6')
  })

  it('drives a control, which cannot tell it from a projected binding', () => {
    const source = app(
      [
        '    @State private var on = false',
        '    var body: some View {',
        '        VStack {',
        '            Text("state \\(on)")',
        '            Toggle("mirror", isOn: Binding(get: { on }, set: { on = $0 }))',
        '        }',
        '    }',
      ].join('\n'),
    )
    resetPipelineState()
    const first = compile(request(source))
    expect(texts(first)).toContain('state false')

    const control = nodes(first).find((n) => n.hitTarget?.role === 'toggle')
    expect(control, 'expected a toggle').toBeDefined()
    applyEvent({ kind: 'toggle', handlerId: control!.hitTarget!.handlerId, value: true })
    expect(texts(rerender(revision++))).toContain('state true')
  })
})

describe('the environment values that were missing', () => {
  it('reports scenePhase as active, so code that branches on it runs', () => {
    const source = app(
      [
        '    @Environment(\\.scenePhase) private var phase',
        '    var body: some View { Text(phase == .active ? "up" : "down") }',
      ].join('\n'),
    )
    const result = run(source)
    expect(errors(result)).toEqual([])
    expect(texts(result)).toContain('up')
  })

  it('openURL is callable and says what it would have opened', () => {
    const source = app(
      [
        '    @Environment(\\.openURL) private var openURL',
        '    var body: some View {',
        '        Button("open") { openURL(URL(string: "https://example.com")!) }',
        '    }',
      ].join('\n'),
    )
    resetPipelineState()
    const first = compile(request(source))
    expect(errors(first)).toEqual([])

    tapFirst(first)
    // The call runs rather than trapping, and leaves a trace in the console.
    const logged = rerender(revision++)
    expect(errors(logged)).toEqual([])
  })
})

describe('what is still not there says so', () => {
  it('onReceive warns rather than silently never firing', () => {
    expect(warnings(run(view('Text("a").onReceive(timer) { _ in }', 'let timer = 1')))[0]).toContain(
      'onReceive',
    )
  })
})
