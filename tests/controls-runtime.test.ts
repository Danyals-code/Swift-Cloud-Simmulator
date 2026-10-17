import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CompileResult, MeshFill, RenderNode } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { DEVICES } from '@studio/sim-shell'
import { worldFrame } from './render-geometry'
import { XCODE, typecheckInXcode } from './helpers/layer-project'

/**
 * Controls, scroll and paint (Wave 6d), read from the render tree `compile` emits: the
 * DatePicker styles, the ColorPicker swatch, content margins, safe area padding,
 * view-aligned scrolling and MeshGradient. What each expectation stands for is measured in
 * docs/parity/native/iphone18pro-controls/measurements-6d.json, from
 * tests/fixtures/ios27-controls-6d.swift.
 */

// The dates are drawn in the device's time zone; these are written for UTC.
process.env.TZ = 'UTC'
/** 15 June 2026 at 9:41, and 15 August 2026, a month of six weeks. */
const JUNE = 1781516460
const AUGUST = 1786786860

const native = JSON.parse(readFileSync(new URL('../docs/parity/native/iphone18pro-controls/measurements-6d.json', import.meta.url), 'utf8'))
const device = DEVICES['iphone-18-pro']
let revision = 1
/** Every source drawn here, type-checked in Xcode 27 at the end. */
const sources: string[] = []

function run(body: string, members = `@State private var date = Date(timeIntervalSince1970: ${JUNE})`, scheme: 'light' | 'dark' = 'light'): CompileResult {
  const text = `import SwiftUI\n\n@main\nstruct ProbeApp: App {\n    var body: some Scene {\n        WindowGroup { RootView() }\n    }\n}\n\nstruct RootView: View {\n    ${members}\n\n    var body: some View {\n        ${body}\n    }\n}\n`
  sources.push(text)
  resetPipelineState()
  const result = compile({
    files: [{ id: 'App.swift', text }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: scheme,
    revision: revision++,
  })
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result
}

const nodes = (r: CompileResult) => r.renderTree?.nodes ?? []
const frame = (r: CompileResult, node: RenderNode) => worldFrame(nodes(r), node)
const words = (node: RenderNode) => node.text?.runs.map(run => run.text).join('') ?? ''
const textNode = (r: CompileResult, text: string) => nodes(r).find(n => words(n) === text)
const texts = (r: CompileResult) => nodes(r).map(words).filter(Boolean)
const warnings = (r: CompileResult) => r.diagnostics.filter(d => d.severity === 'warning').map(d => d.message)
const symbols = (r: CompileResult) => nodes(r).flatMap(n => n.image?.symbol ? [n.image.symbol] : [])
const rgb = (c: { r: number; g: number; b: number } | undefined) => c && [c.r, c.g, c.b]
const near = (value: number, expected: number, within = 0.5) => expect(Math.abs(value - expected), `${value} is not ${expected}`).toBeLessThanOrEqual(within)
/** The control a person would tap by this name. */
const target = (r: CompileResult, label: string) => nodes(r).find(n => n.hitTarget?.enabled && n.a11y?.label === label)
function press(r: CompileResult, label: string): CompileResult {
  const hit = target(r, label)
  expect(hit, `no control called "${label}"`).toBeDefined()
  applyEvent({ kind: 'tap', handlerId: hit!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(revision++)
}
const html = (r: CompileResult) => renderToStaticMarkup(createElement(RenderTreeView, { tree: r.renderTree! }))

/**
 * The nodes filled with a colour that reads as `seen` (measured in a screenshot) once laid
 * over the screen's plain background, white or black, as the native capture saw it.
 */
const filledAs = (r: CompileResult, seen: readonly number[], scheme: 'light' | 'dark' = 'light') => {
  const under = scheme === 'light' ? 255 : 0
  const over = (c: number, a: number) => c * a + under * (1 - a)
  return nodes(r).filter(n => {
    const fill = n.background
    return fill?.kind === 'solid' && fill.color.a < 1 && [fill.color.r, fill.color.g, fill.color.b].every((c, i) => Math.abs(over(c, fill.color.a) - seen[i]!) <= 1)
  })
}
/** The grey capsules a compact DatePicker draws its values on, top to bottom and left to right. */
const pills = (r: CompileResult, scheme: 'light' | 'dark' = 'light') => filledAs(r, native.compact.pillFill[scheme], scheme)
  .map(n => ({ node: n, frame: frame(r, n) })).sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x)

describe('a compact DatePicker, the default style', () => {
  const compact = native.compact

  it('draws its date and its time on grey capsules, with no chevron, as iOS 27 does outside a Form', () => {
    const r = run(`VStack(spacing: 16) {
            DatePicker("Date", selection: $date, displayedComponents: .date)
            DatePicker("Time", selection: $date, displayedComponents: .hourAndMinute)
            DatePicker("Both", selection: $date)
        }
        .padding()`)
    expect(symbols(r)).not.toContain('chevron.up.chevron.down')
    expect(texts(r)).toEqual(expect.arrayContaining(['Date', 'Time', 'Both', compact.datePill.text, compact.timePill.text]))
    const drawn = pills(r)
    expect(drawn).toHaveLength(4)
    const [date, time, bothDate, bothTime] = drawn.map(p => p.frame)
    // Each capsule is its value with 12 at each side, ends at the row's trailing edge, and is
    // 34.33 tall for a date alone and 36 where a time is shown.
    const dateText = frame(r, textNode(r, compact.datePill.text)!)
    near(date!.width, dateText.width + 2 * compact.pillPaddingX)
    near(date!.height, compact.datePill.height)
    near(time!.height, compact.timePill.height)
    near(date!.x + date!.width, compact.trailingOutside)
    near(time!.x + time!.width, compact.trailingOutside)
    near(bothTime!.x + bothTime!.width, compact.trailingOutside)
    near(bothTime!.x - (bothDate!.x + bothDate!.width), compact.pillGap)
    near(bothDate!.height, compact.timePill.height)
    // Each is a capsule: the box it is clipped to rounds by half its height.
    for (const pill of drawn) expect(nodes(r).find(n => n.id === pill.node.parent)!.cornerRadius).toBeCloseTo(pill.frame.height / 2, 1)
    // The values are in the label colour, not the secondary one the menu row used.
    expect(rgb(textNode(r, compact.datePill.text)!.text!.runs[0]!.color)).toEqual([0, 0, 0])
  })

  it('ends its capsules at the row inset in a Form, in tertiarySystemFill in both appearances', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const r = run(`Form {
            DatePicker("Date", selection: $date, displayedComponents: .date)
            DatePicker("Both", selection: $date).datePickerStyle(.compact)
        }`, undefined, scheme)
      const [date, bothDate, bothTime] = pills(r, scheme).map(p => p.frame)
      near(date!.x + date!.width, native.compact.trailingInForm)
      near(bothTime!.x + bothTime!.width, native.compact.trailingInForm)
      near(bothTime!.x - (bothDate!.x + bothDate!.width), native.compact.pillGap)
    }
  })

  it('keeps opening the calendar when its value is pressed', () => {
    const opened = press(run('DatePicker("Date", selection: $date, displayedComponents: .date)'), 'Date')
    expect(target(opened, '16')).toBeDefined()
  })
})

