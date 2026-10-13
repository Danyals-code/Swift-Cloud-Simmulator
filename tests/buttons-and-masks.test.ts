import { describe, expect, it } from 'vitest'
import type { CompileResult, RenderTree, RGBA } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Colouring a button, and fading a view with a mask.
 *
 * Both used to be drawn wrong without a word: a list row's `.buttonStyle(.plain)`
 * reached every button on the screen it pushed, so they lost their colour; a
 * button's own `.foregroundStyle` was drawn in its tint; and `.mask` with a gradient
 * was ignored, so an image meant to fade into its background ended in a hard edge.
 */

const device = DEVICES['iphone-15']
const TOKENS = `import SwiftUI
extension Color {
    static let brandColor = Color("brandColor")
}
extension ShapeStyle where Self == Color {
    static var brandColor: Color { Color("brandColor") }
}`
const BRAND: RGBA = { r: 255, g: 0, b: 89, a: 1 }
const RED: RGBA = { r: 255, g: 59, b: 48, a: 1 }

function run(source: string, allPages = false): CompileResult {
  resetPipelineState()
  const result = compile({
    files: [{ id: 'Sources/App.swift', text: source }, { id: 'Sources/Tokens.swift', text: TOKENS }],
    canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: 1,
    colors: [{ name: 'brandColor', light: '#FF0059' }], allPages,
  })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}
const app = (body: string, rest = '') => `import SwiftUI
@main struct ColourApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        ${body}
    }
}
${rest}`
const colourOf = (tree: RenderTree | null | undefined, text: string) => {
  const node = tree?.nodes.find(n => n.text?.runs.some(run => run.text === text))
  return node?.text?.runs[0]?.color
}

describe('a button’s colour', () => {
  it('is its own foreground style when it has one, over the tint and the destructive red', () => {
    const tree = run(app(`VStack {
            Button("Tinted") { }.tint(.brandColor)
            Button("Painted") { }.foregroundStyle(.brandColor)
            Button(role: .destructive) { } label: { Text("Destructive") }
            Button(role: .destructive) { } label: { Text("Destructive painted") }.foregroundStyle(.brandColor)
            Button("Prominent") { }.buttonStyle(.borderedProminent).foregroundStyle(.brandColor)
        }`)).renderTree
    expect(colourOf(tree, 'Tinted')).toEqual(BRAND)
    expect(colourOf(tree, 'Painted')).toEqual(BRAND)
    expect(colourOf(tree, 'Destructive')).toEqual(RED)
    expect(colourOf(tree, 'Destructive painted')).toEqual(BRAND)
    expect(colourOf(tree, 'Prominent')).toEqual(BRAND)
  })

  const PUSHING = app(`NavigationStack {
            List {
                NavigationLink { DetailView() } label: { Text("Open") }
                    .buttonStyle(.plain)
            }
        }`, `struct DetailView: View {
    var body: some View {
        Form {
            Section { Button("Edit") { }.tint(.brandColor) }
            Section { Button(role: .destructive) { } label: { Text("Delete") } }
        }
    }
}`)

  it('is not taken from a style written on the link that pushed its screen, on the canvas', () => {
    const result = run(PUSHING, true)
    const detail = result.pages?.find(page => page.tree.nodes.some(n => n.text?.runs.some(run => run.text === 'Delete')))?.tree
    expect(colourOf(detail, 'Delete')).toEqual(RED)
    expect(colourOf(detail, 'Edit')).toEqual(BRAND)
  })

  it('is not taken from a style written on the link that pushed its screen, once pushed', () => {
    const first = run(PUSHING)
    const link = first.renderTree?.nodes.find(n => n.hitTarget && n.a11y?.label === 'Open')
    expect(link).toBeDefined()
    applyEvent({ kind: 'tap', handlerId: link!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    const pushed = rerender(2).renderTree
    expect(colourOf(pushed, 'Delete')).toEqual(RED)
    expect(colourOf(pushed, 'Edit')).toEqual(BRAND)
  })
})

describe('.mask', () => {
  const fades = (mask: string) => run(app(`VStack(spacing: 0) {
            Color.blue.frame(height: 320)${mask}
            Spacer()
        }`)).renderTree?.nodes.find(node => node.mask)

  it('draws a gradient mask, written as an argument or as a closure', () => {
    const argument = fades('.mask(LinearGradient(colors: [Color.black, Color.black.opacity(0)], startPoint: .top, endPoint: .bottom))')
    expect(argument?.mask).toMatchObject({ kind: 'linearGradient', stops: [{ color: { a: 1 } }, { color: { a: 0 } }] })
    expect(argument?.frame.height).toBe(320)
    expect(fades('.mask { LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom) }')?.mask?.kind).toBe('linearGradient')
  })

  it('says when a mask is one it does not draw, and leaves the view unmasked', () => {
    const result = run(app('Text("Masked").mask(Circle())'))
    expect(result.renderTree?.nodes.some(node => node.mask)).toBe(false)
    expect(result.diagnostics.map(d => d.message).join(' ')).toContain("'.mask' is drawn by the preview for a gradient or a colour")
  })
})
