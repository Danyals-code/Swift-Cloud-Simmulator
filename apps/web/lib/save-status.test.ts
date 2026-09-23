import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProjectStore, projectFromFiles, type Project } from '@studio/project-model'
import { useStudio } from './store'

const persistence = createProjectStore()
let original: Project
beforeEach(async () => {
  original = projectFromFiles([{ name: 'App.swift', text: 'import SwiftUI\nstruct ContentView: View { var body: some View { Text("Original") } }' }])!
  useStudio.setState({ project: original, loaded: true, lastSavedAt: null, saveError: null })
  await useStudio.getState().flush()
})
afterEach(async () => { vi.restoreAllMocks(); await useStudio.getState().flush() })

function holdNextSave(failure = false) {
  const save = persistence.save.bind(persistence)
  let release!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(persistence, 'save').mockImplementationOnce(async project => {
    entered(); await blocked
    if (failure) throw new Error('Older project could not save')
    await save(project)
  })
  return { started, release: () => release() }
}

describe('save status describes the current document', () => {
  it('clears the saved indicator when a new edit is pending', async () => {
    expect(useStudio.getState().lastSavedAt).not.toBeNull()
    useStudio.getState().setFileText(original.files[0]!.id, '// Edited')
    expect(useStudio.getState().lastSavedAt).toBeNull()
    await useStudio.getState().flush()
    expect(useStudio.getState().lastSavedAt).not.toBeNull()
    expect((await persistence.load(original.id))!.files[0]!.text).toBe('// Edited')
  })

  it('does not mark a newer edit saved when an older write completes', async () => {
    useStudio.getState().setFileText(original.files[0]!.id, '// First')
    const held = holdNextSave(), first = useStudio.getState().flush()
    await held.started
    useStudio.getState().setFileText(original.files[0]!.id, '// Second')
    held.release(); await first
    expect(useStudio.getState().lastSavedAt).toBeNull()
    expect((await persistence.load(original.id))!.files[0]!.text).toBe('// First')
    await useStudio.getState().flush()
    expect(useStudio.getState().lastSavedAt).not.toBeNull()
    expect((await persistence.load(original.id))!.files[0]!.text).toBe('// Second')
  })

  it('does not attach an old project save failure to a different current project', async () => {
    // Something to write: a project with no edits since its last save is not written again.
    useStudio.getState().setFileText(original.files[0]!.id, '// Pending')
    const held = holdNextSave(true), first = useStudio.getState().flush()
    await held.started
    const next = projectFromFiles([{ name: 'Other.swift', text: '// Different project' }])!
    useStudio.setState({ project: next, lastSavedAt: null, saveError: null })
    held.release(); await first
    expect(useStudio.getState().project).toBe(next)
    expect(useStudio.getState().lastSavedAt).toBeNull()
    expect(useStudio.getState().saveError).toBeNull()
  })
})
