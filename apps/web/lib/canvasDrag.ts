import { alignmentSides, spreadOut, stackLayoutOf, type Alignment9, type AuthoringNode, type AxisSize, type Insets, type LayerChange, type LayerDraft, type LayerLayout, type LayerProperties, type ModifierBox, type Offset, type Point, type Rect, type ViewInstance } from '@studio/shared'
import { withMode } from './axisSize'
import { clampNumber, steppedValue } from './numberScrub'

/**
 * What a drag on the canvas's handles does to the selected view (Wave 2b), worked out
 * apart from the pointer so the sums are tested on their own.
 *
 * Each drag gives two things: the draft the worker lays the page out with while the
 * pointer moves, in plain points, and what letting go writes: one `layer-set` change,
 * the same change the Layout section would make, or the stack's spacing. A value written
 * through a token becomes a number once it is dragged, as typing a number would make it.
 */

/** A resize handle, named as the corner or edge of the view it sits on. */
export type ResizeEdge = Exclude<Alignment9, 'center'>
export type Side = keyof Insets

/** The four sides, as the Layout section lists them. */
export const SIDES: readonly Side[] = ['top', 'leading', 'bottom', 'trailing']

export type Handle =
  | { readonly kind: 'resize'; readonly edge: ResizeEdge }
  | { readonly kind: 'padding'; readonly side: Side }
  /** The gap after the stack's view at `gap`, which sets the spacing between all of them. */
  | { readonly kind: 'spacing'; readonly gap: number }
  /** The view's body, inside an Overlap: its offset, or a pinned view's margin. */
  | { readonly kind: 'move' }

export interface DragKeys { readonly shift?: boolean; readonly alt?: boolean }

/** What a drag on the selected view starts from. */
export interface DragStart {
  /** The drawn copy the drag is on, in the render tree's points. */
  readonly instance: ViewInstance
  /** The view's layer, as the Layout section reads it. */
  readonly layer: LayerProperties
  /** Each call in the view's chain by `AuthoringModifier` id, as `ModifierBox.index` counts them. */
  readonly chain: readonly string[]
  /** A stack whose spacing can be dragged: the way it lays its views out. */
  readonly stack?: 'vertical' | 'horizontal'
}

/** What letting go writes. */
export type DragCommit =
  | { readonly kind: 'layer'; readonly changes: readonly LayerChange[] }
  | { readonly kind: 'spacing'; readonly value: number }

export interface DragChange { readonly draft: LayerDraft; readonly commit: DragCommit }

/** Where the handles go on the selected view, in the render tree's points. */
export interface HandleLayout {
  /** The box the resize handles sit on. */
  readonly bounds: Rect
  /** The axes the resize handles can size: not one the panel leaves to Code or refuses here. */
  readonly resize: { readonly width: boolean; readonly height: boolean }
  /**
   * The padding's band on each side, between the content and the padding's edge, when the
   * view takes padding: as thin as nothing on a side that has none, where it is added from.
   */
  readonly padding?: Readonly<Record<Side, Rect>>
  /** The gap after each of a stack's views but the last, across the stack, when its spacing can be dragged. */
  readonly gaps?: readonly Rect[]
  /** The body can be dragged: an offset in an Overlap, or a pinned view's margin. */
  readonly move: boolean
}

/** How far a press moves, in pixels and whichever way, before it is a drag rather than a click. */
export const DRAG_THRESHOLD = 3

/** Whether a press at `from` that is now at `to` has become a drag: every drag on the canvas tells them apart so. */
export const dragged = (from: Point, to: Point) => Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD

/**
 * A drag's start for a selected view drawn as `instance`, or null for a view with no layer.
 * The chain is counted as the layer reads it, without calls that are switched off. A
 * Column or Row offers its spacing unless it is spread out with Spacers or left to Code,
 * where the bars would rewrite more than a number.
 */
export function dragStartFor(node: Pick<AuthoringNode, 'name' | 'controls' | 'modifiers' | 'layer'>, instance: ViewInstance): DragStart | null {
  if (!node.layer) return null
  const spacing = node.controls?.find(control => control.id === 'spacing')
  const layout = stackLayoutOf(node.name)
  const stack = layout === 'VStack' ? 'vertical' : layout === 'HStack' ? 'horizontal' : undefined
  return {
    instance, layer: node.layer,
    chain: (node.modifiers ?? []).filter(modifier => modifier.enabled !== false).map(modifier => modifier.id),
    ...stack && spacing && !spacing.disabledReason && !spreadOut(spacing.value) ? { stack } : {},
  }
}

