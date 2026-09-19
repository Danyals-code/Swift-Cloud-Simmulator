import type { AuthoringNode, AuthoringSnapshot, RenderTree, ViewLayer } from '@studio/shared'
import { findLayer, layerAncestors, layerRenderIds } from './layers'

/** Canvas ancestry crosses component call sites, unlike the source definition tree. */
export function hoveredSourceIds(snapshot: AuthoringSnapshot | undefined, layers: readonly ViewLayer[], runtimeId: string | null): readonly string[] {
  if (!snapshot || !runtimeId) return []
  const components = new Map(snapshot.nodes.filter(node => node.kind === 'component').map(node => [JSON.stringify([node.name, node.source.file, node.source.start]), node.id]))
  return [...new Set([runtimeId, ...[...layerAncestors(layers, runtimeId)].reverse()].flatMap(id => [
    snapshot.runtimeToSource[id],
    ...[...(findLayer(layers, id)?.componentSources ?? [])].reverse().map(component => components.get(JSON.stringify([component.name, component.source.file, component.source.start]))),
  ]).filter((id): id is string => !!id))]
}

/** A source view may paint once per repeated row or shared component instance. */
export function authoringRenderIds(node: AuthoringNode | null | undefined, snapshot: AuthoringSnapshot | undefined, layers: readonly ViewLayer[], tree: RenderTree | null | undefined): ReadonlySet<string> {
  const result = new Set<string>()
  if (!node || !snapshot || !tree || !snapshot.nodes.includes(node)) return result
  const byId = new Map(snapshot.nodes.map(item => [item.id, item]))
  const requested = new Set<string>()
  const visit = (item: AuthoringNode) => {
    if (item.runtimeIds.length) item.runtimeIds.forEach(id => requested.add(id))
    else for (const id of item.children) {
      const child = byId.get(id)
      if (child) visit(child)
    }
  }
  visit(node)
  // Build the render ownership index once, even for hundreds of repeated records.
  const roots: ViewLayer[] = []
  const collect = (items: readonly ViewLayer[]) => {
    for (const item of items) {
      if (requested.has(item.id)) roots.push(item)
      else collect(item.children)
    }
  }
  collect(layers)
  return layerRenderIds({ id: '__source_hover__', name: '', type: '', children: roots }, tree, layers)
}
