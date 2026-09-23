import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import type { CompileRequest, CompileResult, RenderNode, ViewLayer } from '@studio/shared'
import { applyEvent, colorForName, compile, fontForToken, rerender, resetPipelineState, setFontMetrics } from '@studio/swiftui-runtime'
import { KNOWN_COLOR_NAMES } from '@studio/swift-sema'
import { IOS_27 } from '../packages/swiftui-runtime/src/appearance/ios27'
import { AUTHORING_COLOR_HEX } from '../packages/swift-sema/src/authoring-resources'
import { DEVICES } from '@studio/sim-shell'
import { normalizeProject, projectFromFiles } from '@studio/project-model'
import { TEMPLATES, createProjectFromTemplate } from '@studio/project-model/templates'
import { VIEW_CATALOG } from '../apps/web/lib/viewCatalog'
import { ancestors, worldFrame } from './render-geometry'

/**
 * Regressions named after the study-build plan's items (feasibility-revised.md), so
 * each fix can be traced back to the defect it closes.
 */

beforeEach(() => { resetPipelineState(); setFontMetrics([]) })

function run(body: string, options: Partial<CompileRequest> = {}): CompileResult {
  const source = `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
 var body: some View { ${body} }
}`
  const result = compile({ files: [{ id: 'App.swift', text: source }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, ...options })
  expect(result.diagnostics).toEqual([])
  expect(result.renderTree).not.toBeNull()
  return result
}

let revision = 1

/** An app whose `ContentView` has these members - state and helpers as well as `body` - and these declarations. */
const viewSource = (members: string, declarations = '') => `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }
${declarations}
struct ContentView: View {
${members}
}`

const compileView = (source: string, options: Partial<CompileRequest> = {}) =>
  compile({ files: [{ id: 'App.swift', text: source }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: revision++, ...options })

/** A whole `ContentView`, which must draw with nothing to report. */
function runView(members: string, declarations = '', options: Partial<CompileRequest> = {}): CompileResult {
  const result = compileView(viewSource(members, declarations), options)
  expect(result.diagnostics).toEqual([])
  expect(result.renderTree).not.toBeNull()
  return result
}

/** What a view reports: each diagnostic, with the source it points at and the replacement it offers. */
function reported(members: string, declarations = '') {
  const source = viewSource(members, declarations)
  return compileView(source).diagnostics.map(d => ({ severity: d.severity, message: d.message, at: source.slice(d.span.start, d.span.end), fix: d.fixIts?.[0]?.edits[0]?.newText }))
}

/** What the iOS 27 simulator drew on iPhone 18 Pro, light (docs/parity/native/iphone18pro-misrenders). */
const native = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-misrenders/measurements.json', import.meta.url), 'utf8')).measured
/** What the same simulator drew for the second set of fixes (docs/parity/native/iphone18pro-misrenders-ii). */
const nativeII = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-misrenders-ii/measurements.json', import.meta.url), 'utf8')).measured

/** A `runView` on the iPhone 18 Pro the native values were measured on, with its safe area. */
const screen = (members: string, declarations = '') => runView(members, declarations, { safeArea: DEVICES['iphone-18-pro'].safeArea })

const nodes = (r: CompileResult): readonly RenderNode[] => r.renderTree?.nodes ?? []
const texts = (r: CompileResult): string[] => nodes(r).flatMap(n => n.text?.runs.map(run => run.text) ?? [])
const controls = (r: CompileResult) => nodes(r).filter(n => n.hitTarget).map(n => n.a11y?.label)
const symbols = (r: CompileResult): string[] => nodes(r).flatMap(n => (n.image?.symbol ? [n.image.symbol] : []))
/** Where the text is drawn on the screen, following any containers it is placed inside. */
const placed = (r: CompileResult, value: string) =>
  worldFrame(nodes(r), nodes(r).find(n => n.text?.runs.some(run => run.text === value))!)

/** Presses the control with this accessible name, as a person finds it, and draws the result. */
function tap(r: CompileResult, label: string): CompileResult {
  const target = nodes(r).find(n => n.hitTarget && n.a11y?.label === label)
  expect(target, `no control named "${label}"; the screen has ${JSON.stringify(controls(r))}`).toBeDefined()
  applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(revision++)
}

const fontOf = (r: CompileResult, value: string) =>
  r.renderTree!.nodes.find(n => n.text?.runs.some(run => run.text === value))!.text!.runs[0]!.font

describe('E1: styling modifiers do not replace inherited fonts', () => {
  const caption = fontForToken('caption', 'large')!.size
  const footnote = fontForToken('footnote', 'large')!.size

  it('keeps a container font under .buttonStyle', () => {
    const r = run('VStack { Text("Caption text"); Button("Tap") {} }.font(.caption).buttonStyle(.plain)')
    expect(fontOf(r, 'Caption text').size).toBe(caption)
    expect(fontOf(r, 'Tap').size).toBe(caption)
  })

  it('keeps a container font under .listStyle', () => {
    const r = run('List { Text("Row text") }.font(.caption).listStyle(.plain)')
    expect(fontOf(r, 'Row text').size).toBe(caption)
  })

  it('draws a custom Section footer in the footnote style under .listStyle', () => {
    const r = run('List { Section { Text("Row") } footer: { Text("Footer note") } }.listStyle(.insetGrouped)')
    expect(fontOf(r, 'Footer note').size).toBe(footnote)
  })

  it('keeps the control-size font of a styled button', () => {
    const r = run('Button("Small") {}.buttonStyle(.bordered).controlSize(.small)')
    expect(fontOf(r, 'Small').size).toBe(15)
  })

  it('still rescales default text under .dynamicTypeSize', () => {
    const r = run('VStack { Text("Scaled").dynamicTypeSize(.accessibility3); Text("Default") }')
    expect(fontOf(r, 'Scaled').size).toBe(fontForToken('body', 'accessibility3')!.size)
    expect(fontOf(r, 'Default').size).toBe(fontForToken('body', 'large')!.size)
  })
})

describe('A6: a long print run keeps its start and end', () => {
  const messages = (r: CompileResult) => r.logs.map(log => log.message)

  it('keeps the first and last thousand lines of a print loop, and says how many it left out', () => {
    const r = run('Text("x").onAppear { for i in 0..<5000 { print(i) } }')
    const lines = messages(r)
    expect(lines).toHaveLength(2001)
    expect(lines.slice(0, 3)).toEqual(['0', '1', '2'])
    expect(lines[999]).toBe('999')
    expect(lines[1000]).toBe('3,000 lines not shown')
    expect(lines[1001]).toBe('4000')
    expect(lines[2000]).toBe('4999')
    expect(r.logs[1000]!.level).toBe('log')
  })

  it('keeps an error from the middle of the run, where it happened', () => {
    const r = run(`VStack {
      Text("a").onAppear { for i in 0..<1500 { print("a\\(i)") }; let empty: [Int] = []; print(empty[1]) }
      Text("b").onAppear { for i in 0..<1500 { print("b\\(i)") } }
    }`)
    const lines = messages(r)
    expect(lines.slice(998, 1004)).toEqual(['a998', 'a999', '500 lines not shown', lines[1001], '500 lines not shown', 'b500'])
    expect(r.logs[1001]!.level).toBe('error')
    expect(lines[1001]).toContain('Index out of range')
    expect(lines.at(-1)).toBe('b1499')
    expect(lines).toHaveLength(2003)
  })

  it('keeps only the first hundred errors from the middle, so repeated failures cannot undo the cap', () => {
    const r = run(`ForEach(0..<60, id: \\.self) { row in
      ForEach(0..<50, id: \\.self) { column in
        Text("x").onAppear { let empty: [Int] = []; print(empty[row * 50 + column]) }
      }
    }`)
    const lines = messages(r)
    expect(r.logs.filter(log => log.level === 'error')).toHaveLength(2100)
    expect(lines).toHaveLength(2101)
    expect(lines[1100]).toBe('900 lines not shown')
  })

  it('shortens one enormous line, and says by how much', () => {
    const r = run('Text("x").onAppear { print(String(repeating: "x", count: 100_000)) }')
    expect(messages(r)).toEqual([`${'x'.repeat(2000)} … 98,000 more characters`])
  })
})

describe('optional chaining in the preview', () => {
  it('draws an empty state written with ?. instead of stopping', () => {
    const r = runView(`let items: [Item] = []
      var body: some View { Text(items.first?.name ?? "No items yet") }`, 'struct Item { var name: String }')
    expect(texts(r)).toEqual(['No items yet'])
  })

  it('writes through ?. into state when there is a value, and does nothing when there is none', () => {
    const r = runView(`@State private var selected: Task? = nil
      var body: some View {
        VStack {
          Text(selected?.done == true ? "Done" : "Open")
          Button("Finish") { selected?.done = true }
          Button("New") { selected = Task() }
        }
      }`, 'struct Task { var done = false }')
    const untouched = tap(r, 'Finish')
    expect(untouched.diagnostics).toEqual([])
    expect(texts(untouched)).toContain('Open')
    expect(texts(tap(tap(untouched, 'New'), 'Finish'))).toContain('Done')
  })
})

describe('E2: every way of writing a Button action fires', () => {
  const forms: Record<string, string> = {
    'a trailing closure': 'Button("Go") { n += 1 }',
    'an action closure': 'Button("Go", action: { n += 1 })',
    'a method as the action': 'Button("Go", action: bump)',
    "Xcode's template form": 'Button(action: { n += 1 }) { Text("Go") }',
    'action and label': 'Button(action: bump, label: { Text("Go") })',
    'a role and an action': 'Button("Go", role: .destructive, action: bump)',
    'a symbol and an action': 'Button("Go", systemImage: "plus", action: bump)',
  }

  it.each(Object.entries(forms))('with %s', (_, button) => {
    const r = runView(`@State private var n = 0
      func bump() { n += 1 }
      var body: some View { VStack { Text("n=\\(n)"); ${button} } }`)
    expect(texts(tap(r, 'Go'))).toContain('n=1')
  })

  it('closes an alert whose only button is written with action:', () => {
    // An alert can't be dismissed any other way, so a button that doesn't fire traps
    // the participant under it.
    const r = runView(`@State private var showing = true
      var body: some View {
        Text("Home").alert("Saved", isPresented: $showing) {
          Button("OK", role: .cancel, action: {})
        }
      }`)
    expect(texts(r)).toContain('Saved')
    expect(texts(tap(r, 'OK'))).not.toContain('Saved')
  })
})

describe('E2: modifiers given a function or a closure argument to run', () => {
  it('runs .onAppear(perform:), .task(_:) and .onTapGesture(perform:)', () => {
    const r = runView(`@State private var log: [String] = []
      func appeared() { log.append("appear") }
      func load() { log.append("task") }
      func tapped() { log.append("tap") }
      var body: some View {
        VStack {
          Text(log.joined(separator: ","))
          Text("A").onAppear(perform: appeared)
          Text("B").onAppear(perform: { log.append("closure") })
          Text("C").task(load)
          Text("Tap me").onTapGesture(perform: tapped)
        }
      }`)
    expect(texts(r)).toContain('appear,closure,task')
    expect(texts(tap(r, 'Tap me'))).toContain('appear,closure,task,tap')
  })

  it('runs a gesture handler given as a named function', () => {
    const r = runView(`@State private var log: [String] = []
      func tapped() { log.append("tap") }
      func dropped(_ value: DragGesture.Value) { log.append("drop") }
      var body: some View {
        VStack {
          Text(log.joined(separator: ","))
          Text("Tap").gesture(TapGesture().onEnded(tapped))
          Text("Drag").gesture(DragGesture().onEnded(dropped))
        }
      }`)
    const tapped = tap(r, 'Tap')
    expect(texts(tapped)).toContain('tap')
    const handle = nodes(tapped).find(n => n.hitTarget && n.a11y?.label === 'Drag')!
    applyEvent({ kind: 'drag', handlerId: handle.hitTarget!.handlerId, phase: 'ended', location: { x: 40, y: 0 }, startLocation: { x: 0, y: 0 }, translation: { x: 40, y: 0 } })
    expect(texts(rerender(revision++))).toContain('tap,drop')
  })

  it('deletes the swiped row with .onDelete(perform:), as Xcode writes it', () => {
    const r = runView(`@State private var items = ["One", "Two", "Three"]
      func deleteItems(at offsets: IndexSet) { items.remove(atOffsets: offsets) }
      var body: some View {
        List {
          ForEach(items, id: \\.self) { item in Text(item) }
            .onDelete(perform: deleteItems)
        }
      }`)
    const row = nodes(r).filter(n => n.hitTarget?.role === 'drag')[1]!
    applyEvent({ kind: 'drag', handlerId: row.hitTarget!.handlerId, phase: 'ended', location: { x: -90, y: 0 }, startLocation: { x: 0, y: 0 }, translation: { x: -90, y: 0 } })
    const after = tap(rerender(revision++), 'Delete')
    expect(texts(after)).toEqual(expect.arrayContaining(['One', 'Three']))
    expect(texts(after)).not.toContain('Two')
  })
})

describe('E8: offset and position take a size or a point', () => {
  it('moves a view by a CGSize offset, as a drag writes it', () => {
    const still = placed(runView('var body: some View { Text("Moved") }'), 'Moved')
    const moved = placed(runView(`@State private var dragOffset = CGSize(width: 10, height: 20)
      var body: some View { Text("Moved").offset(dragOffset) }`), 'Moved')
    expect({ x: moved.x - still.x, y: moved.y - still.y }).toEqual({ x: 10, y: 20 })
  })

  it('places a view at a CGPoint where the x: y: form places it', () => {
    const byNumbers = placed(runView('var body: some View { Text("Here").position(x: 100, y: 120) }'), 'Here')
    const byPoint = placed(runView('var body: some View { Text("Here").position(CGPoint(x: 100, y: 120)) }'), 'Here')
    expect(byPoint).toEqual(byNumbers)
    expect(byPoint.x + byPoint.width / 2).toBeCloseTo(100, 0)
  })
})

describe('backgrounds and overlays given as a closure or a custom view', () => {
  /** Every painted layer or shape, by size and paint, which is what a designer sees of a background. */
  const paint = (r: CompileResult) =>
    nodes(r).filter(n => n.background ?? n.shape?.fill).map(n => ({ width: n.frame.width, height: n.frame.height, paint: n.background ?? n.shape?.fill }))

  it('draws a colour or a gradient in a background closure as the argument form does', () => {
    const gradient = 'LinearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom)'
    for (const style of ['Color.red', gradient]) {
      const argument = runView(`var body: some View { Text("Card").padding().background(${style}) }`)
      const closure = runView(`var body: some View { Text("Card").padding().background { ${style} } }`)
      expect(paint(closure)).toEqual(paint(argument))
      expect(paint(closure).length).toBeGreaterThan(1)
    }
  })

  it('draws a custom view given to an overlay, as an argument or in a closure', () => {
    const badge = 'struct Badge: View { var body: some View { Text("New") } }'
    for (const overlay of ['.overlay(Badge())', '.overlay { Badge() }', '.overlay(Badge(), alignment: .topTrailing)']) {
      const r = runView(`var body: some View { Color.blue.frame(width: 100, height: 100)${overlay} }`, badge)
      expect(texts(r), overlay).toContain('New')
    }
  })
})

describe('controls written with a title and systemImage:', () => {
  it('draw the icon beside the title, as a Label does', () => {
    const controls = [
      'Button("Add", systemImage: "plus") { }',
      'Menu("Add", systemImage: "plus") { Button("One") { } }',
      'Toggle("Add", systemImage: "plus", isOn: .constant(true))',
    ]
    for (const control of controls) {
      const r = runView(`var body: some View { ${control} }`)
      expect(symbols(r), control).toEqual(['plus'])
      expect(texts(r), control).toContain('Add')
    }
  })
})

describe('E3: presentations and search written on a NavigationStack or a TabView', () => {
  it('opens a sheet on the stack from a toolbar button, the everyday flow', () => {
    const r = runView(`@State private var adding = false
      var body: some View {
        NavigationStack {
          Text("Home")
            .navigationTitle("Home")
            .toolbar { Button("Add") { adding = true } }
        }
        .sheet(isPresented: $adding) { Text("New item") }
      }`)
    expect(texts(r)).not.toContain('New item')
    expect(texts(tap(r, 'Add'))).toContain('New item')
  })

  const presentations: Record<string, string> = {
    'a sheet': '.sheet(isPresented: .constant(true)) { Text("Presented") }',
    'a full-screen cover': '.fullScreenCover(isPresented: .constant(true)) { Text("Presented") }',
    'an alert': '.alert("Presented", isPresented: .constant(true)) { Button("OK") { } }',
    'a confirmation dialog': '.confirmationDialog("Presented", isPresented: .constant(true), titleVisibility: .visible) { Button("One") { } }',
  }
  const tab = '.tabItem { Label("Home", systemImage: "house") }'
  const placements: Record<string, (modifier: string) => string> = {
    'the NavigationStack': (m) => `NavigationStack { Text("Home") }${m}`,
    'the TabView': (m) => `TabView { Text("Home")${tab} }${m}`,
    "a tab page's own NavigationStack": (m) => `TabView { NavigationStack { Text("Home") }${m}${tab} }`,
    "a sheet's own NavigationStack": (m) => `Text("Home").sheet(isPresented: .constant(true)) { NavigationStack { Text("Sheet") }${m} }`,
  }
  const cases = Object.entries(presentations).flatMap(([kind, modifier]) =>
    Object.entries(placements).map(([where, build]) => [kind, where, build(modifier)] as const))

  it.each(cases)('shows %s written on %s', (_, __, body) => {
    expect(texts(runView(`var body: some View { ${body} }`))).toContain('Presented')
  })

  it('lists a sheet written on the TabView as a page of the Design gallery', () => {
    const r = runView(`@State private var adding = false
      var body: some View {
        TabView {
          NavigationStack { Text("Home").toolbar { Button("Add") { adding = true } } }
            .tabItem { Label("Home", systemImage: "house") }
        }
        .sheet(isPresented: $adding) { Text("New item") }
      }`, '', { allPages: true })
    const sheets = (r.pages ?? []).filter(page => page.kind === 'sheet')
    expect(sheets.flatMap(page => page.tree.nodes.flatMap(n => n.text?.runs.map(run => run.text) ?? []))).toContain('New item')
  })

  /** The warnings, each with the source it points at. */
  function warned(members: string) {
    const source = viewSource(members)
    return compileView(source).diagnostics.map(d => ({ severity: d.severity, message: d.message, at: source.slice(d.span.start, d.span.end) }))
  }

  it('warns, at the view, that a view beside a NavigationStack or a TabView is not drawn', () => {
    expect(warned(`var body: some View {
        ZStack(alignment: .bottomTrailing) {
          NavigationStack { Text("Home") }
          Button("New") { }
        }
      }`)).toEqual([{ severity: 'warning', at: 'Button("New") { }', message: expect.stringContaining('beside the NavigationStack') }])
    expect(warned(`var body: some View {
        VStack {
          Text("Offline banner")
          TabView { Text("Home").tabItem { Label("Home", systemImage: "house") } }
        }
      }`)).toEqual([{ severity: 'warning', at: 'Text("Offline banner")', message: expect.stringContaining('beside the TabView') }])
  })

  it('warns about a view beside a NavigationStack inside a sheet too', () => {
    expect(warned(`var body: some View {
        Text("Home").sheet(isPresented: .constant(true)) {
          ZStack { NavigationStack { Text("Sheet") }; Button("New") { } }
        }
      }`)).toEqual([{ severity: 'warning', at: 'Button("New") { }', message: expect.stringContaining('beside the NavigationStack') }])
  })

  it('warns that an overlay written on a NavigationStack is not drawn', () => {
    expect(warned('var body: some View { NavigationStack { Text("Home") }.overlay(Text("Badge")) }'))
      .toEqual([{ severity: 'warning', at: '.overlay(Text("Badge"))', message: expect.stringContaining('.overlay') }])
  })

  const stacks = Object.entries(placements).filter(([where]) => where !== 'the TabView')
  it.each(stacks)('shows a search field written on %s', (_, build) => {
    const r = runView(`var body: some View { ${build('.searchable(text: .constant(""), prompt: "Find things")')} }`)
    expect(controls(r)).toContain('Find things')
  })

  // Both checked in the iOS 27 simulator on iPhone 18 Pro (docs/parity/native).
  it('searches only the root screen of the stack it is written on, not a pushed one', () => {
    const r = runView(`var body: some View {
        NavigationStack { NavigationLink("Open") { Text("Detail") } }
          .searchable(text: .constant(""), prompt: "Find things")
      }`)
    expect(controls(r)).toContain('Find things')
    expect(controls(tap(r, 'Open'))).not.toContain('Find things')
  })

  it('draws no search field for a TabView without a search tab', () => {
    const r = runView(`var body: some View {
        TabView { Text("Home").tabItem { Label("Home", systemImage: "house") } }
          .searchable(text: .constant(""), prompt: "Find things")
      }`)
    expect(controls(r)).not.toContain('Find things')
  })

  /** Where a person types into the search field. */
  const searchBox = (r: CompileResult) => worldFrame(nodes(r), nodes(r).find(n => n.hitTarget?.role === 'textField')!)
  /** The rounded surface the search field is drawn on. */
  function searchCapsule(r: CompileResult) {
    const field = nodes(r).find(n => n.hitTarget?.role === 'textField')!
    return worldFrame(nodes(r), ancestors(nodes(r), field).find(n => n.clip && n.cornerRadius)!)
  }
  /** Each edge within a point of the measured [left, top, right, bottom], which take in the antialiased rim. */
  function expectEdges(frame: { x: number; y: number; width: number; height: number }, measured: readonly number[]) {
    const edges = [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height]
    expect(Math.max(...edges.map((edge, i) => Math.abs(edge - measured[i]!))), `drawn at ${edges.join(', ')}`).toBeLessThanOrEqual(1)
  }

  // Measured in the iOS 27 simulator on iPhone 18 Pro.
  it.each([
    ['the NavigationStack', 'search-root', 'NavigationStack { List { Text("Row") }.navigationTitle("Home") }.searchable(text: .constant(""))'],
    ['the List inside it', 'search-content', 'NavigationStack { List { Text("Row") }.navigationTitle("Home").searchable(text: .constant("")) }'],
  ])('puts a search field written on %s at the bottom of the screen when there is no tab bar', (_, capture, body) => {
    const measured = native.presentations[capture].searchField
    const r = screen(`var body: some View { ${body} }`)
    expectEdges(searchCapsule(r), [measured.leftXPt, measured.topYPt, measured.rightXPt, measured.bottomYPt])
    const box = searchBox(r), [, placeholderTop, , placeholderBottom] = measured.placeholderGlyphs
    expect(box.y + box.height / 2).toBeCloseTo((placeholderTop + placeholderBottom) / 2, 0)
    const magnifier = nodes(r).find(n => n.image?.symbol === 'magnifyingglass')!
    expect(Math.abs(worldFrame(nodes(r), magnifier).x - measured.magnifierGlyph[0])).toBeLessThanOrEqual(1)
  })

  // iOS 27 folds it away at launch until the list is pulled down (search-tab-content), and
  // the preview draws it shown, as it was measured in a tab app on 2026-09-16.
  it("keeps a tab page's search field under its title, where iOS 27 shows it once pulled down", () => {
    const r = screen(`var body: some View {
        TabView {
          NavigationStack { List { Text("Row") }.navigationTitle("Library").searchable(text: .constant("")) }
            .tabItem { Label("Home", systemImage: "house") }
        }
      }`)
    expectEdges(searchCapsule(r), native.presentations['search-tab-content'].afterPullingDown.searchFieldBoundsPt)
  })

  it("keeps a tab page's search field above its list when the stack has no title", () => {
    const r = screen(`var body: some View {
        TabView {
          NavigationStack { List { Text("Row") } }.searchable(text: .constant(""))
            .tabItem { Label("Home", systemImage: "house") }
        }
      }`)
    expect(searchBox(r).y).toBeLessThan(placed(r, 'Row').y)
  })
})

describe('E5: colours match the iOS 27 simulator', () => {
  /** The swatch's colour as it shows on the white page, as the simulator was measured. */
  function onWhite(style: string): number[] {
    const r = runView(`var body: some View { Rectangle().fill(${style}).frame(width: 50, height: 50) }`)
    const swatch = nodes(r).find(n => n.frame.width === 50 && n.frame.height === 50)!
    const paint = swatch.shape?.fill ?? swatch.background
    expect(paint?.kind, style).toBe('solid')
    const { r: red, g, b, a } = (paint as { color: { r: number; g: number; b: number; a: number } }).color
    return [red, g, b].map(channel => Math.round(channel * a + 255 * (1 - a)))
  }

  it.each(Object.entries(native.colors.onWhite as Record<string, number[]>))('draws %s as the simulator does', (style, measured) => {
    const drawn = onWhite(style)
    drawn.forEach((channel, i) => expect(Math.abs(channel - measured[i]!), `${style}: drew ${drawn}, measured ${measured}`).toBeLessThanOrEqual(1))
  })

  it('warns where a colour name is one the preview does not know, and nowhere else', () => {
    const warnings = (body: string, declarations = '') =>
      compileView(viewSource(`var body: some View { ${body} }`, declarations)).diagnostics.map(d => `${d.severity}: ${d.message}`)
    for (const typo of ['Color(.systemGrey6)', 'Color.systemGrey6', 'Color(UIColor.systemGrey6)', 'Color(uiColor: .systemGrey6)']) {
      expect(warnings(`Rectangle().fill(${typo})`), typo).toEqual([expect.stringMatching(/^warning: .*'systemGrey6'/)])
    }
    expect(warnings('Rectangle().fill(Color(.systemGray6))')).toEqual([])
    expect(warnings('Rectangle().fill(Color.brand)', 'extension Color { static let brand = Color.blue }')).toEqual([])
    expect(warnings('Rectangle().fill(Color.hex("#FF0000"))', 'extension Color { static func hex(_ value: String) -> Color { Color.red } }')).toEqual([])
    expect(warnings('Rectangle().fill(Color(.sRGB, red: 1, green: 0, blue: 0))')).toEqual([])
  })

  it('knows exactly the colour names the palette draws', () => {
    for (const name of KNOWN_COLOR_NAMES) {
      expect(colorForName(name, 'light'), name).not.toBeNull()
      expect(colorForName(name, 'dark'), name).not.toBeNull()
    }
    expect([...Object.keys(IOS_27.colors.light)].filter(name => !KNOWN_COLOR_NAMES.has(name))).toEqual([])
  })

  it('moves a system colour into the asset catalog as the colour it draws', () => {
    for (const [name, hex] of Object.entries(AUTHORING_COLOR_HEX)) {
      const { r, g, b } = colorForName(name)!
      expect(hex, name).toBe('#' + [r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase())
    }
  })

  it('reads a level written on a leading-dot colour, `.blue.secondary`, as on Color.blue', () => {
    expect(onWhite('.blue.secondary')).toEqual(onWhite('Color.blue.secondary'))
    expect(onWhite('.blue.tertiary')).toEqual(onWhite('Color.blue.tertiary'))
  })

  const warningsFor = (body: string) =>
    compileView(viewSource(`var body: some View { ${body} }`)).diagnostics.map(d => `${d.severity}: ${d.message}`)

  it("draws UIKit's own colours through the bridge, as UIKit defines them", () => {
    expect(onWhite('Color(.red)')).toEqual([255, 0, 0])
    expect(onWhite('Color(.magenta)')).toEqual([255, 0, 255])
    expect(onWhite('Color(uiColor: .darkGray)')).toEqual([85, 85, 85])
    expect(onWhite('Color(UIColor.lightGray)')).toEqual([170, 170, 170])
    expect(onWhite('Color(uiColor: UIColor(red: 0.2, green: 0.4, blue: 0.6, alpha: 1))')).toEqual([51, 102, 153])
    expect(onWhite('Color(uiColor: .tintColor)')).toEqual(onWhite('Color.accentColor'))
  })

  it('warns that Xcode has no Color.systemGray6 or Color.label, which the preview still draws', () => {
    expect(warningsFor('Rectangle().fill(Color.systemGray6)')).toEqual([expect.stringMatching(/^warning: .*Color\(\.systemGray6\)/)])
    expect(warningsFor('Text("x").foregroundStyle(Color.label)')).toEqual([expect.stringMatching(/^warning: .*Color\(\.label\)/)])
  })

  it('warns on a leading-dot colour spelt wrong, and not on the styles it could be mistaken for', () => {
    expect(warningsFor('Text("x").foregroundStyle(.grey)')).toEqual([expect.stringMatching(/^warning: .*'grey'.*'gray'/)])
    expect(warningsFor('Rectangle().fill(.gren)')).toEqual([expect.stringMatching(/^warning: .*'gren'.*'green'/)])
    for (const style of ['.tint', '.ultraThinMaterial', '.bar', '.link', '.primary']) {
      expect(warningsFor(`Text("x").foregroundStyle(${style})`), style).toEqual([])
    }
  })

  it('draws a UIKit colour written with UIColor as the Color it names', () => {
    const expected = onWhite('Color(.systemGray6)')
    expect(onWhite('Color(UIColor.systemGray6)')).toEqual(expected)
    expect(onWhite('Color(uiColor: .systemGray6)')).toEqual(expected)
    expect(onWhite('Color(uiColor: UIColor.systemGray6)')).toEqual(expected)
  })
})

// Where each shape's path starts and which way it runs, and what a trimmed fill draws,
// are measured in the iOS 27 simulator (docs/parity/native/iphone18pro-misrenders).
describe('E6: trim draws the part of the path iOS 27 draws', () => {
  /** The first SVG path drawn, with the attributes that decide which part of it shows. */
  function drawn(body: string) {
    const html = renderToStaticMarkup(createElement(RenderTreeView, { tree: runView(`var body: some View { ${body} }`).renderTree!, onEvent: () => {} }))
    const path = /<path [^>]*>/.exec(html)?.[0]
    const attribute = (name: string) => path && new RegExp(`${name}="([^"]*)"`).exec(path)?.[1]
    return { path, start: attribute('d')?.match(/^M ([-\d.]+) ([-\d.]+)/)?.slice(1).map(Number), pathLength: attribute('pathLength'), dash: attribute('stroke-dasharray'), offset: attribute('stroke-dashoffset') }
  }

  it.each([
    ['a circle, at 3 o\'clock', 'Circle()', 110, 110, [110, 55]],
    ['an ellipse, at 3 o\'clock', 'Ellipse()', 110, 60, [110, 30]],
    ['a rounded rectangle, halfway down its right side', 'RoundedRectangle(cornerRadius: 24)', 110, 110, [110, 55]],
    ['a capsule, halfway down its right side', 'Capsule()', 110, 60, [110, 30]],
    ['a rectangle, at its top-left corner', 'Rectangle()', 110, 60, [0, 0]],
  ])('starts %s, and strokes only the trimmed part', (_, shape, width, height, start) => {
    const trimmed = drawn(`${shape}.trim(from: 0.25, to: 0.5).stroke(Color.red, lineWidth: 8).frame(width: ${width}, height: ${height})`)
    expect(trimmed.start).toEqual(start)
    // What SVG draws: one dash, starting at minus the offset along a path measured as 1,
    // with a gap too long for a second dash to start within it.
    const [dash, gap] = (trimmed.dash ?? '').split(' ').map(Number)
    const from = -Number(trimmed.offset)
    expect(Number(trimmed.pathLength)).toBe(1)
    expect([from, from + dash!]).toEqual([0.25, 0.5])
    expect(from + dash! + gap!).toBeGreaterThanOrEqual(1)
  })

  it('draws nothing for an empty trim', () => {
    expect(drawn('Circle().trim(from: 0, to: 0).stroke(Color.red, lineWidth: 8).frame(width: 110, height: 110)').path).toBeUndefined()
  })

  const arc = (clockwise: boolean) =>
    `Path { p in p.addArc(center: CGPoint(x: 55, y: 55), radius: 45, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: ${clockwise}) }.stroke(Color.red, lineWidth: 8)`
  const pathOf = (body: string) => nodes(runView(`var body: some View { ${body} }`)).find(n => n.path)!.path!.d

  it('draws addArc(clockwise: false) as the quarter from 12 to 3 o\'clock, clockwise on screen', () => {
    expect(pathOf(arc(false))).toBe('M 55 10 A 45 45 0 0 1 100 55')
  })

  it('draws addArc(clockwise: true) as the other three quarters, counterclockwise on screen', () => {
    expect(pathOf(arc(true))).toBe('M 55 10 A 45 45 0 1 0 100 55')
  })

  // 1 / 0 is infinite, and looped forever in the worker; 0 / 0 is not a number, and drew a stray arc.
  it.each(['1.0', '0.0'])('draws nothing, rather than hanging, for an arc whose angle divides %s by zero', (done) => {
    const r = runView(`@State private var done = ${done}
      let goal = 0.0
      var body: some View {
        Path { p in p.addArc(center: CGPoint(x: 55, y: 55), radius: 45, startAngle: .degrees(-90), endAngle: .degrees(-90 + 360 * done / goal), clockwise: true) }
          .stroke(Color.red, lineWidth: 8)
      }`)
    expect(nodes(r).find(n => n.path)?.path?.d ?? '').not.toContain('A')
  })

  it("draws the Drawing template's ring counterclockwise from 12 o'clock, ending at 36 degrees at 65%", () => {
    const ring = `Path { path in
        path.addArc(center: CGPoint(x: 70, y: 70), radius: 63, startAngle: .degrees(-90), endAngle: .degrees(270), clockwise: true)
      }
      .trim(from: 0, to: 0.65)
      .stroke(Color.accentColor, lineWidth: 14)`
    expect(pathOf(ring)).toBe('M 70 7 A 63 63 0 1 0 120.97 107.03')
  })

  it('warns where a trim is drawn whole, on a filled or dashed shape, and nowhere else', () => {
    const warnings = (body: string, declarations = '') =>
      compileView(viewSource(`var body: some View { ${body} }`, declarations)).diagnostics.map(d => `${d.severity}: ${d.message}`)
    expect(warnings('Circle().trim(from: 0, to: 0.5).fill(Color.red)')).toEqual([expect.stringMatching(/^warning: .*trim/)])
    expect(warnings('Circle().trim(from: 0, to: 0.5).stroke(Color.red, style: StrokeStyle(lineWidth: 4, dash: [4, 2]))'))
      .toEqual([expect.stringMatching(/^warning: .*dash/)])
    expect(warnings('Circle().trim(from: 0, to: 0.5).offset(x: 2, y: 0).stroke(Color.red)')).toEqual([])
    // A path is trimmed, filled or not, and a project's own `trim()` is its own.
    expect(warnings('Path { p in p.addArc(center: CGPoint(x: 50, y: 50), radius: 40, startAngle: .degrees(0), endAngle: .degrees(360), clockwise: false) }.trim(from: 0, to: 0.5).fill(Color.red)')).toEqual([])
    expect(warnings('Text("  name ".trim())', 'extension String { func trim() -> String { self } }')).toEqual([])
  })
})

// What reaches under the safe area, as the iOS 27 simulator draws it on iPhone 18 Pro
// (docs/parity/native/iphone18pro-misrenders): the safe area runs from 62 to 840.
describe('E4: what reaches under the safe area, and what stays inside it', () => {
  const full = (content: string) => `VStack { Text("Top"); Spacer(); Text("Bottom") }.frame(maxWidth: .infinity, maxHeight: .infinity)${content}`

  /** The colour a designer sees at a point: the topmost opaque paint there. */
  function colourAt(r: CompileResult, x: number, y: number) {
    const all = nodes(r)
    const seen = all
      .filter(n => { const f = worldFrame(all, n); return x >= f.x && x < f.x + f.width && y >= f.y && y < f.y + f.height })
      .filter(n => { const paint = n.background ?? n.shape?.fill; return paint?.kind === 'solid' && paint.color.a === 1 })
      .sort((a, b) => b.z - a.z)[0]
    const paint = seen?.background ?? seen?.shape?.fill
    return paint?.kind === 'solid' ? `${paint.color.r},${paint.color.g},${paint.color.b}` : 'nothing'
  }
  const measured = native.colors.onWhite as Record<string, number[]>
  const RED = measured['Color.red']!.join(',')
  const BLUE = measured['Color.blue']!.join(',')
  const WHITE = measured['Color(.systemBackground)']!.join(',')
  /** Where the colour reaches down the middle of the screen, top and bottom. */
  const reach = (r: CompileResult, colour: string) => ({ top: colourAt(r, 201, 5) === colour, bottom: colourAt(r, 201, 870) === colour })

  it.each(['.background(Color.red)', '.background(.red)', '.background(Color.red.ignoresSafeArea())'])(
    'paints %s on a full-screen view to both screen edges, and leaves its text inside', (background) => {
      const r = screen(`var body: some View { ${full(background)} }`)
      expect(reach(r, RED)).toEqual({ top: true, bottom: true })
      expect(placed(r, 'Top').y).toBeGreaterThanOrEqual(62)
      expect(placed(r, 'Bottom').y + placed(r, 'Bottom').height).toBeLessThanOrEqual(840)
    })

  it('blends a gradient that reaches the edges across its own view, as the simulator does', () => {
    const r = screen(`var body: some View { ${full('.background(LinearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom))')} }`)
    const layer = nodes(r).find(n => n.background?.kind === 'linearGradient')!
    const frame = worldFrame(nodes(r), layer)
    const gradient = layer.background as { start: { y: number }; end: { y: number } }
    // Measured: the colour changes only between 62 and 840, and holds its ends beyond.
    expect([frame.y, frame.y + frame.height]).toEqual([0, 874])
    expect(frame.y + gradient.start.y * frame.height).toBeCloseTo(62, 5)
    expect(frame.y + gradient.end.y * frame.height).toBeCloseTo(840, 5)
  })

  it('keeps a background written as a closure inside the safe area', () => {
    const r = screen(`var body: some View { ${full('.background { Color.red }')} }`)
    expect(reach(r, RED)).toEqual({ top: false, bottom: false })
    expect(colourAt(r, 201, 70)).toBe(RED)
  })

  it('leaves content where it is under .ignoresSafeArea(.keyboard)', () => {
    const r = screen(`var body: some View { ${full('.background { Color.red }.ignoresSafeArea(.keyboard)')} }`)
    expect(placed(r, 'Top').y).toBeGreaterThanOrEqual(62)
    expect(reach(r, RED)).toEqual({ top: false, bottom: false })
  })

  it.each(['.ignoresSafeArea()', '.edgesIgnoringSafeArea(.all)'])(
    'draws a colour with %s under the whole screen, and the stack beside it inside', (ignoring) => {
      const r = screen(`var body: some View { ZStack { Color.blue${ignoring}; VStack { Text("Title"); Spacer(); Text("Footer") } } }`)
      expect(reach(r, BLUE)).toEqual({ top: true, bottom: true })
      expect(placed(r, 'Title').y).toBeGreaterThanOrEqual(62)
      expect(placed(r, 'Footer').y + placed(r, 'Footer').height).toBeLessThanOrEqual(840)
    })

  it('moves a fixed-height view that ignores the top safe area up, without growing it', () => {
    const r = screen('var body: some View { VStack(spacing: 0) { Color.red.frame(height: 200).ignoresSafeArea(edges: .top); Spacer() } }')
    // Measured: red from 0 to 200, and the white page below.
    expect([colourAt(r, 201, 1), colourAt(r, 201, 199), colourAt(r, 201, 201)]).toEqual([RED, RED, WHITE])
  })

  it('shows a background that reaches under the navigation bar through it', () => {
    const r = screen(`var body: some View { NavigationStack { ${full('.background(Color.red)')}.navigationTitle("Title") } }`)
    expect([colourAt(r, 201, 30), colourAt(r, 201, 100), colourAt(r, 201, 870)]).toEqual([RED, RED, RED])
  })

  it('shows it behind a large title over a scroll view too, the way the AI writes a list screen', () => {
    const r = screen(`var body: some View {
        NavigationStack {
          ScrollView { VStack { ForEach(0..<30, id: \\.self) { Text("Row \\($0)") } } }
            .frame(maxWidth: .infinity)
            .background(Color.red)
            .navigationTitle("Title")
        }
      }`)
    expect([colourAt(r, 201, 30), colourAt(r, 201, 100)]).toEqual([RED, RED])
  })
})

describe('E9: padding on the edges it names', () => {
  /** The padding around a 100-point square, read off the background drawn around both. */
  function paddingOf(padding: string) {
    const r = runView(`var body: some View { Color.red.frame(width: 100, height: 100)${padding}.background(Color.blue) }`)
    const painted = nodes(r).filter(n => n.id !== 'screen' && n.background?.kind === 'solid').map(n => worldFrame(nodes(r), n))
    const square = painted.find(f => f.width === 100 && f.height === 100)!
    const around = painted.find(f => f !== square)!
    return { top: square.y - around.y, leading: square.x - around.x, bottom: around.y + around.height - square.y - square.height, trailing: around.x + around.width - square.x - square.width }
  }

  it.each([
    ['[.horizontal, .top], 20', { top: 20, leading: 20, bottom: 0, trailing: 20 }],
    ['[.leading, .trailing, .top, .bottom], 8', { top: 8, leading: 8, bottom: 8, trailing: 8 }],
    ['[.leading, .bottom]', { top: 0, leading: 16, bottom: 16, trailing: 0 }],
    ['[], 20', { top: 0, leading: 0, bottom: 0, trailing: 0 }],
    ['Edge.Set.top, 8', { top: 8, leading: 0, bottom: 0, trailing: 0 }],
    ['Edge.Set([.top, .leading]), 8', { top: 8, leading: 8, bottom: 0, trailing: 0 }],
    ['.init(top: 1, leading: 2, bottom: 3, trailing: 4)', { top: 1, leading: 2, bottom: 3, trailing: 4 }],
    ['.horizontal, 10', { top: 0, leading: 10, bottom: 0, trailing: 10 }],
  ])('pads .padding(%s) on the edges it names', (args, expected) => {
    expect(paddingOf(`.padding(${args})`)).toEqual(expected)
  })
})

describe('E10: every appear hook on a view runs, and .task(id:) runs again for a new id', () => {
  const printed: string[] = nativeII.hooks.printed
  /** What the simulator printed for one view of the fixture's hooks screen, in its order. */
  const ranOn = (view: string) => printed.filter(line => line.startsWith(`HOOK ${view} `)).map(line => line.slice(`HOOK ${view} `.length)).join(',')

  it.each([
    ['A', '.onAppear { log.append("appear") }.task { log.append("task") }'],
    ['B', '.task { log.append("task") }.onAppear { log.append("appear") }'],
    ['C', '.onAppear { log.append("appear 1") }.onAppear { log.append("appear 2") }'],
    ['D', '.task { log.append("task 1") }.task { log.append("task 2") }'],
  ])('runs every hook of view %s on the simulator\'s hooks screen, in the order it ran them', (view, hooks) => {
    const r = runView(`@State private var log: [String] = []
      var body: some View { VStack { Text(log.joined(separator: ",")); Text("${view}")${hooks} } }`)
    expect(texts(r)).toContain(ranOn(view))
  })

  it('runs .task(id:) again when its id changes, and not for another change', () => {
    const r = runView(`@State private var value = 0
      @State private var other = 0
      @State private var log: [String] = []
      var body: some View {
        VStack {
          Text(log.joined(separator: ","))
          Button("Next") { value += 1 }
          Button("Other") { other += 1 }
          Text("\\(other)").task(id: value) { log.append("task \\(value)") }
        }
      }`)
    expect(texts(r)).toContain('task 0')
    const next = tap(r, 'Next')
    expect(texts(next)).toContain('task 0,task 1')
    expect(texts(tap(next, 'Other'))).toContain('task 0,task 1')
  })

  it('runs both of two .onDisappear hooks when the view goes', () => {
    const r = runView(`@State private var shown = true
      @State private var log: [String] = []
      var body: some View {
        VStack {
          Text(log.joined(separator: ","))
          Button("Hide") { shown = false }
          if shown { Text("A").onDisappear { log.append("gone 1") }.onDisappear { log.append("gone 2") } }
        }
      }`)
    expect(texts(tap(r, 'Hide'))).toContain('gone 1,gone 2')
  })

  it('runs no hook again when an edit adds a modifier before them', () => {
    const source = (extra: string) => `@State private var log: [String] = []
      @State private var value = 0
      var body: some View {
        VStack {
          Text(log.joined(separator: ","))
          Text("A")${extra}.onChange(of: value, initial: true) { log.append("change") }.onAppear { log.append("appear") }
        }
      }`
    const before = texts(runView(source('')))[0]!
    expect(before.split(',').sort()).toEqual(['appear', 'change'])
    expect(texts(runView(source('.padding()')))[0]).toBe(before)
  })
})

describe('E15: new projects start on the iPhone 18 Pro, targeting iOS 27', () => {
  it('starts every template, and every set of files opened as a project, there', () => {
    const opened = projectFromFiles([{ name: 'App.swift', text: viewSource('var body: some View { Text("Hi") }') }])!
    for (const project of [...TEMPLATES.map(template => createProjectFromTemplate(template)), opened]) {
      expect([project.manifest.device, project.manifest.deploymentTarget], project.manifest.name).toEqual(['iphone-18-pro', '27.0'])
    }
  })

  it('leaves a saved project on the device and iOS version it has', () => {
    const saved = createProjectFromTemplate(TEMPLATES[0]!)
    const old = normalizeProject({ ...saved, manifest: { ...saved.manifest, device: 'iphone-15', deploymentTarget: '17.0' } })
    expect([old.manifest.device, old.manifest.deploymentTarget]).toEqual(['iphone-15', '17.0'])
  })
})

describe('E16a: an SF Symbol name the preview has no drawing for warns at the name', () => {
  it.each(['Image(systemName: "hose")', 'Label("Home", systemImage: "hose")', 'Button("Home", systemImage: "hose") { }'])(
    'warns at the name in %s, offering the nearest one it draws', (view) => {
      expect(reported(`var body: some View { ${view} }`)).toEqual([{ severity: 'warning', message: expect.stringContaining("If 'hose' is right, it still shows in the app."), at: '"hose"', fix: '"house"' }])
    })

  it('says a name nothing is near may still be a real symbol', () => {
    const [warning, ...rest] = reported('var body: some View { Image(systemName: "figure.climbing.rope") }')
    expect(rest).toEqual([])
    expect(warning).toMatchObject({ severity: 'warning', at: '"figure.climbing.rope"', fix: undefined })
    expect(warning!.message).toContain('the app')
  })

  it('does not warn for a name it draws, or one it can only know by running', () => {
    expect(reported('var body: some View { Image(systemName: "house") }')).toEqual([])
    expect(reported('let name = "nope"\n var body: some View { Image(systemName: name) }')).toEqual([])
    expect(reported('let n = 1\n var body: some View { Image(systemName: "\\(n).circle") }')).toEqual([])
    expect(reported('var body: some View { Icon(systemName: "nope") }', 'struct Icon: View { let systemName: String; var body: some View { Text(systemName) } }')).toEqual([])
  })

  it('draws both icons of the Library\'s Tabs snippet', () => {
    const snippet = VIEW_CATALOG.find(item => item.id === 'tabview')!.snippet
    expect(reported(`var body: some View { ${snippet} }`)).toEqual([])
    const markup = renderToStaticMarkup(createElement(RenderTreeView, { tree: runView(`var body: some View { ${snippet} }`).renderTree! }))
    expect(markup).not.toContain('unsupported symbol')
  })
})

describe('E14: an @Observable model shared through @Bindable and the environment', () => {
  const model = '@Observable final class Model { var name = ""; var count = 0 }'
  /** Types into the text field with this placeholder, as a person does, and draws the result. */
  function type(r: CompileResult, placeholder: string, value: string): CompileResult {
    const field = nodes(r).find(n => n.hitTarget?.role === 'textField' && n.a11y?.label === placeholder)!
    applyEvent({ kind: 'textChange', handlerId: field.hitTarget!.handlerId, value })
    return rerender(revision++)
  }

  it('writes through a child view\'s @Bindable model into the parent\'s', () => {
    const r = runView(`@State private var model = Model()
      var body: some View { VStack { Text("Hello \\(model.name)"); Editor(model: model) } }`, `${model}
      struct Editor: View {
        @Bindable var model: Model
        var body: some View { TextField("Name", text: $model.name) }
      }`)
    expect(texts(type(r, 'Name', 'Ada'))).toContain('Hello Ada')
  })

  it('hands a model given with .environment(model) to a pushed screen that asks for its type', () => {
    const r = runView(`@State private var model = Model()
      var body: some View {
        NavigationStack { NavigationLink("Open") { Detail() } }
          .environment(model)
      }`, `${model}
      struct Detail: View {
        @Environment(Model.self) private var model
        var body: some View { Button("Add \\(model.count)") { model.count += 1 } }
      }`)
    expect(texts(tap(tap(r, 'Open'), 'Add 0'))).toContain('Add 1')
  })

  it('binds to it with @Bindable var model = model inside body, as Apple writes it', () => {
    const r = runView(`@State private var model = Model()
      var body: some View { VStack { Text("Hello \\(model.name)"); Detail() }.environment(model) }`, `${model}
      struct Detail: View {
        @Environment(Model.self) private var model
        var body: some View {
          @Bindable var model = model
          TextField("Name", text: $model.name)
        }
      }`)
    expect(texts(type(r, 'Name', 'Ada'))).toContain('Hello Ada')
  })

  it('reads a model given to the whole app on its WindowGroup', () => {
    const source = `import SwiftUI
${model}
@main struct Demo: App {
  @State private var model = Model()
  var body: some Scene { WindowGroup { ContentView().environment(model) } }
}
struct ContentView: View {
  @Environment(Model.self) private var model
  var body: some View { Text("Count \\(model.count)") }
}`
    const r = compileView(source)
    expect(r.diagnostics).toEqual([])
    expect(texts(r)).toContain('Count 0')
  })

  it('draws a view no ancestor gave the model as stopped, saying why, and reads nil when it may be missing', () => {
    const missing = compileView(viewSource('@Environment(Model.self) private var model\n var body: some View { Text("Count \\(model.count)") }', model))
    expect(missing.diagnostics.map(d => d.message).join('\n')).toContain('No Observable object of type Model found')
    expect(nodes(missing).find(n => n.placeholder)?.placeholder).toMatchObject({ feature: 'ContentView stopped', reason: expect.stringContaining('No Observable object of type Model found') })
    const optional = runView('@Environment(Model.self) private var model: Model?\n var body: some View { Text(model == nil ? "No model" : "Model") }', model)
    expect(texts(optional)).toContain('No model')
  })

  it.each([
    ['a title', 'NavigationLink("Open") { Detail() }'],
    ['destination:', 'NavigationLink(destination: Detail()) { Text("Open") }'],
    ['a label: closure', 'NavigationLink { Detail() } label: { Text("Open") }'],
  ])('draws a link with %s to a screen missing its model, and says so only when it is pushed, as iOS runs it then', (_, link) => {
    const r = runView(`var body: some View { NavigationStack { ${link} } }`, `${model}
      struct Detail: View {
        @Environment(Model.self) private var model
        var body: some View { Text("Count \\(model.count)") }
      }`)
    expect(controls(r)).toContain('Open')
    const pushed = tap(r, 'Open')
    expect(pushed.diagnostics.map(d => d.message).join('\n')).toContain('No Observable object of type Model found')
    expect(nodes(pushed).find(n => n.placeholder)?.placeholder?.feature).toBe('Detail stopped')
  })
})

describe("E11a: a view the preview doesn't know draws a placeholder, not a blank screen", () => {
  it('warns at a view nothing declares, and draws the rest of the screen around a placeholder for it', () => {
    const members = 'var body: some View { VStack { Text("Title"); RatingView(rating: 3) } }'
    expect(reported(members)).toEqual([{ severity: 'warning', message: expect.stringContaining("Cannot find 'RatingView' in scope"), at: 'RatingView', fix: undefined }])
    const r = compileView(viewSource(members))
    expect(texts(r)).toContain('Title')
    expect(nodes(r).some(n => n.placeholder?.feature === 'RatingView')).toBe(true)
  })

  it('says it may still build, since it may be part of SwiftUI', () => {
    const [warning] = reported('var body: some View { GlassEffectContainer { Text("Inside") } }')
    expect(warning!.message).toContain("If it isn't part of SwiftUI")
  })

  it('draws what is around it, and never what it was given', () => {
    const r = compileView(viewSource('var body: some View { VStack { Text("Title"); Mystery { Text("Inside") } } }'))
    expect(texts(r)).toContain('Title')
    expect(texts(r)).not.toContain('Inside')
  })

  it('keeps a near-typo of a view an error, with its fix', () => {
    expect(reported('var body: some View { Buton("Save") { } }')).toEqual([{ severity: 'error', message: expect.stringContaining("Did you mean 'Button'?"), at: 'Buton', fix: 'Button' }])
  })

  it('offers a type, not a variable, for a misspelt type', () => {
    expect(reported('@State private var counter = 0\n var body: some View { Countr(value: counter) }', 'struct Counter: View { let value: Int; var body: some View { Text("\\(value)") } }'))
      .toEqual([{ severity: 'error', message: expect.stringContaining("Did you mean 'Counter'?"), at: 'Countr', fix: 'Counter' }])
  })

  it('keeps a capitalised call that is not written as a view an error, as it was', () => {
    expect(reported('@State private var store = PantryStore()\n var body: some View { Text("Pantry") }')).toEqual([{ severity: 'error', message: "Cannot find 'PantryStore' in scope.", at: 'PantryStore', fix: undefined }])
    expect(reported('var body: some View { Text(DateFormatter().string(from: Date())) }')).toMatchObject([{ severity: 'error', at: 'DateFormatter' }])
  })

  it.each([
    ['Button("Save") { }', '.buttonStyle(PlainButtonStyle())', '.buttonStyle(.plain)'],
    ['Button("Save") { }', '.buttonStyle(BorderedProminentButtonStyle())', '.buttonStyle(.borderedProminent)'],
    ['Picker("Size", selection: .constant(1)) { Text("S").tag(1); Text("M").tag(2) }', '.pickerStyle(SegmentedPickerStyle())', '.pickerStyle(.segmented)'],
    ['List { Text("Row") }', '.listStyle(InsetGroupedListStyle())', '.listStyle(.insetGrouped)'],
    ['TextField("Name", text: .constant(""))', '.textFieldStyle(RoundedBorderTextFieldStyle())', '.textFieldStyle(.roundedBorder)'],
  ])('draws %s with the old-style %s as it does with %s', (view, old, modern) => {
    const drawn = (style: string) => JSON.stringify(runView(`var body: some View { ${view}${style} }`).renderTree!.nodes)
    expect(drawn(old)).toBe(drawn(modern))
  })

  it('does not stop at the keyframes a KeyframeAnimator is written with', () => {
    const r = compileView(viewSource(`var body: some View {
        KeyframeAnimator(initialValue: 1.0) { value in Text("Pulse").scaleEffect(value) } keyframes: { _ in
          KeyframeTrack { LinearKeyframe(1.2, duration: 0.2); CubicKeyframe(1.0, duration: 0.3) }
        }
      }`))
    expect(r.diagnostics.filter(d => d.severity === 'error' || d.message.startsWith('Cannot find'))).toEqual([])
    expect(r.renderTree).not.toBeNull()
  })
})

describe('E11a: the Foundation the AI writes around its views: Timer, Calendar and formatted dates', () => {
  /** Noon UTC on 9 September 2001: the same calendar day in every time zone from UTC-11 to UTC+11. */
  const noon = 'Date(timeIntervalSince1970: 1_000_036_800)'

  it('draws a view driven by a timer as it first draws, and says the timer does not fire here', () => {
    const r = compileView(viewSource(`@State private var seconds = 0
      let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
      var body: some View { Text("\\(seconds) s").onReceive(timer) { _ in seconds += 1 } }`))
    expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(r.diagnostics.map(d => d.message)).toContainEqual(expect.stringContaining("doesn't run timers"))
    expect(texts(r)).toContain('0 s')
  })

  it('schedules a timer that never fires here, and invalidates it', () => {
    const r = compileView(viewSource(`@State private var count = 0
      @State private var timer: Timer?
      var body: some View {
        Text("\\(count) ticks")
          .onAppear { timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in count += 1 } }
          .onDisappear { timer?.invalidate() }
      }`))
    expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(texts(r)).toContain('0 ticks')
  })

  it("reads a date's parts, adds to it and counts days between two with Calendar.current", () => {
    const r = runView(`let date = ${noon}
      var body: some View {
        VStack {
          Text("\\(Calendar.current.component(.year, from: date))-\\(Calendar.current.component(.month, from: date))-\\(Calendar.current.component(.day, from: date))")
          Text("\\(Calendar.current.dateComponents([.day], from: date, to: Calendar.current.date(byAdding: .day, value: 3, to: date)!).day ?? 0) days")
          Text(Calendar.current.isDateInToday(Date()) ? "today" : "not today")
          Text(Calendar.current.isDate(date, inSameDayAs: Calendar.current.startOfDay(for: date)) ? "same day" : "other day")
        }
      }`)
    expect(texts(r)).toEqual(expect.arrayContaining(['2001-9-9', '3 days', 'today', 'same day']))
  })

  it('formats a date with the parts it is asked for', () => {
    const r = runView(`let date = ${noon}
      var body: some View {
        VStack {
          Text(date.formatted(date: .abbreviated, time: .omitted))
          Text(date.formatted(date: .long, time: .omitted))
          Text(date.formatted(date: .numeric, time: .omitted))
        }
      }`)
    expect(texts(r)).toEqual(['Sep 9, 2001', 'September 9, 2001', '9/9/2001'])
  })

  it('formats a date given no arguments as a numeric date and a short time, as iOS does', () => {
    const [text] = texts(runView(`let date = ${noon}\n var body: some View { Text(date.formatted()) }`))
    expect(text).toMatch(/^9\/9\/2001, \d{1,2}:00[\s\u202f][AP]M$/)
  })
})

describe('E12: what a GeometryReader reports, where it is placed', () => {
  const measured = nativeII.geometryReader
  /** What a reader placed on the phone reports: its top and bottom insets and its frame on the screen. */
  function reads(place: (reader: string) => string) {
    const reader = 'GeometryReader { geo in Text("\\(Int(geo.safeAreaInsets.top)) \\(Int(geo.safeAreaInsets.bottom)) \\(Int(geo.frame(in: .global).minX)) \\(Int(geo.frame(in: .global).minY)) \\(Int(geo.size.width)) \\(Int(geo.size.height))") }'
    const r = screen(`var body: some View { ${place(reader)} }`)
    const shown = texts(r).find(text => /^\d+ \d+ \d+ \d+ \d+ \d+$/.test(text))
    expect(shown, `drew ${JSON.stringify(texts(r))}, logged ${JSON.stringify(r.logs.map(log => log.message))}`).toBeDefined()
    const [top, bottom, x, y, width, height] = shown!.split(' ').map(Number) as [number, number, number, number, number, number]
    return { insets: { top, bottom }, global: [x, y, width, height] }
  }
  const expected = (name: string) => ({ insets: { top: measured[name].insets.top, bottom: measured[name].insets.bottom }, global: measured[name].global })

  it.each([
    ['geo-root', (reader: string) => reader],
    ['geo-ignoring', (reader: string) => `${reader}.ignoresSafeArea()`],
    ['geo-padded', (reader: string) => `VStack { ${reader} }.padding()`],
  ])('reports what the simulator reports on its %s screen', (name, place) => {
    expect(reads(place)).toEqual(expected(name))
  })

  it('reports what the simulator reports on its geo-scroll screen', () => {
    expect(reads((reader) => `ScrollView { ${reader}.frame(height: 200) }`)).toEqual(expected('geo-scroll'))
  })

  it.each([
    ['geo-header', (reader: string) => `VStack { Text("Header").frame(height: 100); ${reader} }.padding()`],
  ])('reports the insets the simulator reports on its %s screen', (name, place) => {
    expect(reads(place).insets).toEqual(expected(name).insets)
  })

  it('reports the size and place a sheet draws a reader at', () => {
    const r = screen('var body: some View { Text("Home").sheet(isPresented: .constant(true)) { GeometryReader { geo in Text("\\(Int(geo.size.width)) \\(Int(geo.size.height)) \\(Int(geo.frame(in: .global).minX)) \\(Int(geo.frame(in: .global).minY))") } } }')
    const reader = nodes(r).find(n => n.id.includes('geo:'))!
    const drawn = worldFrame(nodes(r), reader)
    expect(texts(r)).toContain([drawn.width, drawn.height, drawn.x, drawn.y].map(Math.round).join(' '))
  })

  // Under a bar the preview's own bars stand in for iOS's, which are not quite the same
  // height (a large title ends at 164, not 168), so the edge under the bar is checked by
  // how the simulator's inset there relates to where its reader was, and the other edge
  // as measured (geo-nav, geo-inline, geo-tab).
  it.each([
    ['geo-nav', 'top', (reader: string) => `NavigationStack { ${reader}.navigationTitle("Title") }`],
    ['geo-inline', 'top', (reader: string) => `NavigationStack { ${reader}.navigationTitle("Title").navigationBarTitleDisplayMode(.inline) }`],
    ['geo-tab', 'bottom', (reader: string) => `TabView { ${reader}.tabItem { Label("One", systemImage: "house") } }`],
  ] as const)('reports what the simulator reports on its %s screen, from the preview\'s own %s bar', (name, barEdge, place) => {
    const measured = expected(name)
    const drawn = reads(place)
    const other = barEdge === 'top' ? 'bottom' : 'top'
    /** How far the inset under the bar is from the reader's distance to that screen edge. */
    const offBy = (insets: { top: number; bottom: number }, [, y, , height]: readonly number[]) =>
      barEdge === 'top' ? insets.top - y! : insets.bottom - (874 - y! - height!)
    expect(drawn.insets[other]).toBe(measured.insets[other])
    expect(offBy(drawn.insets, drawn.global)).toBe(offBy(measured.insets, measured.global))
  })
})

describe('E12: .id, links and a timeline, as iOS 27 draws them', () => {
  const counter = 'struct Counter: View { @State private var taps = 0; var body: some View { Button("Taps \\(taps)") { taps += 1 } } }'

  it('starts a view over, with its state fresh, when its .id changes', () => {
    const r = runView(`@State private var version = 0
      var body: some View { VStack { Counter().id(version); Button("Reset") { version += 1 } } }`, counter)
    const tapped = tap(tap(r, 'Taps 0'), 'Taps 1')
    expect(texts(tapped)).toContain('Taps 2')
    expect(texts(tap(tapped, 'Reset'))).toContain('Taps 0')
  })

  it('runs the appear and disappear hooks of a view whose .id changes, as a new view', () => {
    const r = runView(`@State private var version = 0
      @State private var log: [String] = []
      var body: some View { VStack { Text(log.joined(separator: ",")); Button("Reset") { version += 1 }; Child(log: $log).id(version) } }`,
      'struct Child: View { @Binding var log: [String]; var body: some View { Text("Child").onAppear { log.append("appear") }.onDisappear { log.append("gone") } } }')
    expect(texts(r)[0]).toBe('appear')
    expect(texts(tap(r, 'Reset'))[0]!.split(',').sort()).toEqual(['appear', 'appear', 'gone'])
  })

  it('keeps its state while the .id stays the same', () => {
    const r = runView(`@State private var version = 0
      @State private var other = 0
      var body: some View { VStack { Counter().id(version); Button("Other \\(other)") { other += 1 } } }`, counter)
    expect(texts(tap(tap(r, 'Taps 0'), 'Other 0'))).toContain('Taps 1')
  })

  // Measured in the iOS 27 simulator (docs/parity/native/iphone18pro-misrenders-ii, links).
  it.each([
    ['Link("Site", destination: url)', [], ['Site']],
    ['Link(destination: url) { Label("Site", systemImage: "globe") }', ['globe'], ['Site']],
    ['ShareLink(item: url)', ['square.and.arrow.up'], ['Share…']],
    ['ShareLink("Share", item: url)', ['square.and.arrow.up'], ['Share']],
    ['ShareLink(item: url) { Label("Send", systemImage: "paperplane") }', ['paperplane'], ['Send']],
  ])('draws %s with the icon and words the simulator draws', (link, icons, words) => {
    const r = compileView(viewSource(`let url = URL(string: "https://example.com")!\n var body: some View { ${link} }`))
    expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect([symbols(r), texts(r)]).toEqual([icons, words])
  })

  it("draws a TimelineView's content for the moment it is drawn", () => {
    const r = compileView(viewSource('var body: some View { TimelineView(.periodic(from: .now, by: 1)) { context in Text(context.date, style: .time) } }'))
    expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(texts(r).some(text => /^\d{1,2}:\d{2}/.test(text))).toBe(true)
  })
})

describe("E7: a Picker or TabView over ForEach selects by its rows' own tags, as iOS 27 does", () => {
  const tags = nativeII.pickerTags
  const types = `enum FlavorSelf: String, CaseIterable, Identifiable { case vanilla, chocolate, strawberry; var id: Self { self } }
enum FlavorRaw: String, CaseIterable, Identifiable { case vanilla, chocolate, strawberry; var id: String { rawValue } }
enum Plain: String, CaseIterable { case vanilla, chocolate, strawberry }
struct Scoop: Identifiable { let id: Int; let name: String }`
  const scoops = 'let scoops = [Scoop(id: 1, name: "vanilla"), Scoop(id: 2, name: "chocolate"), Scoop(id: 3, name: "strawberry")]'
  /** Each case of the simulator's tags screens: the selection's type and start, and the rows. */
  const cases: Record<string, [string, string]> = {
    A: ['FlavorSelf = .chocolate', 'ForEach(FlavorSelf.allCases) { Text($0.rawValue) }'],
    B: ['FlavorRaw = .chocolate', 'ForEach(FlavorRaw.allCases) { Text($0.rawValue) }'],
    C: ['Plain = .chocolate', 'ForEach(Plain.allCases, id: \\.self) { Text($0.rawValue) }'],
    D: ['Plain = .chocolate', 'ForEach(Plain.allCases, id: \\.rawValue) { Text($0.rawValue) }'],
    E: ['String = "chocolate"', 'ForEach(Plain.allCases, id: \\.rawValue) { Text($0.rawValue) }'],
    H: ['Int = 2', 'ForEach(scoops) { Text($0.name) }'],
    I: ['Int = 1', 'ForEach(0..<3) { Text(Plain.allCases[$0].rawValue) }'],
    G1: ['FlavorSelf? = .chocolate', 'ForEach(FlavorSelf.allCases) { Text($0.rawValue) }'],
    G2: ['Plain? = .chocolate', 'ForEach(Plain.allCases, id: \\.self) { Text($0.rawValue) }'],
    G3: ['String? = "chocolate"', 'ForEach(Plain.allCases, id: \\.rawValue) { Text($0.rawValue) }'],
    K1: ['FlavorSelf? = .chocolate', 'ForEach(FlavorSelf.allCases) { Text($0.rawValue).tag($0) }'],
    K2: ['FlavorSelf? = .chocolate', 'ForEach(FlavorSelf.allCases) { Text($0.rawValue).tag($0, includeOptional: false) }'],
    L: ['FlavorSelf? = .chocolate', 'ForEach(FlavorSelf.allCases) { Text($0.rawValue).tag(Optional($0)) }'],
  }
  /** What the simulator drew for a case: 'middle' when its middle row was selected, 'none' when none was. */
  const measuredFor = (letter: string): string => Object.entries({ ...tags.segmented, ...tags.optional } as Record<string, string>).find(([caption]) => caption.startsWith(`${letter} `))![1]
  const pickerSource = (letter: string, style = '.pickerStyle(.segmented)') => {
    const [type, rows] = cases[letter]!
    return compileView(viewSource(`@State private var choice: ${type}\n ${scoops}\n var body: some View { Picker("Flavor", selection: $choice) { ${rows} }${style} }`, types))
  }
  /** The option a segmented picker draws on its selected pill, or null when none is selected. */
  function selectedSegment(r: CompileResult): string | null {
    const all = nodes(r)
    const pills = all.filter(n => n.id !== 'screen' && n.background?.kind === 'solid' && n.background.color.r === 255 && n.background.color.g === 255 && n.background.color.b === 255).map(n => worldFrame(all, n))
    const option = all.filter(n => n.text).find(n => {
      const f = worldFrame(all, n), x = f.x + f.width / 2, y = f.y + f.height / 2
      return pills.some(p => x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height)
    })
    return option?.text?.runs.map(run => run.text).join('') ?? null
  }

  it.each(Object.keys(cases))('selects what the simulator selects for case %s', (letter) => {
    const r = pickerSource(letter)
    expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(selectedSegment(r)).toBe(measuredFor(letter) === 'middle' ? 'chocolate' : null)
  })

  it('selects a row by tapping it only where its tag fits the selection', () => {
    expect(selectedSegment(tap(pickerSource('A'), 'strawberry'))).toBe('strawberry')
    expect(selectedSegment(tap(pickerSource('B'), 'strawberry'))).toBe(null)
  })

  it.each(Object.entries(tags.menuLabels as Record<string, string>).filter(([caption]) => caption !== 'note'))(
    "shows what the simulator shows beside the menu picker %s", (caption, shown) => {
      const rows: Record<string, [string, string]> = {
        'A match': cases.A!, 'B String id': cases.B!, 'H Int id': cases.H!, 'G Optional': cases.G1!,
        'S no such row': ['String = "mint"', 'ForEach(Plain.allCases, id: \\.rawValue) { Text($0.rawValue) }'],
        'M String tag': ['Plain = .chocolate', 'ForEach(Plain.allCases, id: \\.self) { Text($0.rawValue).tag($0.rawValue) }'],
      }
      const [type, options] = rows[caption]!
      const r = compileView(viewSource(`@State private var choice: ${type}\n ${scoops}\n var body: some View { Form { Picker("Flavor", selection: $choice) { ${options} } } }`, types))
      expect(texts(r).filter(text => text && text !== 'Flavor')).toEqual(shown ? [shown] : [])
    })

  it('opens a TabView over ForEach pages on the page of its selection', () => {
    const r = runView(`@State private var tab: FlavorSelf = .chocolate
      var body: some View {
        TabView(selection: $tab) {
          ForEach(FlavorSelf.allCases) { flavor in
            Text("Page \\(flavor.rawValue)").tabItem { Label(flavor.rawValue, systemImage: "circle") }
          }
        }
      }`, types)
    expect(texts(r)).toContain(tags.tabView.shownPage)
  })

  it('warns at a Picker none of whose rows its selection can match', () => {
    const [warning, ...rest] = reported('@State private var choice: FlavorRaw = .chocolate\n var body: some View { Picker("Flavor", selection: $choice) { ForEach(FlavorRaw.allCases) { Text($0.rawValue) } } }', types)
    expect(rest).toEqual([])
    expect(warning).toMatchObject({ severity: 'warning', message: expect.stringContaining("can't select any of its rows") })
  })

  it("treats a model's Optional property as Optional, as it does a view's own", () => {
    const r = compileView(viewSource(`@State private var model = Model()
      var body: some View { Picker("Flavor", selection: $model.flavor) { ForEach(FlavorSelf.allCases) { Text($0.rawValue) } }.pickerStyle(.segmented) }`,
      `${types}\n@Observable final class Model { var flavor: FlavorSelf? = .chocolate }`))
    expect(selectedSegment(r)).toBe(null)
    expect(r.diagnostics.map(d => d.message)).toContainEqual(expect.stringContaining("can't select any of its rows"))
  })

  it('selects no row of another type while an Optional selection is nil', () => {
    const r = compileView(viewSource('@State private var choice: String? = nil\n var body: some View { Picker("Size", selection: $choice) { Text("S").tag(1); Text("M").tag(2) }.pickerStyle(.segmented) }', types))
    expect(selectedSegment(tap(r, 'M'))).toBe(null)
  })

  it('says nothing about a Picker whose rows its selection matches', () => {
    expect(reported('@State private var choice: FlavorSelf = .chocolate\n var body: some View { Picker("Flavor", selection: $choice) { ForEach(FlavorSelf.allCases) { Text($0.rawValue) } } }', types)).toEqual([])
  })

  it("gives each row of ForEach(…, id: \\.rawValue) its own action", () => {
    const r = runView(`@State private var picked = "none"
      var body: some View {
        VStack {
          Text("Picked \\(picked)")
          ForEach(Plain.allCases, id: \\.rawValue) { flavor in Button(flavor.rawValue) { picked = flavor.rawValue } }
        }
      }`, types)
    expect(texts(tap(r, 'vanilla'))).toContain('Picked vanilla')
  })

  it('opens a Menu over ForEach onto its rows', () => {
    const r = runView('var body: some View { Menu("Flavours") { ForEach(Plain.allCases, id: \\.self) { flavor in Button(flavor.rawValue) { } } } }', types)
    expect(controls(tap(r, 'Flavours'))).toEqual(expect.arrayContaining(['vanilla', 'chocolate', 'strawberry']))
  })
})

describe('lists written over enumerated() and zip', () => {
  it('draws a numbered list from ForEach over enumerated(), the way the AI numbers rows', () => {
    const r = runView(`let names = ["Ada", "Grace"]
      var body: some View {
        VStack {
          ForEach(Array(names.enumerated()), id: \\.offset) { index, name in Text("\\(index + 1). \\(name)") }
          ForEach(Array(zip(names.indices, names)), id: \\.0) { index, name in Text("\\(name) at \\(index)") }
        }
      }`)
    expect(texts(r)).toEqual(['1. Ada', '2. Grace', 'Ada at 0', 'Grace at 1'])
  })
})

describe('a ScrollView puts a lone child at its top, as iOS 27 does', () => {
  const measured = nativeII.scrollView.frames
  const at = (r: CompileResult, node: RenderNode) => { const f = worldFrame(nodes(r), node); return [f.x, f.y, f.width, f.height] }

  it('draws a fixed-height view where the simulator draws it', () => {
    const r = screen('var body: some View { ScrollView { Color.red.frame(height: 200) } }')
    const red = nodes(r).find(n => n.id !== 'screen' && n.background?.kind === 'solid' && n.frame.height === 200)!
    expect(at(r, red)).toEqual(measured['scroll-fixed'])
  })

  it('draws a lone Text at the top, centred across, and its own height', () => {
    const r = screen('var body: some View { ScrollView { Text("Hi") } }')
    const [x, y, width, height] = measured['scroll-text']
    const text = placed(r, 'Hi')
    expect(Math.abs(text.y - y)).toBeLessThanOrEqual(1)
    expect(Math.abs(text.x + text.width / 2 - (x + width / 2))).toBeLessThanOrEqual(1)
    // The preview's body line is 22 points to iOS's 20, the same in every view.
    expect(Math.abs(text.height - height)).toBeLessThanOrEqual(2)
  })
})

describe('Text interpolated into Text', () => {
  // Measured in the iOS 27 simulator (docs/parity/native/iphone18pro-misrenders-ii, textInText).
  it('draws the inner Text as part of the sentence, with its own styling', () => {
    const r = runView('var body: some View { Text("\\(Text("Bold").bold()) and plain") }')
    const runs = nodes(r).find(n => n.text)!.text!.runs
    expect(runs.map(run => run.text).join('')).toBe('Bold and plain')
    expect(runs.map(run => [run.text, run.font.weight >= 600])).toEqual([['Bold', true], [' and plain', false]])
  })

  it('still gives a title that is not a Text the words, as a Button or a navigation title', () => {
    const r = runView('var body: some View { NavigationStack { Button("\\(Text("Bold").bold()) go") { }.navigationTitle("\\(Text("Home")) screen") } }')
    expect(controls(r)).toContain('Bold go')
    expect(texts(r)).toContain('Home screen')
  })
})

describe('F4: an internal error is reported where it happened, and never stops the worker', () => {
  const tagClass = `final class Tag: Hashable {
    let name: String
    init(_ name: String) { self.name = name }
    static func == (a: Tag, b: Tag) -> Bool { a.name == b.name }
    func hash(into hasher: inout Hasher) { hasher.combine(name) }
  }`

  it('keeps class instances apart as ForEach rows, though each prints as its type', () => {
    const r = compileView(viewSource(`@State private var picked = "none"
      let tags = [Tag("Nuts"), Tag("Fudge")]
      var body: some View {
        VStack {
          Text("Picked \\(picked)")
          ForEach(tags, id: \\.self) { tag in Button(tag.name) { picked = tag.name } }
        }
      }`, tagClass))
    expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(texts(tap(r, 'Nuts'))).toContain('Picked Nuts')
  })

  it('writes through a force-unwrapped object whose parent points back at it', () => {
    const r = runView(`var body: some View { Text(rename()) }
      func rename() -> String {
        let root = Node()
        let leaf: Node? = Node()
        root.child = leaf
        leaf!.parent = root
        leaf!.name = "Renamed"
        return root.child!.name
      }`, 'final class Node { var name = ""; var parent: Node?; var child: Node? }')
    expect(texts(r)).toEqual(['Renamed'])
  })

  it('reports recursion that never ends where it recurses, instead of stopping the worker', () => {
    const body = 'n == 0 ? 0 : 1 + steps(n - 1)'
    const source = viewSource(`var body: some View { Text("\\(steps(-1))") }
      func steps(_ n: Int) -> Int { ${body} }`)
    const r = compileView(source)
    const [error, ...others] = r.diagnostics.filter(d => d.severity === 'error')
    expect(others).toEqual([])
    expect(error!.message).toContain('recursion that never ends')
    const at = source.indexOf(body)
    expect(error!.span.start).toBeGreaterThanOrEqual(at)
    expect(error!.span.end).toBeLessThanOrEqual(at + body.length)
  })

  it('reports a class that builds another of itself as it is built, where it does', () => {
    const declaration = 'final class Tree { var next = Tree() }'
    const source = viewSource('var body: some View { Text("\\(Tree().next === nil)") }', declaration)
    const [error, ...others] = compileView(source).diagnostics.filter(d => d.severity === 'error')
    expect(others).toEqual([])
    expect(error!.message).toContain('recursion that never ends')
    expect(source.slice(error!.span.start, error!.span.end)).toBe('Tree()')
    expect(error!.span.start).toBe(source.indexOf(declaration) + declaration.indexOf('Tree()'))
  })

  it('reports a type alias that names itself as Xcode does, at the alias', () => {
    // swiftc: "type alias 'Count' references itself", once, at the first of the two.
    expect(reported('var body: some View { Text("\\(Count.self)") }', 'typealias Count = Total\ntypealias Total = Count')).toEqual([
      { severity: 'error', message: "Type alias 'Count' references itself.", at: 'Count', fix: undefined },
    ])
  })
})

describe('F11: a view that stops draws a placeholder where it is, and the rest of the screen still works', () => {
  const broken = 'struct Broken: View { let items: [Int] = []; var body: some View { Text("\\(items[0])") } }'
  const stopped = (r: CompileResult) => nodes(r).filter(n => n.placeholder).map(n => n.placeholder)

  it('draws the views around one that stops, and reports the line it stopped at', () => {
    const source = viewSource('var body: some View { VStack { Text("Top"); Broken(); Text("Bottom") } }', broken)
    const r = compileView(source)
    expect(texts(r)).toEqual(expect.arrayContaining(['Top', 'Bottom']))
    expect(stopped(r)).toEqual([{ feature: 'Broken stopped', reason: 'Swift runtime failure: Index out of range' }])
    const markup = renderToStaticMarkup(createElement(RenderTreeView, { tree: r.renderTree!, onEvent: () => {} }))
    expect(markup).toContain('Broken stopped')
    expect(markup).toContain('Swift runtime failure: Index out of range')
    const [error, ...others] = r.diagnostics.filter(d => d.severity === 'error')
    expect(others).toEqual([])
    expect(error!.message).toContain('Index out of range')
    expect(source.slice(error!.span.start, error!.span.end)).toContain('items[0]')
  })

  it('keeps the rest of the screen interactive', () => {
    const r = compileView(viewSource(`@State private var count = 0
      var body: some View { VStack { Broken(); Button("Add") { count += 1 }; Text("Count \\(count)") } }`, broken))
    expect(texts(tap(r, 'Add'))).toContain('Count 1')
  })

  it('names the stopped view in the layers, and selects it from its placeholder', () => {
    const r = compileView(viewSource('var body: some View { VStack { Text("Top"); Broken().padding() } }', broken))
    const layers = (items: readonly ViewLayer[]): string[] => items.flatMap(item => [item.name, ...layers(item.children)])
    expect(layers(r.viewHierarchy ?? [])).toEqual(['Main page', 'VStack', 'Top', 'Broken'])
    const placeholder = nodes(r).find(n => n.placeholder)!
    const authoring = r.authoring!
    expect(authoring.nodes.find(n => n.id === authoring.runtimeToSource[placeholder.id])).toMatchObject({ kind: 'component', name: 'Broken' })
  })

  it('draws a pushed destination whose own content stops as stopped, and can still go back', () => {
    const r = runView(`let items: [Int] = []
      var body: some View { NavigationStack { NavigationLink("Open") { Text("\\(items[5])") }.navigationTitle("Home") } }`)
    const pushed = tap(r, 'Open')
    expect(nodes(pushed).find(n => n.placeholder)?.placeholder).toMatchObject({ feature: 'Destination stopped', reason: expect.stringContaining('Index out of range') })
    expect(texts(tap(pushed, 'Home'))).toContain('Home')
  })
})

describe('F3: every ForEach row keeps its own identity', () => {
  /** Swipes a row open, as a person drags it leftwards, and draws the result. */
  const swipeOpen = (row: RenderNode) => {
    applyEvent({ kind: 'drag', handlerId: row.hitTarget!.handlerId, phase: 'ended', location: { x: -90, y: 0 }, startLocation: { x: 0, y: 0 }, translation: { x: -90, y: 0 } })
    return rerender(revision++)
  }

  it('gives rows whose ids differ only in punctuation their own actions', () => {
    const r = runView(`@State private var picked = "none"
      var body: some View {
        VStack {
          Text("Picked \\(picked)")
          ForEach(["C", "C++", "C#"], id: \\.self) { language in Button(language) { picked = language } }
        }
      }`)
    expect(texts(tap(r, 'C++'))).toContain('Picked C++')
    expect(texts(tap(r, 'C'))).toContain('Picked C')
  })

  it('deletes the element a swiped row belongs to when each element draws two rows', () => {
    const r = runView(`@State private var items = ["A", "B", "C"]
      var body: some View {
        List {
          ForEach(items, id: \\.self) { item in Text(item); Text(item + " detail") }
            .onDelete { offsets in items.remove(atOffsets: offsets) }
        }
      }`)
    const rows = nodes(r).filter(n => n.hitTarget?.role === 'drag')
    expect(new Set(rows.map(row => row.hitTarget!.handlerId)).size).toBe(6)
    const after = tap(swipeOpen(rows[3]!), 'Delete')
    expect(texts(after).filter(t => t !== 'Delete')).toEqual(['A', 'A detail', 'C', 'C detail'])
  })

  it('warns at a ForEach whose rows share an id, and still keeps their actions apart', () => {
    const members = `@State private var picked = "none"
      let pets = [Pet(id: 1, name: "Rex"), Pet(id: 1, name: "Tom")]
      var body: some View {
        VStack {
          Text("Picked \\(picked)")
          ForEach(pets) { pet in Button(pet.name) { picked = pet.name } }
        }
      }`
    const pet = 'struct Pet: Identifiable { let id: Int; let name: String }'
    const [warning, ...others] = reported(members, pet)
    expect(others).toEqual([])
    expect(warning).toMatchObject({ severity: 'warning', message: expect.stringContaining('have the id 1') })
    expect(warning!.at.startsWith('ForEach(pets)')).toBe(true)
    expect(texts(tap(compileView(viewSource(members, pet)), 'Rex'))).toContain('Picked Rex')
  })
})

describe('F12: containers that hand their content a value draw it', () => {
  const placeholders = (r: CompileResult) => nodes(r).filter(n => n.placeholder).map(n => n.placeholder!.feature)
  const warnings = (r: CompileResult) => r.diagnostics.filter(d => d.severity === 'warning').map(d => d.message)

  it('draws what a ScrollViewReader holds, and says scrollTo does not scroll the preview', () => {
    const r = compileView(viewSource('var body: some View { ScrollViewReader { proxy in ScrollView { Text("Inside reader"); Button("Top") { proxy.scrollTo(0) } } } }'))
    expect(placeholders(r)).toEqual([])
    expect(texts(r)).toContain('Inside reader')
    expect(warnings(r)).toEqual([expect.stringContaining('scrollTo')])
    expect(tap(r, 'Top').logs.filter(log => log.level === 'error')).toEqual([])
  })

  it('draws a PhaseAnimator at its first phase', () => {
    const r = compileView(viewSource('var body: some View { PhaseAnimator([false, true]) { on in Text(on ? "On" : "Off") } }'))
    expect(placeholders(r)).toEqual([])
    expect(texts(r)).toEqual(['Off'])
    expect(warnings(r)).toEqual([expect.stringContaining('first phase')])
  })

  it('draws a KeyframeAnimator at its initial value', () => {
    const r = compileView(viewSource('var body: some View { KeyframeAnimator(initialValue: 1.0) { value in Text("Scale \\(value)") } keyframes: { _ in LinearKeyframe(2.0, duration: 1) } }'))
    expect(placeholders(r)).toEqual([])
    expect(texts(r)).toEqual(['Scale 1.0'])
    expect(warnings(r)).toEqual([expect.stringContaining('initial value')])
  })

  it("puts a TabSection's tabs in the tab bar", () => {
    const r = runView(`var body: some View {
        TabView {
          Tab("Home", systemImage: "house") { Text("Home page") }
          TabSection("More") {
            Tab("One", systemImage: "star") { Text("Tab one") }
            Tab("Two", systemImage: "heart") { Text("Tab two") }
          }
        }
      }`)
    expect(controls(r)).toEqual(expect.arrayContaining(['Home', 'One', 'Two']))
    expect(texts(tap(r, 'Two'))).toContain('Tab two')
  })
})

describe("F6: the Design gallery draws the screens it can, and says which it couldn't", () => {
  /** Four tabs whose toolbars each take about a million steps: each screen draws alone, and together they outrun one budget. */
  const heavyTabs = viewSource(`var body: some View {
      TabView {
        ForEach(1...4, id: \\.self) { tab in
          NavigationStack { List { NavigationLink("Go") { Text("Detail \\(tab)") } }.navigationTitle("Tab \\(tab)").toolbar { ToolbarItem { Text(heavy(tab)) } } }
            .tabItem { Label("Tab \\(tab)", systemImage: "star") }
        }
      }
    }`, 'func heavy(_ tag: Int) -> String { var total = 0; for i in 0..<150000 { total += i % 7 }; return "Busy \\(tag)" }')

  it('draws the live screen alone', () => {
    expect(texts(compileView(heavyTabs))).toContain('Busy 1')
  })

  it('draws the gallery up to its budget, and warns at each screen it could not draw', () => {
    const r = compileView(heavyTabs, { allPages: true })
    expect(r.renderTree).not.toBeNull()
    expect(texts(r)).toContain('Busy 1')
    const drawn = (r.pages ?? []).map(page => page.name)
    const skipped = r.diagnostics.filter(d => d.severity === 'warning' && d.message.includes("isn't drawn on the Design canvas"))
    expect(drawn.length).toBeGreaterThan(0)
    // The tabs share the ForEach's source, and each one missing is still said.
    expect(skipped.length).toBeGreaterThanOrEqual(2)
    expect(new Set(skipped.map(d => d.message)).size).toBe(skipped.length)
    expect(r.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  })
})
