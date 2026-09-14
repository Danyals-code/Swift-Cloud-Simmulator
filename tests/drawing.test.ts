import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Vector drawing, filters and materials.
 *
 * The assertions are on *path data* rather than on pixels, because that is what the
 * worker actually produces - and because a path that renders is not necessarily a
 * path with the right geometry. A `Path` whose commands were dropped still draws an
 * empty `<svg>` and looks like a blank area rather than an error.
 */

const device = DEVICES['iphone-15']
let revision = 1

function app(body: string): string {
  return `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
${body}
}
`
}

function run(source: string, colorScheme: 'light' | 'dark' = 'light'): CompileResult {
  resetPipelineState()
  const request: CompileRequest = {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme,
    revision: revision++,
  }
  const result = compile(request)
  expect(result.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.message)).toEqual([])
  return result
}

function nodes(result: CompileResult): readonly RenderNode[] {
  return result.renderTree!.nodes
}

function paths(result: CompileResult): RenderNode[] {
  return nodes(result).filter((n) => n.kind === 'path')
}

beforeEach(() => {
  resetPipelineState()
})

describe('Path', () => {
  it('builds a path from move and line commands', () => {
    // The builder form mutates the path it is handed, which is what the real
    // initialiser's `inout` parameter does.
    const result = run(
      app(`    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 0, y: 0))
            path.addLine(to: CGPoint(x: 100, y: 0))
            path.addLine(to: CGPoint(x: 50, y: 80))
            path.closeSubpath()
        }
        .frame(width: 120, height: 100)
    }`),
    )

    const drawn = paths(result)
    expect(drawn).toHaveLength(1)
    expect(drawn[0]!.path!.d).toBe('M 0 0 L 100 0 L 50 80 Z')
  })

  it('fills with the colour given', () => {
    const result = run(
      app(`    var body: some View {
        Path { path in
            path.addRect(CGRect(x: 0, y: 0, width: 40, height: 40))
        }
        .fill(Color.red)
        .frame(width: 60, height: 60)
    }`),
    )
    const fill = paths(result)[0]!.path!.fill
    expect(fill?.kind).toBe('solid')
    expect(fill?.kind === 'solid' && fill.color.r).toBe(255)
  })

  it('strokes without filling', () => {
    const result = run(
      app(`    var body: some View {
        Path { path in
            path.move(to: CGPoint(x: 0, y: 0))
            path.addLine(to: CGPoint(x: 50, y: 50))
        }
        .stroke(Color.blue, lineWidth: 4)
        .frame(width: 60, height: 60)
    }`),
    )
    const drawn = paths(result)[0]!.path!
    expect(drawn.stroke?.width).toBe(4)
    // An outline is an outline: a stroked path with no fill must not be filled.
    expect(drawn.fill).toBeUndefined()
  })

  it('draws a rounded rectangle with arcs', () => {
    const result = run(
      app(`    var body: some View {
        Path(roundedRect: CGRect(x: 0, y: 0, width: 80, height: 40), cornerRadius: 8)
            .frame(width: 100, height: 60)
    }`),
    )
    expect(paths(result)[0]!.path!.d).toContain('A 8 8')
  })

  it('draws an arc', () => {
    const result = run(
      app(`    var body: some View {
        Path { path in
            path.addArc(
                center: CGPoint(x: 50, y: 50),
                radius: 40,
                startAngle: .degrees(0),
                endAngle: .degrees(90),
                clockwise: true
            )
        }
        .stroke(Color.green, lineWidth: 2)
        .frame(width: 100, height: 100)
    }`),
    )
    const d = paths(result)[0]!.path!.d
    expect(d).toContain('M 90 50')
    expect(d).toContain('A 40 40')
  })
})

