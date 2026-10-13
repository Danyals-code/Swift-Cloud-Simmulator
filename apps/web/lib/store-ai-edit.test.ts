import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectStore } from '@studio/project-model'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { useStudio } from './store'

/**
 * An AI edit holds the project while it works (G12).
 *
 * The answer takes 30 to 120 seconds and is paid for, and it is planned against the
 * project as it was sent. Any change made meanwhile used to throw it away. Node has no
 * `indexedDB`, so the store keeps projects in memory, as a browser without it does.
 */

const persistence = createProjectStore()
const studio = () => useStudio.getState()

beforeEach(async () => {
  studio().stopAiEdit()
  for (const summary of await persistence.list()) await persistence.remove(summary.id)
  useStudio.setState({ project: null, activeFileId: null, openFileIds: [], loaded: false, origin: null, recents: [], lastSavedAt: null, saveError: null, saveOutdated: false, loadError: null })
  await studio().load()
  await studio().applyTemplate('counter')
})

afterEach(() => { vi.restoreAllMocks() })

/** A change to a button's title in the counter, planned the way Design or the AI plans one. */
function titleEdit(value: string) {
  const state = studio(), project = state.project!
  const node = buildAuthoringModel({ files: project.files, projectId: project.id, revision: 1 }).nodes.find(n => n.name === 'Button')!
  const plan = planDesignEdit({ projectId: project.id, baseRevision: state.documentRevision, scope: node.owner, files: project.files, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property', control: 'title', value } })
  if (!plan.ok) throw new Error(plan.reason)
  return { project, plan }
}
const text = () => studio().project!.files[0]!.text

describe('an AI edit holding the project', () => {
  it('keeps every other change out until its answer lands, and then lets them in', () => {
    const hold = studio().holdForAi(() => {})!
    const { project, plan } = titleEdit('From the AI')
    const before = text(), device = studio().project!.manifest.device

    expect(studio().commitTransaction(project, titleEdit('From Design').plan, null)).toMatch(/AI is editing/)
    studio().setFileText(project.files[0]!.id, '// typed while waiting')
    expect(studio().replayDocument('undo')).toBeNull()
    expect(studio().renameFile(project.files[0]!.id, 'Renamed.swift')).toBe(false)
    studio().setDevice(device === 'iphone-15' ? 'iphone-18-pro' : 'iphone-15')
    expect(text()).toBe(before)
    expect(studio().project!.manifest.device).toBe(device)
    expect(studio().aiEdit).toEqual({ phase: 'editing' })

    expect(hold.commit(project, plan)).toBeNull()
    hold.release()

    expect(text()).toContain('From the AI')
    expect(studio().aiEdit).toBeNull()
    studio().setFileText(project.files[0]!.id, '// typed after')
    expect(text()).toBe('// typed after')
  })

  it('stops at once when asked: the request is cancelled, and the project is free again', () => {
    const stop = vi.fn()
    const hold = studio().holdForAi(stop)!
    const { project, plan } = titleEdit('Too late')

    studio().stopAiEdit()

    expect(stop).toHaveBeenCalledOnce()
    expect(studio().aiEdit).toBeNull()
    expect(hold.commit(project, plan)).toMatch(/stopped/)
    studio().setFileText(project.files[0]!.id, '// typed after stopping')
    expect(text()).toBe('// typed after stopping')
  })

  it('counts as unsaved work while it runs, so leaving the page asks first', async () => {
    // As a browser's IndexedDB is: the memory store Node has would count every edit unsaved.
    useStudio.setState({ durable: true })
    await studio().flush()
    expect(studio().unsavedWork()).toBe(false)

    const hold = studio().holdForAi(() => {})!
    expect(studio().unsavedWork()).toBe(true)

    hold.release()
    expect(studio().unsavedWork()).toBe(false)
  })

  it('takes one AI edit at a time, and says when the answer is being checked', () => {
    const hold = studio().holdForAi(() => {})!

    expect(studio().holdForAi(() => {})).toBeNull()
    hold.checking()
    expect(studio().aiEdit).toEqual({ phase: 'checking' })
    hold.release()
    expect(studio().holdForAi(() => {})).not.toBeNull()
  })

  it('says when the AI is fixing an answer the preview found broken, still holding the project (G2)', () => {
    const hold = studio().holdForAi(() => {})!
    hold.checking()

    hold.fixing()

    expect(studio().aiEdit).toEqual({ phase: 'fixing' })
    studio().setFileText(studio().project!.files[0]!.id, '// typed while it fixes')
    expect(text()).not.toBe('// typed while it fixes')
    hold.release()
  })

  it('keeps running when opening another project is refused, since nothing switched', async () => {
    const stop = vi.fn()
    studio().setFileText(studio().project!.files[0]!.id, '// typed before the AI edit')
    studio().holdForAi(stop)
    vi.spyOn(persistence, 'save').mockRejectedValue(new Error('The disk is full'))

    expect(await studio().applyTemplate('tasks')).toBe('unsaved')

    expect(stop).not.toHaveBeenCalled()
    expect(studio().aiEdit).toEqual({ phase: 'editing' })
    expect(studio().project!.manifest.templateId).toBe('counter')
  })

  it('is stopped by opening another project, which the answer would no longer fit', async () => {
    const stop = vi.fn()
    studio().holdForAi(stop)

    await studio().applyTemplate('tasks')

    expect(stop).toHaveBeenCalledOnce()
    expect(studio().aiEdit).toBeNull()
    expect(studio().project!.manifest.templateId).toBe('tasks')
  })
})
