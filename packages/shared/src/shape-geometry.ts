import type { CornerStyle, ShapeKind } from './render-tree'

/** A continuous-corner approximation; circular corners use the circular cubic. */
export function shapePath(kind: ShapeKind, width: number, height: number, radius = 0, style: CornerStyle = 'circular', inset = 0): string {
  let x = inset, y = inset, w = Math.max(0, width - inset * 2), h = Math.max(0, height - inset * 2)
  if (kind === 'circle') { const side = Math.min(w, h); x += (w - side) / 2; y += (h - side) / 2; w = h = side }
  if (kind === 'circle' || kind === 'ellipse') {
    return `M ${x + w / 2} ${y} A ${w / 2} ${h / 2} 0 1 1 ${x + w / 2} ${y + h} A ${w / 2} ${h / 2} 0 1 1 ${x + w / 2} ${y} Z`
  }
  const r = kind === 'capsule' ? Math.min(w, h) / 2 : Math.max(0, Math.min(radius - inset, w / 2, h / 2))
  const k = r * (style === 'continuous' && kind !== 'capsule' ? 0.8 : 0.5522847498)
  return `M ${x + r} ${y} H ${x + w - r} C ${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r} V ${y + h - r} C ${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h} H ${x + r} C ${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r} V ${y + r} C ${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} Z`
}
