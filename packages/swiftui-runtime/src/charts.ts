import { rgba, stopsOf, type Fill, type RGBA } from '@studio/shared'
import { asDate, describe, formatNumber, type SwiftValue } from '@studio/swift-runtime'
import { DRAWN_CHART_MARKS } from '@studio/swift-sema'
import type { LayoutElement, PlotItem, PlotPoint } from '@studio/swiftui-layout'
import { TOKEN_TYPE, asView, payloadOf, type ModifierValue, type TokenPayload, type ViewValue } from './view-value'

/**
 * Swift Charts, drawn as iOS 27 draws them (Wave 6e): `Chart` with its bar, line, point,
 * area, rule and sector marks, its axes, grid, legend and annotations, laid out as plots
 * whose items are placed at fractions of whatever size the chart is given. Every value
 * here is measured in docs/parity/native/iphone18pro-charts/measurements.json, from
 * tests/fixtures/ios27-charts-6e.swift. A chart this can't draw faithfully is a labelled box
 * saying why, never a wrong picture.
 */

/** What the converter lends the chart: its colours, its text and its way of drawing a view. */
export interface ChartHost {
  readonly scheme: 'light' | 'dark'
  color(name: string): RGBA
  /** A word in a text style and a named colour, as the converter writes its own labels. */
  text(id: string, text: string, style: string, color: string): LayoutElement
  /** An annotation's content, converted as any view is. */
  content(view: ViewValue, path: string): LayoutElement
  /** A style as `.foregroundStyle` reads it: a colour, a token or a gradient. */
  style(value: SwiftValue): Fill | null
  /** The chart's own `.foregroundStyle`, the colour of every mark that has none. */
  readonly foreground: Fill | null
}

/**
 * `foregroundStyle(by:)`'s colours in the order series are first seen, measured in light and
 * dark: blue, green, orange, purple, red, teal and yellow, then again.
 */
const PALETTE: Record<'light' | 'dark', readonly RGBA[]> = {
  light: [rgba(0, 136, 255), rgba(52, 199, 89), rgba(255, 141, 40), rgba(203, 48, 224), rgba(255, 56, 60), rgba(0, 195, 208), rgba(255, 204, 0)],
  dark: [rgba(0, 145, 255), rgba(48, 209, 88), rgba(255, 146, 48), rgba(219, 52, 242), rgba(255, 66, 69), rgba(0, 210, 224), rgba(255, 214, 0)],
}

/** The gap before an axis label, and the x axis row: 4 then a .caption2 line, in whole points. */
const LABEL_GAP = 4
const X_ROW = 18
/** A horizontal bar's band keeps this much above its bar for the band's label. */
const BAND_LABEL = LABEL_GAP + 40 / 3
/** A bar is this much of its band, as a grouped bar is of its share. */
const BAR = 0.7
const BAR_RADIUS = 2
const LINE_WIDTH = 2
const POINT = 8
const GRID_WIDTH = 0.5
const DASH = [2, 2]
/** How far out from a ring's inside an overlay annotation sits. */
const SECTOR_LABEL = 0.618

type MarkName = 'BarMark' | 'LineMark' | 'PointMark' | 'AreaMark' | 'RuleMark' | 'SectorMark'

/** A plotted value: a category, a number, or a day (whole days since 1970 in the device's time zone). */
type Value = { readonly kind: 'category'; readonly key: string } | { readonly kind: 'number'; readonly value: number } | { readonly kind: 'day'; readonly day: number }

interface Mark {
  readonly name: MarkName
  readonly path: string
  readonly x?: Value
  readonly y?: Value
  readonly angle?: number
  readonly inner: number
  readonly inset: number
  readonly series?: string
  readonly grouped?: string
  readonly fill?: Fill
  readonly annotation?: { readonly place: 'top' | 'overlay' | 'automatic'; readonly content: readonly ViewValue[] }
}

/** A place in the plot area, as a fraction of it across and down, plus points. */
type At = (x: number, y: number, dx?: number, dy?: number) => PlotPoint

/** Where a stacked bar or area starts and ends along the value axis, and whether it ends its stack. */
interface Span {
  readonly from: number
  readonly to: number
  outer: boolean
}

/** Why a chart is a labelled box: what it holds that the preview can't draw faithfully. */
class NotDrawn extends Error {}

/** A `Chart` as layout, or a labelled box naming what kept it from being drawn. */
export function chartLayout(chart: ViewValue, path: string, host: ChartHost): LayoutElement {
  try {
    return new ChartBuilder(chart, path, host).build()
  } catch (error) {
    if (!(error instanceof NotDrawn)) throw error
    return { kind: 'placeholder', id: path, placeholder: { kind: 'notice', feature: 'Chart', reason: `${error.message} Xcode draws it as written.` } }
  }
}

