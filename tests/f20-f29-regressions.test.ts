import { beforeEach, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState, applyEvent, rerender } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import type { CompileResult, DesignEditRequest } from '@studio/shared'
import { scrollThumb } from '../packages/swiftui-render-dom/src/ScrollIndicator'
import { worldFrame } from './render-geometry'

beforeEach(resetPipelineState)
const states = '@State var input = "Input"; @State var other = "Other"; @State var amount = 0.5; @State var count = 1; @State var chosen = Date(timeIntervalSince1970: 1700000000); @State var color = Color.blue'
const source = (body: string, declarations = states) => `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { ${declarations}; var body: some View { ${body} } }`
const files = (text: string) => [{ id: 'App.swift', text }]
const model = (text: string) => buildAuthoringModel({ projectId: 'fixes', revision: 1, files: files(text), deploymentTarget: '18.0' })
const find = (text: string, name: string) => model(text).nodes.find(n => n.name === name && n.kind !== 'definition')!
function edit(text: string, name: string, operation: DesignEditRequest['operation']) {
  const node = find(text, name)
  expect(node, name).toBeDefined()
  const result = planDesignEdit({ projectId: 'fixes', baseRevision: 1, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation, deploymentTarget: '18.0' })
  if (!result.ok) throw new Error(result.reason)
  return result.changes[0]?.after ?? text
}
function control(text: string, name: string, id: string, value: string) {
  expect(find(text, name)?.controls?.find(c => c.id === id), `${name} ${id}: ${find(text, name)?.controls?.map(c => c.id).join(', ')}`).toBeDefined()
  return edit(text, name, { kind: 'property', control: id, value })
}
const options = { canvas: { width: 393, height: 852 }, colorScheme: 'light' as const, safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } }
function run(text: string) {
  const result = compile({ ...options, files: files(text), revision: 1 })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  expect(result.renderTree).toBeDefined()
  return result
}
const render = (text: string) => run(text).renderTree!
const html = (text: string) => renderToStaticMarkup(createElement(RenderTreeView, { tree: render(text), onEvent: () => {} }))
const texts = (r: CompileResult) => r.renderTree!.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? [])
function press(result: CompileResult, label: string) {
  const hit = result.renderTree!.nodes.find(n => n.a11y?.label === label && n.hitTarget?.enabled)?.hitTarget
  expect(hit, `button ${label}`).toBeDefined()
  applyEvent({ kind: 'tap', handlerId: hit!.handlerId, location: { x: 0, y: 0 } })
  return rerender(2)
}
const fill = (text: string) => render(text).nodes.find(n => n.shape?.fill)?.shape?.fill

