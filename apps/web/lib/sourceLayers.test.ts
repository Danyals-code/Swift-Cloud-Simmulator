import { describe, expect, it } from 'vitest'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { FOLIO_FILES } from '@studio/project-model/templates'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { hiddenViewsIn } from '@studio/swift-syntax'
import type { AuthoringSnapshot } from '@studio/shared'
import { rebaseSourceLayers, sourceLayerHiddenOwner, sourceLayerHiddenInScope, sourceLayerLabel, sourceLayerNotShown, sourceLayerRows, sourceLayerType, sourceLayerIsVisual, sourceLayerVisibleId, sourceLayerPrimaryViewId, type SourceLayerNavigation } from './sourceLayers'

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
  expect(rows.map(row => row.node.name)).toEqual(['List', 'BookRow'])
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


describe('simple screen elements', () => {
  const run = (body: string, extra = '') => {
    resetPipelineState()
    const text = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { var body: some View { ${body} } }
${extra}`
    const result = compile({ projectId: 'p', revision: 1, files: files(text), canvas: { width: 402, height: 874 }, colorScheme: 'light' })
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const snapshot = result.authoring!
    return { snapshot, layers: result.viewHierarchy!, state: { snapshot, files: files(text), closed: new Set<string>() } }
  }

  it('shows one shared row design for four rendered records, with row details collapsed', () => {
    const { snapshot, layers, state } = run('List { ForEach(0..<4, id: \\.self) { index in HStack { Image(systemName: "book"); Text("Book \\(index)") } } }')
    const result = sourceLayerRows(snapshot, state, undefined, '', { runtimeLayers: layers })
    expect(result.rows.map(row => row.node.name)).toEqual(['List', 'HStack'])
    expect(result.rows[1]!.shared).toBe(true)
    expect(result.rows[1]!.node.runtimeIds).toHaveLength(4)
    expect(result.rows[1]!.expanded).toBe(false)
    const rowId = result.rows[1]!.node.id
    const expanded = sourceLayerRows(snapshot, { ...state, opened: new Set([rowId]) }, undefined, '', { runtimeLayers: layers })
    expect(expanded.rows.map(row => row.node.name)).toEqual(['List', 'HStack', 'Image', 'Text'])
    expect(expanded.rows.filter(row => row.shared)).toHaveLength(1)
  })

  it('keeps four independently declared designs as four editable entries', () => {
    const { snapshot, layers, state } = run('List { Text("One"); Text("Two"); Text("Three"); Text("Four") }')
    const rows = sourceLayerRows(snapshot, state, undefined, '', { runtimeLayers: layers }).rows
    expect(rows.map(row => sourceLayerLabel(row.node))).toEqual(['List', 'One', 'Two', 'Three', 'Four'])
    expect(rows.some(row => row.shared)).toBe(false)
    expect(new Set(rows.slice(1).map(row => row.node.source.start)).size).toBe(4)
  })

  it('groups a multi-element repeated template into one shared design', () => {
    const { snapshot, layers, state } = run('List { ForEach(0..<4, id: \\.self) { index in Text("Title"); Text("Subtitle") } }')
    const rows = sourceLayerRows(snapshot, state, undefined, '', { runtimeLayers: layers }).rows
    expect(rows.map(row => sourceLayerLabel(row.node))).toEqual(['List', 'Row design'])
    expect(rows[1]!.shared).toBe(true)
    expect(rows[1]!.expanded).toBe(false)
    const entered = sourceLayerRows(snapshot, { ...state, entered: rows[1]!.node.id }, rows[1]!.node.id, '', { runtimeLayers: layers })
    expect(entered.rows.map(row => sourceLayerLabel(row.node))).toEqual(['Title', 'Subtitle'])
  })

  it('omits unrendered alternatives and separate pages from the parent phone', () => {
    const { snapshot, layers, state } = run('VStack { Text("Main"); if false { Text("Unavailable") } else { Text("Ready") }; NavigationLink("Details", destination: Text("Detail page")) }.sheet(isPresented: .constant(false)) { Text("Add page") }')
    const rows = sourceLayerRows(snapshot, state, undefined, '', { runtimeLayers: layers }).rows
    expect(rows.map(row => sourceLayerLabel(row.node))).toEqual(['Column', 'Main', 'Ready', 'Details'])
    expect(rows.every(row => !sourceLayerNotShown(snapshot, row.node))).toBe(true)
    const destination = snapshot.nodes.find(node => node.kind === 'branch' && node.name === 'Destination')!
    const separate = sourceLayerRows(snapshot, state, destination.id, '')
    expect(separate.entry?.id).toBe(destination.id)
    expect(separate.rows.map(row => sourceLayerLabel(row.node))).toEqual(['Detail page'])
  })

  it('scopes the main hierarchy to one phone rather than showing all tabs', () => {
    const { snapshot, layers, state } = run('TabView { FirstView().tabItem { Text("First") }; SecondView().tabItem { Text("Second") } }', 'struct FirstView: View { var body: some View { VStack { Text("First content") } } }; struct SecondView: View { var body: some View { Text("Second content") } }')
    const first = snapshot.nodes.find(node => node.name === 'VStack')!
    const find = (items: typeof layers): typeof layers[number] | undefined => {
      for (const layer of items) { if (first.runtimeIds.includes(layer.id)) return layer; const found = find(layer.children); if (found) return found }
    }
    const phone = find(layers)!
    expect(phone).toBeDefined()
    const rows = sourceLayerRows(snapshot, state, undefined, '', { runtimeLayers: [phone] }).rows
    expect(rows.map(row => sourceLayerLabel(row.node))).toEqual(['Column', 'First content'])
    expect(rows.some(row => row.node.name === 'TabView')).toBe(false)
    const otherDefinition = snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'SecondView')!
    const staleEntry = sourceLayerRows(snapshot, { ...state, entered: otherDefinition.id }, otherDefinition.id, '', { runtimeLayers: [phone] })
    expect(staleEntry.entry).toBeUndefined()
    expect(staleEntry.rows.map(row => sourceLayerLabel(row.node))).toEqual(['Column', 'First content'])
  })
})


it('keeps Folio main and secondary phone layers separate using each page hierarchy', () => {
  resetPipelineState()
  const result = compile({ projectId: 'folio', revision: 1, files: [...FOLIO_FILES], canvas: { width: 402, height: 874 }, colorScheme: 'light', allPages: true })
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  const snapshot = result.authoring!
  const state = { snapshot, files: FOLIO_FILES, closed: new Set<string>() }
  const main = result.pages!.find(page => page.kind === 'root' && page.name === 'Library')!
  expect(main).toBeDefined()
  const mainRows = sourceLayerRows(snapshot, state, undefined, '', { runtimeLayers: main.viewHierarchy }).rows
  expect(mainRows.map(row => row.node.name)).toEqual(['List', 'BookRow', 'Button'])
  expect(mainRows.find(row => row.node.name === 'BookRow')?.shared).toBe(true)
  for (const page of result.pages!.filter(page => page.parentId)) {
    const rows = sourceLayerRows(snapshot, state, undefined, '', { runtimeLayers: page.viewHierarchy }).rows
    expect(rows.length, page.name).toBeGreaterThan(0)
    expect(rows.every(row => row.node.name !== 'BookRow'), page.name).toBe(true)
  }
})


describe('live Folio phone layers', () => {
  const open = () => {
    resetPipelineState()
    const result = compile({ projectId: 'folio-live', revision: 1, files: [...FOLIO_FILES], canvas: { width: 402, height: 874 }, colorScheme: 'light' })
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    return result
  }
  const rows = (result: ReturnType<typeof compile>) => {
    const snapshot = result.authoring!
    const focused = result.viewHierarchy!.find(layer => layer.type === 'Presentation') ?? result.viewHierarchy!.find(layer => layer.page?.active)
    expect(focused).toBeDefined()
    return sourceLayerRows(snapshot, { snapshot, files: FOLIO_FILES, closed: new Set() }, undefined, '', { runtimeLayers: [focused!] }).rows
  }
  const tap = (result: ReturnType<typeof compile>, label: string) => {
    const target = result.renderTree!.nodes.find(node => node.hitTarget && node.a11y?.label === label)
    expect(target).toBeDefined()
    expect(applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
    return rerender(2)
  }
  it('opens directly on the Library elements before entering Arrange', () => {
    const layers = rows(open())
    expect(layers.map(row => row.node.name)).toEqual(['List', 'BookRow', 'Button'])
    expect(layers.find(row => row.node.name === 'BookRow')?.shared).toBe(true)
    expect(layers.every(row => row.node.owner === 'LibraryView')).toBe(true)
  })
  it('follows a pushed book detail instead of retaining the Library list', () => {
    const detail = tap(open(), 'The Secret Garden, Frances Hodgson Burnett')
    const layers = rows(detail)
    expect(layers.map(row => row.node.name)).toEqual(['ScrollView', 'VStack'])
    expect(layers.every(row => row.node.owner === 'BookDetailView')).toBe(true)
  })
  it('follows the presented Add book form instead of the underlying Library', () => {
    const layers = rows(tap(open(), 'Add book'))
    expect(layers.length).toBeGreaterThan(0)
    expect(layers.map(row => row.node.name)).toContain('Form')
    expect(layers.every(row => row.node.owner === 'AddBookView')).toBe(true)
  })
})


it('keeps hidden restore controls with their phone, including an empty visible container', () => {
  let text = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  var body: some View {
    NavigationStack {
      VStack {
        Text("Main hidden")
      }.sheet(isPresented: .constant(false)) {
        VStack {
          Text("Modal hidden")
          Text("Modal")
        }
      }
    }
  }
}
struct OtherView: View {
  var body: some View {
    VStack {
      Text("Other hidden")
    }
  }
}
`
  let snapshot = model(text)
  for (const name of ['Main hidden', 'Modal hidden', 'Other hidden']) {
    const target = snapshot.nodes.find(node => sourceLayerLabel(node) === name)!
    const plan = planDesignEdit({ projectId: 'p', baseRevision: snapshot.revision, files: files(text), scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation: { kind: 'hide' } })
    expect(plan.ok, plan.ok ? name : `${name}: ${plan.reason}`).toBe(true)
    if (!plan.ok) throw new Error(plan.reason)
    text = plan.changes[0]!.after!
    snapshot = model(text, snapshot.revision + 1)
  }
  resetPipelineState()
  const result = compile({ projectId: 'p', revision: snapshot.revision + 1, files: files(text), canvas: { width: 402, height: 874 }, colorScheme: 'light', allPages: true })
  snapshot = result.authoring!
  const main = result.pages!.find(page => !page.parentId)!
  const modal = result.pages!.find(page => page.kind === 'sheet')!
  expect(modal).toBeDefined()
  const state = { snapshot, files: files(text), closed: new Set<string>() }
  const markers = hiddenViewsIn(text, 'App.swift').map(hidden => ({ file: 'App.swift', offset: hidden.start, name: hidden.name, type: hidden.type, container: hidden.container }))
  const visible = (page: typeof main) => {
    const { scope } = sourceLayerRows(snapshot, state, undefined, '', { runtimeLayers: page.viewHierarchy })
    return markers.filter(hidden => sourceLayerHiddenInScope(snapshot, hidden, scope)).map(hidden => hidden.name)
  }
  expect(visible(main)).toEqual(['Main hidden'])
  expect(visible(modal)).toEqual(['Modal hidden'])
})
