import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { hiddenViewsIn } from '@studio/swift-syntax'
import type { AuthoringSnapshot } from '@studio/shared'
import { rebaseSourceLayers, sourceLayerHiddenOwner, sourceLayerLabel, sourceLayerNotShown, sourceLayerRows, sourceLayerType, sourceLayerIsVisual, sourceLayerVisibleId, sourceLayerPrimaryViewId, type SourceLayerNavigation } from './sourceLayers'

const collection = 'ForEach(0..<3, id: \\.self) { i in Text("Row").padding(8) }'
const source = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { var body: some View { VStack { Text("Catalog"); ${collection}; ${collection} } } }`
const files = (text: string) => [{ id: 'App.swift', text }]
const model = (text = source, revision = 1) => buildAuthoringModel({ projectId: 'p', revision, files: files(text) })
const navigation = (snapshot: AuthoringSnapshot, entered?: string): SourceLayerNavigation => ({ snapshot, files: files(source), entered, closed: new Set() })

describe('source layer navigation', () => {
  it('enters the selected instance of two identical templates', () => {
    const snapshot = model(), templates = snapshot.nodes.filter(n => n.kind === 'template')
    expect(templates[0]!.fingerprint).toBe(templates[1]!.fingerprint)
    const result = sourceLayerRows(snapshot, navigation(snapshot, templates[1]!.id), templates[1]!.id, '')
    expect(result.entry?.id).toBe(templates[1]!.id)
    expect(result.rows.map(r => r.node.id)).toEqual(templates[1]!.children)
  })

  it('keeps the second template entered through successive real property edits and undo', () => {
    let text = source, snapshot = model(), state = navigation(snapshot, snapshot.nodes.filter(n => n.kind === 'template')[1]!.id)
    for (const value of ['24', '36', '8']) {
      const entry = snapshot.nodes.find(n => n.id === state.entered)!
      const child = snapshot.nodes.find(n => n.parentId === entry.id && n.name === 'Text')!
      const control = child.controls!.find(c => c.label === 'padding')!
      const plan = planDesignEdit({ projectId: 'p', baseRevision: snapshot.revision, scope: child.owner, files: files(text), target: child.source, fingerprint: child.fingerprint, operation: { kind: 'property', control: control.id, value } })
      expect(plan.ok).toBe(true)
      if (!plan.ok) throw new Error(plan.reason)
      text = plan.changes[0]!.after!
      snapshot = model(text, snapshot.revision + 1)
      state = rebaseSourceLayers(state, snapshot, files(text))
      expect(state.entered).toBe(snapshot.nodes.filter(n => n.kind === 'template')[1]!.id)
    }
    const undo = model(source, snapshot.revision + 1)
    expect(rebaseSourceLayers(state, undo, files(source)).entered).toBe(undo.nodes.filter(n => n.kind === 'template')[1]!.id)
  })

  it('does not redirect a deleted duplicate template to its neighbor', () => {
    const snapshot = model(), second = snapshot.nodes.filter(n => n.kind === 'template')[1]!
    const nextText = source.replace(`; ${collection}`, '')
    const state = rebaseSourceLayers(navigation(snapshot, second.id), model(nextText, 2), files(nextText))
    expect(state.entered).toBeUndefined()
  })

  it('rebases entry and collapsed ancestors when unrelated text is inserted above them', () => {
    const snapshot = model(), entry = snapshot.nodes.find(n => n.kind === 'template')!
    const parent = snapshot.nodes.find(n => n.id === entry.parentId)!
    const nextText = '// note\n' + source, next = model(nextText, 2)
    const state = rebaseSourceLayers({ ...navigation(snapshot, entry.id), closed: new Set([parent.id]) }, next, files(nextText))
    expect(state.entered).toBe(next.nodes.find(n => n.kind === 'template')!.id)
    expect(state.closed).toContain(next.nodes.find(n => n.kind === 'collection')!.id)
  })

  it('reveals a selected descendant through collapsed containers and row templates', () => {
    const snapshot = model(), template = snapshot.nodes.filter(n => n.kind === 'template')[1]!
    const selected = template.children[0]!
    const state = { ...navigation(snapshot), closed: new Set(snapshot.nodes.map(n => n.id)) }
    const result = sourceLayerRows(snapshot, state, selected, '')
    expect(result.rows.some(r => r.node.id === selected)).toBe(true)
    expect(result.rows.find(r => r.node.name === 'VStack')?.expanded).toBe(true)
    expect(result.rows.some(r => r.node.id === template.id)).toBe(false)
    expect(sourceLayerRows(snapshot, { ...state, dismissed: selected }, selected, '').rows.some(r => r.node.id === selected)).toBe(false)
  })

  it('shows the new selection when it is outside the entered template', () => {
    const snapshot = model(), template = snapshot.nodes.find(n => n.kind === 'template')!
    const selected = snapshot.nodes.find(n => sourceLayerLabel(n) === 'Catalog')!.id
    const result = sourceLayerRows(snapshot, navigation(snapshot, template.id), selected, '')
    expect(result.entry).toBeUndefined()
    expect(result.rows.some(r => r.node.id === selected)).toBe(true)
  })

  it('filters the displayed content label, with whitespace and case normalization', () => {
    const snapshot = model(), result = sourceLayerRows(snapshot, navigation(snapshot), undefined, '  cAtAlOg  ')
    expect(result.rows.map(r => sourceLayerLabel(r.node))).toEqual(['Column', 'Catalog'])
    expect(sourceLayerRows(snapshot, navigation(snapshot), undefined, 'Row').rows.filter(r => r.node.name === 'Text')).toHaveLength(2)
  })

  it('clears navigation on a project boundary', () => {
    const snapshot = model(), entry = snapshot.nodes.find(n => n.kind === 'template')!
    const next = { ...snapshot, projectId: 'other' }
    const state = rebaseSourceLayers({ ...navigation(snapshot, entry.id), closed: new Set([entry.id]) }, next, files(source))
    expect(state.entered).toBeUndefined()
    expect(state.closed.size).toBe(0)
  })
})


it('reveals the same selected layer when the canvas selects it again after manual collapse', () => {
  const snapshot = model(), node = snapshot.nodes.find(n => sourceLayerLabel(n) === 'Catalog')!
  const selection = { snapshot, nodeId: node.id, files: files(source) }
  const state = { ...navigation(snapshot), selection, dismissed: node.id, closed: new Set(snapshot.nodes.map(n => n.id)) }
  expect(sourceLayerRows(snapshot, state, node.id, '').rows.some(row => row.node.id === node.id)).toBe(false)
  const next = rebaseSourceLayers(state, snapshot, files(source), { ...selection })
  expect(sourceLayerRows(snapshot, next, node.id, '').rows.some(row => row.node.id === node.id)).toBe(true)
})


describe('designer layer structure', () => {
  it('uses friendly layout names and keeps every row design visible once', () => {
    const snapshot = model(), result = sourceLayerRows(snapshot, navigation(snapshot), undefined, '')
    expect(result.rows.filter(row => row.node.kind === 'template')).toHaveLength(0)
    expect(result.rows.filter(row => row.node.name === 'Text')).toHaveLength(3)
    expect(sourceLayerType({ name: 'VStack', kind: 'view' })).toBe('Column')
    expect(sourceLayerType({ name: 'HStack', kind: 'view' })).toBe('Row')
    expect(sourceLayerType({ name: 'ZStack', kind: 'view' })).toBe('Stack')
    expect(sourceLayerType({ name: 'ForEach', kind: 'collection' })).toBe('Repeat')
    expect(sourceLayerType({ name: 'Row template', kind: 'template' })).toBe('Row design')
    expect(sourceLayerRows(snapshot, navigation(snapshot), undefined, 'column').rows.some(row => row.node.name === 'VStack')).toBe(true)
  })

  it('keeps component instances as views and opens their design without duplicate definitions', () => {
    const snapshot = model(source.replace('Text("Catalog")', 'Card()') + '\nstruct Card: View { var body: some View { Text("Shared") } }')
    const definition = snapshot.nodes.find(node => node.name === 'Card' && node.kind === 'definition')!
    const instance = snapshot.nodes.find(node => node.kind === 'component' && node.name === 'Card')!
    const state = navigation(snapshot)
    const result = sourceLayerRows(snapshot, state, undefined, '')
    expect(result.rows.some(row => row.node.id === instance.id)).toBe(true)
    expect(result.rows.some(row => row.node.kind === 'definition')).toBe(false)
    expect(sourceLayerVisibleId(snapshot, definition.children[0], result.rows)).toBe(instance.id)
    const entered = sourceLayerRows(snapshot, { ...state, entered: definition.id }, definition.children[0], '')
    expect(entered.rows.map(row => row.node.id)).toEqual(definition.children)
    expect(sourceLayerVisibleId(snapshot, definition.id, entered.rows)).toBe(definition.children[0])
  })

  it('does not duplicate screens in components when the app references the same screen twice', () => {
    const snapshot = model(source.replace('WindowGroup { ContentView() }', 'WindowGroup { ContentView(); ContentView() }'))
    const result = sourceLayerRows(snapshot, navigation(snapshot), undefined, '')
    expect(result.rows.filter(row => row.node.name === 'VStack')).toHaveLength(1)
    expect(result.rows.some(row => row.node.kind === 'definition')).toBe(false)
  })

  it('attaches hidden restore controls to their source container, including empty containers', () => {
    const text = source.replace('VStack { Text("Catalog"); ' + collection + '; ' + collection + ' }', 'VStack { }')
    const snapshot = model(text), container = snapshot.nodes.find(node => node.name === 'VStack')!
    expect(container.children).toHaveLength(0)
    expect(sourceLayerHiddenOwner(snapshot, { file: 'App.swift', offset: container.source.start + 10, name: 'Catalog', type: 'Text', container: container.source.start })).toBe(container.id)
    const definition = snapshot.nodes.find(node => node.name === 'ContentView' && node.kind === 'definition')!
    expect(sourceLayerHiddenOwner(snapshot, { file: 'App.swift', offset: container.source.start, name: 'Column', type: 'VStack', container: null })).toBe(definition.id)
    expect(sourceLayerHiddenOwner(snapshot, { file: 'Missing.swift', offset: 3, name: 'Text', type: 'Text', container: null })).toBeUndefined()
  })
})


it('shows inactive branch hints without mistaking its Otherwise content for the true branch', () => {
  const before = model(source.replace('Text("Catalog")', 'if false { Text("Loading") } else { Text("Ready") }'))
  const ready = before.nodes.find(node => sourceLayerLabel(node) === 'Ready')!
  const snapshot = { ...before, runtimeToSource: { ready: ready.id }, nodes: before.nodes.map(node => node.id === ready.id ? { ...node, runtimeIds: ['ready'] } : node) }
  const condition = snapshot.nodes.find(node => node.name === 'Condition')!
  const otherwise = snapshot.nodes.find(node => node.name === 'Otherwise')!
  expect(sourceLayerLabel(condition)).toBe('When false')
  expect(sourceLayerNotShown(snapshot, condition)).toBe(true)
  expect(sourceLayerNotShown(snapshot, otherwise)).toBe(false)
  expect(sourceLayerNotShown(before, condition)).toBe(false)
})

it('uses literal control titles for button and input layer labels', () => {
  const snapshot = model(source.replace('Text("Catalog")', 'Button("Save changes") { }'))
  expect(sourceLayerLabel(snapshot.nodes.find(node => node.name === 'Button')!)).toBe('Save changes')
  expect(sourceLayerType({ name: 'ToolbarItem', kind: 'view' })).toBe('Toolbar item')
})


it('keeps entered row navigation and restoration through move, hide, show, and undo', () => {
  const initial = `import SwiftUI
