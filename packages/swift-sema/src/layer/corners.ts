import { CORNER_RADIUS_LABELS, isConditional, sameLength, type CornerRadii, type CornersValue, type LayerChange, type LayerValue, type Length, type SourceSpan } from '@studio/shared'
import type { CallExpr, Expr } from '@studio/swift-syntax'
import { cornerStyle, shapeCorners, type Corners } from '../authoring-border'
import { SLOT } from '../authoring-modifiers'
import { roundedCorners, viewCallChain } from '../design-controls'
import { insertCalls, insertionIndex, replaceRun, runHasComment, type LabelPatch, type Patch } from './chain-edit'
import { isShapeView, runAt, type ChainSlots } from './slots'
import { cardRefusal, inSwift, type LayerContext } from './context'
import { isConstantToken, isToken, lengthSource, linkLength, numberIn, sourceOf } from './values'

/**
 * Corners: the shape the layer is drawn in, as Figma's corner radius sets it.
 *
 * A shape view is its own shape. Any other view takes the shape it is clipped to, the old
 * `.cornerRadius`, or the shape its background or glass is drawn `in:`; where several
 * say it, they must agree. A change rewrites each of them in place, in the spelling it
 * had, so a shape argument stays a shape argument, and adds a clip only where none is.
 */

/** Each corner's label, in the order SwiftUI declares them, and its name in `CornersValue.radii`: `topLeadingRadius`, `topLeading`. */
const CORNERS = CORNER_RADIUS_LABELS.map(label => [label, label.slice(0, -'Radius'.length) as keyof CornerRadii] as const)

const UNKNOWN = 'This view’s shape is written in a way the panel can’t show. Change it in Code.'
const COMPUTED = inSwift('corner radius')
const TWICE = 'This view’s corners are set in more than one place, differently. Change them in Code.'
const BUTTON = 'A button style draws this button’s shape. Change its border shape in Code.'
const UNEVEN = 'Corners with different radii need iOS 16. Give every corner the same radius, or raise the deployment target.'

/**
 * Where a layer's shape is written: a shape view's own call, a shape argument (a clip, or
 * the shape a background or glass is drawn `in:`), a shape view drawn as the background,
 * the old `.cornerRadius`, or glass with its default capsule.
 */
interface Source {
  /** The modifier, or -1 for a shape view's own call. */
  readonly index: number
  readonly kind: 'shape' | 'argument' | 'view' | 'cornerRadius' | 'glass'
  /** The shape as written, which a change rewrites. */
  readonly at?: Expr
  /** Its shape, or why the panel cannot show it. */
  readonly value: CornersValue | string
}

/** The call a shape is: `RoundedRectangle(…)` in `RoundedRectangle(…).inset(by: 2)`, which a change rewrites. */
const shapeCall = (expr: Expr): Expr => expr.kind === 'call' ? viewCallChain(expr)!.base : expr

/**
 * A radius as written: 0 or more, or a token (a type's member, `.radius12`, a constant) with
 * what it is declared as where the panel can say (Wave 3b); undefined for one read off an
 * instance. `at` is the shape or modifier it is written in, where its names are read.
 */
const radiusOf = (written: string, ctx: LayerContext, at: SourceSpan): Length | undefined => numberIn(written, false) ?? (isConstantToken(written) ? linkLength(written, ctx, at) : undefined)

/** A shape as the panel shows it, or why it cannot. */
function valueOf(corners: Corners, ctx: LayerContext, at: SourceSpan): CornersValue | string {
  const style = cornerStyle(corners.style)
  if (style !== '.continuous' && style !== '.circular') return COMPUTED
  const continuous = style !== '.circular'
  if (corners.kind === 'rectangle' || corners.kind === 'circle') return { shape: corners.kind === 'circle' ? 'circle' : 'rect' }
  if (corners.kind === 'ellipse') return 'An ellipse has no corners. Change its shape in Code.'
  if (corners.kind === 'capsule') return { shape: 'capsule', continuous }
  if (corners.kind === 'rounded') {
    const radius = radiusOf(corners.radius!, ctx, at)
    return radius === undefined ? COMPUTED : { shape: 'rounded', radius, continuous }
  }
  const radii = Object.fromEntries(CORNERS.map(([label, corner]) => { const written = corners.radii!.find(([at]) => at === label)?.[1]; return [corner, written === undefined ? 0 : radiusOf(written, ctx, at)] }))
  return Object.values(radii).some(radius => radius === undefined) ? COMPUTED : { shape: 'uneven', radii: radii as CornersValue['radii'], continuous }
}