class ChartBuilder {
  private readonly marks: Mark[] = []
  /** The marks of each kind, in the order they are written. */
  private readonly kinds = new Map<MarkName, Mark[]>()
  /** Each series' first mark, in the order series are first seen. */
  private readonly series = new Map<string, Mark>()
  private readonly items: PlotItem[] = []
  private readonly labels: PlotItem[] = []
  private serial = 0

  constructor(private readonly chart: ViewValue, private readonly path: string, private readonly host: ChartHost) {
    this.collect(chart.children)
  }

  private id(part: string): string {
    return `${this.path}-chart-${part}${this.serial++}`
  }

  private of(name: MarkName): readonly Mark[] {
    return this.kinds.get(name) ?? []
  }

  /** The marks a chart's content holds, through `ForEach`, `Group` and the branches of an `if`. */
  private collect(views: readonly ViewValue[]): void {
    for (const view of views) {
      if (!DRAWN_CHART_MARKS.has(view.name)) {
        this.collect(view.children)
        continue
      }
      const mark = this.mark(view)
      this.marks.push(mark)
      const same = this.kinds.get(mark.name)
      if (same) same.push(mark)
      else this.kinds.set(mark.name, [mark])
      if (mark.series !== undefined && !this.series.has(mark.series)) this.series.set(mark.series, mark)
    }
  }

  private mark(view: ViewValue): Mark {
    const arg = (label: string) => view.args.find(a => a.label === label)?.value
    let series: string | undefined, grouped: string | undefined, fill: Fill | undefined, annotation: Mark['annotation']
    for (const modifier of view.modifiers) {
      const by = modifier.args.find(a => a.label === 'by')?.value
      if (modifier.name === 'foregroundStyle' && by) series = this.seriesName(by)
      else if (modifier.name === 'foregroundStyle') fill = this.fillOf(modifier) ?? fill
      else if (modifier.name === 'position' && by) grouped = plotted(by) ? keyOf(plotted(by)!.value) : undefined
      else if (modifier.name === 'annotation') annotation = annotationOf(modifier) ?? annotation
    }
    const angle = plotted(arg('angle'))
    const inner = payloadOf<TokenPayload>(arg('innerRadius'), TOKEN_TYPE)
    return {
      name: view.name as MarkName,
      path: view.path ?? this.id('m'),
      x: valueOf(plotted(arg('x'))),
      y: valueOf(plotted(arg('y'))),
      ...(angle ? { angle: numberOf(angle.value) ?? 0 } : {}),
      inner: inner?.name === 'ratio' ? numberOf(inner.args?.[0]) ?? 0 : 0,
      inset: numberOf(arg('angularInset')) ?? 0,
      ...(series !== undefined ? { series } : {}),
      ...(grouped !== undefined ? { grouped } : {}),
      ...(fill ? { fill } : {}),
      ...(annotation ? { annotation } : {}),
    }
  }

  private seriesName(by: SwiftValue): string | undefined {
    const value = plotted(by)?.value
    if (!value) return undefined
    if (value.kind === 'string') return value.value
    const day = asDate(value)
    if (day) return dayLabel(dayOf(day.epochSeconds))
    return formatNumber(value, '') ?? describe(value)
  }

  private fillOf(modifier: ModifierValue): Fill | null {
    const value = modifier.args[0]?.value
    // Read the way the converter reads `.foregroundStyle`, so a token or a gradient means the same.
    return value ? this.host.style(value) : null
  }

  /** The colour a mark is filled with: its own style, its series' place in the palette, or the chart's. */
  private paint(mark: Mark): Fill {
    if (mark.fill) return mark.fill
    if (mark.series !== undefined) {
      const palette = PALETTE[this.host.scheme]
      let index = 0
      for (const name of this.series.keys()) {
        if (name === mark.series) break
        index++
      }
      return { kind: 'solid', color: palette[index % palette.length]! }
    }
    return this.host.foreground ?? { kind: 'solid', color: this.host.color('accentColor') }
  }

  /** A line's stroke in `fill`: a gradient is painted along it, its first stop standing for it where one colour must. */
  private stroke(fill: Fill, extra: { lineCap?: 'round'; lineJoin?: 'round' } = {}) {
    const first = stopsOf(fill)?.[0]?.color
    const color = fill.kind === 'solid' ? fill.color : first ?? PALETTE[this.host.scheme][0]!
    return { color, width: LINE_WIDTH, ...extra, ...(fill.kind === 'solid' ? {} : { fill }) }
  }

  private modifier(name: string): ModifierValue | undefined {
    return this.chart.modifiers.find(m => m.name === name)
  }

