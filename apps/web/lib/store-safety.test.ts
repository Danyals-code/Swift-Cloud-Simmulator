import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectStore } from '@studio/project-model'
import { useStudio } from './store'

/**
 * What the store does when saving goes wrong (B1, B2, B3).
 *
 * Node has no `indexedDB`, so this is the in-memory store - the one a browser without
 * IndexedDB gets - and a failing save is that store's `save` made to throw.
 */

const persistence = createProjectStore()
const studio = () => useStudio.getState()
const firstFile = () => studio().project!.files[0]!.id

beforeEach(async () => {
  for (const summary of await persistence.list()) await persistence.remove(summary.id)
  useStudio.setState({ project: null, activeFileId: null, openFileIds: [], loaded: false, origin: null, recents: [], lastSavedAt: null, saveError: null, loadError: null })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function failSaves(message = 'The disk is full') {
  return vi.spyOn(persistence, 'save').mockRejectedValue(new Error(message))
}

describe('saving only what changed (B1)', () => {
  it('writes nothing when nothing has changed since the last save', async () => {
    // Every tab used to write its whole copy each time it was hidden or shown, which
    // is how merely looking at an old tab wrote it over the newer one.
    await studio().load()
    const save = vi.spyOn(persistence, 'save')

    await studio().flush()
    expect(save).not.toHaveBeenCalled()

    studio().setFileText(firstFile(), '// edited')
    await studio().flush()
    await studio().flush()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('tries again after a save failed, though nothing has changed since', async () => {
    await studio().load()
    studio().setFileText(firstFile(), '// edited')
    vi.spyOn(persistence, 'save').mockRejectedValueOnce(new Error('The disk is full'))

    await studio().flush()
    expect(studio().saveError).toContain('The disk is full')

    await studio().flush()
    expect(studio().saveError).toBeNull()
    expect((await persistence.load(studio().project!.id))!.files[0]!.text).toBe('// edited')
  })
})

describe('switching projects while saves fail (B3)', () => {
  it('says the project being left could not be saved, and keeps it open', async () => {
    await studio().load()
    const leaving = studio().project!.id
    studio().setFileText(firstFile(), '// not saved')
    failSaves()

    expect(await studio().applyTemplate('tasks')).toBe('unsaved')
    expect(studio().project!.id).toBe(leaving)
    expect(studio().saveError).toContain('The disk is full')
  })

  it('switches anyway when asked to, and goes on saying the new project is not saved', async () => {
    await studio().load()
    studio().setFileText(firstFile(), '// not saved')
    failSaves()

    expect(await studio().applyTemplate('tasks', { leaveUnsaved: true })).toBe('opened')
    expect(studio().project!.manifest.name).toBe('TasksApp')
    expect(studio().saveError).toContain('The disk is full')
  })

  it('opens a saved project anyway when asked to', async () => {
    await studio().load()
    const kept = studio().project!
    studio().setFileText(firstFile(), '// kept')
    await studio().flush()
    expect(await studio().applyTemplate('tasks')).toBe('opened')
    studio().setFileText(firstFile(), '// not saved')
    failSaves()

    expect(await studio().openProject(kept.id)).toBe('unsaved')
    expect(await studio().openProject(kept.id, { leaveUnsaved: true })).toBe('opened')
    expect(studio().project!.files[0]!.text).toBe('// kept')
  })

  it('opens files anyway when asked to', async () => {
    await studio().load()
    studio().setFileText(firstFile(), '// not saved')
    failSaves()
    const files = [{ name: 'Picked.swift', text: 'import SwiftUI\n@main struct Picked: App { var body: some Scene { WindowGroup { Text("Picked") } } }' }]

    expect(await studio().openFiles(files)).toBe('unsaved')
    expect(await studio().openFiles(files, { leaveUnsaved: true })).toBe('opened')
    expect(studio().project!.manifest.name).toBe('Picked')
  })
})

describe('a first load that fails (B3)', () => {
  it('is reported as a failure to open saved work, not a failed save, and keeps which project was open last', async () => {
    const values = new Map([['studio.lastOpened', 'p-last']])
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } })
    vi.spyOn(persistence, 'list').mockRejectedValue(new Error('The database is locked'))

    await studio().load()

    expect(studio().loadError).toContain('The database is locked')
    expect(studio().saveError).toBeNull()
    expect(values.get('studio.lastOpened')).toBe('p-last')
  })
})

describe('storage that keeps nothing (B2)', () => {
  it('says so when the browser gives it nowhere to save', async () => {
    await studio().load()

    expect(studio().durable).toBe(false)
  })

  it('asks the browser to keep what it saves, once', async () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { storage: { persist } })

    await studio().load()

    expect(persist).toHaveBeenCalledTimes(1)
  })
})

describe('whether leaving now would lose work (B3)', () => {
  it('is so while an edit waits to be written, or a save has failed', async () => {
    await studio().load()
    useStudio.setState({ durable: true })
    expect(studio().unsavedWork()).toBe(false)

    studio().setFileText(firstFile(), '// edited')
    expect(studio().unsavedWork()).toBe(true)
    await studio().flush()
    expect(studio().unsavedWork()).toBe(false)

    studio().setFileText(firstFile(), '// edited again')
    failSaves()
    await studio().flush()
    expect(studio().unsavedWork()).toBe(true)
  })

  it('is always so when the browser keeps nothing past the page (B2)', async () => {
    await studio().load()

    expect(studio().durable).toBe(false)
    expect(studio().unsavedWork()).toBe(true)
  })
})
