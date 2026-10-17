import { sameStart, screenOrigin, type AxisSize, type LayerDraft, type ModifierBox, type Rect, type RenderNode, type RenderTree, type ViewInstance } from '@studio/shared'
import { capFrames, setsSize, sizeFrames, SLOT, type DraftChain, type DraftPlace, type FrameParts, type LayerDraftSites } from '@studio/swift-sema'
import { alignmentNamed, CENTER, childrenOf, modifierContent, type LayoutDraftEdit, type LayoutElement, type LayoutModifier, type PlaceObserver } from '@studio/swiftui-layout'
import type { ViewValue } from './view-value'

/**
 * Where the view the canvas has selected is drawn, box by box, and the same view laid out
 * with a drag's values (Wave 2b).
 *
 * A view's modifiers are layout elements named `${path}m${index}` after its evaluated
 * modifiers, each of which carries the span of the call it was written as. So the call a
 * box came from is found by its span, and a drag's padding, frame or offset is swapped in
 * or added beside the elements of the calls around it, exactly where writing it would put
 * the new call. Only the selected view's elements are looked at.
 */

/** A view as it was converted: what it evaluated to and the element it became. */
export interface ConvertedView {
  readonly view: ViewValue
  readonly element: LayoutElement
}

/** One element a view's modifier made around it. */
interface Wrapper {
  readonly id: string
  readonly modifier: LayoutModifier
  /** Its modifier's place among the view's evaluated ones; Infinity for the tap target and disabled look outside them all. */
  readonly runtime: number
  /** Its call's place in the chain the layer reads, or for a draft's, where it will be written. */
  readonly chain?: number
  /** A component's own modifier, written in its body rather than where it is used: inside the chain's. */
  readonly inner?: true
  readonly draft?: true
}

type ParentKind = 'column' | 'row' | 'overlap' | 'other'

/** One place the view is drawn, in the elements of one layout pass. */
interface Found {
  readonly path: string
  readonly view: ViewValue
  /** Where its pass's nodes are named in the tree, `overlay/` inside a sheet. */
  readonly prefix: string
  readonly outer: string
  /** Innermost first. */
  readonly wrappers: readonly Wrapper[]
  readonly base: LayoutElement
  readonly parent?: { readonly id: string; readonly kind: ParentKind }
  /** Every element under it, to tell its own nodes. */
  readonly within: Set<string>
  /** Where each call of its chain is among its evaluated modifiers. */
  readonly calls: ReadonlyMap<number, number>
  /** A Button's label element, `${path}label`. */
  label?: string
  /** A Button's label view, whose chain takes its padding and size. */
  labelView?: Found
  /** A draft's wrappers around a label written whole, innermost first. */
  labelWraps?: readonly Wrapper[]
}

/** The roots of one screen's layout passes, with how each names its nodes. */
export interface PassRoot {
  readonly element: LayoutElement
  readonly prefix: string
  /** The node a root element of the pass is placed in: the sheet's surface, or null for the screen. */
  readonly root: string | null
}

const drawnAt = (view: ViewValue, chain: DraftChain) => sameStart(view.span, chain.view) || !!view.componentSources?.some(component => sameStart(component.source, chain.view))

/** Where a call of `chain` is among a view's evaluated modifiers, by the span each carries. */
function callsOf(view: ViewValue, chain: DraftChain | undefined): Map<number, number> {
  const out = new Map<number, number>()
  if (!chain) return out
  view.modifiers.forEach((modifier, runtime) => {
    const at = chain.calls.findIndex(call => call.file === modifier.span.file && call.start === modifier.span.start && call.end === modifier.span.end)
    if (at >= 0) out.set(at, runtime)
  })
  return out
}

/** A modifier element's place among the view's evaluated modifiers, for one of the view's own elements. */
function runtimeOf(id: string, path: string): number | undefined {
  if (!id.startsWith(path)) return undefined
  const rest = id.slice(path.length)
  if (rest === 'hit' || rest === 'disabled') return Infinity
  const match = /^m(\d+)(?:cast)?$/.exec(rest)
  return match ? Number(match[1]) : undefined
}

