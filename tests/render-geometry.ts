import type { RenderNode } from '@studio/shared'

/** Follow compositing containers when testing visible geometry. */
export function ancestors(nodes: readonly RenderNode[], node: RenderNode): RenderNode[] {
  const result: RenderNode[] = []
  let parent = node.parent
  while (parent) {
    const item = nodes.find(candidate => candidate.id === parent)
    if (!item || result.includes(item)) break
    result.push(item); parent = item.parent
  }
  return result
}
export function worldFrame(nodes: readonly RenderNode[], node: RenderNode) {
  return ancestors(nodes, node).reduce((frame, parent) => ({ ...frame, x: frame.x + parent.frame.x, y: frame.y + parent.frame.y }), node.frame)
}
export function surfaceRadius(nodes: readonly RenderNode[], node: RenderNode): number {
  return node.cornerRadius ?? ancestors(nodes, node).find(parent => parent.clip && parent.cornerRadius)?.cornerRadius ?? 0
}
