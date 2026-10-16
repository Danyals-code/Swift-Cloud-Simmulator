import { isWithin, type AnimationSpec, type RenderNode, type TransitionPart, type TransitionSpec, type TreeAnimation } from '@studio/shared'

export type RenderGroups = ReadonlyMap<string, RenderNode[]>

/** How a node comes in or goes: its transition's parts, timed by the change's animation (Wave 5a). */
export interface Passage {
  /** Keyframe names without their `studio-` prefix, as `transitionParts` gives them. */
  readonly parts: readonly string[]
  readonly animation: AnimationSpec
}

export interface PresentNode {
  readonly node: RenderNode
  readonly groups: RenderGroups
  readonly exiting: boolean
  readonly exitToken?: object
  /** How it came in, kept from the frame that put it there, so a later frame doesn't restart it. */
  readonly entry?: Passage
  /** How it goes. */
  readonly exit?: Passage
}

/** What a node is told apart from its siblings by: its key, or its id where it has none (Wave 5a). */
export const keyOf = (node: RenderNode): string => node.key ?? node.id

/**
 * The nodes of a group as they are drawn: the new ones, and the old ones still leaving.
 *
 * As on iOS, a node comes in with its transition (a fade when it has none) only when the
 * frame that adds it is animated, which the node says by carrying an `animation`, and a
 * node goes with its transition only when `animated` covers it. A removed subtree is kept
 * as a bounded, inert snapshot until its exit completes, and dropped on reentry.
 */
export function reconcilePresence(previous: readonly PresentNode[], nodes: readonly RenderNode[], groups: RenderGroups, animate: boolean, animated?: TreeAnimation): PresentNode[] {
  if (!animate) return nodes.map(node => ({ node, groups, exiting: false }))
  const before = new Map<string, PresentNode>()
  for (const entry of previous) before.set(keyOf(entry.node), entry)
  const next: PresentNode[] = nodes.map(node => {
    const was = before.get(keyOf(node))
    const entry = was && !was.exiting ? was.entry : node.animation ? passage(node.transition, 'in', node.animation) : undefined
    return entry ? { node, groups, exiting: false, entry } : { node, groups, exiting: false }
  })
  const live = new Set(nodes.map(keyOf))
  let retained = 0
  for (const entry of previous) {
    const key = keyOf(entry.node)
    if (live.has(key) || retained >= 64) continue
    if (entry.exiting) {
      next.push(entry)
      retained++
      continue
    }
    const animation = changeAnimation(animated, key)
    const exit = animation && animation.duration > 0 && animation.duration <= 10 ? passage(entry.node.transition, 'out', animation) : undefined
    if (!exit) continue
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
    next.push({ ...entry, exiting: true, exitToken: {}, exit })
    retained++
  }
  return next
}

/** How a node comes in or goes with `animation`, or undefined where its transition plays nothing, as `.identity` (Wave 5a). */
function passage(transition: TransitionSpec | undefined, direction: 'in' | 'out', animation: AnimationSpec): Passage | undefined {
  const parts = transitionParts(transition, direction)
  return parts.length ? { parts, animation } : undefined
}

/** The animation of the change that removed the node keyed `key`, if it was animated (Wave 5a). */
function changeAnimation(animated: TreeAnimation | undefined, key: string): AnimationSpec | undefined {
  for (const scope of animated?.under ?? []) if (isWithin(key, scope.key)) return scope.animation
  return animated?.all
}

const OPPOSITE = { top: 'bottom', bottom: 'top', leading: 'trailing', trailing: 'leading' } as const

/**
 * What a transition plays coming `in` or going `out`, as keyframe names (see
 * `TransitionKeyframes`): a fade when there is no transition, the removal side of an
 * asymmetric one going out, and every part `.combined(with:)` adds.
 */
export function transitionParts(transition: TransitionSpec | undefined, direction: 'in' | 'out'): string[] {
  if (!transition) return ['opacity']
  const parts = new Set<string>()
  const add = (part: TransitionPart) => {
    switch (part.kind) {
      case 'opacity': parts.add('opacity'); break
      case 'scale': parts.add('scale'); break
      case 'blur': parts.add('blur').add('opacity'); break
      case 'slide': parts.add(direction === 'in' ? 'move-leading' : 'move-trailing'); break
      case 'move': parts.add(`move-${part.edge ?? 'bottom'}`); break
      case 'push': {
        const edge = part.edge ?? 'trailing'
        parts.add(`move-${direction === 'in' ? edge : OPPOSITE[edge]}`).add('opacity')
      }
    }
    // `identity` adds nothing of its own.
    for (const also of part.also ?? []) add(also)
  }
  add(direction === 'out' && transition.removal ? transition.removal : transition)
  return [...parts]
}

/** Completion from an interrupted exit must not remove a live replacement. */
export function finishExit(entries: readonly PresentNode[], key: string, token: object): PresentNode[] {
  return entries.filter(entry => keyOf(entry.node) !== key || !entry.exiting || entry.exitToken !== token)
}