describe('a graphical DatePicker', () => {
  const graphical = native.graphical
  const calendar = (components = '.date', when = JUNE) => run(`VStack(spacing: 0) {
            DatePicker("Date", selection: $date, displayedComponents: ${components})
                .datePickerStyle(.graphical)
        }
        .padding()`, `@State private var date = Date(timeIntervalSince1970: ${when})`)
  /** The circle the chosen day is drawn on. */
  const chosen = (r: CompileResult) => nodes(r).find(n => n.background?.kind === 'solid' && rgb(n.background.color)!.join() === '0,0,0' && n.frame.width < 50)
  const centre = (r: CompileResult, node: RenderNode) => { const f = frame(r, node); return { x: f.x + f.width / 2, y: f.y + f.height / 2 } }
  /** Where iOS 27 draws the calendar in the same screen: its frame, x, y, width and height. */
  const drawn = (screen: string): number[] => native.frames[screen].graphical

  it('draws the month in place at the measured size, without its title', () => {
    const r = calendar()
    expect(texts(r)).not.toContain('Date')
    expect(texts(r)).toEqual(expect.arrayContaining(['June 2026', ...graphical.weekdays.text, '1', '15', '30']))
    expect(textNode(r, 'June 2026')!.text!.runs[0]!.font.weight).toBe(600)
    const days = nodes(r).filter(n => n.hitTarget?.enabled && /^\d+$/.test(n.a11y?.label ?? ''))
    expect(days).toHaveLength(30)
    // 1 June 2026 is a Monday, in the first week's row; 7 June starts the next.
    const [x, y] = drawn('graphical')
    near(centre(r, target(r, '1')!).y, y! + graphical.days.firstRowCentreY)
    near(centre(r, target(r, '1')!).x, x! + graphical.days.firstColumnCentreX + graphical.days.columnPitch)
    near(centre(r, target(r, '7')!).y - centre(r, target(r, '1')!).y, graphical.days.pitch)
    near(centre(r, textNode(r, 'June 2026')!).y, y! + graphical.headerCentreY)
    near(centre(r, textNode(r, 'SAT')!).x, x! + graphical.weekdays.lastCentreX)
    const circle = chosen(r)!
    near(frame(r, circle).width, graphical.selected.diameter)
    near(centre(r, circle).x, centre(r, target(r, '15')!).x)
    expect(symbols(r)).toEqual(expect.arrayContaining(['chevron.left', 'chevron.right']))
    near(centre(r, target(r, 'Next Month')!).x, x! + graphical.monthArrows.forward.centreX)
    near(centre(r, target(r, 'Previous Month')!).x, x! + graphical.monthArrows.back.centreX)
  })

  it('is as tall whatever the month, its weeks sharing the rows', () => {
    const august = calendar('.date', AUGUST)
    const [, y] = drawn('graphical-six')
    near(centre(august, target(august, '8')!).y - centre(august, target(august, '1')!).y, graphical.days.sixWeekPitch)
    near(centre(august, target(august, '1')!).y, y! + graphical.days.rowsTop + graphical.days.sixWeekPitch / 2)
  })

  it('draws the month for a style written on any view around it', () => {
    const picker = 'DatePicker("Date", selection: $date, displayedComponents: .date)'
    for (const body of [
      `NavigationStack {\n            Form { ${picker} }\n        }\n        .datePickerStyle(.graphical)`,
      `Form {\n            Section { ${picker} }\n                .datePickerStyle(.graphical)\n        }`,
      `VStack { Group { ${picker} } }\n            .datePickerStyle(.graphical)`,
    ]) {
      const r = run(body)
      expect(texts(r), body).toContain('June 2026')
      expect(target(r, '16'), body).toBeDefined()
    }
    // A style written inside it wins over one around it.
    const inner = run(`VStack { ${picker}.datePickerStyle(.compact) }\n            .datePickerStyle(.graphical)`)
    expect(texts(inner)).not.toContain('June 2026')
  })

  it('chooses a day where it is pressed, and steps the month with its arrows', () => {
    const r = press(calendar(), '16')
    near(centre(r, chosen(r)!).x, centre(r, target(r, '16')!).x)
    expect(texts(press(r, 'Next Month'))).toContain('July 2026')
  })

  it('adds the time on a capsule below the month when it shows the time too', () => {
    const r = calendar('[.date, .hourAndMinute]')
    const [x, y, width] = drawn('graphical-both')
    near(centre(r, target(r, '1')!).y, y! + graphical.days.firstRowCentreY)
    expect(texts(r)).toEqual(expect.arrayContaining(['Time', native.compact.timePill.text]))
    expect(textNode(r, 'Time')!.text!.runs[0]!.font.weight).toBe(600)
    const [pill] = pills(r)
    near(pill!.frame.y, y! + graphical.timeRow.pillTop)
    near(pill!.frame.x + pill!.frame.width, x! + width! - graphical.timeRow.pillTrailingInset)
    expect(target(press(r, 'Date'), 'Time')).toBeDefined()
  })
})