  /** `.chartXAxis(.hidden)`, `.chartLegend(.hidden)`: whether the chart's own modifier hides it. */
  private hidden(name: string): boolean {
    const value = this.modifier(name)?.args[0]?.value
    return payloadOf<TokenPayload>(value, TOKEN_TYPE)?.name === 'hidden'
  }

  build(): LayoutElement {
    // With no data iOS draws nothing, no axes and no frame, in the space the chart still takes (measured, empty).
    if (this.marks.length === 0) return { kind: 'plot', id: this.path, items: [], ideal: 100 }
    const sectors = this.of('SectorMark')
    const plot = sectors.length ? this.pie(sectors) : this.cartesian()
    const legend = this.series.size && !this.hidden('chartLegend') ? this.legend() : null
    if (!legend) return { ...plot, id: this.path }
    return { kind: 'stack', id: this.path, axis: 'vertical', spacing: LABEL_GAP, alignment: { horizontal: 'leading', vertical: 'center' }, children: [plot, legend] }
  }

  // ------------------------------------------------------------------ sectors

  /** A pie or a donut: no axes, the ring centred in the plot from 12 o'clock clockwise. */
  private pie(sectors: readonly Mark[]): LayoutElement {
    if (sectors.length !== this.marks.length) throw new NotDrawn('This chart mixes SectorMark with other marks, which the preview doesn\'t draw.')
    const total = sectors.reduce((sum, m) => sum + Math.max(0, m.angle ?? 0), 0)
    let start = 0
    for (const mark of sectors) {
      const share = total > 0 ? Math.max(0, mark.angle ?? 0) / total : 0
      const end = start + share
      this.items.push({ kind: 'wedge', id: this.id('sector'), start, end, inner: mark.inner, inset: mark.inset, fill: this.paint(mark) })
      const place = mark.annotation?.place
      if (mark.annotation && (place === 'overlay' || place === 'automatic')) {
        const middle = (start + end) * Math.PI
        const reach = (mark.inner + SECTOR_LABEL * (1 - mark.inner)) / 2
        this.items.push({ kind: 'at', square: true, at: { x: 0.5 + reach * Math.sin(middle), y: 0.5 - reach * Math.cos(middle) }, anchor: { x: 0.5, y: 0.5 }, element: this.annotationContent(mark) })
      }
      start = end
    }
    return { kind: 'plot', id: this.id('plot'), items: this.items, ideal: 100 }
  }

  // ---------------------------------------------------------------- cartesian

