import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEventStore, createProjectStore } from '@studio/project-model'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { eventLog, type DesignEvent } from './eventLog'
import { useStudio } from './store'

/**
 * What the store writes to the event log (G5).
 *
 * Node has no `indexedDB`, so the page's log keeps its events in memory, the way a
 * browser without IndexedDB does.
 */

const persistence = createProjectStore()
const studio = () => useStudio.getState()

beforeEach(async () => {
  for (const summary of await persistence.list()) await persistence.remove(summary.id)
  useStudio.setState({ project: null, activeFileId: null, openFileIds: [], loaded: false, origin: null, recents: [], lastSavedAt: null, saveError: null, saveOutdated: false, loadError: null })
})
afterEach(() => vi.restoreAllMocks())

/** A project's events, without when each happened. */
async function logged(project: string) {
  return (await eventLog.file(project)).text.trimEnd().split('\n').slice(1).map(line => {
    const { t: _t, session: _session, seq: _seq, ...event } = JSON.parse(line)
    return event
  })
}

const LABEL: DesignEvent = { type: 'design', op: 'property', layer: 'Button', control: 'title' }

/** The counter app, and a change to a button's title planned the way Design plans one. */
async function counterWithEdit() {
  await studio().load()
  await studio().applyTemplate('counter')
  const state = studio(), project = state.project!
  const node = buildAuthoringModel({ files: project.files, projectId: project.id, revision: 1 }).nodes.find(n => n.name === 'Button')!
  const plan = planDesignEdit({ projectId: project.id, baseRevision: state.documentRevision, scope: node.owner, files: project.files, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property', control: 'title', value: 'Edited' } })
  if (!plan.ok) throw new Error(plan.reason)
  return { project, plan }
}

describe('the event log, as the store writes it', () => {
  it('records a Design edit once it is made, and not one refused or one that changed nothing', async () => {
    const { project, plan } = await counterWithEdit()

    expect(studio().commitTransaction(project, plan, LABEL)).toBeNull()
    expect(studio().commitTransaction(project, plan, LABEL)).toContain('changed')
    const edited = studio().project!
    expect(studio().commitTransaction(edited, { projectId: edited.id, baseRevision: studio().documentRevision, changes: [] }, LABEL)).toBeNull()

    expect((await logged(project.id)).filter(event => event.type === 'design')).toEqual([LABEL])
  })

  it('records Undo and Redo when they change something', async () => {
    const { project, plan } = await counterWithEdit()
    studio().commitTransaction(project, plan, LABEL)

    studio().replayDocument('undo')
    studio().replayDocument('redo')
    studio().replayDocument('redo')

    expect((await logged(project.id)).filter(event => event.type === 'history')).toEqual([{ type: 'history', direction: 'undo' }, { type: 'history', direction: 'redo' }])
  })

  it('follows each project: loaded, created, opened and renamed, with an untouched starter’s events passed to what replaced it', async () => {
    await studio().load()
    const starter = studio().project!.id
    await studio().applyTemplate('counter')
    const counter = studio().project!.id
    studio().renameProject('My Counter')
    await studio().applyTemplate('tasks')
    const tasks = studio().project!.id
    await studio().openProject(counter)

    expect(await logged(starter)).toEqual([])
    expect(await logged(counter)).toEqual([
      { type: 'session', action: 'loaded', origin: 'fresh', build: expect.any(String) },
      { type: 'project', action: 'created', template: 'counter' },
      { type: 'project', action: 'renamed' },
      { type: 'project', action: 'opened' },
    ])
    expect(await logged(tasks)).toEqual([{ type: 'project', action: 'created', template: 'tasks' }])
  })

  it('forgets the events of a project removed from this browser', async () => {
    const { project, plan } = await counterWithEdit()
    studio().commitTransaction(project, plan, LABEL)
    await studio().applyTemplate('tasks')

    await studio().removeProject(project.id)

    expect(await logged(project.id)).toEqual([])
  })

  it('keeps the events of a project that could not be removed, and is still listed', async () => {
    const { project, plan } = await counterWithEdit()
    studio().commitTransaction(project, plan, LABEL)
    await studio().applyTemplate('tasks')
    vi.spyOn(persistence, 'remove').mockRejectedValue(new DOMException('The connection was lost.', 'UnknownError'))

    await studio().removeProject(project.id)

    expect(studio().recents.some(summary => summary.id === project.id)).toBe(true)
    expect((await logged(project.id)).filter(event => event.type === 'design')).toEqual([LABEL])
  })

  it('writes a burst of typing as one event with the file and the counts, never the code', async () => {
    await studio().load()
    const project = studio().project!, file = project.files[0]!
    studio().setFileText(file.id, file.text + '\n// one')
    studio().setFileText(file.id, file.text + '\n// one two')

    const typed = (await logged(project.id)).filter(event => event.type === 'code')
    expect(typed).toEqual([{ type: 'code', file: file.id, inserted: 11, removed: 0, ms: expect.any(Number) }])
    expect(JSON.stringify(typed)).not.toContain('one')
  })

  it('makes the edit all the same when the log cannot be written: the project, its revision and Undo as without it', async () => {
    const { project, plan } = await counterWithEdit()
    const storage = createEventStore()
    vi.spyOn(storage, 'append').mockRejectedValue(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))
    vi.spyOn(storage, 'count').mockRejectedValue(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))
    const revision = studio().documentRevision

    expect(studio().commitTransaction(project, plan, LABEL)).toBeNull()
    await eventLog.flush()

    expect(studio().project!.files.some(file => file.text.includes('"Edited"'))).toBe(true)
    expect(studio().documentRevision).toBe(revision + 1)
    expect(studio().canUndo).toBe(true)
  })
})