describe('a wheel DatePicker', () => {
  const wheel = native.wheel

  it('draws spinning columns 216 tall beside its title, the chosen row on a band', () => {
    const r = run(`VStack(spacing: 8) {
            DatePicker("Both", selection: $date).datePickerStyle(.wheel)
            DatePicker("Date", selection: $date, displayedComponents: .date).datePickerStyle(.wheel)
            DatePicker("Time", selection: $date, displayedComponents: .hourAndMinute).datePickerStyle(.wheel)
        }
        .padding()`)
    expect(texts(r)).toEqual(expect.arrayContaining([...wheel.columns.both.text, ...wheel.columns.date.text, 'PM', 'Sun Jun 14', 'Tue Jun 16', 'May', 'July', '2025', '2027']))
    const bands = filledAs(r, wheel.band.light)
    expect(bands).toHaveLength(3)
    const [x, , width] = native.frames.wheel['wheel-both']
    for (const band of bands) {
      near(frame(r, band).width, wheel.band.width)
      near(frame(r, band).height, wheel.band.height)
      near(frame(r, band).x + frame(r, band).width, x + width - wheel.band.inset)
    }
    near(frame(r, bands[1]!).y - frame(r, bands[0]!).y, wheel.height + 8)
    // The rows above and below the chosen one are squashed, as on a cylinder.
    const nine = frame(r, textNode(r, '9')!), ten = frame(r, textNode(r, '10')!)
    near((ten.y + ten.height / 2) - (nine.y + nine.height / 2), wheel.rowOffsets[1], 1)
    expect(textNode(r, '10')!.transform).toBeUndefined()
    const turned = nodes(r).find(n => n.id === textNode(r, '10')!.parent)!
    expect(turned.transform?.scaleY).toBeLessThan(1)
    // The title keeps its line beside the wheel.
    expect(frame(r, textNode(r, 'Both')!).height).toBe(frame(r, textNode(r, 'Date')!).height)
  })

  it('puts its title above the wheel in a Form', () => {
    const r = run(`Form {
            DatePicker("Date", selection: $date, displayedComponents: .date)
        }
        .datePickerStyle(.wheel)`)
    const title = frame(r, textNode(r, 'Date')!), month = frame(r, textNode(r, 'June')!)
    expect(month.y).toBeGreaterThan(title.y + title.height)
    expect(pills(r)).toHaveLength(0)
  })
})