  private cartesian(): LayoutElement {
    const xs = this.marks.flatMap(m => m.x ? [m.x] : []), ys = this.marks.flatMap(m => m.y ? [m.y] : [])
    const xKind = axisKind(xs), yKind = axisKind(ys)
    const bars = this.of('BarMark')
    // Bars stand on a band axis: categories or days along x, or categories up the side.
    const horizontal = yKind === 'category' && (xKind === 'number' || xKind === null)
    if (yKind === 'day' || horizontal && this.marks.length !== bars.length + this.of('RuleMark').length) throw new NotDrawn('This chart puts categories or dates up its side for marks other than bars, which the preview doesn\'t draw.')
    if (!horizontal && yKind === 'category') throw new NotDrawn('This chart has categories on both axes, which the preview doesn\'t draw.')
    if (bars.length && !horizontal && xKind === 'number') throw new NotDrawn('This chart has BarMarks on two numeric axes, which the preview doesn\'t draw.')
    if (horizontal && bars.some(m => m.grouped !== undefined)) throw new NotDrawn('This chart groups horizontal bars with .position(by:), which the preview doesn\'t draw.')
    if (this.marks.some(m => m.name !== 'RuleMark' && (!m.x || !m.y))) throw new NotDrawn('This chart has a mark without both x and y, which the preview doesn\'t draw.')

    const linearX = !horizontal && xKind === 'number'
    const band = bandAxis(horizontal ? ys : xs, linearX ? null : this.categories(horizontal, horizontal ? yKind : xKind))
    const showX = !this.hidden('chartXAxis'), showY = !this.hidden('chartYAxis')
    const amount = (m: Mark) => {
      const along = horizontal ? m.x : m.y
      return along?.kind === 'number' ? along.value : 0
    }
    // Bars stack from zero at each place (and group), areas at each x, in the order they are written (measured).
    const barSpans = stack(bars, m => `${keyOf(horizontal ? m.y : m.x)}|${m.grouped ?? ''}`, amount)
    const areaSpans = stack(this.of('AreaMark'), m => keyOf(m.x), amount)
    // A hidden value axis has no ticks to round its domain to: the tallest bar reaches the top.
    const value = scale(this.values(horizontal, barSpans, areaSpans), this.domain(horizontal ? 'chartXScale' : 'chartYScale'), horizontal ? showX : showY)
    const xScale = linearX ? scale(xs.flatMap(v => v.kind === 'number' ? [v.value] : []), this.domain('chartXScale'), showX) : null
    const row = showX ? X_ROW : 0
    const at: At = (x, y, dx = 0, dy = 0) => ({ x, y, dx, dy: dy - y * row })
    const up = (v: number) => 1 - (v - value.lo) / (value.hi - value.lo)
    const across = (v: number) => (v - value.lo) / (value.hi - value.lo)
    const bandCentre = (v: Value | undefined) => {
      const index = v ? band.index(v) : -1
      return index < 0 ? null : (index + 0.5) / band.count
    }
    const xOf = (v: Value | undefined): number | null => linearX ? (v?.kind === 'number' ? (v.value - xScale!.lo) / (xScale!.hi - xScale!.lo) : null) : bandCentre(v)

    // Grid first, under the marks: lines across are solid, lines down are dashed and run on
    // through the x axis row.
    const grid = { color: this.host.color('tertiaryLabel'), width: GRID_WIDTH }
    const gridAcross = (y: number) => this.items.push({ kind: 'line', id: this.id('grid'), points: [at(0, y), at(1, y)], stroke: grid })
    const gridDown = (x: number) => this.items.push({ kind: 'line', id: this.id('grid'), points: [at(x, 0), at(x, 1, 0, row)], stroke: { ...grid, dash: DASH } })
    if (horizontal) {
      if (showY) for (let i = 0; i <= band.count; i++) gridAcross(i / band.count)
      if (showX) for (const tick of value.ticks) gridDown(across(tick))
    } else {
      if (showY) for (const tick of value.ticks) gridAcross(up(tick))
      if (showX && xScale) for (const tick of xScale.ticks) gridDown((tick - xScale.lo) / (xScale.hi - xScale.lo))
      else if (showX) for (const edge of band.edges()) gridDown(edge / band.count)
    }

    if (horizontal) this.horizontalBars(band, barSpans, across, at)
    else this.verticalMarks(band, barSpans, areaSpans, up, xOf, at)

    // Rules over the bars.
    for (const mark of this.of('RuleMark')) {
      const stroke = this.stroke(this.paint(mark))
      const valueAt = (v: Value | undefined) => v?.kind === 'number' ? v.value : null
      if (mark.y && !mark.x) {
        const v = horizontal ? null : valueAt(mark.y)
        const y = horizontal ? bandCentre(mark.y) : v === null ? null : up(v)
        if (y === null) throw new NotDrawn('A RuleMark here isn\'t on a value the chart shows, which the preview doesn\'t draw.')
        this.items.push({ kind: 'line', id: this.id('rule'), points: [at(0, y), at(1, y)], stroke })
        this.annotate(mark, at(0.5, y), at(0.5, y))
      } else if (mark.x && !mark.y) {
        const v = horizontal ? valueAt(mark.x) : null
        const x = horizontal ? (v === null ? null : across(v)) : xOf(mark.x)
        if (x === null) throw new NotDrawn('A RuleMark here isn\'t on a value the chart shows, which the preview doesn\'t draw.')
        this.items.push({ kind: 'line', id: this.id('rule'), points: [at(x, 0), at(x, 1)], stroke })
        this.annotate(mark, at(x, 0), at(x, 0.5))
      } else {
        throw new NotDrawn('A RuleMark with both x and y, or neither, isn\'t drawn in the preview.')
      }
    }

    // Axis labels last, over everything.
    const plotItems: PlotItem[] = [...this.items, ...this.labels]
    if (showX && horizontal) this.numberLabels(value, across, at, plotItems)
    else if (showX && xScale) this.numberLabels(xScale, v => (v - xScale.lo) / (xScale.hi - xScale.lo), at, plotItems)
    else if (showX) this.bandLabels(band, at, plotItems)
    if (showY && horizontal) {
      band.keys.forEach((key, index) => plotItems.push({ kind: 'at', at: at(0, index / band.count, LABEL_GAP, LABEL_GAP), anchor: { x: 0, y: 0 }, element: this.label(key) }))
    }
    const plot: LayoutElement = { kind: 'plot', id: this.id('plot'), items: plotItems, ideal: 100 }
    if (!showY || horizontal) return plot
    // The y axis: a column beside the plot as wide as its widest label, each label centred on its tick.
    const column: LayoutElement = {
      kind: 'plot',
      id: this.id('axis'),
      hugsWidth: LABEL_GAP,
      ideal: 100,
      items: value.ticks.map(tick => ({ kind: 'at' as const, at: at(0, up(tick), LABEL_GAP), anchor: { x: 0, y: 0.5 }, element: this.label(tickLabel(tick)) })),
    }
    return { kind: 'stack', id: this.id('axes'), axis: 'horizontal', spacing: 0, alignment: { horizontal: 'center', vertical: 'top' }, children: [plot, column] }
  }

