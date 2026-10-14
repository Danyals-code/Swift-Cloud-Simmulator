import type { CornerRadii, CornerStyle, ShapeKind } from './render-tree'

/**
 * The labels that give a rectangle a radius per corner, in `UnevenRoundedRectangle(…)`
 * and `.rect(…)`. Each corner is drawn with its own radius.
 */
export const CORNER_RADIUS_LABELS: readonly string[] = ['topLeadingRadius', 'bottomLeadingRadius', 'bottomTrailingRadius', 'topTrailingRadius']

/**
 * The outline a view is cut to or drawn in: its kind, one corner radius, each corner's own
 * radius where they differ, and how its corners curve.
 */
export interface ShapeOutline {
  readonly kind: ShapeKind
  readonly cornerRadius: number
  readonly cornerRadii?: CornerRadii
  readonly style?: CornerStyle
}

/** Whether a call's labels give a rectangle a radius per corner, one by one or as `cornerRadii:`. */
export function hasCornerRadii(labels: readonly (string | null)[]): boolean {
  return labels.some(label => label === 'cornerRadii' || CORNER_RADIUS_LABELS.includes(label ?? ''))
}

/**
 * A shape's outline as SVG path data. Circular corners are plain arcs, and continuous
 * ones the curve of `continuousHalf`. `radius` is one radius for every corner, or each
 * corner's own.
 *
 * Every path runs clockwise on screen from where SwiftUI's does, measured in the iOS 27
 * simulator, because that is what `.trim` and a dash pattern count from: a circle, an
 * ellipse, a rounded rectangle and a capsule from 3 o'clock, a rectangle from its
 * top-left corner. Where a top corner reaches below the middle of the right side, the
 * path starts where that corner ends instead, so no edge is drawn twice.
 */
export function shapePath(kind: ShapeKind, width: number, height: number, radius: number | CornerRadii = 0, style: CornerStyle = 'circular', inset = 0): string {
  let x = inset, y = inset, w = Math.max(0, width - inset * 2), h = Math.max(0, height - inset * 2)
  if (kind === 'circle') { const side = Math.min(w, h); x += (w - side) / 2; y += (h - side) / 2; w = h = side }
  if (kind === 'circle' || kind === 'ellipse') {
    return `M ${snap(x + w)} ${snap(y + h / 2)} A ${snap(w / 2)} ${snap(h / 2)} 0 1 1 ${snap(x)} ${snap(y + h / 2)} A ${snap(w / 2)} ${snap(h / 2)} 0 1 1 ${snap(x + w)} ${snap(y + h / 2)} Z`
  }
  const given = typeof radius === 'number' ? { topLeading: radius, bottomLeading: radius, bottomTrailing: radius, topTrailing: radius } : radius
  const inner = (r: number) => kind === 'capsule' ? Math.min(w, h) / 2 : Math.max(0, r - inset)
  let tl = inner(given.topLeading), bl = inner(given.bottomLeading), br = inner(given.bottomTrailing), tr = inner(given.topTrailing)
  // A clip reuses this with the view's corner radius, and a rounded one is a rounded rectangle.
  if (kind === 'rectangle' && tl + bl + br + tr === 0) return `M ${snap(x)} ${snap(y)} H ${snap(x + w)} V ${snap(y + h)} H ${snap(x)} Z`
  // Corners too big for a side all shrink by the same factor, as SwiftUI shrinks them.
  const fit = Math.min(1, ...[[w, tl + tr], [w, bl + br], [h, tl + bl], [h, tr + br]].filter(([, sum]) => sum! > 0).map(([side, sum]) => side! / sum!))
  tl *= fit; bl *= fit; br *= fit; tr *= fit
  // Each side is shared by its two corners in proportion to their radii.
  const share = (side: number, r: number, other: number) => r + other > 0 ? side * r / (r + other) : 0
  const continuous = style === 'continuous'
  const corners = [
    { at: [x + w, y + h], along: [0, -1], onto: [-1, 0], r: br, first: share(h, br, tr), second: share(w, br, bl) },
    { at: [x, y + h], along: [1, 0], onto: [0, -1], r: bl, first: share(w, bl, br), second: share(h, bl, tl) },
    { at: [x, y], along: [0, 1], onto: [1, 0], r: tl, first: share(h, tl, bl), second: share(w, tl, tr) },
    { at: [x + w, y], along: [-1, 0], onto: [0, 1], r: tr, first: share(w, tr, tl), second: share(h, tr, br) },
  ] as const
  const drawn = corners.map(c => corner(c.at, c.along, c.onto, c.r, c.first, c.second, continuous))
  const start = Math.min(Math.max(y + h / 2, drawn[3]!.end[1]), drawn[0]!.start[1])
  return `M ${snap(x + w)} ${snap(start)} V ${snap(drawn[0]!.start[1])} ${drawn[0]!.d} H ${snap(drawn[1]!.start[0])} ${drawn[1]!.d} V ${snap(drawn[2]!.start[1])} ${drawn[2]!.d} H ${snap(drawn[3]!.start[0])} ${drawn[3]!.d} Z`
}

