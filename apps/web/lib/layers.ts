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
  return layer ? layerRenderGroups([layer], tree, hierarchy)[0] ?? new Set() : new Set()
}

/** What each layer paints, as `layerRenderIds` finds it, with one ownership index for all of them. */
export function layerRenderGroups(layers: readonly ViewLayer[], tree: RenderTree | null | undefined, hierarchy: readonly ViewLayer[] = layers): ReadonlySet<string>[] {
  if (!tree) return layers.map(() => new Set())
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
  return layers.map(layer => {
    const ids = new Set<string>()
    const visit = (item: ViewLayer) => {
      const hit = hits.get(`action-${item.id}`)
      const node = hit ?? nodes.get(item.id)
      if (node && node.frame.width > 0 && node.frame.height > 0) ids.add(node.id)
      else if (item.children.length) item.children.forEach(visit)
      else for (const painted of owned.get(item.id) ?? []) ids.add(painted.id)
    }
    visit(layer)
    return ids
  })
}

/**
 * The layer a painted node belongs to - the inspector's answer, read backwards.
 *
 * `layerRenderIds` asks "what does this layer paint"; hovering asks the same
 * question from the other end, and it has the same two answers. A control is
 * reached through its hit target, whose handler is keyed by the layer's identity;
 * everything else is reached by ownership, which is a prefix relation on the
 * resolver's paths - so the deepest layer whose identity prefixes the node's is
 * the one that drew it. Shorter matches are ancestors and would select a whole
 * stack for a tap on one word inside it.
 */
export function layerForRenderNode(
  layers: readonly ViewLayer[],
  node: RenderNode | null | undefined,
): ViewLayer | undefined {
  if (!node) return undefined
  const handler = node.hitTarget?.handlerId
  const control = handler?.startsWith('action-') ? handler.slice('action-'.length) : null

  if (control) {
    const owner = findLayer(layers, control)
    if (owner) return owner
  }

  let best: ViewLayer | undefined
  const visit = (layer: ViewLayer): void => {
    if (node.id.startsWith(layer.id) && (!best || layer.id.length > best.id.length)) best = layer
    layer.children.forEach(visit)
  }
  layers.forEach(visit)
  return best
}

/** Every layer from the page down to `id`, so a selection can be scrolled to. */
export function layerAncestors(layers: readonly ViewLayer[], id: string | null): readonly string[] {
  if (!id) return []
  const walk = (layer: ViewLayer, trail: string[]): string[] | null => {
    if (layer.id === id) return trail
    for (const child of layer.children) {
      const found = walk(child, [...trail, layer.id])
      if (found) return found
    }
    return null
  }
  for (const page of layers) {
    const found = walk(page, [])
    if (found) return found
  }
  return []
}

/** A page's source may be its Tab declaration; default insertion belongs in its content. */
export function insertionLayer(layers: readonly ViewLayer[], selected?: ViewLayer): ViewLayer | undefined {
  if (selected?.source && !selected.page) return selected
  const page = selected?.page ? selected : layers.find(layer => layer.page?.active) ?? layers[0]
  if (!page) return undefined
  const editable = (layer: ViewLayer): ViewLayer | undefined => {
    if (layer.source && !layer.page && layer.type !== 'Tab') return layer
    return layer.children.map(editable).find(Boolean)
  }
  return page.children.map(editable).find(Boolean) ?? (page.source ? page : undefined)
}
