import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import type { CompileResult, CornerRadii, RenderNode } from '@studio/shared'
import { XCODE, typecheckInXcode } from './helpers/layer-project'

/**
 * What the Design panel's layer sections write, drawn as Xcode 27 draws it: corners,
 * Liquid Glass and Dynamic Type sizes. Each app is compiled the way the canvas compiles
 * it, and the render tree, or the markup drawn from it, is read back. Expected outlines
 * were traced from the iOS 27 simulator (iPhone 18 Pro, 3x).
 */

beforeEach(resetPipelineState)

const options = { canvas: { width: 393, height: 852 }, colorScheme: 'light' as const, safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } }
const app = (body: string, members = '') =>
  `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View {\n${members}\nvar body: some View { ${body} } }\n`

function run(text: string, extra: Partial<Parameters<typeof compile>[0]> = {}): CompileResult {
  const result = compile({ ...options, files: [{ id: 'App.swift', text }], revision: 1, ...extra })
  expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([])
  return result
}
const nodes = (text: string, extra?: Partial<Parameters<typeof compile>[0]>): readonly RenderNode[] => run(text, extra).renderTree!.nodes
const warnings = (text: string) => run(text).diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)
const markup = (text: string) => renderToStaticMarkup(createElement(RenderTreeView, { tree: run(text).renderTree!, onEvent: () => {} }))
const radii = (topLeading: number, bottomLeading: number, bottomTrailing: number, topTrailing: number): CornerRadii => ({ topLeading, bottomLeading, bottomTrailing, topTrailing })

/** Every path the markup draws: shapes' `d` and clips' `clip-path`. */
function paths(html: string): string[] {
  return [...html.matchAll(/ d="([^"]+)"/g), ...html.matchAll(/clip-path:path\(&quot;([^&]+)&quot;\)/g)].map((m) => m[1]!)
}

/** Points along SVG path data written with M, V, H, C, A and Z, every few hundredths of a point. */
function outline(d: string): [number, number][] {
  const tokens = d.match(/[MVHCAZ]|-?[\d.]+(?:e-?\d+)?/g)!
  const points: [number, number][] = []
  let at: [number, number] = [0, 0], i = 0, command = ''
  const next = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (/[MVHCAZ]/.test(tokens[i]!)) command = tokens[i++]!
    if (command === 'Z') break
    if (command === 'M') at = [next(), next()]
    else if (command === 'V' || command === 'H') {
      const to: [number, number] = command === 'V' ? [at[0], next()] : [next(), at[1]]
      const steps = Math.ceil(Math.hypot(to[0] - at[0], to[1] - at[1]) / 0.02)
      for (let t = 0; t <= steps; t++) points.push([at[0] + (to[0] - at[0]) * t / steps, at[1] + (to[1] - at[1]) * t / steps])
      at = to
    } else if (command === 'C') {
      const [a, b, c, e]: [number, number][] = [at, [next(), next()], [next(), next()], [next(), next()]]
      const bezier = (t: number, k: 0 | 1) => (1 - t) ** 3 * a![k] + 3 * (1 - t) ** 2 * t * b![k] + 3 * (1 - t) * t ** 2 * c![k] + t ** 3 * e![k]
      for (let t = 0; t <= 1; t += 1 / 400) points.push([bezier(t, 0), bezier(t, 1)])
      at = e!
    } else if (command === 'A') {
      // A quarter or less of a circle, clockwise: its centre is on the side the path turns to.
      const r = next(); next(); next(); next(); next()
      const to: [number, number] = [next(), next()]
      const mid = [(at[0] + to[0]) / 2, (at[1] + to[1]) / 2], half = Math.hypot(to[0] - at[0], to[1] - at[1]) / 2
      const away = Math.sqrt(Math.max(0, r * r - half * half)), dir = [(to[0] - at[0]) / (2 * half), (to[1] - at[1]) / (2 * half)]
      const centre = [mid[0]! - dir[1]! * away, mid[1]! + dir[0]! * away]
      const from = Math.atan2(at[1] - centre[1]!, at[0] - centre[0]!)
      let sweep = Math.atan2(to[1] - centre[1]!, to[0] - centre[0]!) - from
      if (sweep < 0) sweep += 2 * Math.PI
      for (let t = 0; t <= 1; t += 1 / 400) points.push([centre[0]! + r * Math.cos(from + sweep * t), centre[1]! + r * Math.sin(from + sweep * t)])
      at = to
    }
    points.push(at)
  }
  return points
}