/** A point, or a direction, on screen. */
type Pair = readonly [number, number]

/** Path numbers to a ten-thousandth of a point: finer than any screen, and short. */
const snap = (value: number) => Math.round(value * 1e4) / 1e4

/**
 * One corner at `at`, of radius `r`, entered along the edge that runs `along` from the
 * corner and left along the edge that runs `onto` from it, with `first` and `second`
 * points of those edges to curve into. Answers where it starts and ends, and the path
 * between them.
 */
function corner(at: Pair, along: Pair, onto: Pair, r: number, first: number, second: number, continuous: boolean): { start: Pair; end: Pair; d: string } {
  // `u` is measured along an edge from the corner, `v` across it, both in radii.
  const point = (u: number, v: number, flip: boolean): Pair => {
    const [a, b] = flip ? [onto, along] : [along, onto]
    return [at[0] + r * (u * a[0] + v * b[0]), at[1] + r * (u * a[1] + v * b[1])]
  }
  const xy = ([px, py]: Pair) => `${snap(px)} ${snap(py)}`
  if (r <= 0) return { start: at, end: at, d: '' }
  if (!continuous) return { start: point(1, 0, false), end: point(1, 0, true), d: `A ${snap(r)} ${snap(r)} 0 0 1 ${xy(point(1, 0, true))}` }
  const [entry, exit] = [continuousHalf(first / r), continuousHalf(second / r)]
  const transition = (half: Half, flip: boolean) => half.span > 0 ? [half.p1, half.p2, half.join].map(([u, v]) => xy(point(u, v, flip))) : null
  const into = transition(entry, false), out = transition(exit, true)
  // The arc between the two cubics, as one cubic, as the cubics around it are: `.trim`
  // and the corner's own tests read the path the same way whatever its radius.
  const handle = 4 / 3 * Math.tan((Math.PI / 2 - entry.angle - exit.angle) / 4)
  const arc = [
    point(entry.join[0] - handle * Math.cos(entry.angle), entry.join[1] + handle * Math.sin(entry.angle), false),
    point(exit.join[0] - handle * Math.cos(exit.angle), exit.join[1] + handle * Math.sin(exit.angle), true),
    point(exit.join[0], exit.join[1], true),
  ]
  return {
    start: point(entry.reach, 0, false),
    end: point(exit.reach, 0, true),
    d: [
      into ? `C ${into.join(' ')}` : '',
      `C ${arc.map(xy).join(' ')}`,
      out ? `C ${xy(point(exit.p2[0], exit.p2[1], true))} ${xy(point(exit.p1[0], exit.p1[1], true))} ${xy(point(exit.reach, 0, true))}` : '',
    ].filter(Boolean).join(' '),
  }
}

interface Half { readonly reach: number; readonly span: number; readonly angle: number; readonly p1: Pair; readonly p2: Pair; readonly join: Pair }

/**
 * Half of a continuous corner, from the edge to the corner's diagonal, in radii, given
 * `room` radii of that edge to curve into.
 *
 * Fitted to the iOS 27 simulator, which draws it as a cubic easing off the edge into a
 * circular arc of the corner's radius (`.continuous` is iOS 27's default). With room it
 * reaches 1.78 radii along the edge, and its depth stops showing at about 1.5. With less
 * than 1.29 radii, as on a pill or a short card, the cubic shortens and the arc grows,
 * until with exactly one radius that half is the circular corner. Each half of a corner
 * has its own room, so a short bar's corners are circular down its ends and continuous
 * along its length, as the simulator draws them. Every corner from 8 to 30 pt is within
 * 0.07 pt of the simulator's outline.
 */
function continuousHalf(room: number): Half {
  const ease = Math.min(1, Math.max(0, (room - 1) / (CONTINUOUS.full - 1))) ** CONTINUOUS.easing
  const reach = Math.min(room, 1 + ease * (CONTINUOUS.reach - 1))
  const angle = CONTINUOUS.angle * ease
  const join: Pair = [1 - Math.sin(angle), 1 - Math.cos(angle)]
  const span = reach - join[0]
  return {
    reach, span, angle, join,
    p1: [reach - CONTINUOUS.lead * span, 0],
    p2: [join[0] + CONTINUOUS.tail * span * Math.cos(angle), join[1] - CONTINUOUS.tail * span * Math.sin(angle)],
  }
}

/**
 * The continuous corner's shape: how far along the edge it starts, in radii; the angle,
 * in radians, at which its cubic meets the arc; its two handles, as fractions of the
 * cubic's length along the edge; the room, in radii, below which it gives way to the arc,
 * and how quickly it does.
 */
const CONTINUOUS = { reach: 1.776159, angle: 0.574952, lead: 0.592334, tail: 0.219999, full: 1.29212, easing: 0.437168 }