function kindOf(element: LayoutElement): ParentKind {
  if (element.kind === 'stack' || element.kind === 'scroll') return element.axis === 'vertical' ? 'column' : 'row'
  return element.kind === 'zstack' ? 'overlap' : 'other'
}

/**
 * Each place the view, and a Button's label view, is drawn in these passes. `views` is
 * every view the conversion met, by path; the chains say which are the selected one.
 */
export function findViews(roots: readonly PassRoot[], views: ReadonlyMap<string, ConvertedView>, chains: Pick<LayerDraftSites, 'view' | 'label'>): Found[] {
  const watched = new Map<string, { path: string; converted: ConvertedView; label: boolean }>()
  for (const [path, converted] of views) {
    const label = !drawnAt(converted.view, chains.view)
    if (label && !(chains.label && drawnAt(converted.view, chains.label))) continue
    watched.set(converted.element.id, { path, converted, label })
  }
  const found: Found[] = []
  if (!watched.size) return found

  const visit = (element: LayoutElement, prefix: string, parent: Found['parent'], inside: Found | undefined): void => {
    const match = watched.get(element.id)
    if (match && (match.label ? inside && !inside.labelView : !inside)) {
      const chain = match.label ? chains.label : chains.view
      const view = match.converted.view, calls = callsOf(view, chain)
      const chained = new Map([...calls].map(([index, runtime]) => [runtime, index]))
      const wrappers: Wrapper[] = []
      let at = element
      for (let runtime = runtimeOf(at.id, match.path); at.kind === 'modified' && runtime !== undefined; runtime = runtimeOf(at.id, match.path)) {
        const span = view.modifiers[runtime]?.span
        const index = chained.get(runtime)
        const inner = index === undefined && !!span && span.file === view.span.file && span.start === view.span.start
        wrappers.unshift({ id: at.id, modifier: at.modifier, runtime, ...(index !== undefined ? { chain: index } : {}), ...(inner ? { inner: true } : {}) })
        at = at.child
      }
      const instance: Found = { path: match.path, view, prefix, outer: element.id, wrappers, base: at, ...(parent ? { parent } : {}), within: new Set(), calls }
      if (match.label) inside!.labelView = instance
      else found.push(instance)
      const owner = match.label ? inside! : instance
      for (const wrapper of wrappers) {
        owner.within.add(wrapper.id)
        const content = modifierContent(wrapper.modifier)
        if (content) visit(content, prefix, { id: wrapper.id, kind: 'other' }, owner)
      }
      visit(at, prefix, parent, owner)
      return
    }
    if (inside) {
      inside.within.add(element.id)
      if (element.id === `${inside.path}label`) inside.label = element.id
    }
    // A modifier's child is laid out where the modifier is, in the same container; what it
    // draws beside it, a background's view, is in the modifier.
    if (element.kind === 'modified') {
      const content = modifierContent(element.modifier)
      if (content) visit(content, prefix, { id: element.id, kind: 'other' }, inside)
      visit(element.child, prefix, parent, inside)
      return
    }
    for (const child of childrenOf(element)) visit(child, prefix, { id: element.id, kind: kindOf(element) }, inside)
  }
  for (const root of roots) visit(root.element, root.prefix, undefined, undefined)
  return found
}

/** The element a view's modifiers start from: its own, or a component's with the modifiers its body gives it. */
function contentOf(instance: Pick<Found, 'wrappers' | 'base'>): string {
  let content = instance.base.id
  for (const wrapper of instance.wrappers) {
    if (!wrapper.inner) break
    content = wrapper.id
  }
  return content
}

