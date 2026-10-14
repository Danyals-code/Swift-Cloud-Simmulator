import { alignmentOf, alignmentSides, sameLength, type Alignment9, type AxisSize, type HorizontalSide, type Insets, type LayerChange, type LayerLayout, type LayerValue, type Length, type Offset, type SourceSpan, type VerticalSide } from '@studio/shared'
import type { CallExpr, Expr } from '@studio/swift-syntax'
import { SLOT } from '../authoring-modifiers'
import { buttonLabel, type ButtonLabel } from '../design-controls'
import { insertCalls, insertionIndex, replaceRun, runHasComment, type LabelPatch, type Patch } from './chain-edit'
import { callsNamed, chainSlots, isShapeView, runsOf, type ChainSlots, type SlotRun } from './slots'
import { commented, inSwift, setTwice, type LayerContext } from './context'
import { lengthOf, lengthSource } from './values'

/**
 * Layout: size, alignment, padding, margin, offset and pin.
 *
 * Padding is the space inside the fill and margin the space outside it, so the two are
 * the paddings before and after the surface. A run of them reads as one inset value,
 * added side by side as SwiftUI adds them.
 */

/** What `.padding()` and `.padding(.horizontal)` add on iOS, for a view outside a list. */
export const DEFAULT_PADDING = 16

type Side = keyof Insets
const SIDES: readonly Side[] = ['top', 'leading', 'bottom', 'trailing']
const EDGE_SIDES: Readonly<Record<string, readonly Side[]>> = {
  all: SIDES, horizontal: ['leading', 'trailing'], vertical: ['top', 'bottom'],
  top: ['top'], leading: ['leading'], bottom: ['bottom'], trailing: ['trailing'],
}

const absent = <T>(value: T, disabledReason?: string): LayerValue<T> => ({ value, state: 'absent', ...(disabledReason ? { disabledReason } : {}) })
const inCode = <T>(value: T, from: readonly string[], disabledReason: string): LayerValue<T> => ({ value, state: 'code', from, disabledReason })

/**
 * The sides an `Edge.Set` names: `.horizontal`, `Edge.Set.top`, `[.top, .leading]`.
 * Undefined for a value that is no edge set, and null for one only the project knows,
 * such as an `extension Edge.Set` member, whose sides the panel cannot show.
 */
function sidesOf(value: Expr, ctx: LayerContext): readonly Side[] | null | undefined {
  if (value.kind === 'arrayLiteral') {
    const each = value.elements.map(element => sidesOf(element, ctx))
    if (each.some(sides => sides === undefined)) return undefined
    return each.some(sides => sides === null) ? null : [...new Set(each.flatMap(sides => sides!))]
  }
  const member = value.kind === 'memberAccess' && (!value.base || value.base.kind === 'memberAccess' && value.base.member === 'Set' && value.base.base?.kind === 'identifier' && value.base.base.name === 'Edge') ? value.member : undefined
  if (!member || !ctx.edges.has(member)) return undefined
  return EDGE_SIDES[member] ?? null
}

/** One `.padding` call as the sides it adds to and how much, or undefined when the panel cannot say. */
function paddingOf(call: CallExpr, ctx: LayerContext): Partial<Record<Side, Length>> | undefined {
  const args = call.args
  if (args.some(arg => arg.label !== null) || args.length > 2 || call.trailingClosure) return undefined
  if (!args.length) return Object.fromEntries(SIDES.map(side => [side, DEFAULT_PADDING]))
  if (args.length === 2) {
    const sides = sidesOf(args[0]!.value, ctx), length = lengthOf(args[1]!.value, ctx)
    return sides && length !== undefined ? Object.fromEntries(sides.map(side => [side, length])) : undefined
  }
  const value = args[0]!.value
  const sides = sidesOf(value, ctx)
  if (sides) return Object.fromEntries(sides.map(side => [side, DEFAULT_PADDING]))
  if (sides === null) return undefined
  if (value.kind === 'call' && value.callee.kind === 'identifier' && value.callee.name === 'EdgeInsets' && !value.trailingClosure) {
    if (!value.args.length) return Object.fromEntries(SIDES.map(side => [side, 0]))
    if (value.args.map(arg => arg.label).join() !== SIDES.join()) return undefined
    const lengths = value.args.map(arg => lengthOf(arg.value, ctx))
    return lengths.every(length => length !== undefined) ? Object.fromEntries(SIDES.map((side, index) => [side, lengths[index]!])) : undefined
  }
  const length = lengthOf(value, ctx)
  return length === undefined ? undefined : Object.fromEntries(SIDES.map(side => [side, length]))
}

/** A run of paddings as one inset, adding up side by side; undefined when a side would add a token to something. */
function insetsOf(run: SlotRun, ctx: LayerContext): Insets | undefined {
  const sums: Record<Side, Length> = { top: 0, leading: 0, bottom: 0, trailing: 0 }
  for (const call of run.calls) {
    const adds = paddingOf(call, ctx)
    if (!adds) return undefined
    for (const [side, length] of Object.entries(adds) as [Side, Length][]) {
      const before = sums[side]
      if (before === 0) sums[side] = length
      else if (typeof before === 'number' && typeof length === 'number') sums[side] = before + length
      else return undefined
    }
  }
  return sums
}

const SHAPE_PADDING = 'A shape fills its whole frame, so it has no padding. Use Margin for space around it.'

