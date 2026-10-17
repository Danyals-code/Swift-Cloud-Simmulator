import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, beginLayerDraft, compile, rerender, resetPipelineState, setMeasureTarget, updateLayerDraft } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import { node, project, screen as layerScreen, typecheckInXcode, XCODE } from './helpers/layer-project'
import { inert, worldFrame } from './render-geometry'

/**
 * Around the screen and iOS 27's chrome (Wave 6c), through `compile()`: views beside a
 * NavigationStack or a TabView, the search tab, toolbar spacers, the default search item,
 * GlassEffectContainer, the bottom accessory, subtitles, toolbar placements and the compact
 * popover, against what the iOS 27 simulator draws for tests/fixtures/ios27-chrome-6c.swift.
 */

const native = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-chrome/measurements.json', import.meta.url), 'utf8')).measured
const device = DEVICES['iphone-18-pro']
let revision = 1

/** The app a test draws: `body` as the root view's, beside `members`. */
const source = (body: string, members = '') =>
  `import SwiftUI\n\n@main\nstruct ProbeApp: App {\n    var body: some Scene {\n        WindowGroup { RootView() }\n    }\n}\n\nstruct RootView: View {\n${members}\n    var body: some View {\n${body}\n    }\n}\n`

/** Every app the tests draw, for Xcode 27 to type-check at the end. */
const drawnApps = new Set<string>()

