import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createProjectStore, emptyStudioMetadata, projectFromFiles, type Project } from '@studio/project-model'
import { useStudio } from './store'

const persistence = createProjectStore()
const source = 'import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { Text("Original") } } }'
let original: Project
beforeEach(async () => {
  original = projectFromFiles([{ name: 'App.swift', text: source }])!
  useStudio.setState({ project: original, activeFileId: original.files[0]!.id, openFileIds: [original.files[0]!.id], loaded: true, saveError: null })
  await useStudio.getState().flush()
})
afterEach(async () => { vi.restoreAllMocks(); await useStudio.getState().flush() })
const incoming = () => ({ ...original, files: [{ ...original.files[0]!, text: source.replace('Original', 'Imported') }], studio: { ...emptyStudioMetadata(), labels: [{ owner: 'Demo', fingerprint: 'a', label: 'Home' }] } })

it('imports source and metadata as one undoable document revision', async () => {
  const revision = useStudio.getState().documentRevision
  expect(await useStudio.getState().importProject(original, incoming())).toBeNull()
  expect(useStudio.getState().documentRevision).toBe(revision + 1)
  expect(useStudio.getState().project!.studio?.labels[0]!.label).toBe('Home')
  useStudio.getState().replayDocument('undo')
  expect(useStudio.getState().project!.files).toEqual(original.files)
  expect(useStudio.getState().project!.studio).toBeUndefined()
  useStudio.getState().replayDocument('redo')
  expect(useStudio.getState().project!.files[0]!.text).toContain('Imported')
})
it('keeps the last complete persisted project when the import save fails', async () => {
  const save = persistence.save.bind(persistence)
  vi.spyOn(persistence, 'save').mockImplementation(async p => { if (p.files[0]!.text.includes('Imported')) throw new Error('Simulated quota failure'); await save(p) })
  expect(await useStudio.getState().importProject(original, incoming())).toContain('quota failure')
  expect(useStudio.getState().project).toBe(original)
  expect((await persistence.load(original.id))!.files).toEqual(original.files)
})
it('rejects a review that became stale after typing', async () => {
  useStudio.getState().setFileText(original.files[0]!.id, source + '\n// newer')
  expect(await useStudio.getState().importProject(original, incoming())).toContain('changed')
  expect(useStudio.getState().project!.files[0]!.text).toContain('// newer')
})
it('serializes autosaves so an older write cannot finish after a newer one', async () => {
  const save = persistence.save.bind(persistence), completed: string[] = []
  let release: (() => void) | undefined, entered: (() => void) | undefined
  const started = new Promise<void>(resolve => { entered = resolve })
  const pending = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(persistence, 'save').mockImplementation(async p => { if (p.files[0]!.text.endsWith('// first')) { entered!(); await pending }; await save(p); completed.push(p.files[0]!.text) })
  useStudio.getState().setFileText(original.files[0]!.id, source + '\n// first')
  const first = useStudio.getState().flush(); await started
  useStudio.getState().setFileText(original.files[0]!.id, source + '\n// second')
  const second = useStudio.getState().flush(); release!(); await Promise.all([first, second])
  expect(completed.at(-1)).toContain('// second')
  expect((await persistence.load(original.id))!.files[0]!.text).toContain('// second')
})
it('rolls back an in-flight import when typing changes its expected revision', async () => {
  const save = persistence.save.bind(persistence)
  let release: (() => void) | undefined, entered: (() => void) | undefined
  const started = new Promise<void>(resolve => { entered = resolve }), blocked = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(persistence, 'save').mockImplementation(async p => { if (p.files[0]!.text.includes('Imported')) { entered!(); await blocked }; await save(p) })
  const pending = useStudio.getState().importProject(original, incoming()); await started
  useStudio.getState().setFileText(original.files[0]!.id, source + '\n// typed during import')
  release!()
  expect(await pending).toContain('changed during import')
  expect(useStudio.getState().project!.files[0]!.text).toContain('// typed during import')
  expect((await persistence.load(original.id))!.files[0]!.text).toContain('// typed during import')
})
