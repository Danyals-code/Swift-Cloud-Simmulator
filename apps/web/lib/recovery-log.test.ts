import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createEventStore, createProjectStore } from '@studio/project-model'
import { eventLog, type LoggedEvent } from './eventLog'
import { leave } from './recovery'
import { useStudio } from './store'

/**
 * The recovery screen's way out, as the event log tells it (G5).
 *
 * Node has no page to reload, so `location` is a stand-in. The last test leaves the
 * page's log stuck, which is why these have a file of their own.
 */

const persistence = createProjectStore()
const studio = () => useStudio.getState()

beforeEach(() => { vi.stubGlobal('location', { reload: vi.fn() }) })
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function recoveryEvents(project: string) {
  return (await eventLog.file(project)).text.trimEnd().split('\n').slice(1).map(line => JSON.parse(line)).filter(event => event.type === 'recovery').map(({ action, to, force }) => ({ action, to, force }))
}

it('records a choice to leave, that the latest changes could not be saved, and the choice to leave without them', async () => {
  await studio().load()
  const project = studio().project!
  studio().setFileText(project.files[0]!.id, '// not saved')
  vi.spyOn(persistence, 'save').mockRejectedValue(new Error('The disk is full'))

  expect(await leave('reload')).toBe('unsaved')
  expect(await leave('reload', true)).toBe('left')

  expect(await recoveryEvents(project.id)).toEqual([
    { action: 'leaving', to: 'reload', force: undefined },
    { action: 'unsaved', to: 'reload', force: undefined },
    { action: 'leaving', to: 'reload', force: true },
  ])
})

it('writes its last events before the page reloads, when the log is only slow', async () => {
  await studio().load()
  const storage = createEventStore(), append = storage.append.bind(storage)
  const written: string[] = []
  let writtenAtReload: string[] = []
  vi.spyOn(storage, 'append').mockImplementation(async (project, events, dropped) => {
    await new Promise(resolve => setTimeout(resolve, 100))
    await append(project, events, dropped)
    written.push(...(events as readonly LoggedEvent[]).map(event => event.type))
  })
  vi.stubGlobal('location', { reload: () => { writtenAtReload = [...written] } })
  studio().setFileText(studio().project!.files[0]!.id, '// typed just before leaving')

  expect(await leave('reload')).toBe('left')
  expect(writtenAtReload).toEqual(['code', 'recovery'])
})

it('reloads soon, without waiting for an event log that never finishes writing', async () => {
  await studio().load()
  vi.spyOn(createEventStore(), 'append').mockReturnValue(new Promise(() => {}))
  studio().setFileText(studio().project!.files[0]!.id, '// typed while the log is stuck')
  const started = Date.now()

  expect(await leave('reload')).toBe('left')
  expect(Date.now() - started).toBeLessThan(1500)
})
