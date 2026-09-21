import { surfaceRadius } from './render-geometry'
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { CompileResult, RenderNode, RenderTree } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import { stressApp } from './fixtures/swiftui-stress-cases'

const reference = new URL('../docs/parity/native/iphone18pro-controls/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('measurements.json', reference), 'utf8'))
const source = readFileSync(new URL('./fixtures/ios27-visual-stress.swift', import.meta.url), 'utf8')
let revision = 0
function run(code = source, scheme: 'light' | 'dark' = 'light') {
  resetPipelineState()
  const device = DEVICES['iphone-18-pro']
  return compile({ files: [{ id: 'App.swift', text: code }], canvas: device, safeArea: device.safeArea, displayScale: 3, colorScheme: scheme, revision: ++revision })
}
function world(tree: RenderTree, n: RenderNode) {
  let x = n.frame.x, y = n.frame.y, parent = n.parent
  while (parent) { const p = tree.nodes.find(n => n.id === parent)!; x += p.frame.x; y += p.frame.y; parent = p.parent }
  return { ...n.frame, x, y }
}
const nodes = (r: CompileResult) => r.renderTree!.nodes
const texts = (r: CompileResult) => nodes(r).flatMap(n => n.text?.runs.map(r => r.text) ?? [])
const label = (r: CompileResult, s: string) => nodes(r).find(n => n.text?.runs.some(v => v.text === s))!
function tap(r: CompileResult, name: string) {
  const n = nodes(r).find(n => n.hitTarget?.enabled && n.a11y?.label === name)!
  expect(n, name).toBeDefined()
  applyEvent({ kind: 'tap', handlerId: n.hitTarget!.handlerId, location: { x: 1, y: 1 } })
  return rerender(++revision)
}
const near = (value: number, expected: number, tolerance = 2) => expect(Math.abs(value - expected)).toBeLessThanOrEqual(tolerance)

describe('native iPhone control references', () => {
  it('preserves original screenshots and fixture provenance', () => {
    expect(createHash('sha256').update(source).digest('hex')).toBe(manifest.fixtureSha256)
    for (const capture of manifest.captures) {
      const png = readFileSync(new URL(capture.file, reference))
      expect(createHash('sha256').update(png).digest('hex')).toBe(capture.sha256)
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1206, 2622])
    }
  })
  it.each(['light', 'dark'] as const)('matches native control shapes and colors in %s', scheme => {
    const r = run(source, scheme), m = manifest.measured
    expect(r.diagnostics).toEqual([])
    const slider = nodes(r).find(n => n.slider)!.slider!
    expect([slider.thumbDiameter, slider.thumbHeight, slider.trackHeight]).toEqual([m.sliderThumbWidth, m.sliderThumbHeight, m.sliderTrackHeight])
    expect([slider.tint.r, slider.tint.g, slider.tint.b]).toEqual(m[`${scheme}Blue`])
    const track = nodes(r).find(n => n.id.endsWith('segtrackf'))!
    expect(surfaceRadius(nodes(r), track)).toBeGreaterThanOrEqual(16)
    expect(track.frame.height).toBe(m.segmentHeight)
    const selected = nodes(r).find(n => n.id.endsWith('seg0bgf'))!
    if (scheme === 'dark') expect(selected.background).toEqual({ kind: 'solid', color: { r: 105, g: 105, b: 111, a: 1 } })
    const firstCard = nodes(r).find(n => n.id.endsWith('s0bgf'))!
    const frame = world(r.renderTree!, firstCard)
    near(frame.y, m.controlsCardTop)
    near(frame.y + frame.height, m.controlsCardBottom, 3)
    const bordered = nodes(r).find(n => n.id.endsWith('btnf'))!
    near(bordered.frame.height, m.buttonHeight)
    expect(surfaceRadius(nodes(r), bordered)).toBeGreaterThanOrEqual(m.buttonHeight / 2)
    const rings = nodes(r).filter(n => n.path && n.id.endsWith('-track'))
    expect(rings).toHaveLength(2)
    expect(rings.every(n => n.frame.width === m.gaugeDiameter && n.path!.stroke?.width === m.gaugeStroke)).toBe(true)
    const gaugeTrack = nodes(r).find(n => n.id.endsWith('-trackf'))!
    expect(gaugeTrack.frame.height).toBe(m.linearGaugeHeight)
    expect(gaugeTrack.frame.width).toBe(338)
    expect(label(r, 'Downloading').text!.runs[0]!.font.size).toBe(17)
    expect(nodes(r).find(n => n.id === 'tab-2-badge-text')?.text?.runs[0]?.text).toBe('3')
    if (process.env.WRITE_CONTROL_REPORT) writeFileSync(`${process.env.WRITE_CONTROL_REPORT}-${scheme}.json`, JSON.stringify(nodes(r).map(n => ({ id: n.id, frame: world(r.renderTree!, n), text: n.text?.runs.map(v => v.text).join(''), background: n.background })), null, 2))
  })
  it('renders expanded disclosure content as an indented, separately sized list row', () => {
    let r = tap(run(), 'Lists')
    const before = world(r.renderTree!, label(r, 'Details')).y
    expect(world(r.renderTree!, label(r, 'Expanded content')).x).toBe(52)
    near(world(r.renderTree!, label(r, 'Expanded content')).y - world(r.renderTree!, label(r, 'More')).y, 52)
    r = tap(r, 'More')
    expect(texts(r)).not.toContain('Expanded content')
    near(before - world(r.renderTree!, label(r, 'Details')).y, 52)
    r = tap(r, 'Details')
    expect(nodes(r).some(n => n.id === 'navbar-large-title' && n.text?.runs[0]?.font.size === 34)).toBe(true)
  })
  it('keeps GroupBox title inside its panel with centered content', () => {
    const r = tap(run(), 'Lists')
    const title = world(r.renderTree!, label(r, 'Summary')), body = world(r.renderTree!, label(r, 'A grouped card'))
    expect(title.x).toBe(48)
    near(body.x + body.width / 2, 201)
    near(body.y - title.y, 22)
  })
  it('uses capsule alert inputs, floating dialog choices, and the floating sheet safe area', () => {
    let r = tap(tap(run(), 'Present'), 'Alert with text field')
    const field = nodes(r).find(n => n.hitTarget?.role === 'textField')!
    expect(field.frame.height).toBe(48)
    expect(field.hitTarget?.inputInset).toBe(16)
    r = tap(r, 'Cancel')
    r = tap(r, 'Choices')
    expect(nodes(r).find(n => n.id === 'overlay-menu')!.frame.width).toBe(240)
    expect(nodes(r).find(n => n.id === 'overlay-dim')!.background).toEqual({ kind: 'solid', color: { r: 0, g: 0, b: 0, a: 0 } })
    expect(texts(r)).not.toContain('Cancel')
    r = tap(r, 'Archive')
    r = tap(r, '200 point sheet')
    const sheet = nodes(r).find(n => n.id === 'overlay-surface')!
    near(sheet.frame.y, manifest.measured.sheetTop)
    expect(sheet.frame.x).toBe(8)
  })
})