struct ContentView: View {
    var body: some View {
        ForEach(0..<3, id: \\.self) { index in
            Text("First")
            Text("Second")
        }
    }
}`
  let text = initial, snapshot = model(text), state: SourceLayerNavigation = { snapshot, files: files(text), entered: snapshot.nodes.find(node => node.kind === 'template')!.id, closed: new Set() }
  const refresh = (nextText: string) => {
    text = nextText
    snapshot = model(text, snapshot.revision + 1)
    state = rebaseSourceLayers(state, snapshot, files(text))
    expect(sourceLayerRows(snapshot, state, undefined, '').entry?.kind).toBe('template')
  }
  for (const operation of [{ kind: 'move', direction: -1 }, { kind: 'hide' }] as const) {
    const node = snapshot.nodes.find(node => sourceLayerLabel(node) === 'Second')!
    const plan = planDesignEdit({ projectId: 'p', baseRevision: snapshot.revision, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.reason)
    refresh(plan.changes[0]!.after)
  }
  const hidden = hiddenViewsIn(text, 'App.swift')[0]!
  expect(sourceLayerHiddenOwner(snapshot, { file: 'App.swift', offset: hidden.start, name: hidden.name, type: hidden.type, container: hidden.container })).toBe(state.entered)
  const plan = planDesignEdit({ projectId: 'p', baseRevision: snapshot.revision, files: files(text), scope: 'ContentView', target: { file: 'App.swift', start: hidden.start, end: hidden.start }, operation: { kind: 'show' } })
  expect(plan.ok).toBe(true)
  if (!plan.ok) throw new Error(plan.reason)
  refresh(plan.changes[0]!.after)
  expect(text.indexOf('Text("Second")')).toBeLessThan(text.indexOf('Text("First")'))
  refresh(initial)
  expect(sourceLayerRows(snapshot, state, undefined, '').rows.map(row => sourceLayerLabel(row.node))).toEqual(['First', 'Second'])
})


describe('visual-only layer projection', () => {
  const nested = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { RootView() } } }
struct RootView: View { var body: some View { MainTabs().environmentObject(library).tint(.indigo) } }
struct MainTabs: View { var body: some View { TabView { LibraryView(); LibraryView() } } }
struct LibraryView: View {
    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(0..<3, id: \\.self) { i in
                        NavigationLink { BookRow() }
                    }
                }
                if true { Text("Empty") } else { Text("Ready") }
            }.overlay { Text("Badge") }
        }
    }
}
struct BookRow: View { var body: some View { HStack { Image(systemName: "book"); Text("Title") } } }
`
  it('removes app wiring and duplicate definition collections', () => {
    const snapshot = model(nested)
    const result = sourceLayerRows(snapshot, navigation(snapshot), undefined, '')
    expect(result.rows.map(row => row.node.name)).toEqual(['TabView', 'LibraryView', 'LibraryView'])
    expect(result.rows.map(row => sourceLayerLabel(row.node))).toEqual(['Tabs', 'Library', 'Library'])
    expect(result.rows.map(row => row.depth)).toEqual([0, 1, 1])
  })

  it('flattens repetition, conditions, navigation, and modifier slots into their visual children', () => {
    const snapshot = model(nested)
    const definition = snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'LibraryView')!
    const result = sourceLayerRows(snapshot, navigation(snapshot, definition.id), undefined, '')
    expect(result.rows.map(row => row.node.name)).toEqual(['List', 'BookRow', 'Text', 'Text', 'Text'])
    expect(result.rows.map(row => row.depth)).toEqual([0, 1, 1, 1, 1])
    expect(result.rows.every(row => sourceLayerIsVisual(row.node))).toBe(true)
    const list = result.rows[0]!
    expect(list.children).toEqual(result.rows.slice(1).map(row => row.node.id))
    expect(result.rows.slice(1).every(row => row.parentId === list.node.id)).toBe(true)
    // Presentation ancestry must never overwrite the Swift source parent used for edits.
    expect(result.rows[1]!.node.parentId).not.toBe(list.node.id)
  })

  it('maps hidden contexts and collapsed descendants to their nearest displayed view', () => {
    const snapshot = model(nested)
    const definition = snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'LibraryView')!
    const list = snapshot.nodes.find(node => node.name === 'List')!
    const template = snapshot.nodes.find(node => node.kind === 'template')!
    const book = snapshot.nodes.find(node => node.kind === 'component' && node.name === 'BookRow')!
    const state = navigation(snapshot, definition.id)
    const expanded = sourceLayerRows(snapshot, state, undefined, '')
    expect(sourceLayerVisibleId(snapshot, template.id, expanded.rows)).toBe(list.id)
    const collapsed = sourceLayerRows(snapshot, { ...state, closed: new Set([list.id]) }, undefined, '')
    expect(sourceLayerVisibleId(snapshot, book.id, collapsed.rows)).toBe(list.id)
    expect(collapsed.rows.map(row => row.node.id)).toEqual([list.id])
  })

  it('never guesses which reused component instance owns a source-only selection', () => {
    const snapshot = model(nested)
    const rows = sourceLayerRows(snapshot, navigation(snapshot), undefined, '').rows
    const inner = snapshot.nodes.find(node => node.name === 'List')!
    expect(sourceLayerVisibleId(snapshot, inner.id, rows)).toBeUndefined()
    for (const instance of rows.filter(row => row.node.name === 'LibraryView')) expect(sourceLayerVisibleId(snapshot, instance.node.id, rows)).toBe(instance.node.id)
  })

  it('keeps a title-only navigation link visible when it has no explicit label view', () => {
    const snapshot = model(source.replace('Text("Catalog")', 'NavigationLink("Details", destination: Text("Detail")).overlay { Text("Badge") }'))
    const link = snapshot.nodes.find(node => node.name === 'NavigationLink')!
    expect(sourceLayerIsVisual(link)).toBe(true)
    expect(sourceLayerLabel(link)).toBe('Details')
    expect(sourceLayerRows(snapshot, navigation(snapshot), undefined, '').rows.some(row => row.node.id === link.id)).toBe(true)
  })
})


