import type { CornerStyle, ShapeKind } from './render-tree'

/**
 * The labels that give a rectangle a radius per corner, in `UnevenRoundedRectangle(…)`
 * and `.rect(…)`. The preview draws one radius on every corner, the largest (D7a).
 */
export const CORNER_RADIUS_LABELS: readonly string[] = ['topLeadingRadius', 'bottomLeadingRadius', 'bottomTrailingRadius', 'topTrailingRadius']

/** Whether a call's labels give a rectangle a radius per corner, one by one or as `cornerRadii:`. */
export function hasCornerRadii(labels: readonly (string | null)[]): boolean {
  return labels.some(label => label === 'cornerRadii' || CORNER_RADIUS_LABELS.includes(label ?? ''))
}

/**
 * A shape's outline as SVG path data. A continuous-corner approximation; circular
 * corners use the circular cubic.
 *
 * Every path runs clockwise on screen from where SwiftUI's does, measured in the iOS 27
 * simulator, because that is what `.trim` and a dash pattern count from: a circle, an
 * ellipse, a rounded rectangle and a capsule from 3 o'clock, a rectangle from its
 * top-left corner.
 */
export function shapePath(kind: ShapeKind, width: number, height: number, radius = 0, style: CornerStyle = 'circular', inset = 0): string {
  let x = inset, y = inset, w = Math.max(0, width - inset * 2), h = Math.max(0, height - inset * 2)
  if (kind === 'circle') { const side = Math.min(w, h); x += (w - side) / 2; y += (h - side) / 2; w = h = side }
  if (kind === 'circle' || kind === 'ellipse') {
    return `M ${x + w} ${y + h / 2} A ${w / 2} ${h / 2} 0 1 1 ${x} ${y + h / 2} A ${w / 2} ${h / 2} 0 1 1 ${x + w} ${y + h / 2} Z`
  }
  const r = kind === 'capsule' ? Math.min(w, h) / 2 : Math.max(0, Math.min(radius - inset, w / 2, h / 2))
  // A clip reuses this with the view's corner radius, and a rounded one is a rounded rectangle.
  if (kind === 'rectangle' && r === 0) return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`
  const k = r * (style === 'continuous' && kind !== 'capsule' ? 0.8 : 0.5522847498)
  return `M ${x + w} ${y + h / 2} V ${y + h - r} C ${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h} H ${x + r} C ${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r} V ${y + r} C ${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} H ${x + w - r} C ${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r} Z`
}