it.each([
 'Date(timeIntervalSince1970: 1699920000)...Date(timeIntervalSince1970: 1700092800)',
 'Date(timeIntervalSince1970: 1699920000)...',
 '...Date(timeIntervalSince1970: 1700092800)',
])('F20 accepts Date range %s and enforces the calendar bounds', range => {
  const r = run(source(`DatePicker("Date", selection: $chosen, in: ${range}, displayedComponents: .date)`))
  const opened = press(r, 'Date')
  expect(opened.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  const hits = opened.renderTree!.nodes.filter(n => n.hitTarget?.enabled).map(n => n.a11y?.label)
  expect(hits).toContain('15')
  if (range.startsWith('Date')) { expect(hits).not.toContain('1'); expect(hits).not.toContain('‹') }
  if (range.endsWith(')')) { expect(hits).not.toContain('30'); expect(hits).not.toContain('›') }
})
it('F20 edits both Date bounds, generates valid partial/closed Swift, and refuses inverted bounds', () => {
 let text = source('DatePicker("Date", selection: $chosen, displayedComponents: .date)')
 text = control(text, 'DatePicker', 'date:from', '2023-11-13T00:00')
 expect(text).toContain('in: Date(timeIntervalSince1970: 1699833600)..., displayedComponents: .date')
 run(text)
 text = control(text, 'DatePicker', 'date:through', '2023-11-16T00:00')
 expect(text).toContain('...Date(timeIntervalSince1970: 1700092800)')
 expect(() => control(text, 'DatePicker', 'date:from', '2024-01-01T00:00')).toThrow('earliest date')
 run(text)
})
it.each(['colors: [.red, .blue]', 'stops: [.init(color: .red, location: 0), Gradient.Stop(color: .blue, location: 1)]', 'gradient: Gradient(colors: [.red, .blue])', 'gradient: Gradient(stops: [.init(color: .red, location: 0), .init(color: .blue, location: 1)])'])('F21 resolves %s identically', args => {
 const result = fill(source(`Rectangle().fill(LinearGradient(${args}, startPoint: UnitPoint(x: 0.2, y: 0.3), endPoint: UnitPoint(x: 0.8, y: 0.7)))`))
 expect(result).toMatchObject({ kind: 'linearGradient', start: { x: 0.2, y: 0.3 }, end: { x: 0.8, y: 0.7 }, stops: [{ location: 0 }, { location: 1 }] })
})
it('F21 edits stop positions and numeric points and paints them in DOM', () => {
 let text = source('Rectangle().fill(LinearGradient(stops: [.init(color: .red, location: 0), .init(color: .blue, location: 0.2)], startPoint: UnitPoint(x: 0.2, y: 0.3), endPoint: .trailing)).frame(width: 200, height: 100)')
 text = control(text, 'Rectangle', 'modifier:0:detail:gradient:stop:1:location', '0.7')
 text = control(text, 'Rectangle', 'modifier:0:detail:gradient:startPoint:x', '0.4')
 expect(text).toContain('location: 0.7'); expect(text).toContain('UnitPoint(x: 0.4, y: 0.3)')
 expect(fill(text)).toMatchObject({ stops: [{ location: 0 }, { location: 0.7 }], start: { x: 0.4, y: 0.3 } })
 expect(html(text)).toContain('offset="0.7"')
})
it.each(['vertical', 'horizontal'])('F22 honors %s indicators without reserving layout space', axis => {
 const body = `ScrollView(.${axis}, showsIndicators: true) { Color.blue.frame(width: 1000, height: 1000) }.frame(width: 180, height: 180)`
 expect(html(source(body))).toContain(`data-scroll-indicator="${axis}"`)
 expect(html(source(body.replace('true', 'false')))).not.toContain('data-scroll-indicator=')
 expect(html(source(body + '.scrollIndicators(.hidden)'))).not.toContain('data-scroll-indicator=')
 expect(html(source(body.replace('true', 'false') + '.scrollIndicators(.visible)'))).toContain('data-scroll-indicator=')
})
it('F22 computes thumb size and position including content changes and short content', () => {
 expect(scrollThumb(200, 1000, 0)).toEqual({ length: 38.8, position: 3 })
 expect(scrollThumb(200, 1000, 800)?.position).toBeCloseTo(158.2)
 expect(scrollThumb(200, 2000, 0)?.length).toBe(20)
 expect(scrollThumb(200, 100, 0)).toBeNull()
})
it.each(['stroke', 'strokeBorder'])('F23 preserves StrokeStyle through %s Design, Swift, and SVG', stroke => {
 let text = source(`Circle().${stroke}(Color.blue, style: StrokeStyle(lineWidth: 8, lineCap: .round, dash: [10, 5], dashPhase: 3)).frame(width: 100, height: 100)`)
 text = control(text, 'Circle', 'modifier:0:detail:phase', '6')
 text = control(text, 'Circle', 'modifier:0:detail:dash', '12, 4')
 text = control(text, 'Circle', 'modifier:0:detail:join', 'bevel')
 expect(text).toContain('dash: [12, 4], dashPhase: 6')
 const markup = html(text)
 expect(markup).toContain('stroke-dasharray="12 4"'); expect(markup).toContain('stroke-linecap="round"')
 expect(markup).toContain('stroke-dashoffset="6"'); expect(markup).toContain('stroke-linejoin="bevel"')
 expect(render(text).nodes.find(n => n.shape)?.shape?.stroke?.placement).toBe(stroke === 'strokeBorder' ? 'inside' : 'center')
})
it('F23 uses caps and joins on open Path strokes, including foreground-only strokes', () => {
 const markup = html(source('Path { p in p.move(to: CGPoint(x: 0, y: 0)); p.addLine(to: CGPoint(x: 60, y: 40)) }.stroke(style: StrokeStyle(lineWidth: 8, lineCap: .square, lineJoin: .bevel, miterLimit: 5, dash: [10, 5], dashPhase: 3))'))
 expect(markup).toContain('stroke-linecap="square"'); expect(markup).toContain('stroke-linejoin="bevel"'); expect(markup).toContain('stroke-miterlimit="5"')
 expect(markup).toContain('stroke-dasharray="10 5"')
})
it('F24 reserves three lines only when requested, through Design and measured rendering', () => {
 const original = source('Text("Hi").font(.system(size: 20)).lineLimit(3).background(Color.blue)')
 const changed = control(original, 'Text', 'modifier:1:detail:reserve', 'true')
 expect(changed).toContain('lineLimit(3, reservesSpace: true)')
 const height = (text: string) => render(text).nodes.find(n => n.text)?.frame.height
 expect(height(changed)).toBe(height(original)! * 3)
 const normal = control(changed, 'Text', 'modifier:1:detail:reserve', 'false')
 expect(height(normal)).toBe(height(original))
 expect(html(changed)).toContain(`height:${height(changed)}px`)
})
it('F25 paints independent underline and strike colors, and Design changes only its decoration', () => {
 const original = source('Text("Decorated").underline(true, color: .red).strikethrough(true, color: .green)')
 const text = control(original, 'Text', 'modifier:0:detail:color', 'blue')
 expect(text).toContain('.underline(true, color: Color.blue).strikethrough(true, color: .green)')
 const run = render(text).nodes.find(n => n.text)?.text?.runs[0]
 expect(run?.underlineColor).toMatchObject({ b: 255 }); expect(run?.strikethroughColor).toMatchObject({ g: 199 })
 const markup = html(text)
 expect(markup).toContain('text-decoration:underline;text-decoration-color:'); expect(markup).toContain('text-decoration:line-through;text-decoration-color:')
})
it('F25 preserves decoration colors per attributed run and explicit resets', () => {
 const text = source('(Text("Red").underline(true, color: .red) + Text("Blue").underline(true, color: .blue) + Text("Plain").underline(false)).strikethrough(true, color: .green)')
 const runs = render(text).nodes.find(n => n.text)?.text?.runs
 expect(runs?.map(r => !!r.underline)).toEqual([true, true, false])
 expect(runs?.[0]?.underlineColor?.r).toBe(255); expect(runs?.[1]?.underlineColor?.b).toBe(255)
 expect(runs?.every(r => r.strikethroughColor?.g === 199)).toBe(true)
 expect(html(text)).toContain('text-decoration:line-through')
})
it('F26 changes components from Design and edits time without changing the local day', () => {
 let text = source('VStack { DatePicker("When", selection: $chosen, displayedComponents: .date); Text("at \\(chosen.timeIntervalSince1970)") }')
 text = control(text, 'DatePicker', 'date:components', 'Time')
 expect(text).toContain('displayedComponents: .hourAndMinute')
 let result = press(run(text), 'When')
 expect(texts(result)).not.toContain('November 2023')
 const hit = result.renderTree!.nodes.find(n => n.hitTarget?.inputType === 'time')?.hitTarget
 expect(hit).toBeDefined()
 const markup = renderToStaticMarkup(createElement(RenderTreeView, { tree: result.renderTree!, onEvent: () => {} }))
 expect(markup).toContain('type="time"')
 applyEvent({ kind: 'textChange', handlerId: hit!.handlerId, value: '12:34' })
 result = rerender(3)
 const seconds = Number(texts(result).find(t => t.startsWith('at '))!.slice(3))
 const date = new Date(seconds * 1000), before = new Date(1700000000000)
 expect(date.toDateString()).toBe(before.toDateString()); expect(date.getHours()).toBe(12); expect(date.getMinutes()).toBe(34)
})
it('F26 rejects time edits outside a DatePicker range and shows both editors for combined mode', () => {
 const from = new Date(1700000000000); from.setHours(12, 0, 0, 0)
 const to = new Date(from); to.setHours(14)
 const text = source(`VStack { DatePicker("When", selection: $chosen, in: Date(timeIntervalSince1970: ${from.getTime()/1000})...Date(timeIntervalSince1970: ${to.getTime()/1000})); Text("at \\(chosen.timeIntervalSince1970)") }`)
 let result = press(run(text), 'When')
 expect(texts(result)).toContain('November 2023')
 const hit = result.renderTree!.nodes.find(n => n.hitTarget?.inputType === 'time')!.hitTarget!
 applyEvent({ kind: 'textChange', handlerId: hit.handlerId, value: '10:00' }); result = rerender(3)
 expect(Number(texts(result).find(t => t.startsWith('at '))!.slice(3))).toBe(1700000000)
 applyEvent({ kind: 'textChange', handlerId: hit.handlerId, value: '13:00' }); result = rerender(4)
 expect(Number(texts(result).find(t => t.startsWith('at '))!.slice(3))).not.toBe(1700000000)
})
it.each([
 ['Slider(value: $amount, in: 0...100, step: 10)', 'Slider', 'slider:max', '200', '0...200'],
 ['Stepper("Count", value: $count, in: 0...10, step: 2)', 'Stepper', 'range:step', '3', 'step: 3'],
 ['ProgressView(value: 5, total: 10)', 'ProgressView', 'progress', '7', 'value: 7'],
 ['ProgressView(value: 5, total: 10)', 'ProgressView', 'progress:total', '20', 'total: 20'],
 ['Gauge(value: 5, in: 0...10) { Text("Level") }', 'Gauge', 'gauge:value', '7', 'value: 7'],
 ['SecureField("Secret", text: $input)', 'SecureField', 'title', 'Password', '"Password"'],
 ['Menu("Options") { Button("One") {} }', 'Menu', 'title', 'Actions', '"Actions"'],
 ['DisclosureGroup("Details") { Text("More") }', 'DisclosureGroup', 'title', 'Info', '"Info"'],
 ['ContentUnavailableView("Empty", systemImage: "star", description: Text("Try again"))', 'ContentUnavailableView', 'empty:description', 'Nothing here', 'Text("Nothing here")'],
 ['LinearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom)', 'LinearGradient', 'gradient:startPoint', 'leading', 'startPoint: .leading'],
 ['RadialGradient(colors: [.red, .blue], center: .center, startRadius: 0, endRadius: 100)', 'RadialGradient', 'gradient:endRadius', '70', 'endRadius: 70'],
 ['ColorPicker("Color", selection: $color)', 'ColorPicker', 'color:opacity', 'false', 'supportsOpacity: false'],
])('F27 exposes %s settings and previews generated Swift', (body, name, id, value, expected) => {
 const changed = control(source(body!), name!, id!, value!)
 expect(changed).toContain(expected)
 expect(run(changed).diagnostics.filter(d => d.severity === 'error')).toEqual([])
})
it('F27 moves differently sized Grid cells when row alignment and grid spacing change', () => {
 let text = source('Grid(horizontalSpacing: 10, verticalSpacing: 5) { GridRow(alignment: .top) { Color.red.frame(width: 20, height: 20); Color.blue.frame(width: 40, height: 60) }; GridRow { Text("Longer label"); Text("B") } }')
 const redY = (text: string) => { const tree = render(text); return worldFrame(tree.nodes, tree.nodes.find(n => n.background?.kind === 'solid' && n.background.color.r === 255 && n.background.color.g < 100)!).y }
 const initial = redY(text)
 text = control(text, 'GridRow', 'gridrow:alignment', 'bottom')
 expect(redY(text) - initial).toBe(40)
 text = control(text, 'Grid', 'grid:horizontalSpacing', '30')
 text = control(text, 'Grid', 'grid:verticalSpacing', '20')
 expect(text).toContain('horizontalSpacing: 30, verticalSpacing: 20')
 run(text)
})
it('F28 rebinds TextEditor and typing updates only the selected state', () => {
 const original = source('VStack { TextEditor(text: $input); Text("first: \\(input)"); Text("second: \\(other)") }')
 const changed = edit(original, 'TextEditor', { kind: 'bind-state', name: 'other' })
 expect(changed).toContain('TextEditor(text: $other)')
 const r = run(changed), hit = r.renderTree!.nodes.find(n => n.hitTarget?.multiline)?.hitTarget
 expect(hit?.value).toBe('Other')
 applyEvent({ kind: 'textChange', handlerId: hit!.handlerId, value: 'Changed' })
 expect(texts(rerender(2))).toEqual(expect.arrayContaining(['first: Input', 'second: Changed']))
 resetPipelineState(); expect(run(original).renderTree!.nodes.find(n => n.hitTarget?.multiline)?.hitTarget?.value).toBe('Input')
})
it.each(['@State var color: Color = Color.blue.opacity(0.3)', '@State var color = Color.blue.opacity(0.3)', '@State var chosen: Date = Date().addingTimeInterval(3600)', '@State var chosen = Date().addingTimeInterval(3600)'])('F29 discovers compound states while preserving dynamic initializers: %s', declaration => {
 const color = declaration.includes('color'), name = color ? 'ColorPicker' : 'DatePicker', state = color ? 'color' : 'chosen'
 const text = source(`${name}("Choose", selection: $${state})`, declaration)
 const input = model(text).inputs?.find(i => i.name === state)
 expect(input).toMatchObject({ type: color ? 'Color' : 'Date', value: null })
 expect(edit(text, name, { kind: 'bind-state', name: state })).toContain(declaration)
 run(text)
})
it('F29 preserves alpha when using a literal color default as a preview scenario', () => {
 const text = source('Rectangle().fill(color)', '@State var color = Color(red: 0.2, green: 0.4, blue: 0.8, opacity: 0.3)')
 const input = model(text).inputs!.find(i => i.name === 'color')!
 expect(input.value).toBe('#3366cc4d')
 const normal = fill(text)
 resetPipelineState()
 const result = compile({ ...options, files: files(text), revision: 1, scenario: { name: 'Default', owner: input.owner, hook: '', inputs: [{ owner: input.owner, name: input.name, signature: input.signature, value: input.value }] } })
 expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
 const actual = result.renderTree!.nodes.find(n => n.shape?.fill)?.shape?.fill
 expect(normal?.kind).toBe('solid'); expect(actual?.kind).toBe('solid')
 if (normal?.kind === 'solid' && actual?.kind === 'solid') expect(Math.abs(normal.color.a - actual.color.a)).toBeLessThan(1/255)
})
it('F27 adds Slider step with its required range and enforces integer Stepper values', () => {
 const slider = control(source('Slider(value: $amount)'), 'Slider', 'range:step', '0.1')
 expect(slider).toContain('Slider(value: $amount, in: 0...1, step: 0.1)')
 const hit = render(slider).nodes.find(n => n.hitTarget?.role === 'slider')?.hitTarget
 expect(hit).toMatchObject({ min: 0, max: 1, step: 0.1 })
 expect(() => control(source('Stepper("Count", value: $count)'), 'Stepper', 'range:step', '0.2')).toThrow('whole number')
 expect(() => control(source('Stepper("Count", value: $count, in: 0...10)'), 'Stepper', 'stepper:max', '10.5')).toThrow('whole number')
 const stepper = control(source('Stepper("Amount", value: $amount)'), 'Stepper', 'range:step', '0.2')
 expect(stepper).toContain('step: 0.2'); run(stepper)
})
it('F27 opacity option controls an interactive ColorPicker alpha slider', () => {
 let text = source('VStack { Rectangle().fill(color).frame(width: 40, height: 40); ColorPicker("Color", selection: $color) }')
 const opened = press(run(text), 'Color')
 const hit = opened.renderTree!.nodes.find(n => n.hitTarget?.role === 'slider')!.hitTarget!
 applyEvent({ kind: 'slide', handlerId: hit.handlerId, value: 0.4 })
 const result = rerender(3)
 const color = result.renderTree!.nodes.find(n => n.shape?.shape === 'rectangle')?.shape?.fill
 expect(color).toMatchObject({ kind: 'solid', color: { a: 0.4 } })
 expect(result.renderTree!.nodes.some(n => n.hitTarget?.role === 'slider')).toBe(true)
 text = control(text, 'ColorPicker', 'color:opacity', 'false')
 resetPipelineState()
 expect(press(run(text), 'Color').renderTree!.nodes.some(n => n.hitTarget?.role === 'slider')).toBe(false)
})
it('F28 can create String state for TextEditor while preserving a custom Binding expression', () => {
 const changed = edit(source('TextEditor(text: $input)'), 'TextEditor', { kind: 'bind-state', name: 'draft', create: { value: 'New draft' } })
 expect(changed).toContain('@State private var draft: String = "New draft"')
 expect(render(changed).nodes.find(n => n.hitTarget?.multiline)?.hitTarget?.value).toBe('New draft')
 expect(() => edit(source('TextEditor(text: Binding(get: { input }, set: { input = $0 }))'), 'TextEditor', { kind: 'bind-state', name: 'other' })).toThrow('developer logic')
})
it.each(['List', 'Form'])('F22 honors inherited indicator visibility for %s', name => {
 const text = source(`VStack { ${name} { ForEach(0..<30) { i in Text("Row \\(i)") } }.frame(height: 150) }.scrollIndicators(.hidden)`)
 expect(html(text)).not.toContain('data-scroll-indicator=')
 expect(html(text.replace('.hidden', '.visible'))).toContain('data-scroll-indicator="vertical"')
})
it('F21 paints Gradient stops on vector paths and custom shape fills', () => {
 const text = source('Path { p in p.move(to: CGPoint(x: 0, y: 0)); p.addLine(to: CGPoint(x: 100, y: 0)); p.addLine(to: CGPoint(x: 50, y: 100)); p.closeSubpath() }.fill(LinearGradient(gradient: Gradient(stops: [.init(color: .red, location: 0), .init(color: .blue, location: 0.7)]), startPoint: .leading, endPoint: .trailing)).frame(width: 100, height: 100)')
 const markup = html(text)
 expect(markup).toContain('<linearGradient'); expect(markup).toContain('offset="0.7"'); expect(markup).toContain('fill="url(#shape-')
})
it('F23 preserves trim geometry and inherited foreground for styled Path strokes', () => {
 const path = 'Path { p in p.addArc(center: CGPoint(x: 50, y: 50), radius: 40, startAngle: .degrees(0), endAngle: .degrees(360), clockwise: false) }'
 const original = render(source(path + '.stroke(style: StrokeStyle(lineWidth: 4, dash: [10, 5])).foregroundStyle(.red)')).nodes.find(n => n.path)?.path
 const trimmed = render(source(path + '.trim(from: 0, to: 0.5).stroke(style: StrokeStyle(lineWidth: 4, dash: [10, 5])).foregroundStyle(.red)')).nodes.find(n => n.path)?.path
 expect(original?.d.match(/ A /g)).toHaveLength(2); expect(trimmed?.d.match(/ A /g)).toHaveLength(1); expect(trimmed?.d).not.toBe(original?.d)
 expect(trimmed?.stroke?.color).toMatchObject({r:255,g:59,b:48}); expect(trimmed?.stroke?.dash).toEqual([10,5])
})
it('F27 previews changed Stepper increments and ProgressView fractions', () => {
 const stepper = control(source('Stepper("Count \\(count)", value: $count, in: 0...10, step: 2)'), 'Stepper', 'range:step', '3')
 const result = run(stepper)
 const increment = result.renderTree!.nodes.find(n => n.a11y?.label === 'Increment')?.hitTarget
 expect(increment).toBeDefined()
 applyEvent({kind:'tap', handlerId:increment!.handlerId,location:{x:0,y:0}})
 expect(texts(rerender(2))).toContain('Count 4')
 resetPipelineState()
 const original = source('ProgressView(value: 5, total: 10).frame(width: 200)')
 const changed = control(original, 'ProgressView', 'progress:total', '20')
 const progressWidth = (text:string) => render(text).nodes.find(n => n.id.endsWith('fill') && n.background?.kind === 'solid')?.frame.width
 expect(progressWidth(changed)).toBe(progressWidth(original)! / 2)
})
it('F27 keeps ColorPicker swatches and opacity controls inside the popup', () => {
 const result = press(run(source('ColorPicker("Color", selection: $color)')), 'Color')
 const tree = result.renderTree!, panel = tree.nodes.find(n => n.id === 'overlay-menu')!
 const bounds = worldFrame(tree.nodes, panel)
 const controls = tree.nodes.filter(n => n.hitTarget?.handlerId.includes('/colour-') || n.hitTarget?.role === 'slider')
 expect(controls).toHaveLength(17)
 for (const node of controls) {
  const frame = worldFrame(tree.nodes, node)
  expect(frame.x).toBeGreaterThanOrEqual(bounds.x)
  expect(frame.x + frame.width).toBeLessThanOrEqual(bounds.x + bounds.width)
 }
})
it('F20 changes Date literals without deleting comments inside their constructors', () => {
 const original = source('DatePicker("Date", selection: $chosen, in: Date(/* release day */ timeIntervalSince1970: 1699833600)...)')
 const changed = control(original, 'DatePicker', 'date:from', '2023-11-14T00:00')
 expect(changed).toContain('Date(/* release day */ timeIntervalSince1970: 1699920000)...')
 run(changed)
})
it('F23 and F26 retain source ownership of commented compound arguments', () => {
 const circle = find(source('Circle().stroke(style: StrokeStyle(dash: [10, /* gap */ 5]))'), 'Circle')
 expect(circle.controls?.some(c => c.id === 'modifier:0:detail:dash')).toBe(false)
 const date = find(source('DatePicker("Date", selection: $chosen, displayedComponents: [.date, /* time */ .hourAndMinute])'), 'DatePicker')
 expect(date.controls?.some(c => c.id === 'date:components')).toBe(false)
})