function readInsets(slots: ChainSlots, kind: 'padding' | 'margin', ctx: LayerContext): LayerValue<Insets | null> {
  if (kind === 'margin' && !slots.surface && !slots.ownSurface) return absent(null, 'Margin is the space outside a fill. Add a fill to give this view one.')
  if (kind === 'padding' && !slots.surface && isShapeView(slots)) return absent(null, SHAPE_PADDING)
  const runs = runsOf(slots, kind)
  if (!runs.length) return absent(null)
  // A Button's label is read without the ids of its modifiers, which the stack shows on the label.
  const from = runs.flatMap(run => run.indices.flatMap(index => ctx.ids[index] ?? []))
  if (runs.length > 1) return inCode(null, from, setTwice(kind))
  if (runHasComment(slots, runs[0]!, ctx.text)) return inCode(null, from, commented(kind))
  const insets = insetsOf(runs[0]!, ctx)
  if (!insets) return inCode(null, from, inSwift(kind))
  return { value: insets, state: SIDES.some(side => typeof insets[side] !== 'number') ? 'token' : 'literal', from }
}

/** The plainest Swift for an inset: one amount, a pair of axes, one side, or every side spelled out. */
export function paddingCalls(insets: Insets | null): string[] {
  if (!insets) return []
  const zero = (length: Length) => length === 0
  const { top, leading, bottom, trailing } = insets
  if (SIDES.every(side => zero(insets[side]))) return []
  if (sameLength(top, leading) && sameLength(top, bottom) && sameLength(top, trailing)) return [`.padding(${lengthSource(top)})`]
  if (sameLength(leading, trailing) && sameLength(top, bottom)) {
    return [...zero(leading) ? [] : [`.padding(.horizontal, ${lengthSource(leading)})`], ...zero(top) ? [] : [`.padding(.vertical, ${lengthSource(top)})`]]
  }
  const nonZero = SIDES.filter(side => !zero(insets[side]))
  if (nonZero.length === 1) return [`.padding(.${nonZero[0]}, ${lengthSource(insets[nonZero[0]!])})`]
  return [`.padding(EdgeInsets(top: ${lengthSource(top)}, leading: ${lengthSource(leading)}, bottom: ${lengthSource(bottom)}, trailing: ${lengthSource(trailing)}))`]
}

function writeInsets(slots: ChainSlots, kind: 'padding' | 'margin', insets: Insets | null, ctx: LayerContext): Patch | null {
  const current = readInsets(slots, kind, ctx)
  if (current.disabledReason) throw new Error(current.disabledReason)
  const calls = paddingCalls(insets)
  const run = runsOf(slots, kind)[0]
  if (run) return replaceRun(slots, run, calls, ctx.text)
  if (!calls.length) return null
  if (ctx.locked) throw new Error(ctx.locked)
  return insertCalls(slots, insertionIndex(slots, SLOT[kind]), calls, ctx.text)
}

/**
 * Size, alignment and pin: Figma's Hug, Fill and Fixed for each axis, read from the frames.
 *
 * The frames before the surface are the layer's size: a width is Fixed, an infinite
 * maximum is Fill, a finite one Fill up to it, and a minimum alone Hug with a minimum. A
 * frame after the surface sets the room the layer takes: a maximum there is Hug up to it,
 * as a chat bubble hugs its text up to 260 points, and inside an Overlap a frame that
 * fills both ways is where the layer is pinned. A Button is sized by its label, so a
 * frame on the label is the button's size.
 */
type Axis = 'width' | 'height'
const AXES: readonly Axis[] = ['width', 'height']
/** A frame's bound on one axis: a length, `.infinity` for a maximum, or `code` for one worked out in Swift. */
type Bound = Length | 'infinity' | 'code'
interface AxisBounds { fixed?: Bound; min?: Bound; max?: Bound }
interface FrameRead {
  readonly call: CallExpr
  readonly id?: string
  readonly axes: Readonly<Record<Axis, AxisBounds>>
  readonly alignment?: Alignment9
  /** Set when the frame says something the panel cannot write back. */
  readonly problem?: string
}

const ALIGNMENTS: readonly Alignment9[] = ['topLeading', 'top', 'topTrailing', 'leading', 'center', 'trailing', 'bottomLeading', 'bottom', 'bottomTrailing']
const FRAME_BOUNDS: Readonly<Record<string, readonly [Axis, keyof AxisBounds]>> = {
  width: ['width', 'fixed'], minWidth: ['width', 'min'], maxWidth: ['width', 'max'],
  height: ['height', 'fixed'], minHeight: ['height', 'min'], maxHeight: ['height', 'max'],
}
const SIZE_SWIFT = inSwift('size')
const SIZE_IDEAL = 'This view has an ideal size, which the panel does not show. Change it in Code.'
const SIZE_TWICE = setTwice('size')
const SIZE_COMMENT = commented('size')
const ROOM_SWIFT = 'The room around this view’s fill is set in Swift. Change it in Code.'
const ALIGN_TWICE = 'Two frames align this view differently. Change it in Code.'
const LABEL_SWIFT = 'This button’s label is written in a way the panel can’t change. Change it in Code.'
const LABEL_LOCKED = 'This button’s label has a modifier the studio does not know. Change its layout in Code.'
const ALIGN_HUG = 'Alignment places the content in a size larger than it. Set Fill or Fixed first.'
const PIN_ELSEWHERE = 'Pin places a view at a corner or edge of an Overlap. Group it in an Overlap to pin it.'
const PIN_UNSIZED = 'Pin needs an Overlap with a size of its own. Give the Overlap a Fixed or Fill width and height first.'
const PIN_AND_MAX = 'Pin and Hug up to a maximum both set the room around this view. Remove one first.'
const MAX_NO_FILL = 'Hug up to a maximum keeps a fill to its content, and this view has no fill. Add a fill, or choose Fill with a maximum.'
const disagree = (axis: Axis) => `Two frames set this view’s ${axis}. Change it in Code.`

