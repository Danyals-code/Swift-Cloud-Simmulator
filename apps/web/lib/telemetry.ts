import type { CompileResult, Diagnostic } from '@studio/shared'
import { UNIMPLEMENTED_MODIFIERS, UNIMPLEMENTED_VIEWS } from '@studio/swift-sema'

/**
 * Coverage telemetry - what people actually write that the preview cannot draw.
 *
 * The roadmap's Phase 6 rule is that breadth is driven by telemetry rather than by
 * guesswork, and this is the instrument. Every unsupported view, modifier and
 * language feature the compiler reports is counted, and the ranking is what the
 * coverage backlog should be ordered by.
 *
 * **It never leaves the browser.** There is no endpoint and no account (decision:
 * local-only storage), so this is telemetry in the literal sense - a measurement
 * surfaced to the person being measured. That is also why it is a visible panel
 * rather than a background collector: data gathered about someone should be data
 * they can read.
 *
 * Counting is per *distinct set*, not per compile. A compile runs on almost every
 * keystroke, so counting those would rank features by how long you spent typing near
 * them. Incrementing only when the set of unsupported features changes approximates
 * "times you reached for this and it was not there", which is the question the
 * backlog actually wants answered.
 */

const STORAGE_KEY = 'studio.coverage.v1'

export type CoverageKind = 'view' | 'modifier' | 'language'

export interface CoverageEntry {
  readonly feature: string
  readonly kind: CoverageKind
  readonly count: number
  /** Epoch milliseconds. */
  readonly lastSeen: number
  /** False when the name is not in the preview's tables at all - a discovery. */
  readonly recognised: boolean
}

type Store = Record<string, { kind: CoverageKind; count: number; lastSeen: number }>

let store: Store | null = null
let lastSignature = ''
const listeners = new Set<() => void>()

function load(): Store {
  if (store) return store
  store = {}

  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') store = parsed as Store
    }
  } catch {
    // Private browsing, a cleared origin, or corrupt JSON. An empty ranking is a
    // perfectly good outcome; losing the editor over it is not.
  }

  return store
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(load()))
  } catch {
    // Storage full or blocked. The in-memory counts still work for this session.
  }
}

function kindOf(diagnostic: Diagnostic): CoverageKind | null {
  switch (diagnostic.code) {
    case 'unsupported_swiftui_view':
      return 'view'
    case 'unsupported_swiftui_modifier':
      return 'modifier'
    case 'unsupported_language_feature':
      return 'language'
    default:
      return null
  }
}

/**
 * Whether the preview recognises the feature by name.
 *
 * The distinction the ranking actually wants: a name the tables already carry is a
 * known gap, and a name they do not is something a user reached for that nobody had
 * written down - which is the whole reason to measure. It replaces a planned-phase
 * column whose numbers all said 7 and stopped being true after Phase 10.
 */
export function isRecognised(feature: string, kind: CoverageKind): boolean {
  if (kind === 'modifier') return UNIMPLEMENTED_MODIFIERS.has(feature.replace(/^\./, ''))
  if (kind === 'view') return UNIMPLEMENTED_VIEWS.has(feature)
  return true
}

/**
 * Records what one compile could not draw.
 *
 * Placeholder nodes are counted as well as diagnostics, because the two can diverge:
 * a view nested inside something the checker did not walk still reaches the screen as
 * a placeholder, and that is exactly the case worth knowing about.
 */
export function recordCoverage(result: CompileResult): void {
  const found = new Map<string, CoverageKind>()

  for (const diagnostic of result.diagnostics) {
    const kind = kindOf(diagnostic)
    if (kind && diagnostic.feature) found.set(diagnostic.feature, kind)
  }

  for (const node of result.renderTree?.nodes ?? []) {
    const feature = node.placeholder?.feature
    if (feature && !found.has(feature)) found.set(feature, 'view')
  }

  const signature = [...found.keys()].sort().join('')
  if (signature === lastSignature) return
  lastSignature = signature
  if (found.size === 0) return

  const current = load()
  const now = Date.now()
  for (const [feature, kind] of found) {
    const existing = current[feature]
    current[feature] = { kind, count: (existing?.count ?? 0) + 1, lastSeen: now }
  }

  persist()
  for (const listener of listeners) listener()
}

/** Every recorded feature, most-wanted first. */
export function coverageRanking(): CoverageEntry[] {
  return Object.entries(load())
    .map(([feature, entry]) => ({
      feature,
      kind: entry.kind,
      count: entry.count,
      lastSeen: entry.lastSeen,
      recognised: isRecognised(feature, entry.kind),
    }))
    .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature))
}

export function clearCoverage(): void {
  store = {}
  lastSignature = ''
  persist()
  for (const listener of listeners) listener()
}

export function subscribeCoverage(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Test seam: forget everything loaded from storage. */
export function resetCoverageCache(): void {
  store = null
  lastSignature = ''
}
