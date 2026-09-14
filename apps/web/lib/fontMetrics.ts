'use client'

import type { MeasuredFontData } from '@studio/shared'
import { UI_FONT_FAMILY } from '@studio/swiftui-runtime'

/**
 * Measures the real font once, on the main thread, for the worker to lay out with.
 *
 * The worker has no fonts and no DOM. The alternative designs were to make layout
 * asynchronous (which infects every call site and causes a visible reflow on the
 * first frame) or to ship a hand-transcribed metrics table (which is wrong the moment
 * the font stack falls back to something else on the user's machine).
 *
 * Measuring the *actual resolved font* at startup avoids both: layout stays
 * synchronous, and the numbers describe the glyphs the user will really see.
 */

/** The weights the text styles in `style.ts` actually use. */
const WEIGHTS = [400, 600, 700]

/** Printable ASCII. Everything else falls back to a per-script estimate in the worker. */
const CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))

/** Measuring at a large size and dividing keeps sub-pixel advances meaningful. */
const REFERENCE_SIZE = 100

export function measureFonts(family = UI_FONT_FAMILY): MeasuredFontData[] {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return []

  const fonts: MeasuredFontData[] = []

  for (const weight of WEIGHTS) {
    context.font = `${weight} ${REFERENCE_SIZE}px ${family}`

    const advances: Record<string, number> = {}
    for (const char of CHARS) {
      advances[char] = context.measureText(char).width / REFERENCE_SIZE
    }

    // `fontBoundingBox*` is the font's own declared ascent/descent, which is what
    // line layout uses — not the ink bounds of whatever string we happened to pass.
    const sample = context.measureText('Hxy')
    const ascent = (sample.fontBoundingBoxAscent || REFERENCE_SIZE * 0.78) / REFERENCE_SIZE
    const descent = (sample.fontBoundingBoxDescent || REFERENCE_SIZE * 0.22) / REFERENCE_SIZE

    fonts.push({
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
 * for the life of the session, and the error would be invisible — everything would
 * simply be laid out slightly wrong.
 */
export async function measureFontsWhenReady(family = UI_FONT_FAMILY): Promise<MeasuredFontData[]> {
  try {
    await document.fonts.ready
  } catch {
    // Font Loading API unavailable; the measurement below still beats the estimates.
  }
  return measureFonts(family)
}