const infinite = (value: Expr) => value.kind === 'memberAccess' && value.member === 'infinity' && (!value.base || value.base.kind === 'identifier' && ['CGFloat', 'Double', 'Float'].includes(value.base.name))

/** The alignment a frame argument names, `.leading` or `Alignment.topLeading`; undefined for anything else. */
function alignmentWritten(value: Expr): Alignment9 | undefined {
  if (value.kind !== 'memberAccess' || value.base && !(value.base.kind === 'identifier' && value.base.name === 'Alignment')) return undefined
  return ALIGNMENTS.find(name => name === value.member)
}

function frameOf(call: CallExpr, ctx: LayerContext, id?: string): FrameRead {
  const axes: Record<Axis, AxisBounds> = { width: {}, height: {} }
  let alignment: Alignment9 | undefined, problem = call.trailingClosure ? SIZE_SWIFT : undefined
  for (const arg of call.args) {
    const label = arg.label ?? ''
    if (label === 'alignment') {
      alignment = alignmentWritten(arg.value)
      if (!alignment) problem ??= SIZE_SWIFT
      continue
    }
    if (label === 'idealWidth' || label === 'idealHeight') { problem ??= SIZE_IDEAL; continue }
    const place = Object.hasOwn(FRAME_BOUNDS, label) ? FRAME_BOUNDS[label] : undefined
    if (!place) { problem ??= SIZE_SWIFT; continue }
    const [axis, bound] = place
    const value: Bound = infinite(arg.value) ? 'infinity' : lengthOf(arg.value, ctx) ?? 'code'
    if (value === 'code' || value === 'infinity' && bound !== 'max') problem ??= SIZE_SWIFT
    axes[axis][bound] = value
  }
  return { call, ...(id ? { id } : {}), axes, ...(alignment ? { alignment } : {}), ...(problem ? { problem } : {}) }
}

const constrains = (frame: FrameRead, axis: Axis) => Object.keys(frame.axes[axis]).length > 0

/** One axis as Figma names it, from the bounds its frame sets; bounds worked out in Swift are left out. */
function axisOf(bounds: AxisBounds): AxisSize {
  const length = (bound: Bound | undefined) => bound === undefined || bound === 'code' || bound === 'infinity' ? undefined : bound
  const size = length(bounds.fixed), min = length(bounds.min), max = length(bounds.max)
  if (bounds.fixed !== undefined) return { mode: 'fixed', ...(size !== undefined ? { size } : {}) }
  return { mode: bounds.max === undefined ? 'hug' : 'fill', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }
}

/** The corner or edge a frame pins its layer to: one that fills both ways, aligned. */
function pinOf(frame: FrameRead): Alignment9 | undefined {
  const labels = frame.call.args.map(arg => arg.label).filter(label => label !== 'alignment')
  return !frame.problem && labels.join() === 'maxWidth,maxHeight' && frame.axes.width.max === 'infinity' && frame.axes.height.max === 'infinity' ? frame.alignment ?? 'center' : undefined
}

/**
 * A Button's label, where its padding and size go: inside its style, so they grow the
 * shape the style draws (Wave 1's `buttonLabel`). A label of one view is a chain of its
 * own, read and written as any view's is; a titled button, or a label of several views,
 * is written in the label form once, with every call the change gives it.
 */
type Label =
  | { readonly kind: 'chain'; readonly slots: ChainSlots; readonly ctx: LayerContext }
  | { readonly kind: 'whole'; readonly write: ButtonLabel['write'] }

const isButton = (ctx: LayerContext) => ctx.node.kind === 'view' && ctx.node.name === 'Button'

/** The label, or undefined for one Design can't rewrite safely. */
function labelOf(slots: ChainSlots, ctx: LayerContext): Label | undefined {
  const label = buttonLabel(slots.base, ctx.text)
  if (!label) return undefined
  const view = label.view && chainSlots(label.view, ctx.text)
  if (!view) return { kind: 'whole', write: label.write }
  return { kind: 'chain', slots: view, ctx: { ...ctx, ids: [], names: undefined, parent: 'other', locked: view.unknown ? LABEL_LOCKED : undefined } }
}

/** What a writer changes: a patch, or the calls a whole label takes, written once with the rest of the change. */
type Edit = Patch | { readonly calls: readonly string[]; readonly write: ButtonLabel['write'] } | null

const inLabel = (patch: Patch | null, label: boolean): Patch | null => {
  if (!patch || !label) return patch
  const marked: LabelPatch = { ...patch, label: true }
  return marked
}

/** The label form with `calls` on its view: several go on lines of their own where the label puts the first on one. */
function labelPatch(write: ButtonLabel['write'], calls: readonly string[]): LabelPatch {
  const probe = write('\u0000'), at = probe.text.indexOf('\u0000')
  const line = /(\r?\n[ \t]*)$/.exec(probe.text.slice(0, at))?.[1] ?? ''
  return { ...probe, text: probe.text.slice(0, at) + calls.join(line) + probe.text.slice(at + 1), label: true }
}

/** The padding a view has: a Button's is its label's. */
function readPadding(slots: ChainSlots, ctx: LayerContext): LayerValue<Insets | null> {
  if (!isButton(ctx)) return readInsets(slots, 'padding', ctx)
  const label = labelOf(slots, ctx)
  return !label ? absent(null, LABEL_SWIFT) : label.kind === 'chain' ? readInsets(label.slots, 'padding', label.ctx) : absent(null)
}

