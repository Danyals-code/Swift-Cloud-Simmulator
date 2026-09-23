import { openDB, type IDBPDatabase } from 'idb'
import { normalizeProject, summarize, type Project, type ProjectStore, type ProjectSummary } from './types'
import { PROJECT_DATABASE, PROJECTS, PROJECTS_BY_UPDATE } from './storage-names'

/**
 * The key every project used to be written to.
 *
 * It is not a default and was never the counter's: it was a single slot, so creating
 * from a template destroyed whatever was in it with no copy anywhere. Projects have
 * their own ids now, and this survives only so an install from before the change
 * still finds its work in the list.
 */
export const LEGACY_PROJECT_ID = 'counter-app'

/**
 * Newest first, and deterministic when two were touched together.
 *
 * `updatedAt` alone is not a total order: creating a project writes it in the same
 * millisecond as the one it replaced, and the tie then fell to whatever order the
 * storage happened to return - insertion order in memory, key order in IndexedDB.
 * Neither means anything to a person reading a list of their own work.
 */
function byRecency(a: Project, b: Project): number {
  return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}

const DB_VERSION = 1

/** A project as storage keeps it: with the number of times it has been written. */
type Stored = Project & { readonly revision?: number }

/** Why a save was refused: somebody else's copy is newer than this one. */
export class StaleProjectError extends Error {
  constructor() {
    super('This project was changed in another tab, so this tab’s copy was not saved. Reload to open the newer version.')
    this.name = 'StaleProjectError'
  }
}

/**
 * The revision a save writes, or a refusal.
 *
 * Every tab used to write its whole copy over whatever was stored, so two tabs on one
 * project took turns destroying each other's work - the one somebody merely looked at
 * last won. Each store now remembers the revision it last read or wrote, and a save
 * goes through only if that is still the one stored. A project gone from storage is
 * written back: it is open here, and deleting it elsewhere must not lose it.
 */
function nextRevision(stored: Stored | undefined, seen: number | undefined): number {
  if (!stored) return (seen ?? 0) + 1
  const current = stored.revision ?? 0
  if (seen !== current) throw new StaleProjectError()
  return current + 1
}

function withoutRevision(stored: Stored): Project {
  const { revision: _revision, ...project } = stored
  return project
}

/** In-memory store. Used by unit tests and as the fallback when IndexedDB is unavailable. */
export class MemoryProjectStore implements ProjectStore {
  readonly durable = false
  /** The revision of each project this store last read or wrote. */
  private readonly seen = new Map<string, number>()

  /** Two stores given the same map behave as two tabs over one browser's storage. */
  constructor(private readonly records: Map<string, Stored> = new Map()) {}

  async list(): Promise<readonly ProjectSummary[]> {
    return [...this.records.values()].sort(byRecency).map(summarize)
  }

  async load(id: string): Promise<Project | null> {
    const stored = this.records.get(id)
    if (!stored) return null
    this.seen.set(id, stored.revision ?? 0)
    return structuredClone(normalizeProject(withoutRevision(stored)))
  }

  async save(project: Project): Promise<void> {
    const record = structuredClone(normalizeProject(project))
    const revision = nextRevision(this.records.get(project.id), this.seen.get(project.id))
    this.records.set(project.id, { ...record, revision })
    this.seen.set(project.id, revision)
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id)
    this.seen.delete(id)
  }
}

/** How the store opens its database: `idb`'s `openDB`, or a stand-in for a test. */
export type OpenDatabase = typeof openDB

export class IndexedDbProjectStore implements ProjectStore {
  readonly durable = true
  private db: Promise<IDBPDatabase> | null = null
  /** The revision of each project this store last read or wrote. */
  private readonly seen = new Map<string, number>()

  constructor(private readonly open: OpenDatabase = openDB) {}

  /**
   * Opens the database, and forgets a failed attempt.
   *
   * Caching the promise is right; caching a *rejected* one is not. A single blocked
   * open - a version upgrade held by another tab, a browser that turns IndexedDB off
   * mid-session - used to be remembered for the life of the page, so every later save
   * reused the same rejection and the user's work stopped being written with nothing
   * on screen to say so. A connection the browser closes later is forgotten the same way.
   */
  private connect(): Promise<IDBPDatabase> {
    const connection = this.db ??= this.open(PROJECT_DATABASE, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PROJECTS)) {
          const store = db.createObjectStore(PROJECTS, { keyPath: 'id' })
          store.createIndex(PROJECTS_BY_UPDATE, 'updatedAt')
        }
      },
      terminated: () => { if (this.db === connection) this.db = null },
    }).catch((error: unknown) => {
      this.db = null
      throw error
    })
    return connection
  }

  /**
   * Runs a request, and runs it once more on a new connection if it fails.
   *
   * Safari drops a connection after a tab has sat in the background - "Connection to
   * Indexed Database server lost" - without closing it, and every request on it fails
   * from then on, so the work stopped being written until the page was reloaded. A
   * refused save is an answer rather than a lost connection, and is not tried again.
   */
  private async request<T>(work: (db: IDBPDatabase) => Promise<T>): Promise<T> {
    const connection = this.connect()
    try {
      return await work(await connection)
    } catch (error) {
      if (error instanceof StaleProjectError) throw error
      if (this.db === connection) this.db = null
      void connection.then((db) => db.close(), () => {})
      return work(await this.connect())
    }
  }

  async list(): Promise<readonly ProjectSummary[]> {
    const all = await this.request(async (db) => (await db.getAll(PROJECTS)) as Stored[])
    return all.sort(byRecency).map(summarize)
  }

  async load(id: string): Promise<Project | null> {
    const stored = await this.request(async (db) => (await db.get(PROJECTS, id)) as Stored | undefined)
    if (!stored) return null
    this.seen.set(id, stored.revision ?? 0)
    return normalizeProject(withoutRevision(stored))
  }

  async save(project: Project): Promise<void> {
    // structuredClone strips the readonly-ness IDB cannot serialise around.
    const record = structuredClone(normalizeProject(project))
    const revision = await this.request(async (db) => {
      // One transaction, so no other tab can write between the check and the write.
      const transaction = db.transaction(PROJECTS, 'readwrite')
      let next: number
      try {
        next = nextRevision((await transaction.store.get(project.id)) as Stored | undefined, this.seen.get(project.id))
      } catch (error) {
        try { transaction.abort() } catch { /* already finished */ }
        await transaction.done.catch(() => {})
        throw error
      }
      await Promise.all([transaction.store.put({ ...record, revision: next }), transaction.done])
      return next
    })
    this.seen.set(project.id, revision)
  }

  async remove(id: string): Promise<void> {
    await this.request((db) => db.delete(PROJECTS, id))
    this.seen.delete(id)
  }
}

let theStore: ProjectStore | null = null

/**
 * The store for this browser.
 *
 * IndexedDB is unavailable in private windows in some browsers, and in SSR. Falling
 * back to memory keeps the editor usable rather than showing an error the user can do
 * nothing about - they just lose persistence for that session.
 *
 * One instance, memoised. "The store" is a single thing, and handing out a fresh
 * *memory* store per call meant two callers in the fallback case quietly saw
 * different data - which is exactly the case where nothing else would notice. A test
 * that wants an isolated one constructs `MemoryProjectStore` directly.
 */
export function createProjectStore(): ProjectStore {
  if (theStore) return theStore

  try {
    theStore = typeof indexedDB === 'undefined' ? new MemoryProjectStore() : new IndexedDbProjectStore()
  } catch {
    theStore = new MemoryProjectStore()
  }
  return theStore
}
