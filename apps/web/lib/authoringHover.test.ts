import { beforeEach, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { authoringRenderIds, hoveredSourceIds } from './authoringHover'
import { layerForRenderNode } from './layers'

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
