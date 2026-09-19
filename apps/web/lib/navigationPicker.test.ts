import { beforeEach, expect, it } from 'vitest'
import type { NavigationDestination, PagePreview } from '@studio/shared'
import { FOLIO_FILES } from '@studio/project-model/templates'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { navigationDestinationForPage } from './navigationPicker'

beforeEach(resetPipelineState)
const destination = (viewName: string, expression = viewName + '()', available = true): NavigationDestination => ({ title: viewName, viewName, expression, requirements: [], available, ...(!available ? { reason: 'Book data is unavailable here.' } : {}) })
const options = [destination('LibraryView', 'LibraryView(savedOnly: false)'), destination('LibraryView', 'LibraryView(savedOnly: true)'), destination('BookDetailView', 'BookDetailView(book: book)'), destination('AddBookView'), destination('SettingsView')]
function folio() { return compile({ files: FOLIO_FILES, revision: 1, allPages: true, canvas: { width: 402, height: 874 }, colorScheme: 'light' }) }

it('picks the exact tab component arguments and excludes nested row components', () => {
  const result = folio()
  expect(result.diagnostics).toEqual([])
  const roots = result.pages!.filter(page => !page.parentId)
  const choices = [...options, destination('BookRow', 'BookRow(book: book)')]
  expect(roots.map(page => navigationDestinationForPage(page, choices, result.authoring, FOLIO_FILES).destination?.expression)).toEqual(['LibraryView(savedOnly: false)', 'LibraryView(savedOnly: true)', 'SettingsView()'])
})
it('maps detail route data into the source row scope and picks sheets by their component', () => {
  const result = folio()
  const children = result.pages!.filter(page => page.parentId)
  expect(children.map(page => navigationDestinationForPage(page, options, result.authoring, FOLIO_FILES).destination?.expression)).toEqual(['BookDetailView(book: book)', 'AddBookView()', 'AddBookView()'])
})
it('explains unavailable required data and does not substitute a different tab variant', () => {
  const result = folio()
  const detail = result.pages!.find(page => page.kind === 'destination')!
  expect(navigationDestinationForPage(detail, [destination('BookDetailView', 'BookDetailView()', false)], result.authoring, FOLIO_FILES)).toEqual({ reason: 'Book data is unavailable here.' })
  const reading = result.pages!.find(page => page.name === 'Reading list')!
  expect(navigationDestinationForPage(reading, [options[0]!], result.authoring, FOLIO_FILES).destination).toBeUndefined()
  expect(navigationDestinationForPage({ ...reading, parentId: 'another-screen' }, [options[0]!], result.authoring, FOLIO_FILES).destination).toBeUndefined()
})
it('never identifies an inline screen using a component nested inside it', () => {
  const result = folio()
  const source = result.authoring!.nodes.find(node => node.name === 'VStack')!.source
  const page: PagePreview = { id: 'inline', name: 'Inline', active: false, tree: result.renderTree!, viewHierarchy: [{ id: 'page', name: 'Inline', type: 'Page', children: [{ id: 'root', name: 'VStack', type: 'VStack', source, children: [{ id: 'row', name: 'BookRow', type: 'HStack', source, componentSources: [{ name: 'BookRow', source }], children: [] }] }] }] }
  expect(navigationDestinationForPage(page, options, result.authoring, FOLIO_FILES)).toEqual({ reason: 'This screen is defined inline. Choose a reusable screen from Navigate to.' })
})

it('does not substitute an unrelated local value for another screen variant with the same view type', () => {
  const files = [{ id: 'Main.swift', text: `import SwiftUI
@main struct PickerApp: App { var body: some Scene { WindowGroup { RootView() } } }
struct RootView: View { var body: some View { TabView {
    LinksView().tabItem { Text("Links") }
    OtherView().tabItem { Text("Other") }
} } }
struct LinksView: View {
    @State var flag = false
    var body: some View { NavigationStack { NavigationLink("Next", destination: DetailView()) } }
}
struct OtherView: View {
    @State var savedOnly = true
    var body: some View { NavigationStack { NavigationLink("Saved", destination: LibraryView(savedOnly: savedOnly)) } }
}
struct DetailView: View { var body: some View { Text("Details") } }
struct LibraryView: View {
    let savedOnly: Bool
    var body: some View { Text(savedOnly ? "Saved books" : "All books") }
}` }]
  const result = compile({ files, revision: 1, allPages: true, canvas: { width: 402, height: 874 }, colorScheme: 'light' })
  expect(result.diagnostics).toEqual([])
  const link = result.authoring!.nodes.find(node => node.name === 'NavigationLink' && node.owner === 'LinksView')!
  const choices = link.navigation!.destinations.filter(choice => choice.viewName === 'LibraryView')
  expect(choices.filter(choice => choice.available).map(choice => choice.expression)).toEqual(['LibraryView(savedOnly: flag)'])
  const saved = result.pages!.find(page => page.name === 'Saved')!
  expect(saved.parentId).toBeDefined()
  // Picking the saved-books phone must not silently use an unrelated false flag.
  expect(navigationDestinationForPage(saved, choices, result.authoring, files).destination).toBeUndefined()
})
