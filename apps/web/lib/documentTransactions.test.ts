import { beforeEach, describe, expect, it } from 'vitest'
import { emptyStudioMetadata, projectFromFiles } from '@studio/project-model'
import { planDesignEdit, buildAuthoringModel } from '@studio/swift-sema'
import { useStudio } from './store'

const SOURCE = 'import SwiftUI\n@main struct AppRoot: App { var body: some Scene { WindowGroup { Text("A") } } }'
beforeEach(() => useStudio.setState({ project: projectFromFiles([{ name: 'App.swift', text: SOURCE }])!, activeFileId: 'Sources/App.swift', openFileIds: ['Sources/App.swift'], documentSelection: null }))

function prepared() {
  const state = useStudio.getState(), project = state.project!
  const node = buildAuthoringModel({ files: project.files, projectId: project.id, revision: 1 }).nodes.find(n => n.name === 'Text')!
  const plan = planDesignEdit({ projectId: project.id, baseRevision: state.documentRevision, scope: node.owner, files: project.files, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property', control: 'content', value: 'B' } })
  if (!plan.ok) throw new Error(plan.reason)
  return { project, plan }
}

describe('document transaction coordinator', () => {
  it('rejects delayed plans after typing, including an undo back to identical bytes', () => {
    const { project, plan } = prepared()
    useStudio.getState().setFileText(project.files[0]!.id, SOURCE + '\n')
    expect(useStudio.getState().commitTransaction(project, plan, null)).toContain('changed')
    useStudio.getState().replayDocument('undo')
    expect(useStudio.getState().project!.files[0]!.text).toBe(SOURCE)
    expect(useStudio.getState().commitTransaction(project, plan, null)).toContain('changed')
  })
  it('rejects delayed plans after a project switch even with identical paths and text', () => {
    const { project, plan } = prepared()
    const next = { ...project, id: 'other' }
    useStudio.setState({ project: next })
    expect(useStudio.getState().commitTransaction(project, plan, null)).toContain('changed')
    expect(useStudio.getState().project).toBe(next)
  })
  it('records typing and design together, with source and selection restored through both directions', () => {
    const { project, plan } = prepared()
    const selected = { file: project.files[0]!.id, offset: SOURCE.indexOf('Text(') }
    useStudio.getState().setDocumentSelection(selected)
    expect(useStudio.getState().commitTransaction(project, plan, null)).toBeNull()
    const designSource = useStudio.getState().project!.files[0]!.text
    useStudio.getState().setFileText(selected.file, designSource.replace('"B"', '"C"'))
    useStudio.getState().replayDocument('undo')
    expect(useStudio.getState().project!.files[0]!.text).toBe(designSource)
    expect(useStudio.getState().replayDocument('undo')!.selection).toEqual(selected)
    expect(useStudio.getState().project!.files[0]!.text).toBe(SOURCE)
    useStudio.getState().replayDocument('redo')
    useStudio.getState().replayDocument('redo')
    expect(useStudio.getState().project!.files[0]!.text).toContain('Text("C")')
  })
  it('applies metadata and source together and advances the revision exactly once', () => {
    const { project, plan } = prepared(), revision = useStudio.getState().documentRevision
    const metadata = emptyStudioMetadata()
    expect(useStudio.getState().commitTransaction(project, { ...plan, studio: { before: undefined, after: metadata } }, null)).toBeNull()
    expect(useStudio.getState().documentRevision).toBe(revision + 1)
    expect(useStudio.getState().project!.studio).toEqual(metadata)
    useStudio.getState().replayDocument('undo')
    expect(useStudio.getState().project!.studio).toBeUndefined()
    expect(useStudio.getState().project!.files[0]!.text).toBe(SOURCE)
  })
  it('does not record no-op source updates or advance their revision', () => {
    const state = useStudio.getState(), project = state.project!, revision = state.documentRevision
    state.setFileText(project.files[0]!.id, SOURCE)
    expect(useStudio.getState().project).toBe(project)
    expect(useStudio.getState().documentRevision).toBe(revision)
  })
})

it('translates selection through typing and restores each revision’s offset on undo/redo', () => {
  const state = useStudio.getState(), project = state.project!, file = project.files[0]!.id, offset = SOURCE.indexOf('Text(')
  state.setDocumentSelection({ file, offset })
  state.setFileText(file, '// before\n' + SOURCE)
  expect(useStudio.getState().documentSelection).toEqual({ file, offset: offset + 10 })
  expect(useStudio.getState().replayDocument('undo')!.selection).toEqual({ file, offset })
  expect(useStudio.getState().replayDocument('redo')!.selection).toEqual({ file, offset: offset + 10 })
})

it('retains selection through a file rename and clears it when that file is removed', () => {
  const state = useStudio.getState(), file = state.project!.files[0]!.id, offset = SOURCE.indexOf('Text(')
  state.setDocumentSelection({ file, offset })
  state.renameFile(file, 'Renamed.swift')
  expect(useStudio.getState().documentSelection).toEqual({ file: 'Sources/Renamed.swift', offset })
  useStudio.getState().replayDocument('undo')
  expect(useStudio.getState().documentSelection).toEqual({ file, offset })
  useStudio.getState().createFile('Other.swift')
  useStudio.getState().deleteFile(file)
  expect(useStudio.getState().documentSelection).toBeNull()
})