type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
/** How far in from a shape's top or bottom edge its outline is, `along` points in from a side. */
function depth(points: readonly [number, number][], width: number, height: number, corner: Corner, along: number): number {
  const x = corner.endsWith('Left') ? along : width - along
  const near = points.filter(([px]) => Math.abs(px - x) < 0.05)
  return corner.startsWith('top') ? Math.min(...near.map(([, py]) => py)) : height - Math.max(...near.map(([, py]) => py))
}

describe('corners, each drawn with its own radius', () => {
  // Measured in the iOS 27 simulator, in points from the shape's top or bottom edge, where
  // the outline runs closer to the edge than to the side (the screenshot is exact there).
  const UNEVEN = 'UnevenRoundedRectangle(topLeadingRadius: 24, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 8)'
  const traced: readonly [Corner, number, number][] = [
    ['topLeft', 7.5, 6.57], ['topLeft', 10.5, 4.17], ['topLeft', 16.5, 1.47], ['topLeft', 24.5, 0.29],
    ['topRight', 2.5, 2.19], ['topRight', 3.5, 1.40], ['topRight', 6.5, 0.26],
    ['bottomRight', 5.5, 3.92], ['bottomRight', 8.5, 1.89], ['bottomRight', 14.5, 0.35],
    ['bottomLeft', 1.5, 0.87], ['bottomLeft', 2.5, 0.32],
  ]
  const tracedOutline = (d: string) => {
    const points = outline(d)
    for (const [corner, along, measured] of traced) expect(Math.abs(depth(points, 110, 80, corner, along) - measured), `${corner} ${along} pt in`).toBeLessThan(0.15)
  }

  it('draws an UnevenRoundedRectangle with each corner\'s radius, and says nothing about it', () => {
    const text = app(`${UNEVEN}.fill(.black).frame(width: 110, height: 80)`)
    const shape = nodes(text).find((n) => n.shape)!.shape!
    expect(shape).toMatchObject({ shape: 'roundedRectangle', cornerStyle: 'continuous', cornerRadii: radii(24, 4, 16, 8) })
    expect(warnings(text)).toEqual([])
    tracedOutline(paths(markup(text))[0]!)
  })

  it.each([
    ['.clipShape(.rect(topLeadingRadius: 24, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 8))'],
    ['.clipShape(.rect(cornerRadii: RectangleCornerRadii(topLeading: 24, bottomLeading: 4, bottomTrailing: 16, topTrailing: 8)))'],
    ['.clipShape(.rect(cornerRadii: .init(topLeading: 24, bottomLeading: 4, bottomTrailing: 16, topTrailing: 8)))'],
    [`.clipShape(${UNEVEN})`],
    ['.clipShape(UnevenRoundedRectangle(cornerRadii: .init(topLeading: 24, bottomLeading: 4, bottomTrailing: 16, topTrailing: 8)))'],
  ])('clips to each corner\'s radius: %s', (clip) => {
    const text = app(`Color.black.frame(width: 110, height: 80)${clip}`)
    const clipped = nodes(text).find((n) => n.clipShape)!
    expect(clipped.clipShape).toEqual({ kind: 'roundedRectangle', cornerStyle: 'continuous', cornerRadii: radii(24, 4, 16, 8) })
    expect(warnings(text)).toEqual([])
    tracedOutline(paths(markup(text))[0]!)
  })

  it.each([
    ['.background(.black, in: .rect(topLeadingRadius: 24, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 8))'],
    [`.background(.black, in: ${UNEVEN})`],
  ])('fills a background cut to each corner\'s radius: %s', (background) => {
    const text = app(`Color.clear.frame(width: 110, height: 80)${background}`)
    expect(nodes(text).find((n) => n.clipShape)!.clipShape!.cornerRadii).toEqual(radii(24, 4, 16, 8))
    tracedOutline(paths(markup(text))[0]!)
  })

  it('puts leading corners on the left, as the preview lays out left to right', () => {
    const points = outline(paths(markup(app('UnevenRoundedRectangle(topLeadingRadius: 30, bottomTrailingRadius: 30, style: .circular).frame(width: 100, height: 80)')))[0]!)
    expect(depth(points, 100, 80, 'topLeft', 5)).toBeCloseTo(30 - Math.sqrt(30 ** 2 - 25 ** 2), 1)
    expect(depth(points, 100, 80, 'bottomRight', 5)).toBeCloseTo(30 - Math.sqrt(30 ** 2 - 25 ** 2), 1)
    expect(depth(points, 100, 80, 'topRight', 1)).toBe(0)
    expect(depth(points, 100, 80, 'bottomLeft', 1)).toBe(0)
  })

  it('shares a short side between its corners as the simulator does: a chat bubble', () => {
    // 18, 18, 4 and 18 on a 160 by 40 bubble: the left side is too short for two
    // continuous corners, so they are rounder there; the right side's top corner is not.
    const points = outline(paths(markup(app('UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 4, topTrailingRadius: 18).fill(.black).frame(width: 160, height: 40)')))[0]!)
    const across = (y: number, side: 'left' | 'right') => {
      const row = points.filter(([, py]) => Math.abs(py - y) < 0.05).map(([px]) => px)
      return side === 'left' ? Math.min(...row) : 160 - Math.max(...row)
    }
    for (const [y, left, right] of [[9.5, 2.15, 2.18], [12.5, 0.89, 1.09], [15.5, 0.23, 0.49], [18.5, 0.05, 0.22]] as const) {
      expect(Math.abs(across(y, 'left') - left), `left, ${y} pt down`).toBeLessThan(0.15)
      expect(Math.abs(across(y, 'right') - right), `right, ${y} pt down`).toBeLessThan(0.15)
    }
  })
})