const shapeValue = (expr: Expr | undefined, ctx: LayerContext) => { const corners = expr && shapeCorners(expr, ctx.text); return corners && valueOf(corners, ctx, expr.span) }

function sourcesOf(slots: ChainSlots, ctx: LayerContext): Source[] {
  const sources: Source[] = isShapeView(slots) ? [{ index: -1, kind: 'shape', at: slots.base, value: shapeValue(slots.base, ctx) ?? UNKNOWN }] : []
  for (const [index, call] of slots.modifiers.entries()) {
    const name = slots.names[index]
    const only = call.args.length === 1 && call.args[0]!.label === null && !call.trailingClosure ? call.args[0]!.value : undefined
    const shape = call.args.find(arg => arg.label === 'in')?.value
    if (name === 'clipShape') sources.push({ index, kind: 'argument', ...only ? { at: only } : {}, value: shapeValue(only, ctx) ?? UNKNOWN })
    else if (name === 'cornerRadius') sources.push({ index, kind: 'cornerRadius', value: only ? valueOf({ kind: 'rounded', radius: sourceOf(ctx, only) }, ctx, only.span) : UNKNOWN })
    else if (name === 'buttonBorderShape') sources.push({ index, kind: 'argument', value: BUTTON })
    else if (shape && (name === 'background' || name === 'glassEffect')) sources.push({ index, kind: 'argument', at: shape, value: shapeValue(shape, ctx) ?? UNKNOWN })
    else if (name === 'glassEffect') sources.push({ index, kind: 'glass', value: { shape: 'capsule', continuous: true } })
    else if (name === 'background') {
      // A shape view drawn as the background, `.background(RoundedRectangle(cornerRadius: 12).fill(.white))`, as a border reads it.
      const body = call.trailingClosure?.body.statements
      const drawn = only ?? (body?.length === 1 && body[0]!.kind === 'exprStmt' ? body[0]!.expression : undefined)
      const value = shapeValue(drawn, ctx)
      if (value) sources.push({ index, kind: 'view', at: drawn, value })
    }
  }
  return sources
}

const smooth = (value: CornersValue) => value.continuous !== false

/** Whether two shapes are the same, however each was spelled. */
function sameCorners(a: CornersValue, b: CornersValue): boolean {
  if (a.shape !== b.shape) return false
  if (a.shape === 'rect' || a.shape === 'circle') return true
  if (smooth(a) !== smooth(b)) return false
  if (a.shape === 'rounded') return sameLength(a.radius ?? 0, b.radius ?? 0)
  return a.shape !== 'uneven' || CORNERS.every(([, corner]) => sameLength(a.radii![corner], b.radii?.[corner] ?? 0))
}

export function readCorners(slots: ChainSlots, ctx: LayerContext): LayerValue<CornersValue> {
  const square: CornersValue = { shape: 'rect' }
  const card = cardRefusal(ctx)
  if (card) return { value: square, state: 'code', disabledReason: card }
  const sources = sourcesOf(slots, ctx)
  if (!sources.length) return { value: square, state: 'absent' }
  const from = sources.flatMap(source => source.index >= 0 ? [ctx.ids[source.index]!] : [])
  const values = sources.flatMap(source => typeof source.value === 'string' ? [] : [source.value])
  const inCode = (disabledReason: string): LayerValue<CornersValue> => ({ value: values[0] ?? square, state: 'code', ...from.length ? { from } : {}, disabledReason })
  const reason = sources.find(source => typeof source.value === 'string')?.value as string | undefined
  if (reason) return inCode(reason)
  if (sources.some(source => source.index >= 0 && runHasComment(slots, runAt(slots, source.index), ctx.text))) return inCode('A comment is written in this view’s corners. Change them in Code.')
  if (values.some(value => !sameCorners(value, values[0]!))) return inCode(TWICE)
  const value = values[0]!
  const token = [value.radius, ...Object.values(value.radii ?? {})].some(length => length !== undefined && typeof length !== 'number')
  return { value, state: token ? 'token' : 'literal', ...from.length ? { from } : {} }
}

