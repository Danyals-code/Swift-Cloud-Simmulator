import type { RenderNode, RenderTree, ViewLayer } from '@studio/shared'

export function findLayer(layers: readonly ViewLayer[], id: string): ViewLayer | undefined {
  for (const layer of layers) {
    if (layer.id === id) return layer
    const child = findLayer(layer.children, id)
    if (child) return child
  }
}

/** Prefer a control's full hit frame. Containers without paint highlight their contents. */
export function layerRenderIds(layer: ViewLayer | undefined, tree: RenderTree | null | undefined, hierarchy: readonly ViewLayer[] = layer ? [layer] : []): ReadonlySet<string> {
  if (!layer || !tree) return new Set()
  const ids = new Set<string>()
  const nodes = new Map(tree.nodes.map(node => [node.id, node]))
  const hits = new Map(tree.nodes.filter(node => node.hitTarget).map(node => [node.hitTarget!.handlerId, node]))
  // Longest view-path ownership distinguishes ForEach keys such as "a" and "ab"
  // while still including a Label's synthesized icon and title. Linear in ID bytes.
  type Branch = { owner?: string; children: Map<string, Branch> }
  const root: Branch = { children: new Map() }
  const index = (item: ViewLayer) => {
    let branch = root
    for (const character of item.id) {
      if (!branch.children.has(character)) branch.children.set(character, { children: new Map() })
      branch = branch.children.get(character)!
    }
    branch.owner = item.id
    item.children.forEach(index)
  }
  hierarchy.forEach(index)
  const owned = new Map<string, RenderNode[]>()
  for (const painted of tree.nodes) {
    let branch: Branch | undefined = root
    let owner: string | undefined
    for (const character of painted.id) {
      branch = branch.children.get(character)
      if (!branch) break
      owner = branch.owner ?? owner
    }
    if (owner && painted.frame.width > 0 && painted.frame.height > 0) {
      const group = owned.get(owner) ?? []
      group.push(painted)
      owned.set(owner, group)
    }
  }
  const visit = (item: ViewLayer) => {
    const hit = hits.get(`action-${item.id}`)
    const node = hit ?? nodes.get(item.id)
    if (node && node.frame.width > 0 && node.frame.height > 0) ids.add(node.id)
    else if (item.children.length) item.children.forEach(visit)
    else for (const painted of owned.get(item.id) ?? []) ids.add(painted.id)
  }
  visit(layer)
  return ids
}
