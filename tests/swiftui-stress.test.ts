import { describe, expect, it } from 'vitest'
import type { CompileResult } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import { stressApp as app, stressCases } from './fixtures/swiftui-stress-cases'

const device = DEVICES['iphone-15']
let revision = 0
function run(source: string, dark = false): CompileResult {
  resetPipelineState()
  return compile({ files: [{ id: 'Sources/Stress.swift', text: source }], canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: dark ? 'dark' : 'light', revision: ++revision })
}
const texts = (r: CompileResult) => r.renderTree?.nodes.flatMap(n => n.text?.runs.map(run => run.text) ?? []) ?? []
const messages = (r: CompileResult) => r.diagnostics.map(d => d.message).join('\n')
const errors = (r: CompileResult) => r.diagnostics.filter(d => d.severity === 'error')
function finiteScreen(r: CompileResult) {
  for (const node of r.renderTree?.nodes ?? []) {
    expect(Object.values(node.frame).every(Number.isFinite), node.id).toBe(true)
    expect(node.frame.width, node.id).toBeGreaterThanOrEqual(0)
    expect(node.frame.height, node.id).toBeGreaterThanOrEqual(0)
  }
}
function tap(r: CompileResult, label: string) {
  const node = r.renderTree?.nodes.find(n => n.hitTarget && n.a11y?.label === label)
  expect(node?.hitTarget, `Missing control ${label}`).toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: node!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  const next = rerender(++revision)
  expect(next.logs.filter(log => log.level === 'error')).toEqual([])
  return next
}

// Known gaps must identify the unsupported feature. These are not compatibility passes.
const gaps: Record<string, string> = {
  'binding-list': "Cannot find 'item'", 'binding-foreach': "Cannot find 'item'",
  'state-initializer': "Cannot find '_count'", 'bindable-child': 'Bindable',
  'value-textfield': 'value/format/formatter', 'multiline-textfield': 'axis-based multiline',
  'navigation-path': 'bound navigation paths', 'navigation-boolean': 'binding-driven destinations',
  'grid-cell-span': 'gridCellColumns', 'safe-area-padding': 'safeAreaPadding',
  'preferred-scheme': 'preferredColorScheme', 'symbol-effects': 'symbolEffect',
  'scroll-reader': 'ScrollViewReader', 'custom-environment': '@Environment(featureEnabled)',
  'dateformatter': 'DateFormatter', 'calendar': 'Calendar', 'timeline-context': 'timeline runs only once',
  'async-phase': 'remote loading and image phases', 'map-placeholder': 'Map',
  'chart-placeholder': 'Chart', 'uneven-shape': 'UnevenRoundedRectangle',
}
const rejected: Record<string, string> = {
  'negative-array': "Can't construct Array", 'negative-string': "Can't construct String",
  'non-finite-frame': 'Invalid frame width', 'recursive-function': 'Call depth exceeded',
  'infinite-loop': 'Execution took too long', 'nested-recursive-view': 'View nesting',
  'large-foreach': '1,000 elements',
}
const visible: Record<string, string[]> = {
  'basic-layout': ['Hello', 'World'], 'conditional-content': ['Disabled'],
  'optional-binding': ['Present'], 'enum-picker': ['Saved'],
  'generic-view-builder': ['Inside'], 'stored-view-builder': ['Inside'],
  'custom-modifier': ['Card'], 'sheet-item': ['Selected'], 'modern-tab': ['Saved content'],
  'background-in-shape': ['Card'], 'overlay-builder': ['Base', 'Badge'],
  'bold-false': ['Normal'], 'italic-false': ['Normal'],
  'line-limit-range': ['Long enough to wrap over many lines'], 'viewthatfits': ['Short'],
}

