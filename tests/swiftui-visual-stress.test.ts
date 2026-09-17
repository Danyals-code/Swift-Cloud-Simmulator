import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { CompileResult, DynamicTypeSize } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES, type DeviceKey } from '@studio/sim-shell'
import { visualCases } from './fixtures/swiftui-visual-cases'
import { stressApp as app } from './fixtures/swiftui-stress-cases'

let revision = 0
const configurations: [DeviceKey, 'light' | 'dark', DynamicTypeSize][] = [
  ['iphone-se-3', 'light', 'large'], ['iphone-18-pro', 'light', 'large'],
  ['iphone-18-pro', 'dark', 'large'], ['ipad-11', 'light', 'large'],
  ['ipad-11', 'dark', 'large'], ['iphone-18-pro', 'light', 'accessibility3'],
]
function run(source: string, configuration = configurations[1]!) {
  resetPipelineState()
  const [deviceKey, colorScheme, dynamicTypeSize] = configuration, device = DEVICES[deviceKey]
  return compile({ files: [{ id: 'VisualStress.swift', text: source }], canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme, dynamicTypeSize, revision: ++revision })
}
const text = (r: CompileResult) => r.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []) ?? []
const nodes = (r: CompileResult) => r.renderTree?.nodes ?? []
const problems = (r: CompileResult) => r.diagnostics.map(d => d.message).join('\n')
function tap(r: CompileResult, label: string) {
  const target = nodes(r).find(n => n.hitTarget?.enabled && n.a11y?.label === label)
  expect(target, `Missing ${label}: ${problems(r)}`).toBeDefined()
  applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(++revision)
}

describe.each(configurations)('visual checklist: %s / %s / %s', (device, scheme, size) => {
  it.each(visualCases)('$name', ({ name, source, text: expectedText, gap }) => {
    const result = run(source, [device, scheme, size])
    for (const node of nodes(result)) {
      expect(Object.values(node.frame).every(Number.isFinite), `${name}: ${node.id}`).toBe(true)
      expect(node.frame.width).toBeGreaterThanOrEqual(0)
      expect(node.frame.height).toBeGreaterThanOrEqual(0)
    }
    if (gap) expect(problems(result)).toContain(gap)
    else expect(result.diagnostics).toEqual([])
    if (expectedText) expect(text(result), problems(result)).toContain(expectedText)
    if (name.startsWith('gauge-')) expect(nodes(result).some(n => n.shape?.shape === 'spinner')).toBe(false)
    if (name === 'alert-fields') expect(nodes(result).filter(n => n.hitTarget?.role === 'textField')).toHaveLength(2)
    if (name.startsWith('toolbar-')) expect(text(result)).not.toContain('Extra')
  })
})