function writePadding(slots: ChainSlots, insets: Insets | null, ctx: LayerContext): Edit {
  if (!isButton(ctx)) return writeInsets(slots, 'padding', insets, ctx)
  const label = labelOf(slots, ctx)
  if (!label) throw new Error(LABEL_SWIFT)
  if (label.kind === 'chain') return inLabel(writeInsets(label.slots, 'padding', insets, label.ctx), true)
  const calls = paddingCalls(insets)
  return calls.length ? { calls, write: label.write } : null
}

/** Where a layer's size frames are written: its own chain, or a Button's label. */
interface SizeSite {
  readonly frames: readonly FrameRead[]
  readonly problem?: string
  /** The size frames replaced by `calls`: rewritten in place, added where they go, or taken away. */
  readonly write: (calls: readonly string[]) => Edit
}

/** `pin` is where a pin frame is, which new size frames go before. */
function chainSite(slots: ChainSlots, run: SlotRun | undefined, pin: number, ctx: LayerContext, label: boolean): SizeSite {
  return {
    frames: run ? run.calls.map((call, at) => frameOf(call, ctx, ctx.ids[run.indices[at]!])) : [],
    ...(run && runHasComment(slots, run, ctx.text) ? { problem: SIZE_COMMENT } : {}),
    write: calls => {
      if (run) return inLabel(replaceRun(slots, run, calls, ctx.text), label)
      if (!calls.length) return null
      if (ctx.locked) throw new Error(ctx.locked)
      return inLabel(insertCalls(slots, Math.min(insertionIndex(slots, SLOT.size), pin), calls, ctx.text), label)
    },
  }
}

interface SizeRead {
  readonly width: LayerValue<AxisSize>
  readonly height: LayerValue<AxisSize>
  readonly alignment: LayerValue<Alignment9 | null>
  readonly pin: LayerValue<Alignment9 | null>
  readonly site: SizeSite
  /** The chain the size frames are in: the view's own, or its Button label's. */
  readonly frames: { readonly slots: ChainSlots; readonly ctx: LayerContext; readonly label: boolean }
  /** The frame after the surface that holds a Hug's maximum, in that chain. */
  readonly cap?: SlotRun
  /** The frame that pins the view in its Overlap, in its own chain. */
  readonly pinRun?: SlotRun
  /** The size frames' run, in the chain they are in, when there is one. */
  readonly sizeRun?: SlotRun
  /** A Button with no frame of its own takes its size on a label written whole, in the label form. */
  readonly whole?: true
  /** Why the size, alignment and pin cannot be changed here. */
  readonly blocked?: string
}

