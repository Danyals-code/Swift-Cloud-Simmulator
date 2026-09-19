import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { hiddenViewsIn } from '@studio/swift-syntax'
import type { AuthoringSnapshot } from '@studio/shared'
import { rebaseSourceLayers, sourceLayerHiddenOwner, sourceLayerLabel, sourceLayerNotShown, sourceLayerRows, sourceLayerType, type SourceLayerNavigation } from './sourceLayers'

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
    expect(result.rows.map(r => r.node.id)).toEqual([templates[1]!.id, ...templates[1]!.children])
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
    expect(result.rows.find(r => r.node.id === template.id)?.expanded).toBe(true)
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
    expect(result.rows.map(r => sourceLayerLabel(r.node))).toEqual(['ContentView', 'Column', 'Catalog'])
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
    expect(result.rows.filter(row => row.node.kind === 'template')).toHaveLength(2)
    expect(result.rows.filter(row => row.node.name === 'Text')).toHaveLength(3)
    expect(sourceLayerType({ name: 'VStack', kind: 'view' })).toBe('Column')
    expect(sourceLayerType({ name: 'HStack', kind: 'view' })).toBe('Row')
    expect(sourceLayerType({ name: 'ZStack', kind: 'view' })).toBe('Stack')
    expect(sourceLayerType({ name: 'ForEach', kind: 'collection' })).toBe('Repeat')
    expect(sourceLayerType({ name: 'Row template', kind: 'template' })).toBe('Row design')
    expect(sourceLayerRows(snapshot, navigation(snapshot), undefined, 'column').rows.some(row => row.node.name === 'VStack')).toBe(true)
  })

  it('groups reusable definitions while keeping instances in screen structure', () => {
    const snapshot = model(source.replace('Text("Catalog")', 'Card()') + '\nstruct Card: View { var body: some View { Text("Shared") } }')
    const definition = snapshot.nodes.find(node => node.name === 'Card' && node.kind === 'definition')!
    const instance = snapshot.nodes.find(node => node.kind === 'component' && node.name === 'Card')!
    const state = navigation(snapshot)
    const collapsed = sourceLayerRows(snapshot, state, undefined, '')
    expect(collapsed.components).toEqual([definition.id])
    expect(collapsed.rows.some(row => row.node.id === instance.id)).toBe(true)
    expect(collapsed.rows.some(row => row.node.id === definition.id)).toBe(false)
    const selected = sourceLayerRows(snapshot, state, definition.children[0], '')
    expect(selected.componentsExpanded).toBe(true)
    expect(selected.rows.some(row => row.node.id === definition.children[0])).toBe(true)
    const searched = sourceLayerRows(snapshot, state, undefined, 'Shared')
    expect(searched.rows.some(row => row.node.id === definition.children[0])).toBe(true)
    const entered = sourceLayerRows(snapshot, { ...state, entered: definition.id }, definition.children[0], '')
    expect(entered.rows.map(row => row.node.id)).toEqual([definition.id, ...definition.children])
  })

  it('does not duplicate screens in components when the app references the same screen twice', () => {
    const snapshot = model(source.replace('WindowGroup { ContentView() }', 'WindowGroup { ContentView(); ContentView() }'))
    const result = sourceLayerRows(snapshot, navigation(snapshot), undefined, '')
    expect(result.rows.filter(row => row.node.name === 'ContentView')).toHaveLength(1)
    expect(result.components).toHaveLength(0)
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
  expect(sourceLayerRows(snapshot, state, undefined, '').rows.map(row => sourceLayerLabel(row.node))).toEqual(['Row design', 'First', 'Second'])
})