  /** Bars, lines, points and areas over a band or numeric x axis, values up the side. */
  private verticalMarks(band: Band, barSpans: ReadonlyMap<Mark, Span>, areaSpans: ReadonlyMap<Mark, Span>, up: (v: number) => number, xOf: (v: Value | undefined) => number | null, at: At): void {
    // Bars: each stack from zero, positive and negative apart, rounded at its far end only.
    const groups = [...new Set(this.of('BarMark').flatMap(m => m.grouped !== undefined ? [m.grouped] : []))]
    for (const [mark, span] of barSpans) {
      const index = band.index(mark.x!)
      if (index < 0) continue
      let left = (index + (1 - BAR) / 2) / band.count, width = BAR / band.count
      if (mark.grouped !== undefined && groups.length) {
        const share = width / groups.length
        left += share * groups.indexOf(mark.grouped) + share * (1 - BAR) / 2
        width = share * BAR
      }
      const below = span.to < span.from
      const radius = span.outer ? BAR_RADIUS : 0
      const top = Math.max(span.from, span.to), bottom = Math.min(span.from, span.to)
      this.items.push({ kind: 'box', from: at(left, up(top)), to: at(left + width, up(bottom)), element: this.bar(below ? { bottomLeading: radius, bottomTrailing: radius } : { topLeading: radius, topTrailing: radius }, mark) })
      this.annotate(mark, at(left + width / 2, up(below ? bottom : top)), at(left + width / 2, (up(top) + up(bottom)) / 2), below)
    }

    // Areas, each series filled between its stack's base and top; then lines, then points, over them.
    const areas = this.of('AreaMark')
    for (const series of seriesOf(areas)) {
      const marks = areas.filter(m => m.series === series)
      const top: PlotPoint[] = [], base: PlotPoint[] = []
      for (const mark of marks) {
        const x = xOf(mark.x), span = areaSpans.get(mark)!
        if (x === null) continue
        top.push(at(x, up(span.to)))
        base.unshift(at(x, up(span.from)))
      }
      if (top.length > 1) this.items.push({ kind: 'line', id: this.id('area'), points: [...top, ...base], fill: this.paint(marks[0]!) })
    }
    const lines = this.of('LineMark')
    for (const series of seriesOf(lines)) {
      const marks = lines.filter(m => m.series === series)
      const points = marks.flatMap(mark => {
        const x = xOf(mark.x)
        return x === null || mark.y?.kind !== 'number' ? [] : [at(x, up(mark.y.value))]
      })
      if (points.length > 1) this.items.push({ kind: 'line', id: this.id('line'), points, stroke: this.stroke(this.paint(marks[0]!), { lineCap: 'round', lineJoin: 'round' }) })
    }
    for (const mark of [...lines, ...areas, ...this.of('PointMark')]) {
      const x = xOf(mark.x)
      if (x === null || mark.y?.kind !== 'number') continue
      const y = up(mark.y.value)
      const point = mark.name === 'PointMark'
      if (point) this.items.push({ kind: 'at', at: at(x, y), anchor: { x: 0.5, y: 0.5 }, element: this.swatch(this.paint(mark)) })
      this.annotate(mark, at(x, y, 0, point ? -POINT / 2 : 0), at(x, y))
    }
  }

  /** Bars along a numeric x, one per category band up the side, each under its band's label. */
  private horizontalBars(band: Band, barSpans: ReadonlyMap<Mark, Span>, across: (v: number) => number, at: At): void {
    for (const [mark, span] of barSpans) {
      const index = band.index(mark.y!)
      if (index < 0) continue
      const top = index / band.count, size = 1 / band.count
      const radius = span.outer ? BAR_RADIUS : 0
      // The bar is 0.7 of what the band keeps below its label, centred there.
      const spare = (1 - BAR) / 2
      this.items.push({
        kind: 'box',
        from: at(across(Math.min(span.from, span.to)), top + spare * size, 0, (1 - spare) * BAND_LABEL),
        to: at(across(Math.max(span.from, span.to)), top + (1 - spare) * size, 0, spare * BAND_LABEL),
        element: this.bar(span.to < span.from ? { topLeading: radius, bottomLeading: radius } : { topTrailing: radius, bottomTrailing: radius }, mark),
      })
    }
  }

  /** What a mark's annotation draws, where its position puts it: above the mark or over it. */
  private annotate(mark: Mark, top: PlotPoint, centre: PlotPoint, below = false): void {
    const annotation = mark.annotation
    if (!annotation) return
    const overlay = annotation.place === 'overlay'
    const element = this.annotationContent(mark)
    if (overlay) this.labels.push({ kind: 'at', at: centre, anchor: { x: 0.5, y: 0.5 }, element })
    else this.labels.push({ kind: 'at', at: { ...top, dy: (top.dy ?? 0) + (below ? LABEL_GAP : -LABEL_GAP) }, anchor: { x: 0.5, y: below ? 0 : 1 }, element })
  }

