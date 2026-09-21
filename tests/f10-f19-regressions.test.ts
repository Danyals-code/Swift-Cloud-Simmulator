import { beforeEach, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { cssTransform, rotationProjection, validatePreviewScenario, type AuthoringNode, type DesignEditRequest } from '@studio/shared'
import projectionCases from './fixtures/rotation-projections.json'
import { worldFrame } from './render-geometry'

beforeEach(resetPipelineState)
const source = (body: string) => `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
 @State var enabled = true; @State var amount = 0.5; @State var count = 0
 @State var input = "Input text"; @State var selection = 0; @State var date = Date()
 var body: some View { ${body} }
}`
const files = (text: string) => [{ id: 'App.swift', text }]
const model = (text: string, deploymentTarget = '18.0') => buildAuthoringModel({ projectId: 'fixes', revision: 1, files: files(text), deploymentTarget })
const find = (text: string, name: string) => model(text).nodes.find(n => n.name === name && n.kind !== 'definition')!
function plan(text: string, node: AuthoringNode, operation: DesignEditRequest['operation']) {
  return planDesignEdit({ projectId: 'fixes', baseRevision: 1, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation, deploymentTarget: '18.0' })
}
function edit(text: string, name: string, operation: DesignEditRequest['operation']) {
  const result = plan(text, find(text, name), operation)
  if (!result.ok) throw new Error(result.reason)
  const changed = result.changes[0]?.after ?? text
  return changed
}
function set(text: string, name: string, modifier: string, value: string, label?: string) {
  const selected = find(text, name)
  const control = selected.modifiers?.filter(m => m.name === modifier).at(-1)?.controls.find(c => !c.id.startsWith('fill:') && (!label || c.label === label))
  expect(control, `${name}.${modifier} editor`).toBeDefined()
  return edit(text, name, { kind: 'property', control: control!.id, value })
}
function render(text: string) {
  const result = compile({ files: files(text), revision: 1, canvas: { width: 393, height: 852 }, colorScheme: 'light', safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  expect(result.renderTree).toBeDefined()
  return result.renderTree!
}
const html = (text: string) => renderToStaticMarkup(createElement(RenderTreeView, { tree: render(text), onEvent: () => {} }))
const blue = (text: string) => render(text).nodes.find(n => { const fill = n.background ?? n.shape?.fill; return fill?.kind === 'solid' && fill.color.b > fill.color.r })!

function control(text: string, name: string, id: string, value: string) {
  const selected = find(text, name)
  expect(selected?.controls?.find(c => c.id === id), `${name} ${id}`).toBeDefined()
  return edit(text, name, { kind: 'property', control: id, value })
}
const strings = (text: string) => render(text).nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? [])
it('F10 edits a standalone Section title and paints header, content, and footer', () => {
  const changed = control(source('VStack { Section("Header") { Text("Body") } }'), 'Section', 'title', 'Changed')
  expect(changed).toContain('Section("Changed")')
  expect(strings(changed)).toEqual(['Changed', 'Body'])
  const custom = source('VStack { Section { Text("Body") } header: { Text("Header") } footer: { Text("Footer") } }')
  expect(strings(custom)).toEqual(['Header', 'Body', 'Footer'])
  expect(strings(source('List { Section("Header") { Text("Body") } }'))).toEqual(['Header', 'Body'])
})
it.each(['HStack', 'VStack'])('F10 Section follows %s sibling spacing and ordering, matching native SwiftUI', stack => {
 const tree = render(source(`${stack}(spacing: 8) { Section { Color.blue.frame(width: 20, height: 20) } header: { Color.red.frame(width: 30, height: 10) } footer: { Color.green.frame(width: 40, height: 15) } }`))
 const frames = tree.nodes.filter(n => n.background?.kind === 'solid' && n.background.color.r !== 255 || n.background?.kind === 'solid' && n.background.color.g < 100).map(n => worldFrame(tree.nodes,n))
 const header = frames.find(f => f.width === 30)!, body = frames.find(f => f.width === 20)!, footer = frames.find(f => f.width === 40)!
 if (stack === 'HStack') { expect(body.x - header.x).toBe(38); expect(footer.x - body.x).toBe(28) }
 else { expect(body.y - header.y).toBe(18); expect(footer.y - body.y).toBe(28) }
})
it('F11 selects inset, changes row geometry, and stops emitting an unsupported-style warning', () => {
  const original = source('List { Text("First"); Text("Second") }.listStyle(.plain)')
  const changed = set(original, 'List', 'listStyle', 'inset')
  expect(changed).toContain('.listStyle(.inset)')
  const first = (text: string) => { const tree = render(text); return worldFrame(tree.nodes, tree.nodes.find(n => n.text?.runs[0]?.text === 'First')!) }
  expect(first(changed).x - first(original).x).toBe(16)
  const result = compile({ files: files(changed), revision: 2, colorScheme: 'light', canvas: { width: 393, height: 852 } })
  expect(result.diagnostics.some(d => /inset.*not|listStyle.*not/.test(d.message))).toBe(false)
})
it.each(['Text("BLUE").foregroundStyle(Color.blue)', 'Circle().fill(Color.blue).frame(width: 80, height: 80)', 'HStack { Color.blue; Color.green }.frame(width: 100, height: 50)'])('F12 multiplies actual pixels of %s, preserving transparent regions', body => {
  const text = set(edit(source(body), body.startsWith('Text') ? 'Text' : body.startsWith('Circle') ? 'Circle' : 'HStack', { kind: 'modifier-add', name: 'colorMultiply' }), body.startsWith('Text') ? 'Text' : body.startsWith('Circle') ? 'Circle' : 'HStack', 'colorMultiply', 'red')
  expect(text).toContain('.colorMultiply(Color.red)')
  expect(render(text).nodes.some(n => n.filter?.multiply?.r === 255)).toBe(true)
  expect(html(text)).toContain('feColorMatrix')
  expect(html(text)).toContain('color-interpolation-filters="sRGB"')
  expect(html(text)).not.toContain('mix-blend-mode:multiply')
})
it.each(['Text("Gradient")', 'Image(systemName: "star.fill")'])('F13 changes %s from solid to gradient in Design, Swift, and DOM', body => {
  const name = body.startsWith('Text') ? 'Text' : 'Image'
  let text = source(body + '.foregroundStyle(Color.blue)')
  text = control(text, name, 'modifier:0:advanced:0:fillType', 'Gradient')
  text = control(text, name, 'modifier:0:advanced:0:stop:0', 'green')
  expect(text).toContain('LinearGradient(colors: [Color.green, Color.blue]')
  const tree = render(text), fill = tree.nodes.find(n => n.text || n.image)
  expect((fill?.text?.runs[0]?.foregroundFill ?? fill?.image?.foregroundFill)?.kind).toBe('linearGradient')
  expect(html(text)).toContain('linear-gradient(90.00deg')
  expect(html(text)).toContain(name === 'Text' ? 'background-clip:text' : 'mask="url(#')
  text = control(text, name, 'modifier:0:advanced:0:fillType', 'Solid')
  expect(tree.nodes.some(n => n.text || n.image)).toBe(true)
  expect(html(text)).not.toContain('linear-gradient')
})
it.each([
 ['RadialGradient', 'RadialGradient(colors: [.red, .blue], center: .topLeading, startRadius: 5, endRadius: 90)', 'radialGradient'],
 ['AngularGradient', 'AngularGradient(colors: [.red, .blue], center: .center, angle: .degrees(45))', 'angularGradient'],
] as const)('F13 paints %s foreground geometry and inherits it through groups', (_, gradient, kind) => {
 const text = source(`VStack { Text("Gradient"); Image(systemName: "heart.fill"); Text("Solid").foregroundStyle(Color.green) }.foregroundStyle(${gradient})`)
 const tree = render(text)
 expect(tree.nodes.find(n => n.text?.runs[0]?.text === 'Gradient')?.text?.runs[0]?.foregroundFill?.kind).toBe(kind)
 expect(tree.nodes.find(n => n.image)?.image?.foregroundFill?.kind).toBe(kind)
 expect(tree.nodes.find(n => n.text?.runs[0]?.text === 'Solid')?.text?.runs[0]?.foregroundFill).toBeUndefined()
 expect(html(text)).toContain(kind === 'radialGradient' ? 'circle 90px at 0% 0%' : 'from 135deg')
})
it.each(['scaleEffect(1.5)', 'rotationEffect(.degrees(30))'])('F14 Design edits anchors on %s and paints their origin', modifier => {
 const text = control(source(`Rectangle().frame(width: 100, height: 40).${modifier}`), 'Rectangle', 'modifier:1:advanced:anchor', 'topLeading')
 expect(text).toContain('anchor: .topLeading')
 expect(render(text).nodes.find(n => n.transform)?.transform?.anchor).toEqual({ x: 0, y: 0 })
 expect(html(text)).toContain('transform-origin:0% 0%')
})
it('F14 supports numeric UnitPoint anchors and nonuniform scaling', () => {
 const text = control(source('Rectangle().scaleEffect(x: 1.2, y: 0.8, anchor: UnitPoint(x: 0.2, y: 0.3))'), 'Rectangle', 'modifier:0:advanced:anchor:x', '0.7')
 expect(render(text).nodes.find(n => n.transform)?.transform).toMatchObject({ scaleX: 1.2, scaleY: 0.8, anchor: { x: 0.7, y: 0.3 } })
})
it('F14 edits CGSize scale and explicit Angle initializer forms', () => {
 let text = source('Rectangle().scaleEffect(CGSize(width: 1.2, height: 0.8), anchor: .topLeading).rotationEffect(Angle(degrees: 15), anchor: .bottom)')
 text = control(text, 'Rectangle', 'modifier:0:advanced:0:width', '-1.5')
 text = control(text, 'Rectangle', 'modifier:1:advanced:0:angle', '40')
 const tree = render(text)
 expect(tree.nodes.find(n => n.transform?.scaleX === -1.5)?.transform).toMatchObject({ scaleY: 0.8, anchor: {x:0,y:0} })
 expect(tree.nodes.find(n => n.transform?.rotate === 40)?.transform?.anchor).toEqual({x:0.5,y:1})
})
it.each(projectionCases)('F15 matches Apple projection: $axis, $anchor, depth $anchorZ, perspective $perspective, size $size', fixture => {
 const [x, y, z] = fixture.axis as [number,number,number], [ax, ay] = fixture.anchor as [number,number], [width, height] = fixture.size as [number,number]
 const t = { scaleX: 1, scaleY: 1, rotate: 0, anchor: { x: ax, y: ay }, rotation3D: { degrees: fixture.degrees, x, y, z, anchorZ: fixture.anchorZ, perspective: fixture.perspective } }
 rotationProjection(t, { width, height }).forEach((value, i) => expect(value).toBeCloseTo(fixture.matrix[i]!, 10))
 expect(cssTransform(t, { width, height })).toContain('matrix3d(')
})
it('F15 edits every 3D parameter through Design and preserves it in rendering', () => {
 let text = edit(source('Rectangle().frame(width: 200, height: 100)'), 'Rectangle', { kind: 'modifier-add', name: 'rotation3DEffect' })
 for (const [id, value] of [['axis:0','1'], ['axis:1','1'], ['axis:2','1'], ['anchor','bottomTrailing'], ['anchorZ','30'], ['perspective','0.4'], ['0:angle','60']]) text = control(text, 'Rectangle', `modifier:1:advanced:${id}`, value!)
 expect(text).toContain('axis: (x: 1, y: 1, z: 1), anchor: .bottomTrailing, anchorZ: 30, perspective: 0.4')
 expect(render(text).nodes.find(n => n.transform)?.transform).toMatchObject({ anchor: { x: 1, y: 1 }, rotation3D: { degrees: 60, x: 1, y: 1, z: 1, anchorZ: 30, perspective: 0.4 } })
 expect(html(text)).toContain('matrix3d(')
 expect(html(text)).not.toContain('640px')
})
it('F16 edits ideal and bounded dimensions and honors unspecified proposals', () => {
 let text = source('Rectangle().fill(Color.blue).frame(idealWidth: 160, idealHeight: 80).fixedSize()')
 expect(blue(text).frame).toMatchObject({ width: 160, height: 80 })
 text = set(text, 'Rectangle', 'frame', '210', 'frame · idealWidth')
 text = control(text, 'Rectangle', 'modifier:1:advanced:maxWidth', '180')
 expect(text).toContain('idealWidth: 210, maxWidth: 180, idealHeight: 80')
 expect(blue(text).frame).toMatchObject({ width: 180, height: 80 })
 expect(blue(source('Rectangle().fill(Color.blue).frame(idealWidth: 160, idealHeight: 80).frame(width: 200, height: 100)')).frame).toMatchObject({ width: 200, height: 100 })
})
it('F17 diagnoses non-SwiftUI placeholder while retaining explicitly declared extensions', () => {
 const text = source('TextField("Input", text: $input).placeholder("Not SwiftUI")')
 const result = compile({ files: files(text), revision: 1, colorScheme: 'light', canvas: { width: 393, height: 852 } })
 expect(result.diagnostics.some(d => d.severity === 'error' && d.message.includes('SwiftUI has no .placeholder'))).toBe(true)
 const custom = text + '\nextension View { func placeholder(_ label: String) -> some View { self } }'
 expect(model(custom).diagnostics.some(d => d.message.includes('SwiftUI has no .placeholder'))).toBe(false)
 render(source('TextField("Actual placeholder", text: $input)'))
})
it('F18 adds indicators on a new scroll view and updates its scroll payload', () => {
 const text = control(source('ScrollView { Text("Content") }'), 'ScrollView', 'scroll:indicators', 'false')
 expect(text).toContain('ScrollView(showsIndicators: false)')
 expect(render(text).nodes.find(n => n.scroll)?.scroll?.showsIndicators).toBe(false)
})
it.each(['horizontal', 'vertical', 'leading', 'trailing', 'top', 'bottom'])('F18 changes padding edges to %s without changing its amount', edge => {
 const text = control(source('Rectangle().fill(Color.blue).frame(width: 100, height: 50).padding(20).background(Color.red)'), 'Rectangle', 'modifier:2:advanced:edges', edge)
 expect(text).toContain(`.padding(.${edge}, 20)`)
 const tree = render(text), red = tree.nodes.find(n => n.background?.kind === 'solid' && n.background.color.r === 255 && n.background.color.g < 100)!
 expect(red.frame.width).toBe(100 + (edge === 'horizontal' ? 40 : ['leading', 'trailing'].includes(edge) ? 20 : 0))
 expect(red.frame.height).toBe(50 + (edge === 'vertical' ? 40 : ['top', 'bottom'].includes(edge) ? 20 : 0))
})
it.each(['Fit','Fill','Stretch','Intrinsic'])('F18 changes image sizing to %s and keeps resizable before general View modifiers', mode => {
 const text = control(source('Image(systemName: "star.fill").frame(width: 100, height: 60)'), 'Image', 'image:sizing', mode)
 expect(text.indexOf('.resizable()') < text.indexOf('.frame(')).toBe(true)
 expect(render(text).nodes.find(n => n.image)?.image?.resizable).toBe(mode !== 'Intrinsic')
 if (mode === 'Fit') expect(text).toContain('.scaledToFit()')
 if (mode === 'Fill') expect(text).toContain('.scaledToFill()')
})
it.each(['LazyVGrid','LazyHGrid'])('F18 edits %s track definitions, bounds, spacing and alignment', name => {
 const axis = name === 'LazyVGrid' ? 'columns' : 'rows'
 let text = source(`${name}(${axis}: [GridItem(.fixed(60)), GridItem(.flexible())]) { Text("A"); Text("B"); Text("C") }`)
 text = control(text, name, 'grid:count', '3')
 text = control(text, name, 'grid:0:size', '90')
 text = control(text, name, 'grid:0:spacing', '24')
 text = control(text, name, 'grid:1:min', '30')
 text = control(text, name, 'grid:1:max', '50')
 text = control(text, name, 'grid:1:alignment', 'topLeading')
 text = control(text, name, 'grid:spacing', '20')
 expect(text).toContain('GridItem(.fixed(90), spacing: 24)')
 expect(text).toContain('GridItem(.flexible(minimum: 30, maximum: 50), alignment: .topLeading)')
 expect(strings(text)).toEqual(['A','B','C'])
 const changed = render(text), original = render(source(`${name}(${axis}: [GridItem(.fixed(60)), GridItem(.flexible())]) { Text("A"); Text("B"); Text("C") }`))
 expect(changed.nodes.filter(n => n.text).map(n => n.frame)).not.toEqual(original.nodes.filter(n => n.text).map(n => n.frame))
})
it('F18 preserves computed values, developer comments and bindings', () => {
 const text = source('Rectangle().scaleEffect(amount, anchor: .center).padding(.horizontal, 12 /* retain */)')
 const node = find(text, 'Rectangle')
 expect(node.controls?.some(c => c.kind === 'number' && c.source.start === text.indexOf('amount, anchor'))).toBe(false)
 const changed = control(text, 'Rectangle', 'modifier:0:advanced:anchor', 'top')
 expect(changed).toContain('scaleEffect(amount, anchor: .top)')
 expect(changed).toContain('12 /* retain */')
 expect(find(source('Image(systemName: "star").resizable().frame(width: 60)'), 'Image').modifiers?.find(m => m.name === 'resizable')?.capabilities.moveDown).toBe(false)
})
it.each([
 ['Toggle','Toggle("Toggle", isOn: $enabled)','toggleStyle','button'],
 ['Picker','Picker("Pick", selection: $selection) { Text("A").tag(0); Text("B").tag(1) }','pickerStyle','segmented'],
 ['ProgressView','ProgressView(value: amount)','progressViewStyle','circular'],
 ['Label','Label("Label", systemImage: "star")','labelStyle','iconOnly'],
 ['TextField','TextField("Input", text: $input)','textFieldStyle','plain'],
 ['List','List { Text("First") }','listStyle','inset'],
])('F18 adds and edits %s style through Design', (name, body, modifier, value) => {
 let text = edit(source(body), name!, { kind: 'modifier-add', name: modifier! })
 const before = html(text)
 text = set(text, name!, modifier!, value!)
 expect(text).toContain(`.${modifier}(.${value})`)
 expect(html(text)).not.toEqual(before)
})
it.each(['Date()', 'Date(timeIntervalSince1970:1700000000)', 'Date( timeIntervalSince1970: -123.5 )', 'Date.now'])('F19 discovers inferred %s and allows rebinding', initializer => {
 const text = source('DatePicker("Date", selection: $date)').replace('@State var date = Date()', `@State var date = Date(); @State var other = ${initializer}`)
 expect(model(text).inputs?.find(s => s.name === 'other')?.type).toBe('Date')
 const changed = edit(text, 'DatePicker', { kind: 'bind-state', name: 'other' })
 expect(changed).toContain('selection: $other')
 render(changed)
})
it.each(['Color.blue','Color( red: 0.2, green: 0.4, blue: 0.8 )'])('F19 discovers inferred %s and allows rebinding', initializer => {
 const text = source('ColorPicker("Color", selection: $chosen)').replace('@State var enabled', `@State var chosen = Color.red; @State var other = ${initializer}; @State var enabled`)
 expect(model(text).inputs?.find(s => s.name === 'other')?.type).toBe('Color')
 const changed = edit(text, 'ColorPicker', { kind: 'bind-state', name: 'other' })
 expect(changed).toContain('selection: $other')
 render(changed)
})
it.each([['Date','Date()','DatePicker("Date", selection: $other)',1700000000], ['Color','Color.blue','ColorPicker("Color", selection: $other)','#00FF00']] as const)('F19 applies typed %s preview states without changing source', (type, initializer, body, value) => {
 const text = source(type === 'Color' ? `VStack { ${body}; Rectangle().fill(other).frame(width: 30, height: 30) }` : body).replace('@State var enabled', `@State var other: ${type} = ${initializer}; @State var enabled`)
 const snapshot = model(text), state = snapshot.inputs!.find(s => s.name === 'other')!
 expect(state.type).toBe(type)
 const scenario = { name:'Changed', owner: 'ContentView', hook: '', inputs: [{ owner: state.owner, name: state.name, signature: state.signature, value }] }
 expect(validatePreviewScenario(snapshot, scenario)).toBeNull()
 const result = compile({ files: files(text), revision: 2, colorScheme: 'light', canvas: { width: 393, height: 852 }, scenario })
 expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
 expect(result.renderTree).toBeDefined()
 if (type === 'Date') expect(result.renderTree!.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []).join(' ')).toContain('2023')
 else expect(result.renderTree!.nodes.some(n => { const fill = n.background ?? n.shape?.fill; return fill?.kind === 'solid' && fill.color.r === 0 && fill.color.g === 255 && fill.color.b === 0 })).toBe(true)
})
const catalogFixtures = [
 ['Text', 'Text("Sample")'], ['Image','Image(systemName: "star.fill")'], ['Toggle','Toggle("Enabled", isOn: $enabled)'],
 ['Picker','Picker("Select", selection: $selection) { Text("One").tag(0); Text("Two").tag(1) }'],
 ['ProgressView','ProgressView(value: amount)'], ['Gauge','Gauge(value: amount) { Text("Level") }'], ['List','List { Text("Row") }'],
 ['TextField','TextField("Input", text: $input)'], ['Label','Label("Label", systemImage: "star")'],
] as const
for (const [name, body] of catalogFixtures) {
 const text = source(body), catalog = find(text, name).modifierCatalog?.filter(m => !m.hidden && m.available) ?? []
 const generic = new Set(find(source(catalogFixtures[0][1]), 'Text').modifierCatalog?.filter(m => !m.hidden && m.available).map(m => m.name))
 for (const item of catalog.filter(m => name === 'Text' || !generic.has(m.name))) it(`F18 catalog ${name}: ${item.name} produces editable, renderable Swift`, () => {
   const changed = edit(text, name, { kind: 'modifier-add', name: item.name })
   const actualName = item.name === 'frameFlexible' ? 'frame' : item.name
   const modifier = find(changed, name).modifiers?.find(m => m.name === actualName)
   expect(modifier, changed).toBeDefined()
   if (!['bold','italic','underline','strikethrough','clipped'].includes(actualName)) expect(modifier!.controls.length, changed).toBeGreaterThan(0)
   render(changed)
 })
}
