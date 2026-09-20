import { describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
import type { CompileRequest, RenderNode } from '@studio/shared'

/**
 * The preview runs design tokens written the way the studio writes them.
 *
 * Tokens are static members of framework types, declared in `DesignSystem/Tokens.swift`
 * and read with contextual syntax: `.foregroundStyle(.accent)`, `.padding(.space16)`,
 * `.font(.sectionTitle)`, `.shadow(.low)`. A colour's light and dark values live in the
 * asset catalog, which `Color("accent")` reads.
 */

const device = DEVICES['iphone-15']
let revision = 1

function run(body: string, extra = '', options: Partial<CompileRequest> = {}) {
  resetPipelineState()
  return compile({
    files: [{ id: 'Sources/App.swift', text: `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ShadowToken { let color: Color; let radius: CGFloat; let x: CGFloat; let y: CGFloat }

extension View {
    func shadow(_ token: ShadowToken) -> some View {
        shadow(color: token.color, radius: token.radius, x: token.x, y: token.y)
    }
}

extension Color {
    static let accent = Color("accent")
    static let brand = Color(red: 0.2, green: 0.4, blue: 0.9)
}

extension ShapeStyle where Self == Color {
    static var accent: Color { Color("accent") }
    static var brand: Color { Color(red: 0.2, green: 0.4, blue: 0.9) }
}

extension CGFloat {
    static let space16: CGFloat = 16
    static let radiusMedium: CGFloat = 12
}

extension Font {
    static let sectionTitle = Font.system(.headline)
}

extension ShadowToken {
    static let low = ShadowToken(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
}
${extra}
struct ContentView: View {
    var body: some View {
${body}
    }
}
` }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
    colors: [{ name: 'accent', light: '#FF0000', dark: '#00FF00' }],
    ...options,
  })
}

const textNode = (nodes: readonly RenderNode[] | undefined, text: string) => nodes?.find(n => n.text?.runs.some(r => r.text === text))
const runOf = (nodes: readonly RenderNode[] | undefined, text: string) => textNode(nodes, text)?.text?.runs[0]

describe('design tokens in the preview', () => {
  it('reads colour tokens by contextual and explicit syntax, beside system colours', () => {
    const result = run(`        VStack {
            Text("contextual").foregroundStyle(.brand)
            Text("explicit").foregroundStyle(Color.brand)
            Text("system").foregroundStyle(Color.blue)
        }`)
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    const nodes = result.renderTree?.nodes
    expect(runOf(nodes, 'contextual')?.color).toMatchObject({ r: 51, g: 102, b: 230 })
    expect(runOf(nodes, 'explicit')?.color).toMatchObject({ r: 51, g: 102, b: 230 })
    // An `extension Color` used to make every `Color.blue` in the project unresolvable.
    expect(runOf(nodes, 'system')?.color.b).toBeGreaterThan(200)
  })

  it('takes an asset colour’s value for the current appearance', () => {
    const body = `        Text("asset").foregroundStyle(.accent)`
    expect(runOf(run(body).renderTree?.nodes, 'asset')?.color).toMatchObject({ r: 255, g: 0, b: 0, a: 1 })
    expect(runOf(run(body, '', { colorScheme: 'dark' }).renderTree?.nodes, 'asset')?.color).toMatchObject({ r: 0, g: 255, b: 0, a: 1 })
  })

  it('draws a colour set the catalog does not have as clear, never as a system colour', () => {
    const result = run(`        Text("missing").foregroundStyle(Color("blue"))`, '', { colors: [] })
    expect(runOf(result.renderTree?.nodes, 'missing')?.color.a).toBe(0)
  })

  it('resolves spacing, radius and font tokens where a number or font is expected', () => {
    const result = run(`        VStack(spacing: .space16) {
            Text("padded").font(.sectionTitle).padding(.space16).background(.brand).clipShape(.rect(cornerRadius: .radiusMedium))
            Text("next")
        }`)
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    const nodes = result.renderTree?.nodes ?? []
    const padded = textNode(nodes, 'padded')!
    expect(padded.frame).toMatchObject({ x: 16, y: 16 })
    expect(padded.text?.runs[0]?.font.weight).toBe(600)
    const box = nodes.find(n => Math.abs(n.frame.width - (padded.frame.width + 32)) < 0.01 && n.background?.kind === 'solid')
    expect(box?.background).toMatchObject({ kind: 'solid', color: { r: 51, g: 102, b: 230 } })
  })

  it('calls a project overload beside the framework modifier of the same name', () => {
    const result = run(`        Text("raised").shadow(.low)`)
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    const shadowed = result.renderTree?.nodes.find(n => n.shadow)
    expect(shadowed?.shadow).toMatchObject({ radius: 4, x: 0, y: 2 })
  })

  it('keeps SwiftUI’s own contextual names when a project declares the same name elsewhere', () => {
    const result = run(`        Button("Go") {}.controlSize(.small).foregroundStyle(.primary)`, `extension CGFloat { static let small: CGFloat = 4 }
extension Color { static let primaryInk = Color.black }`)
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  })

  it('resolves a font written as a text style with a weight', () => {
    const result = run(`        Text("styled").font(.system(.body, weight: .bold))`)
    expect(runOf(result.renderTree?.nodes, 'styled')?.font).toMatchObject({ weight: 700, size: 17 })
  })
})