export function handleLayout(start: DragStart): HandleLayout {
  const padding = paddingDrawn(start)
  const between = gaps(start)
  return {
    bounds: bounds(start),
    resize: { width: editable(start.layer.layout.width), height: editable(start.layer.layout.height) },
    ...padding ? { padding: bands(padding.inner, padding.outer) } : {},
    ...between ? { gaps: between } : {},
    move: movable(start),
  }
}

/**
 * The draft and the change a drag of `delta` points on `handle` makes, or null when it
 * leaves every value as it was.
 */
export function changeFor(handle: Handle, start: DragStart, delta: Point, keys: DragKeys = {}): DragChange | null {
  if (handle.kind === 'resize') return resize(handle.edge, start, delta, keys)
  if (handle.kind === 'padding') return insetsChange(handle.side, start, delta, keys)
  if (handle.kind === 'spacing') return spacingChange(handle.gap, start, delta)
  return move(start, delta)
}

const ARROWS: Readonly<Record<string, Point>> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }

/**
 * What an arrow key does to a view in `parent`: inside an Overlap it nudges it a point,
 * ten with Shift; in a Column or Row the arrows along it move the view earlier or later,
 * and the others do nothing, as they do everywhere else. Null for any other key.
 */
export function arrowFor(key: string, shift: boolean, parent: LayerLayout['context']['parent']): { readonly nudge: Point } | { readonly reorder: -1 | 1 } | null {
  const arrow = ARROWS[key]
  if (!arrow) return null
  const step = (direction: number) => direction ? steppedValue(0, direction < 0 ? -1 : 1, { fast: shift }) : 0
  if (parent === 'overlap') return { nudge: { x: step(arrow.x), y: step(arrow.y) } }
  const along = parent === 'column' ? arrow.y : parent === 'row' ? arrow.x : 0
  return along ? { reorder: along < 0 ? -1 : 1 } : null
}

/** Why a view's offset, written with a token, is not dragged or nudged on the canvas. */
export const TOKEN_OFFSET = 'This view’s offset is a token. Change it in the Layout section or in Code.'

/**
 * Why the body of a view in an Overlap can't be dragged or nudged, in the words the canvas
 * says it in, or null where it can, or where it is not in an Overlap.
 */
export function moveBlocked(start: DragStart): string | null {
  const layout = start.layer.layout
  if (layout.context.parent !== 'overlap' || movable(start)) return null
  if (layout.pin.value) return layout.margin.disabledReason ?? layout.padding.disabledReason ?? null
  return layout.offset.disabledReason ?? (layout.offset.state === 'token' ? TOKEN_OFFSET : null)
}

/**
 * A double-click on a handle: the axis it sizes back to Hug, both from a corner, or null
 * when they already hug, as switching to Hug in the Layout section does.
 */
export function hugFor(edge: ResizeEdge, start: DragStart): DragCommit | null {
  const layout = start.layer.layout, way = sides(edge, start)
  const change = {
    ...way.x && layout.width.value.mode !== 'hug' ? { width: withMode(layout.width.value, 'hug', layout.context.surface) } : {},
    ...way.y && layout.height.value.mode !== 'hug' ? { height: withMode(layout.height.value, 'hug', layout.context.surface) } : {},
  }
  return Object.keys(change).length ? { kind: 'layer', changes: [{ section: 'layout', ...change }] } : null
}

/**
 * Where the view's box goes with `change`, drawn as a ghost while a slow screen's drafts
 * catch up with the pointer (plan decision 12): its dragged size from the edge dragged,
 * or moved by its offset or a pinned view's room. Null for a drag a box can't show,
 * padding or spacing, which moves what is inside the view.
 */
export function ghostFor(handle: Handle, start: DragStart, change: DragChange | null): Rect | null {
  const box = bounds(start)
  if (!change) return box
  const draft = change.draft
  if (handle.kind === 'resize') {
    const way = sides(handle.edge, start)
    const width = typeof draft.width === 'number' ? draft.width : box.width, height = typeof draft.height === 'number' ? draft.height : box.height
    return { x: way.x < 0 ? box.x + box.width - width : box.x, y: way.y < 0 ? box.y + box.height - height : box.y, width, height }
  }
  if (handle.kind !== 'move') return null
  const shift = (by: Point) => ({ ...box, x: box.x + by.x, y: box.y + by.y })
  if (draft.offset) {
    const now = offsetNow(start)!
    return shift({ x: draft.offset.x - now.x, y: draft.offset.y - now.y })
  }
  const room = draft.margin ? 'margin' : draft.padding ? 'padding' : null
  if (!room) return null
  const before = insetsDrawn(start, room)?.insets ?? NONE, after = draft[room]!
  return shift({ x: after.leading - before.leading - (after.trailing - before.trailing), y: after.top - before.top - (after.bottom - before.bottom) })
}

