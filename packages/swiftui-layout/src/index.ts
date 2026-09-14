import type { Rect, Size } from '@studio/shared'

/**
 * The SwiftUI layout protocol.
 *
 * Defined in Phase 0 even though the engine itself lands in Phase 3, because this
 * is the interface the whole architecture turns on and pinning it early stops
 * anything else being built against a CSS-shaped assumption.
 *
 * SwiftUI layout is a negotiation, not a cascade:
 *
 *   1. A parent *proposes* a size to each child.
 *   2. Each child *responds* with the size it actually wants.
 *   3. The parent *places* children within its own bounds.
 *
 * A proposed dimension has three meanings, and conflating them is the single
 * most common way a SwiftUI emulator goes wrong:
 *
 *   number      "here is a concrete amount of space"
 *   null        "what is your ideal size?"          (`nil` in SwiftUI)
 *   'infinity'  "take as much as you like"
 *
 * `Spacer` responds `'infinity'`-greedily, `Text` responds with its ideal size
 * unless squeezed, and `.frame(maxWidth: .infinity)` changes the *proposal* passed
 * down rather than the response passed up. CSS flexbox resolves a different
 * algorithm and diverges on exactly these cases — see decision D2 in
 * docs/02-ARCHITECTURE.md §12.
 */

export type ProposedDimension = number | null | 'infinity'

export interface ProposedSize {
  readonly width: ProposedDimension
  readonly height: ProposedDimension
}

export const PROPOSE_IDEAL: ProposedSize = { width: null, height: null }
export const PROPOSE_INFINITY: ProposedSize = { width: 'infinity', height: 'infinity' }
export const PROPOSE_ZERO: ProposedSize = { width: 0, height: 0 }

export function proposeSize(width: ProposedDimension, height: ProposedDimension): ProposedSize {
  return { width, height }
}

/**
 * Resolve a proposed dimension to a concrete number.
 *
 * `ideal` is used for `null`; `max` bounds `'infinity'`. Callers that genuinely
 * want unbounded growth pass `Number.POSITIVE_INFINITY` as `max`.
 */
export function resolveDimension(d: ProposedDimension, ideal: number, max: number): number {
  if (d === null) return ideal
  if (d === 'infinity') return max
  return d
}

/** Memoisation key for `(node, proposal)` pairs; sizing is called a lot. */
export function proposalKey(p: ProposedSize): string {
  return `${p.width ?? 'i'}x${p.height ?? 'i'}`
}

export interface PlacedNode {
  readonly id: string
  readonly frame: Rect
}

/**
 * Implemented by every layout participant in Phase 3.
 *
 * `cache` is per-pass scratch space; `sizeThatFits` must be pure with respect to
 * `(node, proposal)` so results can be memoised across the measure and place
 * passes without recomputation.
 */
export interface LayoutNode {
  readonly id: string
  sizeThatFits(proposal: ProposedSize, cache: LayoutCache): Size
  place(bounds: Rect, cache: LayoutCache): readonly PlacedNode[]
}

export class LayoutCache {
  private readonly sizes = new Map<string, Size>()

  get(nodeId: string, proposal: ProposedSize): Size | undefined {
    return this.sizes.get(`${nodeId}|${proposalKey(proposal)}`)
  }

  set(nodeId: string, proposal: ProposedSize, size: Size): Size {
    this.sizes.set(`${nodeId}|${proposalKey(proposal)}`, size)
    return size
  }

  get size(): number {
    return this.sizes.size
  }

  clear(): void {
    this.sizes.clear()
  }
}

// TODO(phase 3): VStack/HStack/ZStack/Spacer/frame/padding implementations, the
// TextMetrics port, and the flattening pass that turns placed nodes into a RenderTree.
