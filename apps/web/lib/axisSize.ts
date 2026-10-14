import type { AxisSize } from '@studio/shared'

/**
 * An axis switched to Hug, Fill or Fixed, as the Layout section and a double-clicked canvas
 * handle switch it. A minimum and a maximum go along between Hug and Fill, and a Hug keeps
 * its maximum only where a fill can hug up to it; a Fixed size takes neither, nor leaves
 * one behind. A switch to Fixed gives no size: the caller says where it starts.
 */
export function withMode(size: AxisSize, mode: AxisSize['mode'], surface: boolean): AxisSize {
  if (size.mode === 'fixed' || mode === 'fixed') return { mode }
  return { mode, ...size.min !== undefined ? { min: size.min } : {}, ...size.max !== undefined && (mode === 'fill' || surface) ? { max: size.max } : {} }
}
