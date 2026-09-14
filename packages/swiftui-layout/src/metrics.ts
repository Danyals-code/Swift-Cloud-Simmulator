import type { ResolvedFont } from '@studio/shared'

/**
 * Text measurement.
 *
 * The layout engine runs in a Web Worker, which has no fonts and no DOM. Rather
 * than make layout asynchronous — which would infect every call site and introduce
 * a visible reflow on the first frame — measurement is synchronous against a table
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
   * Applied only to the *estimated* table — a measured table already reflects the
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

export interface TextLineBox {
  readonly text: string
  readonly width: number
}

export interface TextMeasurement {
  readonly width: number
  readonly height: number
  readonly lines: readonly TextLineBox[]
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
 * Measures text, wrapping at `maxWidth`.
 *
 * Greedy line breaking at word boundaries, which is what CoreText does for the
 * left-aligned, unjustified text SwiftUI produces. A word longer than the available
 * width is broken mid-word rather than allowed to overflow — matching SwiftUI, and
 * avoiding a layout that silently reports a size it does not occupy.
 */
export function measureText(
  text: string,
  font: ResolvedFont,
  maxWidth: number,
  table: FontMetricsTable,
): TextMeasurement {
  const paragraphs = text.split('\n')
  const lines: TextLineBox[] = []

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push({ text: '', width: 0 })
      continue
    }
    lines.push(...wrapParagraph(paragraph, font, maxWidth, table))
  }

  return {
    width: lines.reduce((max, line) => Math.max(max, line.width), 0),
    height: lines.length * table.lineHeight(font),
    lines,
  }
}

function wrapParagraph(
  paragraph: string,
  font: ResolvedFont,
  maxWidth: number,
  table: FontMetricsTable,
): TextLineBox[] {
  const clusters = graphemes(paragraph)
  const widths = clusters.map((c) => table.advance(c, font))

  const total = widths.reduce((sum, w) => sum + w, 0)
  if (!Number.isFinite(maxWidth) || total <= maxWidth) {
    return [{ text: paragraph, width: total }]
  }

  const lines: TextLineBox[] = []
  let lineStart = 0
  let lineWidth = 0
  /** Index just past the last space seen on this line, i.e. where a break may go. */
  let lastBreak = -1

  for (let i = 0; i < clusters.length; i++) {
    const width = widths[i]!

    if (lineWidth + width > maxWidth && i > lineStart) {
      // Break at the last word boundary; if the word itself is too long, break here.
      const breakAt = lastBreak > lineStart ? lastBreak : i
      const slice = clusters.slice(lineStart, breakAt).join('')
      lines.push({ text: slice.trimEnd(), width: measureSlice(widths, lineStart, breakAt) })
      lineStart = breakAt
      lineWidth = measureSlice(widths, lineStart, i)
      lastBreak = -1
    }

    lineWidth += width
    if (clusters[i] === ' ') lastBreak = i + 1
  }

  if (lineStart < clusters.length) {
    lines.push({
      text: clusters.slice(lineStart).join('').trimEnd(),
      width: measureSlice(widths, lineStart, clusters.length),
    })
  }

  return lines
}

function measureSlice(widths: readonly number[], from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += widths[i]!
  return sum
}
