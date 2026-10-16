import { screenOrigin, type ContentTransitionSpec, type Rect, type RenderNode } from '@studio/shared'
import { keyOf } from './transition-presence'

/**
 * What changed between two strings, by how much of each end stays (Wave 5a): `Score: 9`
 * to `Score: 10` keeps `Score: `, so only the number rolls; `9` to `10` keeps nothing, so
 * both digits roll, as the simulator draws them. Counted in characters, not code units.
 */
export function textChange(before: string, after: string): { prefix: number; suffix: number } {
  const a = Array.from(before), b = Array.from(after)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  return { prefix, suffix }
}

/**
 * Whether new digits come up from below and old ones leave upwards (Wave 5a): always, for
 * `.numericText()`, never for `countsDown`, and for `numericText(value:)` when its value
 * didn't go down.
 */
export function rollsUp(now: ContentTransitionSpec, before: ContentTransitionSpec | undefined): boolean {
  if (now.kind !== 'numeric') return true
  if (now.countsDown) return false
  const was = before?.kind === 'numeric' ? before.value : undefined
  return now.value === undefined || was === undefined || now.value >= was
}

/** Where a matched view comes from, and where one goes, by node key, in each node's own parent's space (Wave 5a). */
export interface Morphs {
  readonly from: ReadonlyMap<string, Rect>
  readonly to: ReadonlyMap<string, Rect>
}

interface Matched { readonly box: Rect; readonly keys: ReadonlySet<string>; readonly sources: number }

/**
 * Matched geometry across a change (Wave 5a): a node of a matched view that is new moves
 * from the frame the view it is matched with had, and a node of one that went moves to
 * the frame of the one that came, each in proportion to the views' frames, measured on
 * the screen so a view can move out of a list or a sheet. Views drawn in both trees, or
 * by the same nodes, morph by their own transitions instead. A view with `isSource: false`
 * lends no frame.
 */
export function matchedMorphs(previous: readonly RenderNode[], current: readonly RenderNode[]): Morphs {
  const from = new Map<string, Rect>(), to = new Map<string, Rect>()
  const before = matchedIn(previous), after = matchedIn(current)
  if (!before.views.size || !after.views.size) return { from, to }
  const move = (nodes: ReadonlyMap<string, RenderNode>, byId: ReadonlyMap<string, RenderNode>, own: Matched, other: Matched, out: Map<string, Rect>) => {
    for (const node of nodes.values()) {
      const key = keyOf(node)
      if (other.keys.has(key)) continue
      const origin = screenOrigin(node, byId), parent = { x: origin.x - node.frame.x, y: origin.y - node.frame.y }
      const sx = other.box.width / (own.box.width || 1), sy = other.box.height / (own.box.height || 1)
      const rect = node.matched!.properties === 'position'
        ? { x: origin.x + other.box.x + other.box.width / 2 - own.box.x - own.box.width / 2, y: origin.y + other.box.y + other.box.height / 2 - own.box.y - own.box.height / 2, width: node.frame.width, height: node.frame.height }
        : node.matched!.properties === 'size'
          ? { x: origin.x, y: origin.y, width: node.frame.width * sx, height: node.frame.height * sy }
          : { x: other.box.x + (origin.x - own.box.x) * sx, y: other.box.y + (origin.y - own.box.y) * sy, width: node.frame.width * sx, height: node.frame.height * sy }
      out.set(key, { x: round(rect.x - parent.x), y: round(rect.y - parent.y), width: round(rect.width), height: round(rect.height) })
    }
  }
  for (const [id, now] of after.views) {
    const was = before.views.get(id)
    if (!was) continue
    if (was.sources) move(after.nodes.get(id)!, after.byId, now, was, from)
    if (now.sources) move(before.nodes.get(id)!, before.byId, was, now, to)
  }
  return { from, to }
}

const round = (value: number) => Math.round(value * 100) / 100

/** Each matched view of a tree: the box around its source nodes on the screen, and its nodes (Wave 5a). */
function matchedIn(nodes: readonly RenderNode[]) {
  const views = new Map<string, Matched>(), byKey = new Map<string, Map<string, RenderNode>>()
  let byId: Map<string, RenderNode> | undefined
  for (const node of nodes) {
    if (!node.matched) continue
    byId ??= new Map(nodes.map(each => [each.id, each]))
    const origin = screenOrigin(node, byId), source = node.matched.isSource !== false
    const view = views.get(node.matched.id)
    const box = !source ? view?.box : view?.sources ? union(view.box, { ...node.frame, ...origin }) : { ...node.frame, ...origin }
    views.set(node.matched.id, { box: box ?? { ...node.frame, ...origin }, keys: new Set([...view?.keys ?? [], keyOf(node)]), sources: (view?.sources ?? 0) + (source ? 1 : 0) })
    const own = byKey.get(node.matched.id) ?? new Map<string, RenderNode>()
    own.set(keyOf(node), node)
    byKey.set(node.matched.id, own)
  }
  return { views, nodes: byKey, byId: byId ?? new Map<string, RenderNode>() }
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}
