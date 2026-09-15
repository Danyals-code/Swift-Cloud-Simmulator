'use client'

import type { MeasuredFontData } from '@studio/shared'
import { MEASURED_FAMILIES } from '@studio/shared'

/**
 * Measures the real fonts once, on the main thread, for the worker to lay out with.
 *
 * The worker has no fonts and no DOM. The alternative designs were to make layout
 * asynchronous (which infects every call site and causes a visible reflow on the
 * first frame) or to ship a hand-transcribed metrics table (which is wrong the moment
 * the font stack falls back to something else on the user's machine).
 *
 * Measuring the *actual resolved font* at startup avoids both: layout stays
 * synchronous, and the numbers describe the glyphs the user will really see. That
 * matters more now than it did: the stack resolves to SF Pro on a Mac and to Inter
 * on Windows, and those are different widths.
 */

/** The weights the text styles in `style.ts` actually use. */
const WEIGHTS = [400, 600, 700]

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
