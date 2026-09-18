import type { RenderNode } from '@studio/shared'

export type RenderGroups = ReadonlyMap<string, RenderNode[]>
export interface PresentNode {
  readonly node: RenderNode
  readonly groups: RenderGroups
  readonly exiting: boolean
  readonly exitToken?: object
}

/** Keep a bounded snapshot of a removed subtree until its exit completes. */
export function reconcilePresence(previous: readonly PresentNode[], nodes: readonly RenderNode[], groups: RenderGroups, animate: boolean): PresentNode[] {
  const next: PresentNode[] = nodes.map(node => ({ node, groups, exiting: false }))
  if (!animate) return next
  const live = new Set(nodes.map(node => node.id))
  let retained = 0
  for (const entry of previous) {
    const duration = entry.node.transition?.duration ?? 0
    if (live.has(entry.node.id) || duration <= 0 || !Number.isFinite(duration) || duration > 2 || retained >= 64) continue
    // Snapshot size is bounded separately from runtime construction limits.
    let count = 0
    const pending = [entry.node.id], seen = new Set<string>()
    while (pending.length && count <= 256) {
      const id = pending.pop()!
      if (seen.has(id)) continue
      seen.add(id); count++
      pending.push(...(entry.groups.get(id) ?? []).map(child => child.id))
    }
    if (count > 256) continue
    next.push({ ...entry, exiting: true, exitToken: entry.exiting ? entry.exitToken : {} })
    retained++
  }
  return next
}

/** Completion from an interrupted exit must not remove a live replacement. */
export function finishExit(entries: readonly PresentNode[], id: string, token: object): PresentNode[] {
  return entries.filter(entry => entry.node.id !== id || !entry.exiting || entry.exitToken !== token)
}