describe('new iPhone behavior', () => {
  it.each(['.enabled', '.enabled(upThrough: .medium)', '.disabled'])(`applies background interaction %s`, interaction => {
    let r = run(stressApp(`VStack { Text("Count: \\(count)"); Button("Add") { count += 1 } }.sheet(isPresented: $shown) { Text("Sheet").presentationDetents([.height(200)]).presentationBackgroundInteraction(${interaction}) }`, '@State var shown = true; @State var count = 0'))
    expect(r.diagnostics).toEqual([])
    const enabled = interaction !== '.disabled'
    expect(nodes(r).some(n => n.id === 'overlay-dim')).toBe(!enabled)
    expect(nodes(r).some(n => n.inert)).toBe(!enabled)
    // The exposed background is interactive; the sheet surface still blocks clicks through it.
    expect(nodes(r).find(n => n.id === 'overlay-surface')?.blocksPointer).toBe(true)
    if (enabled) { r = tap(r, 'Add'); expect(texts(r)).toContain('Count: 1'); expect(texts(r)).toContain('Sheet') }
  })
  it('disables background interaction above the requested detent', () => {
    const r = run(stressApp('Text("Base").sheet(isPresented: $shown) { Text("Sheet").presentationDetents([.large]).presentationBackgroundInteraction(.enabled(upThrough: .height(200))) }', '@State var shown = true'))
    expect(nodes(r).some(n => n.inert)).toBe(true)
  })
  it('opens and dismisses an iPhone inspector sheet', () => {
    let r = run(stressApp('Button("Inspect") { shown = true }.inspector(isPresented: $shown) { Button("Done") { shown = false } }', '@State var shown = false'))
    r = tap(r, 'Inspect'); expect(nodes(r).some(n => n.id === 'overlay-surface')).toBe(true)
    r = tap(r, 'Done'); expect(nodes(r).some(n => n.id === 'overlay-surface')).toBe(false)
  })
  it('submits edited text through an inherited onSubmit and exposes keyboard preferences', () => {
    let r = run(stressApp('VStack { TextField("Email", text: $email).keyboardType(.emailAddress).submitLabel(.send).textInputAutocapitalization(.never).autocorrectionDisabled(); Text(saved) }.onSubmit { saved = email }', '@State var email = ""; @State var saved = "Not sent"'))
    expect(r.diagnostics).toEqual([])
    const field = nodes(r).find(n => n.hitTarget?.role === 'textField')!.hitTarget!
    expect(field).toMatchObject({ inputMode: 'email', enterKeyHint: 'send', autocapitalization: 'none', autocorrection: false })
    applyEvent({ kind: 'textChange', handlerId: field.handlerId, value: 'hello@example.com' }); r = rerender(++revision)
    applyEvent({ kind: 'tap', handlerId: nodes(r).find(n => n.hitTarget?.role === 'textField')!.hitTarget!.submitHandlerId!, location: { x: 0, y: 0 } }); r = rerender(++revision)
    expect(texts(r)).toContain('hello@example.com')
  })
  it('keeps a list-row badge from leaking onto its containing tab', () => {
    const r = run(stressApp('TabView { List { Text("Inbox").badge(3) }.tabItem { Text("Mail") } }'))
    expect(nodes(r).filter(n => n.id.endsWith('badge-text'))).toHaveLength(1)
    expect(nodes(r).some(n => n.id === 'tab-0-badge-text')).toBe(false)
  })
  it('updates badges from state and hides a zero count', () => {
    let r = run(stressApp('TabView { VStack { Button("Clear") { count = 0 }; List { Text("Inbox").badge(count) } }.tabItem { Text("Inbox") }.badge(count) }', '@State var count = 3'))
    expect(nodes(r).filter(n => n.id.endsWith('badge-text')).map(n => n.text?.runs[0]?.text)).toEqual(['3', '3'])
    r = tap(r, 'Clear')
    expect(nodes(r).filter(n => n.id.endsWith('badge-text'))).toHaveLength(0)
  })
})