describe('a ColorPicker', () => {
  const picker = native.colorPicker

  it('draws its colour in a ring of hues at the trailing edge', () => {
    const r = run(`VStack(spacing: 16) {
            ColorPicker("Tint", selection: $tint)
        }
        .padding()`, '@State private var tint = Color(red: 1, green: 0, blue: 0)')
    expect(symbols(r)).not.toContain('chevron.up.chevron.down')
    const ring = nodes(r).find(n => n.shape?.stroke?.fill?.kind === 'angularGradient')!
    expect(ring.shape!.stroke!.width).toBe(picker.swatch.ring)
    const outer = frame(r, ring)
    near(outer.width, picker.swatch.diameter)
    near(outer.x + outer.width, picker.swatch.trailingOutside)
    const ringFill = ring.shape!.stroke!.fill!
    const stops = ringFill.kind === 'angularGradient' ? ringFill.stops : []
    expect(rgb(stops[0]!.color)).toEqual(picker.ring.stops[0])
    expect(rgb(stops[3]!.color)).toEqual(picker.ring.stops[3])
    const dot = nodes(r).find(n => n.shape?.fill?.kind === 'solid' && rgb(n.shape.fill.color)!.join() === '255,0,0')!
    near(frame(r, dot).width, picker.swatch.inner)
    near(frame(r, dot).x + frame(r, dot).width / 2, outer.x + outer.width / 2)
  })
})

