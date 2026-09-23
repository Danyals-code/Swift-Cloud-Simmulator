import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, colorForName, compile, fontForToken, rerender, resetPipelineState, setFontMetrics } from '@studio/swiftui-runtime'
import { KNOWN_COLOR_NAMES } from '@studio/swift-sema'
import { IOS_27 } from '../packages/swiftui-runtime/src/appearance/ios27'
import { AUTHORING_COLOR_HEX } from '../packages/swift-sema/src/authoring-resources'
import { DEVICES } from '@studio/sim-shell'
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

/** What the iOS 27 simulator drew on iPhone 18 Pro, light (docs/parity/native/iphone18pro-misrenders). */
const native = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-misrenders/measurements.json', import.meta.url), 'utf8')).measured

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