function run(body: string, members = '', allPages = false): CompileResult {
  resetPipelineState()
  drawnApps.add(source(body, members))
  const result = compile({
    ...(allPages ? { allPages } : {}),
    files: [{ id: 'App.swift', text: source(body, members) }],
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
/** The text node drawing exactly these words. */
const text = (r: CompileResult, words: string) => nodes(r).find(n => n.text?.runs.map(run => run.text).join('') === words)
const textFrame = (r: CompileResult, words: string) => frame(r, text(r, words)!)
const middle = (f: { x: number; y: number; width: number; height: number }) => ({ x: f.x + f.width / 2, y: f.y + f.height / 2 })
const centre = (range: readonly number[]) => (range[0]! + range[1]!) / 2
/** The control a person would tap by this name. */
const control = (r: CompileResult, label: string) => nodes(r).find(n => n.hitTarget?.enabled && n.a11y?.label === label)
const warnings = (r: CompileResult) => r.diagnostics.filter(d => d.severity === 'warning').map(d => d.message)
/** The glass drawn between these heights, left to right, as [from, to] in x. */
const glass = (r: CompileResult, top: number, bottom: number) => nodes(r).filter(n => n.material).map(n => frame(r, n))
  .filter(f => f.y >= top - 1 && f.y + f.height <= bottom + 1).sort((a, b) => a.x - b.x).map(f => [f.x, f.x + f.width])
/** How far apart two [from, to] ranges are, edge by edge, at most. */
const apart = (a: readonly number[], b: readonly number[]) => Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!))
const placeholders = (r: CompileResult) => nodes(r).filter(n => n.placeholder)
/** Taps the control by its name, then draws again. */
function tap(label: string): CompileResult {
  const target = nodes(last!).find(n => n.hitTarget?.enabled && n.a11y?.label === label)!
  applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return last = rerender(revision++)
}
let last: CompileResult | undefined

/** The bands the top and the bottom bars' glass is drawn in, as measured. */
const TOP_BAR = native.spacers.fixedTop.y as [number, number]
const BOTTOM_BAR = native.spacers.flexibleBottom.y as [number, number]

describe('a search tab', () => {
  it('is an ordinary item at the end of the bar, labelled Search with a magnifying glass', () => {
    const r = run(`        TabView {
            Tab("Home", systemImage: "house") { Text("Home page") }
            Tab("Library", systemImage: "books.vertical") { Text("Library page") }
            Tab(role: .search) { Text("Search page") }
        }`)
    const { twoTabs } = native.searchTab
    const bar = frame(r, nodes(r).find(n => n.id === 'tabbar-surface-material')!)
    expect(apart([bar.x, bar.x + bar.width], twoTabs.bar.x)).toBeLessThan(2)
    const search = control(r, 'Search')!, library = control(r, 'Library')!
    expect(frame(r, search).x).toBeGreaterThan(frame(r, library).x)
    expect(Math.abs(frame(r, search).width - frame(r, library).width)).toBeLessThan(0.5)
    expect(nodes(r).some(n => n.image?.symbol === 'magnifyingglass')).toBe(true)
    expect(nodes(r).some(n => n.a11y?.label === '_TabItem')).toBe(false)
    last = r
    expect(text(tap('Search'), 'Search page')).toBeDefined()
  })

  it('keeps a label written for it', () => {
    const r = run(`        TabView {
            Tab("Home", systemImage: "house") { Text("Home page") }
            Tab("Find", systemImage: "sparkle.magnifyingglass", role: .search) { Text("Find page") }
        }`)
    expect(control(r, 'Find')).toBeDefined()
    expect(control(r, 'Search')).toBeUndefined()
  })

  it('leaves a bar without one as it was', () => {
    const r = run(`        TabView {
            Tab("Home", systemImage: "house") { Text("Home page") }
            Tab("Library", systemImage: "books.vertical") { Text("Library page") }
            Tab("Radio", systemImage: "dot.radiowaves.left.and.right") { Text("Radio page") }
        }`)
    expect(control(r, 'Search')).toBeUndefined()
    const bar = frame(r, nodes(r).find(n => n.id === 'tabbar-surface-material')!)
    expect(apart([bar.x, bar.x + bar.width], native.searchTab.twoTabs.bar.x)).toBeLessThan(2)
  })

  it('makes three tabs and a search tab as wide as measured, as four tabs are', () => {
    const tabs = (last: string) => run(`        TabView {
            Tab("Home", systemImage: "house") { Text("Home page") }
            Tab("Library", systemImage: "books.vertical") { Text("Library page") }
            Tab("Radio", systemImage: "dot.radiowaves.left.and.right") { Text("Radio page") }
            ${last}
        }`)
    for (const r of [tabs('Tab(role: .search) { Text("Search page") }'), tabs('Tab("New", systemImage: "sparkles") { Text("New page") }')]) {
      const bar = frame(r, nodes(r).find(n => n.id === 'tabbar-surface-material')!)
      expect(apart([bar.x, bar.x + bar.width], native.searchTab.threeTabs.bar.x)).toBeLessThan(1)
    }
  })
})

describe('toolbar spacers', () => {
  it('split the trailing items into two capsules with a fixed spacer', () => {
    const r = run(`        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Spacers")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Share", systemImage: "square.and.arrow.up") { }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Edit", systemImage: "pencil") { }
                    }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Add", systemImage: "plus") { }
                    }
                }
        }`)
    const groups = glass(r, ...TOP_BAR), { fixedTop } = native.spacers
    expect(groups).toHaveLength(2)
    // Two groups the gap measured apart, the second a circle at the trailing edge. The first is
    // as wide as a group of two icons is drawn anywhere in the bar (Wave 4b), within 4.5.
    expect(Math.abs(groups[1]![0]! - groups[0]![1]! - fixedTop.gap)).toBeLessThan(0.5)
    expect(apart(groups[1]!, fixedTop.groups[1])).toBeLessThan(1)
    expect(apart(groups[0]!, fixedTop.groups[0])).toBeLessThan(4.5)
    expect(placeholders(r)).toEqual([])
  })

  it('push groups to the bottom bar\'s edges when flexible, and split them when fixed', () => {
    const r = run(`        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Spacers")
                .toolbar {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Filter", systemImage: "line.3.horizontal.decrease") { }
                    }
                    ToolbarSpacer(.flexible, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        Button("Share", systemImage: "square.and.arrow.up") { }
                    }
                    ToolbarSpacer(.fixed, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        Button("Add", systemImage: "plus") { }
                    }
                }
        }`)
    const groups = glass(r, ...BOTTOM_BAR)
    expect(groups).toHaveLength(3)
    native.spacers.flexibleBottom.groups.forEach((group: number[], i: number) => expect(apart(groups[i]!, group)).toBeLessThan(2))
    expect(Math.abs(groups[2]![0]! - groups[1]![1]! - native.spacers.flexibleBottom.gap)).toBeLessThan(0.5)
    expect(placeholders(r)).toEqual([])
  })

  it('takes flexible as the default sizing', () => {
    const r = run(`        NavigationStack {
            List { Text("First row") }
                .toolbar {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Filter", systemImage: "line.3.horizontal.decrease") { }
                    }
                    ToolbarSpacer(placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        Button("Add", systemImage: "plus") { }
                    }
                }
        }`)
    const groups = glass(r, ...BOTTOM_BAR), { flexibleBottom } = native.spacers
    expect(groups).toHaveLength(2)
    expect(apart(groups[0]!, flexibleBottom.groups[0])).toBeLessThan(1.5)
    expect(apart(groups[1]!, flexibleBottom.groups[2])).toBeLessThan(1.5)
  })
})

describe('the default search item', () => {
  const screen = (items: string) => `        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Notes")
                .searchable(text: $query)
                .toolbar {
${items}
                }
        }`
  const members = '    @State private var query = ""'

  it('puts the search field across the bottom bar, and none under the title', () => {
    const r = run(screen('                    DefaultToolbarItem(kind: .search, placement: .bottomBar)'), members)
    const fields = glass(r, ...BOTTOM_BAR)
    expect(fields).toHaveLength(1)
    expect(apart(fields[0]!, native.defaultSearch.alone.field)).toBeLessThan(1.5)
    // One field, in the bar: none in the title's drawer, where a bottom bar puts it otherwise.
    expect(nodes(r).filter(n => n.hitTarget?.role === 'textField').map(n => middle(frame(r, n)).y > 790)).toEqual([true])
    expect(placeholders(r)).toEqual([])
    const plain = run(`        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Notes")
        }`)
    expect(Math.abs(textFrame(r, 'First row').y - textFrame(plain, 'First row').y)).toBeLessThan(0.5)
  })

  it('fills the space between the items around it', () => {
    const r = run(screen(`                    ToolbarItem(placement: .bottomBar) {
                        Button("Filter", systemImage: "line.3.horizontal.decrease") { }
                    }
                    ToolbarSpacer(.flexible, placement: .bottomBar)
                    DefaultToolbarItem(kind: .search, placement: .bottomBar)
                    ToolbarSpacer(.flexible, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        Button("New", systemImage: "square.and.pencil") { }
                    }`), members)
    const groups = glass(r, ...BOTTOM_BAR), { withButtons } = native.defaultSearch
    expect(groups).toHaveLength(3)
    expect(apart(groups[0]!, withButtons.filter)).toBeLessThan(1.5)
    expect(apart(groups[1]!, withButtons.field)).toBeLessThan(1.5)
    expect(apart(groups[2]!, withButtons.compose)).toBeLessThan(1.5)
  })

  it('draws nothing in another placement, and no placeholder', () => {
    const r = run(screen('                    DefaultToolbarItem(kind: .search, placement: .topBarTrailing)'), members)
    expect(placeholders(r)).toEqual([])
    expect(glass(r, ...TOP_BAR)).toEqual([])
  })
})

describe('GlassEffectContainer', () => {
  it('lays out what it holds as a centred VStack', () => {
    const r = run(`        VStack(spacing: 20) {
            GlassEffectContainer {
                Text("First")
                Text("Second")
            }
            GlassEffectContainer(spacing: 20) {
                HStack(spacing: 20) {
                    Image(systemName: "pencil")
                        .frame(width: 44, height: 44)
                        .glassEffect()
                    Image(systemName: "eraser")
                        .frame(width: 44, height: 44)
                        .glassEffect()
                }
            }
        }`)
    expect(placeholders(r)).toEqual([])
    const first = textFrame(r, 'First'), second = textFrame(r, 'Second')
    expect(Math.abs(middle(first).x - middle(second).x)).toBeLessThan(0.5)
    expect(second.y).toBeGreaterThan(first.y + first.height - 0.5)
    const pencil = frame(r, nodes(r).find(n => n.image?.symbol === 'pencil')!), eraser = frame(r, nodes(r).find(n => n.image?.symbol === 'eraser')!)
    expect(Math.abs(middle(eraser).x - middle(pencil).x - 64)).toBeLessThan(0.5)
  })
})

describe('a navigation subtitle', () => {
  const screen = (mode: string, subtitle = '.navigationSubtitle("3 unread")') => `        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Inbox")
                ${subtitle}
                .navigationBarTitleDisplayMode(${mode})
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Edit") { }
                    }
                }
        }`

  it('goes under the inline title, the two centred on the bar\'s row', () => {
    const r = run(screen('.inline'))
    const { inline } = native.subtitle
    const title = middle(textFrame(r, 'Inbox')), subtitle = middle(textFrame(r, '3 unread'))
    expect(Math.abs(title.x - centre(inline.title.ink.x))).toBeLessThan(1.5)
    expect(Math.abs(title.y - centre(inline.title.ink.y))).toBeLessThan(1.5)
    expect(Math.abs(subtitle.x - centre(inline.subtitle.ink.x))).toBeLessThan(1.5)
    expect(Math.abs(subtitle.y - centre(inline.subtitle.ink.y))).toBeLessThan(1.5)
    expect(Math.abs(textFrame(r, '3 unread').width - (inline.subtitle.ink.x[1] - inline.subtitle.ink.x[0]))).toBeLessThan(3)
    const plain = run(screen('.inline', ''))
    expect(Math.abs(textFrame(r, 'First row').y - textFrame(plain, 'First row').y)).toBeLessThan(0.5)
    expect(warnings(r).filter(w => w.includes('navigationSubtitle'))).toEqual([])
  })

  it('goes under the large title, and moves the content down', () => {
    const r = run(screen('.large'))
    const { large } = native.subtitle
    const subtitle = frame(r, nodes(r).find(n => n.id === 'navbar-large-subtitle')!)
    expect(Math.abs(subtitle.x - large.subtitle.ink.x[0])).toBeLessThan(1.5)
    expect(Math.abs(middle(subtitle).y - centre(large.subtitle.ink.y))).toBeLessThan(1.5)
    const plain = run(screen('.large', ''))
    expect(Math.abs(textFrame(r, 'First row').y - textFrame(plain, 'First row').y - (large.row.y - large.row.without))).toBeLessThan(1)
    const title = nodes(r).find(n => n.id === 'navbar-large-title')!, plainTitle = nodes(plain).find(n => n.id === 'navbar-large-title')!
    expect(Math.abs(frame(r, title).y - frame(plain, plainTitle).y - (large.title.ink.y[0] - large.plainTitle.ink.y[0]))).toBeLessThan(1)
  })
})

describe('toolbar placements', () => {
  it('puts .navigation leading, .primaryAction trailing, and .secondaryAction in a menu after it', () => {
    const r = run(`        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Places")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigation) {
                        Button("Sidebar", systemImage: "sidebar.left") { }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button("Add", systemImage: "plus") { }
                    }
                    ToolbarItem(placement: .secondaryAction) {
                        Button("Duplicate", systemImage: "plus.square.on.square") { }
                    }
                    ToolbarItem(placement: .secondaryAction) {
                        Button("Archive", systemImage: "archivebox") { }
                    }
                }
        }`)
    const groups = glass(r, ...TOP_BAR), { navigation, primaryWithSecondary } = native.placements
    expect(groups).toHaveLength(2)
    expect(apart(groups[0]!, navigation.x)).toBeLessThan(1.5)
    // As wide as a group of two icons is drawn anywhere in the bar (Wave 4b), within 4.5.
    expect(apart(groups[1]!, primaryWithSecondary.x)).toBeLessThan(4.5)
    expect(nodes(r).some(n => n.image?.symbol === 'ellipsis')).toBe(true)
    // The secondary items are behind the ellipsis, in its menu.
    expect(control(r, 'Duplicate')).toBeUndefined()
    last = r
    const opened = tap('More')
    expect(text(opened, 'Duplicate')).toBeDefined()
    expect(text(opened, 'Archive')).toBeDefined()
  })

  it('draws .confirmationAction trailing with a semibold title, and .cancellationAction leading', () => {
    const r = run(`        NavigationStack {
            Form { Text("Ada") }
                .navigationTitle("Edit")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { }
                    }
                }
        }`)
    const groups = glass(r, ...TOP_BAR), { confirmation } = native.placements
    expect(apart(groups[0]!, confirmation.cancel)).toBeLessThan(2)
    expect(apart(groups[1]!, confirmation.done)).toBeLessThan(2)
    expect(text(r, 'Done')!.text!.runs[0]!.font.weight).toBe(600)
    expect(text(r, 'Cancel')!.text!.runs[0]!.font.weight).not.toBe(600)
  })

  it('centres .status in the bottom bar in a capsule of its own, a bottom bar item at the leading edge', () => {
    const r = run(`        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Mail")
                .toolbar {
                    ToolbarItem(placement: .status) {
                        Text("Updated just now")
                            .font(.caption)
                    }
                    ToolbarItem(placement: .bottomBar) {
                        Button("Compose", systemImage: "square.and.pencil") { }
                    }
                }
        }`)
    const groups = glass(r, ...BOTTOM_BAR), { status } = native.placements
    expect(groups).toHaveLength(2)
    expect(apart(groups[0]!, status.compose)).toBeLessThan(1.5)
    expect(Math.abs(centre(groups[1]!) - centre(status.capsule))).toBeLessThan(1)
    expect(Math.abs(groups[1]![1]! - groups[1]![0]! - (status.capsule[1] - status.capsule[0]))).toBeLessThan(4)
    expect(Math.abs(middle(textFrame(r, 'Updated just now')).x - centre(status.textInk))).toBeLessThan(1)
  })

  it('draws .status alone, centred', () => {
    const r = run(`        NavigationStack {
            List { Text("First row") }
                .toolbar {
                    ToolbarItem(placement: .status) {
                        Text("Updated just now")
                    }
                }
        }`)
    const groups = glass(r, ...BOTTOM_BAR)
    expect(groups).toHaveLength(1)
    expect(Math.abs(centre(groups[0]!) - 201)).toBeLessThan(1)
  })
})

describe('a bottom accessory', () => {
  const tabs = (search: boolean) => `        TabView {
            Tab("Home", systemImage: "house") { VStack { Spacer(); Text("Page end") } }
            Tab("Library", systemImage: "books.vertical") { Text("Library page") }
            ${search ? 'Tab(role: .search) { Text("Search page") }' : 'Tab("Radio", systemImage: "dot.radiowaves.left.and.right") { Text("Radio page") }'}
        }
        .tabViewBottomAccessory {
            HStack {
                Image(systemName: "music.note")
                Text("Now Playing")
                Spacer()
                Image(systemName: "play.fill")
            }
            .padding(.horizontal)
        }`

  it('is a glass capsule above the tab bar, the bar as wide as it, the page ending at its top', () => {
    for (const search of [false, true]) {
      const r = run(tabs(search))
      const { capsule, bar, content } = native.accessory
      const accessory = glass(r, capsule.y[0], capsule.y[1])
      expect(accessory).toHaveLength(1)
      expect(apart(accessory[0]!, capsule.x)).toBeLessThan(1)
      const surface = nodes(r).filter(n => n.material).map(n => frame(r, n)).find(f => Math.abs(f.y - capsule.y[0]) < 1)!
      expect(Math.abs(surface.height - capsule.height)).toBeLessThan(0.5)
      const tabBar = frame(r, nodes(r).find(n => n.id === 'tabbar-surface-material')!)
      expect(apart([tabBar.x, tabBar.x + tabBar.width], bar.x)).toBeLessThan(1)
      expect(Math.abs(tabBar.y - bar.y[0])).toBeLessThan(1)
      const playing = textFrame(r, 'Now Playing')
      expect(Math.abs(middle(playing).y - centre(capsule.y))).toBeLessThan(1)
      const note = frame(r, nodes(r).find(n => n.image?.symbol === 'music.note')!)
      expect(Math.abs(note.x - content.x[0] - 16)).toBeLessThan(1.5)
      // The page ends as much higher than without one as measured (791, the bar's top, to 735).
      const end = textFrame(r, 'Page end'), without = textFrame(run(tabs(search).replace(/\.tabViewBottomAccessory[^]*$/, '')), 'Page end')
      expect(Math.abs(without.y - end.y - (bar.y[0] - native.accessory.page.y[1]))).toBeLessThan(1)
      expect(warnings(r).filter(w => w.includes('tabViewBottomAccessory'))).toEqual([])
    }
  })
})

describe('views beside a NavigationStack', () => {
  it('draws a floating button in a ZStack over the screen and its bars, and runs its action', () => {
    const r = run(`        ZStack(alignment: .bottomTrailing) {
            NavigationStack {
                List {
                    Text("First row")
                    Text("Added \\(added)")
                }
                .navigationTitle("Notes")
            }
            Button {
                added += 1
            } label: {
                Image(systemName: "plus")
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(.blue))
            }
            .padding(20)
        }`, '    @State private var added = 0')
    const { floatingButton } = native.beside
    const button = frame(r, nodes(r).find(n => n.image?.symbol === 'plus')!)
    expect(Math.abs(middle(button).x - (floatingButton.button[0] + floatingButton.button[2] / 2))).toBeLessThan(1)
    expect(Math.abs(middle(button).y - (floatingButton.button[1] + floatingButton.button[3] / 2))).toBeLessThan(1)
    expect(Math.abs(textFrame(r, 'First row').y - (floatingButton.row - 0))).toBeLessThan(3)
    expect(warnings(r).filter(w => /not drawn|isn't drawn/.test(w))).toEqual([])
    const target = nodes(r).find(n => n.hitTarget?.enabled && frame(r, n).x > 300 && frame(r, n).y > 700)!
    expect(target.z).toBeGreaterThan(nodes(r).find(n => n.id === 'navbar-title' || n.id === 'navbar-large-title')!.z)
    applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    expect(text(rerender(revision++), 'Added 1')).toBeDefined()
  })

  it('keeps a floating button\'s name, a Label drawn as its icon', () => {
    const r = run(`        ZStack(alignment: .bottomTrailing) {
            NavigationStack {
                List { Text("Added \\(added)") }
                    .navigationTitle("Lists")
            }
            Button("Add", systemImage: "plus") { added += 1 }
                .labelStyle(.iconOnly)
                .font(.title2)
                .foregroundStyle(.white)
                .padding()
                .background(.blue, in: .circle)
                .padding()
        }`, '    @State private var added = 0')
    const add = control(r, 'Add')!
    expect(middle(frame(r, add)).x).toBeGreaterThan(device.width * 0.75)
    expect(middle(frame(r, add)).y).toBeGreaterThan(device.height * 0.8)
    last = r
    expect(text(tap('Add'), 'Added 1')).toBeDefined()
  })

  it('gives a view in a VStack under it its own height, the stack laid out above', () => {
    const r = run(`        VStack(spacing: 0) {
            NavigationStack {
                List { Text("First row") }
                    .navigationTitle("Music")
            }
            HStack {
                Text("Now Playing")
                Spacer()
            }
            .padding(.horizontal)
            .frame(height: 64)
        }`)
    const { navPlayer } = native.beside
    expect(Math.abs(middle(textFrame(r, 'Now Playing')).y - centre(navPlayer.player.y))).toBeLessThan(1)
    expect(Math.abs(textFrame(r, 'First row').y - textFrame(run(`        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Music")
        }`), 'First row').y)).toBeLessThan(0.5)
  })

  it('draws an overlay on the stack over its bar, aligned in the safe area', () => {
    const r = run(`        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Inbox")
        }
        .overlay(alignment: .top) {
            Text("Saved")
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Capsule().fill(.green))
        }`)
    const { navToast } = native.beside
    const saved = text(r, 'Saved')!
    const toast = frame(r, saved)
    expect(Math.abs(middle(toast).x - (navToast.toast[0] + navToast.toast[2] / 2))).toBeLessThan(1)
    expect(Math.abs(middle(toast).y - (navToast.toast[1] + navToast.toast[3] / 2))).toBeLessThan(1)
    expect(saved.z).toBeGreaterThan(nodes(r).find(n => n.id === 'navbar-large-title')!.z)
    expect(warnings(r).filter(w => /not drawn|isn't drawn/.test(w))).toEqual([])
  })
})

describe('views beside a container the preview still leaves out', () => {
  it('warns of a view beside a stack inside a tab\'s page', () => {
    const r = run(`        TabView {
            ZStack(alignment: .bottomTrailing) {
                NavigationStack { Text("Home") }
                Button("New") { }
            }
            .tabItem { Label("Home", systemImage: "house") }
        }`)
    expect(warnings(r).filter(w => w.includes('beside the NavigationStack'))).toHaveLength(1)
  })
})

describe('views beside a TabView', () => {
  it('moves the tab bar up over a view in a VStack under it', () => {
    const r = run(`        VStack(spacing: 0) {
            TabView {
                Tab("Home", systemImage: "house") { Text("Home page") }
                Tab("Library", systemImage: "books.vertical") { Text("Library page") }
            }
            HStack {
                Text("Now Playing")
                Spacer()
            }
            .padding(.horizontal)
            .frame(height: 64)
        }`)
    const { tabsPlayer } = native.beside
    const bar = frame(r, nodes(r).find(n => n.id === 'tabbar-surface-material')!)
    expect(Math.abs(bar.y - tabsPlayer.bar.y[0])).toBeLessThan(1)
    expect(Math.abs(bar.y + bar.height - tabsPlayer.bar.y[1])).toBeLessThan(1)
    expect(Math.abs(middle(textFrame(r, 'Now Playing')).y - centre(tabsPlayer.player.y))).toBeLessThan(1)
    expect(middle(textFrame(r, 'Home page')).y).toBeLessThan(centre([62, 693]) + 1)
    expect(control(r, 'Library')).toBeDefined()
  })

  it('draws a capsule in a ZStack over it, the bar where it was', () => {
    const r = run(`        ZStack(alignment: .bottom) {
            TabView {
                Tab("Home", systemImage: "house") { Text("Home page") }
                Tab("Library", systemImage: "books.vertical") { Text("Library page") }
            }
            Text("Offline")
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Capsule().fill(.orange))
                .padding(.bottom, 100)
        }`)
    const { tabsCapsule } = native.beside
    const bar = frame(r, nodes(r).find(n => n.id === 'tabbar-surface-material')!)
    expect(Math.abs(bar.y - tabsCapsule.bar.y[0])).toBeLessThan(1)
    expect(Math.abs(middle(textFrame(r, 'Offline')).y - (tabsCapsule.capsule[1] + tabsCapsule.capsule[3] / 2))).toBeLessThan(1)
  })
})

describe('a compact popover', () => {
  const screen = (inset: number, atTop: boolean) => `        VStack {
            ${atTop ? '' : 'Spacer()'}
            Button("Details") { shown = true }
                .popover(isPresented: $shown) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Ada Lovelace").font(.headline)
                        Text("First programmer")
                    }
                    .padding()
                    .presentationCompactAdaptation(.popover)
                }
            ${atTop ? 'Spacer()' : ''}
        }
        .padding(.vertical, ${inset})`
  const members = '    @State private var shown = true'

  for (const [name, inset, atTop] of [['top', 120, true], ['bottom', 120, false], ['below', 8, true]] as const) {
    it(`draws a bubble its content's size, with an arrow at its source (${name})`, () => {
      const r = run(screen(inset, atTop), members)
      const measured = native.popover[name]
      const source = textFrame(r, 'Details')
      expect(Math.abs(middle(source).y - (measured.source[1] + measured.source[3] / 2))).toBeLessThan(1)
      const title = textFrame(r, 'Ada Lovelace'), body = textFrame(r, 'First programmer')
      // The content at its own size, centred over the source, on the side measured.
      expect(Math.abs(title.x - (measured.content[0] + 16))).toBeLessThan(2)
      expect(Math.abs(title.y - (measured.content[1] + 16))).toBeLessThan(2)
      expect(Math.abs(body.y + body.height - (measured.content[1] + measured.content[3] - 16))).toBeLessThan(2)
      // The arrow's tip on the source's edge, on its middle.
      const arrow = frame(r, nodes(r).find(n => n.id === 'overlay-popover-arrow')!)
      expect(Math.abs((measured.side === 'above' ? arrow.y + arrow.height : arrow.y) - measured.arrowTip)).toBeLessThan(1.5)
      expect(Math.abs(middle(arrow).x - (measured.source[0] + measured.source[2] / 2))).toBeLessThan(1)
      // Not a sheet: the screen behind isn't dimmed.
      expect(nodes(r).some(n => n.frame.width >= device.width && n.frame.height >= device.height && n.background?.kind === 'solid' && n.background.color.a > 0 && n.background.color.a < 1 && n.background.color.r === 0)).toBe(false)
      expect(warnings(r).filter(w => w.includes('presentationCompactAdaptation'))).toEqual([])
    })
  }

  it('stays a sheet without the adaptation', () => {
    const r = run(`        Button("Details") { shown = true }
            .popover(isPresented: $shown) {
                Text("Ada Lovelace")
            }`, '    @State private var shown = true')
    expect(textFrame(r, 'Ada Lovelace').width).toBeLessThan(device.width)
    expect(inert(nodes(r), control(r, 'Details') ?? nodes(r).find(n => n.a11y?.label === 'Details')!)).toBe(true)
  })
})

describe('presentations over a screen with views beside its container', () => {
  const stack = (beside: boolean, content: string) => `        ZStack(alignment: .bottomTrailing) {
            NavigationStack {
${content}
                .navigationTitle("Notes")
                .navigationBarTitleDisplayMode(.inline)
            }
            ${beside ? 'Button("Add", systemImage: "plus") { }\n                .labelStyle(.iconOnly)\n                .padding(24)' : ''}
        }`

  it('puts a compact popover beside its source, as without them', () => {
    const popover = `                VStack {
                    Button("Details") { shown = true }
                        .popover(isPresented: $shown) {
                            Text("Ada Lovelace")
                                .padding()
                                .presentationCompactAdaptation(.popover)
                        }
                    Spacer()
                }`
    const members = '    @State private var shown = true'
    const alone = run(stack(false, popover), members), beside = run(stack(true, popover), members)
    const arrow = (r: CompileResult) => frame(r, nodes(r).find(n => n.id === 'overlay-popover-arrow')!)
    // Under the source, near the top, not centred on the screen.
    expect(arrow(alone).y).toBeLessThan(200)
    expect(Math.abs(arrow(beside).y - arrow(alone).y)).toBeLessThan(0.5)
    expect(Math.abs(textFrame(beside, 'Ada Lovelace').y - textFrame(alone, 'Ada Lovelace').y)).toBeLessThan(0.5)
  })

  it('opens a row\'s context menu under the row, as without them', () => {
    const rows = `                List {
                    Text("First row")
                        .contextMenu { Button("Copy") { } }
                    Text("Second row")
                }`
    const opened = (beside: boolean) => {
      const r = run(stack(beside, rows))
      const hit = nodes(r).find(n => n.hitTarget?.contextMenuHandlerId)!.hitTarget!
      applyEvent({ kind: 'tap', handlerId: hit.contextMenuHandlerId!, location: { x: 1, y: 1 } })
      return rerender(revision++)
    }
    const alone = opened(false), beside = opened(true)
    expect(textFrame(alone, 'Copy').y).toBeLessThan(400)
    expect(Math.abs(textFrame(beside, 'Copy').y - textFrame(alone, 'Copy').y)).toBeLessThan(0.5)
  })
})

describe('selecting a view on a screen with views beside its container', () => {
  /** The page compiled with the `index`th `name` selected, and that view's one place. */
  function selected(body: string, name: string, index = 0) {
    resetPipelineState()
    const files = project(layerScreen(body))
    drawnApps.add(files[0]!.text)
    setMeasureTarget(node(files, name, index).source)
    const result = compile({ files, canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: revision++ })
    setMeasureTarget(null)
    expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
    expect(result.geometry?.instances).toHaveLength(1)
    return { result, view: result.geometry!.instances[0]! }
  }
  /** Where the canvas outlines the view: its content, from the anchor's place on the screen. */
  const outlined = ({ result, view }: ReturnType<typeof selected>) => {
    const tree = result.renderTree!.nodes, anchor = tree.find(n => n.id === view.anchor)!
    const space = anchor.parent ? worldFrame(tree, tree.find(n => n.id === anchor.parent)!) : { x: 0, y: 0 }
    return { ...view.content, x: view.content.x + space.x, y: view.content.y + space.y }
  }
  const at = (r: CompileResult, words: string) => textFrame(r, words)
  const same = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => {
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[key] - b[key])).toBeLessThan(0.5)
  }
  const header = `        VStack(spacing: 0) {
            Text("Header")
                .frame(height: 44)
            NavigationStack {
                Text("Body")
            }
        }`

  it('outlines a floating button and a header beside the stack where they are drawn', () => {
    const fab = selected(`        ZStack(alignment: .bottomTrailing) {
            NavigationStack {
                List { Text("First row") }
            }
            Button("Add") { }
                .padding(24)
        }`, 'Button')
    same(outlined(fab), at(fab.result, 'Add'))
    const top = selected(header, 'Text', 0)
    same(outlined(top), at(top.result, 'Header'))
  })

  it('outlines a view in a stack below a header, or beside a view, where it is drawn', () => {
    const below = selected(header, 'Text', 1)
    expect(at(below.result, 'Body').y).toBeGreaterThan(device.safeArea.top + 44)
    same(outlined(below), at(below.result, 'Body'))
    const after = selected(`        HStack(spacing: 0) {
            Color.blue
                .frame(width: 80)
            NavigationStack {
                Text("Body")
            }
        }`, 'Text')
    expect(at(after.result, 'Body').x).toBeGreaterThan(80)
    same(outlined(after), at(after.result, 'Body'))
  })

  it('draws a drag\'s values on a view beside the stack', () => {
    const files = project(layerScreen(header))
    resetPipelineState()
    const request = { files, canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light' as const, revision: revision++ }
    const before = textFrame(compile(request), 'Header')
    beginLayerDraft(node(files, 'Text', 0).source, revision)
    const dragged = updateLayerDraft({ padding: { top: 20, leading: 0, bottom: 0, trailing: 0 } }, revision++)
    setMeasureTarget(null)
    expect(Math.abs(textFrame(dragged, 'Header').y - before.y - 10)).toBeLessThan(0.5)
  })
})

describe('honest drawing of what is written', () => {
  it('draws no bottom accessory when it isn\'t enabled', () => {
    const r = run(`        TabView {
            Tab("Home", systemImage: "house") { Text("Home page") }
            Tab("Library", systemImage: "books.vertical") { Text("Library page") }
            Tab(role: .search) { Text("Search page") }
        }
        .tabViewBottomAccessory(isEnabled: false) {
            Text("Now Playing")
        }`)
    expect(text(r, 'Now Playing')).toBeUndefined()
    const bar = frame(r, nodes(r).find(n => n.id === 'tabbar-surface-material')!)
    expect(apart([bar.x, bar.x + bar.width], native.searchTab.twoTabs.bar.x)).toBeLessThan(2)
  })

  it('draws a subtitle written as a Text', () => {
    const r = run(`        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Inbox")
                .navigationSubtitle(Text("3 unread"))
                .navigationBarTitleDisplayMode(.inline)
        }`)
    const { inline } = native.subtitle
    expect(Math.abs(middle(textFrame(r, '3 unread')).y - centre(inline.subtitle.ink.y))).toBeLessThan(1.5)
  })

  it('says when it can\'t read a subtitle\'s words', () => {
    const r = run(`        NavigationStack {
            List { Text("First row") }
                .navigationTitle("Inbox")
                .navigationSubtitle(Text(Date.now, style: .date))
        }`)
    expect(warnings(r).filter(w => w.includes('.navigationSubtitle') && w.includes("can't read"))).toHaveLength(1)
  })
})

describe.skipIf(!XCODE)('the apps drawn here, in Xcode 27', () => {
  it('type-check, warnings as errors', () => typecheckInXcode([...drawnApps]), 300_000)
})