it('enters design scopes selected from Settings and allows returning to all screens', () => {
  const snapshot = model(), template = snapshot.nodes.find(node => node.kind === 'template')!
  const selected = sourceLayerRows(snapshot, navigation(snapshot), template.id, '')
  expect(selected.entry?.id).toBe(template.id)
  expect(selected.rows.map(row => row.node.id)).toEqual(template.children)
  const exited = sourceLayerRows(snapshot, { ...navigation(snapshot), dismissedEntry: template.id }, template.id, '')
  expect(exited.entry).toBeUndefined()
  expect(exited.rows[0]!.node.name).toBe('VStack')
  const selection = { snapshot, nodeId: template.id, files: files(source) }
  const reentered = rebaseSourceLayers({ ...navigation(snapshot), selection, dismissedEntry: template.id }, snapshot, files(source), { ...selection })
  expect(sourceLayerRows(snapshot, reentered, template.id, '').entry?.id).toBe(template.id)
})


it('names tab component instances by literal tab labels while preserving identities and computed titles', () => {
  const text = `import SwiftUI
struct ContentView: View { var body: some View { TabView {
  LibraryView().tabItem { Label("Library", systemImage: "books.vertical") }
  LibraryView().tabItem { Label("Reading list", systemImage: "bookmark") }
  LibraryView().tabItem { Text(dynamicTitle) }
} } }
struct LibraryView: View { var body: some View { Text("Books") } }
`
  const snapshot = model(text)
  const instances = snapshot.nodes.filter(node => node.kind === 'component')
  expect(instances.map(sourceLayerLabel)).toEqual(['Library', 'Reading list', 'Library'])
  const rows = sourceLayerRows(snapshot, navigation(snapshot), undefined, '').rows
  expect(rows.slice(1).map(row => row.node.id)).toEqual(instances.map(node => node.id))
})

