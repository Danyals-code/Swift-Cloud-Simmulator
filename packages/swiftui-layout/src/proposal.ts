
/**
 * The SwiftUI layout protocol.
 *
 * Pinned in Phase 0, before the engine existed, so that nothing downstream could be
 * built against a CSS-shaped assumption. The engine in `engine.ts` implements it.
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