describe('continuous corners, the Xcode 27 default', () => {
  it.each([
    ['RoundedRectangle(cornerRadius: 12)', 'continuous'],
    ['RoundedRectangle(cornerRadius: 12, style: .continuous)', 'continuous'],
    ['RoundedRectangle(cornerRadius: 12, style: .circular)', 'circular'],
    ['UnevenRoundedRectangle(topLeadingRadius: 12)', 'continuous'],
    ['UnevenRoundedRectangle(topLeadingRadius: 12, style: .circular)', 'circular'],
    ['Capsule()', 'continuous'],
    ['Capsule(style: .circular)', 'circular'],
  ])('draws %s with %s corners', (shape, style) => {
    expect(nodes(app(`${shape}.frame(width: 110, height: 80)`)).find((n) => n.shape)!.shape!.cornerStyle).toBe(style)
  })

  it.each([
    ['.clipShape(.rect(cornerRadius: 24))', 'continuous'],
    ['.clipShape(.rect(cornerRadius: 24, style: .circular))', 'circular'],
    ['.clipShape(RoundedRectangle(cornerRadius: 24))', 'continuous'],
    ['.background(.black, in: .rect(cornerRadius: 24))', 'continuous'],
    ['.cornerRadius(24)', 'continuous'],
    ['.clipShape(.capsule)', 'continuous'],
    ['.clipShape(.capsule(style: .circular))', 'circular'],
  ])('clips %s with %s corners', (clip, style) => {
    expect(nodes(app(`Color.black.frame(width: 110, height: 80)${clip}`)).find((n) => n.clipShape)!.clipShape!.cornerStyle).toBe(style)
  })

  // Depth below the top edge at each distance in from the left, from the simulator, where
  // the outline runs closer to the top than to the side.
  it.each([
    ['RoundedRectangle(cornerRadius: 8)', 60, 60, [[2.5, 2.19], [3.5, 1.40], [5.5, 0.49], [8.5, 0.09]]],
    ['RoundedRectangle(cornerRadius: 12)', 110, 80, [[3.5, 3.53], [6.5, 1.39], [10.5, 0.29], [14.5, 0.07]]],
    ['RoundedRectangle(cornerRadius: 16)', 60, 60, [[5.5, 3.92], [9.5, 1.48], [14.5, 0.35], [19.5, 0.09]]],
    ['RoundedRectangle(cornerRadius: 24)', 110, 80, [[7.5, 6.57], [10.5, 4.17], [16.5, 1.47], [24.5, 0.29], [30.5, 0.10]]],
    // Its ends are half circles, and its long sides still ease in.
    ['Capsule()', 120, 40, [[6.5, 5.24], [10.5, 2.47], [16.5, 0.62], [22.5, 0.16]]],
    // A circle, where the radius is half the side.
    ['RoundedRectangle(cornerRadius: 30)', 60, 60, [[10.5, 7.19], [15.5, 3.76], [20.5, 1.53], [25.5, 0.34]]],
  ] as const)('curves %s on %s by %s as the simulator does', (shape, width, height, measured) => {
    const points = outline(paths(markup(app(`${shape}.fill(.black).frame(width: ${width}, height: ${height})`)))[0]!)
    for (const [along, value] of measured) expect(Math.abs(depth(points, width, height, 'topLeft', along) - value), `${along} pt in`).toBeLessThan(0.12)
  })

  it('draws a circular corner as a plain arc', () => {
    expect(paths(markup(app('RoundedRectangle(cornerRadius: 12, style: .circular).frame(width: 110, height: 80)')))[0]).toContain('A 12 12 0 0 1')
    expect(paths(markup(app('Color.black.frame(width: 110, height: 80).clipShape(.rect(topLeadingRadius: 20, style: .circular))')))[0]).toContain('A 20 20 0 0 1 20 0')
  })
})

