import { beforeEach, expect, it } from 'vitest'
import type { CompileResult, RenderTree } from '@studio/shared'
import { FOLIO_FILES } from '@studio/project-model/templates'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'

beforeEach(resetPipelineState)
let revision = 0
const texts = (tree: RenderTree) => tree.nodes.flatMap(node => node.text?.runs.map(run => run.text) ?? []).join(' ')
const options = { canvas: { width: 402, height: 874 }, safeArea: { top: 59, leading: 0, bottom: 34, trailing: 0 }, colorScheme: 'light' as const, allPages: true }
function folio() {
  const result = compile({ ...options, files: FOLIO_FILES, revision: ++revision })
  expect(result.diagnostics).toEqual([])
  return result
}
function run(body: string, declarations = '', state = '') {
  const result = compile({ ...options, files: [{ id: 'App.swift', text: `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { ${state}; var body: some View { ${body} } }
${declarations}` }], revision: ++revision })
  expect(result.diagnostics).toEqual([])
  return result
}
function tap(result: CompileResult, label: string) {
  const target = result.renderTree!.nodes.find(node => node.a11y?.label === label && node.hitTarget)
  expect(target, label).toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(++revision)
}

it('places real Folio details and the add form under their owning tabs', () => {
  const result = folio()
  const roots = result.pages!.filter(page => !page.parentId)
  expect(roots.map(page => page.name)).toEqual(['Library', 'Reading list', 'Settings'])
  const library = roots[0]!
  const children = result.pages!.filter(page => page.parentId === library.id)
  expect(children.map(page => [page.kind, page.name])).toEqual([['destination', 'Book details'], ['sheet', 'Add a book']])
  expect(texts(children[0]!.tree)).toContain('The Secret Garden')
  expect(texts(children[0]!.tree)).toContain('A locked garden, an unexpected friendship')
  expect(texts(children[0]!.tree)).toContain('Save to reading list')
  expect(children[1]!.tree.nodes.filter(node => node.hitTarget?.role === 'textField').map(node => node.hitTarget?.placeholder)).toEqual(['Title', 'Author'])
  expect(children.every(page => page.rootId === library.id && !page.active && !page.handlerId)).toBe(true)
  expect(result.pages!.filter(page => page.parentId === roots[1]!.id).map(page => page.name)).toEqual(['Add a book'])
  expect(result.pages!.filter(page => page.parentId === roots[2]!.id)).toHaveLength(0)
  expect(texts(library.tree)).toContain('The Time Machine')
  expect(library.tree.nodes.some(node => node.id === 'overlay-surface')).toBe(false)
})

it('binds child content to its Swift source and gives each preview independent identities', () => {
  const result = folio()
  const children = result.pages!.filter(page => page.parentId)
  const runtimeIds = children.flatMap(page => page.viewHierarchy?.flatMap(layer => {
    const visit = (item: typeof layer): string[] => [item.id, ...item.children.flatMap(visit)]
    return visit(layer)
  }) ?? [])
  expect(new Set(runtimeIds).size).toBe(runtimeIds.length)
  const title = result.authoring!.nodes.find(node => node.owner === 'BookDetailView' && node.name === 'Text' && node.runtimeIds.length)
  expect(title).toBeDefined()
  expect(title!.runtimeIds.some(id => id.includes('/preview:destination:'))).toBe(true)
  const ids = result.pages!.map(page => page.id)
  expect(rerender(++revision).pages!.map(page => page.id)).toEqual(ids)
})

