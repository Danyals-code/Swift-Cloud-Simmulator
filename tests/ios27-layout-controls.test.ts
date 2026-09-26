import { worldFrame } from './render-geometry'
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { DYNAMIC_TYPE_SIZES, shapePath, textMeasureKey, type CompileRequest, type CompileResult, type ResolvedFont } from '@studio/shared'
import { FontMetricsTable, measureText, measureRuns } from '@studio/swiftui-layout'
import { applyEvent, compile, fontForToken, relayout, rerender, resetPipelineState, setFontMetrics, setTextMeasurements } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'

beforeEach(() => { resetPipelineState(); setFontMetrics([]) })

function run(body: string, options: Partial<CompileRequest> = {}, extra = ''): CompileResult {
  const source = `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
 @State var amount = 0.5
 @State var count = 0
 @State var on = true
 @State var text = "Hello"
 @State var selection = 0
 var body: some View { ${body} }
}
${extra}`
  const result = compile({ files: [{ id: 'App.swift', text: source }], canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 1, ...options })
  expect(result.diagnostics).toEqual([])
  expect(result.renderTree).not.toBeNull()
  return result
}
const nodes = (r: CompileResult) => r.renderTree!.nodes
const text = (r: CompileResult, value: string) => nodes(r).find((n) => n.text?.runs.some((run) => run.text === value))!
const hit = (r: CompileResult, label: string) => nodes(r).find((n) => n.hitTarget && n.a11y?.label === label)!
const markup = (r: CompileResult) => renderToStaticMarkup(createElement(RenderTreeView, { tree: r.renderTree!, onEvent: () => {} }))
const baseline = (r: CompileResult, value: string, last = false) => {
  const n = text(r, value), lines = n.text!.lines!, line = lines[last ? lines.length - 1 : 0]!
  return n.frame.y + line.origin.y + line.baseline
}

describe('scroll content cross-axis placement', () => {
  it('centers intrinsic content while an explicit infinity frame still fills the viewport', () => {
    const r = run('ScrollView { Text("Centered").frame(width: 100, height: 30) }')
    expect(text(r, 'Centered').frame.x).toBeGreaterThan(100)
    const full = run('ScrollView { Text("Leading").frame(maxWidth: .infinity, alignment: .leading) }')
    expect(text(full, 'Leading').frame.x).toBe(0)
  })
})

describe('stable word wrapping', () => {
  it('keeps a word that fits exactly when its following space does not fit', () => {
    const font = fontForToken('body')!
    const metrics = new FontMetricsTable()
    const width = measureText('One two', font, Infinity, metrics).width
    const measured = measureText('One two three', font, width, metrics)
    expect(measured.lines.map(l => l.text)).toEqual(['One two', 'three'])
    const placed = measureText('One two three', font, measured.width, metrics)
    expect(placed.lines.map(l => l.text)).toEqual(measured.lines.map(l => l.text))
  })
})