describe('context menus', () => {
  const menuApp = stressApp(`VStack {
    Text("Count: \\(count)")
    VStack {
      Text("Hold row")
      Button("Tap row") { count += 1 }
    }.contextMenu { Button("Add ten") { count += 10 }; Button("Reset", role: .destructive) { count = 0 } }
    Menu("More") { Button("Add one") { count += 1 } }
      .contextMenu { Button("Add hundred") { count += 100 } }
  }`, '@State private var count = 0')
  function context(r: CompileResult, name: string) {
    const hit = nodes(r).find(n => n.a11y?.label === name && n.hitTarget?.contextMenuHandlerId)!.hitTarget!
    applyEvent({ kind: 'tap', handlerId: hit.contextMenuHandlerId!, location: { x: 1, y: 1 } })
    return rerender(++revision)
  }
  it('inherits from containers without stealing child button taps', () => {
    let r = run(menuApp)
    expect(r.diagnostics).toEqual([])
    r = tap(r, 'Tap row')
    expect(texts(r)).toContain('Count: 1')
    r = context(r, 'Tap row')
    expect(texts(r)).toContain('Add ten')
    r = tap(r, 'Add ten')
    expect(texts(r)).toContain('Count: 11')
    expect(texts(r)).not.toContain('Reset')
    r = context(r, 'Hold row')
    r = tap(r, 'Reset')
    expect(texts(r)).toContain('Count: 0')
  })
  it('supports the explicitly labeled menuItems builder', () => {
    let r = run(stressApp('Text("Hold").contextMenu(menuItems: { Button("Choose") { selected = true } }); Text(selected ? "Selected" : "Pending")', '@State var selected = false'))
    expect(r.diagnostics).toEqual([])
    r = context(r, 'Hold')
    r = tap(r, 'Choose')
    expect(texts(r)).toContain('Selected')
  })
  it('keeps Menu options distinct from its context menu', () => {
    let r = tap(run(menuApp), 'More')
    expect(texts(r)).toContain('Add one')
    expect(texts(r)).not.toContain('Add hundred')
    r = tap(r, 'Add one')
    r = context(r, 'More')
    expect(texts(r)).toContain('Add hundred')
    expect(texts(r)).not.toContain('Add one')
    r = tap(r, 'Add hundred')
    expect(texts(r)).toContain('Count: 101')
  })
})
