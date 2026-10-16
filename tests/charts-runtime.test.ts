import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CompileResult, RenderNode } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { DEVICES } from '@studio/sim-shell'
import { worldFrame } from './render-geometry'
import { XCODE, typecheckInXcode } from './helpers/layer-project'

/**
 * Swift Charts (Wave 6e), read from the render tree `compile` emits: marks, axes, grid,
 * palette, legend, the chart modifiers and annotations. Each expectation comes from
 * docs/parity/native/iphone18pro-charts/measurements.json, captured from
 * tests/fixtures/ios27-charts-6e.swift, whose screens these sources copy: a headline over a
 * chart 240 tall, in a column padded 16. Axis label widths here are the layout's estimates
 * (Node has no fonts), so the y axis column is checked against them, not against iOS's.
 */

// The days are counted in the device's time zone; these are written for UTC.
process.env.TZ = 'UTC'
const native = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-charts/measurements.json', import.meta.url), 'utf8'))
/** Edges read from the screenshots, in points. */
const edges = native.edges
const device = DEVICES['iphone-18-pro']
let revision = 1
/** Every source drawn here, type-checked in Xcode 27 at the end. */
const sources: string[] = []

/** What the fixture printed for a screen: frames by name, and each probed value's position. */
function measured(screen: string) {
  const frames: Record<string, number[]> = {}, ys: Record<string, number> = {}, xs: Record<string, number> = {}
  for (const line of native.frames[screen] as string[]) {
    const parts = line.split(' ')
    const probe = parts.length === 5 ? /-([xy])$/.exec(parts[0]!)?.[1] : undefined
    if (probe === 'y') ys[parts[1]!] = Number(parts[2])
    else if (probe === 'x') xs[parts[1]!] = Number(parts[2])
    else frames[parts.slice(0, -4).join(' ')] = parts.slice(-4).map(Number)
  }
  return { frames, ys, xs }
}

const DATA = `struct Day: Identifiable {
    let id: Int
    let day: String
    let steps: Double
}

let week = [
    Day(id: 0, day: "Mon", steps: 4200),
    Day(id: 1, day: "Tue", steps: 6100),
    Day(id: 2, day: "Wed", steps: 8800),
    Day(id: 3, day: "Thu", steps: 5300),
    Day(id: 4, day: "Fri", steps: 7400),
]

struct Sale: Identifiable {
    let id: Int
    let month: String
    let product: String
    let amount: Double
}

let sales = [
    Sale(id: 0, month: "Jan", product: "Coffee", amount: 30),
    Sale(id: 1, month: "Jan", product: "Tea", amount: 20),
    Sale(id: 2, month: "Jan", product: "Juice", amount: 10),
    Sale(id: 3, month: "Feb", product: "Coffee", amount: 40),
    Sale(id: 4, month: "Feb", product: "Tea", amount: 15),
    Sale(id: 5, month: "Feb", product: "Juice", amount: 25),
    Sale(id: 6, month: "Mar", product: "Coffee", amount: 35),
    Sale(id: 7, month: "Mar", product: "Tea", amount: 30),
    Sale(id: 8, month: "Mar", product: "Juice", amount: 5),
]

struct Share: Identifiable {
    let id: Int
    let name: String
    let amount: Double
}

let shares = [
    Share(id: 0, name: "Rent", amount: 45),
    Share(id: 1, name: "Food", amount: 25),
    Share(id: 2, name: "Travel", amount: 15),
    Share(id: 3, name: "Other", amount: 15),
]
`

