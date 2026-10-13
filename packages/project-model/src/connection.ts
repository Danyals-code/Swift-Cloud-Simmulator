import type { openDB, IDBPDatabase } from 'idb'

/** How a store opens its database: `idb`'s `openDB`, or a stand-in for a test. */
export type OpenDatabase = typeof openDB

/** Runs work on a connection to one of the browser's databases. */
export type DatabaseRequest = <T>(work: (db: IDBPDatabase) => Promise<T>) => Promise<T>

/**
 * Requests to one database, over a connection that is opened again when it is lost.
 *
 * Caching the connection is right; caching a *rejected* one is not. A single blocked
 * open - a version upgrade held by another tab, a browser that turns IndexedDB off
 * mid-session - used to be remembered for the life of the page, so every later save
 * reused the same rejection and the user's work stopped being written with nothing
 * on screen to say so. A connection the browser closes later is forgotten the same way.
 *
 * A request that fails runs once more on a new connection. Safari drops a connection
 * after a tab has sat in the background - "Connection to Indexed Database server lost" -
 * without closing it, and every request on it fails from then on, so the work stopped
 * being written until the page was reloaded. An error `isAnswer` recognises is a reply
 * rather than a lost connection, and is not tried again.
 */
export function databaseRequests(
  open: OpenDatabase,
  name: string,
  version: number,
  upgrade: (db: IDBPDatabase) => void,
  isAnswer: (error: unknown) => boolean = () => false,
): DatabaseRequest {
  let db: Promise<IDBPDatabase> | null = null

  const connect = (): Promise<IDBPDatabase> => {
    const connection = db ??= open(name, version, {
      upgrade,
      terminated: () => { if (db === connection) db = null },
    }).catch((error: unknown) => {
      db = null
      throw error
    })
    return connection
  }

  return async work => {
    const connection = connect()
    try {
      return await work(await connection)
    } catch (error) {
      if (isAnswer(error)) throw error
      if (db === connection) db = null
      void connection.then((opened) => opened.close(), () => {})
      return work(await connect())
    }
  }
}
