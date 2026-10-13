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
 * A shape's outline as SVG path data. Circular corners use the circular cubic, and
 * continuous ones the curve of `continuousCorner`.
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
  if (style === 'continuous' && kind !== 'capsule' && r > 0) {
    // Each corner runs from the edge it leaves, along `u` from the corner, to the edge it
    // joins, along `v`.
    const ex = Math.min(SPAN * r, w / 2), ey = Math.min(SPAN * r, h / 2)
    const corner = ([cx, cy]: Pair, [ux, uy]: Pair, [vx, vy]: Pair, along: number, onto: number) =>
      continuousCorner(r, along, onto).map(segment => `C ${segment.map(([a, b]) => `${cx + a * ux + b * vx} ${cy + a * uy + b * vy}`).join(' ')}`).join(' ')
    const up: Pair = [0, -1], down: Pair = [0, 1], left: Pair = [-1, 0], right: Pair = [1, 0]
    return `M ${x + w} ${y + h / 2} V ${y + h - ey} ${corner([x + w, y + h], up, left, ey, ex)} H ${x + ex} ${corner([x, y + h], right, up, ex, ey)} V ${y + ey} ${corner([x, y], down, right, ey, ex)} H ${x + w - ex} ${corner([x + w, y], left, down, ex, ey)} Z`
  }
  const k = r * 0.5522847498
  return `M ${x + w} ${y + h / 2} V ${y + h - r} C ${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h} H ${x + r} C ${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r} V ${y + r} C ${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} H ${x + w - r} C ${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r} Z`
}

/** A point, or a direction, on screen. */
type Pair = readonly [number, number]

/** How far along each edge a continuous corner of radius r reaches, where there is room: about 1.53 r. */
const SPAN = 1.52866483

/**
 * A continuous corner of radius `r`, as the three cubics iOS draws it, measured in the
 * iOS 27 simulator: a card's corner is still 12 pt below its top 4 pt in, where a
 * circular one is 6.5. It leaves one edge `along` from the corner and joins the other
 * `onto` from it, 1.53 r each where there is room. Where a side is too short, the
 * piece that runs along that edge is squeezed into half of it and the middle stays,
 * which is what the simulator draws for a one-row card or a 44-pt square. Points are
 * (distance along the first edge, distance along the second), after the start point.
 */
function continuousCorner(r: number, along: number, onto: number): readonly (readonly Pair[])[] {
  const joinA = 0.63149399 * r, joinB = 0.074911 * r
  const squeeze = (reach: number) => (t: number) => joinA + (t - joinA) * (reach - joinA) / (SPAN * r - joinA)
  const first = squeeze(along), second = squeeze(onto)
  return [
    [[first(1.08849323 * r), 0], [first(0.86840689 * r), 0], [joinA, joinB]],
    [[0.37282392 * r, 0.16905956 * r], [0.16905956 * r, 0.37282392 * r], [joinB, joinA]],
    [[0, second(0.86840689 * r)], [0, second(1.08849323 * r)], [0, onto]],
  ]
}