it('keeps the main tab phone separate when the live app opens a detail or sheet', () => {
  let result = tap(folio(), 'The Secret Garden, Frances Hodgson Burnett')
  expect(texts(result.renderTree!)).toContain('A locked garden')
  const library = result.pages!.find(page => !page.parentId && page.name === 'Library')!
  expect(texts(library.tree)).toContain('The Time Machine')
  expect(texts(library.tree)).not.toContain('A locked garden')
  result = tap(result, 'Library')
  // Selecting a tab preserves its stack, so return with its own back control.
  result = tap(result, 'Library')
  if (texts(result.renderTree!).includes('A locked garden')) {
    const back = result.renderTree!.nodes.find(node => node.hitTarget?.handlerId.endsWith('/back'))!
    expect(back).toBeDefined()
    applyEvent({ kind: 'tap', handlerId: back.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    result = rerender(++revision)
  }
  result = tap(result, 'Add book')
  expect(result.renderTree!.nodes.some(node => node.id === 'overlay-surface')).toBe(true)
  expect(result.pages!.find(page => !page.parentId && page.name === 'Library')!.tree.nodes.some(node => node.id === 'overlay-surface')).toBe(false)
})

it('uses current shared state without dispatching preview actions or lifecycle hooks', () => {
  let result = tap(folio(), 'The Secret Garden, Frances Hodgson Burnett')
  result = tap(result, 'Save to reading list')
  const reading = result.pages!.find(page => !page.parentId && page.name === 'Reading list')!
  expect(texts(reading.tree)).toContain('The Secret Garden')
  const detail = result.pages!.find(page => page.parentId === reading.id && page.kind === 'destination')!
  expect(texts(detail.tree)).toContain('Remove from reading list')
  const remove = detail.tree.nodes.find(node => node.a11y?.label === 'Remove from reading list' && node.hitTarget)!
  expect(applyEvent({ kind: 'tap', handlerId: remove.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(false)
  result = rerender(++revision)
  expect(texts(result.pages!.find(page => page.id === reading.id)!.tree)).toContain('The Secret Garden')
})

it('isolates deferred builders and skips unsafe sheets without disturbing live state', () => {
  const result = run(`NavigationStack {
    VStack { Text("Count: \\(store.count)"); NavigationLink("Open", value: 1) }
      .navigationDestination(for: Int.self) { value in
        ImpureDetail(store: store)
      }
      .sheet(isPresented: $show) { Text(selected!) }
  }`, `final class Store: ObservableObject { @Published var count = 0 }
struct ImpureDetail: View {
  let store: Store
  var body: some View {
    store.count += 10
    return Text("Preview: \\(store.count)").onAppear { store.count += 100 }
  }
}`, '@StateObject var store = Store(); @State var show = false; @State var selected: String? = nil')
  expect(texts(result.renderTree!)).toContain('Count: 0')
  expect(result.pages!.filter(page => page.kind === 'destination')).toHaveLength(1)
  expect(result.pages!.filter(page => page.kind === 'sheet')).toHaveLength(0)
  expect(texts(rerender(++revision).renderTree!)).toContain('Count: 0')
})

it('deduplicates repeated row routes and bounds recursive screen discovery', () => {
  const result = run(`NavigationStack {
    List { ForEach(0..<40, id: \\.self) { index in NavigationLink("Item \\(index)", value: index) } }
      .navigationDestination(for: Int.self) { value in
        VStack { Text("Detail \\(value)"); NavigationLink("Deeper", destination: Text("Leaf")) }
      }
  }`)
  expect(result.pages!.filter(page => page.kind === 'destination')).toHaveLength(2)
  const [first, second] = result.pages!.filter(page => page.kind === 'destination')
  expect(texts(first!.tree)).toContain('Detail 0')
  expect(second!.parentId).toBe(first!.id)
  expect(texts(second!.tree)).toContain('Leaf')
})

it('finds presentations attached to the navigation container', () => {
  const result = run(`NavigationStack { Text("Main") }
    .sheet(isPresented: $show) { NavigationStack { Text("Compose form").navigationTitle("Compose") } }`, '', '@State var show = false')
  expect(result.pages!.filter(page => page.parentId).map(page => page.name)).toEqual(['Compose'])
  expect(texts(result.renderTree!)).toBe('Main')
})

it('matches each value link to its declared destination type', () => {
  const result = run(`NavigationStack {
    VStack { NavigationLink("Number", value: 7); NavigationLink("Word", value: "word") }
      .navigationDestination(for: Int.self) { number in Text("Number \\(number)").navigationTitle("Numbers") }
      .navigationDestination(for: String.self) { word in Text("Word \\(word)").navigationTitle("Words") }
  }`)
  const children = result.pages!.filter(page => page.parentId)
  expect(children.map(page => page.name)).toEqual(['Numbers', 'Words'])
  expect(texts(children[0]!.tree)).toContain('Number 7')
  expect(texts(children[1]!.tree)).toContain('Word word')
})

it('caps related phones without dropping the owning root tabs', () => {
  const links = Array.from({ length: 20 }, (_, index) => `NavigationLink("Go ${index}", destination: Text("Page ${index}"))`).join('; ')
  const result = run(`TabView {
    NavigationStack { VStack { ${links} } }.tabItem { Text("One") }
    Text("Second root").tabItem { Text("Two") }
  }`)
  expect(result.pages!.filter(page => page.parentId)).toHaveLength(12)
  expect(result.pages!.filter(page => !page.parentId).map(page => page.name)).toEqual(['One', 'Two'])
})


it('keeps related page identities when edits move their Swift source offsets', () => {
  const body = (label: string) => `NavigationStack { VStack { Text("${label}"); NavigationLink("Open", destination: Text("Details")) }.sheet(isPresented: $show) { Text("Compose") } }`
  const before = run(body('Short'), '', '@State var show = false')
  const after = run(body('A considerably longer heading'), '', '@State var show = false')
  expect(after.pages!.map(page => page.id)).toEqual(before.pages!.map(page => page.id))
  expect(after.pages!.filter(page => page.parentId).map(page => page.source?.start)).not.toEqual(before.pages!.filter(page => page.parentId).map(page => page.source?.start))
})

it('keeps inherited tint in a standalone destination', () => {
  const result = run(`NavigationStack {
    NavigationLink("Open", destination: Button("Action") {})
  }.tint(.red)`)
  const child = result.pages!.find(page => page.kind === 'destination')!
  const live = tap(result, 'Open').renderTree!
  const buttonColor = (tree: RenderTree) => tree.nodes.flatMap(node => node.text?.runs ?? []).find(run => run.text === 'Action')?.color
  expect(buttonColor(live)).toBeDefined()
  expect(buttonColor(child.tree)).toEqual(buttonColor(live))
})
