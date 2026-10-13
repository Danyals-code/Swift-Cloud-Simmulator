import { describe, expect, it } from 'vitest'
import { IndexedDbProjectStore, MemoryProjectStore } from './stores'
import { projectFromFiles } from './open'
import { withFileText, type Project, type ProjectStore } from './types'

const project = () => projectFromFiles([{ name: 'App.swift', text: 'import SwiftUI\n' }], 0)!
const edited = (from: Project, text: string) => withFileText(from, from.files[0]!.id, text)
const text = async (store: ProjectStore, id: string) => (await store.load(id))?.files[0]?.text

/**
 * Two tabs write to one browser's storage (B1).
 *
 * Each tab used to write its whole copy whenever it was hidden or shown, over whatever
 * the other had saved, so the tab somebody merely looked at last won. Two stores given
 * the same map stand for two tabs over the same storage.
 */
describe('two tabs over one storage', () => {
  it('refuses a save from a tab whose copy is older than what is stored, and keeps the newer work', async () => {
    const storage = new Map()
    const first = new MemoryProjectStore(storage), second = new MemoryProjectStore(storage)
    const original = project()
    await first.save(original)
    await second.load(original.id)
    await second.save(edited(original, '// newer, from the second tab'))

    await expect(first.save(edited(original, '// older, from the first tab'))).rejects.toThrow('changed in another tab')
    expect(await text(second, original.id)).toBe('// newer, from the second tab')
  })

  it('lets a tab go on saving its own changes', async () => {
    const store = new MemoryProjectStore(), original = project()
    await store.save(original)
    await store.save(edited(original, '// one'))
    await store.save(edited(original, '// two'))

    expect(await text(store, original.id)).toBe('// two')
  })

  it('lets a tab save again once it has read the newer copy', async () => {
    const storage = new Map()
    const first = new MemoryProjectStore(storage), second = new MemoryProjectStore(storage)
    const original = project()
    await first.save(original)
    await second.load(original.id)
    await second.save(edited(original, '// from the second tab'))

    const newer = (await first.load(original.id))!
    await first.save(edited(newer, '// from the first tab, after reading'))

    expect(await text(second, original.id)).toBe('// from the first tab, after reading')
  })

  it('refuses to write over a project this tab never read', async () => {
    const storage = new Map()
    const first = new MemoryProjectStore(storage), second = new MemoryProjectStore(storage)
    const original = project()
    await first.save(original)

    await expect(second.save(edited(original, '// blind'))).rejects.toThrow('changed in another tab')
    expect(await text(first, original.id)).toBe('import SwiftUI\n')
  })

  it('writes back the open project when another tab deleted it, rather than losing it', async () => {
    const storage = new Map()
    const first = new MemoryProjectStore(storage), second = new MemoryProjectStore(storage)
    const original = project()
    await first.save(original)
    await second.remove(original.id)

    await first.save(edited(original, '// still open here'))

    expect(await text(second, original.id)).toBe('// still open here')
  })
})

/**
 * Just enough of `idb` for the store, over a map that outlives its connections.
 *
 * A connection can be dropped the way Safari drops one after a tab sits in the
 * background - every request on it fails from then on - or closed with a word, which
 * is idb's `terminated`.
 */
function fakeIndexedDb({ everyConnectionLost = false } = {}) {
  const records = new Map<string, { id: string; revision?: number }>()
  let opened = 0
  let current: { alive: boolean; terminated?: () => void } | null = null
  const open = async (_name: string, _version: number, callbacks: { terminated?: () => void }) => {
    opened++
    const connection = { alive: !everyConnectionLost, terminated: callbacks.terminated }
    current = connection
    const request = <T>(work: () => T): Promise<T> => connection.alive
      ? Promise.resolve(structuredClone(work()))
      : Promise.reject(new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError'))
    return {
      getAll: () => request(() => [...records.values()]),
      get: (_store: string, id: string) => request(() => records.get(id)),
      delete: (_store: string, id: string) => request(() => { records.delete(id) }),
      close: () => { connection.alive = false },
      transaction: () => ({
        store: {
          get: (id: string) => request(() => records.get(id)),
          put: (value: { id: string }) => request(() => { records.set(value.id, structuredClone(value)) }),
        },
        done: Promise.resolve(),
        abort: () => {},
      }),
    }
  }
  return {
    open: open as unknown as ConstructorParameters<typeof IndexedDbProjectStore>[0],
    records,
    get opened() { return opened },
    drop() { if (current) current.alive = false },
    terminate() { if (current) { current.alive = false; current.terminated?.() } },
  }
}

describe('the IndexedDB store', () => {
  it('opens a connection the browser dropped again, and tries the save once more (B3)', async () => {
    const idb = fakeIndexedDb(), store = new IndexedDbProjectStore(idb.open), original = project()
    await store.save(original)
    idb.drop()

    await store.save(edited(original, '// after the connection was lost'))

    expect(idb.opened).toBe(2)
    expect(await text(store, original.id)).toBe('// after the connection was lost')
  })

  it('opens a new connection after the browser closes one and says so (B3)', async () => {
    const idb = fakeIndexedDb(), store = new IndexedDbProjectStore(idb.open), original = project()
    await store.save(original)
    idb.terminate()

    await store.save(edited(original, '// after terminated'))

    expect(idb.opened).toBe(2)
    expect(await text(store, original.id)).toBe('// after terminated')
  })

  it('reports the failure when the second attempt fails too, rather than trying for ever (B3)', async () => {
    const idb = fakeIndexedDb({ everyConnectionLost: true }), store = new IndexedDbProjectStore(idb.open)

    await expect(store.save(project())).rejects.toThrow('Connection to Indexed Database server lost')
    expect(idb.opened).toBe(2)
  })

  it('refuses a save from a tab whose copy is older, like the memory store (B1)', async () => {
    const idb = fakeIndexedDb(), original = project()
    const first = new IndexedDbProjectStore(idb.open), second = new IndexedDbProjectStore(idb.open)
    await first.save(original)
    await second.load(original.id)
    await second.save(edited(original, '// newer'))

    await expect(first.save(edited(original, '// older'))).rejects.toThrow('changed in another tab')
    expect(await text(second, original.id)).toBe('// newer')
  })

  it('saves over a project stored before revisions were recorded, and keeps the count out of the project', async () => {
    const idb = fakeIndexedDb(), store = new IndexedDbProjectStore(idb.open), original = project()
    idb.records.set(original.id, structuredClone(original))

    const opened = (await store.load(original.id))!
    await store.save(edited(opened, '// first save since'))

    expect(await text(store, original.id)).toBe('// first save since')
    expect(idb.records.get(original.id)?.revision).toBe(1)
    expect('revision' in (await store.load(original.id))!).toBe(false)
  })
})
