import { describe, expect, it } from 'vitest'
import type { LayerChange } from '@studio/shared'
import { XCODE, draw, edited, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 6e, Swift Charts as Design reads and writes them: a Chart is drawn, so it is an
 * ordinary layer whose own frame, fill, corners, stroke and effects are edited as any
 * view's are. What it plots stays in Code: its data and marks are read only.
 */

const charted = (body: string, declarations = '') => screen(body, declarations).replace('import SwiftUI\n', 'import SwiftUI\nimport Charts\n')
const LITERAL = `Chart {
            BarMark(x: .value("Day", "Mon"), y: .value("Steps", 5200))
            BarMark(x: .value("Day", "Tue"), y: .value("Steps", 8100))
        }
        .frame(height: 200)`
const STEP = `struct Step: Identifiable {
    let id = UUID()
    let day: String
    let count: Int
}
`
const DATA = `Chart(steps) { step in
            BarMark(x: .value("Day", step.day), y: .value("Steps", step.count))
        }`
const DATA_SCREEN = charted(`        ${DATA}`, STEP).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    let steps = [Step(day: "Mon", count: 5200), Step(day: "Tue", count: 8100)]\n\n')
const MODIFIED = `Chart {
            SectorMark(angle: .value("Share", 3), innerRadius: .ratio(0.6))
            SectorMark(angle: .value("Share", 2), innerRadius: .ratio(0.6))
        }
        .chartLegend(.hidden)
        .frame(width: 240, height: 240)`

const layout = (...changes: Omit<Extract<LayerChange, { section: 'layout' }>, 'section'>[]) => ({ kind: 'layer-set' as const, changes: changes.map(change => ({ section: 'layout' as const, ...change })) })
/** Every form written, type-checked in Xcode at the end. */
const forms: string[] = []
const written = (source: string, view: string, operation: Parameters<typeof edited>[2], target?: string) => { const after = edited(source, view, operation, target); forms.push(after); return after }

describe('a Chart in Design', () => {
  it('is an ordinary layer, drawn and not locked, with its own frame read as Fixed', () => {
    const chart = viewWritten(charted(`        ${LITERAL}`), LITERAL)
    expect(chart).toMatchObject({ kind: 'view', name: 'Chart' })
    expect(chart.undrawn).toBeUndefined()
    expect(chart.layer?.layout.height).toMatchObject({ value: { mode: 'fixed', size: 200 }, state: 'literal' })
    expect(chart.layer?.layout.width).toMatchObject({ value: { mode: 'hug' }, state: 'absent' })
    expect(chart.layer?.locked).toBeUndefined()
    // A Chart has no text of its own to style: its labels are the chart's.
    expect(chart.layer?.text).toBeUndefined()
  })

  it('writes its height and width in its own frame, in place', () => {
    const source = charted(`        ${LITERAL}`)
    expect(written(source, LITERAL, layout({ height: { mode: 'fixed', size: 260 } }))).toBe(source.replace('.frame(height: 200)', '.frame(height: 260)'))
    expect(written(source, LITERAL, layout({ width: { mode: 'fixed', size: 300 } }))).toBe(source.replace('.frame(height: 200)', '.frame(width: 300, height: 200)'))
    expect(written(source, LITERAL, layout({ width: { mode: 'fill' } }))).toBe(source.replace('.frame(height: 200)', '.frame(height: 200)\n        .frame(maxWidth: .infinity)'))
  })

  it('gives a Chart written with its data a frame, and keeps what it plots read only', () => {
    const chart = viewWritten(DATA_SCREEN, DATA)
    expect(chart.kind).toBe('view')
    expect(chart.properties.find(p => p.name === 'argument 1')).toMatchObject({ writable: false })
    expect(written(DATA_SCREEN, DATA, layout({ height: { mode: 'fixed', size: 240 } }))).toBe(DATA_SCREEN.replace(DATA, `${DATA}\n        .frame(height: 240)`))
  })

  it('writes its frame beside the chart’s own modifiers, which it leaves as written', () => {
    const source = charted(`        ${MODIFIED}`)
    expect(viewWritten(source, MODIFIED).layer?.locked).toBeUndefined()
    expect(written(source, MODIFIED, layout({ height: { mode: 'fixed', size: 200 } }), '17.0')).toBe(source.replace('.frame(width: 240, height: 240)', '.frame(width: 240, height: 200)'))
  })

  it('takes a fill, corners and opacity as any view does', () => {
    const source = charted(`        ${LITERAL}`)
    const filled = written(source, LITERAL, { kind: 'layer-set', changes: [{ section: 'fill', fill: { kind: 'color', color: { kind: 'system', name: 'yellow' } } }, { section: 'effects', opacity: 0.8 }] } as Parameters<typeof edited>[2])
    expect(filled).toContain('.frame(height: 200)\n        .background(.yellow)\n        .opacity(0.8)')
  })

  it('says why below iOS 16, where Swift Charts does not exist', () => {
    const reason = 'Chart needs iOS 16 or newer. Change the deployment target to edit it here.'
    expect(viewWritten(charted(`        ${LITERAL}`), LITERAL, '15.0').layer?.locked).toBe(reason)
    expect(refusal(charted(`        ${LITERAL}`), LITERAL, layout({ height: { mode: 'fixed', size: 260 } }), '15.0')).toBe(reason)
  })

  // Only a Chart's layer is locked below its iOS: any other view newer than the target keeps
  // its layer, read and written, as before Wave 6e.
  it.each([
    ['Gauge', 'Gauge(value: 0.5) { Text("Load") }\n        .frame(height: 40)', '15.0'],
    ['Grid', 'Grid {\n            GridRow { Text("A") }\n        }\n        .frame(height: 40)', '15.0'],
    ['ContentUnavailableView', 'ContentUnavailableView("None", systemImage: "tray")\n        .frame(height: 40)', '16.0'],
  ])('leaves a %s newer than the target as it was', (_, view, target) => {
    const source = screen(`        ${view}`)
    expect(viewWritten(source, view, target).layer?.locked).toBeUndefined()
    expect(written(source, view, layout({ height: { mode: 'fixed', size: 60 } }), target)).toBe(source.replace('.frame(height: 40)', '.frame(height: 60)'))
  })
})

/** What the checker says of a screen, as the Issues list shows it. */
const said = (body: string, declarations = '') => draw(project(charted(body, declarations))).diagnostics
  .filter(d => d.code !== 'runtime_trap').map(d => `${d.severity}: ${d.message}`)

/**
 * The forms the preview draws (Wave 6e), each type-checked in Xcode 27 below. A scale's
 * domain the preview can't follow, as on an axis of dates, draws the chart as a box saying
 * why, so the checker says nothing of it either. A sector's top annotation is drawn by
 * neither iOS nor the preview.
 */
const DRAWN = `        VStack {
            Chart(steps) { step in
                BarMark(x: .value("Day", step.day), y: .value("Steps", step.count))
                    .foregroundStyle(by: .value("Kind", step.kind))
                    .position(by: .value("Kind", step.kind))
                    .annotation(position: .top) { Text("\\(step.count)") }
                BarMark(x: .value("Date", step.date, unit: .day), y: .value("Steps", step.count))
                    .annotation(position: .top) { Text("A") }
                    .annotation(position: .top, alignment: .center) { Text("B") }
                PointMark(x: .value("Date", step.date, unit: .day), y: .value("Steps", step.count))
                LineMark(x: .value("Date", step.date, unit: Calendar.Component.day), y: .value("Steps", step.count))
                RuleMark(y: .value("Goal", 6000))
                    .foregroundStyle(.red)
                    .annotation { Text("Goal") }
            }
            .chartXAxis(.hidden)
            .chartYAxis(.visible)
            .chartLegend(.hidden)
            .chartYScale(domain: 0...10000)
            .chartXScale(domain: range)
            .foregroundStyle(.teal)
            .frame(height: 200)
            Chart {
                ForEach(steps) { step in
                    LineMark(x: .value("Day", step.day), y: .value("Steps", step.count))
                    PointMark(x: .value("Day", step.day), y: .value("Steps", step.count))
                    AreaMark(x: .value("Day", step.day), y: .value("Steps", step.count))
                        .annotation(position: .overlay) { Text("A") }
                }
                SectorMark(angle: .value("Share", 3), innerRadius: .ratio(0.6), angularInset: 1.5)
                    .annotation(position: .overlay) { Text("A") }
                    .annotation(position: .top) { Text("B") }
            }
            .chartXAxis(Visibility.automatic)
            .chartLegend(.automatic)
            .chartXScale(domain: ["Mon", "Tue"])
        }`
const DRAWN_DECLARATIONS = `
let steps = [Step(day: "Mon", count: 5200, kind: "Walk")]
let range = 0...10
struct Step: Identifiable {
    let id = UUID()
    let day: String
    let count: Int
    let kind: String
    let date = Date()
}
`
/** Forms the preview leaves out, each named. */
const NOT_DRAWN = `        VStack {
            Chart {
                BarMark(x: .value("Day", "Mon"), y: .value("Steps", 3))
                    .annotation(position: .leading) { Text("3") }
                    .cornerRadius(4)
                    .opacity(0.5)
                LineMark(x: .value("Day", "Mon"), y: .value("Steps", 3))
                    .interpolationMethod(.catmullRom)
                RectangleMark(x: .value("Day", "Mon"), y: .value("Steps", 3))
                BarMark(x: .value("Day", "Mon"), y: .value("Steps", 3), width: 10, stacking: .normalized)
                BarMark(xStart: .value("From", 1), xEnd: .value("To", 3), y: .value("Row", "A"))
                RuleMark(xStart: .value("From", 1), xEnd: .value("To", 3), y: .value("At", 2))
                AreaMark(x: .value("Day", "Mon"), yStart: .value("Low", 1), yEnd: .value("High", 3))
                SectorMark(angle: .value("Share", 3), innerRadius: .inset(10), outerRadius: .ratio(0.9))
                PointMark(x: .value("Month", Date(), unit: .month), y: .value("Steps", 3))
                    .annotation(position: .top, alignment: .leading) { Text("A") }
            }
            .chartXAxis {
                AxisMarks()
            }
            .chartLegend(position: .bottom)
            .chartYScale(range: .plotDimension(padding: 10))
            .chartScrollableAxes(.horizontal)
            VStack {
                Text("A")
            }
            .chartLegend(.hidden)
        }`

describe('what the checker says of a chart', () => {
  it('says nothing for the forms the preview draws', () => {
    expect(said(DRAWN, DRAWN_DECLARATIONS)).toEqual([])
  })

  it('names each form it leaves out, and draws the rest', () => {
    const lines = said(NOT_DRAWN).join('\n')
    for (const name of ['annotation', 'cornerRadius', 'opacity', 'interpolationMethod', 'chartXAxis', 'chartLegend', 'chartYScale', 'chartScrollableAxes']) expect(lines).toContain(`'.${name}' is recognized but not applied by the preview`)
    // A top annotation aligned to one side is drawn centred, and one at the leading edge not at all.
    expect(said(NOT_DRAWN).filter(line => line.includes("'.annotation'"))).toHaveLength(2)
    // What the preview does with each: the mark is left out, and the axis kept as it is by default.
    expect(lines).toContain('warning: RectangleMark: the preview leaves it out of the chart. Xcode draws it as written.')
    expect(lines).toContain('warning: AxisMarks: the preview keeps the chart’s default axis. Xcode draws it as written.')
    expect(lines).not.toContain('labelled box')
    for (const form of ['BarMark(width:)', 'BarMark(stacking:)', 'BarMark(xStart:)', 'RuleMark(xStart:)', 'AreaMark(yStart:)', 'SectorMark(outerRadius:)']) expect(lines).toContain(`warning: The preview doesn’t draw ${form}.`)
    expect(lines).toContain('warning: The preview doesn’t draw SectorMark(innerRadius:) except as .ratio(…).')
    expect(lines).toContain('warning: The preview doesn’t draw a chart of dates by any unit but .day; it shows a box.')
    expect(lines).not.toMatch(/Xcode won't build|will not compile|Cannot find/)
  })

  it('lists a drawn chart modifier in Design as drawn, and one it leaves out as not', () => {
    const view = (modifier: string) => `Chart {\n            BarMark(x: .value("Day", "Mon"), y: .value("Steps", 3))\n        }\n        ${modifier}`
    const first = (modifier: string) => viewWritten(charted(`        ${view(modifier)}`), view(modifier)).modifiers?.[0]?.summary
    expect(first('.chartXAxis(.hidden)')).not.toBe('Not drawn in the preview')
    expect(first('.chartYScale(domain: 0...10)')).not.toBe('Not drawn in the preview')
    expect(first('.chartLegend(position: .bottom)')).toBe('Not drawn in the preview')
  })
})

describe.skipIf(!XCODE)('Xcode 27', () => {
  it('type-checks every form written', () => {
    expect(forms.length).toBeGreaterThan(0)
    typecheckInXcode([...forms, charted(DRAWN, DRAWN_DECLARATIONS), `// target: iOS 17\n${charted(NOT_DRAWN)}`])
  }, 300_000)
})