// ------------------------------------------------------------ reading the drawn view

type Role = 'padding' | 'size' | 'margin' | 'pin' | 'offset' | 'other'

const OPPOSITE: Readonly<Record<Side, Side>> = { top: 'bottom', bottom: 'top', leading: 'trailing', trailing: 'leading' }
const NONE: Readonly<Record<Side, number>> = { top: 0, leading: 0, bottom: 0, trailing: 0 }

/** Whole points, never below nothing: a size, a padding, a spacing. */
const whole = (value: number) => clampNumber(value, { integer: true, min: 0 })
/** Whole points, either way: an offset. */
const round = (value: number) => clampNumber(value, { integer: true })
/** Points as drawn, to hundredths, so a sum such as an inset carries no float noise. */
const hundredths = (value: number) => clampNumber(value)

/** The last place in `list` that passes `test`, or -1. */
function lastIndex<T>(list: readonly T[], test: (item: T) => boolean): number {
  for (let index = list.length - 1; index >= 0; index--) if (test(list[index]!)) return index
  return -1
}

/** A value the handles may change: read as one the panel can rewrite, and not refused. */
const editable = (value: { readonly state: string; readonly disabledReason?: string }) => value.state !== 'code' && !value.disabledReason

/**
 * Each box the view is drawn in, inside out, with the layer value its modifier is read as,
 * and whether it is inside the fill. A box a draft drew is read by its kind and by where it
 * will be written; one in a Button's label is the label's padding or size.
 */
function roles(start: DragStart): readonly (ModifierBox & { readonly role: Role; readonly inside: boolean })[] {
  const layout = start.layer.layout, surface = surfaceAt(start)
  const has = (value: { readonly from?: readonly string[] }, id: string | undefined) => !!id && !!value.from?.includes(id)
  return start.instance.boxes.map(box => {
    const id = box.label ? undefined : start.chain[box.index]
    const inside = !!box.label || box.index < surface || !!box.draft && box.index === surface
    const role: Role = box.kind === 'offset' || has(layout.offset, id) ? 'offset'
      : has(layout.padding, id) ? 'padding' : has(layout.margin, id) ? 'margin' : has(layout.pin, id) ? 'pin'
      : box.kind === 'frame' && (has(layout.width, id) || has(layout.height, id) || box.draft || box.label) ? 'size'
      : box.kind === 'padding' && (box.draft || box.label) ? inside ? 'padding' : 'margin'
      : 'other'
    return { ...box, role, inside }
  })
}

/** The box inside the one at `position` in the boxes, inside out: the one before it, or the view itself. */
function inside(start: DragStart, position: number): Rect {
  return position > 0 ? start.instance.boxes[position - 1]!.rect : start.instance.content
}

/** Where the fill begins in the chain: the first modifier the Fill, Corners or Stroke section reads. */
function surfaceAt(start: DragStart): number {
  const at = start.chain.findIndex(id => ['fill', 'corners', 'stroke'].includes(start.layer.claimed[id] ?? ''))
  return at < 0 ? Infinity : at
}

/**
 * The box the resize handles sit on: the view with its padding and its size frame, which
 * is what a Fixed size sizes. A margin, a pin or an offset is outside it, as is a frame
 * after the fill, which is room around the layer rather than its size.
 */
function bounds(start: DragStart): Rect {
  return roles(start).filter(box => (box.role === 'padding' || box.role === 'size') && box.inside).at(-1)?.rect ?? start.instance.content
}

/**
 * A padding or margin run as it is drawn: the box inside its first call and the box of
 * its last, and each side's inset between them in points, tokens included.
 */
function insetsDrawn(start: DragStart, role: 'padding' | 'margin'): { readonly inner: Rect; readonly outer: Rect; readonly insets: Record<Side, number> } | null {
  const all = roles(start), first = all.findIndex(box => box.role === role)
  if (first < 0) return null
  const inner = inside(start, first), outer = all[lastIndex(all, box => box.role === role)]!.rect
  return {
    inner, outer,
    insets: {
      top: hundredths(inner.y - outer.y), leading: hundredths(inner.x - outer.x),
      bottom: hundredths(outer.y + outer.height - inner.y - inner.height), trailing: hundredths(outer.x + outer.width - inner.x - inner.width),
    },
  }
}

/**
 * The padding as drawn, for a view that takes padding: its run, or, with none, nothing
 * around the view itself (a Button's label), where a padding is added. Null for a view the
 * panel can't pad, such as a shape, or whose padding is left to Code.
 */
