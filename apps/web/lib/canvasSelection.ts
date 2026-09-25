import { LAYER_MOVE_CONTAINERS, type AuthoringNode, type AuthoringSnapshot, type RenderNode, type ViewLayer } from '@studio/shared'
import { findLayer, layerAncestors, layerForRenderNode } from './layers'
import { sourceLayerIsVisual } from './sourceLayers'

/** A screen as the canvas draws it: its layers, and the source they come from. */
export interface CanvasScene {
  readonly snapshot: AuthoringSnapshot
  readonly layers: readonly ViewLayer[]
}

/** A view on the canvas: the source that writes it, and the one place on screen it was picked at. */
export interface CanvasPick {
  readonly node: AuthoringNode
  readonly runtimeId: string
}

/** A click, a ⌘-click that reaches the innermost view, or a double-click that goes one level in. */
export type CanvasGesture = 'click' | 'deep' | 'drill'

/** The view that is selected, where it was picked when that is known. */
export type CanvasSelection = Pick<CanvasPick, 'node'> & { readonly runtimeId?: string | null }

/**
 * What a gesture on the canvas selects (D1), by Figma's rule.
 *
 * A click selects what sits directly in the screen's main stack: a whole card, not the
 * word in it. A double-click goes one level in from the selection. `under` is everything
 * drawn under the pointer, topmost first, as the browser finds it.
 */
export function canvasPick(scene: CanvasScene, under: readonly RenderNode[], gesture: CanvasGesture, selected?: CanvasSelection | null): CanvasPick | undefined {
  const innermost = innermostLayer(scene, under)
  if (!innermost) return undefined
  const path = pathTo(scene, innermost)
  if (!path.length) return undefined
  if (gesture === 'deep') return path.at(-1)
  const at = selected ? path.findIndex(item => same(item, selected)) : -1
  // A view that only frames one other, such as a ScrollView around its stack, goes in
  // with it: the cards are the next level a designer sees.
  if (gesture === 'drill' && at >= 0) return path[at + (onlyChild(scene, path[at]!, path[at + 1]) && path[at + 2] ? 2 : 1)] ?? path[at]
  const main = mainStack(scene, path)
  // Inside the views around the selection, a click stays at the depth gone into: it picks
  // what sits in the nearest view around both, as Figma does once it is inside a group.
  const own = selected?.runtimeId ? pathTo(scene, selected.runtimeId) : []
  const depth = own.findIndex(item => same(item, selected!))
  let shared = 0
  while (shared < depth && shared < path.length && same(path[shared]!, own[shared]!)) shared++
  if (shared > main && path[shared]) return path[shared]
  return path[main + 1] ?? path[main]
}

/** The view a selection sits in, on its path. */
function parentIn(path: readonly CanvasPick[], selected: CanvasSelection): CanvasPick | undefined {
  const at = path.findIndex(item => same(item, selected))
  return at > 0 ? path[at - 1] : undefined
}

/** Whether `child` is the one view `frame` holds. */
function onlyChild(scene: CanvasScene, frame: CanvasPick, child: CanvasPick | undefined): boolean {
  const children = visualChildren(scene.snapshot, frame.node)
  return !!child && children.length === 1 && children[0]!.id === child.node.id && children[0]!.kind !== 'collection'
}

/** Where a drag puts a view: what moves, the view it goes beside, or the stack it goes into. */
export interface CanvasDrop {
  readonly from: CanvasSelection
  readonly to: CanvasPick
  readonly inside: boolean
}

/**
 * Where a drag on the canvas puts a view (D1). What moves is what a click would have
 * picked where the drag began, or the selection when it began inside it; it goes beside
 * the view under the pointer at its own depth - one card beside another - or, where a
 * stack's own space is under the pointer, usually its background, into that stack.
 */
export function canvasDrop(scene: CanvasScene, over: readonly RenderNode[], source: readonly RenderNode[] | 'selection', selected?: CanvasSelection | null): CanvasDrop | undefined {
  const from = source === 'selection' ? selected : canvasPick(scene, source, 'click', selected)
  if (!from) return undefined
  const own = layerForRenderNode(scene.layers, over[0])
  const container = own && LAYER_MOVE_CONTAINERS.has(own.type) ? indexOf(scene.snapshot).nodes.get(scene.snapshot.runtimeToSource[own.id] ?? '') : undefined
  const to = container ? { node: container, runtimeId: own!.id } : canvasPick(scene, over, 'click', from)
  return to ? { from, to, inside: !!container } : undefined
}

/**
 * The view Escape selects (D1): the one the selection sits in, as the canvas draws it, or
 * nothing above the screen's own stack. A view that is not drawn now, such as one in a
 * branch that is off, goes up by its source.
 */