describe('presentation and control regressions', () => {
  it('renders and edits fields in an alert, then dismisses with an action', () => {
    let result = run(app('VStack { Text("Name: \\(name)"); Button("Open") { shown = true } }.alert("Rename", isPresented: $shown) { TextField("Name", text: $name); Button("Save") {} }', '@State var name = "Taylor"; @State var shown = true'))
    const field = nodes(result).find(n => n.hitTarget?.role === 'textField')!
    expect(field.hitTarget!.value).toBe('Taylor')
    applyEvent({ kind: 'textChange', handlerId: field.hitTarget!.handlerId, value: 'Sam' })
    result = rerender(++revision)
    expect(nodes(result).find(n => n.hitTarget?.role === 'textField')!.hitTarget!.value).toBe('Sam')
    expect(nodes(result).find(n => n.id === 'overlay-dim')?.hitTarget).toBeUndefined()
    result = tap(result, 'Save')
    expect(text(result)).toContain('Name: Sam')
    expect(nodes(result).some(n => n.id === 'overlay-dim')).toBe(false)
  })
  it('supplies a dismissible OK action when an alert has no buttons', () => {
    let r = run(app('Text("Base").alert("Notice", isPresented: $shown) {}', '@State var shown = true'))
    expect(text(r)).toContain('OK')
    r = tap(r, 'OK')
    expect(nodes(r).some(n => n.id === 'overlay-dim')).toBe(false)
  })
  it.each(['.yellow', '.clear', '.thinMaterial'])('applies presentationBackground(%s)', style => {
    const result = run(app(`Text("Base").sheet(isPresented: $shown) { Text("Sheet").presentationBackground(${style}) }`, '@State var shown = true'))
    expect(result.diagnostics).toEqual([])
    const surface = nodes(result).find(n => n.id === 'overlay-surface')!
    if (style === '.thinMaterial') expect(surface.material?.blur).toBeGreaterThan(0)
    else {
      expect(surface.material).toBeUndefined()
      expect(surface.background?.kind).toBe('solid')
      if (surface.background?.kind === 'solid') expect(surface.background.color.a).toBe(style === '.clear' ? 0 : 1)
    }
  })
  it.each(['.height(200)', '.fraction(0.3)', '.medium', '.large'])('keeps %s inside safe bounds', detent => {
    const r = run(app(`Text("Base").sheet(isPresented: $shown) { Text("Sheet").presentationDetents([${detent}]).presentationCornerRadius(28).presentationDragIndicator(.hidden) }`, '@State var shown = true'))
    const surface = nodes(r).find(n => n.id === 'overlay-surface')!
    expect(surface.cornerRadius).toBe(28)
    expect(surface.frame.y).toBeGreaterThanOrEqual(0)
    expect(surface.frame.y + surface.frame.height).toBeLessThanOrEqual(874)
    expect(nodes(r).some(n => n.id === 'overlay-grabber')).toBe(false)
    if (detent === '.height(200)') expect(surface.frame.height).toBe(226)
  })
  it('keeps automatic grabbers for resizable sheets', () => {
    const single = app('Text("Base").sheet(isPresented: $shown) { Text("Sheet").presentationDetents([.medium]) }', '@State var shown = true')
    expect(nodes(run(single)).some(n => n.id === 'overlay-grabber')).toBe(false)
    expect(nodes(run(single.replace('[.medium]', '[.medium, .large]'))).some(n => n.id === 'overlay-grabber')).toBe(true)
  })
  it('honors interactiveDismissDisabled() and its false override', () => {
    const source = app('Text("Base").sheet(isPresented: $shown) { Text("Locked").interactiveDismissDisabled() }', '@State var shown = true')
    expect(nodes(run(source)).find(n => n.id === 'overlay-dim')?.hitTarget).toBeUndefined()
    expect(nodes(run(source.replace('.interactiveDismissDisabled()', '.interactiveDismissDisabled(false)'))).find(n => n.id === 'overlay-dim')?.hitTarget).toBeDefined()
  })
  it('shows a menu picker’s option label instead of its numeric tag', () => {
    let result = run(app('Picker("Range", selection: $choice) { Text("Day").tag(0); Text("Week").tag(1) }.pickerStyle(.menu)', '@State var choice = 0'))
    expect(text(result)).toContain('Day')
    expect(text(result)).not.toContain('0')
    result = tap(result, 'Range')
    result = tap(result, 'Week')
    expect(text(result)).toContain('Week')
    expect(text(result)).not.toContain('1')
  })
  it('warns when a sheet asks for an unsupported custom background view', () => {
    const result = run(app('Text("Base").sheet(isPresented: $shown) { Text("Sheet").presentationBackground { Text("Decoration") } }', '@State var shown = true'))
    expect(problems(result)).toContain('custom view backgrounds')
  })
  it('changes a circular gauge’s arc when its binding changes', () => {
    let r = run(app('VStack { Gauge(value: amount) { Text("Used") }.gaugeStyle(.accessoryCircularCapacity); Button("Fill") { amount = 1 } }', '@State var amount = 0.25'))
    const arc = nodes(r).find(n => n.id.endsWith('-fill') && n.path)!.path!.d
    r = tap(r, 'Fill')
    expect(nodes(r).find(n => n.id.endsWith('-fill') && n.path)!.path!.d).not.toBe(arc)
    expect(nodes(r).some(n => n.shape?.shape === 'spinner')).toBe(false)
  })
  it('preserves gauge labels and uses a distinct value marker for accessoryCircular', () => {
    const r = run(app('Gauge(value: 0.7) { Text("Used") } currentValueLabel: { Text("70%") } minimumValueLabel: { Text("Empty") } maximumValueLabel: { Text("Full") }'))
    expect(r.diagnostics).toEqual([])
    expect(text(r)).toEqual(expect.arrayContaining(['Used', '70%', 'Empty', 'Full']))
    const circular = run(app('Gauge(value: 0.7) { Text("Used") }.gaugeStyle(.accessoryCircular)'))
    expect(nodes(circular).some(n => n.id.endsWith('-marker'))).toBe(true)
  })
  it('keeps a bound DisclosureGroup chevron consistent with its content', () => {
    let r = run(app('DisclosureGroup("More", isExpanded: $expanded) { Text("Inside") }', '@State var expanded = true'))
    expect(nodes(r).some(n => n.image?.symbol === 'chevron.down')).toBe(true)
    expect(text(r)).toContain('Inside')
    r = tap(r, 'More')
    expect(nodes(r).some(n => n.image?.symbol === 'chevron.right')).toBe(true)
    expect(text(r)).not.toContain('Inside')
  })
  it('keeps the Xcode fixture usable across all three tabs', () => {
    const source = readFileSync(new URL('./fixtures/ios27-visual-stress.swift', import.meta.url), 'utf8')
    let r = run(source)
    expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(text(r)).toContain('Storage')
    r = tap(r, 'Present')
    r = tap(r, '200 point sheet')
    expect(text(r)).toContain('Fixed height')
    r = tap(r, 'Done')
    r = tap(r, 'Alert with text field')
    expect(nodes(r).some(n => n.hitTarget?.role === 'textField')).toBe(true)
    r = tap(r, 'Cancel')
    r = tap(r, 'Lists')
    expect(text(r)).toContain('Expanded content')
  })
})
