import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, compile, fontForToken, rerender, resetPipelineState, setFontMetrics } from '@studio/swiftui-runtime'
import { worldFrame } from './render-geometry'

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
})

/** What the iOS 27 simulator drew on iPhone 18 Pro, light (docs/parity/native/iphone18pro-misrenders). */
const native = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-misrenders/measurements.json', import.meta.url), 'utf8')).measured

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
})