describe('semantic typography', () => {
  it('covers all twelve categories with independent style curves', () => {
    for (const category of DYNAMIC_TYPE_SIZES) {
      for (const style of ['largeTitle', 'title', 'title2', 'title3', 'headline', 'body', 'callout', 'subheadline', 'footnote', 'caption', 'caption2']) {
        const f = fontForToken(style, category)!
        expect(f.size).toBeGreaterThan(0)
        expect(f.lineHeight).toBeGreaterThanOrEqual(f.size)
      }
    }
    expect(fontForToken('caption2', 'xSmall')!.size).toBe(11)
    expect(fontForToken('body', 'xSmall')!.size).toBe(14)
    expect(fontForToken('body', 'accessibility5')!.size).toBe(53)
    expect(fontForToken('largeTitle', 'accessibility5')!.size).toBe(60)
  })
  it('scales semantic fonts but preserves explicit point sizes', () => {
    const r = run('VStack { Text("Body"); Text("Fixed").font(.system(size: 20)); Text("Caption").font(.caption2) }', { dynamicTypeSize: 'accessibility5' })
    expect(text(r, 'Body').text!.runs[0]!.font.size).toBe(53)
    expect(text(r, 'Fixed').text!.runs[0]!.font.size).toBe(20)
    expect(text(r, 'Caption').text!.runs[0]!.font.size).toBe(39)
  })
  it('scopes named sizes before evaluating a custom body', () => {
    const r = run('VStack { Reader().dynamicTypeSize(.accessibility3); Text("Sibling") }', {}, 'struct Reader: View { @Environment(\\.dynamicTypeSize) var size; var body: some View { Text(size == .accessibility3 ? "Accessible" : "Wrong") } }')
    expect(text(r, 'Accessible').text!.runs[0]!.font.size).toBe(40)
    expect(text(r, 'Sibling').text!.runs[0]!.font.size).toBe(17)
  })
  it('uses the requested face, size, weight, and italic trait in shaped-run cache keys', () => {
    const f: ResolvedFont = { family: 'Test', size: 20, weight: 400, italic: false, lineHeight: 25 }
    const calls: string[] = []
    const table = new FontMetricsTable([], (request) => { calls.push(textMeasureKey(request)); return { width: 31, ascent: 16, descent: 4 } })
    table.measure({ text: 'AV', font: f }); table.measure({ text: 'AV', font: f })
    table.measure({ text: 'AV', font: { ...f, italic: true } })
    table.measure({ text: 'AV', font: { ...f, weight: 500 } })
    table.measure({ text: 'AV', font: { ...f, size: 21 } })
    expect(new Set(calls).size).toBe(4)
    expect(calls).toHaveLength(4)
  })
  it('wraps against shaped strings instead of summed letter widths', () => {
    const f: ResolvedFont = { family: 'Test', size: 20, weight: 400, italic: false, lineHeight: 25 }
    const table = new FontMetricsTable([], ({ text }) => ({ width: text === 'AV' ? 15 : [...text].length * 10, ascent: 16, descent: 4 }))
    const measured = measureText('AV', f, 16, table)
    expect(measured.lines).toHaveLength(1)
    expect(measured.width).toBe(15)
    // Centred in its 25 pt of leading, less the half-leading a block gives up above its first line.
    expect(measured.lines[0]!.baseline).toBe(18)
  })
  it('keeps grapheme clusters whole across emoji, accented, CJK, and RTL text', () => {
    const f: ResolvedFont = { family: 'Test', size: 20, weight: 400, italic: false, lineHeight: 25 }
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const table = new FontMetricsTable([], ({ text }) => ({ width: [...segmenter.segment(text)].length * 10, ascent: 16, descent: 4 }))
    for (const value of ['👩🏽‍💻👩🏽‍💻', 'éé', '한글漢字', 'مرحبا']) {
      const measured = measureText(value, f, 10, table)
      expect(measured.lines.map((line) => line.text).join('')).toBe(value)
      expect(measured.lines.every((line) => [...segmenter.segment(line.text)].length === 1)).toBe(true)
    }
  })
  it('sizes mixed runs to their shared baseline and preserves style line heights', () => {
    const r = run('Text("Big").font(.title) + Text(" small").font(.caption)')
    const n = nodes(r).find((n) => n.text)!
    expect(n.text!.runs.map((run) => run.font.lineHeight)).toEqual([34, 16])
    // One line of .title, as tall as its glyphs: 33.67 pt in the iOS 27 simulator.
    expect(n.text!.lines![0]!.height).toBeCloseTo(101 / 3, 2)
    expect(n.text!.lines![0]!.slices!.every((slice) => Number.isFinite(slice.baseline))).toBe(true)
  })
  it('applies tightening to both measurement and painted tracking', () => {
    const r = run('Text("AAAA").frame(width: 44).lineLimit(1).allowsTightening(true)')
    const n = nodes(r).find((n) => n.text)!
    expect(n.text!.runs[0]!.tracking).toBeLessThan(0)
    expect(n.text!.lines![0]!.text).toBe('AAAA')
  })
  it('refines measurements without resetting state or accepting a stale revision', () => {
    setFontMetrics([], undefined, true)
    let r = run('VStack { Text("Count \\(count)"); Button("Increment") { count += 1 } }')
    applyEvent({ kind: 'tap', handlerId: hit(r, 'Increment').hitTarget!.handlerId, location: { x: 0, y: 0 } })
    r = rerender(2)
    expect(text(r, 'Count 1')).toBeDefined()
    const requests = r.textMeasurement!.requests
    expect(requests.length).toBeGreaterThan(0)
    const measured = requests.map((request) => ({ key: textMeasureKey(request), width: request.text.length * 7, ascent: 14, descent: 3 }))
    expect(setTextMeasurements(measured, 1)).toBeNull()
    r = setTextMeasurements(measured, 2)!
    expect(text(r, 'Count 1')).toBeDefined()
    expect(text(relayout(3), 'Count 1')).toBeDefined()
  })
  it('tracks tabular digit shaping separately from proportional text', () => {
    const f = fontForToken('body')!
    const table = new FontMetricsTable([], (r) => ({ width: r.tabularNumbers ? 30 : 18, ascent: 14, descent: 3 }))
    expect(measureRuns([{ text: '111', font: f, tabularNumbers: true }], f, Infinity, table).width).toBe(30)
    expect(measureText('111', f, Infinity, table).width).toBe(18)
  })
  it('rejects a measurement batch from a replaced font set', () => {
    setFontMetrics([], undefined, true)
    const r = run('Text("Font readiness")')
    const generation = r.textMeasurement!.generation
    setFontMetrics([], undefined, true)
    expect(setTextMeasurements([], r.revision, generation)).toBeNull()
    expect(relayout(2).textMeasurement!.generation).not.toBe(generation)
  })
})

