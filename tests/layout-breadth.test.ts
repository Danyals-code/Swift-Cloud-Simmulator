import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode, RenderTree } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * The layout breadth Phase 7 added: `GeometryReader`, `Grid`, `ViewThatFits`,
 * aspect ratios, layout priority and the text policy modifiers.
 *
 * Each of these is a *measurement* feature, so each test asserts on a frame rather
 * than on the presence of a node. A grid that renders three cells in a column would
 * satisfy "it drew something" and be completely wrong.
 */

const device = DEVICES['iphone-15']
let revision = 1

function app(body: string, extra = ''): string {
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

${extra}`
}

function run(source: string): CompileResult {
  resetPipelineState()
  const request: CompileRequest = {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  }
  const result = compile(request)
  expect(result.diagnostics.filter((d) => d.severity !== 'info').map((d) => d.message)).toEqual([])
  expect(result.renderTree).not.toBeNull()
  return result
}

function nodes(result: CompileResult): readonly RenderNode[] {
  return result.renderTree!.nodes
}

function textNode(tree: RenderTree | null, text: string): RenderNode {
  const found = (tree?.nodes ?? []).find((n) => n.text?.runs[0]?.text === text)
  expect(found, `no text "${text}"`).toBeDefined()
  return found!
}

function texts(tree: RenderTree | null): string[] {
  return (tree?.nodes ?? []).flatMap((n) => n.text?.runs.map((r) => r.text) ?? [])
}

beforeEach(() => {
  resetPipelineState()
})

describe('GeometryReader', () => {
  it('reports the size it was actually given', () => {
    // The two-pass loop is the whole feature: the first pass has to guess, the second
    // has the real number. A one-pass implementation reports the guess forever.
    const result = run(
      app(`    var body: some View {
        GeometryReader { geo in
            Text("width \\(Int(geo.size.width))")
        }
        .frame(width: 240, height: 100)
    }`),
    )
    expect(texts(result.renderTree)).toContain('width 240')
  })

  it('reports a size that changed because of a sibling', () => {
    const result = run(
      app(`    var body: some View {
        HStack(spacing: 0) {
            Color.red.frame(width: 100)
            GeometryReader { geo in
                Text("rest \\(Int(geo.size.width))")
            }
        }
        .frame(width: 300, height: 80)
    }`),
    )
    expect(texts(result.renderTree)).toContain('rest 200')
  })

  it('positions its content in its own coordinate space', () => {
    // `GeometryReader` establishes a coordinate space; content at the origin belongs
    // at the reader's top-left, not the screen's.
    const result = run(
      app(`    var body: some View {
        GeometryReader { geo in
            Text("inside")
        }
        .frame(width: 200, height: 60)
    }`),
    )
    const inside = textNode(result.renderTree, 'inside')
    expect(inside.parent).toBeDefined()
    expect(inside.frame.x).toBe(0)
    expect(inside.frame.y).toBe(0)
  })
})

describe('Grid', () => {
  it('aligns columns across rows', () => {
    // The property that distinguishes `Grid` from nested stacks: a short cell in row
    // one still leaves its column as wide as the long cell below it.
    const result = run(
      app(`    var body: some View {
        Grid {
            GridRow {
                Text("a")
                Text("second column")
            }
            GridRow {
                Text("a very long first cell")
                Text("b")
            }
        }
    }`),
    )
    const topLeft = textNode(result.renderTree, 'a')
    const topRight = textNode(result.renderTree, 'second column')
    const bottomLeft = textNode(result.renderTree, 'a very long first cell')
    const bottomRight = textNode(result.renderTree, 'b')

    const centre = (n: RenderNode) => Math.round(n.frame.x + n.frame.width / 2)

    // A `Grid`'s default alignment is `.center`, so what lines up across rows is the
    // column's centre line rather than its leading edge.
    expect(centre(topLeft)).toBe(centre(bottomLeft))
    expect(centre(topRight)).toBe(centre(bottomRight))
    // And the second column begins after the widest cell of the first.
    expect(topRight.frame.x).toBeGreaterThan(bottomLeft.frame.x + bottomLeft.frame.width - 1)
  })

  it('stacks rows vertically', () => {
    const result = run(
      app(`    var body: some View {
        Grid {
            GridRow { Text("one") }
            GridRow { Text("two") }
        }
    }`),
    )
    expect(textNode(result.renderTree, 'two').frame.y).toBeGreaterThan(
      textNode(result.renderTree, 'one').frame.y,
    )
  })
})

describe('ViewThatFits', () => {
  it('takes the first child that fits', () => {
    const result = run(
      app(`    var body: some View {
        ViewThatFits {
            Text("short")
            Text("fallback")
        }
        .frame(width: 300, height: 40)
    }`),
    )
    expect(texts(result.renderTree)).toContain('short')
    expect(texts(result.renderTree)).not.toContain('fallback')
  })

  it('falls back to the last child when nothing fits', () => {
    const result = run(
      app(`    var body: some View {
        ViewThatFits(in: .horizontal) {
            Text("a very long label that will never fit in the space given")
            Text("tiny")
        }
        .frame(width: 60, height: 40)
    }`),
    )
    expect(texts(result.renderTree)).toContain('tiny')
  })
})

describe('aspect ratio', () => {
  it('fits a ratio inside the frame it is given', () => {
    const result = run(
      app(`    var body: some View {
        Rectangle()
            .aspectRatio(2, contentMode: .fit)
            .frame(width: 200, height: 200)
    }`),
    )
    const shape = nodes(result).find((n) => n.kind === 'shape')!
    expect(Math.round(shape.frame.width)).toBe(200)
    expect(Math.round(shape.frame.height)).toBe(100)
  })

  it('fills the frame when asked to', () => {
    const result = run(
      app(`    var body: some View {
        Rectangle()
            .aspectRatio(2, contentMode: .fill)
            .frame(width: 200, height: 200)
    }`),
    )
    const shape = nodes(result).find((n) => n.kind === 'shape')!
    expect(Math.round(shape.frame.width)).toBe(400)
    expect(Math.round(shape.frame.height)).toBe(200)
  })
})

describe('layout priority', () => {
  it('gives the higher-priority view its space first', () => {
    // Without priority, the two labels share what is left equally and both truncate.
    // With it, the prioritised one takes its ideal width and the other gives way.
    const result = run(
      app(`    var body: some View {
        HStack(spacing: 0) {
            Text("the first label here")
                .layoutPriority(1)
            Text("the second label here")
        }
        .frame(width: 200)
    }`),
    )
    // The prioritised label takes its ideal width and stays on one line; the other
    // gets what is left and wraps. Comparing painted *widths* would prove nothing —
    // a wrapped label's width is its longest line, which can be anything.
    const first = textNode(result.renderTree, 'the first label here')
    const second = textNode(result.renderTree, 'the second label here')
    expect(first.text!.lines).toHaveLength(1)
    expect(second.text!.lines!.length).toBeGreaterThan(1)
  })
})

describe('position', () => {
  it('centres the view on the point given', () => {
    const result = run(
      app(`    var body: some View {
        Text("pinned")
            .position(x: 100, y: 50)
            .frame(width: 300, height: 300)
    }`),
    )
    // `.position` is relative to the frame it sits in, and that frame is itself
    // centred on the screen — so the absolute x is the frame's origin plus 100.
    const pinned = textNode(result.renderTree, 'pinned')
    const frameOrigin = (device.width - 300) / 2
    const centre = pinned.frame.x + pinned.frame.width / 2
    expect(Math.round(centre - frameOrigin)).toBe(100)
  })
})

describe('text policy', () => {
  it('truncates at the line limit with an ellipsis', () => {
    const result = run(
      app(`    var body: some View {
        Text("a sentence long enough that it certainly wraps onto several lines in a narrow column")
            .lineLimit(2)
            .frame(width: 120)
    }`),
    )
    const node = nodes(result).find((n) => n.text)!
    expect(node.text!.lines).toHaveLength(2)
    expect(node.text!.lines!.at(-1)!.text.endsWith('…')).toBe(true)
  })

  it('does not truncate when the text fits', () => {
    const result = run(
      app(`    var body: some View {
        Text("short")
            .lineLimit(2)
            .frame(width: 200)
    }`),
    )
    expect(nodes(result).find((n) => n.text)!.text!.lines!.at(-1)!.text).toBe('short')
  })

  it('uppercases with textCase', () => {
    const result = run(
      app(`    var body: some View {
        Text("quiet").textCase(.uppercase)
    }`),
    )
    expect(texts(result.renderTree)).toContain('QUIET')
  })

  it('carries the multiline alignment to the renderer', () => {
    const result = run(
      app(`    var body: some View {
        Text("centred text here")
            .multilineTextAlignment(.center)
            .frame(width: 200)
    }`),
    )
    expect(nodes(result).find((n) => n.text)!.text!.alignment).toBe('center')
  })

  it('inherits the policy from an enclosing stack', () => {
    // `.lineLimit` is environment, not a wrapper: written on a stack it applies to
    // every `Text` inside it.
    const result = run(
      app(`    var body: some View {
        VStack {
            Text("some words that will not fit on one line in this narrow column")
        }
        .lineLimit(1)
        .frame(width: 100)
    }`),
    )
    expect(nodes(result).find((n) => n.text)!.text!.lines).toHaveLength(1)
  })
})
