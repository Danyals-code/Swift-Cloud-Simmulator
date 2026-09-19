import { reconcileAuthoringSelection, type AuthoringNode, type AuthoringSnapshot, type DesignEditRequest, type SourceFile, type SourceSpan } from '@studio/shared'

/** Structural commands prove which identical sibling moved or was duplicated. */
export function reconcileLayerLabel(old: AuthoringNode, before: AuthoringSnapshot, after: AuthoringSnapshot, beforeFiles: readonly SourceFile[], afterFiles: readonly SourceFile[], operation: DesignEditRequest['operation'], target: SourceSpan, selectedOffset?: number): AuthoringNode | null {
  const comparable = (node: AuthoringNode) => node.owner === old.owner && node.name === old.name && node.kind === old.kind && node.fingerprint === old.fingerprint && node.source.file === old.source.file
  let previous = before.nodes.filter(comparable).sort((a, b) => a.source.start - b.source.start)
  let candidates = after.nodes.filter(comparable).sort((a, b) => a.source.start - b.source.start)
  if ((operation.kind === 'layer-duplicate' || operation.kind === 'insert') && selectedOffset !== undefined) {
    const copy = after.nodes.find(n => n.source.file === target.file && n.source.start === selectedOffset && n.kind !== 'definition')
    if (copy) candidates = candidates.filter(n => n.source.start < copy.source.start || n.source.end > copy.source.end)
  }
  if (operation.kind === 'layer-reparent') {
    const roots = before.nodes.filter(n => operation.ids.includes(n.id)), destination = before.nodes.find(n => n.id === operation.destination)
    const moving = previous.filter(n => roots.some(root => n.source.start >= root.source.start && n.source.end <= root.source.end))
    const remaining = previous.filter(n => !moving.includes(n))
    const insertion = destination ? remaining.findIndex(n => n.source.start >= destination.source.end) : -1
    remaining.splice(insertion < 0 ? remaining.length : insertion, 0, ...moving)
    previous = remaining
  }
  if (['layer-duplicate', 'layer-wrap', 'layer-reparent', 'insert'].includes(operation.kind) && previous.length === candidates.length) {
    const index = previous.findIndex(n => n.id === old.id)
    if (index >= 0) return candidates[index] ?? null
  }
  return reconcileAuthoringSelection({ snapshot: before, nodeId: old.id, files: beforeFiles }, after, afterFiles)
}