function readSize(slots: ChainSlots, ctx: LayerContext): SizeRead {
  const overlap = ctx.parent === 'overlap'
  let sizeRuns = [...runsOf(slots, 'size')], roomRuns = [...runsOf(slots, 'outerFrame')]
  // In an Overlap, a last frame that fills both ways is the pin: after the surface, or after the size with none.
  let pinRun: SlotRun | undefined
  const host = roomRuns.at(-1) ?? (slots.surface ? undefined : sizeRuns.at(-1))
  if (overlap && host && pinOf(frameOf(host.calls.at(-1)!, ctx))) {
    pinRun = { kind: host.kind, indices: host.indices.slice(-1), calls: host.calls.slice(-1) }
    const rest: SlotRun = { kind: host.kind, indices: host.indices.slice(0, -1), calls: host.calls.slice(0, -1) }
    const without = (runs: SlotRun[]) => runs.flatMap(run => run !== host ? [run] : rest.calls.length ? [rest] : [])
    sizeRuns = without(sizeRuns)
    roomRuns = without(roomRuns)
  }
  // A Button with no frame of its own besides a pin is sized on its label, inside its style.
  const label = isButton(ctx) && !sizeRuns.length && !roomRuns.length ? labelOf(slots, ctx) ?? null : undefined
  const frames = label?.kind === 'chain' ? { slots: label.slots, ctx: label.ctx, label: true } : { slots, ctx, label: false }
  if (label?.kind === 'chain') {
    sizeRuns = [...runsOf(label.slots, 'size')]
    roomRuns = [...runsOf(label.slots, 'outerFrame')]
  }
  const site: SizeSite = label === null ? { frames: [], problem: LABEL_SWIFT, write: () => { throw new Error(LABEL_SWIFT) } }
    : label?.kind === 'whole' ? { frames: [], write: calls => calls.length ? { calls, write: label.write } : null }
    : chainSite(frames.slots, sizeRuns[0], !frames.label ? pinRun?.indices[0] ?? Infinity : Infinity, frames.ctx, frames.label)
  const rooms = roomRuns.flatMap(run => run.calls.map((call, at) => frameOf(call, frames.ctx, frames.ctx.ids[run.indices[at]!])))
  const room = rooms.length === 1 ? rooms[0] : undefined
  let blocked = sizeRuns.length > 1 ? SIZE_TWICE : site.problem ?? site.frames.find(frame => frame.problem)?.problem
  if (rooms.length > 1 || rooms.some(frame => frame.problem)) blocked ??= ROOM_SWIFT
  if (roomRuns[0] && runHasComment(frames.slots, roomRuns[0], ctx.text)) blocked ??= SIZE_COMMENT
  if (room && pinRun) blocked ??= PIN_AND_MAX

  // Each axis: what the size frames say, and a maximum the room adds to a Hug.
  const sizes = {} as Record<Axis, AxisSize>
  for (const axis of AXES) {
    const setting = site.frames.filter(frame => constrains(frame, axis))
    if (setting.length > 1) blocked ??= disagree(axis)
    let size = axisOf(setting[0]?.axes[axis] ?? {})
    const bounds = room && constrains(room, axis) ? room.axes[axis] : undefined
    if (bounds) {
      if (bounds.fixed !== undefined || bounds.min !== undefined || bounds.max === 'infinity' || bounds.max === undefined) blocked ??= ROOM_SWIFT
      else if (size.mode !== 'hug' || size.max !== undefined) blocked ??= disagree(axis)
      else size = { ...size, ...(bounds.max !== 'code' ? { max: bounds.max } : {}) }
    }
    sizes[axis] = size
  }

  // The alignment: each frame aligns along the axes it sizes, in the middle unless it says otherwise.
  const aligning = [...site.frames, ...room ? [room] : []]
  const meaningful = AXES.some(axis => aligning.some(frame => constrains(frame, axis)))
  let vertical: VerticalSide | undefined, horizontal: HorizontalSide | undefined
  for (const frame of aligning) {
    const [v, h] = alignmentSides(frame.alignment ?? 'center')
    if (constrains(frame, 'width')) { if (horizontal && horizontal !== h) blocked ??= ALIGN_TWICE; horizontal = h }
    if (constrains(frame, 'height')) { if (vertical && vertical !== v) blocked ??= ALIGN_TWICE; vertical = v }
  }
  const alignedBy = aligning.filter(frame => frame.alignment).flatMap(frame => frame.id ? [frame.id] : [])
  const aligned = alignmentOf(vertical ?? 'center', horizontal ?? 'center')
  const alignment: LayerValue<Alignment9 | null> = blocked ? { ...inCode(meaningful ? aligned : null, alignedBy, blocked), ...(alignedBy.length ? {} : { state: 'absent' }) }
    : !meaningful ? absent(null, ALIGN_HUG)
    : { value: aligned, state: aligning.some(frame => frame.alignment) ? 'literal' : 'absent', ...(alignedBy.length ? { from: alignedBy } : {}) }

  const sized = (axis: Axis): LayerValue<AxisSize> => {
    const value = sizes[axis]
    const setting = aligning.filter(frame => constrains(frame, axis))
    const from = setting.flatMap(frame => frame.id ? [frame.id] : [])
    const lengths = [value.size, value.min, value.max].filter(length => length !== undefined)
    const set = setting.length > 0
    if (blocked) return { value, state: set ? 'code' : 'absent', ...(from.length ? { from } : {}), disabledReason: blocked }
    if (!set) return absent(value)
    return { value, state: lengths.some(length => typeof length !== 'number') ? 'token' : 'literal', ...(from.length ? { from } : {}) }
  }

  const pinFrom = pinRun ? [ctx.ids[pinRun.indices[0]!]!] : []
  const pinned = pinRun && pinOf(frameOf(pinRun.calls[0]!, ctx))!
  const pin: LayerValue<Alignment9 | null> = !overlap ? absent(null, PIN_ELSEWHERE)
    : !pinRun ? absent(null, ctx.overlapSized ? undefined : PIN_UNSIZED)
    : runHasComment(slots, pinRun, ctx.text) ? inCode(pinned!, pinFrom, SIZE_COMMENT)
    : { value: pinned!, state: 'literal', from: pinFrom }
  return { width: sized('width'), height: sized('height'), alignment, pin, site, frames, ...(room ? { cap: roomRuns[0] } : {}), ...(pinRun ? { pinRun } : {}), ...(sizeRuns[0] ? { sizeRun: sizeRuns[0] } : {}), ...(label?.kind === 'whole' ? { whole: true } : {}), ...(blocked ? { blocked } : {}) }
}

const sameOptional = (a: Length | undefined, b: Length | undefined) => a === undefined || b === undefined ? a === b : sameLength(a, b)
const sameAxis = (a: AxisSize, b: AxisSize) => a.mode === b.mode && sameOptional(a.size, b.size) && sameOptional(a.min, b.min) && sameOptional(a.max, b.max)
const flexible = (size: AxisSize) => size.mode === 'fill' || size.mode === 'hug' && size.min !== undefined

function checkLength(length: Length | undefined): void {
  if (typeof length === 'number' && (!Number.isFinite(length) || length < 0)) throw new Error('A size is a number of points, 0 or more.')
}

/**
 * The axis a change asks for. Fixed starts from the size the preview measured, rounded to
 * whole points, or else the maximum or minimum it had; never from a made-up size.
 */
function nextAxis(axis: Axis, next: AxisSize | undefined, current: AxisSize, measured: { readonly width: number; readonly height: number } | undefined): AxisSize {
  if (!next) return current
  if (next.mode === 'fixed') {
    const drawn = measured && Number.isFinite(measured[axis]) && measured[axis] > 0 ? Math.round(measured[axis]) : undefined
    const size = next.size ?? drawn ?? current.max ?? current.min
    if (size === undefined) throw new Error(`Type a ${axis} in points. The preview hasn’t measured this view yet.`)
    checkLength(size)
    return { mode: 'fixed', size }
  }
  checkLength(next.min)
  checkLength(next.max)
  if (typeof next.min === 'number' && typeof next.max === 'number' && next.min > next.max) throw new Error(`The minimum ${axis} is larger than the maximum.`)
  return { mode: next.mode, ...(next.min !== undefined ? { min: next.min } : {}), ...(next.max !== undefined ? { max: next.max } : {}) }
}

