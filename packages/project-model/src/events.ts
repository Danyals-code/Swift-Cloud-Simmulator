import { openDB } from 'idb'
import { databaseRequests, type DatabaseRequest, type OpenDatabase } from './connection'

/**
 * Where the browser keeps the event log: what somebody did in the studio, in order,
 * for each project.
 *
 * The storage knows nothing of what an event says. It keeps them in the order they
 * were written, under the project they belong to.
 */
export interface EventStore<Event> {
  /** Adds events to the end of a project's log, and counts others that were left out. */
  append(project: string, events: readonly Event[], dropped: number): Promise<void>
  /** The project's events, in the order they were written, and how many were left out. */
  read(project: string): Promise<EventRecord<Event>>
  /** How many events the project has. */
  count(project: string): Promise<number>
  /** Gives every event of one project to another, each keeping its place in the order written. */
  move(from: string, to: string): Promise<void>
  /** Forgets a project's events. */
  remove(project: string): Promise<void>
}

export interface EventRecord<Event> {
  readonly events: readonly Event[]
  readonly dropped: number
}

/** In-memory events. Used by unit tests and as the fallback when IndexedDB is unavailable. */
export class MemoryEventStore<Event> implements EventStore<Event> {
  /** Every project's events in one list, in the order written, as IndexedDB keeps them. */
  private records: { project: string; event: Event }[] = []
  private readonly dropped = new Map<string, number>()

  async append(project: string, events: readonly Event[], dropped: number): Promise<void> {
    for (const event of events) this.records.push({ project, event: structuredClone(event) })
    if (dropped > 0) this.dropped.set(project, (this.dropped.get(project) ?? 0) + dropped)
  }

  async read(project: string): Promise<EventRecord<Event>> {
    const events = this.records.filter(record => record.project === project).map(record => structuredClone(record.event))
    return { events, dropped: this.dropped.get(project) ?? 0 }
  }

  async count(project: string): Promise<number> {
    return this.records.filter(record => record.project === project).length
  }

  async move(from: string, to: string): Promise<void> {
    for (const record of this.records) if (record.project === from) record.project = to
    const dropped = this.dropped.get(from)
    this.dropped.delete(from)
    if (dropped) this.dropped.set(to, (this.dropped.get(to) ?? 0) + dropped)
  }

  async remove(project: string): Promise<void> {
    this.records = this.records.filter(record => record.project !== project)
    this.dropped.delete(project)
  }
}

/**
 * A database of its own rather than a table in the projects' one: a new table needs a
 * new version of that database, which waits for every tab still open on the old one.
 */
export const EVENT_DATABASE = 'swiftui-web-studio-events'
/** Every project's events, keyed in the order written, and found by project. */
const EVENTS = 'events'
const BY_PROJECT = 'project'
/** How many events each project left out. */
const DROPPED = 'dropped'

interface EventRow<Event> { readonly project: string; readonly event: Event }
interface DroppedRow { readonly project: string; readonly count: number }

export class IndexedDbEventStore<Event> implements EventStore<Event> {
  private readonly request: DatabaseRequest

  constructor(open: OpenDatabase = openDB) {
    this.request = databaseRequests(open, EVENT_DATABASE, 1, (db) => {
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { autoIncrement: true }).createIndex(BY_PROJECT, 'project')
      if (!db.objectStoreNames.contains(DROPPED)) db.createObjectStore(DROPPED, { keyPath: 'project' })
    })
  }

  append(project: string, events: readonly Event[], dropped: number): Promise<void> {
    return this.request(async (db) => {
      const transaction = db.transaction([EVENTS, DROPPED], 'readwrite')
      const table = transaction.objectStore(DROPPED)
      await Promise.all([
        ...events.map(event => transaction.objectStore(EVENTS).add({ project, event } satisfies EventRow<Event>)),
        dropped > 0 && table.get(project).then((row?: DroppedRow) => table.put({ project, count: (row?.count ?? 0) + dropped } satisfies DroppedRow)),
        transaction.done,
      ])
    })
  }

  read(project: string): Promise<EventRecord<Event>> {
    return this.request(async (db) => {
      const transaction = db.transaction([EVENTS, DROPPED])
      const [rows, dropped] = await Promise.all([
        transaction.objectStore(EVENTS).index(BY_PROJECT).getAll(project) as Promise<EventRow<Event>[]>,
        transaction.objectStore(DROPPED).get(project) as Promise<DroppedRow | undefined>,
      ])
      return { events: rows.map(row => row.event), dropped: dropped?.count ?? 0 }
    })
  }

  count(project: string): Promise<number> {
    return this.request((db) => db.countFromIndex(EVENTS, BY_PROJECT, project))
  }

  move(from: string, to: string): Promise<void> {
    return this.request(async (db) => {
      const transaction = db.transaction([EVENTS, DROPPED], 'readwrite')
      for (let cursor = await transaction.objectStore(EVENTS).index(BY_PROJECT).openCursor(from); cursor; cursor = await cursor.continue()) {
        await cursor.update({ ...cursor.value, project: to })
      }
      const table = transaction.objectStore(DROPPED)
      const [moved, kept] = await Promise.all([table.get(from), table.get(to)]) as (DroppedRow | undefined)[]
      if (moved) await Promise.all([table.delete(from), table.put({ project: to, count: moved.count + (kept?.count ?? 0) } satisfies DroppedRow)])
      await transaction.done
    })
  }

  remove(project: string): Promise<void> {
    return this.request(async (db) => {
      const transaction = db.transaction([EVENTS, DROPPED], 'readwrite')
      for (let cursor = await transaction.objectStore(EVENTS).index(BY_PROJECT).openCursor(project); cursor; cursor = await cursor.continue()) {
        await cursor.delete()
      }
      await Promise.all([transaction.objectStore(DROPPED).delete(project), transaction.done])
    })
  }
}

let theStore: EventStore<unknown> | null = null

/**
 * The event storage for this browser: IndexedDB, or memory where there is none.
 *
 * One instance, for the reason `createProjectStore` gives. A test that wants one of
 * its own constructs `MemoryEventStore`.
 */
export function createEventStore<Event>(): EventStore<Event> {
  try {
    theStore ??= typeof indexedDB === 'undefined' ? new MemoryEventStore() : new IndexedDbEventStore()
  } catch {
    theStore = new MemoryEventStore()
  }
  return theStore as EventStore<Event>
}