export function canvasParent(scene: CanvasScene, selected: CanvasSelection): CanvasSelection | undefined {
  const runtimeId = selected.runtimeId ?? selected.node.runtimeIds[0]
  const path = runtimeId ? pathTo(scene, runtimeId) : []
  if (path.some(item => same(item, selected))) return parentIn(path, selected)
  const { nodes } = indexOf(scene.snapshot)
  for (let node = nodes.get(selected.node.parentId ?? ''); node && node.kind !== 'definition'; node = nodes.get(node.parentId ?? '')) {
    if (sourceLayerIsVisual(node)) return { node, runtimeId: node.runtimeIds[0] }
  }
  return undefined
}

/** One view at one place on screen; a selection made in Layers matches wherever it is drawn. */
const same = (item: CanvasPick, selected: CanvasSelection) =>
  item.node.id === selected.node.id && (!selected.runtimeId || item.runtimeId === selected.runtimeId)

/**
 * The innermost view under the pointer.
 *
 * The browser's own answer is the topmost node, and that is right everywhere except on a
 * Button or link, whose tap target is drawn over its label: there the label's views are
 * found under it. A link that is no view of its own on the canvas, only a tap target
 * around its label, stands for the one view it is drawn with.
 */
function innermostLayer(scene: CanvasScene, under: readonly RenderNode[]): string | undefined {
  const { snapshot, layers } = scene
  const owners = under.map(node => layerForRenderNode(layers, node)?.id)
  let innermost = owners[0]
  while (innermost) {
    const inside = innermost
    const deeper = owners.find(id => !!id && id !== inside && layerAncestors(layers, id).includes(inside))
    if (!deeper) break
    innermost = deeper
  }
  for (let layer = innermost ? findLayer(layers, innermost) : undefined; layer?.children.length === 1;) {
    const node = indexOf(snapshot).nodes.get(snapshot.runtimeToSource[layer.id] ?? '')
    if (!node || sourceLayerIsVisual(node)) break
    layer = layer.children[0]
    innermost = layer?.id
  }
  return innermost
}

/**
 * The views from the screen down to a layer, outermost first, as a designer sees them:
 * each component call where its content starts, and no scaffolding such as a ForEach.
 * The views that draw the whole screen are the screen itself, so they are left out.
 */
function pathTo(scene: CanvasScene, runtimeId: string): CanvasPick[] {
  const { snapshot, layers } = scene
  const { nodes, calls } = indexOf(snapshot)
  const path: CanvasPick[] = []
  let screen: number | undefined
  let components = 0
  for (const id of [...layerAncestors(layers, runtimeId), runtimeId]) {
    const layer = findLayer(layers, id)
    if (!layer || layer.page) continue
    const sources = layer.componentSources ?? []
    screen ??= sources.length
    for (const call of sources.slice(Math.max(components, screen))) {
      const node = calls.get(JSON.stringify([call.name, call.source.file, call.source.start]))
      if (node) path.push({ node, runtimeId: id })
    }
    components = sources.length
    const node = nodes.get(snapshot.runtimeToSource[id] ?? '')
    if (node && node.kind !== 'definition') path.push({ node, runtimeId: id })
  }
  return path.filter(item => sourceLayerIsVisual(item.node))
}

/**
 * Where the screen's content is laid out: the outermost view holding more than one, below
 * the ones that only frame it, such as a ScrollView around a stack. A repeat counts as many,
 * whatever its data, and a component is its own unit, never gone into.
 */
function mainStack(scene: CanvasScene, path: readonly CanvasPick[]): number {
  let main = 0
  while (main < path.length - 1 && path[main]!.node.kind !== 'component' && path[main + 1]!.node.kind !== 'component' && onlyChild(scene, path[main]!, path[main + 1])) main++
  return main
}

/** The views a view holds as a designer sees them: past groups and branches, and a repeat as one. */
function visualChildren(snapshot: AuthoringSnapshot, node: AuthoringNode): AuthoringNode[] {
  const nodes = indexOf(snapshot).nodes
  return node.children.flatMap(id => {
    const child = nodes.get(id)
    if (!child) return []
    if (child.kind === 'collection') return [child]
    return sourceLayerIsVisual(child) ? [child] : visualChildren(snapshot, child)
  })
}

/** A snapshot's views by id, and its component calls by where they are written, made once. */
const INDEXES = new WeakMap<AuthoringSnapshot, { readonly nodes: ReadonlyMap<string, AuthoringNode>; readonly calls: ReadonlyMap<string, AuthoringNode> }>()
function indexOf(snapshot: AuthoringSnapshot) {
  let index = INDEXES.get(snapshot)
  if (!index) INDEXES.set(snapshot, index = {
    nodes: new Map(snapshot.nodes.map(node => [node.id, node])),
    calls: new Map(snapshot.nodes.filter(node => node.kind === 'component').map(node => [JSON.stringify([node.name, node.source.file, node.source.start]), node])),
  })
  return index
}
