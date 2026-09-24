import { expect, it, vi } from 'vitest'
import { createEventStore } from '@studio/project-model'
import { useStudio } from './store'

/**
 * Handing the studio to another tab while the event log is stuck (G5).
 *
 * A file of its own, as hand-over.test.ts is: once a tab has handed over it never
 * writes again.
 */

it('hands over without waiting for an event log that never finishes writing', async () => {
  await useStudio.getState().load()
  const project = useStudio.getState().project!
  vi.spyOn(createEventStore(), 'append').mockReturnValue(new Promise(() => {}))
  useStudio.getState().setFileText(project.files[0]!.id, '// typed while the log is stuck')

  const handedOver = useStudio.getState().handOver({ save: true }).then(() => 'handed over')
  const waited = new Promise(resolve => setTimeout(() => resolve('still waiting'), 1000))

  expect(await Promise.race([handedOver, waited])).toBe('handed over')
})
