import { openDB, type IDBPDatabase } from 'idb'
import { normalizeProject, summarize, type Project, type ProjectStore, type ProjectSummary } from './types'

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

const DB_NAME = 'swiftui-web-studio'
const DB_VERSION = 1
const STORE = 'projects'

/** In-memory store. Used by unit tests and as the fallback when IndexedDB is unavailable. */
export class MemoryProjectStore implements ProjectStore {
  private readonly projects = new Map<string, Project>()

  async list(): Promise<readonly ProjectSummary[]> {
    return [...this.projects.values()].sort(byRecency).map(summarize)
  }

  async load(id: string): Promise<Project | null> {
    const project = this.projects.get(id)
    return project ? structuredClone(normalizeProject(project)) : null
  }

  async save(project: Project): Promise<void> {
    this.projects.set(project.id, structuredClone(normalizeProject(project)))
  }

  async remove(id: string): Promise<void> {
    this.projects.delete(id)
  }
}

export class IndexedDbProjectStore implements ProjectStore {
  private db: Promise<IDBPDatabase> | null = null

  /**
   * Opens the database, and forgets a failed attempt.
   *
   * Caching the promise is right; caching a *rejected* one is not. A single blocked
   * open - a version upgrade held by another tab, a browser that turns IndexedDB off
   * mid-session - used to be remembered for the life of the page, so every later save
   * reused the same rejection and the user's work stopped being written with nothing
   * on screen to say so.
   */
  private connect(): Promise<IDBPDatabase> {
    this.db ??= openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('updatedAt', 'updatedAt')
        }
      },
    }).catch((error: unknown) => {
      this.db = null
      throw error
    })
    return this.db
  }

  async list(): Promise<readonly ProjectSummary[]> {
    const db = await this.connect()
    const all = (await db.getAll(STORE)) as Project[]
    return all.sort(byRecency).map(summarize)
  }

  async load(id: string): Promise<Project | null> {
    const db = await this.connect()
    const project = (await db.get(STORE, id)) as Project | undefined
    return project ? normalizeProject(project) : null
  }

  async save(project: Project): Promise<void> {
    const db = await this.connect()
    // structuredClone strips the readonly-ness IDB cannot serialise around.
    await db.put(STORE, structuredClone(normalizeProject(project)))
  }

  async remove(id: string): Promise<void> {
    const db = await this.connect()
    await db.delete(STORE, id)
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
