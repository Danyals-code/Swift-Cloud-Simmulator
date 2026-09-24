import type { Project } from '@studio/project-model'
import { projectBackup } from '@studio/project-model/backup'
import { PROJECT_DATABASE, PROJECTS, PROJECTS_BY_UPDATE } from '@studio/project-model/storage-names'
import { STUDIO_BUILD } from './build'
import { lastOpenedId } from './lastOpened'

/**
 * What the studio can still do for somebody once part of it has crashed.
 *
 * Loaded with the page rather than with the studio, so it works when the studio's own
 * code is what failed. It never imports the store: the store registers itself here
 * when it loads (`registerLiveWork`), so a crash that happens before - or instead of -
 * that still finds whatever the browser has saved.
 */

/** The parts of the studio that keep a crash to themselves. */
export type PaneArea = 'canvas' | 'preview' | 'settings' | 'navigator' | 'editor'

/** Where somebody goes from a crash: the same project again, or a start without it. */
export type Destination = 'reload' | 'another'

/** What happens on a recovery surface, for the studio's event log. */
export type RecoveryEvent =
  | { readonly action: 'crashed'; readonly area: PaneArea | 'studio' | 'page' }
  | { readonly action: 'downloaded'; readonly outcome: DownloadOutcome }
  | { readonly action: 'left'; readonly to: Destination }

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
  /** Writes what happened here into the event log, which lives with the studio. */
  record(event: RecoveryEvent): void
}

let live: LiveWork | null = null

export function registerLiveWork(work: LiveWork): void {
  live = work
}

/** Tells the event log what happened here, when the studio is there to keep one. */
export function noteRecovery(event: RecoveryEvent): void {
  try { live?.record(event) } catch { /* the log never stands in the way of recovering */ }
}

export type DownloadOutcome = 'archive' | 'backup' | 'nothing'

/**
 * Hands the participant their latest work as a file, and never fails to try.
 *
 * The editable archive is the file to reopen later. If it cannot be built - the
 * studio's code never loaded, or the project does not validate - the same project goes
 * out as a plain JSON backup instead, because a copy in the wrong format beats none.
 * The backup holds the record exactly as stored; nothing in the studio opens it again.
 */
export async function downloadLatestWork(): Promise<DownloadOutcome> {
  const outcome = await download()
  noteRecovery({ action: 'downloaded', outcome })
  return outcome
}

async function download(): Promise<DownloadOutcome> {
  const project = live?.project() ?? await savedProject().catch(() => null)
  if (!project) return 'nothing'
  try {
    if (!live) throw new Error('The studio did not load, so there is nothing to build an archive with.')
    saveFile(`${fileName(project)}.swiftstudio.zip`, 'application/zip', await live.archive(project))
    return 'archive'
  } catch {
    saveFile(`${fileName(project)}.backup.json`, 'application/json', new TextEncoder().encode(projectBackup(project, STUDIO_BUILD)))
    return 'backup'
  }
}

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
    const wanted = lastOpenedId()
    const last = wanted ? await resultOf(projects.get(wanted)) : undefined
    if (last) return last as Project
    const newest = await resultOf(projects.index(PROJECTS_BY_UPDATE).openCursor(null, 'prev'))
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
    try { request = indexedDB.open(PROJECT_DATABASE) } catch { return resolve(null) }
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function resultOf<T>(request: IDBRequest<T>): Promise<T> {
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
export async function leave(to: Destination, force = false): Promise<LeaveOutcome> {
  noteRecovery({ action: 'left', to })
  if (to === 'another') {
    try { sessionStorage.setItem(SAFE_START_KEY, String(Date.now())) } catch { /* then this is a plain reload */ }
  }
  const problem = live ? await Promise.race([live.flush().catch(() => 'The latest changes could not be saved.'), wait(2_000, 'Saving took too long.')]) : null
  if (problem && !force) {
    try { sessionStorage.removeItem(SAFE_START_KEY) } catch { /* nothing was set */ }
    return 'unsaved'
  }
  leaving = true
  location.reload()
  return 'left'
}

let leaving = false

/** Whether this page is reloading because somebody chose to here - so the browser need not ask again. */
export function leavingOnPurpose(): boolean {
  return leaving
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

/**
 * Saves a file through the browser's download: the recovery screen's and every export's.
 *
 * The object URL is freed a minute later rather than at once. Freeing it at once works
 * in the browsers the tests run, but these are the files somebody's work ends up in,
 * and waiting costs nothing.
 */
export function saveFile(name: string, type: string, bytes: Uint8Array): void {
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
 * The value names parts - a panel, `app` for the whole studio, `document` for the
 * error screen itself - separated by commas, each optionally for one project only
 * (`app@p-…`). Nothing sets it outside the recovery tests, so for everybody else this
 * is one sessionStorage read per render.
 */
export function crashIfTesting(part: PaneArea | 'app' | 'document', projectId?: string): void {
  let wanted: string | null = null
  try { wanted = sessionStorage.getItem(TEST_CRASH_KEY) } catch { return }
  if (!wanted) return
  for (const entry of wanted.split(',')) {
    const [name, project] = entry.trim().split('@')
    if (name === part && (!project || project === projectId)) throw new Error(`Test crash: ${entry}`)
  }
}
