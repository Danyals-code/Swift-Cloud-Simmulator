import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import { screen, typecheckInXcode, XCODE } from '../../../tests/helpers/layer-project'
import { VIEW_CATALOG, paletteEdit, paletteGate, searchCatalog } from './viewCatalog'

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

describe('the views the Add palette offers since Wave 4c', () => {
  /** The views of a screen whose body is a VStack holding `snippet`, as the panel reads them. */
  const read = (snippet: string) => model(`VStack {\n${snippet}\n}`).nodes.filter(node => node.owner === 'ContentView' && node.kind !== 'definition')

  it.each([
    ['lazy-column', 'Layout', 'LazyVStack'], ['lazy-row', 'Layout', 'LazyHStack'], ['grid-rows', 'Layout', 'Grid'], ['disclosure', 'Layout', 'DisclosureGroup'],
    ['gauge', 'Content', 'Gauge'], ['share-link', 'Content', 'ShareLink'],
    ['secure-field', 'Controls', 'SecureField'], ['text-editor', 'Controls', 'TextEditor'], ['menu', 'Controls', 'Menu'],
    ['ellipse', 'Shapes', 'Ellipse'], ['uneven-rect', 'Shapes', 'UnevenRoundedRectangle'], ['gradient', 'Shapes', 'LinearGradient'],
  ])('offers %s in %s, written as a %s the panel reads back as itself', (id, group, view) => {
    expect(entry(id).group).toBe(group)
    expect(entry(id).swiftName ?? entry(id).name).toBe(view)
    const nodes = read(entry(id).snippet)
    expect(nodes.find(node => node.kind === 'view' && node.name === view)).toBeDefined()
    expect(nodes.filter(node => node.kind === 'opaque')).toEqual([])
  })

  it('offers Color, a colour filling its space, which the panel reads as a view of its own', () => {
    expect(entry('color')).toMatchObject({ name: 'Color', group: 'Shapes' })
    const nodes = read(entry('color').snippet)
    expect(nodes.find(node => node.kind === 'view' && node.name === 'Color')).toBeDefined()
    expect(nodes.filter(node => node.kind === 'opaque')).toEqual([])
  })

  it('offers each view only from the iOS that has it, saying why below it, as the modifier picker does', () => {
    expect(paletteGate(entry('grid-rows'), '15.0')).toBe('Needs iOS 16 or newer. Change the deployment target to use it.')
    expect(paletteGate(entry('grid-rows'), '16.0')).toBeUndefined()
    expect(paletteGate(entry('lazy-column'), '13.0')).toBe('Needs iOS 14 or newer. Change the deployment target to use it.')
    expect(paletteGate(entry('text'), '13.0')).toBeUndefined()
    // A project that names none targets the iOS the preview draws.
    expect(paletteGate(entry('empty-state'), undefined)).toBeUndefined()
  })

  it('writes a Form, a Section and a Card with a header view below iOS 15, which has no title of words for them', () => {
    const insert = (id: string, target: string | undefined) => paletteEdit(entry(id), undefined, undefined, target).operation
    expect(insert('form', '14.0')).toEqual({ kind: 'insert', snippet: 'Form {\n    Section(header: Text("Section")) {\n        Text("Field")\n    }\n}' })
    expect(insert('section', '13.0')).toEqual({ kind: 'insert', snippet: 'Section(header: Text("Section")) {\n    Text("Row")\n}' })
    expect(insert('groupbox', '14.0')).toEqual({ kind: 'insert', snippet: 'GroupBox(label: Text("Title")) {\n    Text("Content")\n        .frame(maxWidth: .infinity, alignment: .leading)\n}' })
    expect(insert('section', '15.0')).toEqual({ kind: 'insert', snippet: 'Section("Section") {\n    Text("Row")\n}' })
    expect(insert('section', undefined)).toEqual({ kind: 'insert', snippet: 'Section("Section") {\n    Text("Row")\n}' })
    expect([paletteGate(entry('form'), '13.0'), paletteGate(entry('section'), '13.0'), paletteGate(entry('groupbox'), '13.0')]).toEqual([undefined, undefined, 'Needs iOS 14 or newer. Change the deployment target to use it.'])
  })

  it('adds a carousel where Add puts any view: a page-style TabView of three pages, 240 points tall, its dots always shown on a capsule that keeps them seen on white', () => {
    const carousel = 'TabView {\n    Text("Page 1")\n    Text("Page 2")\n    Text("Page 3")\n}\n.tabViewStyle(.page(indexDisplayMode: .always))\n.indexViewStyle(.page(backgroundDisplayMode: .always))\n.frame(height: 240)'
    expect(entry('carousel')).toMatchObject({ name: 'Carousel', group: 'System' })
    expect(paletteEdit(entry('carousel'), undefined)).toEqual({ operation: { kind: 'insert', snippet: carousel } })
    expect(paletteGate(entry('carousel'), '13.0')).toMatch(/\biOS 14\b/)
    expect(searchCatalog('carousel')[0]?.id).toBe('carousel')
    expect(searchCatalog('onboarding')[0]?.id).toBe('carousel')
  })

  it('adds a search field to the screen, as the Bars section’s switch does, or says why it can’t', () => {
    const operation = { kind: 'searchable-add', prompt: 'Search' }
    const screenOf = (body: string) => model(body).nodes.find(node => node.kind === 'definition' && node.name === 'ContentView')!
    const inbox = screenOf('NavigationStack { List { Text("Inbox") } }')
    const text = model('NavigationStack { List { Text("Inbox") } }').nodes.find(node => node.name === 'Text')!
    expect(paletteEdit(entry('search-field'), text, inbox)).toEqual({ operation, on: inbox })
    expect(paletteEdit(entry('search-field'), undefined, undefined)).toEqual({ operation, problem: 'Select a screen to add a search field to.' })
    expect(paletteEdit(entry('search-field'), undefined, screenOf('NavigationStack { List { Text("Inbox") }.searchable(text: .constant("")) }'))).toEqual({ operation, problem: 'This screen has a search field already.' })
    expect(paletteEdit(entry('search-field'), undefined, screenOf('TabView { Text("Inbox") }'))).toEqual({ operation, problem: 'This screen holds the app’s tabs. Add this to a tab’s screen.' })
    expect(paletteGate(entry('search-field'), '14.0')).toMatch(/\biOS 15\b/)
    expect(searchCatalog('search')[0]?.id).toBe('search-field')
  })

  it('puts a toolbar button into the Toolbar selected, and otherwise at the trailing end of the screen’s navigation bar', () => {
    const button = 'Button("Add", systemImage: "plus") { }'
    const snapshot = model('NavigationStack { Text("Inbox").toolbar { Button("Save") { } } }')
    const toolbar = snapshot.nodes.find(node => node.name === 'Toolbar')!, text = snapshot.nodes.find(node => node.name === 'Text')!
    const screen = snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'ContentView')!
    expect(paletteEdit(entry('toolbar-button'), toolbar, screen)).toEqual({ operation: { kind: 'insert', snippet: button }, on: toolbar })
    expect(paletteEdit(entry('toolbar-button'), text, screen)).toEqual({ operation: { kind: 'toolbar-item-add', placement: 'trailing', snippet: button }, on: screen })
    expect(paletteEdit(entry('toolbar-button'), text, undefined)).toEqual({ operation: { kind: 'toolbar-item-add', placement: 'trailing', snippet: button }, problem: 'Select a screen to add a toolbar button to.' })
    const tabs = model('TabView { Text("Inbox") }').nodes.find(node => node.kind === 'definition' && node.name === 'ContentView')!
    expect(paletteEdit(entry('toolbar-button'), undefined, tabs)).toMatchObject({ problem: 'This screen holds the app’s tabs. Add this to a tab’s screen.' })
    expect(paletteGate(entry('toolbar-button'), '13.0')).toMatch(/\biOS 14\b/)
    expect(searchCatalog('toolbar')[0]?.id).toBe('toolbar-button')
  })
})

describe.skipIf(!XCODE)('every view the Add palette offers, in Xcode 27', () => {
  /** A one-screen app whose body is `snippet`, type-checked as an app running on iOS `target`. */
  const app = (snippet: string, target: number) => `// target: iOS ${target}\n${screen(snippet.split('\n').map(line => `        ${line}`).join('\n'))}`
  const offered = VIEW_CATALOG.filter(item => item.snippet)

  it.each(offered.map(item => [item.name, item] as const))('%s builds from the iOS it is offered at, and not below it', (_, item) => {
    const minimum = item.minimumIOS ?? 13, older = item.older
    typecheckInXcode([app(item.snippet, older?.before ?? minimum)])
    // The older spelling builds where it is written, and the newer one wouldn't have.
    if (older) {
      typecheckInXcode([app(older.snippet, minimum)])
      expect(() => typecheckInXcode([app(item.snippet, older.before - 1)])).toThrow(/is only available in iOS/)
    }
    if (minimum > 13) expect(() => typecheckInXcode([app(older?.snippet ?? item.snippet, minimum - 1)])).toThrow(/is only available in iOS/)
  }, 120_000)
})