/** The shape a change asks for, checked, with four equal corners written as one radius. */
function normalised(next: CornersValue): CornersValue {
  const check = (length: Length | undefined): Length => {
    const fine = typeof length === 'number' ? Number.isFinite(length) && length >= 0 : !!length && !isConditional(length) && isToken(length.token)
    if (!fine) throw new Error('A corner radius is a number of points, 0 or more.')
    return length!
  }
  const continuous = smooth(next)
  if (next.shape === 'rect' || next.shape === 'circle') return { shape: next.shape }
  if (next.shape === 'capsule') return { shape: 'capsule', continuous }
  if (next.shape === 'rounded') return { shape: 'rounded', radius: check(next.radius), continuous }
  if (next.shape !== 'uneven') throw new Error('Corners are square, rounded, a capsule or a circle.')
  if (!next.radii || CORNERS.some(([, corner]) => next.radii![corner] === undefined)) throw new Error('Give each of the four corners a radius.')
  const radii = Object.fromEntries(CORNERS.map(([, corner]) => [corner, check(next.radii![corner])])) as NonNullable<CornersValue['radii']>
  const one = radii.topLeading
  return Object.values(radii).every(radius => sameLength(radius, one)) ? { shape: 'rounded', radius: one, continuous } : { shape: 'uneven', radii, continuous }
}

/**
 * A shape as Swift: the type a view or an argument before iOS 17 takes,
 * `RoundedRectangle(cornerRadius: 12)`, or from iOS 17 the member a shape argument takes,
 * `.rect(cornerRadius: 12)`. The style is written only when it is not the default.
 */
function shapeSource(value: CornersValue, member: boolean, ctx: LayerContext): string {
  const short = member && ctx.target >= 17
  const style = smooth(value) ? [] : ['style: .circular']
  const call = (type: string, args: readonly string[]) => `${short ? '.rect' : type}(${args.join(', ')})`
  if (value.shape === 'rect') return short ? '.rect' : 'Rectangle()'
  if (value.shape === 'circle') return short ? '.circle' : 'Circle()'
  if (value.shape === 'capsule') return short ? (style.length ? `.capsule(${style[0]})` : '.capsule') : `Capsule(${style.join('')})`
  if (value.shape === 'rounded') return call('RoundedRectangle', [`cornerRadius: ${lengthSource(value.radius!)}`, ...style])
  if (ctx.target < 16) throw new Error(UNEVEN)
  const radii = CORNERS.flatMap(([label, corner]) => { const radius = value.radii![corner]; return radius === 0 ? [] : [`${label}: ${lengthSource(radius)}`] })
  return call('UnevenRoundedRectangle', [...radii, ...style])
}

/** A clip to the shape, as Wave 1 writes one for rounded corners (`roundedCorners`). */
function clipSource(value: CornersValue, ctx: LayerContext): string {
  return value.shape === 'rounded' && typeof value.radius === 'number' && smooth(value) ? roundedCorners(value.radius, ctx.target) : `.clipShape(${shapeSource(value, true, ctx)})`
}

/** One corners change as patches to the chain; throws the reason when the panel cannot make it. */
export function writeCorners(slots: ChainSlots, change: Extract<LayerChange, { section: 'corners' }>, ctx: LayerContext): Patch[] {
  const current = readCorners(slots, ctx)
  if (current.disabledReason) throw new Error(current.disabledReason)
  const next = normalised(change.corners)
  if (sameCorners(current.value, next)) return []
  const sources = sourcesOf(slots, ctx)
  if (!sources.length) {
    if (ctx.locked) throw new Error(ctx.locked)
    return [insertCalls(slots, insertionIndex(slots, SLOT.clip), [clipSource(next, ctx)], ctx.text)]
  }
  return sources.map((source): Patch | LabelPatch => {
    const call = slots.modifiers[source.index] as CallExpr
    if (source.kind === 'shape') return { start: slots.base.span.start, end: slots.base.span.end, text: shapeSource(next, false, ctx), label: true }
    if (source.kind === 'cornerRadius') return replaceRun(slots, runAt(slots, source.index), [clipSource(next, ctx)], ctx.text)
    if (source.kind === 'glass') {
      const last = call.args.at(-1)
      const shape = `in: ${shapeSource(next, true, ctx)}`
      return last ? { start: last.span.end, end: last.span.end, text: `, ${shape}` } : replaceRun(slots, runAt(slots, source.index), [`.glassEffect(${shape})`], ctx.text)
    }
    const at = shapeCall(source.at!)
    return { start: at.span.start, end: at.span.end, text: shapeSource(next, source.kind === 'argument' && sourceOf(ctx, at).startsWith('.'), ctx) }
  })
}