describe('content margins and safe area padding', () => {
  const cards = (prefix: string) => `HStack(spacing: 12) {
                ForEach(0..<5) { i in
                    RoundedRectangle(cornerRadius: 16).fill(.blue).frame(width: 300, height: 120).accessibilityLabel("${prefix}\\(i)")
                }
            }
            .scrollTargetLayout()`
  const carousel = (modifiers: string) => run(`VStack(spacing: 0) {
            ScrollView(.horizontal) {
                ${cards('card')}
            }
            ${modifiers}
            Spacer()
        }`, '')
  const scroller = (r: CompileResult) => nodes(r).find(n => n.scroll)!
  const card = (r: CompileResult, i: number) => {
    const node = nodes(r).find(n => n.a11y?.label === `card${i}`)!
    return { x: node.frame.x, y: node.frame.y }
  }

  it('insets a carousel by .contentMargins(_:_:for: .scrollContent) and the automatic placement, not by the indicators', () => {
    const scroll = native.frames.margins
    near(card(carousel('.contentMargins(.horizontal, 24, for: .scrollContent)'), 0).x, scroll['content-0'][0])
    near(card(carousel('.contentMargins(.horizontal, 24)'), 1).x, native.frames['margins-placement']['automatic-1'][0])
    near(card(carousel('.contentMargins(.horizontal, 24, for: .scrollIndicators)'), 0).x, native.frames['margins-placement']['indicators-0'][0])
    const r = carousel('.contentMargins(.horizontal, 24, for: .scrollContent)')
    // The content runs from the leading margin to past the last card by the same margin.
    const [first, last] = [scroll['content-0'], scroll['content-4']]
    near(scroller(r).scroll!.content.width, last[0] + last[2] + first[0] - scroll['content-scroll'][0])
    expect(warnings(r)).toEqual([])
  })

  it('grows a horizontal scroll view by its vertical margins', () => {
    const r = carousel('.contentMargins(10)\n            .fixedSize(horizontal: false, vertical: true)')
    expect(frame(r, scroller(r)).height).toBe(native.frames['margins-placement']['all-scroll'][3])
    expect(card(r, 0)).toEqual({ x: 10, y: 10 })
  })

  it('insets a vertical scroll view, and lets a margin for .scrollContent replace an automatic one', () => {
    const column = (modifiers: string) => run(`ScrollView {
            VStack(spacing: 12) {
                ForEach(0..<3) { i in
                    Color.blue.frame(height: 80).accessibilityLabel("row\\(i)")
                }
            }
        }
        ${modifiers}`, '')
    const first = (r: CompileResult) => frame(r, nodes(r).find(n => n.a11y?.label === 'row0')!)
    const plain = first(column('')), vertical = first(column('.contentMargins(.vertical, 40)'))
    near(vertical.y - plain.y, native.frames['margins-vertical']['vertical-0'][1] - 62)
    const mixed = first(column('.contentMargins(.vertical, 40)\n        .contentMargins(.horizontal, 30, for: .scrollContent)'))
    expect({ x: mixed.x, y: mixed.y, width: mixed.width }).toEqual({ x: native.frames['margins-mixed']['vertical-0'][0], y: plain.y, width: native.frames['margins-mixed']['vertical-0'][2] })
  })

  it('takes a List top margin as a floor above an unheaded section and as space above a header, and a side margin as its card inset', () => {
    const list = (header: boolean, modifiers: string) => {
      const rows = 'ForEach(0..<3) { i in Text("Row \\(i)") }'
      const r = run(`List {
            ${header ? `Section("Header") { ${rows} }` : rows}
        }
        ${modifiers}`, '')
      return frame(r, textNode(r, 'Row 0')!)
    }
    const f = native.frames
    near(list(false, '.contentMargins(.top, 40)').y - list(false, '').y, f['margins-list']['list-0'][1] - f['list-plain']['list-0'][1])
    near(list(true, '.contentMargins(.top, 40)').y - list(true, '').y, f['list-header-top']['list-0'][1] - f['list-header']['list-0'][1])
    near(list(false, '.contentMargins(.horizontal, 40, for: .scrollContent)').x, f['list-mixed']['list-0'][0])
  })

  it('takes a one-sided List or Form margin on its own side only', () => {
    const card = (body: string, modifiers: string) => {
      const r = run(`${body} {
            Text("Row 0")
        }
        ${modifiers}`, '')
      const row = textNode(r, 'Row 0')!
      // The card is the rounded box the row is drawn in.
      let node = nodes(r).find(n => n.id === row.parent)
      while (node && !node.cornerRadius) node = nodes(r).find(n => n.id === node!.parent)
      return frame(r, node!)
    }
    const f = native.frames
    for (const body of ['List', 'Form']) {
      const plain = card(body, ''), leading = card(body, '.contentMargins(.leading, 40)'), trailing = card(body, '.contentMargins(.trailing, 40)')
      // As wide a margin as .horizontal's moves the card's leading edge where that one does.
      near(leading.x, f['list-mixed']['list-0'][0] - (f['list-plain']['list-0'][0] - plain.x))
      near(leading.x + leading.width, plain.x + plain.width)
      near(trailing.x, plain.x)
      near(402 - (trailing.x + trailing.width), f['list-mixed']['list-0'][0] - (f['list-plain']['list-0'][0] - plain.x))
    }
  })

  it('insets a scroll view by .safeAreaPadding and pads any other view', () => {
    near(card(carousel('.safeAreaPadding(.horizontal, 24)'), 0).x, native.frames['safe-area']['safe-0'][0])
    const r = run(`Text("Inset")
            .background(Color.yellow)
            .safeAreaPadding(20)
            .background(Color.blue)`, '')
    const yellow = nodes(r).find(n => n.background?.kind === 'solid' && rgb(n.background.color)!.join() === '255,204,0')!
    const blue = nodes(r).find(n => n.background?.kind === 'solid' && rgb(n.background.color)!.join() === '0,136,255')!
    near(frame(r, blue).width - frame(r, yellow).width, 40)
    near(frame(r, blue).height - frame(r, yellow).height, 40)
  })

  /** Where each card of a native carousel starts, less the scroll view's leading margin: the offsets it rests at. */
  const restsAt = (prefix: string) => {
    const f = native.frames.margins
    return [0, 1, 2, 3, 4].map(i => f[`${prefix}-${i}`][0] - (f[`${prefix}-0`][0] - f[`${prefix}-scroll`][0]))
  }
  /** Whether a native view-aligned scroll view settles a drag released at each proposed offset somewhere else. */
  const settles = (variant: string) => native.scroll.viewAlignedSettles[variant].some((at: number, i: number) => at !== native.scroll.viewAlignedSettles.proposed[i])

  it('comes to rest with a view at its leading margin under .scrollTargetBehavior(.viewAligned)', () => {
    expect(settles('markedWithMargin24')).toBe(true)
    const r = carousel('.contentMargins(.horizontal, 24, for: .scrollContent)\n        .scrollTargetBehavior(.viewAligned)')
    expect(scroller(r).scroll!.snaps).toEqual(restsAt('content'))
    expect(scroller(carousel('.scrollTargetBehavior(.viewAligned)')).scroll!.snaps).toEqual(restsAt('aligned'))
    expect(warnings(r)).toEqual([])
    expect(carousel('').renderTree!.nodes.find(n => n.scroll)!.scroll!.snaps).toBeUndefined()
    expect(html(r)).toContain('scroll-snap-type:x mandatory')
  })

  it('scrolls freely under .viewAligned when no stack is marked .scrollTargetLayout(), as iOS 27 does', () => {
    expect(settles('unmarked')).toBe(false)
    const r = run(`ScrollView(.horizontal) {
            HStack(spacing: 12) {
                ForEach(0..<5) { _ in Color.blue.frame(width: 300, height: 120) }
            }
        }
        .scrollTargetBehavior(.viewAligned)`, '')
    expect(scroller(r).scroll!.snaps).toBeUndefined()
    expect(warnings(r)).toEqual([])
    expect(html(r)).not.toContain('scroll-snap-type')
  })

  it('snaps to a marked lazy stack, and to a marked stack nested in the content', () => {
    expect(settles('lazyMarked') && settles('nestedMarked')).toBe(true)
    const aligned = (content: string) => run(`ScrollView(.horizontal) {
            ${content}
        }
        .scrollTargetBehavior(.viewAligned)`, '')
    const cards = 'ForEach(0..<5) { _ in Color.blue.frame(width: 300, height: 120) }'
    const lazy = aligned(`LazyHStack(spacing: 12) { ${cards} }.scrollTargetLayout()`)
    const nested = aligned(`VStack { HStack(spacing: 12) { ${cards} }.scrollTargetLayout() }`)
    expect(scroller(lazy).scroll!.snaps).toEqual(restsAt('aligned'))
    expect(scroller(nested).scroll!.snaps).toEqual(restsAt('aligned'))
  })
})

