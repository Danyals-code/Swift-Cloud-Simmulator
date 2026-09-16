import type { ResolvedFont } from '@studio/shared'

/**
 * Text measurement.
 *
 * The layout engine runs in a Web Worker, which has no fonts and no DOM. Rather
 * than make layout asynchronous - which would infect every call site and introduce
 * a visible reflow on the first frame - measurement is synchronous against a table
 * of per-character advance widths.
 *
 * The table is built once on the main thread from the real font (see
 * `apps/web/lib/fontMetrics.ts`) and handed to the worker. Until it arrives, and in
 * Node for tests, the built-in estimates below are used. That makes layout
 * deterministic and unit-testable, with the browser supplying exact numbers in
 * production.
 *
 * **Known limitation:** summing advances ignores kerning and ligatures. For Latin UI
 * text the error is well under 1% of line width, and it never accumulates across
 * lines because each line re-measures from its own characters. It would matter for
 * justified body text, which SwiftUI does not do.
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
 * hands them over, after which lookups are exact.
 */
export class FontMetricsTable {
  private readonly measured = new Map<string, FontMetrics>()

  constructor(fonts: readonly MeasuredFont[] = []) {
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
    if (grapheme.length > 1 || first > 0x2000) return emWidthOf(first) * scale

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
}

export interface TextLineBox {
  readonly text: string
  readonly width: number
  /** Absent when the text was a single run, which is the common case. */
  readonly slices?: readonly TextLineSliceBox[]
}

export interface TextMeasurement {
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
 * `tracking` is extra advance after each cluster - `.tracking` and `.kerning` both
 * arrive here. It is part of *measurement* rather than painting, which is the whole
 * reason the attribute could not simply be handed to the renderer.
 */
export interface MeasuredRun {
  readonly text: string
  readonly font: ResolvedFont
  readonly tracking?: number
}

const GRAPHEME_SEGMENTER =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

function graphemes(text: string): string[] {
  if (!GRAPHEME_SEGMENTER) return [...text]
  return Array.from(GRAPHEME_SEGMENTER.segment(text), (s) => s.segment)
}

/**
 * A grapheme with the run it came from and the width it takes.
 *
 * Breaking works on these rather than on a string because a line that crosses a run
 * boundary has to be attributable afterwards: which half of `Text("ab") + Text("ab")`
 * a given "ab" came from cannot be recovered from the line's text.
 */
interface Cluster {
  readonly text: string
  readonly run: number
  readonly width: number
}

function clustersOf(runs: readonly MeasuredRun[], table: FontMetricsTable): Cluster[] {
  const out: Cluster[] = []
  for (let run = 0; run < runs.length; run++) {
    const spec = runs[run]!
    const tracking = spec.tracking ?? 0
    for (const text of graphemes(spec.text)) {
      out.push({ text, run, width: table.advance(text, spec.font) + tracking })
    }
  }
  return out
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

/**
 * Measures attributed spans as one paragraph flow.
 *
 * `lineFont` decides the line height. SwiftUI uses the `Text`'s own font for that
 * rather than growing the line box to fit a larger concatenated span, and
 * reproducing it keeps a mixed-size concatenation from re-spacing the paragraph
 * around it.
 */
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
  const floor = options.minimumScale ?? 1
  if (floor < 1 && lineLimit !== null && lineLimit > 0) {
    for (let step = 0; step <= 10; step++) {
      const scale = 1 - (step / 10) * (1 - floor)
      const attempt = layOut(runs, scaled(lineFont, scale), maxWidth, table, null, lineSpacing, scale)
      if (attempt.lines.length <= lineLimit) return attempt
    }
    // Nothing fits even at the floor. SwiftUI shrinks as far as it is allowed and then
    // truncates what is still over, rather than giving up and drawing at full size.
    return layOut(
      runs,
      scaled(lineFont, floor),
      maxWidth,
      table,
      lineLimit,
      lineSpacing,
      floor,
      options.truncation,
    )
  }

  return layOut(runs, lineFont, maxWidth, table, lineLimit, lineSpacing, 1, options.truncation)
}

/** What measurement needs beyond the text itself. */
export interface MeasureOptions {
  readonly minimumScale?: number
  readonly truncation?: 'head' | 'middle' | 'tail'
}

/** The same face at a fraction of its size. */
function scaled(font: ResolvedFont, scale: number): ResolvedFont {
  return scale === 1
    ? font
    : { ...font, size: font.size * scale, lineHeight: font.lineHeight * scale }
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
): TextMeasurement {
  runs = scale === 1 ? runs : runs.map((run) => ({ ...run, font: scaled(run.font, scale) }))
  const multiRun = runs.length > 1
  const all = clustersOf(runs, table)

  let wrapped: WrappedLine[] = []
  let paragraph: Cluster[] = []
  const paragraphs: Cluster[][] = []

  const endParagraph = (): void => {
    const index = paragraphs.length
    paragraphs.push(paragraph)
    wrapped.push(...wrapParagraph(paragraph, maxWidth, index))
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

  const boxes = lines.map((line) => toLineBox(line, multiRun))
  const lineHeight = table.lineHeight(lineFont)

  return {
    width: boxes.reduce((max, line) => Math.max(max, line.width), 0),
    // `.lineSpacing` is the gap *between* lines, so one line is unaffected by it.
    height: boxes.length * lineHeight + Math.max(0, boxes.length - 1) * lineSpacing,
    lines: boxes,
    scale,
  }
}

function toLineBox(clusters: readonly Cluster[], multiRun: boolean): TextLineBox {
  const text = clusters.map((c) => c.text).join('')
  const width = clusters.reduce((sum, c) => sum + c.width, 0)
  if (!multiRun) return { text, width }

  const slices: TextLineSliceBox[] = []
  for (const cluster of clusters) {
    const last = slices[slices.length - 1]
    if (last && last.run === cluster.run) {
      slices[slices.length - 1] = {
        run: last.run,
        text: last.text + cluster.text,
        width: last.width + cluster.width,
      }
    } else {
      slices.push({ run: cluster.run, text: cluster.text, width: cluster.width })
    }
  }
  return { text, width, slices }
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
  const ellipsis = '…'
  const run = line[line.length - 1]?.run ?? 0
  const width = table.advance(ellipsis, font)
  const mark: Cluster = { text: ellipsis, run, width }
  const clusters = trimEnd(line)
  const budget = Number.isFinite(maxWidth) ? maxWidth - width : Number.POSITIVE_INFINITY

  if (mode === 'head') return [mark, ...takeFrom(clusters, budget, 'end')]
  if (mode === 'tail') return [...trimEnd(takeFrom(clusters, budget, 'start')), mark]

  // Middle: half the budget from each end, the leading half taking the odd point so a
  // single-character budget keeps the first character rather than the last.
  const lead = trimEnd(takeFrom(clusters, budget / 2, 'start'))
  const tail = takeFrom(clusters.slice(lead.length), budget - measure(lead), 'end')
  return [...lead, mark, ...tail]
}

/** As many clusters as fit in `budget`, taken from one end. */
function takeFrom(clusters: readonly Cluster[], budget: number, from: 'start' | 'end'): Cluster[] {
  const ordered = from === 'start' ? clusters : [...clusters].reverse()
  let used = 0
  const kept: Cluster[] = []
  for (const cluster of ordered) {
    if (used + cluster.width > budget) break
    kept.push(cluster)
    used += cluster.width
  }
  return from === 'start' ? kept : kept.reverse()
}

function measure(clusters: readonly Cluster[]): number {
  return clusters.reduce((sum, c) => sum + c.width, 0)
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
): WrappedLine[] {
  if (clusters.length === 0) return [{ clusters: [], paragraph, from: 0 }]

  const limit = maxWidth + BREAK_TOLERANCE
  const total = clusters.reduce((sum, c) => sum + c.width, 0)
  if (!Number.isFinite(maxWidth) || total <= limit) {
    return [{ clusters: [...clusters], paragraph, from: 0 }]
  }

  const lines: WrappedLine[] = []
  let lineStart = 0
  let lineWidth = 0
  /** Index just past the last space seen on this line, i.e. where a break may go. */
  let lastBreak = -1

  for (let i = 0; i < clusters.length; i++) {
    const width = clusters[i]!.width

    if (lineWidth + width > limit && i > lineStart) {
      // Break at the last word boundary; if the word itself is too long, break here.
      const breakAt = lastBreak > lineStart ? lastBreak : i
      lines.push({ clusters: trimEnd(clusters.slice(lineStart, breakAt)), paragraph, from: lineStart })
      lineStart = breakAt
      lineWidth = measureSlice(clusters, lineStart, i)
      lastBreak = -1
    }

    lineWidth += width
    if (clusters[i]!.text === ' ') lastBreak = i + 1
  }

  if (lineStart < clusters.length) {
    lines.push({ clusters: trimEnd(clusters.slice(lineStart)), paragraph, from: lineStart })
  }

  return lines
}

function measureSlice(clusters: readonly Cluster[], from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += clusters[i]!.width
  return sum
}
