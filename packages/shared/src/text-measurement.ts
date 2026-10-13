import type { ResolvedFont } from './render-tree'

/** Serializable shaped-run requests; never one worker RPC per glyph. */
export interface TextMeasureRequest {
  readonly text: string
  readonly font: ResolvedFont
  readonly tracking?: number
  readonly tabularNumbers?: boolean
}

export interface TextMetricsData {
  readonly width: number
  readonly ascent: number
  readonly descent: number
}

export interface MeasuredTextData extends TextMetricsData {
  readonly key: string
}

export function textMeasureKey(request: TextMeasureRequest): string {
  const { font, text, tracking = 0, tabularNumbers = false } = request
  // Small capitals are wider than the lowercase they replace; the plain face's key stays as it was.
  return JSON.stringify([font.family, font.size, font.weight, font.italic, tracking, tabularNumbers, text, ...(font.smallCaps ? ['small-caps'] : [])])
}

/** The same font shorthand is used by main-thread and worker canvases. */
export function canvasFont(font: ResolvedFont, family = font.family): string {
  return `${font.italic ? 'italic ' : ''}${font.smallCaps ? 'small-caps ' : ''}${font.weight} ${font.size}px ${family}`
}
