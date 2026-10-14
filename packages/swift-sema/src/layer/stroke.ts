import { sameLength, type LayerChange, type LayerValue, type Length, type StrokeValue } from '@studio/shared'
import { BORDER_POSITIONS, borderOf, borderSource, cornersOf, modifierName, ownBorderOf, rewriteBorder, strokeCall, strokeStyleOf, strokedOverlay, type BorderLayout, type Corners, type FoundBorder } from '../authoring-border'
import { SLOT } from '../authoring-modifiers'
import { insertCalls, insertionIndex, modifierPrefix, replaceRun, runHasComment, type Patch } from './chain-edit'
import { keptColor, readColor, sameColor } from './color'
import { SHAPE_CALLS } from '../builtins'
import { isShapeView, runAt, type ChainSlots } from './slots'
import { cardRefusal, commented, setTwice, type LayerContext } from './context'
import { keepCondition, lengthOf, lengthSource, numberIn, sourceOf, writableLength } from './values'

/**
 * Stroke: the line around the layer, as Figma's Stroke section draws it.
 *
 * On a view it is the border Wave 1 writes (D8): an overlay of the view's own shape,
 * stroked inside its edge, on it or outside it, which follows the corners. On a shape it
 * is the shape's own `.stroke` or `.strokeBorder`, which a dash goes in. The old square
 * `.border` reads as a border inside the edge, and a change writes it as one that follows
 * the corners.
 */

const SWIFT = 'This stroke is written in a way the panel can’t show. Change it in Code.'
const FILLED_IN = 'Without its stroke this shape would be filled in. Add a fill first, or change it in Code.'

/**
 * What draws the stroke: a border overlay, the old square `.border`, a shape's own stroke, or
 * an overlay that strokes a shape as a border does but is written in a way the panel can't
 * read (Wave 3b). A border's `corners` are the shape its overlay is written with, when that
 * is not written as the view's corners are but agrees with them, which a change writes it
 * with again; `apart` says why one that does not agree is shown but left to Code.
 */
type Site = { readonly index: number } & (
  | { readonly kind: 'border'; readonly found: FoundBorder; readonly corners?: Corners; readonly apart?: string }
  | { readonly kind: 'square' | 'own' | 'unread' })
/** The stroke as read, and its colour as written, which a change that keeps the colour keeps. */
interface Read { readonly site: Site; readonly value: StrokeValue | string; readonly color?: string }

/**
 * A border's or a stroke's colour and width, or why the panel cannot show them. A stroke with
 * no colour written, `.stroke(lineWidth: 2)`, is drawn in the foreground style (Wave 3b).
 */
function readSite(slots: ChainSlots, site: Site, ctx: LayerContext): Read {
  const call = slots.modifiers[site.index]!
  if (runHasComment(slots, runAt(slots, site.index), ctx.text)) return { site, value: commented('stroke') }
  if (site.kind === 'unread') return { site, value: SWIFT }
  const first = call.args[0]
  const colorExpr = site.kind === 'border' ? site.found.colorExpr : first?.label === null ? first.value : null
  const color = colorExpr && readColor(colorExpr, ctx)
  if (color?.state === 'code') return { site, value: color.disabledReason! }
  // What follows the colour: a width, or a shape's dashed style.
  const [line, ...rest] = colorExpr ? call.args.slice(1) : call.args
  let width: Length | undefined = 1, dash: readonly number[] | undefined
  if (site.kind === 'border') ({ width, dash } = site.found)
  else if (rest.length || call.trailingClosure) width = undefined
  else if (line?.label === 'style' && site.kind === 'own') ({ width, dash } = strokeStyleOf(line.value, ctx.text) ?? { width: undefined })
  else if (line) width = line.label === (site.kind === 'own' ? 'lineWidth' : 'width') ? lengthOf(line.value, ctx) : undefined
  if (width === undefined || site.kind === 'square' && (typeof width !== 'number' || !color)) return { site, value: SWIFT }
  const position = site.kind === 'border' ? site.found.position : site.kind === 'own' && slots.names[site.index] === 'stroke' ? 'center' : 'inside'
  return { site, value: { color: color?.value ?? null, width, position, ...dash?.length ? { dash } : {} }, ...colorExpr ? { color: sourceOf(ctx, colorExpr) } : {} }
}