describe.each([false, true])('independent SwiftUI corpus (dark: %s)', dark => {
  it.each(stressCases)('%s', (name, source, action) => {
    let result = run(source, dark)
    finiteScreen(result)
    const issue = gaps[name] ?? rejected[name]
    if (issue) {
      expect(messages(result)).toContain(issue)
      if (rejected[name]) expect(errors(result).length).toBeGreaterThan(0)
      return
    }
    expect(result.diagnostics).toEqual([])
    if (action) result = tap(result, action)
    finiteScreen(result)
    for (const text of visible[name] ?? []) expect(texts(result)).toContain(text)
    if (name === 'onchange-two-args') expect(texts(result)).toContain('0 -> 1')
    if (name === 'custom-binding') {
      const target = result.renderTree!.nodes.find(n => n.hitTarget?.role === 'toggle')!
      expect(target.hitTarget!.value).toBe('off')
      const next = tap(result, 'Flag')
      expect(next.renderTree!.nodes.find(n => n.hitTarget?.role === 'toggle')!.hitTarget!.value).toBe('on')
    }
    if (name === 'observable-bindable' || name === 'texteditor' || name === 'securefield') {
      const input = result.renderTree!.nodes.find(n => n.hitTarget?.role === 'textField')!
      expect(input.hitTarget!.value).toBe(name === 'texteditor' ? 'Two\nlines' : name === 'securefield' ? 'secret' : 'Taylor')
      if (name === 'texteditor') expect(input.hitTarget!.multiline).toBe(true)
      if (name === 'securefield') expect(input.hitTarget!.secure).toBe(true)
      applyEvent({ kind: 'textChange', handlerId: input.hitTarget!.handlerId, value: 'Edited\nagain' })
      expect(rerender(++revision).renderTree!.nodes.find(n => n.hitTarget?.role === 'textField')!.hitTarget!.value).toBe('Edited\nagain')
    }
    if (name === 'bold-false' || name === 'italic-false') {
      const font = result.renderTree!.nodes.find(n => n.text)!.text!.runs[0]!.font
      expect(font.weight).toBe(400)
      expect(font.italic).toBe(false)
    }
  })
})

describe('resource limits and recovery', () => {
  const oversized = [
    'Text("\\(Array(repeating: 1, count: 100001).count)")',
    'Text("\\(Array(0..<1000000000).count)")',
    'Text(String(repeating: "xx", count: 1000000))',
    'Text("\\(Array(repeating: Array(repeating: 0, count: 10000), count: 10000).count)")',
    'ForEach(Array(repeating: 1, count: 1001), id: \\.self) { Text("\\($0)") }',
  ]
  it.each(oversized)('rejects allocation before creating it: %s', body => {
    const result = run(app(body))
    expect(errors(result).length).toBeGreaterThan(0)
    expect(messages(result)).toMatch(/preview (limit|memory)|limited to/)
    finiteScreen(result)
    expect(texts(run(app('Text("Recovered")')))).toContain('Recovered')
  })
  it('renders all rows at the documented collection boundary', () => {
    const result = run(app('ScrollView { LazyVStack { ForEach(0..<1000) { Text("Row \\($0)") } } }'))
    expect(errors(result)).toEqual([])
    expect(texts(result).filter(t => t.startsWith('Row '))).toHaveLength(1000)
    expect(texts(result)).toContain('Row 999')
  })
  it.each(['width: -1', 'height: .infinity', 'minWidth: -2'])('rejects invalid fixed frame: %s', frame => {
    const result = run(app(`Text("Bad").frame(${frame})`))
    expect(messages(result)).toContain('Invalid frame')
    finiteScreen(result)
  })
  it('still allows flexible infinity', () => {
    const result = run(app('Text("Flexible").frame(maxWidth: .infinity, maxHeight: .infinity)'))
    expect(result.diagnostics).toEqual([])
    finiteScreen(result)
    expect(texts(result)).toContain('Flexible')
  })
})