/** Every element id a placement must be told about for these views' geometry. */
export function watchedIds(found: readonly Found[]): Set<string> {
  const ids = new Set<string>()
  const add = (instance: Found) => {
    ids.add(instance.outer)
    ids.add(instance.base.id)
    for (const wrapper of instance.wrappers) ids.add(wrapper.id)
    if (instance.parent) ids.add(instance.parent.id)
    if (instance.base.kind === 'stack') for (const child of instance.base.children) ids.add(child.id)
    if (instance.label) ids.add(instance.label)
    for (const wrapper of instance.labelWraps ?? []) ids.add(wrapper.id)
    if (instance.labelView) add(instance.labelView)
  }
  found.forEach(add)
  return ids
}

/** Where each watched element was placed, and in which node's space, as each layout pass names them. */
export class Placements {
  readonly rects = new Map<string, { readonly rect: Rect; readonly space: string | null }>()
  constructor(private readonly ids: ReadonlySet<string>) {}

  /** A pass laid out from a `shift`ed corner, a slot's beside views (Wave 6c), has the rects in no node's space moved by it. */
  observer(pass: Pick<PassRoot, 'prefix' | 'root'> & { readonly shift?: { readonly x: number; readonly y: number } }): PlaceObserver {
    const shift = pass.shift
    return (element, rect, space) => {
      if (!this.ids.has(element.id)) return
      const placed = space === null && shift ? { x: rect.x + shift.x, y: rect.y + shift.y, width: rect.width, height: rect.height } : rect
      this.rects.set(pass.prefix + element.id, { rect: placed, space: space === null ? pass.root : pass.prefix + space })
    }
  }
}

/** Node ids a decoration of an element is drawn as: its shadow, clip, border and the like. */
const DECORATION = /-(?:shadow|mask|opacity|clip|border|hit|xform|filter|material|a11y)$/

/** The view's place on the canvas, from where its elements were placed in `tree`. */
export function instancesIn(found: readonly Found[], placements: Placements, tree: RenderTree): ViewInstance[] {
  if (!found.length) return []
  const byId = new Map(tree.nodes.map(node => [node.id, node]))
  /** Where a node's own space starts on the screen, nothing scrolled. */
  const originOf = (space: string | null) => {
    const node = space === null ? undefined : byId.get(space)
    return node ? screenOrigin(node, byId) : { x: 0, y: 0 }
  }
  const instances: ViewInstance[] = []
  for (const instance of found) {
    const outer = placements.rects.get(instance.prefix + instance.outer)
    if (!outer) continue
    const space = outer.space, origin = originOf(space)
    const rectOf = (id: string): Rect | undefined => {
      const placed = placements.rects.get(instance.prefix + id)
      if (!placed) return undefined
      const at = originOf(placed.space)
      return { x: placed.rect.x + at.x - origin.x, y: placed.rect.y + at.y - origin.y, width: placed.rect.width, height: placed.rect.height }
    }
    const anchor = anchorIn(tree, instance, space)
    if (!anchor) continue
    const boxes = [
      ...instance.labelView ? boxesOf(instance.labelView, rectOf, true) : [],
      ...boxesOf({ wrappers: instance.labelWraps ?? [], base: { id: instance.label ?? '' } }, rectOf, true),
      ...boxesOf(instance, rectOf, false),
    ]
    const content = rectOf(contentOf(instance))
    if (!content) continue
    const label = instance.labelView ? rectOf(contentOf(instance.labelView)) : instance.label ? rectOf(instance.label) : undefined
    const children = instance.base.kind === 'stack' ? instance.base.children.flatMap(child => rectOf(child.id) ?? []) : undefined
    const parent = instance.parent && rectOf(instance.parent.id)
    instances.push({
      anchor: anchor.id,
      anchorFrame: anchor.frame,
      content,
      boxes,
      ...(children ? { children } : {}),
      ...(parent ? { parent: { kind: instance.parent!.kind, rect: parent } } : {}),
      ...(label ? { label } : {}),
    })
  }
  return instances
}

/**
 * The node the canvas measures the view's boxes from: the first the view draws in the
 * space its outermost element is placed in, else any node there, else the screen. Never a
 * rotated or scaled one, whose box on the page is not its frame.
 */