const SHAPE_WORDS: Readonly<Record<Corners['kind'], string>> = { rectangle: 'a rectangle', rounded: 'a rounded rectangle', uneven: 'a rectangle with uneven corners', capsule: 'a capsule', circle: 'a circle', ellipse: 'an ellipse' }

/** Why a stroke drawn around a shape that isn't the view's is shown but left to Code. */
function apartFrom(shape: Corners): string {
  const radius = shape.kind === 'rounded' && numberIn(shape.radius!.trim(), false) !== undefined ? ` with a radius of ${shape.radius!.trim()}` : ''
  return `This stroke is drawn around ${SHAPE_WORDS[shape.kind]}${radius}, which isn’t this view’s shape. Give the view the same corners to change the stroke here, or change it in Code.`
}

/** What draws the layer's stroke, each in chain order. */
function sitesOf(slots: ChainSlots, ctx: LayerContext): Site[] {
  const corners = cornersOf(slots, ctx.text), shape = isShapeView(slots)
  return slots.names.flatMap((name, index): Site[] => {
    const call = slots.modifiers[index]!
    const found = name === 'border' ? borderOf(call, corners, ctx.text) : undefined
    if (found) return [{ kind: 'border', index, found }]
    if (name === 'border') return modifierName(call) === 'border' ? [{ kind: 'square', index }] : []
    if (name === 'overlay') {
      // An overlay that strokes a shape in its own spelling, or with no colour of its own (Wave 3b).
      const own = ownBorderOf(call, corners, ctx.text)
      if (own) return [{ kind: 'border', index, found: own.found, corners: own.shape, ...own.agrees ? {} : { apart: apartFrom(own.shape) } }]
      return strokedOverlay(call, ctx.text) ? [{ kind: 'unread', index }] : []
    }
    return shape && (name === 'stroke' || name === 'strokeBorder') ? [{ kind: 'own', index }] : []
  })
}

function read(slots: ChainSlots, ctx: LayerContext): { value: LayerValue<StrokeValue | null>; read?: Read } {
  const card = cardRefusal(ctx)
  if (card) return { value: { value: null, state: 'code', disabledReason: card } }
  const sites = sitesOf(slots, ctx)
  if (!sites.length) return { value: { value: null, state: 'absent' } }
  const from = sites.map(site => ctx.ids[site.index]!)
  if (sites.length > 1) return { value: { value: null, state: 'code', from, disabledReason: setTwice('stroke') } }
  const site = sites[0]!, found = readSite(slots, site, ctx)
  if (typeof found.value === 'string') return { value: { value: null, state: 'code', from, disabledReason: found.value } }
  // A stroke around another shape is shown as it is, and left to Code (Wave 3b).
  if (site.kind === 'border' && site.apart) return { value: { value: found.value, state: 'code', from, disabledReason: site.apart } }
  const token = !!found.value.color && 'token' in found.value.color || typeof found.value.width !== 'number'
  return { value: { value: found.value, state: token ? 'token' : 'literal', from }, read: found }
}

export function readStroke(slots: ChainSlots, ctx: LayerContext): LayerValue<StrokeValue | null> {
  return read(slots, ctx).value
}

const sameDash = (a: readonly number[] = [], b: readonly number[] = []) => a.length === b.length && a.every((length, index) => length === b[index])
const sameStroke = (a: StrokeValue, b: StrokeValue) => (a.color && b.color ? sameColor(a.color, b.color) : a.color === b.color) && sameLength(a.width, b.width) && a.position === b.position && sameDash(a.dash, b.dash)

/** The stroke a change asks for, checked, with a dash of nothing taken away. */
function checked(next: StrokeValue): StrokeValue {
  const width = next.width
  if (!writableLength(width, length => Number.isFinite(length) && length >= 0)) throw new Error('A stroke’s width is a number of points, 0 or more.')
  if (!BORDER_POSITIONS.includes(next.position)) throw new Error('A stroke is inside the edge, on it or outside it.')
  if (next.dash?.some(length => !(Number.isFinite(length) && length >= 0))) throw new Error('A dash and its gap are numbers of points, 0 or more.')
  const { dash, ...rest } = next
  return dash?.some(length => length > 0) ? next : rest
}

