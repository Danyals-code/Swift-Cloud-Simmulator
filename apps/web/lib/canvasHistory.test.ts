import { expect, it } from 'vitest'
import { createDefaultProject } from '@studio/project-model/templates'
import { CanvasHistory } from './canvasHistory'

const project = createDefaultProject()
const file = project.files[0]!.id
const at = (text: string, id = project.id) => ({ ...project, id, files: [{ id: file, text }] })
const change = (before: string, after: string, projectId = project.id) => ({ projectId, file, before, after, offset: 0 })

it('walks through consecutive canvas edits in both directions', () => {
  const history = new CanvasHistory()
  history.record(change('a', 'b'))
  history.record(change('b', 'c'))
  expect(history.take('undo', at('c'))?.before).toBe('b')
  expect(history.take('undo', at('b'))?.before).toBe('a')
  expect(history.take('redo', at('a'))?.after).toBe('b')
  expect(history.take('redo', at('b'))?.after).toBe('c')
})

it('never overwrites newer source edits with an old full-file snapshot', () => {
  const history = new CanvasHistory()
  history.record(change('a', 'b'))
  expect(history.take('undo', at('b plus code edits'))).toBeNull()
  expect(history.take('undo', at('b'))).toBeNull()
})

it('refuses an undo in another project even with identical file contents', () => {
  const history = new CanvasHistory()
  history.record(change('a', 'b'))
  expect(history.take('undo', at('b', 'another-project'))).toBeNull()
})

it('refuses a redo after a source edit or file removal', () => {
  const history = new CanvasHistory()
  history.record(change('a', 'b'))
  history.take('undo', at('b'))
  expect(history.take('redo', at('modified'))).toBeNull()
  history.record(change('a', 'b'))
  expect(history.take('undo', { ...project, files: [] })).toBeNull()
})
