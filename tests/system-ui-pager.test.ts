import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, compile, endLayerDraft, rerender, resetPipelineState, setMeasureTarget } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import { worldFrame } from './render-geometry'
import { layerForRenderNode } from '../apps/web/lib/layers'
import { XCODE, typecheckInXcode } from './helpers/layer-project'

/**
 * A page-style TabView drawn in place inside a screen, with its page dots, and a ScrollView
 * that pages (Wave 4c), through `compile()`, against what the iOS 27 simulator draws for
 * tests/fixtures/ios27-system-ui-4c.swift.
 */

const native = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-system-ui/measurements.json', import.meta.url), 'utf8')).measured
const device = DEVICES['iphone-18-pro']
let revision = 1

const source = (body: string, members = '') =>
  `import SwiftUI\n\n@main\nstruct ProbeApp: App {\n    var body: some Scene {\n        WindowGroup { RootView() }\n    }\n}\n\nstruct RootView: View {\n${members}\n    var body: some View {\n${body}\n    }\n}\n`

function run(body: string, members = '', allPages = false): CompileResult {
  return runSource(source(body, members), allPages)
}

function runSource(text: string, allPages = false): CompileResult {
  resetPipelineState()
  const result = compile({
    ...(allPages ? { allPages } : {}),
    files: [{ id: 'App.swift', text }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  })
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result
}

const nodes = (r: CompileResult) => r.renderTree?.nodes ?? []
const frame = (r: CompileResult, node: RenderNode) => worldFrame(nodes(r), node)
const texts = (r: CompileResult) => nodes(r).flatMap(n => n.text?.runs.map(run => run.text) ?? [])
/** Taps the control a person would tap by this name, and draws what it changed. */
function press(r: CompileResult, label: string): CompileResult {
  const target = nodes(r).find(n => n.hitTarget?.enabled && n.a11y?.label === label)
  expect(target, `no control called "${label}"`).toBeDefined()
  applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(revision++)
}
const warnings = (r: CompileResult) => r.diagnostics.filter(d => d.severity === 'warning').map(d => d.message)
/** The node filled with this colour, as a page that is a `Color` is. */
const filled = (r: CompileResult, rgb: readonly number[]) => nodes(r).find(n => n.background?.kind === 'solid' && [n.background.color.r, n.background.color.g, n.background.color.b].join() === rgb.join())

/** The fixture's carousel: a title, a pager 240 tall of three pages, and a button. */
const pager = (pages: string, style = '.tabViewStyle(.page)', selection = '') => `        VStack(spacing: 16) {
            Text("Welcome")
                .font(.largeTitle)
            TabView${selection} {
${pages}
            }
            ${style}
            .frame(height: 240)
            Button("Continue") { }
        }`
const COLORED = `                Color.red.overlay { Text("One") }
                Color.green.overlay { Text("Two") }
                Color.blue.overlay { Text("Three") }`

describe('a page-style TabView inside a screen', () => {
  it('is drawn in place at its own height, beside the views around it', () => {
    const r = run(pager(COLORED), '', true)
    expect(warnings(r)).toEqual([])
    expect(texts(r)).toEqual(expect.arrayContaining(['Welcome', 'One', 'Continue']))
    expect(texts(r)).not.toContain('Two')
    const page = frame(r, filled(r, [255, 56, 60])!)
    expect(page.width).toBeCloseTo(402, 1)
    expect(page.height).toBeCloseTo(native.pager.frame.height, 1)
    expect(Math.abs(page.y - native.pager.frame.y[0])).toBeLessThan(1.5)
    // The screen is one page in the gallery: its carousel's pages are not screens.
    expect(r.pages?.map(p => p.name)).toEqual(['Main page'])
  })

  it('has white dots over its bottom, the others white at 0.44, each a button to its page', () => {
    const r = run(pager(COLORED))
    const { dots } = native.pager
    const circles = nodes(r).filter(n => n.shape?.shape === 'circle')
    expect(circles.map(n => n.shape?.fill?.kind === 'solid' && n.shape.fill.color)).toEqual([
      { r: 255, g: 255, b: 255, a: 1 }, { r: 255, g: 255, b: 255, a: 0.44 }, { r: 255, g: 255, b: 255, a: 0.44 },
    ])
    const first = frame(r, circles[0]!), last = frame(r, circles[2]!)
    expect(first.width).toBeCloseTo(dots.diameter, 1)
    // From the first dot's leading edge to the last one's trailing edge, centred across the screen.
    const [from, to] = dots.threePages.x as number[]
    expect(Math.abs(last.x + last.width - first.x - (to! - from!))).toBeLessThan(0.5)
    expect(Math.abs((first.x + last.x + last.width) / 2 - (from! + to!) / 2)).toBeLessThan(0.5)
    expect(Math.abs(first.y + first.height / 2 - dots.threePages.centreY)).toBeLessThan(1.5)
    expect(['Page 1', 'Page 2', 'Page 3'].map(name => nodes(r).filter(n => n.hitTarget?.enabled && n.a11y?.role === 'button' && n.a11y.label === name).length)).toEqual([1, 1, 1])
  })

  it('switches pages from its dots, writing its selection', () => {
    const r = run(`        VStack {
            Text("On \\(page)")
            TabView(selection: $page) {
                Text("One").tag(0)
                Text("Two").tag(1)
                Text("Three").tag(2)
            }
            .tabViewStyle(.page)
            .frame(height: 240)
        }`, '    @State private var page = 0')
    expect(texts(r)).toEqual(['On 0', 'One'])
    const second = press(r, 'Page 2')
    expect(texts(second)).toEqual(['On 1', 'Two'])
    const third = press(second, 'Page 3')
    expect(texts(third)).toEqual(['On 2', 'Three'])
  })

  it('pages through a ForEach, selected by its rows\' ids', () => {
    const r = run(`        TabView(selection: $name) {
            ForEach(names, id: \\.self) { name in
                Text(name)
            }
        }
        .tabViewStyle(.page)
        .frame(height: 240)`, '    let names = ["Ana", "Ben", "Cy"]\n    @State private var name = "Ben"')
    expect(texts(r)).toEqual(['Ben'])
    expect(texts(press(r, 'Page 3'))).toEqual(['Cy'])
  })

  it('switches pages from its dots with no selection to write', () => {
    const r = run(pager(COLORED))
    expect(texts(press(r, 'Page 3'))).toEqual(['Welcome', 'Three', 'Continue'])
  })

  it('shows the page its selection holds, and the dot for it', () => {
    const r = run(pager(`                Color.red.tag(0)
                Color.green.tag(1)
                Color.blue.tag(2)
                Color.orange.tag(3)`, '.tabViewStyle(.page)', '(selection: $page)'), '    @State private var page = 1')
    expect(filled(r, [52, 199, 89])).toBeDefined()
    expect(filled(r, [255, 56, 60])).toBeUndefined()
    const circles = nodes(r).filter(n => n.shape?.shape === 'circle')
    const selected = circles.findIndex(n => n.shape?.fill?.kind === 'solid' && n.shape.fill.color.a === 1)
    expect(selected).toBe(native.pager.dots.fourPages.selected)
    const [from, to] = native.pager.dots.fourPages.x as number[]
    const first = frame(r, circles[0]!), last = frame(r, circles[3]!)
    expect(Math.abs(last.x + last.width - first.x - (to! - from!))).toBeLessThan(0.5)
  })
})

describe('page dots', () => {
  const dots = (r: CompileResult) => nodes(r).filter(n => n.shape?.shape === 'circle').length
  const one = (style: string) => run(pager('                Color.blue', style))

  it('are shown for two pages or more by default, and hidden for one', () => {
    expect(dots(run(pager(COLORED)))).toBe(3)
    expect(dots(one('.tabViewStyle(.page)'))).toBe(0)
    expect(dots(one('.tabViewStyle(.page(indexDisplayMode: .automatic))'))).toBe(0)
  })

  it('are shown always, even for one page, or never', () => {
    const always = one('.tabViewStyle(.page(indexDisplayMode: .always))')
    expect(dots(always)).toBe(1)
    const dot = frame(always, nodes(always).find(n => n.shape?.shape === 'circle')!)
    const page = frame(always, filled(always, [0, 136, 255])!)
    expect(Math.abs(page.y + page.height - (dot.y + dot.height / 2) - native.pager.dots.centreAboveBottom)).toBeLessThan(0.5)
    expect(dots(run(pager(COLORED, '.tabViewStyle(.page(indexDisplayMode: .never))')))).toBe(0)
  })

  it('read the older spelling, PageTabViewStyle, as the page style it is', () => {
    const older = run(pager(COLORED, '.tabViewStyle(PageTabViewStyle())'), '', true)
    expect(older.pages?.map(p => p.name)).toEqual(['Main page'])
    expect(dots(older)).toBe(3)
    expect(dots(run(pager(COLORED, '.tabViewStyle(PageTabViewStyle(indexDisplayMode: .never))')))).toBe(0)
    expect(dots(one('.tabViewStyle(PageTabViewStyle(indexDisplayMode: .always))'))).toBe(1)
  })

  it('sit on a light capsule with .indexViewStyle(.page(backgroundDisplayMode: .always)), the others black at 0.24', () => {
    const r = run(pager(COLORED, '.tabViewStyle(.page)\n            .indexViewStyle(.page(backgroundDisplayMode: .always))'))
    expect(warnings(r)).toEqual([])
    const { capsule } = native.pager.background
    const surface = nodes(r).find(n => n.background?.kind === 'solid' && n.background.color.a < 1 && n.background.color.r === 238)!
    expect(surface).toBeDefined()
    const at = frame(r, surface)
    expect(Math.abs(at.x - capsule.x[0])).toBeLessThan(0.5)
    expect(Math.abs(at.x + at.width - capsule.x[1])).toBeLessThan(0.5)
    expect(Math.abs(at.height - capsule.height)).toBeLessThan(0.5)
    expect(Math.abs(at.y - capsule.y[0])).toBeLessThan(1.5)
    expect(nodes(r).filter(n => n.shape?.shape === 'circle').map(n => n.shape?.fill?.kind === 'solid' && n.shape.fill.color)).toEqual([
      { r: 255, g: 255, b: 255, a: 1 }, { r: 0, g: 0, b: 0, a: 0.24 }, { r: 0, g: 0, b: 0, a: 0.24 },
    ])
  })

  it('take the background written above the pager, as an environment value', () => {
    const r = run(`        VStack {
            TabView {
                Color.red
                Color.green
            }
            .tabViewStyle(.page)
        }
        .indexViewStyle(.page(backgroundDisplayMode: .always))`)
    expect(nodes(r).some(n => n.background?.kind === 'solid' && n.background.color.r === 238 && n.background.color.a < 1)).toBe(true)
  })
})

/** A carousel in a view of its own, as a designer splits one out of a screen. */
const CAROUSEL = `
struct Carousel: View {
    var body: some View {
        TabView {
            Color.red
            Color.green
        }
        .tabViewStyle(.page)
        .frame(height: 200)
    }
}
`

describe('the app\'s tabs', () => {
  it('are a root TabView in the page style, each page a screen of the gallery', () => {
    const r = run(`        TabView {
            Color.red
            Color.green
            Color.blue
        }
        .tabViewStyle(.page)`, '', true)
    expect(r.pages?.filter(p => p.kind === 'root').map(p => p.name)).toEqual(['Page 1', 'Page 2', 'Page 3'])
    // With no tab bar, its page fills the safe area, and its dots are over the page.
    const { root } = native.pager
    const page = frame(r, filled(r, [255, 56, 60])!)
    expect([page.y, page.y + page.height]).toEqual(root.page.y)
    const dots = nodes(r).filter(n => n.shape?.shape === 'circle')
    expect(dots.length).toBe(3)
    const dot = frame(r, dots[0]!)
    expect(Math.abs(dot.y + dot.height / 2 - root.dotCentreY)).toBeLessThan(0.5)
    const never = run(`        TabView {
            Color.red
            Color.green
        }
        .tabViewStyle(.page(indexDisplayMode: .never))`)
    expect(nodes(never).filter(n => n.shape?.shape === 'circle').length).toBe(0)
  })

  it('are any TabView not in the page style, wherever it is written', () => {
    const r = run(`        VStack {
            TabView {
                Text("Home").tabItem { Label("Home", systemImage: "house") }
                Text("Settings").tabItem { Label("Settings", systemImage: "gear") }
            }
        }`, '', true)
    expect(r.pages?.filter(p => p.kind === 'root').map(p => p.name)).toEqual(['Home', 'Settings'])
  })

  it('keep a carousel in a tab drawn in place, under the tab bar', () => {
    const r = run(`        TabView {
            VStack {
                Text("Featured")
                TabView {
                    Color.red
                    Color.green
                }
                .tabViewStyle(.page)
                .frame(height: 200)
            }
            .tabItem { Label("Home", systemImage: "house") }
            Text("Settings").tabItem { Label("Settings", systemImage: "gear") }
        }`, '', true)
    expect(r.pages?.filter(p => p.kind === 'root').map(p => p.name)).toEqual(['Home', 'Settings'])
    expect(texts(r)).toEqual(expect.arrayContaining(['Featured', 'Home', 'Settings']))
    expect(frame(r, filled(r, [255, 56, 60])!).height).toBeCloseTo(200, 1)
  })

  it('are a page-style TabView that is the body of a view the screen\'s root shows, in a Group or not', () => {
    for (const body of ['        Carousel()', '        Group { Carousel() }']) {
      expect(runSource(source(body) + CAROUSEL, true).pages?.map(p => p.name)).toEqual(['Page 1', 'Page 2'])
    }
  })

  it('are never one a helper draws, nor one more than three views down', () => {
    const helper = run('        pages', `    var pages: some View {
        TabView {
            Color.red
            Color.green
        }
        .tabViewStyle(.page)
        .frame(height: 200)
    }`, true)
    expect(helper.pages?.map(p => p.name)).toEqual(['Main page'])
    expect(frame(helper, filled(helper, [255, 56, 60])!).height).toBeCloseTo(200, 1)
    const deep = runSource(source('        Outer()') + CAROUSEL + `
struct Outer: View { var body: some View { Inner() } }
struct Inner: View { var body: some View { Carousel() } }
`, true)
    expect(deep.pages?.map(p => p.name)).toEqual(['Main page'])
  })

  it('are a page-style TabView in a Group at the screen\'s root', () => {
    const r = run(`        Group {
            TabView {
                Color.red
                Color.green
            }
            .tabViewStyle(.page)
        }`, '', true)
    expect(r.pages?.map(p => p.name)).toEqual(['Page 1', 'Page 2'])
  })

  it('leave a carousel view drawn in place between the views around it', () => {
    const r = runSource(source(`        NavigationStack {
            VStack {
                Text("Top")
                Carousel()
                Text("Bottom")
            }
            .navigationTitle("Home")
        }`) + CAROUSEL, true)
    expect(r.pages?.map(p => p.name)).toEqual(['Home'])
    expect(texts(r)).toEqual(expect.arrayContaining(['Top', 'Bottom']))
    expect(frame(r, filled(r, [255, 56, 60])!).height).toBeCloseTo(200, 1)
  })

  it('leave a carousel that is all of a navigation stack\'s screen under its bar', () => {
    const r = run(`        NavigationStack {
            TabView {
                Color.red
                Color.green
            }
            .tabViewStyle(.page)
            .navigationTitle("Tour")
        }`, '', true)
    expect(warnings(r)).toEqual([])
    expect(texts(r)).toContain('Tour')
    expect(r.pages?.map(p => p.name)).toEqual(['Tour'])
  })
})

describe('the Swift these apps are drawn from', () => {
  it.skipIf(!XCODE)('type-checks in Xcode 27', () => {
    const helper = source('        pages', '    var pages: some View {\n        TabView { Color.red; Color.green }\n            .tabViewStyle(.page)\n    }')
    typecheckInXcode([
      source('        Group { Carousel() }') + CAROUSEL,
      helper,
      source(pager(COLORED, '.tabViewStyle(PageTabViewStyle(indexDisplayMode: .never))')),
    ])
  }, 300_000)
})

describe('a carousel on the Design canvas', () => {
  const SOURCE = source(pager(`                Text("One")
                Text("Two")
                Text("Three")`))
  /** Where these words are written, as the canvas's selection names a view. */
  const at = (words: string) => ({ file: 'App.swift', start: SOURCE.indexOf(words), end: SOURCE.indexOf(words) + words.length })
  const design = () => {
    resetPipelineState()
    return compile({ files: [{ id: 'App.swift', text: SOURCE }], canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: revision++, allPages: true })
  }
  const page = (r: CompileResult) => r.pages!.find(p => p.kind === 'root')!
  const pageTexts = (r: CompileResult) => page(r).tree.nodes.flatMap(n => n.text?.runs.map(run => run.text) ?? [])

  it('selects the page shown with a click on it', () => {
    setMeasureTarget(null)
    const r = design()
    const one = page(r).tree.nodes.find(n => n.text?.runs[0]?.text === 'One')!
    const layer = layerForRenderNode(page(r).viewHierarchy ?? [], one)!
    expect(layer.type).toBe('Text')
    expect(SOURCE.slice(layer.source!.start, layer.source!.end)).toBe('Text("One")')
  })

  it('shows the page selected in Layers, and only there', () => {
    setMeasureTarget(at('Text("Three")'))
    const r = design()
    expect(pageTexts(r)).toEqual(['Welcome', 'Three', 'Continue'])
    expect(texts(r)).toEqual(['Welcome', 'One', 'Continue'])
    const dots = page(r).tree.nodes.filter(n => n.shape?.shape === 'circle')
    expect(dots.findIndex(n => n.shape?.fill?.kind === 'solid' && n.shape.fill.color.a === 1)).toBe(2)
    setMeasureTarget(null)
    expect(pageTexts(design())).toEqual(['Welcome', 'One', 'Continue'])
  })

  it('shows a newly selected page without a compile, and its own page when the selection ends', () => {
    setMeasureTarget(null)
    design()
    setMeasureTarget(at('Text("Two")'))
    expect(pageTexts(endLayerDraft(revision++))).toContain('Two')
    setMeasureTarget(at('Text("Welcome")'))
    expect(pageTexts(endLayerDraft(revision++))).toContain('One')
    setMeasureTarget(null)
  })
})

describe('a ScrollView that pages', () => {
  const scroll = (behavior: string, marker = '') => run(`        ScrollView(.horizontal) {
            HStack(spacing: 0) {
                ForEach(0..<3) { index in
                    Color.red
                        .containerRelativeFrame(.horizontal)
                }
            }${marker}
        }
        ${behavior}
        .frame(height: 200)`)
  const scroller = (r: CompileResult) => nodes(r).find(n => n.scroll)!

  it('snaps by its own width with .scrollTargetBehavior(.paging), as iOS 17 does', () => {
    const r = scroll('.scrollTargetBehavior(.paging)')
    expect(warnings(r)).toEqual([])
    expect(scroller(r).scroll).toMatchObject({ axis: 'horizontal', paging: true })
    // Each page is as wide as the scroll view, so a page's width is what a swipe moves.
    expect(frame(r, scroller(r)).width).toBe(native.scrollPaging.plain.swiped.x[1] - native.scrollPaging.plain.swiped.x[0])
    expect(scroller(r).scroll!.content.width).toBe(3 * 402)
  })

  it('scrolls freely otherwise, and under .viewAligned unless its stack is marked .scrollTargetLayout(), as iOS 27 does (Wave 6d)', () => {
    expect(scroller(scroll('')).scroll).not.toHaveProperty('paging')
    expect(scroller(scroll('')).scroll).not.toHaveProperty('snaps')
    const unmarked = scroll('.scrollTargetBehavior(.viewAligned)')
    expect(scroller(unmarked).scroll).not.toHaveProperty('paging')
    expect(scroller(unmarked).scroll).not.toHaveProperty('snaps')
    expect(warnings(unmarked)).toEqual([])
    // Marked, it rests at the start of each page-wide view, without a word.
    const marked = scroll('.scrollTargetBehavior(.viewAligned)', '\n            .scrollTargetLayout()')
    const page = native.scrollPaging.plain.swiped.x[1] - native.scrollPaging.plain.swiped.x[0]
    expect(scroller(marked).scroll!.snaps).toEqual([0, page, 2 * page])
    expect(scroller(marked).scroll).not.toHaveProperty('paging')
    expect(warnings(marked)).toEqual([])
  })
})

