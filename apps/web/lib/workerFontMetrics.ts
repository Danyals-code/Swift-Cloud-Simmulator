import { canvasFont, type MeasuredFontData, type TextMeasureRequest, type TextMetricsData } from '@studio/shared'

export const FONT_PROBE = 'AV fi Wm 0123456789 é 한글 العربية 👩🏽‍💻'

/** Worker faces are accepted only after matching a main-thread reference probe. */
export function workerTextMeasurer(fonts: readonly MeasuredFontData[]) {
  const context = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null
  const verified = new Map<string, boolean>()
  return (request: TextMeasureRequest): TextMetricsData | null => {
    if (!context || request.tabularNumbers) return null
    const face = fonts.find((f) => f.family === request.font.family && f.weight === request.font.weight)
    if (!face?.resolvedFamily || face.referenceWidth === undefined) return null
    const key = `${face.family}|${face.weight}`
    if (!verified.has(key)) {
      if ('letterSpacing' in context) context.letterSpacing = '0px'
      context.font = `${face.weight} 100px ${face.resolvedFamily}`
      verified.set(key, Math.abs(context.measureText(FONT_PROBE).width - face.referenceWidth) < 0.1)
    }
    if (!verified.get(key)) return null
    context.font = canvasFont(request.font, face.resolvedFamily)
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
}
