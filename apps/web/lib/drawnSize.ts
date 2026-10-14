import type { LayerLayout, Length, RenderNode, RenderTree, Size, ViewLayer } from '@studio/shared'
import { findLayer } from './layers'

/**
 * The size a view is drawn at, in points: what the Layout section's Fixed starts from, so
 * switching to Fixed changes nothing on the canvas.
 *
 * It is the box around everything the view and its children paint, its fill included. A
 * Button is sized on its label, so a button is measured by its label and not by the
 * bordered shape around it; a scroll view or a clipped view by its own box.
 */
export function drawnSize(tree: RenderTree, hierarchy: readonly ViewLayer[], runtimeId: string, button = false): Size | undefined {
  const byId = new Map(tree.nodes.map(node => [node.id, node]))
  const own = byId.get(runtimeId)
  const layer = findLayer(hierarchy, runtimeId)
  if (!layer) return undefined
  // Every layer under the view, and the longest of them a painted node's id starts with: its owner.
  const inside = new Set<string>()
  const collect = (item: ViewLayer) => { inside.add(item.id); item.children.forEach(collect) }
  collect(layer)
  const ids = [...new Set(flatten(hierarchy))].sort((a, b) => b.length - a.length)
  const owner = (id: string) => ids.find(candidate => id.startsWith(candidate))
  // A node another view drew can share the id's start, as ForEach keys `a` and `ab` do: its owner says whose it is.
  let painted = own && (own.scroll || own.clip) ? [own] : tree.nodes.filter(node => node.id.startsWith(runtimeId) && inside.has(owner(node.id) ?? ''))
  if (button && painted.some(node => node.id.startsWith(`${runtimeId}label`))) painted = painted.filter(node => node.id.startsWith(`${runtimeId}label`))
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const node of painted) {
    if (node.frame.width <= 0 || node.frame.height <= 0) continue
    const { x, y } = origin(node, byId)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x + node.frame.width)
    bottom = Math.max(bottom, y + node.frame.height)
  }
  return right > left && bottom > top ? { width: right - left, height: bottom - top } : undefined
}

function flatten(items: readonly ViewLayer[]): string[] {
  return items.flatMap(item => [item.id, ...flatten(item.children)])
}

/** A node's place on the canvas: its frame is relative to the container it is positioned inside. */
function origin(node: RenderNode, byId: ReadonlyMap<string, RenderNode>, depth = 0): { x: number; y: number } {
  const parent = node.parent ? byId.get(node.parent) : undefined
  if (!parent || depth > 64) return { x: node.frame.x, y: node.frame.y }
  const base = origin(parent, byId, depth + 1)
  return { x: base.x + node.frame.x, y: base.y + node.frame.y }
}

/**
 * The size a switch to Fixed starts from: the size the frame will have, where it goes,
 * after the padding. Where a fill paints around the padding the drawn size is that
 * already; where nothing does, the padding is added to what the content draws. None when
 * that padding is a token or worked out in Swift, whose size the panel does not know.
 */
export function fixedStart(drawn: Size | undefined, layout: LayerLayout): Size | undefined {
  if (!drawn || layout.context.surface || layout.padding.state === 'absent') return drawn
  const padding = layout.padding.value
  if (!padding || [padding.top, padding.leading, padding.bottom, padding.trailing].some(side => typeof side !== 'number')) return undefined
  const side = (length: Length) => length as number
  return { width: drawn.width + side(padding.leading) + side(padding.trailing), height: drawn.height + side(padding.top) + side(padding.bottom) }
}