/** A chart as the fixture's screens draw it: a headline over it, 240 tall, in a padded column. */
function run(chart: string, options: { scheme?: 'light' | 'dark'; target?: number; frame?: string; data?: string } = {}): CompileResult {
  const text = `${options.target ? `// target: iOS ${options.target}\n` : ''}import SwiftUI\nimport Charts\n\n${options.data ?? DATA}\n@main\nstruct ProbeApp: App {\n    var body: some Scene {\n        WindowGroup { RootView() }\n    }\n}\n\nstruct RootView: View {\n    var body: some View {\n        VStack(alignment: .leading, spacing: 12) {\n            Text("Title").font(.headline)\n            ${chart}\n            ${options.frame ?? '.frame(height: 240)'}\n            Spacer()\n        }\n        .padding()\n    }\n}\n`
  sources.push(text)
  resetPipelineState()
  const result = compile({
    files: [{ id: 'App.swift', text }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: options.scheme ?? 'light',
    revision: revision++,
  })
  expect(result.diagnostics.map(d => d.message)).toEqual([])
  return result
}

const nodes = (r: CompileResult) => r.renderTree?.nodes ?? []
const frame = (r: CompileResult, node: RenderNode) => worldFrame(nodes(r), node)
const words = (node: RenderNode) => node.text?.runs.map(run => run.text).join('') ?? ''
const textNode = (r: CompileResult, text: string) => nodes(r).find(n => words(n) === text)!
const texts = (r: CompileResult) => nodes(r).map(words).filter(Boolean)
const rgb = (c: { r: number; g: number; b: number } | undefined) => c && [c.r, c.g, c.b]
const near = (value: number, expected: number, within = 0.5) => expect(Math.abs(value - expected), `${value} is not ${expected}`).toBeLessThanOrEqual(within)
/** Filled rectangles, left to right then top to bottom: the bars. */
const bars = (r: CompileResult) => nodes(r).filter(n => n.kind === 'shape' && n.shape?.shape === 'roundedRectangle' && n.shape.fill?.kind === 'solid')
  .map(n => ({ node: n, frame: frame(r, n), fill: n.shape!.fill!.kind === 'solid' ? rgb(n.shape!.fill!.color) : undefined, radii: n.shape!.cornerRadii }))
  .sort((a, b) => a.frame.x - b.frame.x || a.frame.y - b.frame.y)
const paths = (r: CompileResult) => nodes(r).filter(n => n.kind === 'path')
const strokes = (r: CompileResult) => paths(r).filter(n => n.path?.stroke && !n.path.fill)
/** A straight line's two ends, from its path data, in the window. */
function ends(r: CompileResult, node: RenderNode) {
  const [x1, y1, x2, y2] = (node.path!.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number) as [number, number, number, number]
  const f = frame(r, node)
  return { x1: f.x + x1, y1: f.y + y1, x2: f.x + x2, y2: f.y + y2 }
}
const centreX = (f: { x: number; width: number }) => f.x + f.width / 2
const centreY = (f: { y: number; height: number }) => f.y + f.height / 2

describe('a bar chart', () => {
  const screen = measured('bar')
  const chart = `Chart(week) { item in\n                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }`

  it('is drawn, with no placeholder and no warning', () => {
    const r = run(chart)
    expect(nodes(r).some(n => n.kind === 'placeholder')).toBe(false)
    expect(bars(r)).toHaveLength(5)
  })

  it('rounds its values axis to nice ticks, labelled with grouped thousands down the trailing side', () => {
    const r = run(chart)
    expect(texts(r).slice(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', '0', '2,500', '5,000', '7,500', '10,000'])
    // Each label is centred on its tick: 10,000 at the chart's top, 0 at the plot's bottom.
    near(centreY(frame(r, textNode(r, '10,000'))), screen.ys['10000.0']!)
    near(centreY(frame(r, textNode(r, '0'))), screen.ys['0.0']!)
    near(centreY(frame(r, textNode(r, '5,000'))), (screen.ys['4000.0']! + screen.ys['6000.0']!) / 2)
  })

  it('draws each bar 0.7 of its band, centred, from zero to its value, rounded 2 pt at its top only', () => {
    const r = run(chart)
    const [mon, , wed, , fri] = bars(r)
    // Native: Mon's bar from 25.70 to 71.97 in the band from 16 to 82, so it starts 0.147 of the
    // band in and is 0.701 of it. The estimated labels make the band a little wider here.
    const nativeBand = (screen.xs['Fri']! - screen.xs['Mon']!) / 4, band = (centreX(fri!.frame) - centreX(mon!.frame)) / 4
    near(mon!.frame.width / band, (edges['bar Mon'].right - edges['bar Mon'].left) / nativeBand, 0.004)
    near((mon!.frame.x - 16) / band, (edges['bar Mon'].left - 16) / nativeBand, 0.004)
    near(mon!.frame.y + mon!.frame.height, screen.ys['0.0']!)
    near(wed!.frame.y, screen.ys['0.0']! - 8800 / 10000 * (screen.ys['0.0']! - screen.ys['10000.0']!))
    expect(mon!.radii).toEqual({ topLeading: 2, topTrailing: 2, bottomLeading: 0, bottomTrailing: 0 })
    expect(mon!.fill).toEqual([0, 136, 255])
  })

  it('puts each day under its bar, 4 below the plot in .caption2 secondaryLabel', () => {
    const r = run(chart)
    const mon = textNode(r, 'Mon')
    near(centreX(frame(r, mon)), centreX(bars(r)[0]!.frame), 0.05)
    // Native: the M's ink top at 339.0, 2.67 below its line box (native.fonts), so the box is 4 below the plot.
    near(frame(r, mon).y, screen.ys['0.0']! + 4)
    expect(mon.text!.runs[0]!.font.size).toBe(11)
    expect(rgb(mon.text!.runs[0]!.color)).toEqual([60, 60, 67])
    near(mon.text!.runs[0]!.color.a, 0.6, 0.01)
  })

  it('draws grid lines in tertiaryLabel, 0.5 pt: solid across at each tick, dashed 2 on 2 down at each band edge into the label row', () => {
    const r = run(chart)
    const lines = strokes(r).map(n => ({ n, e: ends(r, n) }))
    const across = lines.filter(l => l.e.y1 === l.e.y2), down = lines.filter(l => l.e.x1 === l.e.x2)
    expect(across).toHaveLength(5)
    expect(down).toHaveLength(6)
    for (const { n } of lines) {
      expect(n.path!.stroke!.width).toBe(0.5)
      expect(rgb(n.path!.stroke!.color)).toEqual([60, 60, 67])
      near(n.path!.stroke!.color.a, 0.3, 0.01)
    }
    expect(across.every(l => !l.n.path!.stroke!.dash?.length)).toBe(true)
    expect(down.every(l => l.n.path!.stroke!.dash?.join() === '2,2')).toBe(true)
    near(down[0]!.e.y1, screen.frames['chart']![1]!)
    near(down[0]!.e.y2, screen.frames['chart']![1]! + screen.frames['chart']![3]!)
  })

  it('is painted by the DOM renderer as the shapes, paths and text it already draws', () => {
    const r = run(chart)
    expect(new Set(nodes(r).map(n => n.kind))).toEqual(new Set(['layer', 'text', 'path', 'shape']))
    const html = renderToStaticMarkup(createElement(RenderTreeView, { tree: r.renderTree! }))
    expect(html).toContain('stroke-dasharray="2 2"')
    expect(html.match(/data-kind="shape"/g)).toHaveLength(5)
  })

  it('takes the height it is given, and 100 in a ScrollView with nothing to give', () => {
    const plain = measured('scroll')
    const text = `import SwiftUI\nimport Charts\n\n${DATA}\n@main\nstruct ProbeApp: App {\n    var body: some Scene {\n        WindowGroup { RootView() }\n    }\n}\n\nstruct RootView: View {\n    var body: some View {\n        ScrollView {\n            VStack {\n                ${chart}\n            }\n            .padding()\n        }\n    }\n}\n`
    sources.push(text)
    resetPipelineState()
    const r = compile({ files: [{ id: 'App.swift', text }], canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: revision++ })
    const [mon] = bars(r)
    near(mon!.frame.y + mon!.frame.height, plain.frames['chart']![1]! + plain.frames['chart']![3]! - 18)
  })
})

describe('series', () => {
  it('stacks bars by foregroundStyle(by:) in first-seen order, in the palette, rounding only the stack top, with the legend below', () => {
    const screen = measured('bar-stacked')
    const r = run(`Chart(sales) { item in\n                BarMark(x: .value("Month", item.month), y: .value("Sales", item.amount))\n                    .foregroundStyle(by: .value("Product", item.product))\n            }`)
    const jan = bars(r).filter(b => b.frame.x < 100).sort((a, b) => b.frame.y - a.frame.y)
    expect(jan.map(b => b.fill)).toEqual([[0, 136, 255], [52, 199, 89], [255, 141, 40]])
    expect(jan.map(b => b.radii?.topLeading)).toEqual([0, 0, 2])
    // The legend takes 17.33 from the plot: 0 is at 315.01, not 332.33.
    near(jan[0]!.frame.y + jan[0]!.frame.height, screen.ys['0.0']!)
    near(jan[2]!.frame.y, screen.ys['60.0']!)
    expect(texts(r).slice(-3)).toEqual(['Coffee', 'Tea', 'Juice'])
    const coffee = frame(r, textNode(r, 'Coffee'))
    near(coffee.y + coffee.height, screen.frames['chart']![1]! + 240)
    const dots = nodes(r).filter(n => n.shape?.shape === 'circle')
    expect(dots.map(n => frame(r, n).width)).toEqual([8, 8, 8])
    near(frame(r, dots[0]!).x, 16)
    near(coffee.x - (frame(r, dots[0]!).x + 8), 5)
    near(frame(r, dots[1]!).x - (coffee.x + coffee.width), 8)
  })

  it('stacks each month in the order its data is written, as iOS does, not by series', () => {
    const screen = measured('bar-stacked')
    const data = DATA.replace(/let sales = \[[\s\S]*?\n\]\n/, `let sales = [
    Sale(id: 0, month: "Jan", product: "Coffee", amount: 30),
    Sale(id: 1, month: "Jan", product: "Tea", amount: 20),
    Sale(id: 2, month: "Feb", product: "Juice", amount: 25),
    Sale(id: 3, month: "Feb", product: "Tea", amount: 15),
    Sale(id: 4, month: "Feb", product: "Coffee", amount: 40),
    Sale(id: 5, month: "Mar", product: "Tea", amount: 30),
    Sale(id: 6, month: "Mar", product: "Juice", amount: 5),
    Sale(id: 7, month: "Mar", product: "Coffee", amount: 35),
]
`)
    const r = run(`Chart(sales) { item in\n                BarMark(x: .value("Month", item.month), y: .value("Sales", item.amount))\n                    .foregroundStyle(by: .value("Product", item.product))\n            }`, { data })
    // Feb, bottom to top: Juice, Tea, Coffee, in the series' colours, only the top rounded.
    const feb = bars(r).filter(b => centreX(b.frame) > 150 && centreX(b.frame) < 250).sort((a, b) => b.frame.y - a.frame.y)
    expect(feb.map(b => b.fill)).toEqual([[255, 141, 40], [52, 199, 89], [0, 136, 255]])
    expect(feb.map(b => b.radii?.topLeading)).toEqual([0, 0, 2])
    const native = edges['stack-order Feb']
    for (const [index, name] of ['Juice', 'Tea', 'Coffee'].entries()) {
      near(feb[index]!.frame.y + feb[index]!.frame.height, native[name][0])
      near(feb[index]!.frame.y, native[name][1])
    }
    expect(screen.ys['0.0']).toBeCloseTo(native.Juice[0], 0)
    expect(texts(r).slice(-3)).toEqual(['Coffee', 'Tea', 'Juice'])
  })

  it('takes the legend away with .chartLegend(.hidden), giving the plot its height back', () => {
    const screen = measured('legend-hidden')
    const r = run(`Chart(sales) { item in\n                BarMark(x: .value("Month", item.month), y: .value("Sales", item.amount))\n                    .foregroundStyle(by: .value("Product", item.product))\n            }\n            .chartLegend(.hidden)`)
    expect(texts(r)).not.toContain('Coffee')
    const jan = bars(r).filter(b => b.frame.x < 100).sort((a, b) => b.frame.y - a.frame.y)[0]!
    near(jan.frame.y + jan.frame.height, screen.ys['0.0']!)
  })

  it('groups bars side by side with .position(by:), each 0.7 of its share of the bar', () => {
    const screen = measured('bar-grouped')
    const r = run(`Chart(sales) { item in\n                BarMark(x: .value("Month", item.month), y: .value("Sales", item.amount))\n                    .foregroundStyle(by: .value("Product", item.product))\n                    .position(by: .value("Product", item.product))\n            }`)
    const all = bars(r)
    expect(all).toHaveLength(9)
    expect(texts(r)).toContain('40')
    const [coffee, tea, juice] = all
    // Native: Jan's three bars 19.05 wide, centred at 47.19, 74.5 and 101.81, in a band of 117
    // (Jan's centre to Mar's, halved). The estimated labels make the band a little wider here.
    const jan = edges['bar-grouped Jan'], nativeBand = (screen.xs['Mar']! - screen.xs['Jan']!) / 2
    const band = (centreX(all[6]!.frame) - centreX(coffee!.frame)) / 2
    for (const [index, bar] of [coffee, tea, juice].entries()) {
      near(bar!.frame.width / band, jan.width / nativeBand, 0.002)
      near((centreX(bar!.frame) - centreX(tea!.frame)) / band, (jan.centres[index] - jan.centres[1]) / nativeBand, 0.002)
    }
    expect([coffee, tea, juice].map(b => b!.fill)).toEqual([[0, 136, 255], [52, 199, 89], [255, 141, 40]])
    near(coffee!.frame.y, screen.ys['30.0']!)
  })

  it('colours ten series in the measured palette order, repeating after seven', () => {
    const data = 'let names = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]\n'
    const r = run(`Chart {\n                ForEach(names, id: \\.self) { name in\n                    BarMark(x: .value("Name", name), y: .value("Value", 5))\n                        .foregroundStyle(by: .value("Series", name))\n                }\n            }`, { data })
    expect(bars(r).map(b => b.fill)).toEqual([
      [0, 136, 255], [52, 199, 89], [255, 141, 40], [203, 48, 224], [255, 56, 60], [0, 195, 208], [255, 204, 0], [0, 136, 255], [52, 199, 89], [255, 141, 40],
    ])
    // 5 tops at 6, ticked by 2 (native palette-y: 5 at 144.45 of 0 at 315.01 and a plot 204.67 tall).
    expect(texts(r).filter(t => /^\d$/.test(t))).toEqual(['0', '2', '4', '6'])
  })

  it('draws the dark palette in dark mode', () => {
    const r = run(`Chart(sales) { item in\n                BarMark(x: .value("Month", item.month), y: .value("Sales", item.amount))\n                    .foregroundStyle(by: .value("Product", item.product))\n            }`, { scheme: 'dark' })
    const jan = bars(r).filter(b => b.frame.x < 100).sort((a, b) => b.frame.y - a.frame.y)
    expect(jan.map(b => b.fill)).toEqual([[0, 145, 255], [48, 209, 88], [255, 146, 48]])
    expect(rgb(textNode(r, 'Jan').text!.runs[0]!.color)).toEqual([235, 235, 245])
  })
})

describe('lines, points, areas and rules', () => {
  it('joins LineMarks in a 2 pt round line through the bands\' centres, with an 8 pt PointMark on each', () => {
    const screen = measured('line')
    const r = run(`Chart(week) { item in\n                LineMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n                PointMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }`)
    const line = strokes(r).find(n => n.path!.stroke!.width === 2)!
    expect(line.path!.stroke!.lineJoin).toBe('round')
    expect(rgb(line.path!.stroke!.color)).toEqual([0, 136, 255])
    const points = nodes(r).filter(n => n.shape?.shape === 'circle')
    expect(points).toHaveLength(5)
    const wed = frame(r, points[2]!)
    expect(wed.width).toBe(8)
    near(centreY(wed), screen.ys['0.0']! - 0.88 * (screen.ys['0.0']! - screen.ys['10000.0']!))
    // Wed is the middle band of five: its centre is the plot's.
    near(centreX(wed), (centreX(frame(r, points[0]!)) + centreX(frame(r, points[4]!))) / 2, 0.05)
  })

  it('fills an AreaMark solid in the accent from zero to the values', () => {
    const screen = measured('area')
    const r = run(`Chart(week) { item in\n                AreaMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }`)
    const area = paths(r).find(n => n.path!.fill)!
    expect(area.path!.fill).toEqual({ kind: 'solid', color: { r: 0, g: 136, b: 255, a: 1 } })
    const ys = (area.path!.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1).map(y => y + frame(r, area).y)
    near(Math.max(...ys), screen.ys['0.0']!)
    near(Math.min(...ys), screen.ys['0.0']! - 0.88 * (screen.ys['0.0']! - screen.ys['10000.0']!))
  })

  it('draws RuleMark(y:) as a 2 pt accent line across the plot, over the bars', () => {
    const screen = measured('rule')
    const r = run(`Chart {\n                ForEach(week) { item in\n                    BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n                }\n                RuleMark(y: .value("Goal", 6000))\n            }`)
    const rule = strokes(r).find(n => n.path!.stroke!.width === 2)!
    const e = ends(r, rule)
    near(e.y1, screen.ys['6000.0']!)
    expect(e.y1).toBe(e.y2)
    near(e.x1, 16)
    expect(rule.z).toBeGreaterThan(Math.max(...bars(r).map(b => b.node.z)))
  })

  it('paints a gradient .foregroundStyle along a LineMark and a RuleMark, across each mark\'s own extent', () => {
    const screen = measured('line')
    const r = run(`Chart {\n                ForEach(week) { item in\n                    LineMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n                        .foregroundStyle(LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing))\n                }\n                RuleMark(y: .value("Goal", 2000))\n                    .foregroundStyle(LinearGradient(colors: [.green, .orange], startPoint: .leading, endPoint: .trailing))\n            }`)
    const [line, rule] = strokes(r).filter(n => n.path!.stroke!.width === 2).sort((a, b) => ends(r, a).y1 - ends(r, b).y1)
    for (const [node, colours] of [[line!, [[255, 56, 60], [0, 136, 255]]], [rule!, [[52, 199, 89], [255, 141, 40]]]] as const) {
      const fill = node.path!.stroke!.fill!
      expect(fill.kind).toBe('linearGradient')
      if (fill.kind !== 'linearGradient') continue
      expect(fill.stops.map(stop => rgb(stop.color))).toEqual(colours)
      // Where one colour has to stand for the stroke, it is the first stop, never the accent.
      expect(rgb(node.path!.stroke!.color)).toEqual(colours[0])
    }
    // Native: the line is the red itself at Mon's point and the blue at Fri's, so the gradient
    // runs from the line's first point to its last; the rule's runs the plot, as the rule does.
    for (const node of [line!, rule!]) {
      const f = frame(r, node), g = node.path!.stroke!.fill as { start: { x: number }; end: { x: number } }
      const xs = (node.path!.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 0)
      near(g.start.x * f.width, Math.min(...xs), 0.05)
      near(g.end.x * f.width, Math.max(...xs), 0.05)
    }
    near(ends(r, line!).x1, screen.xs['Mon']!)
    near(ends(r, rule!).x1, 16, 0.05)
    const html = renderToStaticMarkup(createElement(RenderTreeView, { tree: r.renderTree! }))
    expect(html.match(/stroke="url\(#[^"]*-stroke\)"/g)).toHaveLength(2)
  })

  it('puts numbers on a numeric x axis 4 after their grid lines, leaving out the one at its end, and draws RuleMark(x:) down the plot', () => {
    const screen = measured('line-numeric')
    const data = 'struct Hour: Identifiable {\n    let id: Int\n    let hour: Int\n    let temperature: Double\n}\n\nlet hours = [\n    Hour(id: 0, hour: 0, temperature: 12),\n    Hour(id: 1, hour: 3, temperature: 10),\n    Hour(id: 2, hour: 6, temperature: 11),\n    Hour(id: 3, hour: 9, temperature: 16),\n    Hour(id: 4, hour: 12, temperature: 21),\n    Hour(id: 5, hour: 15, temperature: 23),\n    Hour(id: 6, hour: 18, temperature: 19),\n    Hour(id: 7, hour: 21, temperature: 15),\n]\n'
    const r = run(`Chart(hours) { item in\n                LineMark(x: .value("Hour", item.hour), y: .value("Temperature", item.temperature))\n                RuleMark(x: .value("Noon", 12))\n            }`, { data })
    // y 0 to 30 by 10, x 0 to 30 by 10 with 30 left out.
    expect(texts(r).slice(1)).toEqual(['0', '10', '20', '0', '10', '20', '30'])
    const zero = nodes(r).filter(n => words(n) === '0').map(n => frame(r, n)).find(f => f.x < 100)!
    near(zero.x, screen.xs['0.0']! + 4)
    const rule = strokes(r).find(n => n.path!.stroke!.width === 2 && ends(r, n).x1 === ends(r, n).x2)!
    const e = ends(r, rule)
    // Noon is 1.2 of the way from the 0 line to the 10 line, and runs the plot's height.
    const grid = strokes(r).filter(n => n.path!.stroke!.dash?.length).map(n => ends(r, n).x1).sort((a, b) => a - b)
    near(e.x1, grid[0]! + 1.2 * (grid[1]! - grid[0]!), 0.05)
    near(e.y1, screen.frames['chart']![1]!)
    near(e.y2, screen.ys['0.0']!)
  })
})

describe('sectors', () => {
  const pie = (inner: number, inset: number) => `Chart(shares) { item in\n                SectorMark(angle: .value("Amount", item.amount), innerRadius: .ratio(${inner}), angularInset: ${inset})\n                    .foregroundStyle(by: .value("Name", item.name))\n                    .annotation(position: .overlay) {\n                        Text("\\(Int(item.amount))").font(.caption)\n                    }\n            }`

  it('draws a pie from 12 o\'clock clockwise in data order, centred, half the plot\'s shorter side across, with no axes', () => {
    const r = run(pie(0, 0), { target: 17 })
    const wedges = paths(r).filter(n => n.path!.fill)
    expect(wedges).toHaveLength(4)
    expect(wedges.map(n => n.path!.fill!.kind === 'solid' && rgb(n.path!.fill!.color))).toEqual([[0, 136, 255], [52, 199, 89], [255, 141, 40], [203, 48, 224]])
    // Native: centre (201, 221.67), radius 111.33; Rent's wedge starts at the top.
    const first = wedges[0]!, f = frame(r, first)
    const [x0, y0] = (first.path!.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number) as [number, number]
    near(f.x + x0, 201)
    near(f.y + y0, 110.33)
    expect(strokes(r)).toEqual([])
    expect(texts(r)).toEqual(['Title', '45', '25', '15', '15', 'Rent', 'Food', 'Travel', 'Other'])
  })

  it('puts overlay annotations at the middle angle, 0.618 of the way out, in pie and donut alike', () => {
    for (const [screen, inner, inset] of [['sector', 0, 0], ['donut', 0.6, 1.5]] as const) {
      const r = run(pie(inner, inset), { target: 17 })
      // Native ink centres of "45" at (268.50, 211.17) and (294.00, 207.17); the line box sits about 0.5 lower.
      const label = frame(r, textNode(r, '45'))
      const expected = screen === 'sector' ? [268.5, 211.17] : [294, 207.17]
      near(centreX(label), expected[0]!, 1)
      near(centreY(label), expected[1]!, 1.2)
    }
  })

  it('draws nothing for a SectorMark\'s .top annotation, as iOS doesn\'t', () => {
    const r = run(`Chart(shares) { item in\n                SectorMark(angle: .value("Amount", item.amount))\n                    .foregroundStyle(by: .value("Name", item.name))\n                    .annotation(position: .top) {\n                        Text("\\(Int(item.amount))").font(.caption)\n                    }\n            }`, { target: 17 })
    expect(paths(r).filter(n => n.path!.fill)).toHaveLength(4)
    expect(texts(r)).toEqual(['Title', 'Rent', 'Food', 'Travel', 'Other'])
  })

  it('leaves a donut\'s hole 0.6 of the radius and a 3 pt gap between wedges for angularInset 1.5', () => {
    const r = run(pie(0.6, 1.5), { target: 17 })
    const rent = paths(r).find(n => n.path!.fill)!, f = frame(r, rent)
    const numbers = (rent.path!.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
    // The outer arc starts 1.5 right of the top: (202.5, 110.34), radius 111.33.
    near(f.x + numbers[0]!, 202.5, 0.05)
    near(numbers[2]!, 111.33, 0.05)
    // The arcs' radii, native 111.32 and 66.76 from the edges across the ring at its centre's height.
    const radii = [...rent.path!.d.matchAll(/A(\d+(?:\.\d+)?) /g)].map(m => Number(m[1]))
    near(radii[0]!, edges['donut at y 221.67'].outer, 0.1)
    near(radii[1]!, edges['donut at y 221.67'].hole, 0.1)
  })
})

describe('the chart modifiers', () => {
  it('hides both axes, giving the plot the whole frame and the tallest bar the top', () => {
    const screen = measured('hidden')
    const r = run(`Chart(week) { item in\n                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }\n            .chartXAxis(.hidden)\n            .chartYAxis(.hidden)`)
    expect(texts(r)).toEqual(['Title'])
    expect(strokes(r)).toEqual([])
    const [mon, , wed] = bars(r)
    near(centreX(mon!.frame), screen.xs['Mon']!, 0.05)
    near(wed!.frame.y, screen.ys['8800.0']!)
    near(mon!.frame.y + mon!.frame.height, screen.ys['0.0']!)
  })

  it('keeps .chartYScale(domain:) and ticks it as iOS does', () => {
    const screen = measured('domain')
    const r = run(`Chart(week) { item in\n                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }\n            .chartYScale(domain: 0...20000)`)
    expect(texts(r).slice(6)).toEqual(['0', '5,000', '10,000', '15,000', '20,000'])
    near(centreY(frame(r, textNode(r, '10,000'))), screen.ys['10000.0']!)
  })

  it('draws .annotation(position: .top) centred 4 above its bar', () => {
    const r = run(`Chart(week) { item in\n                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n                    .annotation(position: .top) {\n                        Text("\\(Int(item.steps))").font(.caption)\n                    }\n            }`)
    const wed = bars(r)[2]!, label = frame(r, textNode(r, '8,800'))
    near(label.y + label.height, wed.frame.y - 4, 0.05)
    near(centreX(label), centreX(wed.frame), 0.05)
    // Native: the caption's digits' ink tops at 121.33 for Wed, 2.83 below the box's top.
    near(label.y, 121.33 - 2.83)
  })

  it('draws a RuleMark\'s .top annotation 4 above a y rule, centred on the plot, and above the plot over an x rule', () => {
    const native = edges['rule-annotation']
    const r = run(`Chart {\n                ForEach(week) { item in\n                    BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n                }\n                RuleMark(y: .value("Goal", 6000))\n                    .annotation(position: .top) {\n                        Text("Goal").font(.caption)\n                    }\n                RuleMark(x: .value("Day", "Wed"))\n                    .annotation(position: .top) {\n                        Text("Mid").font(.caption)\n                    }\n            }`)
    const goal = frame(r, textNode(r, 'Goal')), mid = frame(r, textNode(r, 'Mid'))
    // Native ink: Goal's capitals start 2.83 below its .caption box, as the digits above bars do,
    // so its box ends 4 above the rule at 199.13; Mid sits on its baseline as Goal does, its box's
    // bottom 2.5 under the ink, 4 above the plot.
    near(goal.y, native['Goal ink'][1] - 2.83)
    near(mid.y + mid.height, native['Mid ink'][3] + 2.5, 0.6)
    // Native ink centres 180.33 and 180.67: Goal on the plot's centre (181), Mid on Wed's rule (181).
    const across = strokes(r).map(n => ends(r, n)).find(e => e.y1 === e.y2 && e.x2 - e.x1 > 200)!
    near(centreX(goal), (across.x1 + across.x2) / 2, 0.05)
    const wed = strokes(r).filter(n => n.path!.stroke!.width === 2).map(n => ends(r, n)).find(e => e.x1 === e.x2)!
    near(centreX(mid), wed.x1, 0.05)
  })

  it('adds a band for each category .chartXScale(domain:) names, in its order, leaving the empty ones empty', () => {
    const native = edges['xscale-category']
    const r = run(`Chart(week) { item in\n                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }\n            .chartXScale(domain: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])`)
    expect(texts(r).slice(1, 8)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    // Native: 7 bands of 47.14, Mon's bar from 23.0 to 56.0. The estimated labels make the band a little wider here.
    const [mon, tue] = bars(r)
    const band = centreX(tue!.frame) - centreX(mon!.frame)
    near(mon!.frame.width / band, (native['Mon bar'][1] - native['Mon bar'][0]) / native.band, 0.004)
    near((mon!.frame.x - 16) / band, (native['Mon bar'][0] - 16) / native.band, 0.004)
    expect(bars(r)).toHaveLength(5)
  })

  it('draws any other scale domain on categories or dates as a labelled box, never ignoring it', () => {
    /** The reason on the chart's labelled box. */
    const box = (chart: string) => {
      const placeholder = nodes(run(chart)).find(n => n.kind === 'placeholder')?.placeholder
      return placeholder && 'reason' in placeholder ? placeholder.reason : undefined
    }
    const dates = `Chart {\n                ForEach(0..<7, id: \\.self) { offset in\n                    BarMark(x: .value("Day", Date(timeIntervalSince1970: 1_781_524_800 + Double(offset) * 86_400), unit: .day), y: .value("Count", 3))\n                }\n            }\n            .chartXScale(domain: Date(timeIntervalSince1970: 1_781_352_000)...Date(timeIntervalSince1970: 1_782_302_400))`
    expect(box(dates)).toBe('This chart sets .chartXScale on an axis of dates, which the preview draws only as a list of categories along x. Xcode draws it as written.')
    expect(box(`Chart(week) { item in\n                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }\n            .chartXScale(domain: 0...10)`)).toMatch(/^This chart sets \.chartXScale on an axis of categories/)
    expect(box(`Chart(week) { item in\n                BarMark(x: .value("Steps", item.steps), y: .value("Day", item.day))\n            }\n            .chartYScale(domain: ["Mon", "Tue", "Wed", "Thu", "Fri"])`)).toMatch(/^This chart sets \.chartYScale on an axis of categories/)
    expect(box(`Chart(week) { item in\n                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }\n            .chartXScale(domain: ["Mon", "Tue"])`)).toBe('This chart has categories outside its .chartXScale domain, which the preview doesn\'t draw. Xcode draws it as written.')
    expect(box(`Chart(sales) { item in\n                BarMark(x: .value("Sales", item.amount), y: .value("Month", item.month))\n                    .position(by: .value("Product", item.product))\n            }`)).toBe('This chart groups horizontal bars with .position(by:), which the preview doesn\'t draw. Xcode draws it as written.')
  })

  it('draws nothing for a chart with no data, as iOS doesn\'t: no axes, grid or frame', () => {
    const r = run(`Chart(none) { item in\n                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }`, { data: `${DATA}\nlet none: [Day] = []\n` })
    expect(new Set(nodes(r).map(n => n.kind))).toEqual(new Set(['layer', 'text']))
    expect(texts(r)).toEqual(['Title'])
  })

  it('recolours unstyled marks with the chart\'s own .foregroundStyle', () => {
    const r = run(`Chart(week) { item in\n                BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))\n            }\n            .foregroundStyle(.red)`)
    expect(bars(r)[0]!.fill).toEqual([255, 56, 60])
  })
})

describe('other axes', () => {
  it('lays horizontal bars along a numeric x, each under its category\'s label inside the plot', () => {
    const screen = measured('bar-horizontal')
    const r = run(`Chart(week) { item in\n                BarMark(x: .value("Steps", item.steps), y: .value("Day", item.day))\n            }`)
    const [mon] = bars(r).sort((a, b) => a.frame.y - b.frame.y)
    // Native: Mon's bar from (16, 131.67) to (171.33, 150.67); its label's box at (20, 114.33).
    near(mon!.frame.x, 16)
    near(mon!.frame.y, 131.67)
    near(mon!.frame.y + mon!.frame.height, 150.67)
    near(mon!.frame.x + mon!.frame.width, screen.xs['0.0']! + 0.42 * (screen.xs['10000.0']! - screen.xs['0.0']!))
    expect(mon!.radii).toEqual({ topLeading: 0, bottomLeading: 0, topTrailing: 2, bottomTrailing: 2 })
    const label = frame(r, textNode(r, 'Mon'))
    near(label.x, 20)
    near(label.y, 114.33)
    expect(texts(r)).toEqual(['Title', '0', '2,500', '5,000', '7,500', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  })

  it('counts dates by day, labelling every second day of a week and the Sundays of a fortnight', () => {
    const days = (count: number) => `Chart {\n                ForEach(0..<${count}, id: \\.self) { offset in\n                    BarMark(\n                        x: .value("Day", Date(timeIntervalSince1970: 1_781_524_800 + Double(offset) * 86_400), unit: .day),\n                        y: .value("Count", Double(offset % 5 + 2))\n                    )\n                }\n            }`
    const week = run(days(7))
    expect(texts(week).filter(t => t.startsWith('Jun'))).toEqual(['Jun 15', 'Jun 17', 'Jun 19', 'Jun 21'])
    expect(bars(week)).toHaveLength(7)
    const label = frame(week, textNode(week, 'Jun 17'))
    // Native: Jun 17's label 4 after its band's leading edge, which is 2/7 of the plot along.
    near(label.x - 4 - 16, 2 * (bars(week)[1]!.frame.x - bars(week)[0]!.frame.x), 0.05)
    expect(texts(run(days(3))).filter(t => t.startsWith('Jun'))).toEqual(['Jun 15', 'Jun 16', 'Jun 17'])
    expect(texts(run(days(14))).filter(t => t.startsWith('Jun'))).toEqual(['Jun 21', 'Jun 28'])
  })

  it('draws dates with no unit: as a labelled box, since iOS spaces them by time, not by day', () => {
    const reason = 'This chart plots dates with no unit:, which iOS spaces by time; the preview draws dates counted by day, with unit: .day. Xcode draws it as written.'
    for (const [mark, step] of [['LineMark', 3_600], ['BarMark', 86_400 * 30]] as const) {
      const r = run(`Chart {\n                ForEach(0..<6, id: \\.self) { offset in\n                    ${mark}(x: .value("Time", Date(timeIntervalSince1970: 1_781_524_800 + Double(offset) * ${step})), y: .value("Value", Double(offset + 10)))\n                }\n            }`)
      expect(nodes(r).find(n => n.kind === 'placeholder')?.placeholder).toEqual({ kind: 'notice', feature: 'Chart', reason })
      expect(strokes(r).concat(bars(r).map(b => b.node))).toEqual([])
    }
  })

  it('ticks every top the fixture measured as iOS does', () => {
    const tops: [number[], string[]][] = [
      [[9], ['0', '5', '10']], [[1], ['0', '0.5', '1']], [[0.8], ['0', '0.2', '0.4', '0.6', '0.8']], [[95], ['0', '25', '50', '75', '100']],
      [[130], ['0', '50', '100', '150']], [[47], ['0', '20', '40', '60']], [[3], ['0', '1', '2', '3']], [[-3, 7], ['-5', '0', '5', '10']],
      [[12], ['0', '5', '10', '15']], [[17], ['0', '5', '10', '15', '20']], [[33], ['0', '10', '20', '30', '40']], [[0.3], ['0', '0.1', '0.2', '0.3']],
      [[250], ['0', '100', '200', '300']], [[1800], ['0', '500', '1,000', '1,500', '2,000']], [[4.5], ['0', '2', '4', '6']], [[-40, 15], ['-40', '-20', '0', '20']],
    ]
    for (const [values, expected] of tops) {
      const marks = values.map((v, i) => `BarMark(x: .value("Key", "${i}"), y: .value("Value", ${v}))`).join('\n                ')
      const r = run(`Chart {\n                ${marks}\n            }`)
      expect(texts(r).slice(1 + values.length), `ticks for ${values}`).toEqual(expected)
    }
  })
})

describe('honesty', () => {
  it('draws a chart it can\'t draw faithfully as a labelled box saying why, not a wrong picture', () => {
    const r = run(`Chart(week) { item in\n                BarMark(x: .value("Steps", item.steps), y: .value("More", item.steps))\n            }`)
    const box = nodes(r).find(n => n.kind === 'placeholder')!
    expect(box.placeholder).toEqual({ kind: 'notice', feature: 'Chart', reason: "This chart has BarMarks on two numeric axes, which the preview doesn't draw. Xcode draws it as written." })
    expect(bars(r)).toEqual([])
  })
})

describe.skipIf(!XCODE)('in Xcode 27', () => {
  it('type-checks every source drawn above, Charts at iOS 16 and sectors at iOS 17', () => {
    typecheckInXcode(sources.map(source => source.startsWith('// target') ? source : `// target: iOS 16\n${source}`))
  }, 300_000)
})