describe('a MeshGradient', () => {
  const mesh = (smooth: string) => run(`MeshGradient(width: 3, height: 3, points: [
            [0, 0], [0.5, 0], [1, 0],
            [0, 0.5], [0.8, 0.3], [1, 0.5],
            [0, 1], [0.5, 1], [1, 1],
        ], colors: [
            .red, .purple, .blue,
            .orange, .white, .cyan,
            .yellow, .green, .mint,
        ]${smooth})
        .frame(height: 300)
        .padding(.horizontal)`, '')

  it('is a mesh fill its frame sizes, smooth unless it says otherwise', () => {
    const r = mesh('')
    const node = nodes(r).find(n => n.background?.kind === 'mesh')!
    expect(frame(r, node)).toMatchObject({ width: native.mesh.frames.smooth[2], height: native.mesh.frames.smooth[3] })
    const fill = node.background as MeshFill
    expect(fill).toMatchObject({ width: 3, height: 3, smooth: true })
    expect(fill.points[4]).toEqual([0.8, 0.3])
    expect(fill.colors).toHaveLength(9)
    expect(warnings(r)).toEqual([])
    expect(html(r)).toContain('data-mesh')
    const linear = nodes(mesh(', smoothsColors: false')).find(n => n.background?.kind === 'mesh')!
    expect((linear.background as MeshFill).smooth).toBe(false)
  })
})

describe.skipIf(!XCODE)('in Xcode 27', () => {
  it('type-checks every source drawn above', () => {
    typecheckInXcode(sources)
  }, 300_000)
})
