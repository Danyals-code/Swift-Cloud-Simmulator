import { expect, it } from 'vitest'
import { createDefaultProject } from '@studio/project-model/templates'
import { DocumentHistory } from '@studio/project-model'

const project = createDefaultProject()
const file = project.files[0]!.id
const at = (text: string, id = project.id) => ({ ...project, id, files: [{ id: file, text }] })
const change = (before: string, after: string) => [at(before), at(after), null, null] as const

it('walks through consecutive canvas edits in both directions', () => {
  const history = new DocumentHistory()
  history.record(...change('a', 'b'))
  history.record(...change('b', 'c'))
  expect(history.take('undo', at('c'))?.project.files[0]?.text).toBe('b')
  expect(history.take('undo', at('b'))?.project.files[0]?.text).toBe('a')
  expect(history.take('redo', at('a'))?.project.files[0]?.text).toBe('b')
  expect(history.take('redo', at('b'))?.project.files[0]?.text).toBe('c')
})

it('never overwrites newer source edits with an old full-file snapshot', () => {
  const history = new DocumentHistory()
  history.record(...change('a', 'b'))
  expect(history.take('undo', at('b plus code edits'))).toBeNull()
  expect(history.take('undo', at('b'))).toBeNull()
})

it('refuses an undo in another project even with identical file contents', () => {
  const history = new DocumentHistory()
  history.record(...change('a', 'b'))
  expect(history.take('undo', at('b', 'another-project'))).toBeNull()
})

it('refuses a redo after a source edit or file removal', () => {
  const history = new DocumentHistory()
  history.record(...change('a', 'b'))
  history.take('undo', at('b'))
  expect(history.take('redo', at('modified'))).toBeNull()
  history.record(...change('a', 'b'))
  expect(history.take('undo', { ...project, files: [] })).toBeNull()
})