  private annotationContent(mark: Mark): LayoutElement {
    const content = mark.annotation!.content
    const converted = content.map((view, index) => this.host.content(view, `${mark.path}-annotation-${index}`))
    if (converted.length === 1) return converted[0]!
    return { kind: 'zstack', id: this.id('annotation'), alignment: { horizontal: 'center', vertical: 'center' }, children: converted }
  }

  private bar(corners: Partial<Record<'topLeading' | 'topTrailing' | 'bottomLeading' | 'bottomTrailing', number>>, mark: Mark): LayoutElement {
    const cornerRadii = { topLeading: 0, topTrailing: 0, bottomLeading: 0, bottomTrailing: 0, ...corners }
    return { kind: 'shape', id: this.id('bar'), shape: 'roundedRectangle', cornerStyle: 'circular', cornerRadius: Math.max(...Object.values(cornerRadii)), cornerRadii, fill: this.paint(mark) }
  }

  /** An 8 pt disc: a PointMark, and a series' swatch in the legend. */
  private swatch(fill: Fill): LayoutElement {
    return { kind: 'modified', id: this.id('point'), modifier: { kind: 'frame', width: POINT, height: POINT, alignment: { horizontal: 'center', vertical: 'center' } }, child: { kind: 'shape', id: this.id('dot'), shape: 'circle', fill } }
  }

  private label(text: string): LayoutElement {
    return this.host.text(this.id('label'), text, 'caption2', 'secondaryLabel')
  }

  /** Category labels centred under their bands; days start 4 after their band's edge. */
  private bandLabels(band: Band, at: At, out: PlotItem[]): void {
    if (band.days) {
      for (const edge of band.labelled) out.push({ kind: 'at', at: at(edge / band.count, 1, LABEL_GAP, LABEL_GAP), anchor: { x: 0, y: 0 }, element: this.label(dayLabel(band.days[edge]!)) })
      return
    }
    band.keys.forEach((key, index) => out.push({ kind: 'at', at: at((index + 0.5) / band.count, 1, 0, LABEL_GAP), anchor: { x: 0.5, y: 0 }, element: this.label(key) }))
  }

  /** Numbers under a numeric x axis, each 4 after its grid line; the one at the axis's end is left out. */
  private numberLabels(axis: Scale, along: (v: number) => number, at: At, out: PlotItem[]): void {
    for (const tick of axis.ticks) {
      const x = along(tick)
      if (x > 1 - 1e-9) continue
      out.push({ kind: 'at', at: at(x, 1, LABEL_GAP, LABEL_GAP), anchor: { x: 0, y: 0 }, element: this.label(tickLabel(tick)) })
    }
  }

  /** The legend: a dot and a name for each series, in the order they are first seen, in its first mark's colour. */
  private legend(): LayoutElement {
    const entries: LayoutElement[] = []
    for (const [name, mark] of this.series) {
      entries.push({ kind: 'stack', id: this.id('entry'), axis: 'horizontal', spacing: 5, alignment: { horizontal: 'center', vertical: 'center' }, children: [this.swatch(this.paint(mark)), this.label(name)] })
    }
    return { kind: 'stack', id: this.id('legend'), axis: 'horizontal', spacing: 8, alignment: { horizontal: 'center', vertical: 'center' }, children: entries }
  }

  /** `.chartYScale(domain: 0...20000)`: the range the chart keeps, or null where none is written. */
  private domain(name: string): { lo: number; hi: number } | null {
    const modifier = this.modifier(name)
    if (!modifier) return null
    const value = modifier.args.find(a => a.label === 'domain')?.value
    if (value?.kind !== 'range' || value.boundType) throw new NotDrawn(`This chart's .${name} isn't a numeric range the preview can read.`)
    return { lo: value.lower, hi: value.upper }
  }

  /**
   * `.chartXScale(domain: ["Mon", …, "Sun"])` on categories along x: the bands, in its order,
   * the ones with no data left empty (measured, iphone18pro-charts xscale-category). Any other
   * domain on a band of categories or days is a labelled box, never ignored.
   */
  private categories(horizontal: boolean, kind: Value['kind'] | null): readonly string[] | null {
    const name = horizontal ? 'chartYScale' : 'chartXScale'
    const modifier = this.modifier(name)
    if (!modifier) return null
    const domain = modifier.args.find(a => a.label === 'domain')?.value
    const keys = domain?.kind === 'array' ? domain.elements.flatMap(e => e.kind === 'string' ? [e.value] : []) : []
    if (horizontal || kind !== 'category' || domain?.kind !== 'array' || !keys.length || keys.length !== domain.elements.length) throw new NotDrawn(`This chart sets .${name} on an axis of ${kind === 'day' ? 'dates' : 'categories'}, which the preview draws only as a list of categories along x.`)
    return keys
  }