describe('shape styling', () => {
  it('fills a shape with .fill', () => {
    const result = run(
      app(`    var body: some View {
        Circle()
            .fill(Color.orange)
            .frame(width: 50, height: 50)
    }`),
    )
    const shape = nodes(result).find((n) => n.kind === 'shape')!
    expect(shape.shape!.fill?.kind).toBe('solid')
  })

  it('outlines a shape with .stroke, leaving it unfilled', () => {
    const result = run(
      app(`    var body: some View {
        Circle()
            .stroke(Color.purple, lineWidth: 3)
            .frame(width: 50, height: 50)
    }`),
    )
    const shape = nodes(result).find((n) => n.kind === 'shape')!
    expect(shape.shape!.stroke?.width).toBe(3)
    expect(shape.shape!.fill).toBeUndefined()
  })
})

describe('Canvas', () => {
  it('records what its closure drew, in order', () => {
    const result = run(
      app(`    var body: some View {
        Canvas { context, size in
            var first = Path()
            first.addRect(CGRect(x: 0, y: 0, width: 20, height: 20))
            context.fill(first, with: .color(Color.red))

            var second = Path()
            second.addRect(CGRect(x: 30, y: 0, width: 20, height: 20))
            context.fill(second, with: .color(Color.blue))
        }
        .frame(width: 100, height: 40)
    }`),
    )

    const drawn = paths(result)
    expect(drawn).toHaveLength(2)
    expect(drawn[0]!.path!.d).toContain('M 0 0')
    expect(drawn[1]!.path!.d).toContain('M 30 0')
  })
})

describe('filters', () => {
  it('carries a blur radius to the renderer', () => {
    const result = run(
      app(`    var body: some View {
        Text("hazy").blur(radius: 6)
    }`),
    )
    expect(nodes(result).find((n) => n.filter)?.filter?.blur).toBe(6)
  })

  it('carries saturation, brightness and contrast', () => {
    const result = run(
      app(`    var body: some View {
        Text("adjusted")
            .saturation(0.5)
            .brightness(0.2)
            .contrast(1.4)
    }`),
    )
    const filters = nodes(result)
      .filter((n) => n.filter)
      .map((n) => n.filter!)

    expect(filters.some((f) => f.saturation === 0.5)).toBe(true)
    expect(filters.some((f) => f.brightness === 0.2)).toBe(true)
    expect(filters.some((f) => f.contrast === 1.4)).toBe(true)
  })
})

describe('materials', () => {
  it('draws a translucent backdrop rather than a flat colour', () => {
    // The distinction that matters: a material is see-through. Rendering it as grey
    // would look plausible and be wrong in every layered design.
    const result = run(
      app(`    var body: some View {
        Text("frosted")
            .padding()
            .background(.regularMaterial)
    }`),
    )
    const material = nodes(result).find((n) => n.material)
    expect(material).toBeDefined()
    expect(material!.material!.blur).toBeGreaterThan(0)
    expect(material!.material!.opacity).toBeLessThan(1)
  })

  it('picks the light or dark variant from the colour scheme', () => {
    const source = app(`    var body: some View {
        Text("frosted").padding().background(.thinMaterial)
    }`)
    expect(nodes(run(source, 'light')).find((n) => n.material)!.material!.light).toBe(true)
    expect(nodes(run(source, 'dark')).find((n) => n.material)!.material!.light).toBe(false)
  })
})

describe('accessibility and hit testing', () => {
  it('applies an accessibility label to the group it wraps', () => {
    const result = run(
      app(`    var body: some View {
        Circle()
            .frame(width: 20, height: 20)
            .accessibilityLabel("status indicator")
    }`),
    )
    expect(nodes(result).find((n) => n.a11y?.label === 'status indicator')).toBeDefined()
  })

  it('makes a subtree inert without hiding it', () => {
    // `.allowsHitTesting(false)` keeps the view on screen. A version that pruned the
    // subtree would pass an "is it tappable" test and fail the user.
    const result = run(
      app(`    var body: some View {
        Button("Send") { }
            .allowsHitTesting(false)
    }`),
    )
    const painted = nodes(result)
    expect(painted.some((n) => n.text?.runs[0]?.text === 'Send')).toBe(true)
    expect(painted.find((n) => n.hitTarget)?.hitTarget?.enabled).toBe(false)
  })
})