/** An alignment as a frame writes it, for the axes the frame sizes; none for the middle. */
function frameAlignment(alignment: Alignment9 | null, horizontal: boolean, vertical: boolean): Alignment9 | undefined {
  if (!alignment) return undefined
  const [v, h] = alignmentSides(alignment)
  const written = alignmentOf(vertical ? v : 'center', horizontal ? h : 'center')
  return written === 'center' ? undefined : written
}

/**
 * A frame the Layout section writes, as data: each argument in the order it is written,
 * and the alignment, along only the axes the frame sizes. The writer prints it, and a
 * drag's draft lays the same frames out before anything is written (Wave 2b).
 */
export interface FrameParts {
  readonly args: readonly (readonly [label: string, value: Length | 'infinity'])[]
  readonly alignment?: Alignment9
}

/**
 * The size frames: one `.frame(width:height:)` for Fixed axes, one flexible frame for Fill
 * and a Hug's minimum, and both when the axes differ, the Fixed one first. SwiftUI has
 * no `frame(width:maxHeight:)`.
 */
export function sizeFrames(width: AxisSize, height: AxisSize, alignment: Alignment9 | null): FrameParts[] {
  const fixed = AXES.filter(axis => (axis === 'width' ? width : height).mode === 'fixed')
  const flex = AXES.filter(axis => flexible(axis === 'width' ? width : height))
  const of = (axis: Axis) => axis === 'width' ? width : height
  const frame = (args: FrameParts['args'], axes: readonly Axis[]): FrameParts => {
    const aligned = frameAlignment(alignment, axes.includes('width'), axes.includes('height'))
    return { args, ...(aligned ? { alignment: aligned } : {}) }
  }
  const fixedFrame = fixed.length ? [frame(fixed.map(axis => [axis, of(axis).size!] as const), fixed)] : []
  const flexFrame = flex.length ? [frame(flex.flatMap(axis => {
    const size = of(axis), name = axis === 'width' ? 'Width' : 'Height'
    return [...size.min !== undefined ? [[`min${name}`, size.min] as const] : [], ...size.mode === 'fill' ? [[`max${name}`, size.max ?? 'infinity'] as const] : []]
  }), flex)] : []
  return [...fixedFrame, ...flexFrame]
}

/** The frame after the surface that holds a Hug's maximum, as a chat bubble's. */
export function capFrames(width: AxisSize, height: AxisSize, alignment: Alignment9 | null): FrameParts[] {
  const capped = AXES.filter(axis => { const size = axis === 'width' ? width : height; return size.mode === 'hug' && size.max !== undefined })
  if (!capped.length) return []
  const aligned = frameAlignment(alignment, capped.includes('width'), capped.includes('height'))
  return [{ args: capped.map(axis => [`max${axis === 'width' ? 'Width' : 'Height'}`, (axis === 'width' ? width : height).max!] as const), ...(aligned ? { alignment: aligned } : {}) }]
}

/** A frame as Swift. */
const frameCall = (frame: FrameParts) => `.frame(${frame.args.map(([label, value]) => `${label}: ${value === 'infinity' ? '.infinity' : lengthSource(value)}`).join(', ')}${frame.alignment ? `, alignment: .${frame.alignment}` : ''})`
const sizeCalls = (width: AxisSize, height: AxisSize, alignment: Alignment9 | null) => sizeFrames(width, height, alignment).map(frameCall)
const capCalls = (width: AxisSize, height: AxisSize, alignment: Alignment9 | null) => capFrames(width, height, alignment).map(frameCall)

/** Whether a size sets anything, and so whether its frames' alignment means anything. */
export const setsSize = (size: AxisSize) => size.mode !== 'hug' || size.min !== undefined || size.max !== undefined

/** The frame that puts a layer in a corner or at an edge of its Overlap. */
const pinCalls = (pin: Alignment9 | null) => pin ? [`.frame(maxWidth: .infinity, maxHeight: .infinity${pin === 'center' ? '' : `, alignment: .${pin}`})`] : []

/** The calls as written, with no space, to tell a rewrite that changes nothing. */
const compact = (calls: readonly string[]) => calls.join('').replace(/\s+/g, '')
const writtenCalls = (calls: readonly CallExpr[], text: string) => calls.map(call => call.callee.kind === 'memberAccess' ? text.slice(text.lastIndexOf('.', call.callee.memberSpan.start), call.span.end) : '')