function anchorIn(tree: RenderTree, instance: Found, space: string | null): RenderNode | undefined {
  const here = tree.nodes.filter(node => (node.parent ?? null) === space && !node.transform)
  const own = (node: RenderNode) => {
    if (!node.id.startsWith(instance.prefix)) return false
    const id = node.id.slice(instance.prefix.length)
    return instance.within.has(id) || instance.within.has(id.replace(DECORATION, ''))
  }
  return here.find(own) ?? here.find(node => node.id !== 'screen') ?? (space === null ? tree.nodes.find(node => node.id === 'screen') : undefined)
}

/** Modifiers whose box the canvas draws handles on, and the others that change where the view is. */
const BOX_KINDS: Readonly<Record<string, ModifierBox['kind']>> = {
  padding: 'padding', frame: 'frame', offset: 'offset',
  fixedSize: 'other', aspectRatio: 'other', position: 'other', containerRelativeFrame: 'other', ignoresSafeArea: 'other',
}

function boxesOf(instance: { readonly wrappers: readonly Wrapper[]; readonly base: { readonly id: string } }, rectOf: (id: string) => Rect | undefined, label: boolean): ModifierBox[] {
  const boxes: ModifierBox[] = []
  instance.wrappers.forEach((wrapper, at) => {
    const kind = BOX_KINDS[wrapper.modifier.kind]
    if (!kind || wrapper.chain === undefined) return
    // An offset is drawn where it moves the view to, which is where what it holds is placed.
    const rect = rectOf(wrapper.modifier.kind === 'offset' ? instance.wrappers[at - 1]?.id ?? instance.base.id : wrapper.id)
    if (rect) boxes.push({ index: wrapper.chain, kind, rect, ...(label ? { label: true } : {}), ...(wrapper.draft ? { draft: true } : {}) })
  })
  return boxes
}

// ------------------------------------------------------------------ drafts

/** The values a draft writes, by the slot each is written in, so new calls at one place go in the writer's order. */
type Field = keyof Pick<typeof SLOT, 'padding' | 'size' | 'margin' | 'outerFrame' | 'offset'>

interface Insertion {
  readonly before: number
  readonly field: Field
  readonly modifiers: readonly LayoutModifier[]
}

/** What a draft changes in one chain: the calls it takes out and the ones it adds. */
interface ChainChange {
  readonly removed: Set<number>
  readonly inserted: Insertion[]
}

/** The draft's edits to the layout, and the views as they are drawn with it, for their geometry. */
export function draftEdits(found: readonly Found[], sites: LayerDraftSites, draft: LayerDraft): { readonly edits: LayoutDraftEdit[]; readonly found: Found[] } {
  const edits: LayoutDraftEdit[] = []
  const drafted = found.map(instance => draftInstance(instance, sites, draft, edits))
  return { edits, found: drafted }
}