function paddingDrawn(start: DragStart): { readonly inner: Rect; readonly outer: Rect; readonly insets: Record<Side, number> } | null {
  if (!editable(start.layer.layout.padding)) return null
  const view = start.instance.label ?? start.instance.content
  return insetsDrawn(start, 'padding') ?? { inner: view, outer: view, insets: NONE }
}

function bands(inner: Rect, outer: Rect): Record<Side, Rect> {
  const right = inner.x + inner.width, bottom = inner.y + inner.height
  return {
    top: { x: outer.x, y: outer.y, width: outer.width, height: inner.y - outer.y },
    bottom: { x: outer.x, y: bottom, width: outer.width, height: outer.y + outer.height - bottom },
    leading: { x: outer.x, y: inner.y, width: inner.x - outer.x, height: inner.height },
    trailing: { x: right, y: inner.y, width: outer.x + outer.width - right, height: inner.height },
  }
}

/**
 * The offset the view is drawn with, in points, or null when it is written with a token or
 * worked out in Swift: the geometry draws an offset where it moves the view to, which
 * doesn't say by how much, so such an offset is left to the Layout section.
 */
function offsetNow(start: DragStart): { x: number; y: number } | null {
  const offset = start.layer.layout.offset
  if (!editable(offset)) return null
  const { x = 0, y = 0 } = offset.value ?? {}
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : null
}

/** An offset to write: an axis that did not move keeps what was written, a token included. */
function keepUnmoved(start: DragStart, offset: { x: number; y: number }, now: { x: number; y: number }): Offset {
  const written = start.layer.layout.offset.value
  return { x: offset.x === now.x && written ? written.x : offset.x, y: offset.y === now.y && written ? written.y : offset.y }
}

// ------------------------------------------------------------ resizing

/**
 * Which way each edge of a handle grows the view: -1 from the leading or top edge, 1 from
 * the other, 0 along an edge it isn't on or an axis that can't be changed here.
 */
function sides(edge: ResizeEdge, start: DragStart): { readonly x: -1 | 0 | 1; readonly y: -1 | 0 | 1 } {
  const layout = start.layer.layout, [vertical, horizontal] = alignmentSides(edge)
  const x = !editable(layout.width) ? 0 : horizontal === 'leading' ? -1 : horizontal === 'trailing' ? 1 : 0
  const y = !editable(layout.height) ? 0 : vertical === 'top' ? -1 : vertical === 'bottom' ? 1 : 0
  return { x, y }
}

/** Whether an axis already has this Fixed size, so writing it would change nothing. */
const fixedAt = (size: AxisSize, points: number) => size.mode === 'fixed' && size.size === points

/**
 * Edges and corners give a Fixed size, in whole points, and only that: what the Width and
 * Height fields write. The view's parent places it as SwiftUI does, so a view an Overlap
 * centres grows on both sides. Shift keeps the proportions, following whichever axis the
 * pointer has moved further, as Figma does.
 */
function resize(edge: ResizeEdge, start: DragStart, delta: Point, keys: DragKeys): DragChange | null {
  const box = bounds(start), way = sides(edge, start), layout = start.layer.layout
  if (!way.x && !way.y) return null
  let width = way.x ? box.width + way.x * delta.x : undefined
  let height = way.y ? box.height + way.y * delta.y : undefined
  // Proportions need both axes; with one left to Code, the other changes on its own.
  if (keys.shift && box.width > 0 && box.height > 0 && editable(layout.width) && editable(layout.height)) {
    const ratio = box.width / box.height
    const across = width === undefined ? -1 : Math.abs(width / box.width - 1)
    const down = height === undefined ? -1 : Math.abs(height / box.height - 1)
    if (across >= down) height = width! / ratio
    else width = height! * ratio
  }
  const draft: { width?: number; height?: number } = {
    ...width !== undefined ? { width: whole(width) } : {},
    ...height !== undefined ? { height: whole(height) } : {},
  }
  if ((draft.width === undefined || fixedAt(layout.width.value, draft.width)) && (draft.height === undefined || fixedAt(layout.height.value, draft.height))) return null
  return {
    draft,
    commit: { kind: 'layer', changes: [{
      section: 'layout',
      ...draft.width !== undefined ? { width: { mode: 'fixed', size: draft.width } } : {},
      ...draft.height !== undefined ? { height: { mode: 'fixed', size: draft.height } } : {},
    }] },
  }
}

// ------------------------------------------------------------ padding, spacing and moving

/**
 * New insets for some sides of the padding or the margin, as the draft lays them out, in
 * points on every side, and as the change writes them: a side that does not change keeps
 * what was written, a token included. Null when nothing changes.
 */