describe('automatic spacing and alignment', () => {
  const gap = (r: CompileResult, a: string, b: string) => text(r, b).frame.y - text(r, a).frame.y - text(r, a).frame.height
  it('uses smaller text gaps and larger control gaps', () => {
    expect(gap(run('VStack { Text("A"); Text("B") }'), 'A', 'B')).toBeCloseTo(3)
    expect(gap(run('VStack { Text("A"); Button("B") {} }'), 'A', 'B')).toBeCloseTo(8)
  })
  it('preserves explicit zero, fractional, and negative spacing', () => {
    for (const spacing of [0, 2.5, -2]) expect(gap(run(`VStack(spacing: ${spacing}) { Text("A"); Text("B") }`), 'A', 'B')).toBeCloseTo(spacing)
  })
  it('passes preferences through wrappers and ignores EmptyView', () => {
    const r = run('VStack { Text("A").font(.body); EmptyView(); Group { Text("B") } }')
    expect(gap(r, 'A', 'B')).toBeCloseTo(3)
  })
  it('does not double-count a spacer minimum', () => {
    expect(gap(run('VStack { Text("A"); Spacer(); Text("B") }.fixedSize()'), 'A', 'B')).toBeCloseTo(8)
    expect(gap(run('VStack { Text("A"); Spacer(minLength: 0); Text("B") }.fixedSize()'), 'A', 'B')).toBeCloseTo(0)
  })
  it('aligns first and last text baselines across mixed sizes and padding', () => {
    const first = run('HStack(alignment: .firstTextBaseline) { Text("Large").font(.largeTitle).padding(.top, 5); Text("Small").font(.caption) }')
    expect(baseline(first, 'Large')).toBeCloseTo(baseline(first, 'Small'))
    const last = run('HStack(alignment: .lastTextBaseline) { Text("Two\\nlines").font(.title); Text("Small").font(.caption) }')
    expect(baseline(last, 'Two\nlines', true)).toBeCloseTo(baseline(last, 'Small', true))
  })
  it('includes nested stack placement when exporting a text baseline', () => {
    const r = run('HStack(alignment: .firstTextBaseline) { HStack(alignment: .bottom) { Text("Large").font(.largeTitle); Text("Small").font(.caption) }; Text("Peer") }')
    expect(baseline(r, 'Peer')).toBeCloseTo(Math.min(baseline(r, 'Large'), baseline(r, 'Small')))
  })
  it('uses the device pixel scale for separators without rounding text frames', () => {
    for (const scale of [2, 3]) {
      const r = run('VStack(spacing: 2.5) { Text("A").padding(.leading, 0.2); Divider(); Text("B") }', { displayScale: scale })
      const divider = nodes(r).find((n) => n.inspect?.name === 'Divider')!
      expect(divider.frame.height).toBeCloseTo(1 / scale)
      expect(divider.frame.y * scale).toBeCloseTo(Math.round(divider.frame.y * scale))
    }
  })
  it('exposes pixel length and scale to Swift environment readers', () => {
    const r = run('Pixels()', { displayScale: 2 }, 'struct Pixels: View { @Environment(\\.pixelLength) var pixel; @Environment(\\.displayScale) var scale; var body: some View { Text(verbatim: "\\(pixel) / \\(scale)") } }')
    expect(text(r, '0.5 / 2.0')).toBeDefined()
  })
})

