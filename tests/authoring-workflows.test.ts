import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildAuthoringModel, planDesignEdit, scenarioFiles } from '@studio/swift-sema'
import { Parser } from '@studio/swift-syntax'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { applyProjectTransaction, DocumentHistory, emptyStudioMetadata, projectFromFiles, readStudioMetadata, encodeProject, decodeProject } from '@studio/project-model'
import { buildExportBundle } from '@studio/exporter'
import type { ComponentDescription, CompileResult, DesignEditRequest, PreviewScenario, SourceFile } from '@studio/shared'

const app = (body: string, members = '', extra = '') => `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { ${members}\nvar body: some View { ${body} } }\n${extra}`
const product = 'struct Product: Identifiable { let id: String; var title: String; var price: Double; var featured: Bool; var subtitle: String? }'
const records = '@State private var products: [Product] = [Product(id: "p1", title: "First", price: 12, featured: false, subtitle: nil), Product(id: "p2", title: "Second", price: 24, featured: true, subtitle: "Extra")]'
const list = (rows = 'VStack { Text(item.title); Text(item.subtitle ?? "") }') => app(`List(products) { item in ${rows} }`, records, product)
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
const model = (sources: readonly SourceFile[], descriptions?: readonly ComponentDescription[]) => buildAuthoringModel({ projectId: 'p', revision: 1, files: sources, componentDescriptions: descriptions })
const target = (sources: readonly SourceFile[], name: string, index = 0) => model(sources).nodes.filter(n => n.name === name && n.kind !== 'definition')[index]!
function plan(sources: readonly SourceFile[], name: string, operation: DesignEditRequest['operation'], index = 0, descriptions?: readonly ComponentDescription[]) {
  expect(model(sources).diagnostics).toEqual([])
  const node = target(sources, name, index)
  expect(node, name).toBeDefined()
  return planDesignEdit({ projectId: 'p', baseRevision: 1, scope: node.owner, files: sources, target: node.source, fingerprint: node.fingerprint, operation, componentDescriptions: descriptions })
}
function edit(sources: readonly SourceFile[], name: string, operation: DesignEditRequest['operation'], index = 0, descriptions?: readonly ComponentDescription[]): SourceFile[] {
  const result = plan(sources, name, operation, index, descriptions)
  if (!result.ok) throw new Error(result.reason)
  return [...sources.map(f => ({ ...f, text: result.changes.find(c => c.file === f.id)?.after ?? f.text })), ...result.changes.filter(c => c.before === null).map(c => ({ id: c.file, text: c.after }))]
}
let revision = 1
function render(sources: readonly SourceFile[], scenario?: PreviewScenario, projectId = 'p') {
  const result = compile({ files: sources, projectId, scenario, revision: revision++, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result
}
const texts = (r: CompileResult) => r.renderTree?.nodes.flatMap(n => n.text?.runs.map(t => t.text) ?? []) ?? []
function tap(r: CompileResult, label: string) {
  const button = r.renderTree?.nodes.find(n => n.hitTarget && n.a11y?.label === label)
  expect(button, label).toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: button!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(revision++)
}
beforeEach(resetPipelineState)

describe('Phase 4: logical collections and source-owned data', () => {
  it('keeps 100 evaluated records on one source template, including conditional rows', () => {
    let source = files(list('VStack { Text(item.title); if item.featured { Text("Featured") } }'))
    const data = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, title: `Row ${i}`, price: i, featured: i % 2 === 0, subtitle: null }))
    source = edit(source, 'List', { kind: 'records', records: data })
    const result = render(source), snapshot = result.authoring!
    expect(snapshot.nodes.filter(n => n.kind === 'template')).toHaveLength(1)
    expect(snapshot.nodes.find(n => n.name === 'Text')?.runtimeIds).toHaveLength(100)
    expect(snapshot.nodes.filter(n => n.kind === 'branch')).toHaveLength(1)
    expect(target(source, 'List').collection?.records).toHaveLength(100)
    const text = target(source, 'Text'), control = text.controls!.find(c => c.label === 'Padding')!
    source = edit(source, 'Text', { kind: 'property', control: control.id, value: '12' })
    expect(source[0]!.text).toContain('Text(item.title).padding(12)')
    expect(render(source).authoring!.nodes.find(n => n.name === 'Text')?.runtimeIds).toHaveLength(100)
  })
  it('keeps static heterogeneous rows distinct and rejects destructive conversion', () => {
    const source = files(app('List { Text("Title"); Toggle("On", isOn: $on) }', '@State var on = false'))
    expect(model(source).nodes.filter(n => n.kind === 'template')).toHaveLength(0)
    expect(plan(source, 'List', { kind: 'collection-convert', name: 'items', recordType: 'Item' })).toMatchObject({ ok: false })
    const next = edit(source, 'List', { kind: 'insert', snippet: 'Text("Third")' })
    expect(next[0]!.text).toContain('Toggle("On", isOn: $on)')
    expect(texts(render(next))).toContain('Third')
  })
  it('converts one static row to real typed state, preserving row and list modifiers', () => {
    const source = files(app('List { Text("Hello").padding(8) }.listStyle(.plain)'))
    const next = edit(source, 'List', { kind: 'collection-convert', name: 'items', recordType: 'Item' })
    expect(next[0]!.text).toContain('Text(item.title).padding(8)')
    expect(next[0]!.text).toContain('.listStyle(.plain)')
    expect(target(next, 'List').collection?.records).toEqual([{ id: 'item-1', title: 'Hello' }])
    expect(texts(render(next))).toContain('Hello')
  })
  it('adds to the row template once and renders it in every row', () => {
    const source = edit(files(list()), 'Row template', { kind: 'insert', snippet: 'Text("Shared")' })
    expect(source[0]!.text.match(/Text\("Shared"\)/g)).toHaveLength(1)
    expect(texts(render(source)).filter(t => t === 'Shared')).toHaveLength(2)
  })
  it('binds fields with type-aware conversion and optional handling', () => {
    const source = files(list())
    const price = edit(source, 'Text', { kind: 'bind-field', field: 'price' })
    expect(price[0]!.text).toContain('Text(String(item.price))')
    expect(texts(render(price))).toContain('12.0')
    const optional = edit(source, 'Text', { kind: 'bind-field', field: 'subtitle' })
    expect(optional[0]!.text).toContain('Text((item.subtitle ?? ""))')
    expect(texts(render(optional))).toContain('Extra')
    expect(plan(files(list('Text(item.title.uppercased())')), 'Text', { kind: 'bind-field', field: 'price' })).toMatchObject({ ok: false })
  })
  it('validates IDs, missing fields and types without partial changes', () => {
    const source = files(list()), info = target(source, 'List').collection!
    for (const records of [[info.records[0]!, info.records[0]!], [{ id: 'x', title: 'X', price: 'bad', featured: true }], [{ id: 'x' }]]) expect(plan(source, 'List', { kind: 'records', records })).toMatchObject({ ok: false })
    expect(plan(source, 'List', { kind: 'records', records: info.records })).toMatchObject({ ok: true, changes: [] })
  })
  it('keeps preview records in metadata and production bytes unchanged through export', () => {
    const source = edit(files(list()), 'List', { kind: 'empty-state', text: 'Nothing here' }), info = target(source, 'List').collection!
    const scenario: PreviewScenario = { name: 'Empty', owner: info.owner, hook: '', inputs: [{ owner: info.owner, name: info.name, signature: info.signature, value: [] }] }
    const original = JSON.stringify(source)
    expect(texts(render(source, scenario))).toContain('Nothing here')
    expect(texts(render(source))).toContain('First')
    expect(JSON.stringify(source)).toBe(original)
    const project = projectFromFiles(source.map(f => ({ name: f.id, text: f.text })))!
    const bundle = buildExportBundle({ ...project, studio: { ...emptyStudioMetadata(), scenarios: [scenario] } })
    expect([...bundle.values()].some(bytes => new TextDecoder().decode(bytes).includes('title: "First"'))).toBe(true)
  })
  it('preserves template identity after record reorder and insertion', () => {
    const source = files(list()), before = target(source, 'Text'), info = target(source, 'List').collection!
    const next = edit(source, 'List', { kind: 'records', records: [...info.records].reverse() })
    const after = target(next, 'Text')
    expect(after.fingerprint).toBe(before.fingerprint)
    expect(texts(render(next)).indexOf('Second')).toBeLessThan(texts(render(next)).indexOf('First'))
  })
})

