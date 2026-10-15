import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CompileResult, RenderNode, ViewLayer } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import { inert, worldFrame } from './render-geometry'
import { XCODE, typecheckInXcode } from './helpers/layer-project'
import { layerForRenderNode } from '../apps/web/lib/layers'

/**
 * Toolbar items in place of the title and in a bottom bar, a tab bar hidden from a tab,
 * ContentUnavailableView's search and closure forms, and sheets drawn over the screen that
 * opens them on the Design canvas (Wave 4b), through `compile()`, against what the iOS 27
 * simulator draws for tests/fixtures/ios27-system-ui-4b.swift.
 */

const native = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-system-ui/measurements.json', import.meta.url), 'utf8')).measured
const device = DEVICES['iphone-18-pro']
let revision = 1
/** The file last compiled, for what a layer's source span holds. */
let written = ''

/** The app a test draws: `body` as the root view's, beside `members`, with `extra` after it. */
const source = (body: string, members = '', extra = '') =>
  `import SwiftUI\n\n@main\nstruct ProbeApp: App {\n    var body: some Scene {\n        WindowGroup { RootView() }\n    }\n}\n\nstruct RootView: View {\n${members}\n    var body: some View {\n${body}\n    }\n}\n${extra}`

function run(body: string, members = '', allPages = false, extra = ''): CompileResult {
  resetPipelineState()
  const result = compile({
    ...(allPages ? { allPages } : {}),
    files: [{ id: 'App.swift', text: written = source(body, members, extra) }],
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
const middle = (f: { x: number; y: number; width: number; height: number }) => ({ x: f.x + f.width / 2, y: f.y + f.height / 2 })
/** The middle of what was measured in the simulator, from an ink range. */
const centre = (range: readonly number[]) => (range[0]! + range[1]!) / 2
/** The control a person would tap by this name. */
const control = (r: CompileResult, label: string) => nodes(r).find(n => n.hitTarget?.enabled && n.a11y?.label === label)
/** The layer of each kind, depth first. */
const layersOf = (r: CompileResult, type: string): ViewLayer[] => {
  const found: ViewLayer[] = []
  const visit = (layer: ViewLayer) => { if (layer.type === type) found.push(layer); layer.children.forEach(visit) }
  r.viewHierarchy?.forEach(visit)
  return found
}
/** Whether a click on the node finds this layer, as the Design canvas finds one. */
const finds = (r: CompileResult, node: RenderNode, layer: ViewLayer) => layerForRenderNode(r.viewHierarchy ?? [], node)?.id === layer.id
const warnings = (r: CompileResult) => r.diagnostics.filter(d => d.severity === 'warning').map(d => d.message)

describe('a principal toolbar item', () => {
  it('takes the inline title\'s place, centred in the bar\'s row', () => {
    const r = run(`        NavigationStack {
            List {
                Text("First row")
            }
            .navigationTitle("Mail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 0) {
                        Text("Inbox")
                            .font(.headline)
                        Text("3 unread")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") { }
                }
            }
        }`)
    const { inline } = native.toolbar.principal
    expect(text(r, 'Mail')).toBeUndefined()
    const title = middle(frame(r, text(r, 'Inbox')!)), subtitle = middle(frame(r, text(r, '3 unread')!))
    expect(Math.abs(title.x - centre(inline.title.ink.x))).toBeLessThan(1.5)
    expect(Math.abs(title.y - centre(inline.title.ink.y))).toBeLessThan(1.5)
    expect(Math.abs(subtitle.x - centre(inline.subtitle.ink.x))).toBeLessThan(1.5)
    expect(Math.abs(subtitle.y - centre(inline.subtitle.ink.y))).toBeLessThan(1.5)
    expect(control(r, 'Edit')).toBeDefined()
    expect(warnings(r).filter(w => w.includes('principal'))).toEqual([])
  })

  it('keeps the large title under the bar, the item in the bar\'s row', () => {
    const r = run(`        NavigationStack {
            List {
                Text("First row")
            }
            .navigationTitle("Inbox")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Custom")
                }
            }
        }`)
    const { large } = native.toolbar.principal
    const item = middle(frame(r, text(r, 'Custom')!))
    expect(Math.abs(item.x - centre(large.item.ink.x))).toBeLessThan(1.5)
    expect(Math.abs(item.y - centre(large.item.ink.y))).toBeLessThan(1.5)
    const title = nodes(r).find(n => n.id === 'navbar-large-title')!
    expect(title.opacity).toBe(1)
    expect(Math.abs(frame(r, title).x - large.largeTitle.ink.x[0])).toBeLessThan(2.5)
  })

  it('is a Toolbar layer a click on it finds, written where it is', () => {
    const r = run(`        NavigationStack {
            List {
                Text("First row")
            }
            .navigationTitle("Inbox")
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Custom")
                }
            }
        }`)
    const [toolbar] = layersOf(r, 'Toolbar')
    const layer = toolbar!.children.find(child => child.name === 'Custom')!
    expect(layer.type).toBe('Text')
    expect(finds(r, text(r, 'Custom')!, layer)).toBe(true)
    expect(written.slice(layer.source!.start, layer.source!.end)).toBe('Text("Custom")')
  })
})

const BOTTOM_BAR = `            .toolbar {
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("Edit") { }
                    Spacer()
                    Button("Compose", systemImage: "square.and.pencil") { }
                }
            }`
const NOTES = `List {
                Text("First row")
                Text("Second row")
            }
            .navigationTitle("Notes")
${BOTTOM_BAR}`

describe('a bottom bar', () => {
  /** How far a control's frame is from what was measured, edge by edge, at most. */
  const off = (r: CompileResult, label: string, x: readonly number[], y: readonly number[]) => {
    const f = frame(r, control(r, label)!)
    return Math.max(Math.abs(f.x - x[0]!), Math.abs(f.x + f.width - x[1]!), Math.abs(f.y - y[0]!), Math.abs(f.y + f.height - y[1]!))
  }
  /**
   * How far the Edit capsule is from what was measured: its leading edge, its height, and its
   * title's place in it, as the title's own width is the browser's to measure.
   */
  const editOff = (r: CompileResult) => {
    const { split, capsule } = native.toolbar.bottomBar
    const f = frame(r, control(r, 'Edit')!), title = frame(r, text(r, 'Edit')!)
    const inside = (split.edit.x[1] - split.edit.x[0] - (split.edit.titleInk[1] - split.edit.titleInk[0])) / 2
    return Math.max(Math.abs(f.x - split.edit.x[0]), Math.abs(f.y - capsule.y[0]), Math.abs(f.y + f.height - capsule.y[1]),
      Math.abs(title.x - f.x - inside), Math.abs(f.x + f.width - title.x - title.width - inside))
  }

  it('draws a Spacer\'s two sides as glass capsules at the screen\'s edges, above the home indicator', () => {
    const r = run(`        NavigationStack {
            ${NOTES}
        }`)
    const { split, capsule } = native.toolbar.bottomBar
    expect(editOff(r)).toBeLessThan(1)
    expect(off(r, 'Compose', split.compose.x, capsule.y)).toBeLessThan(1)
    expect(warnings(r).filter(w => w.includes('bottomBar'))).toEqual([])
  })

  it('draws items with no Spacer between them in one capsule, centred', () => {
    const r = run(`        NavigationStack {
            List {
                Text("First row")
            }
            .navigationTitle("Notes")
            .toolbar {
                ToolbarItem(placement: .bottomBar) {
                    Button("Edit") { }
                }
                ToolbarItem(placement: .bottomBar) {
                    Button("Share", systemImage: "square.and.arrow.up") { }
                }
            }
        }`)
    const { together } = native.toolbar.bottomBar
    const glass = nodes(r).filter(n => n.material && frame(r, n).y > 780)
    expect(glass).toHaveLength(1)
    const capsule = frame(r, glass[0]!), edit = frame(r, text(r, 'Edit')!), share = middle(frame(r, control(r, 'Share')!))
    // Centred, with the title as far in from one end and the icon from the other as measured.
    expect(Math.abs(middle(capsule).x - centre(together.capsule.x))).toBeLessThan(1)
    expect(Math.abs(edit.x - capsule.x - (together.editInk[0] - together.capsule.x[0]))).toBeLessThan(1.5)
    expect(Math.abs(capsule.x + capsule.width - share.x - (together.capsule.x[1] - centre(together.shareGlyph)))).toBeLessThan(1.5)
  })

  it('shares the tab bar\'s row in a TabView, under the tab bar', () => {
    const r = run(`        TabView {
            Tab("Notes", systemImage: "note.text") {
                NavigationStack {
                    ${NOTES}
                }
            }
            Tab("Settings", systemImage: "gear") {
                Text("Settings")
            }
        }`)
    const { split, capsule, twoTabs } = native.toolbar.bottomBar
    expect(editOff(r)).toBeLessThan(1)
    expect(off(r, 'Compose', split.compose.x, capsule.y)).toBeLessThan(1)
    const tabs = frame(r, nodes(r).find(n => n.id === 'tabbar-surface-material')!)
    expect(Math.abs(tabs.x - twoTabs.tabBar.x[0])).toBeLessThan(1)
    expect(control(r, 'Settings')!.z).toBeGreaterThan(control(r, 'Edit')!.z)
  })

  it('keeps a list\'s last rows above it, as a tab bar does, and once with a tab bar', () => {
    const alone = run(`        NavigationStack {
            ${NOTES}
        }`)
    const tabbed = run(`        TabView {
            NavigationStack {
                ${NOTES}
            }
            .tabItem { Label("Notes", systemImage: "note.text") }
        }`)
    const inset = (r: CompileResult) => nodes(r).find(n => n.scroll)!.scroll!.contentInsets!.bottom
    expect(inset(alone)).toBe(device.safeArea.bottom + 70)
    expect(inset(tabbed)).toBe(device.safeArea.bottom + 70)
  })

  it('lists its items in the screen\'s Toolbar layer, which a click on one finds', () => {
    const r = run(`        NavigationStack {
            ${NOTES}
        }`)
    const [toolbar] = layersOf(r, 'Toolbar')
    expect(toolbar!.children.map(child => child.type)).toEqual(['Button', 'Spacer', 'Button'])
    const [edit, , compose] = toolbar!.children
    expect(finds(r, control(r, 'Edit')!, edit!)).toBe(true)
    expect(finds(r, control(r, 'Compose')!, compose!)).toBe(true)
    expect(written.slice(compose!.source!.start, compose!.source!.end)).toBe('Button("Compose", systemImage: "square.and.pencil") { }')
  })

  it('runs what a tap on one of its buttons does', () => {
    const r = run(`        NavigationStack {
            Text("Composed \\(count)")
                .navigationTitle("Notes")
                .toolbar {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Compose") { count += 1 }
                    }
                }
        }`, '    @State private var count = 0')
    expect(applyEvent({ kind: 'tap', handlerId: control(r, 'Compose')!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
    expect(text(rerender(revision++), 'Composed 1')).toBeDefined()
  })

  it('puts a search field in the bar\'s drawer under the title, as a tab bar does', () => {
    const r = run(`        NavigationStack {
            ${NOTES}
            .searchable(text: $query)
        }`, '    @State private var query = ""')
    const { pulledDown } = native.toolbar.bottomBar.search
    const field = frame(r, control(r, 'Search')!)
    expect(field.y).toBeGreaterThanOrEqual(pulledDown.field.y[0] - 1)
    expect(field.y + field.height).toBeLessThanOrEqual(pulledDown.field.y[1] + 1)
    expect(control(r, 'Edit')).toBeDefined()
  })
})

describe('a screen with more than one .toolbar', () => {
  const INBOX = (toolbars: string) => `        NavigationStack {
            List {
                Text("First row")
            }
            .navigationTitle("Inbox")
${toolbars}
        }`
  const RESET = '            .toolbar { Button("Reset") { } }'
  const ACTION = '            .toolbar { ToolbarItem(placement: .bottomBar) { Button("Action") { } } }'

  it('draws the items of every one, as iOS merges them, each where its placement puts it', () => {
    const r = run(INBOX(`${RESET}\n${ACTION}`))
    const alone = run(INBOX(RESET))
    // Reset where a toolbar of Reset alone puts it, Action in the bottom bar's capsule.
    expect(frame(r, control(r, 'Reset')!)).toEqual(frame(alone, control(alone, 'Reset')!))
    const action = frame(r, control(r, 'Action')!)
    expect(Math.abs(action.y - native.toolbar.bottomBar.capsule.y[0])).toBeLessThan(1)
    expect(Math.abs(action.y + action.height - native.toolbar.bottomBar.capsule.y[1])).toBeLessThan(1)
  })

  const AROUND = `        NavigationStack {
            VStack {
                List {
                    Text("First row")
                }
                .navigationTitle("Inbox")
                .toolbar { Button("Reset") { } }
            }
            .toolbar { ToolbarItem(placement: .bottomBar) { Button("Action") { } } }
        }`

  it('draws a .toolbar written on a view around the one with the title', () => {
    const r = run(AROUND)
    expect(control(r, 'Reset')).toBeDefined()
    expect(control(r, 'Action')).toBeDefined()
  })

  it.skipIf(!XCODE)('is drawn from Swift that Xcode 27 type-checks', () => {
    typecheckInXcode([source(INBOX(`${RESET}\n${ACTION}`)), source(AROUND)])
  }, 300_000)

  it('lists every item in the screen\'s one Toolbar layer, which a click on each finds', () => {
    const r = run(INBOX(`${RESET}\n${ACTION}`))
    const toolbars = layersOf(r, 'Toolbar')
    expect(toolbars).toHaveLength(1)
    const [reset, action] = toolbars[0]!.children
    expect(finds(r, control(r, 'Reset')!, reset!)).toBe(true)
    expect(finds(r, control(r, 'Action')!, action!)).toBe(true)
    expect(written.slice(action!.source!.start, action!.source!.end)).toBe('Button("Action") { }')
  })
})

describe('a toolbar built by a @ToolbarContentBuilder', () => {
  const ITEMS = `        ToolbarItem(placement: .topBarTrailing) {
            Button("Add", systemImage: "plus") { }
        }
        ToolbarItem(placement: .bottomBar) {
            Button("Action") { }
        }`
  const SCREEN = (toolbar: string) => `        NavigationStack {
            List {
                Text("First row")
            }
            .navigationTitle("Inbox")
            .toolbar { ${toolbar} }
        }`
  const PROPERTY = `    @ToolbarContentBuilder
    var toolbarContent: some ToolbarContent {
${ITEMS}
    }`
  const FUNCTION = `    @ToolbarContentBuilder
    func items(count: Int) -> some ToolbarContent {
${ITEMS}
    }`

  it('draws every item of a property, each where its placement puts it, and says nothing of it', () => {
    const r = run(SCREEN('toolbarContent'), PROPERTY)
    expect(control(r, 'Add')).toBeDefined()
    const action = frame(r, control(r, 'Action')!)
    expect(Math.abs(action.y - native.toolbar.bottomBar.capsule.y[0])).toBeLessThan(1)
    expect(warnings(r)).toEqual([])
    const [add, act] = layersOf(r, 'Toolbar')[0]!.children
    expect(finds(r, control(r, 'Add')!, add!)).toBe(true)
    expect(finds(r, control(r, 'Action')!, act!)).toBe(true)
  })

  it('draws every item of a function\'s, and says nothing of it', () => {
    const r = run(SCREEN('items(count: 2)'), FUNCTION)
    expect(control(r, 'Add')).toBeDefined()
    expect(control(r, 'Action')).toBeDefined()
    expect(warnings(r)).toEqual([])
  })

  it.skipIf(!XCODE)('is drawn from Swift that Xcode 27 type-checks', () => {
    typecheckInXcode([source(SCREEN('toolbarContent'), PROPERTY), source(SCREEN('items(count: 2)'), FUNCTION)])
  }, 300_000)
})

describe('.toolbar(.hidden, for: .tabBar)', () => {
  it('hides the tab bar under the tab whose screen writes it', () => {
    const r = run(`        TabView {
            Tab("Notes", systemImage: "note.text") {
                NavigationStack {
                    List {
                        Text("First row")
                    }
                    .navigationTitle("Notes")
                    .toolbar(.hidden, for: .tabBar)
                }
            }
            Tab("Settings", systemImage: "gear") {
                Text("Settings")
            }
        }`)
    expect(control(r, 'Settings')).toBeUndefined()
    expect(nodes(r).find(n => n.id === 'tabbar-surface-material')).toBeUndefined()
    expect(warnings(r).filter(w => w.includes('tabBar'))).toEqual([])
  })

  const TABS = (first: string) => `        TabView {
            Tab("Notes", systemImage: "note.text") {
${first}
            }
            Tab("Settings", systemImage: "gear") {
                Text("Settings")
            }
        }`

  const ON_STACK = TABS(`                NavigationStack {
                    Text("Notes")
                        .navigationTitle("Notes")
                }
                .toolbar(.hidden, for: .tabBar)`)
  const NO_STACK = TABS(`                Text("Notes")
                    .toolbar(.hidden, for: .tabBar)`)
  const PUSHED = TABS(`                NavigationStack {
                    NavigationLink("Open") {
                        Text("Detail")
                            .toolbar(.hidden, for: .tabBar)
                    }
                    .navigationTitle("Notes")
                }`)

  it('hides it written on the tab\'s stack, or in a tab with no stack', () => {
    expect(control(run(ON_STACK), 'Settings')).toBeUndefined()
    expect(control(run(NO_STACK), 'Settings')).toBeUndefined()
  })

  it('hides it on the page of a pushed screen that writes it, and not on the screen below', () => {
    const r = run(PUSHED, '', true)
    const tabBar = (page: { tree: { nodes: readonly RenderNode[] } }) => page.tree.nodes.some(n => n.id.endsWith('tabbar-surface-material'))
    const detail = r.pages!.find(page => page.kind === 'destination')!
    const notes = r.pages!.find(page => page.id === detail.parentId)!
    expect(tabBar(notes)).toBe(true)
    expect(tabBar(detail)).toBe(false)
  })

  it.skipIf(!XCODE)('is drawn from Swift that Xcode 27 type-checks', () => {
    typecheckInXcode([ON_STACK, NO_STACK, PUSHED].map(body => source(body)))
  }, 300_000)

  it('hides a bottom bar written for it, and still warns of a bar the preview doesn\'t hide', () => {
    const r = run(`        NavigationStack {
            ${NOTES}
            .toolbar(.hidden, for: .bottomBar)
            .toolbar(.hidden, for: .automatic)
        }`)
    expect(control(r, 'Edit')).toBeUndefined()
    expect(warnings(r).filter(w => w.includes('.toolbar(.hidden'))).toEqual(['.toolbar(.hidden, for: .automatic): it is not applied by the preview, so the bar still shows. The source exports unchanged.'])
  })
})

describe('ContentUnavailableView', () => {
  const words = (r: CompileResult) => nodes(r).flatMap(n => n.text ? [n.text.runs.map(run => run.text).join('')] : [])
  const symbols = (r: CompileResult) => nodes(r).flatMap(n => n.image?.symbol ? [n.image.symbol] : [])

  it('draws .search(text:) as iOS does, with what was searched for, and goes on drawing the screen', () => {
    const r = run(`        VStack {
            ContentUnavailableView.search(text: query)
            Text("Below")
        }`, '    @State private var query = "kiwi"')
    const { search } = native.contentUnavailable
    expect(words(r)).toEqual([search.title.text, search.description.text, 'Below'])
    expect(symbols(r)).toEqual([search.icon.symbol])
    expect(warnings(r)).toEqual([])
  })

  it('titles .search, and .search(text:) with nothing searched for, "No Results", with the same description', () => {
    const { search, searchMember } = native.contentUnavailable
    for (const written of ['ContentUnavailableView.search', 'ContentUnavailableView.search(text: "")']) {
      expect(words(run(`        ${written}`))).toEqual([searchMember.title.text, search.description.text])
    }
  })

  const NO_MAIL = `        ContentUnavailableView {
            Label("No Mail", systemImage: "tray.fill")
        } description: {
            Text("New mail you receive appears here.")
        } actions: {
            Button("Refresh") { refreshed += 1 }
            Button("Compose") { }
                .buttonStyle(.borderedProminent)
        }`

  it('draws the closure form\'s own label, description and actions', () => {
    const r = run(NO_MAIL, '    @State private var refreshed = 0')
    expect(words(r)).toEqual(['No Mail', 'New mail you receive appears here.', 'Refresh', 'Compose'])
    expect(symbols(r)).toEqual([native.contentUnavailable.closure.icon.symbol])
    const { closure } = native.contentUnavailable
    // The actions are under the description where iOS 27 puts them, at the small control size:
    // their middles as far under the description's as measured, give or take where ink sits in a line.
    const description = middle(frame(r, text(r, 'New mail you receive appears here.')!)).y
    const refresh = middle(frame(r, text(r, 'Refresh')!)).y, compose = frame(r, control(r, 'Compose')!)
    const under = (range: readonly number[]) => centre(range) - centre(closure.description.ink.y)
    expect(Math.abs(refresh - description - under(closure.actions[0].ink.y))).toBeLessThan(2.5)
    expect(Math.abs(middle(compose).y - description - under(closure.actions[1].capsule.y))).toBeLessThan(2.5)
    expect(Math.abs(compose.height - (closure.actions[1].capsule.y[1] - closure.actions[1].capsule.y[0]))).toBeLessThan(2.5)
    expect(text(r, 'Refresh')!.text!.runs[0]!.font.size).toBe(15)
  })

  it('makes the closure form\'s actions buttons a click finds and a tap runs', () => {
    const r = run(NO_MAIL, '    @State private var refreshed = 0')
    const [view] = layersOf(r, 'ContentUnavailableView')
    expect(view!.children.map(child => child.type)).toEqual(['Label', 'Text', 'Button', 'Button'])
    const refresh = view!.children[2]!
    expect(finds(r, control(r, 'Refresh')!, refresh)).toBe(true)
    expect(written.slice(refresh.source!.start, refresh.source!.end)).toBe('Button("Refresh") { refreshed += 1 }')
    expect(finds(r, text(r, 'No Mail')!, view!.children[0]!)).toBe(true)
  })
})

describe('a sheet on the Design canvas', () => {
  const OPENER = (sheet: string, modifier = 'sheet') => `        NavigationStack {
            List {
                Text("First row")
                Button("Open") { showing = true }
            }
            .navigationTitle("Opener")
        }
        .${modifier}(isPresented: $showing) {
${sheet}
        }`
  const STATE = '    @State private var showing = false'
  const pages = (r: CompileResult, kind: string) => r.pages!.filter(page => page.kind === kind)
  const treeText = (tree: { nodes: readonly RenderNode[] }) => tree.nodes.flatMap(n => n.text ? [n.text.runs.map(run => run.text).join('')] : [])
  const surface = (tree: { nodes: readonly RenderNode[] }) => tree.nodes.find(n => n.id === 'overlay-surface')!

  it('is drawn over the screen that opens it, dimmed behind, at its first detent', () => {
    const r = run(OPENER('            Text("Sheet")\n                .presentationDetents([.medium])'), STATE, true)
    const [sheet] = pages(r, 'sheet')
    const opener = r.pages!.find(page => !page.parentId)!
    expect(sheet!.parentId).toBe(opener.id)
    expect(treeText(sheet!.tree)).toEqual(expect.arrayContaining(['Opener', 'First row', 'Sheet']))
    const { medium, dim } = native.sheets
    // Black over the screen, as dark as the simulator dims it.
    const shade = sheet!.tree.nodes.find(n => n.id === 'overlay-dim')!.background
    expect(shade?.kind === 'solid' && [shade.color.r, shade.color.g, shade.color.b]).toEqual([0, 0, 0])
    expect(shade?.kind === 'solid' && Math.abs(shade.color.a - (1 - dim.dimmed[0] / dim.opener[0]))).toBeLessThan(0.01)
    const rect = surface(sheet!.tree).frame
    expect([rect.x, rect.x + rect.width]).toEqual(medium.x)
    expect(rect.y + rect.height).toBe(medium.bottom)
    // The preview's medium detent is about 3 taller than iOS's (docs/ios27-appearance.md).
    expect(Math.abs(rect.y - medium.top)).toBeLessThan(3)
    // The screen behind takes no taps: its Open button is under the dimmed layer.
    const open = sheet!.tree.nodes.find(n => n.hitTarget && n.a11y?.label === 'Open')!
    expect(inert(sheet!.tree.nodes, open)).toBe(true)
  })

  it('draws a fixed height with its grabber, and its own background and corners', () => {
    const height = run(OPENER('            Text("Sheet")\n                .presentationDetents([.height(200)])\n                .presentationDragIndicator(.visible)'), STATE, true)
    const short = pages(height, 'sheet')[0]!.tree
    expect(Math.abs(surface(short).frame.y - native.sheets.height200.top)).toBeLessThan(1.5)
    const grabber = short.nodes.find(n => n.id === 'overlay-grabber')!
    expect(Math.abs(worldFrame(short.nodes, grabber).y - native.sheets.height200.grabber.y[0])).toBeLessThan(1.5)
    const styled = run(OPENER('            Text("Styled sheet")\n                .presentationDetents([.medium])\n                .presentationBackground(.yellow)\n                .presentationCornerRadius(12)'), STATE, true)
    const yellow = surface(pages(styled, 'sheet')[0]!.tree)
    expect(yellow.cornerRadius).toBe(native.sheets.styled.cornerRadius)
    expect(yellow.background?.kind === 'solid' && [yellow.background.color.r, yellow.background.color.g, yellow.background.color.b]).toEqual(native.sheets.styled.fill)
  })

  it('is one page named for the sheet, whose layers are its views, which a click on one finds', () => {
    const r = run(OPENER(`            NavigationStack {
                VStack {
                    Text("Write something")
                    Button("Send") { }
                }
                .navigationTitle("Compose")
            }
            .presentationDetents([.medium])`), STATE, true)
    const [sheet] = pages(r, 'sheet')
    expect(sheet!.name).toBe('Compose')
    expect(sheet!.viewHierarchy).toHaveLength(1)
    const [page] = sheet!.viewHierarchy!
    expect(page!.type).toBe('Page')
    const all = (layer: ViewLayer): ViewLayer[] => [layer, ...layer.children.flatMap(all)]
    const layer = (type: string) => all(page!).find(item => item.type === type)!
    // A sheet's views are drawn under \`overlay/\`, and a click on one still finds its layer.
    const node = sheet!.tree.nodes.find(n => n.text?.runs[0]?.text === 'Write something')!
    expect(node.id.startsWith('overlay/')).toBe(true)
    expect(layerForRenderNode(sheet!.viewHierarchy!, node)?.id).toBe(layer('Text').id)
    const send = sheet!.tree.nodes.find(n => n.hitTarget && n.a11y?.label === 'Send')!
    expect(send.hitTarget!.handlerId).toBe(`action-${layer('Button').id}`)
    expect(all(page!).filter(item => item.type === 'Text' && item.name === 'Opener')).toEqual([])
  })

  it('still finds what the sheet opens', () => {
    const r = run(OPENER(`            NavigationStack {
                NavigationLink("More", destination: Text("Deep"))
                    .navigationTitle("Compose")
            }`), STATE, true)
    const [sheet] = pages(r, 'sheet')
    const deeper = r.pages!.find(page => page.parentId === sheet!.id)!
    expect(deeper.kind).toBe('destination')
    expect(treeText(deeper.tree)).toContain('Deep')
  })

  it('draws a popover over its opener as a sheet, and a full-screen cover as a screen of its own', () => {
    const popover = pages(run(OPENER('            Text("Popover")', 'popover'), STATE, true), 'popover')[0]!
    expect(treeText(popover.tree)).toEqual(expect.arrayContaining(['First row', 'Popover']))
    const cover = pages(run(OPENER('            Text("Cover")', 'fullScreenCover'), STATE, true), 'cover')[0]!
    expect(treeText(cover.tree)).toEqual(['Cover'])
    expect(cover.tree.nodes.some(n => n.id === 'overlay-surface')).toBe(false)
  })

  it('draws a sheet opened from two screens once, over the first', () => {
    const r = run(`        NavigationStack {
            VStack {
                Compose()
                NavigationLink("Next", destination: Compose().navigationTitle("Next"))
            }
            .navigationTitle("Home")
        }`, '', true, `
struct Compose: View {
    @State private var showing = false

    var body: some View {
        Text("Compose button")
            .sheet(isPresented: $showing) {
                Text("Compose sheet")
            }
    }
}`)
    const sheets = pages(r, 'sheet')
    expect(sheets).toHaveLength(1)
    expect(sheets[0]!.parentId).toBe(r.pages!.find(page => !page.parentId)!.id)
    expect(treeText(sheets[0]!.tree)).toEqual(expect.arrayContaining(['Home', 'Compose sheet']))
  })

  it('knows the type a grabber is set with', () => {
    const r = run(OPENER('            Text("Sheet")\n                .presentationDetents([.medium])\n                .presentationDragIndicator(indicator)'), `${STATE}\n    let indicator: Visibility = .visible`, true)
    expect(warnings(r)).toEqual([])
    expect(pages(r, 'sheet')[0]!.tree.nodes.some(n => n.id === 'overlay-grabber')).toBe(true)
  })
})