describe('Liquid Glass, drawn as a translucent material with a light rim', () => {
  /**
   * Measured over coloured stripes in the iOS 27 simulator: `.regular` glass lightens what
   * is behind it by about 40% and blurs it over about 6 pt; `.clear` lightens it by about
   * 12% and hardly blurs it; a tint covers it at about 90%. Lighter than `.regularMaterial`,
   * which the simulator frosts by about 80%, so the two read differently in the preview too.
   */
  const REGULAR = { opacity: 0.4, blur: 6, light: true }
  const CLEAR = { opacity: 0.12, blur: 1, light: true }
  /** The glass's blurred pane, and the shapes drawn over exactly its box: the tint and the rim. */
  const glassOf = (text: string, extra?: Partial<Parameters<typeof compile>[0]>) => {
    const all = nodes(text, extra)
    const pane = all.find((n) => n.material)
    const shapes = all.filter((n) => n.shape && pane && JSON.stringify(n.frame) === JSON.stringify(pane.frame) && n.parent === pane.parent)
    return { all, pane, tint: shapes.find((n) => n.shape!.fill), rims: shapes.filter((n) => n.shape!.stroke) }
  }

  it('puts a capsule of regular glass behind the view, as .glassEffect() does', () => {
    const { all, pane, rims } = glassOf(app('Text("Glass").padding().glassEffect()'))
    const text = all.find((n) => n.text)!
    expect(pane!.material).toEqual(REGULAR)
    expect(pane!.clipShape).toEqual({ kind: 'capsule', cornerStyle: 'continuous' })
    expect(pane!.parent).toBeUndefined()
    expect([pane!.frame.width, pane!.frame.height]).toEqual([text.frame.width + 32, text.frame.height + 32])
    expect(pane!.z).toBeLessThan(text.z)
    expect(rims.length).toBeGreaterThan(0)
    for (const rim of rims) expect(rim.shape).toMatchObject({ shape: 'capsule', cornerStyle: 'continuous', stroke: { placement: 'inside' } })
    expect(rims.some((rim) => rim.shape!.stroke!.color.r === 255 && rim.shape!.stroke!.color.a < 1)).toBe(true)
  })

  it('cuts the glass to the shape it is given', () => {
    const { pane, rims } = glassOf(app('Color.clear.frame(width: 160, height: 80).glassEffect(.regular, in: .rect(cornerRadius: 16))'))
    expect(pane!.material).toEqual(REGULAR)
    expect(pane!.clipShape).toEqual({ kind: 'roundedRectangle', cornerStyle: 'continuous' })
    expect(pane!.cornerRadius).toBe(16)
    expect(rims[0]!.shape).toMatchObject({ shape: 'roundedRectangle', cornerRadius: 16, cornerStyle: 'continuous' })
    expect(markup(app('Color.clear.frame(width: 160, height: 80).glassEffect(.regular, in: .rect(cornerRadius: 16))'))).toMatch(/clip-path:path\(&quot;M 160 40[^"]*backdrop-filter:blur\(6px\)/)
  })

  it('cuts it to each corner\'s radius', () => {
    const { pane } = glassOf(app('Color.clear.frame(width: 160, height: 80).glassEffect(.regular, in: .rect(topLeadingRadius: 24, bottomTrailingRadius: 8))'))
    expect(pane!.clipShape).toEqual({ kind: 'roundedRectangle', cornerStyle: 'continuous', cornerRadii: radii(24, 0, 8, 0) })
  })

  it('covers it with the tint, as .regular.tint(_:) does', () => {
    const { pane, tint } = glassOf(app('Color.clear.frame(width: 160, height: 80).glassEffect(.regular.tint(.blue), in: .rect(cornerRadius: 16))'))
    expect(pane!.material).toEqual(REGULAR)
    expect(tint!.shape).toMatchObject({ shape: 'roundedRectangle', cornerRadius: 16, fill: { kind: 'solid', color: { r: 0, g: 136, b: 255, a: 0.9 } } })
    expect(tint!.z).toBeGreaterThan(pane!.z)
  })

  it('covers it with a translucent tint by that much less', () => {
    const { tint } = glassOf(app('Color.clear.frame(width: 160, height: 80).glassEffect(.regular.tint(.orange.opacity(0.5)))'))
    expect(tint!.shape!.fill).toEqual({ kind: 'solid', color: { r: 255, g: 141, b: 40, a: 0.45 } })
  })

  it('draws .clear glass lighter, and .interactive() glass as it draws at rest', () => {
    expect(glassOf(app('Text("Clear").padding().glassEffect(.clear)')).pane!.material).toEqual(CLEAR)
    expect(glassOf(app('Text("Tap").padding().glassEffect(.regular.interactive())')).pane!.material).toEqual(REGULAR)
    expect(glassOf(app('Text("Tap").padding().glassEffect(.clear.interactive().tint(.red))')).pane!.material).toEqual(CLEAR)
    expect(glassOf(app('Text("Glass").padding().glassEffect(Glass.regular)')).pane!.material).toEqual(REGULAR)
  })

  it('draws dark glass in dark mode', () => {
    expect(glassOf(app('Text("Glass").padding().glassEffect()'), { colorScheme: 'dark' }).pane!.material).toEqual({ ...REGULAR, light: false })
  })

  it('draws nothing for .identity, which is glass switched off', () => {
    expect(nodes(app('Text("Plain").padding().glassEffect(.identity)')).some((n) => n.material)).toBe(false)
  })
})

describe('a material cut to a shape still blurs what is behind it', () => {
  // A browser blurs nothing behind a box whose parent is cut with clip-path, so the
  // material's own box is cut to the shape instead.
  it.each([
    ['Color.clear.frame(width: 160, height: 80).background(.regularMaterial, in: .rect(cornerRadius: 16))'],
    ['RoundedRectangle(cornerRadius: 16).fill(.regularMaterial).frame(width: 160, height: 80)'],
  ])('%s', (body) => {
    const pane = nodes(app(body)).find((n) => n.material)!
    expect(pane.clipShape).toEqual({ kind: 'roundedRectangle', cornerStyle: 'continuous' })
    expect(pane.cornerRadius).toBe(16)
    expect(pane.parent).toBeUndefined()
  })
})

describe('@ScaledMetric, which grows with the canvas\'s Dynamic Type size', () => {
  // Printed by the iOS 27 simulator for each Dynamic Type size, set with `.dynamicTypeSize`.
  const NATIVE = {
    title24: { xSmall: 22, medium: 23.333, large: 24, xLarge: 25.333, xxxLarge: 29, accessibility1: 32.333, accessibility3: 40.333, accessibility5: 48 },
    body16: { xSmall: 13.667, medium: 15.333, large: 16, xLarge: 17.333, xxxLarge: 21, accessibility1: 24.667, accessibility3: 35, accessibility5: 45 },
    caption10: { xSmall: 8, medium: 8, large: 10, xLarge: 12, xxxLarge: 14.333, accessibility1: 17, accessibility3: 24.333, accessibility5: 32 },
  } as const
  const sizes = Object.keys(NATIVE.title24) as (keyof typeof NATIVE.title24)[]
  const ICON = '@ScaledMetric(relativeTo: .title) var iconSize: CGFloat = 24'

  it.each(sizes)('draws .system(size: iconSize, weight: .semibold) at the size the simulator does at %s', (size) => {
    const image = nodes(app('Image(systemName: "star").font(.system(size: iconSize, weight: .semibold))', ICON), { dynamicTypeSize: size }).find((n) => n.image)!
    expect(image.image!.font.size).toBeCloseTo(NATIVE.title24[size], 2)
    expect(image.image!.font.weight).toBe(600)
  })

  it.each(sizes)('scales a plain @ScaledMetric as .body does, at %s', (size) => {
    const box = nodes(app('Color.red.frame(width: side, height: side)', '@ScaledMetric var side = 16'), { dynamicTypeSize: size }).find((n) => n.background && n.id !== 'screen')!
    expect(box.frame.width).toBeCloseTo(NATIVE.body16[size], 2)
    expect(box.frame.height).toBeCloseTo(NATIVE.body16[size], 2)
  })

  it.each(sizes)('scales one relative to .caption on its own curve, at %s', (size) => {
    const text = nodes(app('Text("Hi").font(.system(size: size))', '@ScaledMetric(relativeTo: .caption) private var size: CGFloat = 10'), { dynamicTypeSize: size }).find((n) => n.text)!
    expect(text.text!.runs[0]!.font.size).toBeCloseTo(NATIVE.caption10[size], 2)
  })

  it('follows .dynamicTypeSize set on a view, as the simulator measured it', () => {
    const probe = 'struct Probe: View {\n  @ScaledMetric(relativeTo: .title) var iconSize: CGFloat = 24\n  var body: some View { Image(systemName: "star").font(.system(size: iconSize)) }\n}\n'
    const images = nodes(app('VStack { Probe().dynamicTypeSize(.accessibility3); Probe(); Probe().dynamicTypeSize(.xSmall) }') + probe).filter((n) => n.image)
    expect(images.map((n) => Math.round(n.image!.font.size * 1000) / 1000)).toEqual([40.333, 24, 22])
  })

  it('keeps the value it is given when written, as SwiftUI scales what it is handed', () => {
    const probe = 'struct Badge: View {\n  @ScaledMetric var side: CGFloat = 16\n  var body: some View { Color.blue.frame(width: side, height: 10) }\n}\n'
    const boxes = nodes(app('VStack { Badge(side: 20); Badge() }') + probe, { dynamicTypeSize: 'xxxLarge' }).filter((n) => n.background && n.frame.height === 10)
    // 20 relative to .body at xxxLarge: 20 x 29 / 22, to the third of a point.
    expect(boxes.map((n) => n.frame.width)).toEqual([26 + 1 / 3, 21])
  })

  it('reads as a number in code, and stays the declared value at the default size', () => {
    const text = nodes(app('Text("\\(Int(gap * 10))")', '@ScaledMetric(relativeTo: .headline) var gap = 20.0'), { dynamicTypeSize: 'accessibility5' }).find((n) => n.text)!
    // 20 relative to .headline at accessibility5: 56.33, measured.
    expect(text.text!.runs[0]!.text).toBe('563')
    expect(nodes(app('Text("\\(Int(gap * 10))")', '@ScaledMetric(relativeTo: .headline) var gap = 20.0')).find((n) => n.text)!.text!.runs[0]!.text).toBe('200')
  })
})

/**
 * The Swift these tests draw is real SwiftUI: every form type-checks in Xcode 27 with
 * warnings as errors. Opt-in: `XCODE_BUILD=1 npx vitest run tests/layer-runtime.test.ts`.
 */
describe.skipIf(!XCODE)('the forms drawn here build in Xcode 27', () => {
  it('type-checks every corner, glass and scaled form', () => {
    typecheckInXcode([`import SwiftUI

struct Forms: View {
    @ScaledMetric(relativeTo: .title) var iconSize: CGFloat = 24
    @ScaledMetric var side = 16
    @ScaledMetric(relativeTo: .caption) private var size: CGFloat = 10
    @ScaledMetric(relativeTo: .headline) var gap = 20.0
    var body: some View {
        VStack {
            UnevenRoundedRectangle(topLeadingRadius: 24, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 8).fill(.black).frame(width: 110, height: 80)
            Color.black.frame(width: 110, height: 80).clipShape(.rect(topLeadingRadius: 24, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 8))
            Color.black.frame(width: 110, height: 80).clipShape(.rect(cornerRadii: RectangleCornerRadii(topLeading: 24, bottomLeading: 4, bottomTrailing: 16, topTrailing: 8)))
            Color.black.frame(width: 110, height: 80).clipShape(.rect(cornerRadii: .init(topLeading: 24, bottomLeading: 4, bottomTrailing: 16, topTrailing: 8)))
            Color.black.frame(width: 110, height: 80).clipShape(UnevenRoundedRectangle(cornerRadii: .init(topLeading: 24, bottomLeading: 4, bottomTrailing: 16, topTrailing: 8)))
            Color.clear.frame(width: 110, height: 80).background(.black, in: .rect(topLeadingRadius: 24, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 8))
            UnevenRoundedRectangle(topLeadingRadius: 30, bottomTrailingRadius: 30, style: .circular).frame(width: 100, height: 80)
            Color.black.frame(width: 110, height: 80).clipShape(.rect(cornerRadius: 24, style: .circular))
            Color.black.frame(width: 110, height: 80).clipShape(.capsule(style: .circular))
            Color.black.frame(width: 110, height: 80).clipShape(.rect(topLeadingRadius: 20, style: .circular))
            Capsule(style: .circular).frame(width: 110, height: 80)
            Text("Glass").padding().glassEffect()
            Color.clear.frame(width: 160, height: 80).glassEffect(.regular, in: .rect(cornerRadius: 16))
            Color.clear.frame(width: 160, height: 80).glassEffect(.regular, in: .rect(topLeadingRadius: 24, bottomTrailingRadius: 8))
            Color.clear.frame(width: 160, height: 80).glassEffect(.regular.tint(.blue), in: .rect(cornerRadius: 16))
            Color.clear.frame(width: 160, height: 80).glassEffect(.regular.tint(.orange.opacity(0.5)))
            Text("Clear").padding().glassEffect(.clear)
            Text("Tap").padding().glassEffect(.regular.interactive())
            Text("Tap").padding().glassEffect(.clear.interactive().tint(.red))
            Text("Glass").padding().glassEffect(Glass.regular)
            Text("Plain").padding().glassEffect(.identity)
            Color.clear.frame(width: 160, height: 80).background(.regularMaterial, in: .rect(cornerRadius: 16))
            RoundedRectangle(cornerRadius: 16).fill(.regularMaterial).frame(width: 160, height: 80)
            Image(systemName: "star").font(.system(size: iconSize, weight: .semibold))
            Color.red.frame(width: side, height: side)
            Text("Hi").font(.system(size: size))
            Text("\\(Int(gap * 10))")
            Badge(side: 20)
            Badge().dynamicTypeSize(.accessibility3)
        }
    }
}

struct Badge: View {
    @ScaledMetric var side: CGFloat = 16
    var body: some View { Color.blue.frame(width: side, height: 10) }
}
`])
  }, 120_000)
})
