import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { authoringSettingsContext, settingsVisualChildren } from './authoringSettings'

const model = (body: string, members = '') => {
  const text = `import SwiftUI
struct Item: Identifiable { let id: String; var title: String }
struct DetailView: View { var body: some View { Text("Details") } }
struct ContentView: View {
${members}
var body: some View { ${body} }
}`
  const files = [{ id: 'App.swift', text }]
  return { text, files, snapshot: buildAuthoringModel({ projectId: 'settings', revision: 1, files }) }
}

const repeated = 'List { Section { ForEach(items) { item in NavigationLink(destination: DetailView()) { HStack { Text(item.title) } } } } }'
const records = '@State var items: [Item] = [Item(id: "one", title: "First")]'

describe('contextual designer settings', () => {
  it('finds repeated data nested under list sections without promoting source wrappers to layers', () => {
    const { snapshot } = model(repeated, records)
    const list = snapshot.nodes.find(node => node.name === 'List')!
    const context = authoringSettingsContext(snapshot, list)
    expect(context.collections.map(node => node.name)).toEqual(['ForEach'])
    expect(context.collections[0]?.collection?.records).toEqual([{ id: 'one', title: 'First' }])
    expect(settingsVisualChildren(snapshot, list).map(node => node.name)).toEqual(['HStack'])
    const template = snapshot.nodes.find(node => node.kind === 'template')!
    expect(settingsVisualChildren(snapshot, template).map(node => node.name)).toEqual(['HStack'])
    const destination = context.slots.find(node => node.name === 'Destination')!
    expect(settingsVisualChildren(snapshot, destination).map(node => node.name)).toEqual(['DetailView'])
  })

  it('keeps repetition and navigation ownership on a deeply selected row view', () => {
    const { snapshot } = model(repeated, records)
    const text = snapshot.nodes.find(node => node.name === 'Text' && node.owner === 'ContentView')!
    const context = authoringSettingsContext(snapshot, text)
    expect(context.repeatedBy?.name).toBe('ForEach')
    expect(context.list?.name).toBe('List')
    expect(context.navigation.map(node => node.name)).toEqual(['NavigationLink'])
    expect(context.collections).toEqual([])
  })

  it('does not expose the data of a different visual container as the current view data', () => {
    const { snapshot } = model(`VStack { ${repeated} Text("Footer") }`, records)
    const stack = snapshot.nodes.find(node => node.name === 'VStack')!
    expect(authoringSettingsContext(snapshot, stack).collections).toEqual([])
  })

  it('preserves alternate visibility rules and direct links to slot contents', () => {
    const { snapshot } = model('VStack { if ready { Text("Ready") } else { Text("Waiting") } }.overlay { Text("Badge") }.toolbar { ToolbarItem { Button("Save") {} } }', '@State var ready = true')
    const waiting = snapshot.nodes.find(node => node.controls?.some(control => control.value === 'Waiting'))!
    expect(authoringSettingsContext(snapshot, waiting).conditions.map(node => node.name)).toEqual(['Condition', 'Otherwise'])
    const stack = snapshot.nodes.find(node => node.name === 'VStack')!
    const context = authoringSettingsContext(snapshot, stack)
    expect(context.slots.map(node => node.name)).toEqual(['Overlay', 'Toolbar'])
    expect(settingsVisualChildren(snapshot, context.slots[1]!).map(node => node.name)).toEqual(['Button'])
  })

  it('edits records through the exact nested collection owner', () => {
    const { text, files, snapshot } = model(repeated, records)
    const list = snapshot.nodes.find(node => node.name === 'List')!
    const owner = authoringSettingsContext(snapshot, list).collections[0]!
    const plan = planDesignEdit({ projectId: 'settings', baseRevision: 1, scope: owner.owner, files, target: owner.source, fingerprint: owner.fingerprint, operation: { kind: 'records', records: [{ id: 'one', title: 'Updated' }] } })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.changes[0]?.after).toBe(text.replace('title: "First"', 'title: "Updated"'))
  })

  it('keeps a hidden wrapper modifier bound to its owner instead of the selected child', () => {
    const { text, files, snapshot } = model('Group { Text("Title").padding(4) }.padding(12)')
    const child = snapshot.nodes.find(node => node.name === 'Text' && node.owner === 'ContentView')!
    const owner = authoringSettingsContext(snapshot, child).surrounding.find(node => node.name === 'Group')!
    const control = owner.modifiers!.find(modifier => modifier.name === 'padding')!.controls[0]!
    const plan = planDesignEdit({ projectId: 'settings', baseRevision: 1, scope: owner.owner, files, target: owner.source, fingerprint: owner.fingerprint, operation: { kind: 'property', control: control.id, value: '24' } })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.changes[0]?.after).toBe(text.replace('}.padding(12)', '}.padding(24)'))
  })
})


describe('forwarded app container settings', () => {
  const source = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { RootView() } } }
final class LibraryStore: ObservableObject { @Published var count = 0 }
struct RootView: View { @StateObject var library = LibraryStore(); @State var ready = true; var body: some View { MainTabs().environmentObject(library).tint(.indigo).padding(12) } }
struct MainTabs: View { var body: some View { TabView { LibraryView(); LibraryView() } } }
struct LibraryView: View { var body: some View { Text("Library") } }
`
  const project = (text = source) => {
    const files = [{ id: 'App.swift', text }]
    return { files, snapshot: buildAuthoringModel({ projectId: 'settings', revision: 1, files }) }
  }

  it('exposes forwarded app settings on Tabs with the original source owner', () => {
    const { files, snapshot } = project()
    const tabs = snapshot.nodes.find(node => node.name === 'TabView')!
    const context = authoringSettingsContext(snapshot, tabs)
    const container = context.surrounding.find(node => node.name === 'MainTabs')!
    expect(container.owner).toBe('RootView')
    expect(container.modifiers!.map(modifier => modifier.name)).toEqual(['environmentObject', 'tint', 'padding'])
    const control = container.modifiers!.find(modifier => modifier.name === 'padding')!.controls[0]!
    const plan = planDesignEdit({ projectId: 'settings', baseRevision: 1, scope: container.owner, files, target: container.source, fingerprint: container.fingerprint, operation: { kind: 'property', control: control.id, value: '24' } })
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.ok).toBe(true)
    expect(plan.changes[0]?.after).toBe(source.replace('.padding(12)', '.padding(24)'))
    expect(context.ancestors.some(node => node.id === container.id)).toBe(false)
  })

  it('never attaches one of several callers to shared component settings', () => {
    const { snapshot } = project()
    const text = snapshot.nodes.find(node => node.name === 'Text' && node.owner === 'LibraryView')!
    const context = authoringSettingsContext(snapshot, text)
    expect(context.forwarded).toEqual([])
    expect(context.surrounding).toEqual([])
  })

  it('does not attach a visible component call inside another visual container', () => {
    const { snapshot } = project(source.replace('LibraryView(); LibraryView()', 'LibraryView().padding(5)'))
    const text = snapshot.nodes.find(node => node.name === 'Text' && node.owner === 'LibraryView')!
    expect(authoringSettingsContext(snapshot, text).forwarded).toEqual([])
  })

  it('retains a condition in a forwarded app root as visibility settings', () => {
    const { snapshot } = project(source.replace('MainTabs().environmentObject(library).tint(.indigo).padding(12)', 'if ready { MainTabs() }'))
    const tabs = snapshot.nodes.find(node => node.name === 'TabView')!
    expect(authoringSettingsContext(snapshot, tabs).conditions.map(node => node.properties[0]?.expression)).toEqual(['ready'])
  })
})
