import { beforeEach, describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'

/**
 * Uneven corners: a rectangle with a radius per corner is drawn with each corner's own
 * radius, as Xcode draws it. Before (D7a) every corner took the largest radius, and
 * before that the first radius written.
 */
const wrap = (body: string) => `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { ${body} } }`
function draw(body: string) {
  const result = compile({ projectId: 'corners', revision: 1, files: [{ id: 'App.swift', text: wrap(body) }], canvas: { width: 402, height: 874 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  return result.renderTree!.nodes
}
beforeEach(resetPipelineState)

describe('uneven corners are drawn with each corner\'s radius', () => {
  const radii = (item: { clipShape?: { cornerRadii?: unknown }; shape?: { cornerRadii?: unknown } }) => item.clipShape?.cornerRadii ?? item.shape?.cornerRadii

  it('clips to each radius written, wherever it is', () => {
    const nodes = draw('Color.blue.frame(width: 100, height: 100).clipShape(.rect(topLeadingRadius: 0, bottomLeadingRadius: 8, bottomTrailingRadius: 20, topTrailingRadius: 0))')
    expect(nodes.filter(item => item.clipShape).map(item => [item.clipShape!.kind, radii(item)])).toEqual([['roundedRectangle', { topLeading: 0, bottomLeading: 8, bottomTrailing: 20, topTrailing: 0 }]])
  })

  it.each([
    ['RectangleCornerRadii', 'RectangleCornerRadii(topLeading: 8, bottomTrailing: 16)'],
    ['.init', '.init(topLeading: 8, bottomTrailing: 16)'],
  ])('reads the radii from cornerRadii: written with %s', (_, written) => {
    const nodes = draw(`Color.blue.frame(width: 100, height: 100).clipShape(.rect(cornerRadii: ${written}))`)
    expect(nodes.filter(item => item.clipShape).map(item => [item.clipShape!.kind, radii(item)])).toEqual([['roundedRectangle', { topLeading: 8, bottomLeading: 0, bottomTrailing: 16, topTrailing: 0 }]])
  })

  it('draws an UnevenRoundedRectangle as a filled rounded rectangle, not a labelled box', () => {
    const nodes = draw('UnevenRoundedRectangle(topLeadingRadius: 4, bottomTrailingRadius: 16).fill(.red).frame(width: 100, height: 100)')
    expect(nodes.filter(item => item.placeholder)).toEqual([])
    expect(nodes.filter(item => item.shape).map(item => [item.shape!.shape, radii(item), item.shape!.fill?.kind, item.frame.width, item.frame.height])).toEqual([['roundedRectangle', { topLeading: 4, bottomLeading: 0, bottomTrailing: 16, topTrailing: 0 }, 'solid', 100, 100]])
  })

  it('clips to an UnevenRoundedRectangle, and fills a background in one, with each radius', () => {
    const clipped = draw('Color.blue.frame(width: 100, height: 100).clipShape(UnevenRoundedRectangle(topLeadingRadius: 20, bottomTrailingRadius: 6))')
    expect(clipped.filter(item => item.clipShape).map(item => [item.clipShape!.kind, radii(item)])).toEqual([['roundedRectangle', { topLeading: 20, bottomLeading: 0, bottomTrailing: 6, topTrailing: 0 }]])
    const filled = draw('Text("Hi").padding().background(.red, in: UnevenRoundedRectangle(topLeadingRadius: 12, bottomTrailingRadius: 12))')
    expect(filled.filter(item => item.clipShape).map(item => [item.clipShape!.kind, radii(item)])).toEqual([['roundedRectangle', { topLeading: 12, bottomLeading: 0, bottomTrailing: 12, topTrailing: 0 }]])
  })
})