describe('modifier behavior', () => {
  it.each(['background', 'overlay'])('draws and operates a %s builder', modifier => {
    let result = run(app(`Text("Count: \\(count)").frame(width: 200, height: 100).${modifier}(alignment: .topTrailing) { Button("Add") { count += 1 } }`, '@State var count = 0'))
    expect(result.diagnostics).toEqual([])
    result = tap(result, 'Add')
    expect(texts(result)).toContain('Count: 1')
  })
  it('keeps a shape background clipped', () => {
    const result = run(app('Text("Card").padding().background(.blue, in: RoundedRectangle(cornerRadius: 12))'))
    expect(result.diagnostics).toEqual([])
    expect(result.renderTree!.nodes.some(n => n.clip && n.cornerRadius === 12)).toBe(true)
  })
  it('runs independent onChange callbacks with their own previous values', () => {
    let result = run(app('VStack { Button("Go") { a += 1; b += 2 }; Text(first); Text(second) }.onChange(of: a) { old, new in first = "a: \\(old) -> \\(new)" }.onChange(of: b) { old, new in second = "b: \\(old) -> \\(new)" }', '@State var a = 0; @State var b = 10; @State var first = "Waiting"; @State var second = "Waiting"'))
    result = tap(result, 'Go')
    expect(texts(result)).toContain('a: 0 -> 1')
    expect(texts(result)).toContain('b: 10 -> 12')
    result = tap(result, 'Go')
    expect(texts(result)).toContain('a: 1 -> 2')
    expect(texts(result)).toContain('b: 12 -> 14')
  })
  it('supports the initial callback and runs it just once', () => {
    const result = run(app('Text(message).onChange(of: count, initial: true) { old, new in calls += 1; message = "\\(old) -> \\(new), calls \\(calls)" }', '@State var count = 4; @State var calls = 0; @State var message = "Waiting"'))
    expect(errors(result)).toEqual([])
    expect(texts(result)).toContain('4 -> 4, calls 1')
    expect(texts(rerender(++revision))).toContain('4 -> 4, calls 1')
  })
  it('does not warn about project types with framework names', () => {
    const result = run(app('NavigationStack(path: "a")', '', 'struct NavigationStack: View { let path: String; var body: some View { Text(path) } }'))
    expect(result.diagnostics).toEqual([])
    expect(texts(result)).toContain('a')
  })
})

describe('incomplete generated code', () => {
  const valid = app('VStack { Text("Hello"); Button("Tap") {} }')
  it.each([1, 12, 31, 55, 80, 105, 135, 170, 190])('recovers after source truncated at %i characters', length => {
    const result = run(valid.slice(0, length))
    finiteScreen(result)
    expect(texts(run(valid))).toContain('Hello')
  })
})

describe('combined screens and late failures', () => {
  it('keeps a bound editor, navigation, and an alert working together', () => {
    let result = run(app(`NavigationStack {
      VStack {
        TextEditor(text: $notes).frame(height: 120)
        NavigationLink("Read") {
          VStack {
            Text(notes)
            Button("Save") { saved = true }
          }.navigationTitle("Entry")
          .alert("Saved", isPresented: $saved) { Button("OK", role: .cancel) {} }
        }
      }.navigationTitle("Journal")
    }`, '@State var notes = "Draft"; @State var saved = false'))
    const editor = result.renderTree!.nodes.find(n => n.hitTarget?.multiline)!
    applyEvent({ kind: 'textChange', handlerId: editor.hitTarget!.handlerId, value: 'First line\nSecond line' })
    result = tap(rerender(++revision), 'Read')
    expect(texts(result)).toContain('First line\nSecond line')
    result = tap(result, 'Save')
    expect(texts(result)).toContain('Saved')
    result = tap(result, 'OK')
    expect(texts(result)).not.toContain('Saved')
    finiteScreen(result)
  })
  it('reports a failing screen produced by onAppear', () => {
    const result = run(app('Group { if ready { Text("Invalid").frame(width: -1) } else { Text("Loading") } }.onAppear { ready = true }', '@State var ready = false'))
    expect(messages(result)).toContain('Invalid frame width')
    expect(texts(result)).not.toContain('Loading')
  })
  it('bounds nested collections across the whole view pass', () => {
    const result = run(app('VStack { ForEach(0..<100) { outer in HStack { ForEach(0..<100) { inner in Text("\\(outer):\\(inner)") } } } }'))
    expect(messages(result)).toContain('10,000 constructed views')
    finiteScreen(result)
    expect(texts(run(app('badge', '', 'let badge = Text("Recovered")')))).toContain('Recovered')
  })
  it('bounds strings that grow through concatenation', () => {
    const result = run(app('Text(grow())', '', 'func grow() -> String { var text = "x"; for _ in 0..<30 { text = text + text }; return text }'))
    expect(messages(result)).toContain('String length exceeds the preview limit')
  })
})
