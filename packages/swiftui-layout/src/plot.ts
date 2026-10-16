import type { Fill, Point, Rect } from '@studio/shared'
import type { PlotPoint } from './elements'

/**
 * The geometry of a plot's items (Wave 6e): where a place in a plot lands once its size is
 * known, and the outline of a pie's wedge. Kept apart from the engine, which only asks.
 */

/** Where `point` lands in `box`, or in the square centred in it. */
export function plotPlace(point: PlotPoint, box: Rect, square = false): { x: number; y: number } {
  if (!square) return { x: box.x + point.x * box.width + (point.dx ?? 0), y: box.y + point.y * box.height + (point.dy ?? 0) }
  const side = Math.min(box.width, box.height)
  return {
    x: box.x + (box.width - side) / 2 + point.x * side + (point.dx ?? 0),
    y: box.y + (box.height - side) / 2 + point.y * side + (point.dy ?? 0),
  }
}

const round = (value: number) => Math.round(value * 100) / 100

/** SVG path data through `points`, relative to `origin`, closed when it is filled. */
export function plotLinePath(points: readonly { x: number; y: number }[], origin: { x: number; y: number }, closed: boolean): string {
  let d = ''
  for (const [index, point] of points.entries()) d += `${index ? 'L' : 'M'}${round(point.x - origin.x)} ${round(point.y - origin.y)}`
  return closed ? `${d}Z` : d
}

/**
 * `fill` for a path drawn over the whole of `box` through `points`: a gradient's unit points
 * are moved from the points' own extent to the box's, as a chart mark's gradient runs across
 * the mark, a line's from its first point to its last, not across the plot (measured,
 * iphone18pro-charts gradient). A colour is returned as it is.
 */
export function fitFill(fill: Fill, points: readonly { x: number; y: number }[], box: Rect): Fill {
  if (fill.kind === 'solid' || fill.kind === 'mesh') return fill
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
  }
  if (minX > maxX) return fill
  const move = (unit: Point): Point => ({
    x: box.width > 0 ? (minX + unit.x * (maxX - minX) - box.x) / box.width : unit.x,
    y: box.height > 0 ? (minY + unit.y * (maxY - minY) - box.y) / box.height : unit.y,
  })
  return fill.kind === 'linearGradient' ? { ...fill, start: move(fill.start), end: move(fill.end) } : { ...fill, center: move(fill.center) }
}

/**
 * A wedge of the ring centred in `box`, as SVG path data relative to the box: from `start` to
 * `end` turns clockwise from 12 o'clock, its radius half the box's shorter side, hollow to
 * `inner` of it. Each straight side moves `inset` points in, parallel to itself, as Charts'
 * `angularInset` does: the gap between two wedges is as wide at the rim as at the centre
 * (measured, iphone18pro-charts donut). Empty when the inset leaves nothing.
 */
export function wedgePath(box: Rect, start: number, end: number, inner: number, inset: number): string {
  const radius = Math.min(box.width, box.height) / 2
  const cx = box.width / 2, cy = box.height / 2
  const from = start * 2 * Math.PI, to = end * 2 * Math.PI
  const span = to - from
  if (span <= 0 || radius <= 0) return ''
  const at = (r: number, angle: number) => `${round(cx + r * Math.sin(angle))} ${round(cy - r * Math.cos(angle))}`
  const hole = radius * Math.max(0, Math.min(1, inner))
  // A whole turn has no sides to move in: two half circles, and the hole the other way.
  if (span >= 2 * Math.PI - 1e-9) {
    const ring = `M${at(radius, 0)}A${round(radius)} ${round(radius)} 0 1 1 ${at(radius, Math.PI)}A${round(radius)} ${round(radius)} 0 1 1 ${at(radius, 0)}Z`
    return hole > 0 ? `${ring}M${at(hole, 0)}A${round(hole)} ${round(hole)} 0 1 0 ${at(hole, Math.PI)}A${round(hole)} ${round(hole)} 0 1 0 ${at(hole, 0)}Z` : ring
  }
  const shift = (r: number) => (inset > 0 ? Math.asin(Math.min(1, inset / r)) : 0)
  const outer = shift(radius)
  if (span - 2 * outer <= 0) return ''
  const large = (sweep: number) => (sweep > Math.PI ? 1 : 0)
  let d = `M${at(radius, from + outer)}A${round(radius)} ${round(radius)} 0 ${large(span - 2 * outer)} 1 ${at(radius, to - outer)}`
  if (hole > inset && span - 2 * shift(hole) > 0) {
    const near = shift(hole)
    d += `L${at(hole, to - near)}A${round(hole)} ${round(hole)} 0 ${large(span - 2 * near)} 0 ${at(hole, from + near)}`
  } else {
    // The two moved sides meet on the wedge's middle line, out from the centre, or behind it
    // for a wedge of more than half a turn, whose gap is on the far side.
    const reach = inset > 0 ? inset / Math.sin(span / 2) : 0
    d += `L${at(reach, from + span / 2 + (span > Math.PI ? Math.PI : 0))}`
  }
  return `${d}Z`
}
