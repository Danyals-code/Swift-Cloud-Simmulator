/**
 * What stands between the participant's work and this browser's storage, most urgent
 * first - or null when nothing does (B2, B3).
 *
 * One answer for everything that reports it - the banner, the label beside the project
 * name - so the two cannot disagree about which problem is showing.
 */
export type StorageProblem =
  /** Another tab has saved this project since: this copy cannot be saved, and a reload replaces it. */
  | { readonly kind: 'outdated' }
  /** Saves are failing, for the reason given; trying again may work. */
  | { readonly kind: 'failing'; readonly detail: string }
  /** The browser gave the studio nowhere to keep anything past the page. */
  | { readonly kind: 'memory' }
  /** The saved projects could not be read at launch, for the reason given. */
  | { readonly kind: 'unreadable'; readonly detail: string }

export function storageProblem({ saveError, saveOutdated, durable, loadError }: {
  readonly saveError: string | null
  readonly saveOutdated: boolean
  readonly durable: boolean
  readonly loadError: string | null
}): StorageProblem | null {
  if (saveError) return saveOutdated ? { kind: 'outdated' } : { kind: 'failing', detail: saveError }
  if (!durable) return { kind: 'memory' }
  if (loadError) return { kind: 'unreadable', detail: loadError }
  return null
}

/** Whether the latest changes are not in storage. */
export function unsaved(problem: StorageProblem | null): boolean {
  return problem?.kind === 'failing' || problem?.kind === 'outdated'
}

/** What ⌘S says once it has saved (D5), with the banner saying the rest. */
export function saveNote(problem: StorageProblem | null): string {
  if (unsaved(problem)) return 'Not saved. The note at the top of the page says why.'
  if (problem?.kind === 'memory') return 'Not saved: this browser keeps nothing once the tab closes. Download your project to keep it.'
  return 'Saved. Your work also saves as you go.'
}
