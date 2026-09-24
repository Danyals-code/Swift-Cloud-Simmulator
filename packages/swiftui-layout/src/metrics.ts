import { graphemes, textMeasureKey, type ResolvedFont, type TextMeasureRequest, type TextMetricsData, type MeasuredTextData } from '@studio/shared'

/**
 * Synchronous shaped-run measurement, cached by the full font and text. Browsers
 * supply a verified worker canvas or batch missing runs from the main thread.
 * Node and unavailable fonts use explicit estimates, never claimed as measured.
 */
/** Advance widths in em units, keyed by character. */
export type AdvanceTable = Readonly<Record<string, number>>

export interface FontMetrics {
  /** Per-character advances in em units, for the ASCII range. */
  readonly advances: AdvanceTable
  /** Advance for characters absent from the table. */
  readonly fallback: number
  /** Ascent above the baseline, in em units. */
  readonly ascent: number
  readonly descent: number
}

/**
 * Estimated advances for a geometric UI sans (Inter, SF Pro and Roboto are all
 * within a few percent of these). Replaced by real measurements in the browser.
 */
const DEFAULT_ADVANCES: AdvanceTable = {
  ' ': 0.26, '!': 0.26, '"': 0.4, '#': 0.6, $: 0.56, '%': 0.78, '&': 0.66, "'": 0.22,
  '(': 0.32, ')': 0.32, '*': 0.44, '+': 0.56, ',': 0.26, '-': 0.32, '.': 0.26, '/': 0.4,
  '0': 0.56, '1': 0.56, '2': 0.56, '3': 0.56, '4': 0.56, '5': 0.56, '6': 0.56, '7': 0.56,
  '8': 0.56, '9': 0.56,
  ':': 0.26, ';': 0.26, '<': 0.56, '=': 0.56, '>': 0.56, '?': 0.5, '@': 0.86,
  A: 0.66, B: 0.66, C: 0.68, D: 0.7, E: 0.6, F: 0.58, G: 0.72, H: 0.72, I: 0.28,
  J: 0.52, K: 0.66, L: 0.56, M: 0.86, N: 0.72, O: 0.76, P: 0.64, Q: 0.76, R: 0.66,
  S: 0.62, T: 0.6, U: 0.72, V: 0.66, W: 0.94, X: 0.64, Y: 0.62, Z: 0.6,
  '[': 0.32, '\\': 0.4, ']': 0.32, '^': 0.5, _: 0.5, '`': 0.3,
  a: 0.54, b: 0.58, c: 0.5, d: 0.58, e: 0.54, f: 0.34, g: 0.58, h: 0.56, i: 0.24,
  j: 0.24, k: 0.52, l: 0.24, m: 0.86, n: 0.56, o: 0.58, p: 0.58, q: 0.58, r: 0.36,
  s: 0.48, t: 0.36, u: 0.56, v: 0.5, w: 0.76, x: 0.5, y: 0.5, z: 0.46,
  '{': 0.34, '|': 0.26, '}': 0.34, '~': 0.56,
}

export const DEFAULT_METRICS: FontMetrics = {
  advances: DEFAULT_ADVANCES,
  fallback: 0.6,
  ascent: 0.78,
  descent: 0.22,
}

/** A table the main thread measured from the real font, for one family and weight. */
export interface MeasuredFont extends FontMetrics {
  readonly family: string
  readonly weight: number
}

export function fontKey(family: string, weight: number): string {
  return `${family}|${weight}`
}

/**
 * Font metrics, per family and weight.
 *
 * Constructed empty in the worker and in tests, where every lookup falls back to the
 * built-in estimates. The main thread measures the real faces once at startup and
 * hands them over as fallback estimates. Exact widths come from shaped runs at
 * the actual point size, synchronously or through a main-thread batch.
 */
export type RunMeasurer = (request: TextMeasureRequest) => TextMetricsData | null

export class FontMetricsTable {
  private readonly runs = new Map<string, TextMetricsData>()
  private readonly estimates = new Map<string, TextMetricsData>()
  private readonly pending = new Map<string, TextMeasureRequest>()
  private estimated = false

