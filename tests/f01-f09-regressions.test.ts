import { beforeEach, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { SERIF_FAMILY, MEASURED_FAMILIES, type AuthoringNode, type DesignEditRequest } from '@studio/shared'
import { screenOverrideModifier } from '../apps/web/lib/screens'

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
  return result.changes[0]!.after!
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

it('F01 blocks generic styling on Tab, while its content and a custom View named Tab remain editable', () => {
  const text = source('TabView(selection: $selection) { Tab("Home", systemImage: "house", value: 0) { Text("Hello") } }')
  const tab = find(text, 'Tab')
  expect(tab.modifierCatalog?.some(m => m.available)).toBe(false)
  expect(tab.modifierCatalog?.find(m => m.name === 'font')?.reason).toContain('inside this tab')
  expect(plan(text, tab, { kind: 'modifier-add', name: 'font' })).toMatchObject({ ok: false })
  const changed = edit(text, 'Text', { kind: 'modifier-add', name: 'font' })
  expect(changed).toContain('Text("Hello").font(.body)')
  render(changed)
  const custom = source('Tab()') + '\nstruct Tab: View { var body: some View { Text("Custom") } }'
  expect(find(custom, 'Tab').modifierCatalog?.find(m => m.name === 'font')?.available).toBe(true)
  const invalid = compile({ files: files(text.replace('Text("Hello") }', 'Text("Hello") }.font(.body)')), revision: 2, colorScheme: 'light', canvas: { width: 393, height: 852 } })
  expect(invalid.diagnostics.some(d => /TabContent/.test(d.message))).toBe(true)
})

const gradients = [
  ['LinearGradient', 'LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing)'],
  ['RadialGradient', 'RadialGradient(colors: [.red, .blue], center: .center, startRadius: 0, endRadius: 100)'],
  ['AngularGradient', 'AngularGradient(colors: [.red, .blue], center: .center)'],
] as const
it.each(gradients)('F02 edits %s opacity in Design, Swift and the painted fill', (name, body) => {
  let text = edit(source(body), name, { kind: 'modifier-add', name: 'opacity' })
  render(text)
  text = set(text, name, 'opacity', '0.4')
  expect(text).toContain('.opacity(0.4)')
  const kind = name[0]!.toLowerCase() + name.slice(1)
  const fill = render(text).nodes.find(n => n.background?.kind === kind)?.background
  expect(fill?.kind).toBe(kind)
  if (fill && fill.kind !== 'solid') expect(fill.stops.map(s => s.color.a)).toEqual([0.4, 0.4])
})
it('F02 preserves nested ShapeStyle alpha in fill/background values and material blur', () => {
  const gradient = render(source(`Rectangle().fill(${gradients[0][1]}.opacity(0.5).opacity(0.5))`)).nodes.find(n => n.shape?.fill?.kind === 'linearGradient')?.shape?.fill
  if (gradient?.kind !== 'linearGradient') throw new Error('Missing gradient')
  expect(gradient.stops.map(s => s.color.a)).toEqual([0.25, 0.25])
  const material = render(source('Text("Material").padding().background(.regularMaterial.opacity(0.5).opacity(0.5))'))
  expect(material.nodes.find(n => n.material)?.material?.blur).toBeGreaterThan(0)
  expect(material.nodes.find(n => n.material)?.opacity).toBe(0.25)
})

it.each(['.disabled(false).disabled(true)', '.disabled(true).disabled(false)', '.disabled(true).disabled(true)'])('F03 resolves %s as disabled', chain => {
  const text = source(`Button("Press") { count += 1 }${chain}`)
  expect(render(text).nodes.find(n => n.hitTarget?.role === 'button')?.hitTarget?.enabled).toBe(false)
  expect(html(text)).toContain('aria-disabled="true"')
})
it('F03 updates the second Design value and keeps inherited disabling through Group', () => {
  let text = source('Button("Press") { count += 1 }.disabled(false).disabled(false)')
  expect(render(text).nodes.find(n => n.hitTarget)?.hitTarget?.enabled).toBe(true)
  text = set(text, 'Button', 'disabled', 'true')
  expect(text).toContain('.disabled(false).disabled(true)')
  expect(render(text).nodes.find(n => n.hitTarget)?.hitTarget?.enabled).toBe(false)
  expect(render(text).nodes.some(n => n.opacity === 0.4)).toBe(true)
  const inherited = source('VStack { Group { Button("Press") { }.disabled(false) } }.disabled(false).disabled(true)')
  expect(render(inherited).nodes.find(n => n.hitTarget)?.hitTarget?.enabled).toBe(false)
})

it.each([1, 2, 3])('F04 paints span %i once using the window width, including padded nesting', span => {
  const body = `Rectangle().fill(.blue).containerRelativeFrame(.horizontal, count: 3, span: ${span}, spacing: 8).frame(height: 50)`
  for (const view of [body, `VStack { ${body} }.padding(50)`, `HStack { ${body} }.frame(width: 200)`]) {
    expect(blue(source(view)).frame.width).toBeCloseTo((393 - 16) / 3 * span + 8 * (span - 1), 4)
    expect(blue(source(view)).frame.height).toBe(50)
  }
})
it('F04 uses the nearest scroll viewport and supports both axes', () => {
  const text = source('ScrollView(.horizontal) { HStack { Rectangle().fill(.blue).containerRelativeFrame([.horizontal, .vertical], count: 3, span: 2, spacing: 8) }.padding(10) }.frame(width: 300, height: 180)')
  const frame = blue(text).frame
  expect(frame.width).toBeCloseTo((300 - 16) / 3 * 2 + 8, 4)
  expect(frame.height).toBeCloseTo((180 - 16) / 3 * 2 + 8, 4)
})
it('F04 aligns intrinsic content inside the requested container frame', () => {
  const text = source('Text("Anchor").containerRelativeFrame(.horizontal, alignment: .trailing).background(.blue)')
  const tree = render(text), label = tree.nodes.find(n => n.text?.runs.some(r => r.text === 'Anchor'))!, background = blue(text)
  expect(label.frame.x + label.frame.width).toBeCloseTo(background.frame.x + background.frame.width, 4)
})

it.each(['TextField("Input", text: $input)', 'SecureField("Input", text: $input)', 'TextEditor(text: $input)'])('F05 applies edited italic/alignment to the actual %s control', body => {
  const name = body.split('(')[0]!
  let text = edit(source(body), name, { kind: 'modifier-add', name: 'italic' })
  text = edit(text, name, { kind: 'modifier-add', name: 'multilineTextAlignment' })
  text = set(text, name, 'multilineTextAlignment', 'trailing')
  expect(text).toContain('.italic()')
  expect(text).toContain('.multilineTextAlignment(.trailing)')
  const markup = html(text)
  const input = markup.match(/<(?:input|textarea)[^>]*>/)?.[0]
  expect(input).toContain('font-style:italic')
  expect(input).toContain('text-align:end')
})
it('F05 keeps styled input text visible in Design and screenshot renders without event handlers', () => {
  const tree = render(source('TextField("Input", text: $input).italic().multilineTextAlignment(.trailing)'))
  const markup = renderToStaticMarkup(createElement(RenderTreeView, { tree }))
  const input = markup.match(/<input[^>]*>/)?.[0]
  expect(input).toContain('value="Input text"')
  expect(input).toContain('readOnly=""')
  expect(input).toContain('tabindex="-1"')
  expect(input).toContain('font-style:italic')
  expect(input).toContain('text-align:end')
})
it('F05 inherits typography from the parent', () => {
  const markup = html(source('VStack { TextField("Input", text: $input) }.italic().multilineTextAlignment(.center)'))
  expect(markup.match(/<input[^>]*>/)?.[0]).toContain('font-style:italic')
  expect(markup.match(/<input[^>]*>/)?.[0]).toContain('text-align:center')
})
it('F06 changes Design font selection, Swift source, paint and measured font family', () => {
  let text = source('Text("Serif").font(.system(size: 24, weight: .regular, design: .default))')
  text = set(text, 'Text', 'font', 'serif', 'Font design')
  expect(text).toContain('design: .serif')
  expect(render(text).nodes.find(n => n.text)?.text?.runs[0]?.font.family).toBe(SERIF_FAMILY)
  expect(html(text)).toContain('ui-serif')
  expect(MEASURED_FAMILIES).toContain(SERIF_FAMILY)
})
it.each(['Text("Serif").fontDesign(.serif)', 'Text("Serif").font(.system(.title, design: .serif))', 'VStack { Text("Serif") }.fontDesign(.serif)', '(Text("Serif").fontDesign(.serif) + Text("Default"))'])('F06 resolves all serif paths: %s', body => {
  const run = render(source(body)).nodes.flatMap(n => n.text?.runs ?? []).find(r => r.text === 'Serif')
  expect(run?.font.family).toBe(SERIF_FAMILY)
})

const extendedViews: readonly (readonly [string, string])[] = [
  [
    "LazyVStack",
    "LazyVStack(alignment: .leading, spacing: 8) { Text(\"One\"); Text(\"Two\") }"
  ],
  [
    "LazyHStack",
    "LazyHStack(alignment: .top, spacing: 8) { Text(\"One\"); Text(\"Two\") }"
  ],
  [
    "LazyHGrid",
    "LazyHGrid(rows: [GridItem(.fixed(40)), GridItem(.fixed(40))], spacing: 8) { Text(\"One\"); Text(\"Two\") }"
  ],
  [
    "Grid",
    "Grid(alignment: .center, horizontalSpacing: 12, verticalSpacing: 8) { GridRow { Text(\"One\"); Text(\"Two\") } }"
  ],
  [
    "GridRow",
    "GridRow { Text(\"One\"); Text(\"Two\") }"
  ],
  [
    "ViewThatFits",
    "ViewThatFits { Text(\"Wide content\"); Text(\"Short\") }"
  ],
  [
    "GeometryReader",
    "GeometryReader { proxy in Text(\"Size\").frame(width: proxy.size.width) }"
  ],
  [
    "SecureField",
    "SecureField(\"Password\", text: $input)"
  ],
  [
    "NavigationView",
    "NavigationView { Text(\"Navigation\") }"
  ],
  [
    "DisclosureGroup",
    "DisclosureGroup(\"Details\") { Text(\"Content\") }"
  ],
  [
    "AnyView",
    "AnyView(Text(\"Wrapped\"))"
  ],
  [
    "ControlGroup",
    "ControlGroup { Button(\"One\") { }; Button(\"Two\") { } }"
  ],
  [
    "NavigationSplitView",
    "NavigationSplitView { Text(\"Sidebar\") } detail: { Text(\"Detail\") }"
  ],
  [
    "TimelineView",
    "TimelineView(.periodic(from: .now, by: 1)) { context in Text(\"Time\") }"
  ],
  [
    "TextEditor",
    "TextEditor(text: $input)"
  ],
  [
    "Menu",
    "Menu(\"Options\") { Button(\"One\") { } }"
  ],
  [
    "ShareLink",
    "ShareLink(item: \"Hello\")"
  ],
  [
    "Gauge",
    "Gauge(value: 0.5) { Text(\"Value\") }"
  ],
  [
    "AsyncImage",
    "AsyncImage(url: URL(string: \"https://example.com/photo.png\"))"
  ],
  [
    "ContentUnavailableView",
    "ContentUnavailableView(\"Empty\", systemImage: \"tray\", description: Text(\"Nothing yet\"))"
  ],
  [
    "Ellipse",
    "Ellipse().fill(Color.blue).frame(width: 100, height: 60)"
  ],
  [
    "Path",
    "Path { path in path.addRect(CGRect(x: 0, y: 0, width: 100, height: 60)) }.fill(Color.blue)"
  ],
  [
    "Canvas",
    "Canvas { context, size in context.fill(Path(CGRect(x: 0, y: 0, width: 100, height: 60)), with: .color(.blue)) }"
  ],
  [
    "LinearGradient",
    "LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing)"
  ],
  [
    "RadialGradient",
    "RadialGradient(colors: [.red, .blue], center: .center, startRadius: 0, endRadius: 100)"
  ],
  [
    "AngularGradient",
    "AngularGradient(colors: [.red, .blue], center: .center)"
  ],
  [
    "EmptyView",
    "EmptyView()"
  ]
]
it.each(extendedViews)('F07 keeps generic modifier editors on %s and renders the edited result', (name, body) => {
  let text = source(body + '.frame(width: 220, height: 80).background(Color.blue)')
  text = edit(text, name, { kind: 'modifier-add', name: 'opacity' })
  text = set(text, name, 'opacity', '0.4')
  expect(text).toContain('.opacity(0.4)')
  expect(find(text, name).modifiers?.find(m => m.name === 'opacity')?.controls[0]?.value).toBe('0.4')
  if (name === 'NavigationView' || name === 'NavigationSplitView') {
    // Navigation is resolved before layout. Its inherited foreground is a visible
    // setting, whereas whole-container geometry/effects need a separate renderer pass.
    text = edit(text, name, { kind: 'modifier-add', name: 'foregroundStyle' })
    text = set(text, name, 'foregroundStyle', 'red')
    expect(render(text).nodes.flatMap(n => n.text?.runs ?? []).some(run => run.color.r > run.color.b)).toBe(true)
  } else expect(render(text).nodes.some(n => n.opacity === 0.4)).toBe(true)
})
it('F07 edits lazy-stack spacing without changing its type or child source', () => {
  const text = source('LazyVStack(spacing: 8) { Text("One"); Text("Two") }')
  const changed = edit(text, 'LazyVStack', { kind: 'property', control: 'spacing', value: '30' })
  expect(changed).toBe(text.replace('spacing: 8', 'spacing: 30'))
  const labels = render(changed).nodes.filter(n => n.text)
  expect(labels[1]!.frame.y - labels[0]!.frame.y - labels[0]!.frame.height).toBeCloseTo(30)
  expect(model(text, '13.0').nodes.find(n => n.name === 'LazyVStack')?.modifierCatalog?.some(m => m.available)).toBe(false)
})
const overloads = [
 ['ScrollView', 'ScrollView(showsIndicators: false) { Text("One") }'],
 ['Slider', 'Slider(value: $amount, in: 0...10, step: 1)'],
 ['TextField', 'TextField("Input", text: $input, axis: .vertical)'],
 ['DatePicker', 'DatePicker("Date", selection: $date, displayedComponents: [.hourAndMinute])'],
 ['Button', 'Button { count += 1 } label: { Text("Press") }'],
] as const
it.each(overloads)('F08 retains existing modifier editors with %s overloads', (name, body) => {
  const before = source(body + '.padding(8).background(Color.blue)')
  const changed = set(before, name, 'padding', '20')
  expect(changed).toBe(before.replace('.padding(8)', '.padding(20)'))
  expect(render(changed).nodes.map(n => n.frame)).not.toEqual(render(before).nodes.map(n => n.frame))
})
it('F08 inserts the positional ScrollView axis before named arguments', () => {
  const text = source('ScrollView(showsIndicators: false) { Text("One") }')
  const changed = edit(text, 'ScrollView', { kind: 'property', control: 'scroll:axis', value: 'horizontal' })
  expect(changed).toContain('ScrollView(.horizontal, showsIndicators: false)')
  expect(render(changed).nodes.find(n => n.scroll)?.scroll?.axis).toBe('horizontal')
})

it('F09 exposes the existing system font and foregroundStyle and edits their effective values', () => {
  let text = source('Text("Override").font(.system(size: 40)).foregroundStyle(Color.red)')
  const root = find(text, 'Text')
  expect(screenOverrideModifier(root, 'font')?.controls.some(c => c.label === 'Font size')).toBe(true)
  expect(screenOverrideModifier(root, 'foregroundColor')?.name).toBe('foregroundStyle')
  expect(screenOverrideModifier(root, 'tint')).toBeUndefined()
  text = set(text, 'Text', 'font', '24', 'Font size')
  text = set(text, 'Text', 'foregroundStyle', 'blue')
  expect(text.match(/\.font\(/g)).toHaveLength(1)
  expect(text).not.toContain('.foregroundColor(')
  const run = render(text).nodes.find(n => n.text)?.text?.runs[0]
  expect(run?.font.size).toBe(24)
  expect(run?.color.b).toBeGreaterThan(run?.color.r ?? 255)
})
it('F09 selects the nearest enabled alias and sends advanced existing values to Code', () => {
  const text = source('Text("Override").foregroundStyle(.red).foregroundColor(.blue).font(.system(size: 20 + 20))')
  expect(screenOverrideModifier(find(text, 'Text'), 'foregroundColor')?.name).toBe('foregroundStyle')
  const font = screenOverrideModifier(find(text, 'Text'), 'font')
  expect(font).toBeDefined()
  expect(font?.controls).toEqual([])
  const first = screenOverrideModifier(find(text, 'Text'), 'foregroundColor')!
  const changed = edit(text, 'Text', { kind: 'modifier-toggle', modifier: first.id, enabled: false })
  expect(screenOverrideModifier(find(changed, 'Text'), 'foregroundColor')?.name).toBe('foregroundColor')
})
