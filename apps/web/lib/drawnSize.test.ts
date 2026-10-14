import { beforeEach, describe, expect, it } from 'vitest'
import type { LayerLayout } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { drawnSize, fixedStart } from './drawnSize'

/** The size a selected view is drawn at, which the Layout section's Fixed starts from. */
beforeEach(resetPipelineState)
function run(body: string, name = 'Text') {
  const result = compile({ projectId: 'drawn', revision: 1, files: [{ id: 'App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { var body: some View { ${body} } }
` }], canvas: { width: 402, height: 874 }, colorScheme: 'light' })
  const node = result.authoring!.nodes.find(item => item.name === name)!
  return drawnSize(result.renderTree!, result.viewHierarchy!, node.runtimeIds[0]!, name === 'Button')
}
const rounded = (size: { width: number; height: number } | undefined) => size && { width: Math.round(size.width), height: Math.round(size.height) }

it('measures a view with a fill as its fill, padding and all', () => {
  expect(rounded(run('Text("Hello").padding(16).background(Color.blue).padding(8)'))).toEqual({ width: 71, height: 52 })
})

it('measures a stack by everything it draws', () => {
  expect(rounded(run('VStack { HStack(spacing: 4) { Text("A").frame(width: 30, height: 20).background(Color.red); Text("B").frame(width: 50, height: 10).background(Color.red) } }', 'HStack'))).toEqual({ width: 84, height: 20 })
})

it('measures a button by its label, which its size is set on', () => {
  const plain = rounded(run('Button("Go") { }', 'Button')), bordered = rounded(run('Button("Go") { }.buttonStyle(.borderedProminent)', 'Button'))
  expect(bordered).toEqual(plain)
})

it('has no size for a view it does not draw', () => {
  expect(run('VStack { if false { Text("Hidden") } }')).toBeUndefined()
})

describe('the size Fixed starts from', () => {
  const layout = (surface: boolean, padding: LayerLayout['padding']) => ({ context: { parent: 'column', inButton: false, surface }, padding }) as unknown as LayerLayout
  const drawn = { width: 40, height: 20 }
  it('is the drawn size where a fill paints around the padding', () => {
    expect(fixedStart(drawn, layout(true, { value: { top: 8, leading: 8, bottom: 8, trailing: 8 }, state: 'literal' }))).toEqual(drawn)
  })
  it('adds the padding where nothing paints it', () => {
    expect(fixedStart(drawn, layout(false, { value: { top: 1, leading: 2, bottom: 3, trailing: 4 }, state: 'literal' }))).toEqual({ width: 46, height: 24 })
    expect(fixedStart(drawn, layout(false, { value: null, state: 'absent' }))).toEqual(drawn)
  })
  it('has no size where the padding is a token or worked out in Swift, and nothing paints it', () => {
    expect(fixedStart(drawn, layout(false, { value: { top: { token: 'Layout.gap' }, leading: 0, bottom: 0, trailing: 0 }, state: 'token' }))).toBeUndefined()
    expect(fixedStart(drawn, layout(false, { value: null, state: 'code' }))).toBeUndefined()
    expect(fixedStart(undefined, layout(true, { value: null, state: 'absent' }))).toBeUndefined()
  })
})