  beginLayout(): void { this.pending.clear(); this.estimated = false }
  get measurementState() { return { provisional: this.estimated, requests: [...this.pending.values()] } }
  setRuns(data: readonly MeasuredTextData[]): void {
    for (const entry of data) {
      if ([entry.width, entry.ascent, entry.descent].every(Number.isFinite)) {
        this.estimates.delete(entry.key)
        this.remember(entry.key, entry)
      }
    }
  }
  private remember(key: string, value: TextMetricsData): void {
    if (this.runs.size >= 12000) this.runs.delete(this.runs.keys().next().value!)
    this.runs.set(key, value)
  }
  measure(request: TextMeasureRequest): TextMetricsData {
    const key = textMeasureKey(request)
    const cached = this.runs.get(key)
    if (cached) return cached
    const measured = this.measurer?.(request)
    if (measured && [measured.width, measured.ascent, measured.descent].every(Number.isFinite)) {
      this.remember(key, measured)
      return measured
    }
    this.estimated = true
    if (this.collectRequests && this.pending.size < 2048 && request.text.length <= 8192) this.pending.set(key, request)
    const estimate = this.estimates.get(key)
    if (estimate) return estimate
    const { font, tracking = 0, tabularNumbers = false } = request
    const digit = tabularNumbers ? widestDigit(font, this) : 0
    const clusters = graphemes(request.text)
    const width = clusters.reduce((sum, cluster) => sum +
      (digit && /^[0-9]$/.test(cluster) ? digit : this.advance(cluster, font)) + tracking, 0)
    const metrics = this.metricsFor(font).metrics
    const result = { width: Math.max(0, width), ascent: metrics.ascent * font.size, descent: metrics.descent * font.size }
    if (this.estimates.size >= 12000) this.estimates.delete(this.estimates.keys().next().value!)
    if (request.text.length <= 8192) this.estimates.set(key, result)
    return result
  }
  baseline(font: ResolvedFont): number {
    const m = this.measure({ text: 'Hg', font })
    return (font.lineHeight - m.ascent - m.descent) / 2 + m.ascent
  }

  private readonly measured = new Map<string, FontMetrics>()

  constructor(fonts: readonly MeasuredFont[] = [], private readonly measurer?: RunMeasurer, private readonly collectRequests = false) {
    for (const font of fonts) this.measured.set(fontKey(font.family, font.weight), font)
  }

  get isMeasured(): boolean {
    return this.measured.size > 0
  }

  metricsFor(font: ResolvedFont): { metrics: FontMetrics; exact: boolean } {
    const exact = this.measured.get(fontKey(font.family, font.weight))
    return exact ? { metrics: exact, exact: true } : { metrics: DEFAULT_METRICS, exact: false }
  }

  /**
   * Bolder faces are wider at the same size.
   *
   * Applied only to the *estimated* table - a measured table already reflects the
   * weight it was measured at, so scaling it again would double-count.
   */
  private weightScale(weight: number): number {
    if (weight >= 700) return 1.045
    if (weight >= 600) return 1.03
    if (weight >= 500) return 1.015
    return 1
  }

  /** Advance width of one grapheme, in points. */
  advance(grapheme: string, font: ResolvedFont): number {
    const { metrics, exact } = this.metricsFor(font)
    const scale = (exact ? 1 : this.weightScale(font.weight)) * font.size
    const first = grapheme.codePointAt(0) ?? 0

    // A multi-code-point cluster is one glyph: an emoji with a skin-tone modifier, or
    // a base letter with a combining mark. Measuring per code point would double-count.
    if (first > 0x2000) return emWidthOf(first) * scale
    if (grapheme.length > 1) return (metrics.advances[String.fromCodePoint(first)] ?? emWidthOf(first)) * scale

    return (metrics.advances[grapheme] ?? metrics.fallback) * scale
  }

  lineHeight(font: ResolvedFont): number {
    return font.lineHeight
  }

  ascent(font: ResolvedFont): number {
    return this.metricsFor(font).metrics.ascent * font.size
  }
}