it('preserves additional visual content on a root component instead of forwarding past it', () => {
  const text = `import SwiftUI
struct ContentView: View { var body: some View { CardView().overlay { Text("Badge") } } }
struct CardView: View { var body: some View { Text("Card") } }
`
  const snapshot = model(text)
  expect(sourceLayerRows(snapshot, navigation(snapshot), undefined, '').rows.map(row => sourceLayerLabel(row.node))).toEqual(['Card', 'Badge'])
})


it('maps a hidden navigation link to its label view before List, excluding the destination', () => {
  const text = `import SwiftUI
struct ContentView: View { var body: some View { List { NavigationLink(destination: Text("Destination")) { BookRow() } } } }
struct BookRow: View { var body: some View { Text("Book title") } }
`
  const snapshot = model(text)
  const list = snapshot.nodes.find(node => node.name === 'List')!
  const link = snapshot.nodes.find(node => node.name === 'NavigationLink')!
  const label = snapshot.nodes.find(node => node.name === 'BookRow' && node.kind === 'component')!
  const rows = sourceLayerRows(snapshot, navigation(snapshot), undefined, '').rows
  expect(rows.map(row => row.node.name)).toEqual(['List', 'BookRow', 'Text'])
  expect(sourceLayerPrimaryViewId(snapshot, link.id, rows)).toBe(label.id)
  expect(sourceLayerVisibleId(snapshot, link.id, rows)).toBe(label.id)
  expect(label.parentId).toBe(link.id)
  const collapsed = sourceLayerRows(snapshot, { ...navigation(snapshot), closed: new Set([list.id]) }, undefined, '').rows
  expect(sourceLayerPrimaryViewId(snapshot, link.id, collapsed)).toBeUndefined()
  expect(sourceLayerVisibleId(snapshot, link.id, collapsed)).toBe(list.id)
})

it('does not guess a primary view when a hidden wrapper has multiple label views', () => {
  const text = `import SwiftUI
struct ContentView: View { var body: some View { List { NavigationLink(destination: Text("Destination")) { Text("First"); Text("Second") } } } }
`
  const snapshot = model(text)
  const link = snapshot.nodes.find(node => node.name === 'NavigationLink')!
  const list = snapshot.nodes.find(node => node.name === 'List')!
  const filtered = sourceLayerRows(snapshot, navigation(snapshot), undefined, 'First').rows
  expect(sourceLayerPrimaryViewId(snapshot, link.id, filtered)).toBeUndefined()
  expect(sourceLayerVisibleId(snapshot, link.id, filtered)).toBe(list.id)
})
