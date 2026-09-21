import { ancestors } from './render-geometry'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { CompileRequest, CompileResult, RenderNode, RenderTree } from '@studio/shared'
import { compile, applyEvent, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import { SURFACES } from '../packages/swiftui-runtime/src/appearance/surfaces'

beforeEach(resetPipelineState)
const phone = DEVICES['iphone-15']
function run(body: string, options: Partial<CompileRequest> = {}, state = '') {
  return source(`import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { ${state}
var body: some View { ${body} } }`, options)
}
function source(text: string, options: Partial<CompileRequest> = {}) {
  const r = compile({ files: [{ id: 'App.swift', text }], canvas: phone, safeArea: phone.safeArea, colorScheme: 'light', revision: 1, ...options })
  expect(r.diagnostics.filter(d => d.severity !== 'info')).toEqual([])
  expect(r.renderTree).not.toBeNull()
  return r
}
function world(tree: RenderTree, node: RenderNode) {
  let x = node.frame.x, y = node.frame.y, parent = node.parent
  while (parent) { const p = tree.nodes.find(n => n.id === parent)!; x += p.frame.x; y += p.frame.y; parent = p.parent }
  return { ...node.frame, x, y }
}
const text = (r: CompileResult, value: string) => r.renderTree!.nodes.find(n => n.text?.runs.some(run => run.text === value))!
function tap(r: CompileResult, title: string) {
  const n = r.renderTree!.nodes.find(n => n.hitTarget?.enabled && n.a11y?.label === title)!
  expect(n, `missing ${title}`).toBeDefined()
  applyEvent({ kind: 'tap', handlerId: n.hitTarget!.handlerId, location: { x: 5, y: 5 } })
  return rerender(r.revision + 1)
}

describe('list surfaces', () => {
  it('distinguishes plain, grouped, inset grouped, and regular-width automatic layouts', () => {
    const plain = run('List { Text("Row") }.listStyle(.plain)')
    const grouped = run('List { Text("Row") }.listStyle(.grouped)')
    const inset = run('List { Text("Row") }.listStyle(.insetGrouped)')
    expect(world(plain.renderTree!, text(plain, 'Row')).x).toBe(16)
    expect(world(grouped.renderTree!, text(grouped, 'Row')).x).toBe(16)
    expect(world(inset.renderTree!, text(inset, 'Row')).x).toBe(32)
    expect(grouped.renderTree!.nodes.some(n => n.cornerRadius === SURFACES.list.corner)).toBe(false)
    expect(inset.renderTree!.nodes.some(n => n.clip && n.cornerRadius === SURFACES.list.corner)).toBe(true)
    const pad = DEVICES['ipad-11']
    const auto = run('List { Text("Row") }', { canvas: pad, safeArea: pad.safeArea })
    expect(auto.renderTree!.nodes.some(n => n.cornerRadius === SURFACES.list.corner)).toBe(false)
  })
  it('honors row insets, background, separator visibility, and exact row spacing', () => {
    const r = run('List { Text("A").listRowInsets(EdgeInsets(top: 2, leading: 30, bottom: 2, trailing: 4)).listRowBackground(Color.red).listRowSeparator(.hidden); Text("B"); Text("C") }.listStyle(.plain).listRowSpacing(5)')
    expect(world(r.renderTree!, text(r, 'A')).x).toBe(30)
    expect(r.renderTree!.nodes.filter(n => n.id.endsWith('sepl'))).toHaveLength(1)
    expect(r.renderTree!.nodes.some(n => n.id.endsWith('rowbgf') && n.background?.kind === 'solid' && n.background.color.r === 255)).toBe(true)
    const b = world(r.renderTree!, text(r, 'B')), c = world(r.renderTree!, text(r, 'C'))
    expect(c.y - b.y).toBeCloseTo(52 + 5)
  })
  it('keeps custom header styling and aligns footer with content', () => {
    const r = run('Form { Section { Text("Row") } header: { Text("Custom").font(.title2).foregroundStyle(.red) } footer: { Text("Footer") } }')
    expect(text(r, 'Custom').text!.runs[0]!.font.size).toBe(22)
    expect(text(r, 'Custom').text!.runs[0]!.color.r).toBe(255)
    expect(world(r.renderTree!, text(r, 'Footer')).x).toBe(world(r.renderTree!, text(r, 'Row')).x)
  })
  it('grows multiline rows and keeps the whole navigation row tappable', () => {
    const r = run('NavigationStack { List { NavigationLink("A long row that wraps at a larger text size") { Text("Details") } } }', { dynamicTypeSize: 'accessibility3' })
    const target = r.renderTree!.nodes.find(n => n.hitTarget?.role === 'button')!
    expect(target.frame.height).toBeGreaterThan(44)
    expect(target.frame.width).toBe(phone.width - SURFACES.list.inset * 2)
    const title = world(r.renderTree!, text(r, 'A long row that wraps at a larger text size'))
    const hit = world(r.renderTree!, target)
    expect(title.y + title.height).toBeLessThanOrEqual(hit.y + hit.height)
    expect(text(tap(r, 'A long row that wraps at a larger text size'), 'Details')).toBeDefined()
  })
  it('insets an editable field like its neighboring row instead of stretching its input over the card', () => {
    const r = run('Form { TextField("Name", text: $name); Text("Neighbor") }', {}, '@State var name = "Taylor"')
    const field = r.renderTree!.nodes.find(n => n.hitTarget?.role === 'textField')!
    expect(world(r.renderTree!, field).x).toBe(world(r.renderTree!, text(r, 'Neighbor')).x)
    expect(field.frame.width).toBe(phone.width - 64)
  })
  it('can hide the scroll background while retaining row surfaces', () => {
    const r = run('List { Text("Row") }.scrollContentBackground(.hidden)')
    expect(r.renderTree!.nodes.some(n => n.id === 'v-0bgf')).toBe(false)
    expect(r.renderTree!.nodes.some(n => n.id.includes('s0bgf'))).toBe(true)
  })
})

describe('screen composition', () => {
  it('places a resting scroll inset below the large title while extending beneath bars', () => {
    const r = run('NavigationStack { List { Text("Row") }.navigationTitle("Library") }')
    const tree = r.renderTree!, scroll = tree.nodes.find(n => n.scroll)!
    expect(scroll.frame.y).toBe(phone.safeArea.top + 54)
    expect(scroll.scroll!.contentInsets!.top).toBe(48)
    expect(world(tree, text(r, 'Row')).y).toBeGreaterThan(phone.safeArea.top + 102)
    expect(tree.chrome).toEqual({ scrollId: scroll.id, collapseDistance: 48 })
    expect(tree.nodes.find(n => n.id === 'navbar-title')!.chromeRole).toBe('inlineTitle')
  })
  it('keeps explicit drawer search in the primary scroller', () => {
    const r = run('NavigationStack { List { Text("Row") }.navigationTitle("Find").searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always)) }', {}, '@State var query = ""')
    const field = r.renderTree!.nodes.find(n => n.hitTarget?.role === 'textField')!
    expect(ancestors(r.renderTree!.nodes, field).map(node => node.id)).toContain(r.renderTree!.chrome!.scrollId)
  })
  it('puts automatic search in the drawer on phones and in the toolbar on iPad', () => {
    for (const key of ['iphone-15', 'ipad-11'] as const) {
      const d = DEVICES[key]
      const r = run('NavigationStack { List { Text("Row") }.navigationTitle("Find").searchable(text: $query) }', { canvas: d, safeArea: d.safeArea }, '@State var query = ""')
      const field = r.renderTree!.nodes.find(n => n.hitTarget?.role === 'textField')!
      expect(field.frame.height).toBeGreaterThan(0)
      if (key === 'iphone-15') {
        expect(ancestors(r.renderTree!.nodes, field).map(node => node.id)).toContain(r.renderTree!.chrome!.scrollId)
        expect(world(r.renderTree!, field).y).toBeLessThan(220)
      }
      else expect(world(r.renderTree!, field).y).toBeLessThan(d.safeArea.top + 44)
    }
  })
  it('supports Tab values, labels, selection bindings, and modern selected geometry', () => {
    let r = run('TabView(selection: $tab) { Tab("Home", systemImage: "house", value: 0) { Text("Home page") }; Tab("Settings", systemImage: "gearshape", value: 1) { Text("Settings page") } }', {}, '@State var tab = 1')
    expect(text(r, 'Settings page')).toBeDefined()
    expect(r.renderTree!.nodes.some(n => n.id === 'tab-1-selectedf')).toBe(true)
    r = tap(r, 'Home')
    expect(text(r, 'Home page')).toBeDefined()
    expect(r.renderTree!.nodes.some(n => n.id === 'tab-0-selectedf')).toBe(true)
    const surface = r.renderTree!.nodes.find(n => n.id === 'tabbar-surface-material')!
    expect(surface.material).toBeDefined()
    expect(world(r.renderTree!, surface).x).toBeGreaterThan(0)
  })
  it('places regular-width tabs at the top and limits their width', () => {
    const pad = DEVICES['ipad-11']
    const r = run('TabView { Tab("Home", systemImage: "house") { Text("Home page") }; Tab("Settings", systemImage: "gearshape") { Text("Settings page") } }', { canvas: pad, safeArea: pad.safeArea })
    const n = r.renderTree!.nodes.find(n => n.id === 'tabbar-surface-material')!
    expect(world(r.renderTree!, n).y).toBe(pad.safeArea.top)
    expect(n.frame.width).toBeLessThanOrEqual(SURFACES.tab.regularWidth)
  })
  it('composes navigation inside a sheet and reads presentation options from its content', () => {
    const r = run('Text("Under").sheet(isPresented: .constant(true)) { NavigationStack { Form { Text("Sheet row") }.navigationTitle("Sheet title").navigationBarTitleDisplayMode(.inline) }.presentationDetents([.medium]).presentationCornerRadius(20).presentationDragIndicator(.hidden).interactiveDismissDisabled(true) }')
    const panel = r.renderTree!.nodes.find(n => n.id === 'overlay-surface')!
    expect(panel.cornerRadius).toBe(20)
    expect(r.renderTree!.nodes.find(n => n.id === 'overlay-dim')!.blocksPointer).toBe(true)
    expect(r.renderTree!.nodes.find(n => n.id === 'v-0')!.inert).toBe(true)
    expect(panel.frame.x).toBe(8)
    const title = r.renderTree!.nodes.find(n => n.id === 'overlay/navbar-title')!
    expect(world(r.renderTree!, title).y - panel.frame.y).toBeGreaterThanOrEqual(12)
    expect(r.renderTree!.nodes.some(n => n.id === 'overlay-grabber')).toBe(false)
    expect(r.renderTree!.nodes.find(n => n.id === 'overlay-dim')!.hitTarget).toBeUndefined()
    expect(r.renderTree!.nodes.some(n => n.id === 'overlay/navbar-title' && n.text?.runs[0]?.text === 'Sheet title')).toBe(true)
    expect(world(r.renderTree!, text(r, 'Sheet row')).y).toBeGreaterThan(panel.frame.y + 44)
  })
  it('compares point and fractional detents using the current device height', () => {
    for (const key of ['iphone-se-3', 'ipad-11'] as const) {
      const d = DEVICES[key]
      const r = run('Text("Under").sheet(isPresented: .constant(true)) { Text("Sheet").presentationDetents([.height(400), .medium]) }', { canvas: d, safeArea: d.safeArea })
      expect(r.renderTree!.nodes.find(n => n.id === 'overlay-surface')!.frame.height).toBe(Math.min(400 + Math.max(0, d.safeArea.bottom - 8), (d.height - d.safeArea.bottom) / 2 + d.safeArea.bottom))
    }
  })
  it('can open a menu inside a sheet and restore the sheet after selection', () => {
    let r = run('Text("Under").sheet(isPresented: .constant(true)) { VStack { Text(name); Menu("Options") { Button("Rename") { name = "Changed" } } } }', {}, '@State var name = "Original"')
    r = tap(r, 'Options')
    expect(r.renderTree!.nodes.some(n => n.id === 'overlay/overlay-menu')).toBe(true)
    r = tap(r, 'Rename')
    expect(text(r, 'Changed')).toBeDefined()
    expect(r.renderTree!.nodes.some(n => n.id === 'overlay-surface')).toBe(true)
  })
  it('keeps toolbar controls inside the navigation strip at accessibility sizes', () => {
    const r = run('NavigationStack { List { Text("Row") }.navigationTitle("Library").toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Compose") { } } } }', { dynamicTypeSize: 'accessibility3' })
    const button = r.renderTree!.nodes.find(n => n.hitTarget && n.a11y?.label === 'Compose')!
    const rect = world(r.renderTree!, button)
    expect(rect.y).toBeGreaterThanOrEqual(phone.safeArea.top)
    expect(rect.y + rect.height).toBeLessThanOrEqual(phone.safeArea.top + 54)
    expect(text(r, 'Compose').text!.runs[0]!.font.size).toBe(17)
  })
  it('dismisses alert and dialog actions automatically while preserving their state changes', () => {
    for (const modifier of ['alert', 'confirmationDialog']) {
      resetPipelineState()
      let r = run(`Text(name).${modifier}("Save?", isPresented: $show) { Button("Cancel", role: .cancel) { }; Button("Save") { name = "Saved" } }`, {}, '@State var show = true; @State var name = "Original"')
      r = tap(r, 'Save')
      expect(text(r, 'Saved')).toBeDefined()
      expect(r.renderTree!.nodes.some(n => n.id === 'overlay-dim')).toBe(false)
    }
  })
  it('respects the selected detent instead of Set order', () => {
    const r = run('Text("Under").sheet(isPresented: .constant(true)) { Text("Sheet").presentationDetents([.large, .medium], selection: $detent) }', {}, '@State var detent: PresentationDetent = .medium')
    expect(r.renderTree!.nodes.find(n => n.id === 'overlay-surface')!.frame.height).toBeCloseTo((phone.height - phone.safeArea.bottom) / 2 + phone.safeArea.bottom)
  })
})

describe('comparison screen matrix', () => {
  const fixture = readFileSync(new URL('./fixtures/ios27-screens.swift', import.meta.url), 'utf8')
  for (const key of ['iphone-se-3', 'iphone-15', 'ipad-11'] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
      it(`renders ${key} ${colorScheme} with finite geometry`, () => {
        const d = DEVICES[key]
        const r = source(fixture, { canvas: d, safeArea: d.safeArea, colorScheme, displayScale: d.scale })
        expect(r.renderTree!.nodes.every(n => Object.values(n.frame).every(Number.isFinite))).toBe(true)
        expect(r.renderTree!.calibration).toBe('provisional')
        expect(text(tap(r, 'Settings'), 'Notifications')).toBeDefined()
      })
    }
  }
  it('keeps the gallery usable at accessibility size and opens its sheet', () => {
    const r = source(fixture, { dynamicTypeSize: 'accessibility3' })
    expect(tap(r, 'Compose').renderTree!.nodes.some(n => n.id === 'overlay-surface')).toBe(true)
  })
})
