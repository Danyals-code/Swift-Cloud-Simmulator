import { canvasFont, leadingFamily, projectFamilies, type MeasuredFontData, type PreviewFontAsset, type TextMeasureRequest, type TextMetricsData } from '@studio/shared'

export const FONT_PROBE = 'AV fi Wm 0123456789 é 한글 العربية 👩🏽‍💻'

/**
 * Worker faces are accepted only after matching a main-thread reference probe. A project
 * font family the worker has loaded from the file itself (Wave 6f) is the face the page
 * draws, so it is measured here with no probe, and where the canvas gives no font box its
 * ascent and descent are the family's own, from `hhea`.
 */
export function workerTextMeasurer(fonts: readonly MeasuredFontData[], projectFonts?: readonly PreviewFontAsset[]) {
  const context = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null
  const verified = new Map<string, boolean>()
  /** Each project family's ascent and descent per point of size, by its CSS family. */
  const own = new Map<string, { readonly ascent: number; readonly descent: number }>()
  for (const [family, { metrics }] of projectFamilies(projectFonts)) own.set(family, { ascent: metrics.ascender / metrics.unitsPerEm, descent: -metrics.descender / metrics.unitsPerEm })
  /**
   * A project family's stack as a canvas can take it: the family, then the system stack
   * behind it as the page resolved it. A canvas ignores a whole font naming `var(--font-ui)`
   * and measures in the font it had, so a stack it can't resolve is left to the page.
   */
  const stacks = new Map<string, string | null>()
  const canvasStack = (family: string): string | null => {
    let stack = stacks.get(family)
    if (stack === undefined) {
      const comma = family.indexOf(','), behind = comma < 0 ? '' : family.slice(comma + 1).trim()
      const resolved = behind ? fonts.find((f) => f.family === behind)?.resolvedFamily ?? behind : ''
      stacks.set(family, stack = resolved.includes('var(') ? null : resolved ? `${family.slice(0, comma)}, ${resolved}` : family)
    }
    return stack
  }
  /** Whether the worker draws `face` as the page measured it, probed once per face. */
  const matches = (context: OffscreenCanvasRenderingContext2D, face: MeasuredFontData): boolean => {
    if (face.referenceWidth === undefined) return false
    const key = `${face.family}|${face.weight}`
    if (!verified.has(key)) {
      if ('letterSpacing' in context) context.letterSpacing = '0px'
      context.font = `${face.weight} 100px ${face.resolvedFamily}`
      verified.set(key, Math.abs(context.measureText(FONT_PROBE).width - face.referenceWidth) < 0.1)
    }
    return verified.get(key)!
  }
  /** `request` measured in `family`, with `face`'s ascent and descent per point where the canvas gives no font box. */
  const measure = (context: OffscreenCanvasRenderingContext2D, request: TextMeasureRequest, family: string, face: { readonly ascent: number; readonly descent: number }): TextMetricsData | null => {
    context.font = canvasFont(request.font, family)
    context.fontKerning = 'normal'
    if ('letterSpacing' in context) context.letterSpacing = `${request.tracking ?? 0}px`
    else if (request.tracking) return null
    const metrics = context.measureText(request.text)
    return {
      width: Math.max(0, metrics.width),
      ascent: metrics.fontBoundingBoxAscent || request.font.size * face.ascent,
      descent: metrics.fontBoundingBoxDescent || request.font.size * face.descent,
    }
  }
  return (request: TextMeasureRequest): TextMetricsData | null => {
    if (!context || request.tabularNumbers) return null
    const project = own.size ? own.get(leadingFamily(request.font.family)) : undefined
    if (project) {
      const stack = canvasStack(request.font.family)
      return stack ? measure(context, request, stack, project) : null
    }
    const face = fonts.find((f) => f.family === request.font.family && f.weight === request.font.weight)
    return face?.resolvedFamily && matches(context, face) ? measure(context, request, face.resolvedFamily, face) : null
  }
}
