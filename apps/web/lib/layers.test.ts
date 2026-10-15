import { beforeEach, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { findLayer, layerForRenderNode, layerRenderIds } from './layers'

beforeEach(resetPipelineState)

/**
 * A sheet's views are drawn under `overlay/`, so their ids can't meet the screen's under it
 * (Wave 4b). A click or a hover on a word or a shape in a sheet still finds its layer, and a
 * layer selected in a sheet still outlines what it draws.
 */
it('finds the layer of a text drawn in a sheet, and what that layer draws', () => {
  const result = compile({ projectId: 'layers', revision: 1, canvas: { width: 402, height: 874 }, colorScheme: 'light', files: [{ id: 'App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
  @State private var showing = true
  var body: some View {
    Text("Home").sheet(isPresented: $showing) { VStack { Text("Sheet words"); Image(systemName: "star") } }
  }
}` }] })
  const tree = result.renderTree!, layers = result.viewHierarchy!
  const words = tree.nodes.find(node => node.text?.runs.map(run => run.text).join('') === 'Sheet words')!
  expect(words.id.startsWith('overlay/')).toBe(true)
  const layer = layerForRenderNode(layers, words)
  expect([layer?.type, layer?.name]).toEqual(['Text', 'Sheet words'])
  expect(layerRenderIds(findLayer(layers, layer!.id), tree, layers).has(words.id)).toBe(true)
})