function draftInstance(instance: Found, sites: LayerDraftSites, draft: LayerDraft, edits: LayoutDraftEdit[]): Found {
  const own: ChainChange = { removed: new Set(), inserted: [] }
  const label: ChainChange = { removed: new Set(), inserted: [] }
  const whole: { field: Field; modifiers: LayoutModifier[] }[] = []
  let wholeKind: 'title' | 'views' | undefined
  const put = (place: DraftPlace | undefined, field: Field, modifiers: readonly LayoutModifier[]) => {
    if (!place) return
    if (!('replace' in place) && !('insert' in place)) {
      wholeKind = place.chain
      if (modifiers.length) whole.push({ field, modifiers: [...modifiers] })
      return
    }
    const change = place.chain === 'label' ? label : own
    if ('replace' in place) place.replace.forEach(index => change.removed.add(index))
    const before = 'replace' in place ? place.replace[0]! : place.insert
    if (modifiers.length) change.inserted.push({ before, field, modifiers })
  }
  if (draft.padding) put(sites.padding, 'padding', insetsModifiers(draft.padding))
  if (draft.margin) put(sites.margin, 'margin', insetsModifiers(draft.margin))
  if (draft.offset) put(sites.offset, 'offset', draft.offset.x || draft.offset.y ? [{ kind: 'offset', x: draft.offset.x, y: draft.offset.y }] : [])
  if ((draft.width !== undefined || draft.height !== undefined) && sites.size) {
    const sizeView = sites.size.place.chain === 'label' ? instance.labelView : instance
    const frames = sizeView ? draftFrames(sizeView, sites.size, draft) : undefined
    if (frames) {
      put(sites.size.place, 'size', frames.size)
      if (sites.size.cap) put(sites.size.cap, 'outerFrame', frames.cap)
    }
  }
  if (draft.spacing !== undefined && sites.spacing && instance.base.kind === 'stack' && Number.isFinite(draft.spacing)) {
    edits.push({ kind: 'spacing', id: instance.base.id, spacing: draft.spacing, withoutSpacers: sites.spacing.auto })
  }

  let next: Found = applyChange(instance, own, edits)
  if (instance.labelView) next = { ...next, labelView: applyChange(instance.labelView, label, edits) }
  if (wholeKind && whole.length && instance.label) {
    const around = wholeKind === 'views' ? `${instance.label}~group` : instance.label
    if (wholeKind === 'views') edits.push({ kind: 'group', id: instance.label, into: { id: around, axis: 'horizontal', alignment: { horizontal: 'center', vertical: 'center' } } })
    const modifiers = whole.sort((a, b) => SLOT[a.field] - SLOT[b.field]).flatMap(item => item.modifiers.map((modifier, at) => ({ id: `${instance.label}~${item.field}${at}`, modifier })))
    edits.push({ kind: 'wrap', id: around, modifiers })
    next = { ...next, labelWraps: modifiers.map((wrapper, at) => ({ ...wrapper, runtime: at, chain: 0, draft: true })) }
  }
  return next
}

/** The view's wrappers with a chain's change made: the edits that make it, and the wrappers as they are then. */
function applyChange(instance: Found, change: ChainChange, edits: LayoutDraftEdit[]): Found {
  if (!change.removed.size && !change.inserted.length) return instance
  let wrappers = instance.wrappers.filter(wrapper => {
    const gone = wrapper.chain !== undefined && change.removed.has(wrapper.chain)
    if (gone) edits.push({ kind: 'unwrap', id: wrapper.id })
    return !gone
  })
  // The calls kept, by their place in the chain, and where each is among the evaluated modifiers.
  const kept = [...instance.calls].filter(([index]) => !change.removed.has(index))
  // Inside every call of the chain: a component's body's own modifiers, and a container's
  // `.disabled` or `.allowsHitTesting(false)`, which the runtime puts first.
  const chained = new Set(instance.calls.values())
  const leading = instance.view.modifiers.findIndex(modifier => !BLOCKERS.has(modifier.name))
  const inside = instance.view.modifiers.flatMap((modifier, runtime) => {
    const body = modifier.span.file === instance.view.span.file && modifier.span.start === instance.view.span.start && !chained.has(runtime)
    return body || runtime < (leading < 0 ? instance.view.modifiers.length : leading) ? [runtime] : []
  })
  const groups = new Map<number, Insertion[]>()
  for (const insertion of change.inserted) groups.set(insertion.before, [...groups.get(insertion.before) ?? [], insertion])
  for (const [before, insertions] of [...groups].sort(([a], [b]) => a - b)) {
    // The new call is written before the call at `before`: it goes where that call's
    // evaluated modifier is, or just after the last call before it.
    const after = kept.filter(([index]) => index >= before).map(([, runtime]) => runtime)
    const below = [...kept.filter(([index]) => index < before).map(([, runtime]) => runtime), ...inside]
    const at = after.length ? Math.min(...after) : below.length ? Math.max(...below) + 1 : 0
    let place = 0
    while (place < wrappers.length && wrappers[place]!.runtime < at) place++
    const around = place > 0 ? wrappers[place - 1]!.id : instance.base.id
    const added = insertions.sort((a, b) => SLOT[a.field] - SLOT[b.field]).flatMap(insertion => insertion.modifiers.map((modifier, n) => ({
      id: `${instance.path}~${insertion.field}${n}`, modifier, runtime: at - 0.5, chain: before, draft: true as const,
    })))
    edits.push({ kind: 'wrap', id: around, modifiers: added.map(({ id, modifier }) => ({ id, modifier })) })
    wrappers = [...wrappers.slice(0, place), ...added, ...wrappers.slice(place)]
  }
  return { ...instance, wrappers }
}

