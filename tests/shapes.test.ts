import { describe, expect, it } from 'vitest'
import type { CompileRequest, RenderNode } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Custom `Shape` conformances.
 *
 * `struct Arc: Shape { func path(in rect: CGRect) -> Path }` is how real SwiftUI code
 * writes a shape, and it did not work at all: `.stroke` on one answered "Value of
 * type 'Arc' has no member 'stroke'", and the coverage matrix had no row saying so.
 *
 * The ordering problem it poses is the one `GeometryReader` already has - the path
 * needs the rect it is about to be laid out in, which layout has not computed yet -
 * and it gets the same answer: the size measured on the last pass, with a second pass
 * when the guess was wrong. That is why every assertion here is about *geometry* as
 * well as about the call succeeding.
 */

const device = DEVICES['iphone-15']

function render(source: string): readonly RenderNode[] {
  const request: CompileRequest = {
    files: [{ id: 'Sources/P.swift', text: `${source}\n` }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: 1,
  }
  resetPipelineState()
  const result = compile(request)

  expect(
    result.diagnostics.map((d) => `${d.severity}: ${d.message}`),
    'the fixture must compile cleanly',
  ).toEqual([])

  const nodes = result.renderTree?.nodes ?? []
  expect(nodes.filter((n) => n.kind === 'placeholder')).toEqual([])
  return nodes
}

function paths(nodes: readonly RenderNode[]): RenderNode[] {
  return nodes.filter((n) => n.path !== undefined)
}

const ARC = `struct Arc: Shape {
    var sweep = 1.0

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addArc(
            center: CGPoint(x: rect.midX, y: rect.midY),
            radius: min(rect.width, rect.height) / 2 - 7,
            startAngle: .degrees(-90),
            endAngle: .degrees(-90 + 360 * sweep),
            clockwise: false
        )
        return path
    }
}`

const WEDGE = `struct Wedge: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}`

function app(body: string, extra = ''): string {
  return `import SwiftUI

${extra}

@main
struct P: App {
    var body: some Scene {
        WindowGroup {
            V()
        }
    }
}

struct V: View {
    var body: some View {
${body}
    }
}`
}

describe('a struct conforming to Shape', () => {
  it('strokes, at the size its frame gives it', () => {
    const drawn = paths(
      render(
        app(
          `        Arc(sweep: 0.75)
            .stroke(Color.orange, lineWidth: 14)
            .frame(width: 160, height: 160)`,
          ARC,
        ),
      ),
    )

    expect(drawn).toHaveLength(1)
    expect(drawn[0]!.frame.width).toBeCloseTo(160)
    expect(drawn[0]!.frame.height).toBeCloseTo(160)
    expect(drawn[0]!.path?.stroke?.width).toBe(14)
    // The rect it was handed is its own frame, so the arc is centred in 160x160.
    expect(drawn[0]!.path?.d).toContain('A 73 73')
  })

  it('fills', () => {
    const drawn = paths(
      render(
        app(
          `        Wedge()
            .fill(Color.blue)
            .frame(width: 60, height: 40)`,
          WEDGE,
        ),
      ),
    )

    expect(drawn[0]!.path?.fill).toBeDefined()
    expect(drawn[0]!.path?.d).toBe('M 0 40 L 30 0 L 60 40 Z')
  })

  it('draws with no modifier at all, because a shape is already a view', () => {
    const drawn = paths(render(app(`        Wedge()
            .frame(width: 20, height: 20)`, WEDGE)))
    expect(drawn).toHaveLength(1)
  })

  it('trims, and the trim composes with the stroke after it', () => {
    const drawn = paths(
      render(
        app(
          `        Arc(sweep: 1.0)
            .trim(from: 0, to: 0.5)
            .stroke(Color.green, lineWidth: 8)
            .frame(width: 80, height: 80)`,
          ARC,
        ),
      ),
    )

    expect(drawn[0]!.path?.stroke?.width).toBe(8)
    // Half of a full circle is a half circle: one arc segment rather than the two a
    // complete one is drawn as.
    expect((drawn[0]!.path?.d.match(/A /g) ?? []).length).toBe(1)
  })

  it('takes the parameters it was constructed with', () => {
    const quarter = paths(
      render(app(`        Arc(sweep: 0.25).stroke(Color.red).frame(width: 100, height: 100)`, ARC)),
    )
    const full = paths(
      render(app(`        Arc(sweep: 1.0).stroke(Color.red).frame(width: 100, height: 100)`, ARC)),
    )

    expect(quarter[0]!.path?.d).not.toBe(full[0]!.path?.d)
  })

  it('gets its own size in a stack of differently sized shapes', () => {
    // The measurement is keyed per occurrence: sharing one key would give every arc
    // the size of whichever was measured last.
    const drawn = paths(
      render(
        app(
          `        VStack {
            Arc(sweep: 1.0).stroke(Color.red).frame(width: 40, height: 40)
            Arc(sweep: 1.0).stroke(Color.red).frame(width: 120, height: 120)
        }`,
          ARC,
        ),
      ),
    )

    expect(drawn.map((n) => Math.round(n.frame.width))).toEqual([40, 120])
    expect(drawn[0]!.path?.d).not.toBe(drawn[1]!.path?.d)
  })

  it('works inside a ForEach, where the same site expands many times', () => {
    const drawn = paths(
      render(
        app(
          `        HStack {
            ForEach(1...3, id: \\.self) { n in
                Wedge()
                    .fill(Color.purple)
                    .frame(width: 24, height: 24)
            }
        }`,
          WEDGE,
        ),
      ),
    )

    expect(drawn).toHaveLength(3)
    for (const node of drawn) expect(Math.round(node.frame.width)).toBe(24)
  })
})

describe('CGRect, as a shape reads it', () => {
  it('derives every edge and centre from the rect it was handed', () => {
    const source = app(
      `        Probe()
            .frame(width: 100, height: 50)`,
      `struct Probe: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.width, y: rect.height))
        return path
    }
}`,
    )

    expect(paths(render(source))[0]!.path?.d).toBe('M 0 0 L 50 25 L 100 50 L 100 50')
  })
})
