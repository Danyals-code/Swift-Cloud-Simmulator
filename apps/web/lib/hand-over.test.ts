import { expect, it, vi } from 'vitest'
import { createProjectStore } from '@studio/project-model'
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

  await useStudio.getState().handOver()
  expect((await persistence.load(project.id))!.files[0]!.text).toBe('// typed just before the other tab took over')

  const save = vi.spyOn(persistence, 'save')
  useStudio.getState().setFileText(project.files[0]!.id, '// typed after, in a tab that no longer has the studio')
  await useStudio.getState().flush()
  expect(save).not.toHaveBeenCalled()
})
