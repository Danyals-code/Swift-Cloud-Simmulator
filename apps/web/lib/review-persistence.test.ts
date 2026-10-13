import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createProjectStore, emptyStudioMetadata, projectFromFiles, type Project } from '@studio/project-model'
import { createDefaultProject } from '@studio/project-model/templates'
import { useStudio } from './store'

const persistence = createProjectStore()
let original: Project
beforeEach(async () => {
  original = projectFromFiles([{ name: 'App.swift', text: '// original' }])!
  useStudio.setState({ project: original, loaded: true, activeFileId: original.files[0]!.id, saveError: null })
  await useStudio.getState().flush()
})
afterEach(async () => { vi.restoreAllMocks(); await useStudio.getState().flush() })

it.each(['files', 'template', 'saved'] as const)('keeps unsaved outgoing work when opening %s fails to save', async kind => {
  const incoming = projectFromFiles([{ name: 'Other.swift', text: '// incoming' }])!
  await persistence.save(incoming)
  useStudio.getState().setFileText(original.files[0]!.id, '// unsaved work')
  vi.spyOn(persistence, 'save').mockRejectedValueOnce(new Error('Quota exceeded'))
  const opened = kind === 'files' ? await useStudio.getState().openFiles([{ name: 'Other.swift', text: '// incoming' }])
    : kind === 'template' ? await useStudio.getState().applyTemplate('counter') : await useStudio.getState().openProject(incoming.id)
  expect(opened).toBe('unsaved')
  expect(useStudio.getState().project?.id).toBe(original.id)
  expect(useStudio.getState().project?.files[0]!.text).toBe('// unsaved work')
  expect(useStudio.getState().saveError).toContain('Quota exceeded')
})

it.each(['files', 'saved'] as const)('persists typing that arrives while a switch to %s is saving', async kind => {
  const incoming = projectFromFiles([{ name: 'Other.swift', text: '// incoming' }])!
  await persistence.save(incoming)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  const save = persistence.save.bind(persistence)
  vi.spyOn(persistence, 'save').mockImplementationOnce(async project => { entered(); await blocked; await save(project) })
  // An edit to save on the way out: a project with none is not written again.
  useStudio.getState().setFileText(original.files[0]!.id, '// first edit')
  const opening = kind === 'files' ? useStudio.getState().openFiles([{ name: 'Other.swift', text: '// incoming' }]) : useStudio.getState().openProject(incoming.id)
  await started
  useStudio.getState().setFileText(original.files[0]!.id, '// latest edit')
  release()
  expect(await opening).toBe('opened')
  expect((await persistence.load(original.id))?.files[0]!.text).toBe('// latest edit')
})

it('opens the incoming project though it cannot be saved, and keeps saying so (B3)', async () => {
  // Refusing used to leave a participant whose storage had failed unable to start
  // the next task. What was open is saved; the new project is what needs the warning.
  const save = persistence.save.bind(persistence)
  vi.spyOn(persistence, 'save').mockImplementation(async project => { if (project.id !== original.id) throw new Error('Storage full'); await save(project) })
  expect(await useStudio.getState().openFiles([{ name: 'Other.swift', text: '// incoming' }])).toBe('opened')
  expect(useStudio.getState().project?.files[0]?.text).toBe('// incoming')
  expect(useStudio.getState().saveError).toContain('Storage full')
  expect((await persistence.load(original.id))?.files[0]?.text).toBe('// original')
})

it.each(['other', 'current'] as const)('does not let an older project load override a newer choice of %s project', async choice => {
  const slow = projectFromFiles([{ name: 'Slow.swift', text: '// slow' }])!
  const latest = projectFromFiles([{ name: 'Latest.swift', text: '// latest' }])!
  await persistence.save(slow)
  await persistence.save(latest)
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  const load = persistence.load.bind(persistence)
  vi.spyOn(persistence, 'load').mockImplementation(async id => {
    if (id === slow.id) { entered(); await blocked }
    return load(id)
  })
  const opening = useStudio.getState().openProject(slow.id)
  await started
  const target = choice === 'current' ? original : latest
  expect(await useStudio.getState().openProject(target.id)).toBe('opened')
  release()
  expect(await opening).toBe('failed')
  expect(useStudio.getState().project?.id).toBe(target.id)
})

it('preserves a template edited only through its screen name', async () => {
  const initial = createDefaultProject()
  const edited = { ...initial, studio: { ...emptyStudioMetadata(), screens: [{ view: 'ContentView', name: 'My home' }] } }
  useStudio.setState({ project: edited })
  await useStudio.getState().flush()
  expect(await useStudio.getState().openFiles([{ name: 'Other.swift', text: '// incoming' }])).toBe('opened')
  expect((await persistence.load(edited.id))?.studio?.screens).toEqual(edited.studio.screens)
})

it('rejects case-colliding creation and rename without changing the project', () => {
  expect(useStudio.getState().createFile('app.swift')).toBeNull()
  expect(useStudio.getState().project).toBe(original)
  const other = useStudio.getState().createFile('Other.swift')!
  expect(useStudio.getState().renameFile(other, 'APP.swift')).toBe(false)
  expect(useStudio.getState().project?.files.map(file => file.id)).toEqual(['Sources/App.swift', 'Sources/Other.swift'])
})
