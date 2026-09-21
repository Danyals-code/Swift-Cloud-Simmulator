import type { AuthoringNode } from './authoring'

export const LAYER_MOVE_CONTAINERS: ReadonlySet<string> = new Set(['VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack', 'Group', 'ScrollView'])

/** Structural eligibility shared by the picker, drag targets, and source writer.
 * The writer additionally checks syntax, adjacency, and local bindings. */
export function layerMoveProblem(nodes: readonly AuthoringNode[], ids: readonly string[], destination: AuthoringNode): string | null {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const selected = ids.map(id => byId.get(id))
  const first = selected[0]
  if (!first || selected.some(node => !node || !['view', 'component', 'collection'].includes(node.kind) || node.name === 'WindowGroup' || node.parentId !== first.parentId || node.owner !== first.owner || node.source.file !== first.source.file)) return 'Select layers with the same parent.'
  if (!['view', 'collection'].includes(destination.kind) || !LAYER_MOVE_CONTAINERS.has(destination.name) || destination.owner !== first.owner || destination.source.file !== first.source.file) return 'Choose a layout container on this screen.'
  if (selected.some(node => node && destination.source.start >= node.source.start && destination.source.end <= node.source.end)) return 'A layer cannot be moved inside itself or its children.'
  const scope = (node: AuthoringNode) => {
    let parent = byId.get(node.parentId ?? '')
    while (parent && !['definition', 'template', 'branch'].includes(parent.kind)) parent = byId.get(parent.parentId ?? '')
    return parent?.id
  }
  if (scope(first) !== scope(destination)) return 'Move within the same screen or repeated row to preserve its values and conditions.'
  if (byId.get(first.parentId ?? '')?.kind === 'definition') return 'The screen must keep its root layout.'
  const siblings = byId.get(first.parentId ?? '')?.children ?? []
  const positions = selected.map(node => siblings.indexOf(node!.id)).sort((a, b) => a - b)
  if (positions.some((position, index) => position < 0 || index > 0 && position !== positions[index - 1]! + 1)) return 'Select adjacent layers to keep their layout order predictable.'
  return null
}