describe('control geometry and input semantics', () => {
  it('makes circular buttons square and keeps capsule buttons content-sized', () => {
    const circle = hit(run('Button("Long label") {}.buttonStyle(.bordered).buttonBorderShape(.circle)'), 'Long label')
    const capsule = hit(run('Button("Long label") {}.buttonStyle(.bordered).buttonBorderShape(.capsule)'), 'Long label')
    expect(circle.frame.width).toBeCloseTo(circle.frame.height)
    expect(nodes(run('Button("+") {}.buttonStyle(.bordered).buttonBorderShape(.circle)')).find((n) => n.clip && n.cornerRadius)?.clipShape?.cornerStyle).toBe('circular')
    expect(capsule.frame.width).toBeGreaterThan(capsule.frame.height)
  })
  it('uses separate control-size metrics and respects explicit fonts', () => {
    const mini = run('Button("Go") {}.buttonStyle(.bordered).controlSize(.mini)')
    const large = run('Button("Go") {}.buttonStyle(.bordered).controlSize(.large)')
    expect(hit(large, 'Go').frame.height).toBeGreaterThan(hit(mini, 'Go').frame.height)
    const custom = run('VStack { Button("Go") {}.controlSize(.mini) }.font(.system(size: 30))')
    expect(text(custom, 'Go').text!.runs[0]!.font.size).toBe(30)
  })
  it('draws a circle inside a rectangular frame and distinguishes corner styles', () => {
    const r = run('Circle().frame(width: 120, height: 40)')
    const n = nodes(r).find((n) => n.shape)!
    expect(n.frame.width).toBe(40); expect(n.frame.height).toBe(40)
    expect(shapePath('roundedRectangle', 100, 40, 12, 'continuous')).not.toBe(shapePath('roundedRectangle', 100, 40, 12, 'circular'))
    expect(shapePath('capsule', 100, 40)).toContain('H 80')
  })
  it('distinguishes centered and inset strokes and inherits the stroke foreground', () => {
    const r = run('HStack { RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(.red, lineWidth: 6); RoundedRectangle(cornerRadius: 12).strokeBorder(lineWidth: 6).foregroundStyle(.purple) }.frame(width: 200, height: 60)')
    const shapes = nodes(r).filter((n) => n.shape)
    expect(shapes[0]!.shape!.stroke!.placement).toBe('center')
    expect(shapes[1]!.shape!.stroke!.placement).toBe('inside')
    expect(shapes[1]!.shape!.stroke!.color.r).toBe(203)
    expect(markup(r)).toContain('stroke-width="6"')
    expect(shapePath('rectangle', 100, 40, 0, 'circular', 3)).toContain('M 3 3')
  })
  it('reads the inset stroke width from StrokeStyle', () => {
    const r = run('RoundedRectangle(cornerRadius: 12).strokeBorder(.purple, style: StrokeStyle(lineWidth: 7)).frame(width: 100, height: 40)')
    expect(nodes(r).find((n) => n.shape)!.shape!.stroke).toMatchObject({ width: 7, placement: 'inside' })
  })
  it('draws switches with an inset capsule thumb and uses tinted on/off states', () => {
    let r = run('Toggle("On", isOn: $on).tint(.purple)')
    const shapes = nodes(r).filter((n) => n.shape)
    expect(shapes.find((n) => n.shape!.shape === 'capsule')!.frame).toMatchObject({ width: 64, height: 28 })
    expect(shapes.find((n) => n.id.endsWith('knob'))!.frame).toMatchObject({ width: 38, height: 24 })
    const before = worldFrame(nodes(r), shapes.find((n) => n.id.endsWith('knob'))!).x
    applyEvent({ kind: 'toggle', handlerId: hit(r, 'On').hitTarget!.handlerId, value: false })
    r = rerender(2)
    expect(worldFrame(nodes(r), nodes(r).find((n) => n.id.endsWith('knob'))!).x).toBeLessThan(before)
    expect(markup(r)).toContain('aria-checked="false"')
  })
  it('paints a slider while retaining the source range and step in its native input', () => {
    const r = run('Slider(value: $amount, in: -1...1, step: 0.25).tint(.purple)')
    const target = nodes(r).find((n) => n.hitTarget?.role === 'slider')!
    expect(target.hitTarget).toMatchObject({ min: -1, max: 1, step: 0.25 })
    expect(nodes(r).find((n) => n.slider)!.slider).toMatchObject({ fraction: 0.75, ticks: [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1], thumbDiameter: 36, thumbHeight: 24 })
    expect(markup(r)).toContain('step="0.25"')
    expect(markup(run('Slider(value: $amount)'))).toContain('step="any"')
  })
  it('grows a text field with its font, resets input insets, and masks SecureField', () => {
    const r = run('VStack { TextField("Name", text: $text).textFieldStyle(.roundedBorder).font(.title); SecureField("Secret", text: $text) }')
    expect(hit(r, 'Name').frame.height).toBeGreaterThanOrEqual(46)
    expect(hit(r, 'Name').hitTarget!.font!.size).toBe(28)
    expect(hit(r, 'Name').hitTarget!.inputInset).toBe(7)
    expect(hit(r, 'Secret').hitTarget!.inputInset).toBe(0)
    expect(markup(r)).toContain('type="password"')
  })
  it('places discrete slider ticks at actual step positions', () => {
    const r = run('Slider(value: $amount, in: 0...1, step: 0.3)')
    const ticks = nodes(r).find((n) => n.slider)!.slider!.ticks!
    expect(ticks).toHaveLength(4)
    expect(ticks[3]).toBeCloseTo(0.9)
  })
  it('disables stepper directions at range limits and honors a disabled parent', () => {
    const r = run('Stepper("Count", value: $count, in: 0...2)')
    expect(hit(r, 'Decrement').hitTarget!.enabled).toBe(false)
    expect(hit(r, 'Increment').hitTarget!.enabled).toBe(true)
    const disabled = run('Stepper("Count", value: $count, in: 0...2).disabled(true)')
    expect(nodes(disabled).filter((n) => n.hitTarget).every((n) => !n.hitTarget!.enabled)).toBe(true)
  })
  it('sizes segmented choices equally and keeps selection interactive', () => {
    let r = run('Picker("Mode", selection: $selection) { Text("A").tag(0); Text("Longer").tag(1) }.pickerStyle(.segmented)')
    expect(hit(r, 'A').frame.width).toBeCloseTo(hit(r, 'Longer').frame.width)
    expect(hit(r, 'Mode')).toBeUndefined() // No full-size target covering the segments.
    applyEvent({ kind: 'tap', handlerId: hit(r, 'Longer').hitTarget!.handlerId, location: { x: 1, y: 1 } })
    r = rerender(2)
    expect(text(r, 'Longer').text!.runs[0]!.font.weight).toBe(600)
  })
  it('keeps disabled inputs visible and enabled buttons keyboard-focusable', () => {
    const r = run('VStack { TextField("Disabled", text: $text).disabled(true); Button("Go") {} }')
    expect(hit(r, 'Disabled').opacity).toBeLessThan(1)
    expect(markup(r)).toContain('disabled=""')
    expect(markup(r)).toContain('tabindex="0"')
  })
  it('compiles the native comparison gallery without warnings', () => {
    const source = readFileSync(new URL('./fixtures/ios27-layout-controls.swift', import.meta.url), 'utf8')
    const r = compile({ files: [{ id: 'Gallery.swift', text: source }], colorScheme: 'light', canvas: { width: 393, height: 852 }, revision: 1 })
    expect(r.diagnostics).toEqual([])
    expect(r.renderTree!.nodes.some((n) => n.slider)).toBe(true)
  })
})