/** Rough em width for characters outside the Latin table. */
function emWidthOf(codePoint: number): number {
  // Emoji and pictographs render roughly square.
  if (codePoint >= 0x1f300) return 1.2
  // CJK, Hangul and full-width forms are full-em.
  if (codePoint >= 0x1100 && codePoint <= 0x11ff) return 1
  if (codePoint >= 0x2e80 && codePoint <= 0xa4cf) return 1
  if (codePoint >= 0xac00 && codePoint <= 0xd7a3) return 1
  if (codePoint >= 0xf900 && codePoint <= 0xfaff) return 1
  if (codePoint >= 0xff00 && codePoint <= 0xff60) return 1
  // Combining marks take no space of their own.
  if (codePoint >= 0x0300 && codePoint <= 0x036f) return 0
  return 0.6
}

/** One run's contribution to one line, in the order the line is painted. */
export interface TextLineSliceBox {
  /** index into the run list this measurement was made from */
  readonly run: number
  readonly text: string
  readonly width: number
  readonly baseline?: number
}

export interface TextLineBox {
  readonly fontBaseline?: number
  readonly height: number
  readonly baseline: number
  readonly text: string
  readonly width: number
  /** Absent when the text was a single run, which is the common case. */
  readonly slices?: readonly TextLineSliceBox[]
}

export interface TextMeasurement {
  readonly tightening?: number
  readonly width: number
  readonly height: number
  readonly lines: readonly TextLineBox[]
  /**
   * The fraction of the requested size the text was actually laid out at.
   *
   * 1 unless `.minimumScaleFactor` shrank it. The painter has to apply the same
   * factor, or the text is measured small and drawn large - which is the one failure
   * a measured layout exists to make impossible.
   */
  readonly scale: number
}

/**
 * One span of text with the face and spacing it is measured in.
 *
 * `tracking` is extra advance after each cluster; `.tracking` and `.kerning` both
 * arrive here. Measurement and painting must apply the same spacing.
 */
export interface MeasuredRun {
  readonly text: string
  readonly font: ResolvedFont
  readonly tracking?: number
  /** `.monospacedDigit`: every digit measures as the widest one. */
  readonly tabularNumbers?: boolean
  readonly baselineOffset?: number
}


/**
 * A grapheme with the run it came from and the width it takes.
 *
 * Breaking works on these rather than on a string because a line that crosses a run
 * boundary has to be attributable afterwards: which half of `Text("ab") + Text("ab")`
 * a given "ab" came from cannot be recovered from the line's text.
 */
interface Cluster {
  readonly spec: MeasuredRun
  readonly text: string
  readonly run: number
  readonly width: number
}

function clustersOf(
  runs: readonly MeasuredRun[],
  table: FontMetricsTable,
  tighten = 0,
): Cluster[] {
  const out: Cluster[] = []
  for (let run = 0; run < runs.length; run++) {
    const spec = runs[run]!
    const tracking = (spec.tracking ?? 0) - tighten
    // `.monospacedDigit` gives every digit the widest one's advance, which is what
    // stops a counter jittering as it counts. Measured, not painted: a column of
    // numbers that lines up on screen and not in the reported frame is no use.
    const digitWidth = spec.tabularNumbers ? widestDigit(spec.font, table) : 0

    for (const text of graphemes(spec.text)) {
      const width = digitWidth > 0 && text >= '0' && text <= '9'
        ? digitWidth
        : table.advance(text, spec.font)
      out.push({ text, run, width: width + tracking, spec: { ...spec, tracking } })
    }
  }
  return out
}

function widestDigit(font: ResolvedFont, table: FontMetricsTable): number {
  let widest = 0
  for (const digit of '0123456789') widest = Math.max(widest, table.advance(digit, font))
  return widest
}

/**
 * Measures text, wrapping at `maxWidth`.
 *
 * Greedy line breaking at word boundaries, which is what CoreText does for the
 * left-aligned, unjustified text SwiftUI produces. A word longer than the available
 * width is broken mid-word rather than allowed to overflow - matching SwiftUI, and
 * avoiding a layout that silently reports a size it does not occupy.
 */
