import { beforeEach, expect, it } from 'vitest'
import { compile, resetPipelineState, applyEvent, rerender } from '@studio/swiftui-runtime'
import type { CompileResult, ViewLayer } from '@studio/shared'
import { findLayer, layerAncestors, layerForRenderNode, layerRenderIds } from '../apps/web/lib/layers'

beforeEach(resetPipelineState)
let revision = 0
function run(body: string, state = '') {
  return compile({ files: [{ id: 'App.swift', text: `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { ${state}
var body: some View { ${body} } }` }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: ++revision })
}
const all = (layers: readonly ViewLayer[]): ViewLayer[] => layers.flatMap(layer => [layer, ...all(layer.children)])
function tap(result: CompileResult, name: string) {
  const node = result.renderTree?.nodes.find(node => node.a11y?.label === name && node.hitTarget?.enabled)
  expect(node, name).toBeDefined()
  applyEvent({ kind: 'tap', handlerId: node!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(++revision)
}

it('includes all tab pages, nested view types and source locations without serializing runtime objects', () => {
  const result = run(`TabView {
    NavigationStack { VStack { Text("Hello"); HStack { Button("Add") {}; Image(systemName: "plus") }; NavigationLink { Text("Destination") } label: { HStack { Image(systemName: "circle"); Text("Read more") } } }.navigationTitle("Home") }.tabItem { Label("Home", systemImage: "house") }
    NavigationStack { Form { Section("Preferences") { Toggle("Enabled", isOn: $enabled) } }.navigationTitle("Settings") }.tabItem { Label("Settings", systemImage: "gear") }
  }`, '@State var enabled = true')
  expect(result.diagnostics).toEqual([])
  const pages = result.viewHierarchy!
  expect(pages.map(page => page.name)).toEqual(['Home', 'Settings'])
  expect(pages.map(page => page.page?.active)).toEqual([true, false])
  const layers = all(pages)
  expect(layers.map(layer => layer.type)).toEqual(expect.arrayContaining(['VStack', 'HStack', 'Text', 'Button', 'Image', 'Form', 'Section', 'Toggle']))
  expect(layers.every(layer => typeof layer.id === 'string' && layer.id.length > 0)).toBe(true)
  expect(new Set(layers.map(layer => layer.id)).size).toBe(layers.length)
  expect(layers.find(layer => layer.name === 'Hello')?.source?.file).toBe('App.swift')
  expect(layers.find(layer => layer.type === 'NavigationLink')?.name).toBe('Read more')
  expect(structuredClone(pages)).toEqual(pages)
  applyEvent({ kind: 'tap', handlerId: pages[1]!.page!.handlerId!, location: { x: 0, y: 0 } })
  const next = rerender(++revision)
  expect(next.viewHierarchy?.map(page => page.page?.active)).toEqual([false, true])
  expect(next.renderTree?.nodes.some(node => node.a11y?.label === 'Enabled')).toBe(true)
})

it('updates evaluated labels and highlights the correct control without invoking it', () => {
  let result = run('VStack { Text("Count: \\(count)"); Button("Add") { count += 1 } }', '@State var count = 0')
  const button = all(result.viewHierarchy!).find(layer => layer.type === 'Button')!
  expect(layerRenderIds(button, result.renderTree).size).toBe(1)
  const id = [...layerRenderIds(button, result.renderTree)][0]
  expect(result.renderTree?.nodes.find(node => node.id === id)?.hitTarget?.handlerId).toBe(`action-${button.id}`)
  expect(all(result.viewHierarchy!).some(layer => layer.name === 'Count: 0')).toBe(true)
  result = tap(result, 'Add')
  expect(all(result.viewHierarchy!).some(layer => layer.name === 'Count: 1')).toBe(true)
  expect(findLayer(result.viewHierarchy!, button.id)?.type).toBe('Button')
})

it('keeps repeated rows distinct and includes evaluated modifier content', () => {
  const result = run('VStack { ForEach(0..<12, id: \\.self) { item in Text("Row \\(item)") }; Text("Foreground").background { Text("Behind") } }')
  expect(result.diagnostics).toEqual([])
  const layers = all(result.viewHierarchy!)
  expect(layers.filter(layer => layer.name.startsWith('Row '))).toHaveLength(12)
  expect(new Set(layers.map(layer => layer.id)).size).toBe(layers.length)
  const row = layers.find(layer => layer.name === 'Row 1')!
  const ids = layerRenderIds(row, result.renderTree)
  expect(ids.size).toBe(1)
  expect(result.renderTree?.nodes.filter(node => ids.has(node.id)).flatMap(node => node.text?.runs.map(run => run.text) ?? [])).toEqual(['Row 1'])
  expect(layers.find(layer => layer.name === 'Foreground')?.children.some(layer => layer.name === 'Behind')).toBe(true)
})

it('shows destinations and sheets only when evaluated, and clears the hierarchy on invalid code', () => {
  let result = run(`NavigationStack { VStack {
    NavigationLink("Details") { Text("Detail contents").navigationTitle("Details") }
    Button("Open sheet") { shown = true }
  }.sheet(isPresented: $shown) { Text("Sheet contents") }.navigationTitle("Home") }`, '@State var shown = false')
  expect(result.diagnostics).toEqual([])
  expect(all(result.viewHierarchy!).some(layer => layer.name === 'Sheet contents')).toBe(false)
  result = tap(result, 'Open sheet')
  expect(result.viewHierarchy?.at(-1)?.type).toBe('Presentation')
  expect(all(result.viewHierarchy!).some(layer => layer.name === 'Sheet contents')).toBe(true)
  resetPipelineState()
  result = run('NavigationStack { NavigationLink("Details") { Text("Detail contents").navigationTitle("Details") } }')
  result = tap(result, 'Details')
  expect(result.viewHierarchy?.[0]?.name).toBe('Details')
  expect(all(result.viewHierarchy!).some(layer => layer.name === 'Detail contents')).toBe(true)
  expect(run('VStack {').viewHierarchy).toEqual([])
})

it('does not execute an unopened presentation just to populate layers', () => {
  const result = run('Text("Safe").sheet(isPresented: $shown) { Text(value!) }', '@State var shown = false; let value: String? = nil')
  expect(result.diagnostics).toEqual([])
  expect(all(result.viewHierarchy!).map(layer => layer.name)).toContain('Safe')
  expect(result.viewHierarchy).toHaveLength(1)
})


it('includes navigation toolbar controls and highlights multi-part labels', () => {
  const result = run('NavigationStack { Label("Welcome", systemImage: "star").navigationTitle("Home").toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Compose") {} } } }')
  expect(result.diagnostics).toEqual([])
  const layers = all(result.viewHierarchy!)
  expect(layers.some(layer => layer.type === 'Toolbar')).toBe(true)
  expect(layers.some(layer => layer.type === 'Button' && layer.name === 'Compose')).toBe(true)
  expect(layerRenderIds(layers.find(layer => layer.type === 'Label'), result.renderTree).size).toBeGreaterThan(0)
})


it('does not highlight another ForEach label whose string key shares a prefix', () => {
  const result = run('VStack { ForEach(["a", "ab"], id: \\.self) { key in Label(key, systemImage: "star") } }')
  expect(result.diagnostics).toEqual([])
  const layers = all(result.viewHierarchy!)
  const label = layers.find(layer => layer.type === 'Label' && layer.name === 'a')!
  const ids = layerRenderIds(label, result.renderTree, result.viewHierarchy)
  const texts = result.renderTree!.nodes.filter(node => ids.has(node.id)).flatMap(node => node.text?.runs.map(run => run.text) ?? [])
  expect(texts).toEqual(['a'])
})

/**
 * The inspector, read backwards.
 *
 * Hovering the preview asks the question `layerRenderIds` answers the other way
 * round - given what was painted, which layer drew it - so the two are checked
 * against each other rather than against a hand-written expectation. A control is
 * reached through its hit target and everything else through path ownership, and
 * both directions have to agree for a hover to highlight the row the click will
 * select.
 */
it('names the layer that painted a node, for every node its layer claims', () => {
  const result = run(`VStack {
    Text("Title").font(.title)
    Button("Add") {}
    ForEach(0..<3, id: \\.self) { item in Text("Row \\(item)") }
    Label("Tagged", systemImage: "tag")
  }`)
  expect(result.diagnostics).toEqual([])
  const pages = result.viewHierarchy!
  const claimed = all(pages).filter(layer => ['Text', 'Button', 'Label'].includes(layer.type))
  expect(claimed.length).toBeGreaterThan(4)

  for (const layer of claimed) {
    const ids = layerRenderIds(layer, result.renderTree, pages)
    expect(ids.size, layer.name).toBeGreaterThan(0)
    for (const id of ids) {
      const node = result.renderTree!.nodes.find(node => node.id === id)!
      expect(layerForRenderNode(pages, node)?.id, `${layer.type} ${layer.name}`).toBe(layer.id)
    }
  }

  const row = claimed.find(layer => layer.name === 'Row 1')!
  const trail = layerAncestors(pages, row.id)
  expect(trail[0]).toBe(pages[0]!.id)
  expect(trail).not.toContain(row.id)
  expect(findLayer(pages, trail.at(-1)!)?.children.some(child => child.id === row.id)).toBe(true)
  expect(layerAncestors(pages, 'not-a-layer')).toEqual([])
  expect(layerForRenderNode(pages, null)).toBeUndefined()
})
