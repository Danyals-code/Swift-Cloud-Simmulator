import { expect, it, vi } from 'vitest'
import { createProjectStore, projectFromFiles } from '@studio/project-model'
import { eventLog } from './eventLog'
import { useStudio } from './store'

/**
 * Handing the studio to another tab (B1).
 *
 * A file of its own: once a tab has handed over it never writes again, which would
 * leave every later test in a shared file with a store that cannot save.
 */

const persistence = createProjectStore()

it('saves what is here before stepping aside, then writes nothing more', async () => {
  await useStudio.getState().load()
  const project = useStudio.getState().project!
  useStudio.getState().setFileText(project.files[0]!.id, '// typed just before the other tab took over')

  await useStudio.getState().handOver({ save: true })
  expect((await persistence.load(project.id))!.files[0]!.text).toBe('// typed just before the other tab took over')

  const save = vi.spyOn(persistence, 'save')
  useStudio.getState().setFileText(project.files[0]!.id, '// typed after, in a tab that no longer has the studio')
  await useStudio.getState().flush()
  expect(save).not.toHaveBeenCalled()
  save.mockRestore()

  // The other tab writes the events from here on (G5).
  const logged = (await eventLog.jsonl(project.id)).trimEnd().split('\n').slice(1).map(line => JSON.parse(line))
  expect(logged.map(event => event.action ?? event.type)).toEqual(['loaded', 'code', 'handed-over'])
})

it('switches and deletes nothing once another tab has the studio', async () => {
  // Its copy is out of date: opening another project from here used to delete the one
  // left behind if it looked untouched - the record the other tab is editing.
  const open = useStudio.getState().project!
  const other = projectFromFiles([{ name: 'Other.swift', text: '// another project' }])!
  const stored = new Set((await persistence.list()).map(summary => summary.id))
  await persistence.save(other)

  expect(await useStudio.getState().applyTemplate('tasks')).toBe('failed')
  expect(await useStudio.getState().openProject(other.id)).toBe('failed')
  expect(await useStudio.getState().openFiles([{ name: 'Picked.swift', text: '// picked' }])).toBe('failed')
  await useStudio.getState().removeProject(other.id)

  expect(useStudio.getState().project).toBe(open)
  expect(new Set((await persistence.list()).map(summary => summary.id))).toEqual(new Set([...stored, other.id]))
})