export function measureText(
  text: string,
  font: ResolvedFont,
  maxWidth: number,
  table: FontMetricsTable,
  lineLimit: number | null = null,
  tracking = 0,
  lineSpacing = 0,
): TextMeasurement {
  return measureRuns([{ text, font, tracking }], font, maxWidth, table, lineLimit, lineSpacing)
}

/** Attributed paragraph flow; each line reserves ascent/descent for its runs. */
export function measureRuns(
  runs: readonly MeasuredRun[],
  lineFont: ResolvedFont,
  maxWidth: number,
  table: FontMetricsTable,
  lineLimit: number | null = null,
  lineSpacing = 0,
  options: MeasureOptions = {},
): TextMeasurement {
  // `.minimumScaleFactor` shrinks rather than truncating, so the size has to be found
  // by measuring: try the full size, and step down until the text fits the line limit
  // it was given or the floor is reached. SwiftUI shrinks continuously; a tenth of the
  // range is far below the point at which a difference is visible, and it bounds the
  // work at ten measurements rather than an unbounded search.
  // `.allowsTightening` draws the letters closer together rather than breaking or
  // shrinking. SwiftUI tightens a little before it does anything else, so this is
  // tried first and in small steps - a fifth of a point at a time, to a maximum of
  // half a point, which is about where tightening stops being invisible.
  if (options.allowsTightening && lineLimit !== null && lineLimit > 0) {
    // From zero, so text that already fits is never tightened: the modifier is
    // permission to tighten when it would otherwise break, not an instruction to.
    for (let step = 0; step <= 3; step++) {
      const attempt = layOut(
        runs,
        lineFont,
        maxWidth,
        table,
        null,
        lineSpacing,
        1,
        options.truncation,
        (step * 0.5) / 3,
      )
      if (attempt.lines.length <= lineLimit) return padTo(attempt, options.minimumLines, lineFont, table, lineSpacing)
    }
  }

  const floor = options.minimumScale ?? 1
  if (floor < 1 && lineLimit !== null && lineLimit > 0) {
    for (let step = 0; step <= 10; step++) {
      const scale = 1 - (step / 10) * (1 - floor)
      const attempt = layOut(runs, scaled(lineFont, scale), maxWidth, table, null, lineSpacing, scale)
      if (attempt.lines.length <= lineLimit) {
        return padTo(attempt, options.minimumLines, lineFont, table, lineSpacing)
      }
    }
    // Nothing fits even at the floor. SwiftUI shrinks as far as it is allowed and then
    // truncates what is still over, rather than giving up and drawing at full size.
    return padTo(
      layOut(runs, scaled(lineFont, floor), maxWidth, table, lineLimit, lineSpacing, floor, options.truncation),
      options.minimumLines,
      lineFont,
      table,
      lineSpacing,
    )
  }

  return padTo(
    layOut(runs, lineFont, maxWidth, table, lineLimit, lineSpacing, 1, options.truncation),
    options.minimumLines,
    lineFont,
    table,
    lineSpacing,
  )
}

/** What measurement needs beyond the text itself. */
export interface MeasureOptions {
  readonly minimumScale?: number
  readonly truncation?: 'head' | 'middle' | 'tail'
  /** `.allowsTightening`: letters may be drawn closer together to avoid a break. */
  readonly allowsTightening?: boolean
  /** `.lineLimit(2...4)` - the *floor*; the ceiling is the ordinary `lineLimit`. */
  readonly minimumLines?: number
}

/** The same face at a fraction of its size. */
function scaled(font: ResolvedFont, scale: number): ResolvedFont {
  return scale === 1
    ? font
    : { ...font, size: font.size * scale, lineHeight: font.lineHeight * scale }
}

/**
 * Reserves room for a `.lineLimit(2...4)`'s lower bound.
 *
 * The range form asks for *at least* as many lines as its floor, so a one-line label
 * inside one still occupies two - which is the whole point: a list whose rows change
 * height as their text changes is what the floor exists to prevent.
 */
function padTo(
  measured: TextMeasurement,
  minimumLines: number | undefined,
  font: ResolvedFont,
  table: FontMetricsTable,
  lineSpacing: number,
): TextMeasurement {
  if (!minimumLines || measured.lines.length >= minimumLines) return measured

  const step = table.lineHeight(font) * measured.scale + lineSpacing
  const missing = minimumLines - measured.lines.length
  return { ...measured, height: measured.height + missing * step }
}

