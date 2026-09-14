import { openDB, type IDBPDatabase } from 'idb'
import { summarize, type Project, type ProjectStore, type ProjectSummary } from './types'

const DB_NAME = 'swiftui-web-studio'
const DB_VERSION = 1
const STORE = 'projects'

/** In-memory store. Used by unit tests and as the fallback when IndexedDB is unavailable. */
export class MemoryProjectStore implements ProjectStore {
  private readonly projects = new Map<string, Project>()

  async list(): Promise<readonly ProjectSummary[]> {
    return [...this.projects.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(summarize)
  }

  async load(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null
  }

  async save(project: Project): Promise<void> {
    this.projects.set(project.id, project)
  }

  async remove(id: string): Promise<void> {
    this.projects.delete(id)
  }
}

export class IndexedDbProjectStore implements ProjectStore {
  private db: Promise<IDBPDatabase> | null = null

  private connect(): Promise<IDBPDatabase> {
    this.db ??= openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('updatedAt', 'updatedAt')
        }
      },
    })
    return this.db
  }

  async list(): Promise<readonly ProjectSummary[]> {
    const db = await this.connect()
    const all = (await db.getAll(STORE)) as Project[]
    return all.sort((a, b) => b.updatedAt - a.updatedAt).map(summarize)
  }

  async load(id: string): Promise<Project | null> {
    const db = await this.connect()
    return ((await db.get(STORE, id)) as Project | undefined) ?? null
  }

  async save(project: Project): Promise<void> {
    const db = await this.connect()
    // structuredClone strips the readonly-ness IDB cannot serialise around.
    await db.put(STORE, structuredClone(project))
  }

  async remove(id: string): Promise<void> {
    const db = await this.connect()
    await db.delete(STORE, id)
  }
}

/**
 * IndexedDB is unavailable in private windows in some browsers, and in SSR. Falling
 * back to memory keeps the editor usable rather than showing an error the user can
 * do nothing about — they just lose persistence for that session.
 */
export function createProjectStore(): ProjectStore {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryProjectStore()
    return new IndexedDbProjectStore()
  } catch {
    return new MemoryProjectStore()
  }
}
