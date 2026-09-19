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

/** Resolve a source selection without trusting a runtime path reused after an edit. */
export function resolveAuthoringRuntimeSelection(
  node: AuthoringNode | null | undefined,
  snapshot: AuthoringSnapshot | undefined,
  layers: readonly ViewLayer[],
  requestedRuntimeId?: string,
  preferredLayers: readonly ViewLayer[] = layers,
): { readonly layer?: ViewLayer; readonly exact: boolean } {
  if (!node || !snapshot || !snapshot.nodes.includes(node)) return { exact: false }
  const byId = new Map(snapshot.nodes.map(item => [item.id, item]))
  const allowed = new Set(node.runtimeIds)
  // Definitions and source-only wrappers do not own a painted runtime node. An
  // entered component keeps the selected instance through one of its body views.
  if (node.kind === 'definition' || !node.runtimeIds.length) {
    const seen = new Set<string>()
    const collect = (item: AuthoringNode) => {
      if (seen.has(item.id)) return
      seen.add(item.id)
      item.runtimeIds.forEach(id => allowed.add(id))
      for (const id of item.children) {
        const child = byId.get(id)
        if (child) collect(child)
      }
    }
    collect(node)
  }
  if (requestedRuntimeId && allowed.has(requestedRuntimeId)) {
    const layer = findLayer(layers, requestedRuntimeId)
    if (layer) return { layer, exact: true }
  }
  const first = (items: readonly ViewLayer[]): ViewLayer | undefined => {
    for (const item of items) {
      if (allowed.has(item.id)) return item
      const child = first(item.children)
      if (child) return child
    }
  }
  return { layer: first(preferredLayers) ?? first(layers), exact: false }
}
