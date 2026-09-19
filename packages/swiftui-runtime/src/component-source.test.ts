import { beforeEach, describe, expect, it } from 'vitest'
import type { ViewLayer } from '@studio/shared'
import { compile, resetPipelineState } from './pipeline'

beforeEach(resetPipelineState)
const run = (body: string, extra = '') => compile({ projectId: 'component-source', revision: 1, files: [{ id: 'App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { var body: some View { ${body} } }
${extra}` }], canvas: { width: 402, height: 874 }, colorScheme: 'light' })
const flatten = (layers: readonly ViewLayer[]): ViewLayer[] => layers.flatMap(layer => [layer, ...flatten(layer.children)])
const card = 'struct Card: View { let title: String; var body: some View { VStack { Text(title); Image(systemName: "star") } } }'

describe('expanded component source provenance', () => {
  it('keeps two calls to the same body separate without adding runtime component nodes', () => {
    const result = run('VStack { Card(title: "First"); Card(title: "Second") }', card)
    expect(result.diagnostics).toEqual([])
    const calls = result.authoring!.nodes.filter(node => node.kind === 'component' && node.name === 'Card')
    expect(calls).toHaveLength(2)
    expect(calls.map(node => node.runtimeIds.length)).toEqual([1, 1])
    expect(calls[0]!.runtimeIds).not.toEqual(calls[1]!.runtimeIds)
    const layers = flatten(result.viewHierarchy!)
    expect(layers.some(layer => layer.type === 'Card')).toBe(false)
    const second = layers.find(layer => layer.name === 'Second')!
    expect(second.componentSources?.find(source => source.name === 'Card')?.source.start).toBe(calls[1]!.source.start)
    expect(result.authoring!.runtimeToSource[second.id]).toBe(result.authoring!.nodes.find(node => node.name === 'Text' && node.owner === 'Card')!.id)
  })

  it('retains component ownership when navigation roots are unwrapped', () => {
    const result = run('LibraryView()', 'struct LibraryView: View { var body: some View { NavigationStack { List { Text("Shelf") } } } }')
    expect(result.diagnostics).toEqual([])
    const instance = result.authoring!.nodes.find(node => node.kind === 'component' && node.name === 'LibraryView')!
    const layers = flatten(result.viewHierarchy!)
    expect(instance.runtimeIds.length).toBeGreaterThan(0)
    expect(layers.find(layer => layer.name === 'Shelf')?.componentSources?.some(source => source.name === 'LibraryView' && source.source.start === instance.source.start)).toBe(true)
  })

  it('tracks nested and repeated component instances through copied view values', () => {
    const result = run('VStack { ForEach(0..<2, id: \\.self) { index in Wrapper(title: "Item") } }', card + '\nstruct Wrapper: View { let title: String; var body: some View { let card = Card(title: title); card } }')
    expect(result.diagnostics).toEqual([])
    const calls = result.authoring!.nodes.filter(node => node.kind === 'component' && ['Wrapper', 'Card'].includes(node.name))
    expect(calls.map(node => node.runtimeIds.length)).toEqual([2])
    const painted = flatten(result.viewHierarchy!).filter(layer => layer.name === 'Item')
    expect(painted).toHaveLength(2)
    expect(painted.every(layer => layer.componentSources?.map(source => source.name).join('/') === 'ContentView/Wrapper/Card')).toBe(true)
  })

  it('retains component metadata in visual modifier content', () => {
    const result = run('Badge()', 'struct Badge: View { var body: some View { Text("Base").overlay(Text("Label")) } }')
    expect(result.diagnostics).toEqual([])
    const label = flatten(result.viewHierarchy!).find(layer => layer.name === 'Label')!
    expect(label.componentSources?.map(source => source.name)).toEqual(['ContentView', 'Badge'])
  })
})
