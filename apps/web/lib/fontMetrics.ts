'use client'

import type { MeasuredFontData, MeasuredTextData, TextMeasureRequest } from '@studio/shared'
import { canvasFont, graphemes, textMeasureKey, MEASURED_FAMILIES } from '@studio/shared'
import { FONT_PROBE } from './workerFontMetrics'

/**
 * Font readiness and main-thread fallback measurement. Startup tables are estimates
 * and worker verification probes; final text widths are shaped at the actual point
 * size with weight/italic/tracking, never scaled from the ASCII probe table.
 */

/** The weights the text styles in `style.ts` actually use. */
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

/** Printable ASCII. Everything else falls back to a per-script estimate in the worker. */
const CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))

/** Measuring at a large size and dividing keeps sub-pixel advances meaningful. */
const REFERENCE_SIZE = 100

/**
 * A stack a canvas can resolve.
 *
 * The shared stacks contain `var(--font-ui)`, which CSS resolves and the canvas 2D
 * `font` property does not - it takes a plain font shorthand and silently fails on
 * anything it cannot parse, which would mean measuring the default sans and never
 * knowing. So the variable is looked up and substituted before measuring, while the
 * *reported* family stays the shared constant, because that string is the key the
 * layout engine looks the metrics up by.
 */
function resolvable(stack: string): string {
  if (typeof document === 'undefined') return stack

  return stack.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_whole, name: string) => {
    // An unresolved variable becomes empty rather than staying in the list: a
    // `var(…)` left in a canvas font shorthand makes the browser reject the whole
    // declaration, and it would then measure the default sans without saying so.
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  })
}

/** Strips list entries that ended up empty after substitution. */
function tidy(stack: string): string {
  return stack
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .join(', ')
}

export function measureFonts(families: readonly string[] = MEASURED_FAMILIES): MeasuredFontData[] {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return []

  const fonts: MeasuredFontData[] = []

  for (const family of families) {
    const resolved = tidy(resolvable(family))

    for (const weight of WEIGHTS) {
      context.font = `${weight} ${REFERENCE_SIZE}px ${resolved}`

      const advances: Record<string, number> = {}
      for (const char of CHARS) {
        advances[char] = context.measureText(char).width / REFERENCE_SIZE
      }

      // `fontBoundingBox*` is the font's own declared ascent/descent, which is what
      // line layout uses - not the ink bounds of whatever string we happened to pass.
      const sample = context.measureText('Hxy')
      const ascent = (sample.fontBoundingBoxAscent || REFERENCE_SIZE * 0.78) / REFERENCE_SIZE
      const descent = (sample.fontBoundingBoxDescent || REFERENCE_SIZE * 0.22) / REFERENCE_SIZE

      fonts.push({
        // The shared stack, not the resolved one: this is a lookup key, and the
        // worker only ever has the shared constant to look up by.
        family,
        resolvedFamily: resolved,
        referenceWidth: context.measureText(FONT_PROBE).width,
        weight,
        advances,
        // Average of the lowercase letters: a better guess for unknown Latin-ish
        // glyphs than any single hard-coded constant.
        fallback: averageOf(advances, 'abcdefghijklmnopqrstuvwxyz'),
        ascent,
        descent,
      })
    }
  }

  return fonts
}

/** One main-thread batch for faces/features unavailable in the worker. */
export function measureTextBatch(requests: readonly TextMeasureRequest[]): MeasuredTextData[] {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return []
  const span = document.createElement('span')
  Object.assign(span.style, { position: 'absolute', left: '-100000px', top: '0', whiteSpace: 'pre', visibility: 'hidden' })
  document.body.append(span)
  try {
    return requests.map((request) => {
      const family = tidy(resolvable(request.font.family))
      context.font = canvasFont(request.font, family)
      context.fontKerning = 'normal'
      const metrics = context.measureText(request.text)
      let width = metrics.width + graphemes(request.text).length * (request.tracking ?? 0)
      if (request.tabularNumbers || request.tracking) {
        span.style.font = canvasFont(request.font, family)
        span.style.fontVariantNumeric = request.tabularNumbers ? 'tabular-nums' : 'normal'
        span.style.fontKerning = 'normal'
        span.style.letterSpacing = `${request.tracking ?? 0}px`
        span.textContent = request.text
        width = span.getBoundingClientRect().width
      }
      return { key: textMeasureKey(request), width: Math.max(0, width),
        ascent: metrics.fontBoundingBoxAscent || request.font.size * 0.78,
        descent: metrics.fontBoundingBoxDescent || request.font.size * 0.22 }
    })
  } finally { span.remove() }
}

function averageOf(advances: Record<string, number>, sample: string): number {
  let total = 0
  let count = 0
  for (const char of sample) {
    const width = advances[char]
    if (width !== undefined) {
      total += width
      count++
    }
  }
  return count > 0 ? total / count : 0.6
}

/**
 * Waits for webfonts before measuring.
 *
 * Measuring while a fallback face is still active would bake the wrong advances in
 * for the life of the session, and the error would be invisible - everything would
 * simply be laid out slightly wrong. With Inter now actually being loaded rather
 * than merely named, this wait does something it previously did not.
 */
export async function measureFontsWhenReady(
  families: readonly string[] = MEASURED_FAMILIES,
): Promise<MeasuredFontData[]> {
  try {
    await document.fonts.ready
  } catch {
    // Font Loading API unavailable; the measurement below still beats the estimates.
  }
  return measureFonts(families)
}
