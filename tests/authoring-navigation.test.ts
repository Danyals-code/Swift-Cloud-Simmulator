import { beforeEach, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { AuthoringNode, SourceFile } from '@studio/shared'
import { FOLIO_FILES } from '@studio/project-model/templates'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'

beforeEach(resetPipelineState)
let nativeFixture = 0
const files = (body: string, extra = '', members = ''): SourceFile[] => [{ id: 'App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { ${members}
var body: some View { ${body} } }
struct FirstView: View { var body: some View { Text("First screen") } }
struct SecondView: View { var body: some View { Text("Second screen") } }
${extra}` }]
const model = (sources: readonly SourceFile[]) => buildAuthoringModel({ files: sources, projectId: 'nav', revision: 1 })
const link = (sources: readonly SourceFile[]) => model(sources).nodes.find(node => node.name === 'NavigationLink')!
function plan(sources: readonly SourceFile[], node: AuthoringNode, destination: string) {
  return planDesignEdit({ files: sources, projectId: 'nav', baseRevision: 1, scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'navigation-target', destination } })
}
function edit(sources: readonly SourceFile[], node: AuthoringNode, destination: string) {
  const result = plan(sources, node, destination)
  if (!result.ok) throw new Error(result.reason)
  const changed = sources.map(file => ({ ...file, text: result.changes.find(change => change.file === file.id)?.after ?? file.text }))
  if (process.env.NAVIGATION_NATIVE_DIR && changed.length === 1) { mkdirSync(process.env.NAVIGATION_NATIVE_DIR, { recursive: true }); writeFileSync(`${process.env.NAVIGATION_NATIVE_DIR}/navigation-${++nativeFixture}.swift`, changed[0]!.text) }
  return changed
}
function render(sources: readonly SourceFile[]) {
  const result = compile({ files: sources, projectId: 'nav', revision: 1, canvas: { width: 402, height: 874 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  return result
}

it('updates a direct link while preserving its label, comments, and modifiers byte for byte', () => {
  const sources = files('NavigationStack { NavigationLink("Open", destination: /* keep destination note */ FirstView()).padding(12) }')
  const node = link(sources)
  expect(node.navigation).toMatchObject({ destination: 'FirstView()', display: 'First', editable: true, scope: 'link' })
  const changed = edit(sources, node, 'SecondView()')
  expect(changed[0]!.text).toBe(sources[0]!.text.replace('destination: /* keep destination note */ FirstView()', 'destination: /* keep destination note */ SecondView()'))
  const before = render(changed)
  const target = before.renderTree!.nodes.find(node => node.a11y?.label === 'Open' && node.hitTarget)!
  expect(applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  expect(rerender(2).renderTree!.nodes.flatMap(node => node.text?.runs.map(run => run.text) ?? [])).toContain('Second screen')
})

it('updates trailing destination closures without replacing their label closure or trivia', () => {
  const sources = files('NavigationStack { NavigationLink { /* retained */ FirstView() } label: { Text("Open").bold() }.padding(8) }')
  const changed = edit(sources, link(sources), 'SecondView()')
  expect(changed[0]!.text).toBe(sources[0]!.text.replace('/* retained */ FirstView()', '/* retained */ SecondView()'))
  expect(render(changed).diagnostics).toEqual([])
})

it('converts only the selected value link and keeps the shared destination rule unchanged', () => {
  const sources = files('NavigationStack { VStack { NavigationLink("One", value: 1); NavigationLink("Two", value: 2) }.navigationDestination(for: Int.self) { number in CountView(count: number) } }', 'struct CountView: View { let count: Int; var body: some View { Text("Count \\(count)") } }')
  const node = link(sources)
  expect(node.navigation).toMatchObject({ destination: 'CountView(count: 1)', editable: true, scope: 'link' })
  const changed = edit(sources, node, 'SecondView()')
  expect(changed[0]!.text).toBe(sources[0]!.text.replace('NavigationLink("One", value: 1)', 'NavigationLink("One", destination: SecondView())'))
  expect(changed[0]!.text).toContain('NavigationLink("Two", value: 2)')
  expect(changed[0]!.text).toContain('.navigationDestination(for: Int.self) { number in CountView(count: number) }')
})

it('preserves Folio row data and offers screen choices with their actual required arguments', () => {
  const node = link(FOLIO_FILES)
  expect(node.navigation?.destination).toBe('BookDetailView(book: book)')
  expect(node.navigation?.destinations).toContainEqual(expect.objectContaining({ viewName: 'BookDetailView', expression: 'BookDetailView(book: book)', available: true }))
  expect(node.navigation?.destinations).toContainEqual(expect.objectContaining({ viewName: 'SettingsView', expression: 'SettingsView()', available: true }))
  const changed = edit(FOLIO_FILES, node, 'SettingsView()')
  const original = FOLIO_FILES.find(file => file.id.endsWith('LibraryView.swift'))!.text
  expect(changed.find(file => file.id.endsWith('LibraryView.swift'))!.text).toBe(original.replace('NavigationLink(value: book)', 'NavigationLink(destination: SettingsView())'))
  expect(plan(FOLIO_FILES, node, 'BookDetailView()')).toMatchObject({ ok: false, reason: expect.stringContaining('requires book') })
  expect(plan(FOLIO_FILES, node, 'BookDetailView(book: missing)')).toMatchObject({ ok: false, reason: expect.stringContaining('available Book') })
})

it('substitutes UUID route parameters without dropping the original row label', () => {
  const sources = files('NavigationStack { List(items) { book in NavigationLink(value: book.id) { Text(book.title) } }.navigationDestination(for: UUID.self) { bookID in UUIDView(id: bookID) } }', 'struct Book: Identifiable { let id = UUID(); let title: String }\nstruct UUIDView: View { let id: UUID; var body: some View { Text("UUID screen") } }', 'let items: [Book] = [Book(title: "Book")]')
  const node = link(sources)
  expect(node.navigation?.destination).toBe('UUIDView(id: book.id)')
  const source = node.navigation!.destinations.find(choice => choice.expression === 'UUIDView(id: book.id)')!.source!
  expect(sources[0]!.text.slice(source.start, source.end)).toBe('UUIDView(id: bookID)')
  expect(node.navigation?.destinations).toContainEqual(expect.objectContaining({ expression: 'UUIDView(id: book.id)', available: true }))
  const changed = edit(sources, node, 'SecondView()')
  expect(changed[0]!.text).toBe(sources[0]!.text.replace('NavigationLink(value: book.id)', 'NavigationLink(destination: SecondView())'))
})

it('marks a shared route edit explicitly and keeps its data parameter in scope', () => {
  const sources = files('NavigationStack { NavigationLink("Open", value: 3).navigationDestination(for: Int.self) { number in CountView(count: number) } }', 'struct CountView: View { let count: Int; var body: some View { Text("Count \\(count)") } }\nstruct OtherCountView: View { let count: Int; var body: some View { Text("Other \\(count)") } }')
  const node = model(sources).nodes.find(node => node.kind === 'branch' && node.name === 'Destination')!
  expect(node.navigation).toMatchObject({ destination: 'CountView(count: number)', scope: 'shared-route', scopeDescription: expect.stringContaining('every link') })
  const changed = edit(sources, node, 'OtherCountView(count: number)')
  expect(changed[0]!.text).toBe(sources[0]!.text.replace('{ number in CountView(count: number) }', '{ number in OtherCountView(count: number) }'))
})

it('updates a presentation body without modifying its binding or surrounding comments', () => {
  const sources = files('NavigationStack { Text("Home").sheet(isPresented: $show) { /* keep */ FirstView() } }', '', '@State var show = false')
  const node = model(sources).nodes.find(node => node.kind === 'branch' && node.name === 'Sheet')!
  expect(node.navigation).toMatchObject({ scope: 'presentation', editable: true })
  const changed = edit(sources, node, 'SecondView()')
  expect(changed[0]!.text).toBe(sources[0]!.text.replace('/* keep */ FirstView()', '/* keep */ SecondView()'))
})

it('rejects malformed destinations, unknown views, missing arguments, and mismatched argument types', () => {
  const sources = files('NavigationStack { NavigationLink("Open", destination: FirstView()) }', 'struct NeedsView: View { let title: String; var body: some View { Text(title) } }')
  for (const destination of ['UnknownView()', 'NeedsView()', 'NeedsView(title: 42)', 'NeedsView(title: unavailable)', 'SecondView()); print("extra")', 'Text("Not a screen")']) expect(plan(sources, link(sources), destination), destination).toMatchObject({ ok: false })
  expect(link(sources).navigation?.destinations).toContainEqual(expect.objectContaining({ viewName: 'NeedsView', available: false, requirements: [{ name: 'title', type: 'String', required: true }] }))
  expect(plan(sources, link(sources), 'NeedsView(title: "Ready")')).toMatchObject({ ok: true })
})

it('refuses to erase custom destination control flow or comments inside an expression', () => {
  const sources = files('NavigationStack { NavigationLink { if flag { FirstView() } else { SecondView() } } label: { Text("Open") } }', '', 'let flag = true')
  expect(link(sources).navigation).toMatchObject({ editable: false })
  expect(plan(sources, link(sources), 'SecondView()')).toMatchObject({ ok: false })
  const commented = files('NavigationStack { NavigationLink("Open", destination: NeedsView(title: /* keep */ "First")) }', 'struct NeedsView: View { let title: String; var body: some View { Text(title) } }')
  expect(plan(commented, link(commented), 'SecondView()')).toMatchObject({ ok: false, reason: expect.stringContaining('comments') })
})


it('keeps distinct valid scene call-site variants for canvas picking', () => {
  const sources = files('NavigationStack { VStack { NavigationLink("Open", destination: FirstView()); ModeView(savedOnly: true); ModeView(savedOnly: false) } }', 'struct ModeView: View { let savedOnly: Bool; var body: some View { Text(savedOnly ? "Saved" : "All") } }')
  const choices = link(sources).navigation!.destinations.filter(choice => choice.viewName === 'ModeView' && choice.available)
  expect(choices.map(choice => choice.expression)).toEqual(expect.arrayContaining(['ModeView(savedOnly: true)', 'ModeView(savedOnly: false)']))
})

it('supports current bookID routes, explicit initializers, defaults and state bindings', () => {
  const sources = files('NavigationStack { List(items) { book in NavigationLink(value: book.id) { Text(book.title) } }.navigationDestination(for: UUID.self) { id in BookDetailView(bookID: id) } }', 'struct Book: Identifiable { let id = UUID(); let title: String }\nstruct BookDetailView: View { let bookID: UUID; var body: some View { Text("Details") } }\nstruct BoundView: View { @Binding var enabled: Bool; var body: some View { Toggle("Enabled", isOn: $enabled) } }\nstruct NamedView: View { let name: String; init(name: String = "Default") { self.name = name }; var body: some View { Text(name) } }', 'let items: [Book] = [Book(title: "Book")]; @State var enabled = true; let plain = true')
  const node = link(sources)
  expect(node.navigation?.destination).toBe('BookDetailView(bookID: book.id)')
  expect(node.navigation?.destinations).toContainEqual(expect.objectContaining({ expression: 'BoundView(enabled: $enabled)', available: true }))
  expect(node.navigation?.destinations).toContainEqual(expect.objectContaining({ expression: 'NamedView()', available: true }))
  edit(sources, node, 'BoundView(enabled: $enabled)')
  expect(plan(sources, node, 'BoundView(enabled: $plain)')).toMatchObject({ ok: false, reason: expect.stringContaining('available Binding<Bool>') })
  expect(plan(sources, node, 'ContentView()')).toMatchObject({ ok: false, reason: expect.stringContaining('recursively') })
})

it('preserves value-argument comments and rejects wrong initializer argument order', () => {
  const sources = files('NavigationStack { NavigationLink("Open", value: /* keep */ 1).navigationDestination(for: Int.self) { number in FirstView() } }', 'struct PairView: View { let first: Int; let second: String; var body: some View { Text(second) } }')
  const changed = edit(sources, link(sources), 'SecondView()')
  expect(changed[0]!.text).toContain('NavigationLink("Open", destination: /* keep */ SecondView())')
  expect(plan(sources, link(sources), 'PairView(second: "Title", first: 1)')).toMatchObject({ ok: false, reason: expect.stringContaining('declared order') })
  const same = plan(sources, link(sources), 'FirstView()')
  expect(same).toMatchObject({ ok: true, changes: [] })
})


it('validates nested model constructors and refuses inaccessible screen initializers', () => {
  const sources = files('NavigationStack { NavigationLink("Open", destination: FirstView()) }', 'struct Item { let title: String }\nstruct ItemView: View { let item: Item; var body: some View { Text(item.title) } }\nstruct PrivateView: View { private var title = "Hidden"; var body: some View { Text(title) } }\nstruct CountView: View { let count: Int; var body: some View { Text("Count") } }')
  const node = link(sources)
  for (const destination of ['ItemView(item: Item())', 'ItemView(item: Item(title: 3))', 'PrivateView()', 'CountView(count: Int("invalid"))', 'CountView(count: !1)']) expect(plan(sources, node, destination), destination).toMatchObject({ ok: false })
  expect(node.navigation?.destinations).toContainEqual(expect.objectContaining({ viewName: 'PrivateView', available: false }))
  edit(sources, node, 'ItemView(item: Item(title: "Available"))')
})


it('renders a retargeted Folio screen with its own navigation container and returns to the library', () => {
  const changed = edit(FOLIO_FILES, link(FOLIO_FILES), 'SettingsView()')
  const before = render(changed)
  const row = before.renderTree!.nodes.find(node => node.a11y?.label === 'The Secret Garden, Frances Hodgson Burnett' && node.hitTarget)!
  expect(row).toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: row.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  const settings = rerender(2)
  expect(settings.renderTree!.nodes.some(node => node.hitTarget?.role === 'textField' && node.hitTarget.placeholder === 'Your name')).toBe(true)
  expect(settings.renderTree!.nodes.flatMap(node => node.text?.runs.map(run => run.text) ?? [])).not.toContain('Not recognised by the preview')
  const back = settings.renderTree!.nodes.find(node => node.hitTarget?.handlerId.endsWith('/back'))!
  expect(back).toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: back.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  const library = rerender(3)
  expect(library.renderTree!.nodes.some(node => node.a11y?.label === 'The Secret Garden, Frances Hodgson Burnett' && node.hitTarget)).toBe(true)
  expect(library.renderTree!.nodes.some(node => node.hitTarget?.role === 'textField' && node.hitTarget.placeholder === 'Your name')).toBe(false)
})


it('keeps nested destination links and their back history working in the active stack', () => {
  const sources = files('NavigationStack { NavigationLink("Open", destination: FirstView()).navigationTitle("Home") }', 'struct NestedView: View { var body: some View { NavigationStack { NavigationLink("Deeper", value: 7).navigationTitle("Nested").navigationDestination(for: Int.self) { count in Text("Leaf screen").navigationTitle("Leaf") } }.tint(.red) } }')
  const changed = edit(sources, link(sources), 'NestedView()')
  let result = render(changed)
  const tap = (label: string) => {
    const target = result.renderTree!.nodes.find(node => node.a11y?.label === label && node.hitTarget)!
    expect(target, label).toBeDefined()
    expect(applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
    result = rerender(result.revision + 1)
  }
  const back = () => {
    const target = result.renderTree!.nodes.find(node => node.hitTarget?.handlerId.endsWith('/back'))!
    expect(target).toBeDefined()
    expect(applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
    result = rerender(result.revision + 1)
  }
  tap('Open')
  tap('Deeper')
  expect(result.renderTree!.nodes.flatMap(node => node.text?.runs.map(run => run.text) ?? [])).toContain('Leaf screen')
  back()
  expect(result.renderTree!.nodes.some(node => node.a11y?.label === 'Deeper' && node.hitTarget)).toBe(true)
  back()
  expect(result.renderTree!.nodes.some(node => node.a11y?.label === 'Open' && node.hitTarget)).toBe(true)
})