function insetsTo(start: DragStart, role: 'padding' | 'margin', next: Partial<Record<Side, number>>): DragChange | null {
  const value = start.layer.layout[role].value
  const now = insetsDrawn(start, role)?.insets ?? NONE
  const draft = Object.fromEntries(SIDES.map(side => [side, next[side] ?? now[side]])) as Record<Side, number>
  if (SIDES.every(side => draft[side] === now[side])) return null
  const written = Object.fromEntries(SIDES.map(side => [side, next[side] ?? value?.[side] ?? 0])) as unknown as Insets
  return { draft: { [role]: draft }, commit: { kind: 'layer', changes: [{ section: 'layout', [role]: written }] } }
}

/**
 * Padding bands: dragging a band in gives its side more padding, from nothing on a side
 * that has none. Alt changes the opposite side to the same, and Shift all four; never
 * below nothing.
 */
function insetsChange(side: Side, start: DragStart, delta: Point, keys: DragKeys): DragChange | null {
  const now = paddingDrawn(start)
  if (!now) return null
  const inward = side === 'top' ? delta.y : side === 'bottom' ? -delta.y : side === 'leading' ? delta.x : -delta.x
  const next = whole(now.insets[side] + inward)
  const changed: readonly Side[] = keys.shift ? SIDES : keys.alt ? [side, OPPOSITE[side]] : [side]
  return insetsTo(start, 'padding', Object.fromEntries(changed.map(each => [each, next])))
}

/** The gaps between a stack's views, along its axis and across its whole content. */
function gaps(start: DragStart): readonly Rect[] | undefined {
  const views = start.instance.children, content = start.instance.content
  if (!start.stack || !views || views.length < 2) return undefined
  return views.slice(1).map((view, index) => {
    const before = views[index]!
    return start.stack === 'vertical'
      ? { x: content.x, y: before.y + before.height, width: content.width, height: Math.max(0, view.y - before.y - before.height) }
      : { x: before.x + before.width, y: content.y, width: Math.max(0, view.x - before.x - before.width), height: content.height }
  })
}

/** A stack's spacing: the gap dragged, in whole points along the stack's axis, never below nothing. */
function spacingChange(gap: number, start: DragStart, delta: Point): DragChange | null {
  const now = gaps(start)?.[gap]
  if (!now) return null
  const vertical = start.stack === 'vertical'
  const before = vertical ? now.height : now.width
  const value = whole(before + (vertical ? delta.y : delta.x))
  return value === Math.round(before) ? null : { draft: { spacing: value }, commit: { kind: 'spacing', value } }
}

/**
 * Where a pinned view's drag is written: its margin, the room between its fill and the
 * Overlap's edges, or its padding where it has no fill and so no margin.
 */
function pinRoom(start: DragStart): 'padding' | 'margin' | null {
  const layout = start.layer.layout
  return editable(layout.margin) ? 'margin' : editable(layout.padding) ? 'padding' : null
}

/** Whether the body can be dragged: inside an Overlap, by its offset or, pinned, by the room around it. */
function movable(start: DragStart): boolean {
  const layout = start.layer.layout
  return layout.context.parent === 'overlap' && (layout.pin.value ? !!pinRoom(start) : !!offsetNow(start))
}

/**
 * The body, dragged inside an Overlap: an offset in whole points, an axis that did not
 * move keeping what was written. A pinned view is placed by its pin, so its drag writes
 * the room on the sides it is pinned to instead, never below nothing; along an axis it is
 * centred on, it stays where it is.
 */
function move(start: DragStart, delta: Point): DragChange | null {
  if (!movable(start)) return null
  const pin = start.layer.layout.pin.value
  if (pin) {
    const role = pinRoom(start)!, [vertical, horizontal] = alignmentSides(pin)
    const now = insetsDrawn(start, role)?.insets ?? NONE
    return insetsTo(start, role, {
      ...horizontal === 'leading' ? { leading: whole(now.leading + delta.x) } : horizontal === 'trailing' ? { trailing: whole(now.trailing - delta.x) } : {},
      ...vertical === 'top' ? { top: whole(now.top + delta.y) } : vertical === 'bottom' ? { bottom: whole(now.bottom - delta.y) } : {},
    })
  }
  const now = offsetNow(start)!, offset = { x: round(now.x + delta.x), y: round(now.y + delta.y) }
  if (offset.x === round(now.x) && offset.y === round(now.y)) return null
  return { draft: { offset }, commit: { kind: 'layer', changes: [{ section: 'layout', offset: keepUnmoved(start, offset, now) }] } }
}