function layOut(
  runs: readonly MeasuredRun[],
  lineFont: ResolvedFont,
  maxWidth: number,
  table: FontMetricsTable,
  lineLimit: number | null,
  lineSpacing: number,
  scale: number,
  truncation: 'head' | 'middle' | 'tail' = 'tail',
  tighten = 0,
): TextMeasurement {
  runs = scale === 1 ? runs : runs.map((run) => ({ ...run, font: scaled(run.font, scale), tracking: (run.tracking ?? 0) * scale, baselineOffset: (run.baselineOffset ?? 0) * scale }))
  const multiRun = runs.length > 1
  const all = clustersOf(runs, table, tighten)

  let wrapped: WrappedLine[] = []
  let paragraph: Cluster[] = []
  const paragraphs: Cluster[][] = []

  const endParagraph = (): void => {
    const index = paragraphs.length
    paragraphs.push(paragraph)
    wrapped.push(...wrapParagraph(paragraph, maxWidth, index, table))
    paragraph = []
  }

  for (const cluster of all) {
    if (cluster.text === '\n') {
      endParagraph()
      continue
    }
    paragraph.push(cluster)
  }
  endParagraph()

  // `.lineLimit(n)` truncates rather than shrinking, and the last kept line takes an
  // ellipsis - which also has to fit, so it replaces part of the line rather than
  // pushing it past its width.
  //
  // What it replaces is decided against *everything still to come*, not against the
  // last kept line alone: `.head` keeps the end of the text and `.middle` keeps both
  // ends, and neither means anything if the text beyond the break has already been
  // thrown away. Tail truncation is unaffected, which is why this went unnoticed.
  if (lineLimit !== null && lineLimit > 0 && wrapped.length > lineLimit) {
    const kept = wrapped.slice(0, lineLimit)
    const last = kept[kept.length - 1]!
    const remaining = paragraphs[last.paragraph]!.slice(last.from)
    kept[kept.length - 1] = {
      ...last,
      clusters: truncate(remaining, lineFont, maxWidth, table, truncation),
    }
    wrapped = kept
  }

  const lines = wrapped.map((line) => line.clusters)

  const boxes = lines.map((line) => toLineBox(line, multiRun, table, lineFont))

  return {
    width: boxes.reduce((max, line) => Math.max(max, line.width), 0),
    // `.lineSpacing` is the gap *between* lines, so one line is unaffected by it.
    height: boxes.reduce((sum, line) => sum + line.height, 0) + Math.max(0, boxes.length - 1) * lineSpacing,
    lines: boxes,
    tightening: tighten,
    scale,
  }
}

function slicesOf(clusters: readonly Cluster[]): { run: number; text: string; spec: MeasuredRun }[] {
  const slices: { run: number; text: string; spec: MeasuredRun }[] = []
  for (const cluster of clusters) {
    const last = slices[slices.length - 1]
    if (last?.run === cluster.run) last.text += cluster.text
    else slices.push({ run: cluster.run, text: cluster.text, spec: cluster.spec })
  }
  return slices
}

function toLineBox(clusters: readonly Cluster[], multiRun: boolean, table: FontMetricsTable, font: ResolvedFont): TextLineBox {
  const slices = slicesOf(clusters)
  const base = table.baseline(font)
  let above = base
  let below = font.lineHeight - base
  const boxes = slices.map(({ run, text, spec }) => {
    const metrics = table.measure({ ...spec, text })
    const baseline = (spec.font.lineHeight - metrics.ascent - metrics.descent) / 2 + metrics.ascent
    above = Math.max(above, baseline + (spec.baselineOffset ?? 0))
    below = Math.max(below, spec.font.lineHeight - baseline - (spec.baselineOffset ?? 0))
    return { run, text, width: metrics.width, baseline }
  })
  return {
    text: clusters.map((c) => c.text).join(''),
    width: boxes.reduce((sum, slice) => sum + slice.width, 0),
    height: above + below,
    baseline: above,
    fontBaseline: boxes[0]?.baseline ?? base,
    ...(multiRun ? { slices: boxes } : {}),
  }
}