/** A border's overlay as the chain is written: its closure on lines of their own, or before iOS 15 or on one line, its argument. */
function layoutOf(slots: ChainSlots, ctx: LayerContext): BorderLayout {
  const prefix = modifierPrefix(slots, ctx.text)
  return ctx.target >= 15 && prefix.includes('\n') ? { indent: prefix.slice(prefix.lastIndexOf('\n') + 1) } : 'argument'
}

/** One stroke change as patches to the chain; throws the reason when the panel cannot make it. */
export function writeStroke(slots: ChainSlots, change: Extract<LayerChange, { section: 'stroke' }>, ctx: LayerContext): Patch[] {
  const current = read(slots, ctx)
  if (current.value.disabledReason) throw new Error(current.value.disabledReason)
  const next = change.stroke && checked(change.stroke)
  const before = current.value.value, site = current.read?.site
  if (before && next) keepCondition(before.width, next.width, 'stroke width')
  if (next === null ? !before : before && sameStroke(before, next)) return []
  const filled = slots.names.includes('fill')
  if (!next) {
    if (site!.kind === 'own' && !filled) throw new Error(FILLED_IN)
    return [replaceRun(slots, runAt(slots, site!.index), [], ctx.text)]
  }
  // A colour left as it was keeps its spelling, a token or `Color.gray.opacity(0.3)`; none stays none, the foreground style.
  const color = next.color && keptColor(next.color, before?.color ?? undefined, current.read?.color, 'ShapeStyle', ctx)
  const width = lengthSource(next.width)
  /** A shape's own stroke before the modifier at `index`; only an inset keeps a trimmed or turned shape one that strokes inside its edge. */
  const own = (index: number) => {
    if (next.position === 'inside' && slots.names.slice(0, index).some(name => SHAPE_CALLS.has(name) && name !== 'inset')) throw new Error('A trimmed or transformed shape is stroked on its edge. Choose Center.')
    return strokeCall(color, width, next.position, next.dash)
  }
  if (site?.kind === 'own') {
    if (next.position === 'outside') throw new Error('A shape’s own stroke is drawn inside or on its edge. Choose Inside or Center.')
    return [replaceRun(slots, runAt(slots, site.index), [own(site.index)], ctx.text)]
  }
  const shape = isShapeView(slots), painted = filled || slots.names.some(name => name === 'foregroundStyle' || name === 'foregroundColor')
  // A shape with nothing painting it takes a stroke of its own, as does a filled one from iOS 17; otherwise its own stroke would empty it.
  if (!site && shape && next.position !== 'outside' && (!painted || filled && ctx.target >= 17)) {
    if (ctx.locked) throw new Error(ctx.locked)
    let index = slots.names.indexOf('fill') + 1
    while (!filled && index < slots.names.length && SHAPE_CALLS.has(slots.names[index]!)) index++
    return [insertCalls(slots, index, [own(index)], ctx.text)]
  }
  if (!site && shape && !painted) throw new Error('A stroke outside the edge needs a fill on the shape. Add a fill, or choose Inside or Center.')
  if (typeof next.width !== 'number') throw new Error('A border’s width is a number of points. Type one to replace the token.')
  const border = { color, width: next.width, position: next.position, ...next.dash ? { dash: next.dash } : {} }
  const corners = cornersOf(slots, ctx.text)
  // A border whose overlay is written in its own spelling of the view's corners keeps it.
  if (site?.kind === 'border') return [rewriteBorder(slots.modifiers[site.index]!, site.found, site.corners ?? corners, ctx.text, border)]
  if (site) return [replaceRun(slots, runAt(slots, site.index), [borderSource(border, corners, layoutOf(slots, ctx))], ctx.text)]
  if (ctx.locked) throw new Error(ctx.locked)
  return [insertCalls(slots, insertionIndex(slots, SLOT.stroke), [borderSource(border, corners, layoutOf(slots, ctx))], ctx.text)]
}
