import type { Project } from '@studio/project-model'
import { STUDIO_BUILD } from './build'

/**
 * What the studio can still do for somebody once part of it has crashed.
 *
 * Loaded with the page rather than with the studio, so it works when the studio's own
 * code is what failed. It never imports the store: the store registers itself here
 * when it loads (`registerLiveWork`), so a crash that happens before - or instead of -
 * that still finds whatever the browser has saved.
 */

/** The work a running studio holds, including edits the autosave has not written yet. */
export interface LiveWork {
  project(): Project | null
  /** Writes pending edits; resolves to why they could not be saved, or null. */
  flush(): Promise<string | null>
  /**
   * The project as an editable archive. Supplied by the studio rather than imported
   * here: loading the exporter from the page would bundle a second copy of everything
   * it needs, which the studio already carries.
   */
  archive(project: Project): Promise<Uint8Array>
}

let live: LiveWork | null = null

export function registerLiveWork(work: LiveWork): void {
  live = work
}

export type DownloadOutcome = 'archive' | 'backup' | 'nothing'

/**
 * Hands the participant their latest work as a file, and never fails to try.
 *
 * The editable archive is the file to reopen later. If it cannot be built - the
 * studio's code never loaded, or the project does not validate - the same project goes
 * out as a plain JSON backup instead, because a copy in the wrong format beats none.
 */
export async function downloadLatestWork(): Promise<DownloadOutcome> {
  const project = live?.project() ?? await savedProject().catch(() => null)
  if (!project) return 'nothing'
  try {
    if (!live) throw new Error('The studio did not load, so there is nothing to build an archive with.')
    save(`${fileName(project)}.swiftstudio.zip`, 'application/zip', await live.archive(project))
    return 'archive'
  } catch {
    save(`${fileName(project)}.backup.json`, 'application/json', new TextEncoder().encode(JSON.stringify({ format: 'swift-web-studio-backup', build: STUDIO_BUILD, project }, bytesAsBase64)))
    return 'backup'
  }
}

/*
 * Where the store keeps projects - packages/project-model/src/stores.ts and
 * apps/web/lib/store.ts. Repeated rather than imported: importing either would load
 * the code whose failure this file exists to survive.
 */
const DATABASE = 'swiftui-web-studio'
const PROJECTS = 'projects'
const LAST_OPENED = 'studio.lastOpened'

/**
 * The saved project, read straight from IndexedDB, for when the store never loaded:
 * the one open last, or else the newest.
 */
async function savedProject(): Promise<Project | null> {
  const db = await openExisting()
  if (!db) return null
  try {
    if (!db.objectStoreNames.contains(PROJECTS)) return null
    const projects = db.transaction(PROJECTS, 'readonly').objectStore(PROJECTS)
    let wanted: string | null = null
    try { wanted = localStorage.getItem(LAST_OPENED) } catch { /* blocked storage: fall through to the newest */ }
    const last = wanted ? await settled(projects.get(wanted)) : undefined
    if (last) return last as Project
    const newest = await settled(projects.index('updatedAt').openCursor(null, 'prev'))
    return (newest?.value as Project | undefined) ?? null
  } finally {
    db.close()
  }
}

/**
 * Opens the studio's database only if it exists.
 *
 * Opened without a version, a missing database would be created empty - and the
 * store's own later open, finding version 1 already there, would never create its
 * tables, so every save after that would fail. Aborting the upgrade creates nothing.
 */
function openExisting(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    let request: IDBOpenDBRequest
    try { request = indexedDB.open(DATABASE) } catch { return resolve(null) }
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export type LeaveOutcome = 'left' | 'unsaved'

/**
 * Reloads the page, after saving what the studio still holds.
 *
 * Nothing else writes those edits any more: the studio that saved on the way out has
 * unmounted. The save gets two seconds. If it fails, nothing reloads and the caller
 * says so - the participant downloads first, or chooses to reload anyway (`force`).
 *
 * `another` starts the next load without the project that was open, for a crash that
 * project's own content causes: reloading into it would only crash again.
 */
export async function leave(to: 'reload' | 'another', force = false): Promise<LeaveOutcome> {
  if (to === 'another') {
    try { sessionStorage.setItem(SAFE_START_KEY, String(Date.now())) } catch { /* then this is a plain reload */ }
  }
  const problem = live ? await Promise.race([live.flush().catch(() => 'The latest changes could not be saved.'), wait(2_000, 'Saving took too long.')]) : null
  if (problem && !force) {
    try { sessionStorage.removeItem(SAFE_START_KEY) } catch { /* nothing was set */ }
    return 'unsaved'
  }
  location.reload()
  return 'left'
}

const SAFE_START_KEY = 'studio.safeStart'
/** A safe start is for the load that follows the click, not one an hour later. */
const SAFE_START_MS = 2 * 60_000

/** Whether this load should skip the project that was open. Asking clears the request. */
export function takeSafeStart(): boolean {
  try {
    const at = Number(sessionStorage.getItem(SAFE_START_KEY))
    sessionStorage.removeItem(SAFE_START_KEY)
    return at > 0 && Date.now() - at < SAFE_START_MS
  } catch {
    return false
  }
}

function wait<T>(ms: number, value: T): Promise<T> {
  return new Promise(resolve => setTimeout(() => resolve(value), ms))
}

function fileName(project: Project): string {
  return project.manifest?.name?.replace(/[^A-Za-z0-9._-]+/g, '-') || 'Project'
}

/** Image bytes survive JSON as base64 rather than as an object with a key per byte. */
function bytesAsBase64(_key: string, value: unknown): unknown {
  if (!(value instanceof Uint8Array)) return value
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return { base64: btoa(binary) }
}

/**
 * Saves a file through the browser's download.
 *
 * The object URL is revoked a minute later rather than at once: Safari can still be
 * reading it after `click()` returns, and a revoked URL is a download that never
 * arrives.
 */
function save(name: string, type: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Whether a window error or unhandled rejection is worth telling somebody about.
 *
 * Render errors land in a panel's fallback; these are the rest - event handlers,
 * timers, promises. Dropped: events with no error in them, which is how Chrome
 * reports a ResizeObserver loop and how a cross-origin script error arrives, and
 * cancellations, which are something the studio chose to do.
 */
export function isReportable(event: ErrorEvent | PromiseRejectionEvent): boolean {
  if (event.type === 'error') return (event as ErrorEvent).error != null
  const reason = (event as PromiseRejectionEvent).reason
  return !(reason instanceof DOMException && reason.name === 'AbortError')
}

/** The sessionStorage key a test sets to make part of the studio throw while it renders. */
export const TEST_CRASH_KEY = 'studio.test.crash'

/**
 * Throws while rendering when a test asked this part of the studio to crash.
 *
 * The value names parts - `canvas`, `settings`, `app`, `document` for the error
 * screen itself - separated by commas, each optionally for one project only
 * (`app@p-…`). Nothing sets it outside the recovery tests, so for everybody else this
 * is one sessionStorage read per render.
 */
export function crashIfTesting(part: string, projectId?: string): void {
  let wanted: string | null = null
  try { wanted = sessionStorage.getItem(TEST_CRASH_KEY) } catch { return }
  if (!wanted) return
  for (const entry of wanted.split(',')) {
    const [name, project] = entry.trim().split('@')
    if (name === part && (!project || project === projectId)) throw new Error(`Test crash: ${entry}`)
  }
}