  /** Every value the value axis has to hold: each stack's ends, and each other mark's value. */
  private values(horizontal: boolean, ...stacks: ReadonlyMap<Mark, Span>[]): number[] {
    const values: number[] = [0]
    for (const spans of stacks) for (const span of spans.values()) values.push(span.to)
    for (const mark of [...this.of('LineMark'), ...this.of('PointMark'), ...this.of('RuleMark')]) {
      const along = horizontal ? mark.x : mark.y
      if (along?.kind === 'number') values.push(along.value)
    }
    return values
  }
}

/**
 * Stacks `marks` from zero at each place `key` names, positive and negative values apart, in
 * the order the marks are written: iOS stacks by data order at each place, not by series
 * (measured, iphone18pro-charts stack-order). The last of each stack is its outer end.
 */
function stack(marks: readonly Mark[], key: (mark: Mark) => string, amount: (mark: Mark) => number): Map<Mark, Span> {
  const spans = new Map<Mark, Span>()
  const ends = new Map<string, Span>()
  for (const mark of marks) {
    const v = amount(mark), place = `${key(mark)}|${v < 0 ? '-' : '+'}`
    const below = ends.get(place)
    if (below) below.outer = false
    const span: Span = { from: below?.to ?? 0, to: (below?.to ?? 0) + v, outer: true }
    spans.set(mark, span)
    ends.set(place, span)
  }
  return spans
}

function seriesOf(marks: readonly Mark[]): (string | undefined)[] {
  return [...new Set(marks.map(m => m.series))]
}


// -------------------------------------------------------------------- values

/** `.value("Day", item.day)`: what it plots, or null for anything else. */
function plotted(value: SwiftValue | undefined): { label: string; value: SwiftValue; unit?: string } | null {
  const token = payloadOf<TokenPayload>(value, TOKEN_TYPE)
  if (token?.name !== 'value' || !token.args || token.args.length < 2) return null
  const unit = payloadOf<TokenPayload>(token.args[2], TOKEN_TYPE)?.name
  return { label: token.args[0]?.kind === 'string' ? token.args[0].value : '', value: token.args[1]!, ...(unit ? { unit } : {}) }
}

function valueOf(given: ReturnType<typeof plotted>): Value | undefined {
  if (!given) return undefined
  const { value } = given
  if (value.kind === 'string') return { kind: 'category', key: value.value }
  if (value.kind === 'int' || value.kind === 'double') return Number.isFinite(value.value) ? { kind: 'number', value: value.value } : undefined
  const date = asDate(value)
  if (date) {
    // With no unit iOS spaces dates by time, its ticks in hours, days or months as the span asks
    // (measured, iphone18pro-charts hourly-line and monthly-bars): only days are drawn here.
    if (!given.unit) throw new NotDrawn('This chart plots dates with no unit:, which iOS spaces by time; the preview draws dates counted by day, with unit: .day.')
    if (given.unit !== 'day') throw new NotDrawn(`This chart counts dates by .${given.unit}; the preview draws dates by day only.`)
    return { kind: 'day', day: dayOf(date.epochSeconds) }
  }
  if (value.kind === 'bool' || value.kind === 'enum') return { kind: 'category', key: describe(value) }
  throw new NotDrawn('This chart plots a value the preview can\'t read.')
}

function numberOf(value: SwiftValue | undefined): number | null {
  return value && (value.kind === 'int' || value.kind === 'double') ? value.value : null
}

function keyOf(value: Value | SwiftValue | undefined): string {
  if (!value) return ''
  if (value.kind === 'category') return value.key
  if (value.kind === 'number') return String(value.value)
  if (value.kind === 'day') return `d${value.day}`
  return describe(value as SwiftValue)
}

function annotationOf(modifier: ModifierValue): Mark['annotation'] | null {
  const given = modifier.args.find(a => a.label === 'position' || a.label === null)?.value
  const name = payloadOf<TokenPayload>(given, TOKEN_TYPE)?.name ?? 'automatic'
  if (name !== 'top' && name !== 'overlay' && name !== 'automatic') return null
  const content = modifier.args.flatMap(a => a.label === 'content' && asView(a.value) ? [asView(a.value)!] : [])
  return content.length ? { place: name, content } : null
}

function axisKind(values: readonly Value[]): Value['kind'] | null {
  const kinds = new Set(values.map(v => v.kind))
  if (kinds.size > 1) throw new NotDrawn('This chart mixes kinds of value on one axis, which the preview doesn\'t draw.')
  return values[0]?.kind ?? null
}

