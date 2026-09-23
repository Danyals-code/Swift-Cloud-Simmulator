/**
 * One studio tab at a time (B1).
 *
 * Two tabs of the studio used to save side by side into one browser's storage, each
 * writing its whole copy over the other's, so the tab somebody merely looked at last
 * won. Now the tab that has the studio holds a Web Lock - which the browser lets go
 * of when the tab closes or crashes - and any other tab waits until somebody chooses
 * to use the studio there. Taking over asks the tab that has it to save and step
 * aside. One that does not answer, frozen in the background, has the lock taken from
 * it, and storage's revision check refuses anything it tries to write afterwards.
 *
 * Held at module scope rather than in a component, for the reason the store's first
 * load is: a remount must not queue this tab behind its own lock.
 */

export type TabState = 'checking' | 'active' | 'elsewhere'

const LOCK = 'swift-web-studio.studio'
const CHANNEL = 'swift-web-studio.tabs'
const TAKE_OVER = 'take-over'
/** How long the tab with the studio has to save and let go before the lock is taken. */
const ANSWER_MS = 10_000
/** Set by "Use it here" in a tab that had the studio before, for the reload that follows. */
const TAKE_OVER_KEY = 'studio.takeOver'

let state: TabState = 'checking'
let started = false
/** Whether this page ever had the studio: if so, what it holds is out of date. */
let hadStudio = false
let letGo: (() => void) | null = null
let takeOver: () => Promise<void> = async () => {}
let stepAside: (save: boolean) => Promise<void> = async () => {}
const listeners = new Set<() => void>()

function become(next: TabState): void {
  if (next === 'active') hadStudio = true
  state = next
  for (const listener of listeners) listener()
}

export function subscribeStudioTab(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function studioTabState(): TabState {
  return state
}

/**
 * Claims the studio for this tab, or waits: once per page.
 *
 * `handOver` stops this tab writing - saving what it holds first when it is asked, but
 * not when the lock was taken from it, because by then its copy is the old one. Without
 * Web Locks - an old browser, an insecure origin - every tab has the studio, as before.
 */
export function startStudioTab(handOver: (save: boolean) => Promise<void>): void {
  if (started) return
  started = true
  stepAside = handOver
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return become('active')

  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
  channel?.addEventListener('message', (event: MessageEvent) => {
    const release = letGo
    if (event.data !== TAKE_OVER || state !== 'active' || !release) return
    letGo = null
    // The overlay goes up before the save, so nothing more is typed here meanwhile.
    become('elsewhere')
    void handOver(true).finally(release)
  })
  takeOver = async () => {
    // What a tab that had the studio holds is older than what the other tab has saved
    // since, so it starts again from storage rather than carrying on.
    if (hadStudio) {
      try { sessionStorage.setItem(TAKE_OVER_KEY, '1') } catch { /* then it asks again after the reload */ }
      location.reload()
      return
    }
    channel?.postMessage(TAKE_OVER)
    if (await hold(locks, { signal: timeout(ANSWER_MS) })) return
    await hold(locks, { steal: true })
  }

  let asked = false
  try { asked = sessionStorage.getItem(TAKE_OVER_KEY) !== null; sessionStorage.removeItem(TAKE_OVER_KEY) } catch { /* no session storage */ }
  if (asked) void takeOver()
  else void hold(locks, { ifAvailable: true }).then(held => { if (!held) become('elsewhere') })
}

/** Takes the studio from whichever tab has it, once that tab has saved. */
export function takeOverStudio(): Promise<void> {
  return takeOver()
}

/**
 * Asks for the lock and, once granted, keeps it until this tab hands the studio over.
 * Resolves whether it was granted. A lock taken from this tab rejects the request,
 * which is how a tab that was frozen in the background finds out it has lost it.
 */
function hold(locks: LockManager, options: LockOptions): Promise<boolean> {
  return new Promise<boolean>(granted => {
    locks.request(LOCK, options, lock => {
      granted(lock !== null)
      if (!lock) return
      become('active')
      return new Promise<void>(release => { letGo = release })
    }).catch(() => {
      granted(false)
      if (state !== 'active') return
      letGo = null
      become('elsewhere')
      void stepAside(false)
    })
  })
}

function timeout(ms: number): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}
