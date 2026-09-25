import { beforeEach, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { authoringRenderGroups, authoringRenderIds, hoveredSourceIds, resolveAuthoringRuntimeSelection } from './authoringHover'
import { layerForRenderNode } from './layers'
import { reconcileAuthoringSelection } from '@studio/shared'

beforeEach(resetPipelineState)
function run(body: string, extra = '') {
  return compile({ projectId: 'hover', revision: 1, files: [{ id: 'App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { var body: some View { ${body} } }
${extra}` }], canvas: { width: 402, height: 874 }, colorScheme: 'light' })
}

it('highlights every painted instance of one repeated source view', () => {
  const result = run('VStack { ForEach(0..<3, id: \\.self) { i in Text("Row \\(i)") } }')
  expect(result.diagnostics).toEqual([])
  const source = result.authoring!.nodes.find(node => node.name === 'Text')!
  const ids = authoringRenderIds(source, result.authoring, result.viewHierarchy!, result.renderTree)
  expect(ids.size).toBe(3)
  expect(result.renderTree!.nodes.filter(node => ids.has(node.id)).flatMap(node => node.text?.runs.map(run => run.text) ?? [])).toEqual(['Row 0', 'Row 1', 'Row 2'])
})

it('keeps separate component call sites separate and follows runtime ancestry back to each instance', () => {
  const result = run('VStack { Card(title: "First"); Card(title: "Second") }', 'struct Card: View { let title: String; var body: some View { Text(title) } }')
  expect(result.diagnostics).toEqual([])
  const snapshot = result.authoring!, hierarchy = result.viewHierarchy!
  const calls = snapshot.nodes.filter(node => node.name === 'Card' && node.kind === 'component')
  expect(calls).toHaveLength(2)
  const first = authoringRenderIds(calls[0], snapshot, hierarchy, result.renderTree)
  const second = authoringRenderIds(calls[1], snapshot, hierarchy, result.renderTree)
  expect(first.size).toBeGreaterThan(0)
  expect([...first].every(id => !second.has(id))).toBe(true)
  const painted = result.renderTree!.nodes.find(node => node.text?.runs.some(run => run.text === 'Second'))!
  const candidates = hoveredSourceIds(snapshot, hierarchy, layerForRenderNode(hierarchy, painted)!.id)
  expect(candidates).toContain(calls[1]!.id)
  expect(candidates).not.toContain(calls[0]!.id)
})

it('does not reuse a stale source node after the model changes', () => {
  const before = run('Text("Before")'), after = run('Text("After")')
  expect(authoringRenderIds(before.authoring!.nodes.find(node => node.name === 'Text'), after.authoring, after.viewHierarchy!, after.renderTree).size).toBe(0)
})


it('rejects a reused runtime path after source reconciliation moves the selected view', () => {
  const source = (body: string) => `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { var body: some View { ${body} } }
`
  const beforeBody = 'VStack { Text("A"); Text("B") }'
  const afterBody = 'VStack { Text("A"); Text("Inserted"); Text("B") }'
  const before = run(beforeBody)
  const paintedBefore = before.renderTree!.nodes.find(node => node.text?.runs.some(run => run.text === 'B'))!
  const oldLayer = layerForRenderNode(before.viewHierarchy!, paintedBefore)!
  const oldNode = before.authoring!.nodes.find(node => node.id === before.authoring!.runtimeToSource[oldLayer.id])!
  const after = run(afterBody)
  const selected = reconcileAuthoringSelection({ snapshot: before.authoring!, nodeId: oldNode.id, files: [{ id: 'App.swift', text: source(beforeBody) }], runtimeId: oldLayer.id }, after.authoring!, [{ id: 'App.swift', text: source(afterBody) }])!
  expect(selected).toBeDefined()
  expect(after.authoring!.runtimeToSource[oldLayer.id]).not.toBe(selected.id)
  const resolved = resolveAuthoringRuntimeSelection(selected, after.authoring, after.viewHierarchy!, oldLayer.id)
  expect(resolved.exact).toBe(false)
  expect(resolved.layer?.id).not.toBe(oldLayer.id)
  expect(selected.runtimeIds).toContain(resolved.layer!.id)
  expect(after.renderTree!.nodes.find(node => node.id === resolved.layer!.id)?.text?.runs[0]?.text).toBe('B')
})

it('keeps an entered component definition attached to the selected instance', () => {
  const result = run('VStack { Card(title: "First"); Card(title: "Second") }', 'struct Card: View { let title: String; var body: some View { Text(title) } }')
  const snapshot = result.authoring!, layers = result.viewHierarchy!
  const second = result.renderTree!.nodes.find(node => node.text?.runs.some(run => run.text === 'Second'))!
  const secondLayer = layerForRenderNode(layers, second)!
  const definition = snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'Card')!
  expect(resolveAuthoringRuntimeSelection(definition, snapshot, layers, secondLayer.id)).toEqual({ layer: secondLayer, exact: true })
  const calls = snapshot.nodes.filter(node => node.kind === 'component' && node.name === 'Card')
  expect(resolveAuthoringRuntimeSelection(calls[1], snapshot, layers, secondLayer.id)).toEqual({ layer: secondLayer, exact: true })
  const wrongCall = resolveAuthoringRuntimeSelection(calls[0], snapshot, layers, secondLayer.id)
  expect(wrongCall.exact).toBe(false)
  expect(calls[0]!.runtimeIds).toContain(wrongCall.layer!.id)
})

it('prefers the focused phone when a source view has several rendered instances', () => {
  const result = run('VStack { Card(title: "First"); Card(title: "Second") }', 'struct Card: View { let title: String; var body: some View { Text(title) } }')
  const snapshot = result.authoring!, layers = result.viewHierarchy!
  const second = result.renderTree!.nodes.find(node => node.text?.runs.some(run => run.text === 'Second'))!
  const secondLayer = layerForRenderNode(layers, second)!
  const text = snapshot.nodes.find(node => node.owner === 'Card' && node.name === 'Text')!
  expect(resolveAuthoringRuntimeSelection(text, snapshot, layers, undefined, [secondLayer])).toEqual({ layer: secondLayer, exact: false })
  const next = run('Text("Changed")')
  expect(resolveAuthoringRuntimeSelection(text, next.authoring, next.viewHierarchy!, secondLayer.id)).toEqual({ exact: false })
})

it('groups what a repeated source view paints by the row it is drawn in, so each row is outlined as one (D1)', () => {
  const result = run('VStack { ForEach(0..<3, id: \\.self) { i in HStack { Text("Row \\(i)"); Text("Detail") } } }')
  const row = result.authoring!.nodes.find(node => node.name === 'HStack')!
  const groups = authoringRenderGroups(row, result.authoring, result.viewHierarchy!, result.renderTree)
  expect(groups).toHaveLength(3)
  expect(groups.map(group => group.flatMap(id => result.renderTree!.nodes.find(node => node.id === id)?.text?.runs.map(run => run.text) ?? []))).toEqual([['Row 0', 'Detail'], ['Row 1', 'Detail'], ['Row 2', 'Detail']])
})