// ------------------------------------------------------------------ the axes

/** A band axis: one band per category, first seen first, or per day from the first to the last. */
interface Band {
  readonly count: number
  readonly keys: readonly string[]
  readonly days: readonly number[] | null
  /** The bands whose leading edge is labelled, for days. */
  readonly labelled: readonly number[]
  index(value: Value): number
  /** Where dashed lines go down: every band's edge, or for days the ends and each labelled day. */
  edges(): number[]
}

const MAX_DAYS = 400

/** The bands along an axis: `domain`'s categories where the chart gives them, or those its values hold. */
function bandAxis(values: readonly Value[], domain: readonly string[] | null): Band {
  if (values[0]?.kind === 'day') {
    const days = values.map(v => (v as { day: number }).day)
    const first = Math.min(...days), last = Math.max(...days)
    if (last - first >= MAX_DAYS) throw new NotDrawn('This chart spans more than a year of days, which the preview doesn\'t draw.')
    const all = Array.from({ length: last - first + 1 }, (_, i) => first + i)
    const labelled = dayTicks(all)
    return {
      count: all.length, keys: all.map(dayLabel), days: all, labelled,
      index: v => v.kind === 'day' ? v.day - first : -1,
      edges: () => [...new Set([0, ...labelled, all.length])].sort((a, b) => a - b),
    }
  }
  const keys: string[] = domain ? [...domain] : []
  for (const value of values) {
    if (value.kind !== 'category' || keys.includes(value.key)) continue
    if (domain) throw new NotDrawn('This chart has categories outside its .chartXScale domain, which the preview doesn\'t draw.')
    keys.push(value.key)
  }
  return {
    count: Math.max(1, keys.length), keys, days: null, labelled: [],
    index: v => v.kind === 'category' ? keys.indexOf(v.key) : -1,
    edges: () => Array.from({ length: keys.length + 1 }, (_, i) => i),
  }
}

/**
 * Which days are labelled, as measured: every day up to 3, every second day from the first up
 * to a week, and Sundays (the first day of an en_US week) beyond, the first of each month past five weeks.
 */
function dayTicks(days: readonly number[]): number[] {
  if (days.length <= 3) return days.map((_, i) => i)
  if (days.length <= 7) return days.flatMap((_, i) => i % 2 ? [] : [i])
  const monthly = days.length > 35
  return days.flatMap((day, i) => {
    const date = new Date(day * 86_400_000)
    return (monthly ? date.getUTCDate() === 1 : date.getUTCDay() === 0) ? [i] : []
  })
}

/** Whole days since 1970 in the device's time zone, as Calendar counts the day a date is in. */
function dayOf(epochSeconds: number): number {
  const date = new Date(epochSeconds * 1000)
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayLabel(day: number): string {
  const date = new Date(day * 86_400_000)
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
}

interface Scale {
  readonly lo: number
  readonly hi: number
  readonly ticks: readonly number[]
}

/**
 * A value axis: its domain and ticks, as measured. The step is the smallest of 1, 2 and 5
 * times a power of ten, and 2.5 times one from 25 up, giving at most 4 intervals; the domain
 * holds 0 and is widened to the step's multiples, unless the chart gives its own or hides the axis.
 */
function scale(values: readonly number[], fixed: { lo: number; hi: number } | null, rounded: boolean): Scale {
  let lo = fixed ? fixed.lo : Math.min(0, ...values), hi = fixed ? fixed.hi : Math.max(0, ...values)
  if (hi - lo <= 0) hi = lo + 1
  const step = niceStep(lo, hi)
  if (!fixed && rounded) {
    lo = Math.floor(lo / step + 1e-9) * step
    hi = Math.ceil(hi / step - 1e-9) * step
  }
  const ticks: number[] = []
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + step * 1e-9; k++) ticks.push(clean(k * step))
  return { lo, hi, ticks }
}

function niceStep(lo: number, hi: number): number {
  const power = Math.floor(Math.log10((hi - lo) / 4)) - 1
  for (let k = power; k < power + 4; k++) {
    for (const m of k >= 1 ? [1, 2, 2.5, 5] : [1, 2, 5]) {
      const step = m * 10 ** k
      if (Math.ceil(hi / step - 1e-9) - Math.floor(lo / step + 1e-9) <= 4) return step
    }
  }
  return 10 ** (power + 4)
}

/** A tick's value without the float dust of a multiplied step: 0.30000000000000004 is 0.3. */
function clean(value: number): number {
  return Number(value.toPrecision(12))
}

function tickLabel(value: number): string {
  return formatNumber({ kind: 'double', value }, '') ?? String(value)
}
