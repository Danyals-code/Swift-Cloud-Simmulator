import { beforeEach, describe, expect, it } from 'vitest'
import { createProjectStore } from '@studio/project-model'
import { useStudio } from './store'

/**
 * The store's one-per-browser invariants.
 *
 * Both of these used to be true by accident. Every project was written to a single
 * fixed key, so a second `load()` overwrote the first and a template replaced
 * whatever was there - two bugs hidden behind one another. Giving projects their own
 * ids fixed the second and exposed the first: React mounts an effect twice in
 * development, both loads found an empty database, and the studio opened with a
 * duplicate of its own starter project in the recents list.
 *
 * Node has no `indexedDB`, so `createProjectStore` hands back the in-memory one -
 * which is the same interface and exactly what these need.
 */

const persistence = createProjectStore()

beforeEach(async () => {
  for (const summary of await persistence.list()) await persistence.remove(summary.id)
  useStudio.setState({
    project: null,
    activeFileId: null,
    openFileIds: [],
    loaded: false,
    origin: null,
    recents: [],
    lastSavedAt: null,
    saveError: null,
  })
})

describe('the first load', () => {
  it('lays down exactly one starter project: the blank screen, not an example (B6)', async () => {
    await useStudio.getState().load()

    expect(await persistence.list()).toHaveLength(1)
    expect(useStudio.getState().project?.manifest.templateId).toBe('blank')
    expect(useStudio.getState().project?.manifest.name).toBe('MyDesignApp')
    expect(useStudio.getState().origin).toBe('fresh')
  })

  it('lays down one even when it is called twice at once', async () => {
    // The `<StrictMode>` double-mount, which is the shape this actually arrives in.
    await Promise.all([useStudio.getState().load(), useStudio.getState().load()])

    expect(await persistence.list()).toHaveLength(1)
  })

  it('does nothing on a later call', async () => {
    await useStudio.getState().load()
    const opened = useStudio.getState().project?.id

    await useStudio.getState().load()

    expect(await persistence.list()).toHaveLength(1)
    expect(useStudio.getState().project?.id).toBe(opened)
  })

  it('reopens what was already stored rather than starting over', async () => {
    await useStudio.getState().load()
    const first = useStudio.getState().project!

    useStudio.setState({ loaded: false })
    await useStudio.getState().load()

    expect(useStudio.getState().project?.id).toBe(first.id)
    expect(useStudio.getState().origin).toBe('restored')
  })
})

describe('creating a project from a template', () => {
  it('keeps an imported project even when none of its files were edited', async () => {
    await useStudio.getState().load()
    await useStudio.getState().openFiles([{ name: 'Original.swift', text: 'import SwiftUI\n@main struct Original: App { var body: some Scene { WindowGroup { Text("Keep me") } } }' }])
    const imported = useStudio.getState().project!
    await useStudio.getState().applyTemplate('tasks')
    expect((await persistence.load(imported.id))?.files).toEqual(imported.files)
  })

  it('keeps older projects whose template provenance is unknown', async () => {
    await useStudio.getState().load()
    const old = useStudio.getState().project!
    useStudio.setState({ project: { ...old, manifest: { ...old.manifest, templateId: undefined } } })
    await useStudio.getState().applyTemplate('tasks')
    expect(await persistence.load(old.id)).not.toBeNull()
  })
  it('keeps the outgoing project when it has been worked on', async () => {
    await useStudio.getState().load()
    const outgoing = useStudio.getState().project!
    useStudio.getState().setFileText(outgoing.files[0]!.id, '// changed')
    await useStudio.getState().flush()

    await useStudio.getState().applyTemplate('tasks')

    const kept = await persistence.list()
    expect(kept.map((p) => p.name).sort()).toEqual(['MyDesignApp', 'TasksApp'])
  })

  it('saves the last keystrokes when a template opens before autosave runs', async () => {
    await useStudio.getState().load()
    const outgoing = useStudio.getState().project!
    useStudio.getState().setFileText(outgoing.files[0]!.id, '// just typed')

    await useStudio.getState().applyTemplate('folio')
    await useStudio.getState().openProject(outgoing.id)

    expect(useStudio.getState().project!.files[0]!.text).toBe('// just typed')
  })

  it('discards the outgoing project when nobody touched it', async () => {
    // Otherwise a click through five templates leaves five projects nobody chose.
    await useStudio.getState().load()

    await useStudio.getState().applyTemplate('tasks')

    const kept = await persistence.list()
    expect(kept.map((p) => p.name)).toEqual(['TasksApp'])
  })

  it('keeps the untouched project when its own template is chosen again (B6)', async () => {
    // A fresh browser opens on the blank screen, so "Create design" is most people's
    // first click. Swapping the starter for an identical copy redrew everything, and
    // for a moment the canvas showed one project while edits went to the other.
    await useStudio.getState().load()
    const starter = useStudio.getState().project!

    expect(await useStudio.getState().applyTemplate('blank')).toBe('opened')

    expect(useStudio.getState().project).toBe(starter)
    expect(await persistence.list()).toHaveLength(1)
  })

  it('gives the new project its own id', async () => {
    await useStudio.getState().load()
    const before = useStudio.getState().project!.id

    await useStudio.getState().applyTemplate('tasks')

    expect(useStudio.getState().project!.id).not.toBe(before)
  })

  it('reports a template id that does not exist rather than half-acting', async () => {
    await useStudio.getState().load()
    const before = useStudio.getState().project!.id

    expect(await useStudio.getState().applyTemplate('not-a-template')).toBe('failed')
    expect(useStudio.getState().project!.id).toBe(before)
  })
})