describe('Phase 5: component scope, extraction and interfaces', () => {
  const card = 'enum Emphasis { case quiet, loud }\nstruct Card: View { var title: String = "Default"; var amount: Int = 1; var featured: Bool = false; var emphasis: Emphasis = .quiet; var body: some View { VStack { Text(title); if featured { Text("Featured") }; if emphasis == .loud { Text("Loud") } } } }'
  it('edits a single argument, adds omitted defaults in declaration order, and retains variants', () => {
    let source = files(app('VStack { Card(title: "First"); Card(title: "Second") }', '', card))
    source = edit(source, 'Card', { kind: 'property', control: 'component:featured', value: 'true' })
    source = edit(source, 'Card', { kind: 'property', control: 'component:amount', value: '3' })
    source = edit(source, 'Card', { kind: 'property', control: 'component:emphasis', value: 'loud' })
    expect(source[0]!.text).toContain('Card(title: "First", amount: 3, featured: true, emphasis: Emphasis.loud)')
    expect(source[0]!.text).toContain('Card(title: "Second")')
    const result = texts(render(source))
    expect(result.filter(t => t === 'Featured')).toHaveLength(1)
    expect(result.filter(t => t === 'Loud')).toHaveLength(1)
    expect(plan(source, 'Card', { kind: 'property', control: 'component:amount', value: '2.5' })).toMatchObject({ ok: false })
  })
  it('uses matching descriptions, invalidates renamed interfaces and never overwrites computed arguments', () => {
    const source = files(app('Card(title: title.uppercased())', 'let title = "Original"', card))
    expect(target(source, 'Card').controls?.some(c => c.id === 'component:title')).toBe(false)
    const info = target(source, 'Card').component!
    const desc = [{ owner: 'Card', signature: info.signature, properties: [{ name: 'amount', label: 'Quantity', description: 'Visible quantity', min: 1, max: 10 }] }]
    expect(model(source, desc).nodes.find(n => n.kind === 'component' && n.name === 'Card')?.controls?.find(c => c.id === 'component:amount')?.label).toBe('Quantity')
    expect(plan(source, 'Card', { kind: 'property', control: 'component:amount', value: '11' }, 0, desc)).toMatchObject({ ok: false })
    const renamed = files(source[0]!.text.replace('var amount:', 'var quantity:'))
    expect(model(renamed, desc).nodes.find(n => n.kind === 'component' && n.name === 'Card')?.controls?.find(c => c.id === 'component:quantity')?.label).toBe('quantity')
  })
  it('extracts a binding and named action into explicit parameters with atomic multi-file undo', () => {
    const source = files(app('VStack { Toggle("Flag", isOn: $flag); Button("Save") { save() } }', '@State var flag = false\nfunc save() { flag.toggle() }'))
    const p = plan(source, 'VStack', { kind: 'extract-component', name: 'Controls' })
    expect(p.ok).toBe(true); if (!p.ok) return
    expect(p.changes).toHaveLength(2)
    expect(p.changes.find(c => c.before === null)?.after).toContain('@Binding var flag: Bool')
    expect(p.changes.find(c => c.before === null)?.after).toContain('let save: () -> Void')
    const original = projectFromFiles(source.map(f => ({ name: f.id, text: f.text })))!, project = { ...original, id: 'p' }
    const result = applyProjectTransaction(project, 1, p)
    expect(result.ok).toBe(true); if (!result.ok) return
    const history = new DocumentHistory(); history.record(project, result.project, null, p.selection)
    expect(history.take('undo', result.project)?.project.files).toEqual(project.files)
    let rendered = render(result.project.files)
    rendered = tap(rendered, 'Save')
    expect(rendered.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  })
  it('declines extraction when a closure-local dependency cannot be safely inferred', () => {
    const source = files(app('VStack { ForEach(0..<3, id: \\.self) { index in Text(index.description) } }'))
    expect(plan(source, 'VStack', { kind: 'extract-component', name: 'Rows' })).toMatchObject({ ok: false })
  })
  it('retains unknown internals while editing a supported public parameter', () => {
    const source = files(app('Card(title: "A")', '', 'struct Card: View { let title: String; var body: some View { Text(title).customEffect(3) } }'))
    const next = edit(source, 'Card', { kind: 'property', control: 'component:title', value: 'B' })
    expect(next[0]!.text).toBe(source[0]!.text.replace('Card(title: "A")', 'Card(title: "B")'))
  })
})

describe('Phase 6: generated state and executable actions', () => {
  it('creates real state and binding together, without duplicate declarations', () => {
    const source = edit(files(app('Toggle("Enabled", isOn: .constant(false))')), 'Toggle', { kind: 'bind-state', name: 'enabled', create: { value: false } })
    expect(source[0]!.text).toContain('@State private var enabled: Bool = false')
    expect(source[0]!.text).toContain('isOn: $enabled')
    const result = render(source), node = result.renderTree?.nodes.find(n => n.hitTarget?.role === 'toggle')
    expect(node).toBeDefined()
    expect(applyEvent({ kind: 'toggle', handlerId: node!.hitTarget!.handlerId, value: true })).toBe(true)
    expect(rerender(revision++).diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(plan(source, 'Toggle', { kind: 'bind-state', name: 'enabled', create: { value: false } })).toMatchObject({ ok: false })
  })
  it('configures toggle and set actions while requiring explicit action replacement', () => {
    let source = files(app('VStack { Text(on ? "Yes" : "No"); Button("Change") { } }', '@State var on = false'))
    source = edit(source, 'Button', { kind: 'behavior', action: { type: 'toggle', state: 'on' }, replace: false })
    let result = render(source)
    expect(texts(result)).toContain('No')
    result = tap(result, 'Change'); expect(texts(result)).toContain('Yes')
    expect(plan(source, 'Button', { kind: 'behavior', action: { type: 'set', state: 'on', value: false }, replace: false })).toMatchObject({ ok: false })
    source = edit(source, 'Button', { kind: 'behavior', action: { type: 'set', state: 'on', value: false }, replace: true })
    expect(texts(tap(render(source), 'Change'))).toContain('No')
  })
  it('configures named actions without rewriting their bodies and rejects recursion', () => {
    const source = files(app('VStack { Text(title); Button("Save") { } }', '@State var title = "Before"\nfunc save() { title = "Saved" }\nfunc loop() { loop() }'))
    const next = edit(source, 'Button', { kind: 'behavior', action: { type: 'call', name: 'save' }, replace: false })
    expect(next[0]!.text).toContain('func save() { title = "Saved" }')
    expect(texts(tap(render(next), 'Save'))).toContain('Saved')
    for (const name of ['missing', 'loop']) expect(plan(source, 'Button', { kind: 'behavior', action: { type: 'call', name }, replace: false })).toMatchObject({ ok: false })
  })
  it('configures navigation and real sheet state with working presentation', () => {
    const extra = 'struct Detail: View { var body: some View { Text("Detail content") } }'
    const source = files(app('NavigationStack { Button("Open") { } }', '', extra))
    const navigation = edit(source, 'Button', { kind: 'behavior', action: { type: 'navigate', destination: 'Detail' }, replace: false })
    expect(texts(tap(render(navigation), 'Open'))).toContain('Detail content')
    resetPipelineState()
    const sheet = edit(source, 'Button', { kind: 'behavior', action: { type: 'sheet', destination: 'Detail' }, replace: false })
    expect(sheet[0]!.text).toContain('.sheet(isPresented: $isDetailPresented) { Detail() }')
    expect(texts(tap(render(sheet), 'Open'))).toContain('Detail content')
  })
  it('adds and deletes local records with stable IDs and duplicate protection', () => {
    let source = files(app('VStack { List(products) { item in Text(item.title) }; Button("Add") { }; Button("Delete") { } }', records, product))
    source = edit(source, 'Button', { kind: 'behavior', action: { type: 'append', collection: 'products', record: { id: 'p3', title: 'Third', price: 3, featured: false, subtitle: null } }, replace: false })
    source = edit(source, 'Button', { kind: 'behavior', action: { type: 'delete', collection: 'products', id: 'p1' }, replace: false }, 1)
    let result = tap(render(source), 'Add'); expect(texts(result)).toContain('Third')
    result = tap(result, 'Add'); expect(texts(result).filter(t => t === 'Third')).toHaveLength(1)
    result = tap(result, 'Delete'); expect(texts(result)).not.toContain('First')
  })
  it('switches explicit loading/error scenarios without changing production logic or leaking state', () => {
    const source = files(app('VStack { if loading { Text("Loading") } else { Text(message) }; Button("Change") { message = "Changed" } }', '@State var loading = false\n@State var message = "Content"'))
    const snapshot = model(source)
    const input = (name: string, value: string | boolean) => { const state = snapshot.inputs!.find(i => i.name === name)!; return { owner: state.owner, name, signature: state.signature, value } }
    const loading = { name: 'Loading', owner: 'ContentView', hook: '', inputs: [input('loading', true)] }
    const error = { name: 'Error', owner: 'ContentView', hook: '', inputs: [input('message', 'Error: offline')] }
    expect(texts(render(source, loading))).toContain('Loading')
    expect(texts(render(source, error))).toContain('Error: offline')
    expect(texts(tap(render(source, error), 'Change'))).toContain('Changed')
    expect(texts(render(source))).toContain('Content')
    for (let i = 0; i < 50; i++) { expect(texts(render(source, loading, 'p' + i))).toContain('Loading'); expect(texts(render(source, error, 'p' + i))).toContain('Error: offline') }
    const invalid = compile({ files: source, scenario: { ...error, inputs: [{ ...error.inputs[0]!, signature: 'outdated' }] }, revision: revision++, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
    expect(invalid.diagnostics.some(d => d.code === 'invalid_preview_scenario')).toBe(true)
  })
})

describe('Preservation, scenarios and independent native fixtures', () => {
  it('preserves record comments, rejects local shadowing and validates stale scenarios', () => {
    const commented = files(list().replace('title: "First"', '/* retained */ title: "First"'))
    const info = target(commented, 'List').collection!
    expect(plan(commented, 'List', { kind: 'records', records: [...info.records].reverse() })).toMatchObject({ ok: false })
    const shadow = files(app('ForEach([true, false], id: \\.self) { on in Button("Change") { } }', '@State var on = false'))
    expect(plan(shadow, 'Button', { kind: 'behavior', action: { type: 'toggle', state: 'on' }, replace: false })).toMatchObject({ ok: false })
  })
  it('preserves descriptions and scenarios through local storage, sharing and atomic undo', async () => {
    const source = files(list()), initial = projectFromFiles(source.map(f => ({ name: f.id, text: f.text })))!, info = target(source, 'List').collection!
    const metadata = { ...emptyStudioMetadata(), components: [{ owner: 'ProductRow', signature: 'interface-v1', properties: [{ name: 'title', label: 'Title', description: 'Displayed name', group: 'Content' }] }], scenarios: [{ name: 'Empty', owner: info.owner, hook: '', inputs: [{ owner: info.owner, name: info.name, signature: info.signature, value: [] }] }] }
    expect(readStudioMetadata(metadata).status).toBe('valid')
    const project = { ...initial, studio: metadata }
    const { MemoryProjectStore } = await import('@studio/project-model')
    const store = new MemoryProjectStore(); await store.save(project)
    expect((await store.load(project.id))?.studio).toEqual(metadata)
    const shared = encodeProject(project)!
    expect(decodeProject(shared, 1)?.studio).toEqual(metadata)
    const p = { ...initial, id: 'p' }, tx = { projectId: p.id, baseRevision: 1, changes: [], studio: { before: p.studio, after: metadata } }
    const committed = applyProjectTransaction(p, 1, tx)
    expect(committed.ok).toBe(true); if (!committed.ok) return
    const history = new DocumentHistory(); history.record(p, committed.project, null, null)
    expect(history.take('undo', committed.project)?.project.studio).toEqual(p.studio)
    expect(history.take('redo', p)?.project.studio).toEqual(metadata)
  })
  it('edits described content slots and named action arguments independently', () => {
    const extra = 'struct First: View { var body: some View { Text("First slot") } }\nstruct Second: View { var body: some View { Text("Second slot") } }\nstruct SlotCard: View { let content: () -> AnyView; var action: () -> Void = {}; var body: some View { VStack { content(); Button("Run") { action() } } } }'
    let source = files(app('SlotCard(content: { AnyView(First()) })', '@State var title = "Before"\nfunc save() { title = "Saved" }', extra))
    const settings = target(source, 'SlotCard').component!
    const descriptions = [{ owner: 'SlotCard', signature: settings.signature, properties: [{ name: 'content', label: 'Body slot', description: 'One erased local view' }] }]
    const controls = model(source, descriptions).nodes.find(n => n.name === 'SlotCard' && n.kind === 'component')?.controls
    expect(controls?.find(c => c.id === 'component:content')?.options).toContain('Second')
    source = edit(source, 'SlotCard', { kind: 'property', control: 'component:content', value: 'Second' }, 0, descriptions)
    source = edit(source, 'SlotCard', { kind: 'property', control: 'component:action', value: 'save' }, 0, descriptions)
    expect(texts(render(source))).toContain('Second slot')
    expect(source[0]!.text).toContain('action: save')
    expect(plan(source, 'SlotCard', { kind: 'property', control: 'component:content', value: 'UnknownView' }, 0, descriptions)).toMatchObject({ ok: false })
  })
  it('edits a shared definition and updates two call sites while retaining their arguments', () => {
    const source = files(app('VStack { Card(title: "A"); Card(title: "B") }', '', 'struct Card: View { let title: String; var body: some View { Text(title) } }'))
    const node = target(source, 'Text'), padding = node.controls!.find(c => c.label === 'Padding')!
    const next = edit(source, 'Text', { kind: 'property', control: padding.id, value: '16' })
    const result = render(next)
    expect(texts(result)).toEqual(expect.arrayContaining(['A', 'B']))
    expect(result.authoring?.nodes.find(n => n.name === 'Text')?.runtimeIds).toHaveLength(2)
    expect(next[0]!.text).toContain('Card(title: "A"); Card(title: "B")')
  })
  it('creates a working text binding and routes picker selection to existing typed state', () => {
    let source = files(app('VStack { TextField("Name", text: .constant("")); Text(name) }', '@State var name = "Before"'))
    source = edit(source, 'TextField', { kind: 'bind-state', name: 'name' })
    const result = render(source), input = result.renderTree?.nodes.find(n => n.hitTarget?.role === 'textField')
    expect(input).toBeDefined()
    applyEvent({ kind: 'textChange', handlerId: input!.hitTarget!.handlerId, value: 'After' })
    expect(texts(rerender(revision++))).toContain('After')
    const picker = files(app('Picker("Choice", selection: $first) { Text("A").tag(0); Text("B").tag(1) }', '@State var first = 0\n@State var second = 1'))
    expect(edit(picker, 'Picker', { kind: 'bind-state', name: 'second' })[0]!.text).toContain('selection: $second')
  })
  it('adds bounded animations without replacing developer-owned transition code', () => {
    const source = files(app('Button("Change") { on.toggle() }', '@State var on = false'))
    const next = edit(source, 'Button', { kind: 'transition', state: 'on', style: 'opacity', duration: 0.25 })
    expect(next[0]!.text).toContain('.transition(.opacity).animation(.easeInOut(duration: 0.25), value: on)')
    expect(render(next).diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(plan(next, 'Button', { kind: 'transition', state: 'on', style: 'slide', duration: 0.5 })).toMatchObject({ ok: false })
    expect(plan(source, 'Button', { kind: 'transition', state: 'on', style: 'slide', duration: 5 })).toMatchObject({ ok: false })
  })
  it('places conditional animation on the surviving container and preserves existing action comments', () => {
    const source = files(app('VStack { if on { Text("Row") }; Button("Change") { /* configured by developer */ } }', '@State var on = true'))
    const animated = edit(source, 'Text', { kind: 'transition', state: 'on', style: 'scale', duration: 0.4 })
    expect(animated[0]!.text).toBe(source[0]!.text.replace('Text("Row")', 'Text("Row").transition(.scale)').replace('/* configured by developer */ } }', '/* configured by developer */ } }.animation(.easeInOut(duration: 0.4), value: on)'))
    expect(render(animated).renderTree?.nodes.some(n => n.transition?.kind === 'scale' && n.transition.duration === 0.4)).toBe(true)
    expect(plan(source, 'Button', { kind: 'behavior', action: { type: 'toggle', state: 'on' }, replace: false })).toMatchObject({ ok: false })
    expect(plan(source, 'Button', { kind: 'behavior', action: { type: 'toggle', state: 'on' }, replace: true })).toMatchObject({ ok: true })
  })
  it('writes macro-free collection, component, extraction, slot and navigation forms for Apple type checking', () => {
    const fixture = `import SwiftUI
struct NativeProduct: Identifiable { let id: String; var title: String }
enum NativeVariant { case small, large }
struct NativeCard: View {
    var title: String = "Default"
    var count: Int = 1
    var variant: NativeVariant = .small
    var body: some View { VStack { Text(title); if variant == .large { Text("Large") } } }
}
struct NativeSlot: View { let content: () -> AnyView; var body: some View { content() } }
struct NativeDetail: View { var body: some View { Text("Details") } }
struct NativeAlternative: View { var body: some View { Text("Alternative") } }
struct NativeReference: View {
    let products: [NativeProduct] = [NativeProduct(id: "1", title: "Before")]
    let caption: String = "Caption"
    var body: some View {
        NavigationStack {
            VStack {
                List(products) { item in Text(item.title) }.listStyle(.plain)
                NativeCard()
                NativeSlot(content: { AnyView(NativeDetail()) })
                Button("Go") { }
                Text(caption).padding(8)
            }
        }
    }
}`
    let sources = files(fixture)
    sources = edit(sources, 'List', { kind: 'collection-field', name: 'price', type: 'Double', optional: false, value: 0 })
    sources = edit(sources, 'List', { kind: 'records', records: [{ id: 'two', title: 'After', price: 5 }] })
    sources = edit(sources, 'List', { kind: 'empty-state', text: 'Empty' })
    sources = edit(sources, 'NativeCard', { kind: 'property', control: 'component:title', value: 'Edited' })
    sources = edit(sources, 'NativeCard', { kind: 'property', control: 'component:variant', value: 'large' })
    sources = edit(sources, 'Button', { kind: 'behavior', action: { type: 'navigate', destination: 'NativeDetail' }, replace: false })
    const slot = target(sources, 'NativeSlot').component!
    const descriptions = [{ owner: 'NativeSlot', signature: slot.signature, properties: [{ name: 'content', label: 'Content', description: 'Slot' }] }]
    sources = edit(sources, 'NativeSlot', { kind: 'property', control: 'component:content', value: 'NativeAlternative' }, 0, descriptions)
    const caption = model(sources).nodes.find(n => n.name === 'Text' && n.owner === 'NativeReference' && n.properties.some(p => p.expression === 'caption'))!
    const plan = planDesignEdit({ projectId: 'p', baseRevision: 1, scope: caption.owner, files: sources, target: caption.source, fingerprint: caption.fingerprint, operation: { kind: 'extract-component', name: 'NativeCaption' } })
    expect(plan.ok).toBe(true); if (!plan.ok) return
    const final = sources.map(f => ({ ...f, text: plan.changes.find(c => c.file === f.id)?.after ?? f.text })).concat(plan.changes.filter(c => c.before === null).map(c => ({ id: c.file, text: c.after })))
    // Inject collection storage through @Binding so this independent API check
    // does not require the host's unavailable @State macro plugin.
    const state = '@State private var products: [NativeProduct] = [NativeProduct(id: "one", title: "One")]'
    let editable = edit(files(`import SwiftUI\nstruct NativeProduct: Identifiable { let id: String; var title: String }\nstruct NativeEditableRows: View { ${state}; var body: some View { List(products) { item in TextField("Title", text: .constant("")) } } }`), 'TextField', { kind: 'bind-field', field: 'title' })
    editable = edit(editable, 'TextField', { kind: 'extract-component', name: 'NativeRowField' })
    const bindingForm = editable[0]!.text.slice(editable[0]!.text.indexOf('struct NativeEditableRows')).replace(state, '@Binding var products: [NativeProduct]') + '\n' + editable[1]!.text
    const dependencies = edit(files(`import SwiftUI
struct NativeExtractionReference: View {
    @Binding var count: Int?
    @Binding var flag: Bool
    func save() { flag.toggle() }
    var body: some View { VStack { Text(String(count ?? 0)); Toggle("Flag", isOn: $flag); Button("Save") { save() } } }
}
`), 'VStack', { kind: 'extract-component', name: 'NativeDependentControls' })
    const motion = edit(files('import SwiftUI\nstruct NativeMotionReference: View { @State var shown = true; var body: some View { VStack { if shown { Text("Motion") } } } }'), 'Text', { kind: 'transition', state: 'shown', style: 'opacity', duration: 0.4 })[0]!.text.replace('@State var shown = true', '@Binding var shown: Bool')
    const output = process.env.AUTHORING_456_NATIVE_FORMS
    if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, [...final, ...dependencies].map(f => f.text).join('\n') + '\n' + bindingForm + '\n' + motion) }
  })
})

it('edits list style and exposes nested section headers and footers in source layers', () => {
  const source = files(app('List { Section { Text("Row") } header: { Text("Heading") } footer: { Text("Footer") } }'))
  const snapshot = model(source)
  expect(snapshot.nodes.filter(n => ['Header', 'Footer'].includes(n.name))).toHaveLength(2)
  expect(snapshot.nodes.filter(n => n.name === 'Text')).toHaveLength(3)
  const styled = edit(source, 'List', { kind: 'property', control: 'add:listStyle', value: 'insetGrouped' })
  expect(styled[0]!.text).toContain('.listStyle(.insetGrouped)')
  expect(texts(render(styled))).toEqual(expect.arrayContaining(['Heading', 'Row', 'Footer']))
  const listNode = target(source, 'List')
  const request = { projectId: 'p', baseRevision: 1, scope: listNode.owner, files: source, target: listNode.source, fingerprint: listNode.fingerprint, deploymentTarget: '13.0' }
  expect(planDesignEdit({ ...request, operation: { kind: 'property', control: 'add:listStyle', value: 'sidebar' } })).toMatchObject({ ok: false })
  expect(planDesignEdit({ ...request, operation: { kind: 'property', control: 'add:listStyle', value: 'plain' } })).toMatchObject({ ok: true })
})

it('keeps invalid scenario errors and cleared handlers across reset and rerender', () => {
  const source = files(app('Button("Change") { flag.toggle() }', '@State var flag = false'))
  const before = render(source), handler = before.renderTree!.nodes.find(n => n.hitTarget)!.hitTarget!.handlerId
  const invalid = compile({ files: source, projectId: 'p', scenario: { name: 'Bad', owner: 'ContentView', hook: '', inputs: [{ owner: 'ContentView', name: 'missing', signature: 'x', value: true }] }, revision: revision++, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(invalid.diagnostics.some(d => d.code === 'invalid_preview_scenario')).toBe(true)
  expect(applyEvent({ kind: 'tap', handlerId: handler, location: { x: 0, y: 0 } })).toBe(false)
  resetPipelineState()
  expect(rerender(revision++).diagnostics.some(d => d.code === 'invalid_preview_scenario')).toBe(true)
})

it('offers a new value a name nothing on the screen has yet, a stored property included (D13)', () => {
  const source = files(app('VStack { TextField("Name", text: .constant("")); Toggle("Alerts", isOn: .constant(false)); Picker("Size", selection: .constant(0)) { Text("Small").tag(0) } }', 'let text: String = "Ada"\n@State private var isOn = true'))

  expect(target(source, 'TextField').behavior?.binding?.newName).toBe('text2')
  expect(target(source, 'Toggle').behavior?.binding?.newName).toBe('isOn2')
  expect(target(source, 'Picker').behavior?.binding?.newName).toBe('selection')
})

it('saves a date picker to a new value that starts as today, written Date() rather than a fixed day (D13)', () => {
  const bound = edit(files(app('DatePicker("Date", selection: .constant(Date()))')), 'DatePicker', { kind: 'bind-state', name: 'date', create: { value: null } })
  expect(bound[0]!.text).toContain('@State private var date: Date = Date()')
  expect(bound[0]!.text).toContain('DatePicker("Date", selection: $date)')
})

it('writes the sheet it adds on its own line, under the button that opens it (D13)', () => {
  const source = files(app('VStack {\n        Button("Open") { }\n    }', '', 'struct Detail: View { var body: some View { Text("Detail content") } }'))
  const sheet = edit(source, 'Button', { kind: 'behavior', action: { type: 'sheet', destination: 'Detail' }, replace: false })
  expect(sheet[0]!.text).toContain('        Button("Open") { isDetailPresented = true }\n            .sheet(isPresented: $isDetailPresented) { Detail() }\n')
  expect(texts(tap(render(sheet), 'Open'))).toContain('Detail content')
})

it('generates environment dismissal in the presented definition and returns to the parent', () => {
  let source = files(app('Button("Open") { }', '', 'struct Detail: View { var body: some View { Button("Close") { } } }'))
  source = edit(source, 'Button', { kind: 'behavior', action: { type: 'sheet', destination: 'Detail' }, replace: false })
  source = edit(source, 'Button', { kind: 'behavior', action: { type: 'dismiss', state: '' }, replace: false }, 1)
  expect(source[0]!.text).toContain('@Environment(\\.dismiss) private var dismiss\n')
  expect(source[0]!.text).toContain('Button("Close") { dismiss() }')
  const presented = tap(render(source), 'Open')
  expect(texts(presented)).toContain('Close')
  expect(texts(tap(presented, 'Close'))).not.toContain('Close')
})

it('exports actual Phase 4–6 writer output with an independent native interaction test', async () => {
  let sources = files(app('NavigationStack { VStack { List(products) { item in Text(item.title) }; Card(title: "Before"); Text(flag ? "Enabled" : "Disabled"); Button("Toggle flag") { }; Button("Add item") { }; Button("Details") { }; Button("Open sheet") { } } }', records + '\n@State var flag = false', product + '\nstruct Card: View { let title: String; var body: some View { Text(title) } }\nstruct Detail: View { var body: some View { VStack { Text("Detail page"); Button("Close sheet") { } } } }'))
  sources = edit(sources, 'List', { kind: 'records', records: [{ id: 'one', title: 'Product one', price: 3, featured: false, subtitle: null }] })
  sources = edit(sources, 'Card', { kind: 'property', control: 'component:title', value: 'Catalog card' })
  sources = edit(sources, 'Button', { kind: 'behavior', action: { type: 'toggle', state: 'flag' }, replace: false })
  sources = edit(sources, 'Button', { kind: 'behavior', action: { type: 'append', collection: 'products', record: { id: 'two', title: 'Product two', price: 8, featured: false, subtitle: null } }, replace: false }, 1)
  sources = edit(sources, 'Button', { kind: 'behavior', action: { type: 'navigate', destination: 'Detail' }, replace: false }, 2)
  sources = edit(sources, 'Button', { kind: 'behavior', action: { type: 'sheet', destination: 'Detail' }, replace: false }, 2)
  sources = edit(sources, 'Button', { kind: 'behavior', action: { type: 'dismiss', state: '' }, replace: false }, 3)
  expect(texts(tap(tap(render(sources), 'Toggle flag'), 'Add item'))).toEqual(expect.arrayContaining(['Enabled', 'Product two', 'Catalog card']))
  const initial = projectFromFiles(sources.map(f => ({ name: f.id, text: f.text })))!, project = { ...initial, manifest: { ...initial.manifest, name: 'AuthoringWorkflows', deploymentTarget: '17.0' } }
  const uiTests = `import XCTest
final class AuthoringUITests: XCTestCase {
  func testCollectionsComponentsAndActions() throws {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["Catalog card"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.staticTexts["Product one"].exists)
    app.buttons["Toggle flag"].tap()
    XCTAssertTrue(app.staticTexts["Enabled"].exists)
    app.buttons["Add item"].tap()
    XCTAssertTrue(app.staticTexts["Product two"].exists)
    app.buttons["Details"].tap()
    XCTAssertTrue(app.staticTexts["Detail page"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["Open sheet"].tap()
    XCTAssertTrue(app.buttons["Close sheet"].waitForExistence(timeout: 5))
    app.buttons["Close sheet"].tap()
    XCTAssertTrue(app.buttons["Open sheet"].waitForExistence(timeout: 5))
    let screenshot = XCTAttachment(screenshot: app.screenshot())
    screenshot.lifetime = .keepAlways
    add(screenshot)
  }
}`
  const { nativeAuthoringProject } = await import('./helpers/native-authoring-project')
  const bundle = nativeAuthoringProject(project, uiTests)
  for (const source of sources) expect([...bundle].some(([path, bytes]) => path.endsWith('.swift') && new TextDecoder().decode(bytes) === source.text)).toBe(true)
  const output = process.env.AUTHORING_456_EXPORT_DIR
  if (output) for (const [path, bytes] of bundle) { const file = output + '/' + path; mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes) }
})

it('adds typed fields in a separate file without rewriting data or action initializers', () => {
  const sources = [
    ...files(app('List(items) { item in Text(item.title) }', '@State var items: [Item] = [Item(id: "one", title: "One")]\nfunc add() { items.append(Item(id: "two", title: "Two")) }')),
    { id: 'Sources/Item.swift', text: 'struct Item: Identifiable { let id: String; var title: String; var summary: String { title.uppercased() } }' },
  ]
  const next = edit(sources, 'List', { kind: 'collection-field', name: 'price', type: 'Double', optional: false, value: 3.5 })
  expect(next[0]!.text).toBe(sources[0]!.text)
  expect(next[1]!.text).toContain('var price: Double = 3.5')
  expect(next[1]!.text).toContain('var summary: String { title.uppercased() }')
  expect(target(next, 'List').collection?.records).toEqual([{ id: 'one', title: 'One', price: 3.5 }])
  const bound = edit(next, 'Text', { kind: 'bind-field', field: 'price' })
  expect(texts(render(bound))).toContain('3.5')
  expect(plan(next, 'List', { kind: 'collection-field', name: 'price', type: 'String', optional: false, value: '' })).toMatchObject({ ok: false })
})

it('binds a row toggle to real collection storage and preserves identity through reorder', () => {
  let source = files(app('VStack { List(products) { item in VStack { Toggle(item.title, isOn: .constant(false)); if item.featured { Text(item.title + " chosen") } } }; Button("Reverse") { products.reverse() } }', records, product))
  source = edit(source, 'Toggle', { kind: 'bind-field', field: 'featured' })
  expect(source[0]!.text).toContain('List($products) { $item in')
  expect(source[0]!.text).toContain('Toggle(item.title, isOn: $item.featured)')
  expect(target(source, 'List').collection?.binding).toBe(true)
  let result = render(source)
  const first = result.renderTree!.nodes.find(n => n.hitTarget?.role === 'toggle' && n.a11y?.label === 'First')!
  expect(first).toBeDefined()
  expect(applyEvent({ kind: 'toggle', handlerId: first.hitTarget!.handlerId, value: true })).toBe(true)
  result = rerender(revision++)
  expect(texts(result)).toContain('First chosen')
  result = tap(result, 'Reverse')
  expect(texts(result)).toContain('First chosen')
  const after = result.renderTree!.nodes.find(n => n.hitTarget?.role === 'toggle' && n.a11y?.label === 'First')!
  expect(after.hitTarget!.handlerId).toBe(first.hitTarget!.handlerId)
  applyEvent({ kind: 'toggle', handlerId: after.hitTarget!.handlerId, value: false })
  result = rerender(revision++)
  expect(texts(result)).not.toContain('First chosen')
  expect(texts(result)).toContain('Second chosen')
})

it('preserves row bindings and optional state when extracting reusable controls', () => {
  let source = files(app('List(products) { item in Toggle(item.title, isOn: .constant(false)) }', records, product))
  source = edit(source, 'Toggle', { kind: 'bind-field', field: 'featured' })
  source = edit(source, 'Toggle', { kind: 'extract-component', name: 'RowToggle' })
  expect(source[0]!.text).toContain('RowToggle(item: $item)')
  expect(source[1]!.text).toContain('@Binding var item: Product')
  const result = render(source), toggle = result.renderTree!.nodes.find(n => n.hitTarget?.role === 'toggle')!
  expect(applyEvent({ kind: 'toggle', handlerId: toggle.hitTarget!.handlerId, value: true })).toBe(true)
  expect(rerender(revision++).diagnostics.filter(d => d.severity === 'error')).toEqual([])
  const optional = edit(files(app('Text(String(count ?? 0))', '@State var count: Int? = nil')), 'Text', { kind: 'extract-component', name: 'CountView' })
  expect(optional[1]!.text).toContain('@Binding var count: Int?')
})

it('refuses optional state in nonoptional bindings and toggle actions', () => {
  const source = files(app('VStack { Toggle("Flag", isOn: .constant(false)); Button("Change") { } }', '@State var flag: Bool? = nil'))
  expect(plan(source, 'Toggle', { kind: 'bind-state', name: 'flag' })).toMatchObject({ ok: false })
  expect(plan(source, 'Button', { kind: 'behavior', action: { type: 'toggle', state: 'flag' }, replace: false })).toMatchObject({ ok: false })
  const assigned = edit(source, 'Button', { kind: 'behavior', action: { type: 'set', state: 'flag', value: true }, replace: false })
  expect(assigned[0]!.text).toContain('flag = true')
})

it('applies nested scenario owners without changing a same-named top-level input or source AST', () => {
  const sources = files(`import SwiftUI
struct ContentView: View { @State var flag = false; var body: some View { Text("Root") } }
enum Namespace { struct ContentView: View { @State var flag = false; var body: some View { Text("Nested") } } }`)
  const snapshot = model(sources), ast = sources.map(f => Parser.parse(f.text, f.id).sourceFile)
  const before = JSON.stringify(ast)
  const state = snapshot.inputs!.find(s => s.owner === 'Namespace.ContentView')!
  expect(state).toBeDefined()
  const output = scenarioFiles({ files: sources, ast, nodes: snapshot.nodes }, snapshot, { name: 'Nested', owner: state.owner, hook: '', inputs: [{ owner: state.owner, name: state.name, signature: state.signature, value: true }] })
  const root = output[0]!.declarations[1], namespace = output[0]!.declarations[2]
  expect(root?.kind === 'structDecl' && root.members[0]).toMatchObject({ initializer: { kind: 'booleanLiteral', value: false } })
  expect(namespace?.kind === 'enumDecl' && namespace.members[0]).toMatchObject({ members: [expect.objectContaining({ initializer: expect.objectContaining({ kind: 'booleanLiteral', value: true }) }), expect.anything()] })
  expect(JSON.stringify(ast)).toBe(before)
})