/** The size, alignment and pin a change asks for, as patches ranked by the slot they write. */
function writeSize(slots: ChainSlots, change: Extract<LayerChange, { section: 'layout' }>, ctx: LayerContext): [Edit, number][] {
  if (change.width === undefined && change.height === undefined && change.alignment === undefined && change.pin === undefined) return []
  const read = readSize(slots, ctx)
  if (read.blocked) throw new Error(read.blocked)
  if (change.pin !== undefined && read.pin.state === 'code') throw new Error(read.pin.disabledReason)
  if (change.pin) {
    if (ctx.parent !== 'overlap') throw new Error(PIN_ELSEWHERE)
    if (!ctx.overlapSized) throw new Error(PIN_UNSIZED)
  }
  const width = nextAxis('width', change.width, read.width.value, change.measured)
  const height = nextAxis('height', change.height, read.height.value, change.measured)
  const meaningful = setsSize(width) || setsSize(height)
  const asked = change.alignment !== undefined ? change.alignment : read.alignment.value
  if (change.alignment && change.alignment !== 'center' && !meaningful) throw new Error(ALIGN_HUG)
  const alignment = meaningful ? asked ?? 'center' : null
  const pin = change.pin !== undefined ? change.pin : read.pin.value
  const capped = [width, height].some(size => size.mode === 'hug' && size.max !== undefined)
  if (capped && pin) throw new Error(PIN_AND_MAX)
  if (capped && !read.frames.slots.surface) throw new Error(MAX_NO_FILL)
  const before = { alignment: read.alignment.value ?? null, pin: read.pin.value }
  if (sameAxis(width, read.width.value) && sameAxis(height, read.height.value) && alignment === (meaningful ? before.alignment ?? 'center' : null) && pin === before.pin) return []

  const edits: [Edit, number][] = []
  /** A frame after the surface, rewritten in place or added after the margin. */
  const room = (on: { readonly slots: ChainSlots; readonly ctx: LayerContext; readonly label: boolean }, current: SlotRun | undefined, calls: readonly string[]) => {
    if (compact(calls) === compact(current ? writtenCalls(current.calls, ctx.text) : [])) return
    if (current) edits.push([inLabel(replaceRun(on.slots, current, calls, ctx.text), on.label), SLOT.outerFrame])
    else {
      if (on.ctx.locked) throw new Error(on.ctx.locked)
      edits.push([inLabel(insertCalls(on.slots, insertionIndex(on.slots, SLOT.outerFrame), calls, ctx.text), on.label), SLOT.outerFrame])
    }
  }
  room(read.frames, read.cap, capCalls(width, height, alignment))
  room({ slots, ctx, label: false }, read.pinRun, pinCalls(pin))
  const size = sizeCalls(width, height, alignment)
  if (compact(size) !== compact(writtenCalls(read.site.frames.map(frame => frame.call), ctx.text))) edits.push([read.site.write(size), SLOT.size])
  return edits
}

/** The offset: `.offset(x:y:)` with lengths or tokens; a size or a value worked out in Swift is left to Code. */
function readOffset(slots: ChainSlots, ctx: LayerContext): LayerValue<Offset | null> {
  const runs = callsNamed(slots, ['offset'])
  if (!runs.length) return absent(null)
  const from = runs.map(run => ctx.ids[run.indices[0]!]!)
  if (runs.length > 1) return inCode(null, from, setTwice('offset'))
  if (runHasComment(slots, runs[0]!, ctx.text)) return inCode(null, from, commented('offset'))
  const call = runs[0]!.calls[0]!
  const offset: { x: Length; y: Length } = { x: 0, y: 0 }
  for (const arg of call.args) {
    const length = arg.label === 'x' || arg.label === 'y' ? lengthOf(arg.value, ctx) : undefined
    if (length === undefined || call.trailingClosure) return inCode(null, from, inSwift('offset'))
    offset[arg.label as 'x' | 'y'] = length
  }
  return { value: offset, state: typeof offset.x === 'number' && typeof offset.y === 'number' ? 'literal' : 'token', from }
}

/** `.offset(x:y:)` with only the axes that move; none when nothing moves. */
function offsetCalls(offset: Offset | null): string[] {
  const axes = offset ? (['x', 'y'] as const).filter(axis => offset[axis] !== 0) : []
  return axes.length ? [`.offset(${axes.map(axis => `${axis}: ${lengthSource(offset![axis])}`).join(', ')})`] : []
}

function writeOffset(slots: ChainSlots, offset: Offset | null, ctx: LayerContext): Patch | null {
  const current = readOffset(slots, ctx)
  if (current.disabledReason) throw new Error(current.disabledReason)
  for (const length of offset ? [offset.x, offset.y] : []) if (typeof length === 'number' && !Number.isFinite(length)) throw new Error('An offset is a number of points.')
  const still = (value: Offset | null) => !value || value.x === 0 && value.y === 0
  if (still(offset) && still(current.value) || offset && current.value && sameLength(offset.x, current.value.x) && sameLength(offset.y, current.value.y)) return null
  const calls = offsetCalls(offset)
  const run = callsNamed(slots, ['offset'])[0]
  if (run) return replaceRun(slots, run, calls, ctx.text)
  if (!calls.length) return null
  if (ctx.locked) throw new Error(ctx.locked)
  return insertCalls(slots, insertionIndex(slots, SLOT.offset), calls, ctx.text)
}

export function readLayout(slots: ChainSlots, ctx: LayerContext): LayerLayout {
  const size = readSize(slots, ctx)
  return {
    width: size.width,
    height: size.height,
    alignment: size.alignment,
    padding: readPadding(slots, ctx),
    margin: readInsets(slots, 'margin', ctx),
    offset: readOffset(slots, ctx),
    pin: size.pin,
    context: { parent: ctx.parent, inButton: ctx.inButton, surface: !!slots.surface || slots.ownSurface },
  }
}

/**
 * The patches in the order `writeLayer` applies them, the last in the file first: a rewrite
 * before an insertion at its start, and insertions at one place last slot first, so each
 * lands before the ones that follow it in the chain.
 */
function inOrder(ranked: readonly [Patch | null, number][]): Patch[] {
  return ranked.filter((item): item is [Patch, number] => !!item[0])
    .sort(([a, rankA], [b, rankB]) => b.start - a.start || (b.end - b.start) - (a.end - a.start) || rankB - rankA)
    .map(([patch]) => patch)
}