describe('the recents list', () => {
  it('reports a stale project without changing the current project', async () => {
    await useStudio.getState().load()
    const current = useStudio.getState().project!.id
    expect(await useStudio.getState().openProject('missing')).toBe('failed')
    expect(useStudio.getState().project!.id).toBe(current)
  })
  it('names every project in this browser', async () => {
    await useStudio.getState().load()
    useStudio.getState().setFileText(useStudio.getState().project!.files[0]!.id, '// changed')
    await useStudio.getState().flush()
    await useStudio.getState().applyTemplate('tasks')

    // Membership rather than order: a test does all of this inside one millisecond,
    // so `updatedAt` and `createdAt` both tie and there is no "newest" to assert.
    // The order is exercised below, where the timestamps actually differ.
    expect(useStudio.getState().recents.map((p) => p.name).sort()).toEqual([
      'MyDesignApp',
      'TasksApp',
    ])
  })

  it('puts the most recently touched first', async () => {
    await useStudio.getState().load()
    const first = useStudio.getState().project!
    useStudio.getState().setFileText(first.files[0]!.id, '// changed')
    await useStudio.getState().flush()
    await useStudio.getState().applyTemplate('tasks')

    // Reach past the store and age one of them, which is the only way to have two
    // projects whose timestamps are a millisecond apart inside a test.
    const aged = (await persistence.load(first.id))!
    await persistence.save({ ...aged, updatedAt: aged.updatedAt - 60_000 })
    await useStudio.getState().openProject(first.id)

    expect(useStudio.getState().recents.map((p) => p.name)).toEqual(['TasksApp', 'MyDesignApp'])
  })

  it('reopens one without disturbing the other', async () => {
    await useStudio.getState().load()
    const first = useStudio.getState().project!
    useStudio.getState().setFileText(first.files[0]!.id, '// changed')
    await useStudio.getState().flush()
    await useStudio.getState().applyTemplate('tasks')

    await useStudio.getState().openProject(first.id)

    expect(useStudio.getState().project?.id).toBe(first.id)
    expect(useStudio.getState().project?.files[0]?.text).toBe('// changed')
    expect(await persistence.list()).toHaveLength(2)
  })

  it('refuses to delete the project that is open', async () => {
    await useStudio.getState().load()
    const open = useStudio.getState().project!.id

    await useStudio.getState().removeProject(open)

    expect(await persistence.list()).toHaveLength(1)
  })

  it('deletes one that is not', async () => {
    await useStudio.getState().load()
    const first = useStudio.getState().project!
    useStudio.getState().setFileText(first.files[0]!.id, '// changed')
    await useStudio.getState().flush()
    await useStudio.getState().applyTemplate('tasks')

    await useStudio.getState().removeProject(first.id)

    expect(useStudio.getState().recents.map((p) => p.name)).toEqual(['TasksApp'])
  })
})

describe('renaming from the workspace', () => {
  it('saves a renamed app and retains an otherwise untouched template', async () => {
    await useStudio.getState().load()
    const id = useStudio.getState().project!.id
    expect(useStudio.getState().renameProject('My Reading App')).toBe(true)
    await useStudio.getState().flush()
    expect((await persistence.load(id))?.manifest.name).toBe('My Reading App')
    await useStudio.getState().applyTemplate('tasks')
    expect((await persistence.load(id))?.manifest.name).toBe('My Reading App')
  })

  it('reports invalid names without losing the current name', async () => {
    await useStudio.getState().load()
    expect(useStudio.getState().renameProject('../Bad')).toBe(false)
    expect(useStudio.getState().project!.manifest.name).toBe('MyDesignApp')
    const file = useStudio.getState().project!.files[0]!.id
    expect(useStudio.getState().renameFile(file, '../Bad.swift')).toBe(false)
    expect(useStudio.getState().renameFile(file, 'Renamed.swift')).toBe(true)
    expect(useStudio.getState().activeFileId).toContain('Renamed.swift')
    await useStudio.getState().flush()
    expect((await persistence.load(useStudio.getState().project!.id))?.files.some(f => f.id.endsWith('Renamed.swift'))).toBe(true)
  })
})
