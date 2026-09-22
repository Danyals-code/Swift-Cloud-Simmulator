/**
 * Which project to reopen.
 *
 * In `localStorage` rather than in the database, because it is a fact about this
 * browser rather than about any project: reopening the last one is a preference, and
 * losing it costs one click on the welcome sheet.
 *
 * A module of its own so the page's recovery code can read it without loading the
 * store.
 */
const LAST_OPENED_KEY = 'studio.lastOpened'

export function rememberLastOpened(id: string): void {
  try {
    localStorage.setItem(LAST_OPENED_KEY, id)
  } catch {
    // Private windows and blocked site data. The sheet still lists everything.
  }
}

export function lastOpenedId(): string | null {
  try {
    return localStorage.getItem(LAST_OPENED_KEY)
  } catch {
    return null
  }
}
