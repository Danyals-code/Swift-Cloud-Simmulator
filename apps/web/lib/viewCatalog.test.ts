import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import { VIEW_CATALOG, paletteEdit, searchCatalog } from './viewCatalog'

const model = (body: string, deploymentTarget?: string) => buildAuthoringModel({ projectId: 'p', revision: 1, deploymentTarget, files: [{ id: 'App.swift', text: `import SwiftUI\nstruct ContentView: View { var body: some View { ${body} } }` }] })
const entry = (id: string) => VIEW_CATALOG.find(snippet => snippet.id === id)!

describe('the Add palette’s System group (Wave 4a)', () => {
  it('adds a swipe action or a context menu to the selected view, as a modifier with a starter button', () => {
    const text = model('List { Text("Inbox") }').nodes.find(node => node.name === 'Text')!
    expect(paletteEdit(entry('swipe-action'), text)).toEqual({ operation: { kind: 'modifier-add', name: 'swipeActions' }, on: text })
    expect(paletteEdit(entry('context-menu'), text)).toEqual({ operation: { kind: 'modifier-add', name: 'contextMenu' }, on: text })
  })

  it('says to select a view first, since a swipe action belongs to one', () => {
    const toolbar = model('Text("Inbox").toolbar { Button("Save") { } }').nodes.find(node => node.name === 'Toolbar')!
    expect(paletteEdit(entry('swipe-action'), undefined)).toEqual({ operation: { kind: 'modifier-add', name: 'swipeActions' }, problem: 'Select the row to add a swipe action to.' })
    expect(paletteEdit(entry('context-menu'), toolbar)).toEqual({ operation: { kind: 'modifier-add', name: 'contextMenu' }, problem: 'Select the view to add a context menu to.' })
  })

  it('says why a view can’t take a swipe action: it isn’t a row, or the app runs on iOS older than 15', () => {
    const operation = { kind: 'modifier-add', name: 'swipeActions' }
    const loose = model('VStack { Text("Inbox") }').nodes.find(node => node.name === 'Text')!
    expect(paletteEdit(entry('swipe-action'), loose)).toEqual({ operation, problem: expect.stringMatching(/\brow of a List, Form or Section\b/) })
    const older = model('List { Text("Inbox") }', '14.0').nodes.find(node => node.name === 'Text')!
    expect(paletteEdit(entry('swipe-action'), older)).toEqual({ operation, problem: expect.stringMatching(/\biOS 15\b/) })
  })

  it('puts a view into a selected slot, as its last view, and anywhere else where Add always has', () => {
    const snapshot = model('Text("Inbox").toolbar { Button("Save") { } }')
    const toolbar = snapshot.nodes.find(node => node.name === 'Toolbar')!, text = snapshot.nodes.find(node => node.name === 'Text')!
    expect(paletteEdit(entry('button'), toolbar)).toEqual({ operation: { kind: 'insert', snippet: 'Button("Button") { }' }, on: toolbar })
    expect(paletteEdit(entry('button'), text)).toEqual({ operation: { kind: 'insert', snippet: 'Button("Button") { }' } })
    const swipe = model('List { Text("Inbox").swipeActions { Button("Pin") { } } }').nodes.find(node => node.name === 'Swipe actions')!
    expect(paletteEdit(entry('button'), swipe)).toEqual({ operation: { kind: 'insert', snippet: 'Button("Button") { }' }, on: swipe })
  })

  it('leaves a sheet selected as a screen, whose content Add goes into as on any screen', () => {
    const sheet = model('Text("Inbox").sheet(isPresented: .constant(true)) { Text("Details") }').nodes.find(node => node.name === 'Sheet')!
    expect(paletteEdit(entry('text'), sheet)).toEqual({ operation: { kind: 'insert', snippet: 'Text("Text")' } })
  })

  it('inserts an empty state where Add puts any view, as iOS 17’s ContentUnavailableView (Wave 4b)', () => {
    expect(entry('empty-state')).toMatchObject({ name: 'Empty state', group: 'System' })
    expect(paletteEdit(entry('empty-state'), undefined)).toEqual({ operation: { kind: 'insert', snippet: 'ContentUnavailableView("No Results", systemImage: "magnifyingglass", description: Text("Try a different search."))' } })
    expect(searchCatalog('empty')[0]?.id).toBe('empty-state')
    expect(searchCatalog('no results')[0]?.id).toBe('empty-state')
  })

  it('keeps the existing groups first, and finds the new entries by the words people use', () => {
    expect([...new Set(VIEW_CATALOG.map(snippet => snippet.group))]).toEqual(['Layout', 'Content', 'Controls', 'Shapes', 'Navigation', 'System'])
    expect(searchCatalog('swipe')[0]?.id).toBe('swipe-action')
    expect(searchCatalog('long press')[0]?.id).toBe('context-menu')
  })
})