/**
 * Replaces part of a line with an ellipsis, keeping it inside `maxWidth`.
 *
 * `.truncationMode` says which part. The tail is SwiftUI's default and the one people
 * mean; `.head` keeps the end of a path or a filename, and `.middle` keeps both ends,
 * which is what a Finder-style label needs. All three keep exactly the clusters that
 * fit, so the line never reports a width it does not occupy.
 */
function truncate(
  line: readonly Cluster[],
  font: ResolvedFont,
  maxWidth: number,
  table: FontMetricsTable,
  mode: 'head' | 'middle' | 'tail' = 'tail',
): Cluster[] {
  const source = line[line.length - 1]
  const mark: Cluster = { text: '…', run: source?.run ?? 0, width: 0, spec: source?.spec ?? { text: '', font } }
  const clusters = trimEnd(line)
  const candidate = (count: number): Cluster[] => {
    if (mode === 'head') return [mark, ...clusters.slice(clusters.length - count)]
    if (mode === 'tail') return [...trimEnd(clusters.slice(0, count)), mark]
    const lead = Math.ceil(count / 2)
    return [...trimEnd(clusters.slice(0, lead)), mark, ...clusters.slice(clusters.length - (count - lead))]
  }
  let lo = 0, hi = clusters.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(candidate(mid), table) <= maxWidth + BREAK_TOLERANCE) lo = mid
    else hi = mid - 1
  }
  return candidate(lo)
}

function measure(clusters: readonly Cluster[], table: FontMetricsTable): number {
  return slicesOf(clusters).reduce((sum, slice) => sum + table.measure({ ...slice.spec, text: slice.text }).width, 0)
}

function trimEnd(clusters: readonly Cluster[]): Cluster[] {
  let end = clusters.length
  while (end > 0 && clusters[end - 1]!.text === ' ') end--
  return clusters.slice(0, end)
}

/**
 * How far text may exceed its width before a line breaks.
 *
 * Not a fudge factor - a numerical one. A stack placed at exactly the size it
 * measured divides that size back up by subtraction, so the last child is offered
 * its own ideal width minus a few units in the last place. Without a tolerance,
 * `HStack { Image(...); Text("Starred") }` wraps to two lines purely because
 * `83.18 - 6 - 20.06` is a hair under `57.12`. At a twentieth of a point the
 * tolerance is invisible, and it is four orders of magnitude above the error it
 * absorbs.
 */
const BREAK_TOLERANCE = 0.05

/** A wrapped line, and where in its paragraph it started - which truncation needs. */
interface WrappedLine {
  readonly clusters: Cluster[]
  readonly paragraph: number
  readonly from: number
}

function wrapParagraph(
  clusters: readonly Cluster[],
  maxWidth: number,
  paragraph: number,
  table: FontMetricsTable,
): WrappedLine[] {
  if (clusters.length === 0) return [{ clusters: [], paragraph, from: 0 }]
  const limit = maxWidth + BREAK_TOLERANCE
  if (!Number.isFinite(maxWidth) || measure(clusters, table) <= limit) {
    return [{ clusters: [...clusters], paragraph, from: 0 }]
  }
  const lines: WrappedLine[] = []
  let start = 0
  while (start < clusters.length) {
    let lo = start + 1, hi = clusters.length
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (measure(clusters.slice(start, mid), table) <= limit) lo = mid
      else hi = mid - 1
    }
    let end = lo
    if (end < clusters.length && clusters[end]!.text !== ' ') {
      // A word ending exactly at the limit already IS a word boundary.
      // Backtracking here moved that whole word onto the next line during placement.
      // Prefer a word boundary. CJK and an overlong word can break at a grapheme.
      for (let i = end - 1; i >= start; i--) {
        if (clusters[i]!.text === ' ') { end = i + 1; break }
      }
    }
    lines.push({ clusters: trimEnd(clusters.slice(start, end)), paragraph, from: start })
    start = end
    while (start < clusters.length && clusters[start]!.text === ' ') start++
  }
  return lines
}