const BLOCKERS: ReadonlySet<string> = new Set(['disabled', 'allowsHitTesting'])

function insetsModifiers(insets: LayerDraft['padding'] & object): LayoutModifier[] {
  const { top, leading, bottom, trailing } = insets
  return [top, leading, bottom, trailing].every(side => side === 0) ? [] : [{ kind: 'padding', insets: { top, leading, bottom, trailing } }]
}

type FrameModifier = Extract<LayoutModifier, { kind: 'frame' }>
const BOUND = { width: { min: 'minWidth', max: 'maxWidth' }, height: { min: 'minHeight', max: 'maxHeight' } } as const

/**
 * The size frames and cap a drag's size gives the view: the frames the Layout section
 * writes for it (`sizeFrames` and `capFrames`, the writer's own), laid out as they would
 * evaluate. An axis the drag leaves keeps what its frames evaluated to, read as the
 * section reads them: a width is Fixed, a maximum Fill, else Hug, up to its cap's maximum.
 */
function draftFrames(instance: Found, size: NonNullable<LayerDraftSites['size']>, draft: LayerDraft): { size: LayoutModifier[]; cap: LayoutModifier[] } {
  const framesAt = (place: DraftPlace | undefined) => place && 'replace' in place
    ? instance.wrappers.flatMap(wrapper => wrapper.chain !== undefined && place.replace.includes(wrapper.chain) && wrapper.modifier.kind === 'frame' ? [wrapper.modifier] : [])
    : []
  const sized = framesAt(size.place), capped = framesAt(size.cap)
  /** The bound the frames set, the outer one where two do. */
  const bound = (frames: readonly FrameModifier[], key: 'width' | 'height' | 'minWidth' | 'maxWidth' | 'minHeight' | 'maxHeight') => {
    let value: number | undefined
    for (const frame of frames) value = frame[key] ?? value
    return value
  }
  const axis = (name: 'width' | 'height'): AxisSize => {
    const asked = draft[name]
    if (typeof asked === 'number') return { mode: 'fixed', size: Math.max(0, asked) }
    if (asked === 'hug' || asked === 'fill') return { mode: asked }
    const fixed = bound(sized, name)
    if (fixed !== undefined) return { mode: 'fixed', size: fixed }
    const min = bound(sized, BOUND[name].min), max = bound(sized, BOUND[name].max)
    const cap = max === undefined ? bound(capped, BOUND[name].max) : undefined
    return { mode: max !== undefined ? 'fill' : 'hug', ...(min !== undefined ? { min } : {}), ...(max !== undefined && max !== Infinity ? { max } : {}), ...(cap !== undefined ? { max: cap } : {}) }
  }
  const width = axis('width'), height = axis('height')
  const alignment = setsSize(width) || setsSize(height) ? size.alignment ?? 'center' : null
  return { size: sizeFrames(width, height, alignment).map(evaluated), cap: capFrames(width, height, alignment).map(evaluated) }
}

/**
 * A frame the writer writes, as its evaluated layout modifier. Its alignment is already
 * along only the axes it sizes; the draft's lengths are numbers, never tokens.
 */
function evaluated(frame: FrameParts): LayoutModifier {
  const bounds = Object.fromEntries(frame.args.map(([label, value]) => [label, value === 'infinity' ? Infinity : typeof value === 'number' ? value : NaN]))
  return { kind: 'frame', ...bounds, alignment: frame.alignment ? alignmentNamed(frame.alignment) ?? CENTER : CENTER }
}
