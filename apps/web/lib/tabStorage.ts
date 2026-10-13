/**
 * This tab's sessionStorage, or null where there is none or the browser refuses it.
 *
 * What goes in it lasts until the tab closes, and no other tab sees it. Reading it can
 * throw, in a private window or with storage blocked, which is why it is asked for here
 * rather than named directly.
 */
export function tabStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** The JSON kept under `key`, or null when there is none or it cannot be read. */
export function readKept(storage: Storage | null, key: string): unknown {
  try {
    const kept = storage?.getItem(key)
    return kept ? JSON.parse(kept) : null
  } catch {
    return null
  }
}

/** Keeps `value` as JSON under `key`, or does nothing when the storage refuses it. */
export function keep(storage: Storage | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value))
  } catch {
    // A full or refused storage leaves what was kept before.
  }
}

/** Forgets what is kept under `key`. */
export function forgetKept(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key)
  } catch {
    // Nothing kept that can be reached.
  }
}
