import type { CallExpr, Expr } from '@studio/swift-syntax'
import { borderOf, cornersOf, modifierName } from '../authoring-border'
import { APPLE_VIEW_MODIFIERS, DYNAMIC_CALLS, IMAGE_CALLS, SHAPE_CALLS, SHAPE_PAINTS } from '../builtins'
import { viewCallChain } from '../design-controls'

/**
 * A view's modifier chain, sorted into the places a layer reads.
 *
 * What a modifier means depends on where it sits: a padding inside the background is
 * the layer's padding and one outside it is its margin; a frame inside it is the size
 * and one outside it is the room the layer takes. The surface (background, clip shape,
 * border, glass and shadow) is the boundary between the two.
 */

/** The modifiers that draw the layer's surface: what padding is inside of and margin outside. */
const SURFACE = new Set(['background', 'clipShape', 'cornerRadius', 'border', 'glassEffect', 'shadow'])

/** Views that are shapes, which take `.fill` and `.stroke` of their own. */
export const SHAPE_VIEWS: ReadonlySet<string> = new Set(['Rectangle', 'RoundedRectangle', 'UnevenRoundedRectangle', 'Capsule', 'Circle', 'Ellipse'])
/** How a resizable image fits its frame, which stays with it: padding between the two would change its proportions. */
const IMAGE_FIT: ReadonlySet<string> = new Set(['scaledToFit', 'scaledToFill', 'aspectRatio'])

export type SlotKind = 'padding' | 'margin' | 'size' | 'outerFrame' | 'other'

/** Adjacent calls of one modifier, read as one value: `.padding(.horizontal, 16).padding(.vertical, 8)`. */
export interface SlotRun {
  readonly kind: SlotKind
  /** Positions in the chain. */
  readonly indices: readonly number[]
  readonly calls: readonly CallExpr[]
}

export interface ChainSlots {
  readonly expr: Expr
  readonly base: CallExpr
  readonly modifiers: readonly CallExpr[]
  /** Each modifier's name, `border` for an overlay that is a border. */
  readonly names: readonly string[]
  /** The first and last surface modifier, or null when nothing paints a surface. */
  readonly surface: { readonly first: number; readonly last: number } | null
  readonly runs: readonly SlotRun[]
  /**
   * A modifier the project declares, whose type the studio cannot see: nothing new is
   * placed in this chain. Apple's own return `some View`, so writing beside them is safe.
   */
  readonly unknown: boolean
  /**
   * How many calls at the start of the chain belong to the view's own type: an Image's
   * `.resizable()` and how it fits, a shape's `.trim` and its paint, a ForEach's
   * `.onDelete`. Nothing new is placed before them.
   */
  readonly baseEnd: number
  /**
   * The view paints its own surface, as a shape does and a Button's style does around its
   * label, and no modifier paints another: a padding on it is space around it, a margin,
   * and only the frames before that margin are its size.
   */
  readonly ownSurface: boolean
}

export const isShapeView = (slots: Pick<ChainSlots, 'base'>): boolean => slots.base.callee.kind === 'identifier' && SHAPE_VIEWS.has(slots.base.callee.name)

/**
 * `known` is each call's name as the modifier stack already worked it out, borders
 * included, which saves finding the borders again for every view in the project.
 */
export function chainSlots(expr: Expr, text: string, known?: readonly string[]): ChainSlots | null {
  const chain = viewCallChain(expr)
  if (!chain) return null
  const { base, modifiers } = chain
  const corners = known?.length === modifiers.length ? undefined : cornersOf(chain, text)
  const names = corners ? modifiers.map(call => borderOf(call, corners, text) ? 'border' : modifierName(call)) : known!
  const surfaces = names.flatMap((name, index) => SURFACE.has(name) ? [index] : [])
  const surface = surfaces.length ? { first: surfaces[0]!, last: surfaces.at(-1)! } : null
  const shape = isShapeView({ base }), image = base.callee.kind === 'identifier' && base.callee.name === 'Image'
  const dynamic = base.callee.kind === 'identifier' && base.callee.name === 'ForEach'
  const own = (name: string) => image ? IMAGE_CALLS.has(name) || IMAGE_FIT.has(name) : shape ? SHAPE_CALLS.has(name) || SHAPE_PAINTS.has(name) : dynamic && DYNAMIC_CALLS.has(name)
  let baseEnd = 0
  while (baseEnd < names.length && own(names[baseEnd]!)) baseEnd++
  const ownSurface = !surface && (shape || base.callee.kind === 'identifier' && base.callee.name === 'Button')
  const margin = ownSurface ? names.indexOf('padding', baseEnd) : -1
  const kindOf = (name: string, index: number): SlotKind => {
    if (name !== 'padding' && name !== 'frame') return 'other'
    if (ownSurface) return name === 'padding' ? 'margin' : margin >= 0 && index > margin ? 'outerFrame' : 'size'
    const inside = !surface || index < surface.first, outside = !!surface && index > surface.last
    if (name === 'padding') return inside ? 'padding' : outside ? 'margin' : 'other'
    return inside ? 'size' : outside ? 'outerFrame' : 'other'
  }
  const runs: SlotRun[] = []
  for (const [index, call] of modifiers.entries()) {
    const kind = kindOf(names[index]!, index)
    const last = runs.at(-1)
    if (last && last.kind === kind && kind !== 'other' && last.indices.at(-1) === index - 1 && names[index - 1] === names[index]) runs[runs.length - 1] = { kind, indices: [...last.indices, index], calls: [...last.calls, call] }
    else runs.push({ kind, indices: [index], calls: [call] })
  }
  const unknown = names.some((name, index) => index >= baseEnd && name !== 'border' && !APPLE_VIEW_MODIFIERS.has(name))
  return { expr, base, modifiers, names, surface, runs, unknown, baseEnd, ownSurface }
}

/** The runs of one kind, in chain order. */
export function runsOf(slots: ChainSlots, kind: SlotKind): readonly SlotRun[] {
  return slots.runs.filter(run => run.kind === kind)
}

/** The call at `index` as a run of its own, for a value one call sets. */
export const runAt = (slots: ChainSlots, index: number): SlotRun => ({ kind: 'other', indices: [index], calls: [slots.modifiers[index]!] })

/** Each call of these names, in chain order, as a run of its own. */
export const callsNamed = (slots: ChainSlots, names: readonly string[]): SlotRun[] => slots.names.flatMap((name, index) => names.includes(name) ? [runAt(slots, index)] : [])