/** One layout change as patches to the chain; throws the reason when the panel cannot make it. */
export function writeLayout(slots: ChainSlots, change: Extract<LayerChange, { section: 'layout' }>, ctx: LayerContext): Patch[] {
  const edits: [Edit, number][] = []
  if (change.padding !== undefined) edits.push([writePadding(slots, change.padding, ctx), SLOT.padding])
  edits.push(...writeSize(slots, change, ctx))
  if (change.margin !== undefined) edits.push([writeInsets(slots, 'margin', change.margin, ctx), SLOT.margin])
  if (change.offset !== undefined) edits.push([writeOffset(slots, change.offset, ctx), SLOT.offset])
  // A whole label is written once, with the calls of every value the change gives it, in slot order.
  const whole = edits.flatMap(([edit, rank]) => edit && 'calls' in edit ? [{ ...edit, rank }] : []).sort((a, b) => a.rank - b.rank)
  const ranked = edits.map(([edit, rank]): [Patch | null, number] => [edit && 'calls' in edit ? null : edit, rank])
  if (whole.length) ranked.push([labelPatch(whole[0]!.write, whole.flatMap(edit => edit.calls)), 0])
  return inOrder(ranked)
}

/**
 * Where a value of a drag on the canvas goes: in place of a run of calls, before a call
 * (`insert` is the chain's length for its end), or onto a Button's label written in the
 * label form, its title or its views grouped in an HStack. `chain` says whose chain the
 * indices are in, the view's own or its Button label's.
 */
export type DraftPlace =
  | { readonly chain: 'view' | 'label'; readonly replace: readonly number[] }
  | { readonly chain: 'view' | 'label'; readonly insert: number }
  | { readonly chain: 'title' | 'views' }

/** A modifier chain as the preview finds it again: where its view starts, and each call. */
export interface DraftChain {
  /** The view's expression; its evaluated view starts where it does. */
  readonly view: SourceSpan
  /** Each call in the chain, in order: an evaluated modifier carries the span of the call it came from. */
  readonly calls: readonly SourceSpan[]
}

export const draftChain = (slots: Pick<ChainSlots, 'expr' | 'modifiers'>): DraftChain => ({ view: slots.expr.span, calls: slots.modifiers.map(call => call.span) })

export interface LayoutDraftPlaces {
  /** A Button's label of one view, whose chain takes its padding and size (`chain: 'label'`). */
  readonly label?: DraftChain
  readonly padding?: DraftPlace
  readonly margin?: DraftPlace
  readonly offset?: DraftPlace
  /**
   * The size frames, the frame after the surface that caps a Hug (always a run that is
   * there: a drag never adds a cap), and the alignment the frames are written with.
   */
  readonly size?: { readonly place: DraftPlace; readonly cap?: DraftPlace; readonly alignment: Alignment9 | null }
}

/**
 * Where each value a drag sets would be written, worked out once as the drag starts so the
 * canvas can follow the pointer without planning an edit. It is the writer's own reading
 * of the chain, place for place, so the draft lands where `writeLayout` writes: a value
 * the writer refuses has no place, and a Button's padding and size go on its label.
 */
export function layoutDraftPlaces(slots: ChainSlots, ctx: LayerContext): LayoutDraftPlaces {
  const label = isButton(ctx) ? labelOf(slots, ctx) : undefined
  // A label in the label form is written whole: from its title, or around its views.
  const base = slots.base
  const closure = base.args.some(arg => arg.label === 'label' && arg.value.kind === 'closure') || base.args.some(arg => arg.label === 'action') && !!base.trailingClosure
  const whole: DraftPlace = { chain: closure ? 'views' : 'title' }
  /** A run of `kind` rewritten in place, or a new one where its slot puts it. */
  const at = (on: ChainSlots, kind: 'padding' | 'margin', chain: 'view' | 'label', within: LayerContext): DraftPlace | undefined => {
    if (readInsets(on, kind, within).disabledReason) return undefined
    const run = runsOf(on, kind)[0]
    return run ? { chain, replace: run.indices } : within.locked ? undefined : { chain, insert: insertionIndex(on, SLOT[kind]) }
  }
  const padding = !isButton(ctx) ? at(slots, 'padding', 'view', ctx)
    : label?.kind === 'chain' ? at(label.slots, 'padding', 'label', label.ctx) : label ? whole : undefined
  const offsetRun = callsNamed(slots, ['offset'])[0]
  const offset: DraftPlace | undefined = readOffset(slots, ctx).disabledReason ? undefined
    : offsetRun ? { chain: 'view', replace: offsetRun.indices } : ctx.locked ? undefined : { chain: 'view', insert: insertionIndex(slots, SLOT.offset) }

  const read = readSize(slots, ctx)
  let size: LayoutDraftPlaces['size']
  if (!read.blocked) {
    const chain = read.frames.label ? 'label' : 'view'
    const pin = !read.frames.label ? read.pinRun?.indices[0] ?? Infinity : Infinity
    const place: DraftPlace | undefined = read.whole ? whole
      : read.sizeRun ? { chain, replace: read.sizeRun.indices }
      : read.frames.ctx.locked ? undefined : { chain, insert: Math.min(insertionIndex(read.frames.slots, SLOT.size), pin) }
    if (place) size = { place, ...(read.cap ? { cap: { chain, replace: read.cap.indices } } : {}), alignment: read.alignment.value }
  }
  const margin = at(slots, 'margin', 'view', ctx)
  return {
    ...(label?.kind === 'chain' ? { label: draftChain(label.slots) } : {}),
    ...(padding ? { padding } : {}),
    ...(margin ? { margin } : {}),
    ...(offset ? { offset } : {}),
    ...(size ? { size } : {}),
  }
}
