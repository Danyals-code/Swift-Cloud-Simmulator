import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { templateById } from '@studio/project-model/templates'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringOperation, SourceFile } from '@studio/shared'

/**
 * The shape a project made here follows.
 *
 * `App/` holds the entry point, `Features/<Screen>/` one folder per screen,
 * `DesignSystem/` the tokens and the components. The designer surface is built for
 * this shape; an imported project keeps its own layout and is edited where it
 * stands, which is what the two halves of each case below check.
 */

const blank = () => templateById('blank')!.files.map(file => ({ ...file }))
const flat = (): SourceFile[] => [{ id: 'App.swift', text: `import SwiftUI\n@main\nstruct FlatApp: App {\n    var body: some Scene {\n        WindowGroup { HomeScreen() }\n    }\n}\nstruct HomeScreen: View {\n    var body: some View {\n        VStack { Text("Home") }\n    }\n}\n` }]

function edit(project: readonly SourceFile[], operation: AuthoringOperation, view = 'HomeScreen') {
  const snapshot = buildAuthoringModel({ projectId: 'shape', revision: 1, files: project, deploymentTarget: '17.0' })
  const node = snapshot.nodes.find(n => n.kind === 'definition' && n.name === view) ?? snapshot.nodes[0]!
  const plan = planDesignEdit({ projectId: 'shape', baseRevision: 1, files: project, deploymentTarget: '17.0', scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
  if (!plan.ok) throw new Error(plan.reason)
  const changed = project.map(file => {
    const change = plan.changes.find(c => c.file === file.id)
    return change ? { ...file, text: change.after, deleted: change.deleted } : file
  }).filter(file => !('deleted' in file && file.deleted))
  return [...changed, ...plan.changes.filter(change => change.before === null).map(change => ({ id: change.file, text: change.after }))]
}
const draws = (project: readonly SourceFile[]) => {
  resetPipelineState()
  const result = compile({ projectId: 'shape', revision: 1, files: project, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}

describe('new screens', () => {
  it('get their own folder and a #Preview in a project that follows the shape', () => {
    const next = edit(blank(), { kind: 'screen-create', name: 'DetailScreen', title: 'Detail', layout: 'VStack' })
    const created = next.find(file => file.id === 'Sources/Features/Detail/DetailScreen.swift')!
    expect(created).toBeDefined()
    expect(created.text).toContain('struct DetailScreen: View {')
    expect(created.text).toContain('.navigationTitle("Detail")')
    expect(created.text).toContain('#Preview {\n    DetailScreen()\n}')
    // The screens that were already there are untouched.
    expect(next.find(file => file.id === 'Sources/Features/Home/HomeScreen.swift')!.text).toBe(blank()[1]!.text)
    draws(next)
  })

  it('are appended where the designer is working in an imported project', () => {
    const next = edit(flat(), { kind: 'screen-create', name: 'DetailScreen', title: 'Detail', layout: 'VStack' })
    expect(next).toHaveLength(1)
    expect(next[0]!.text).toContain('struct DetailScreen: View {')
    draws(next)
  })

  it('take their own file away again when the screen is removed', () => {
    const made = edit(blank(), { kind: 'screen-create', name: 'DetailScreen', title: 'Detail', layout: 'VStack' })
    const removed = edit(made, { kind: 'screen-remove' }, 'DetailScreen')
    expect(removed.map(file => file.id)).toEqual(['Sources/App/MyDesignApp.swift', 'Sources/Features/Home/HomeScreen.swift'])
    draws(removed)
  })

  it('take a wrapped preview with them, and keep one that shows another screen', () => {
    const made = edit(blank(), { kind: 'screen-create', name: 'DetailScreen', title: 'Detail', layout: 'VStack' })
    // A designer's own preview: named, and wrapped in a navigation container.
    const wrapped = made.map(file => file.id.includes('Detail')
      ? { ...file, text: file.text.replace('#Preview {\n    DetailScreen()\n}', '#Preview("Detail (dark)") {\n    NavigationStack {\n        DetailScreen()\n    }\n}') }
      : file)
    const removed = edit(wrapped, { kind: 'screen-remove' }, 'DetailScreen')
    expect(removed.map(file => file.id)).toEqual(['Sources/App/MyDesignApp.swift', 'Sources/Features/Home/HomeScreen.swift'])
    // A preview that also shows another screen is somebody else's code: it stays,
    // and the screen cannot be removed from under it.
    const shared = made.map(file => file.id.includes('Detail')
      ? { ...file, text: file.text.replace('#Preview {\n    DetailScreen()\n}', '#Preview {\n    VStack {\n        DetailScreen()\n        HomeScreen()\n    }\n}') }
      : file)
    expect(() => edit(shared, { kind: 'screen-remove' }, 'DetailScreen')).toThrow(/used by the app or another screen/)
  })

  it('refuse to go where a file of that name already is', () => {
    const made = edit(blank(), { kind: 'screen-create', name: 'DetailScreen', title: 'Detail', layout: 'VStack' })
    const renamed = made.map(file => file.id.includes('Detail') ? { ...file, text: file.text.replaceAll('DetailScreen', 'OtherScreen') } : file)
    expect(() => edit(renamed, { kind: 'screen-create', name: 'DetailScreen', title: 'Detail', layout: 'VStack' })).toThrow(/already exists/)
  })
})

describe('components and tokens', () => {
  it('go to DesignSystem, beside the rest of the design system', () => {
    const project = blank().map(file => file.id.includes('Features/') ? { ...file, text: file.text.replace('VStack(spacing: 16) {\n            }', 'VStack(spacing: 16) {\n                HStack(spacing: 8) {\n                    Image(systemName: "person")\n                    Text("Ana")\n                }\n                .padding(12)\n            }') } : file)
    const snapshot = buildAuthoringModel({ projectId: 'shape', revision: 1, files: project, deploymentTarget: '17.0' })
    const row = snapshot.nodes.find(n => n.name === 'HStack' && n.kind !== 'definition')!
    const plan = planDesignEdit({ projectId: 'shape', baseRevision: 1, files: project, deploymentTarget: '17.0', scope: row.owner, target: row.source, fingerprint: row.fingerprint, operation: { kind: 'make-component', name: 'PersonRow', copies: [], screens: ['HomeScreen'] } })
    expect(plan.ok && plan.changes.some(change => change.file === 'Sources/DesignSystem/Components/PersonRow.swift' && change.before === null)).toBe(true)
  })

  it('keeps tokens in DesignSystem/Tokens.swift', () => {
    const project = blank()
    const snapshot = buildAuthoringModel({ projectId: 'shape', revision: 1, files: project, deploymentTarget: '17.0' })
    const stack = snapshot.nodes.find(n => n.name === 'VStack')!
    const plan = planDesignEdit({ projectId: 'shape', baseRevision: 1, files: project, deploymentTarget: '17.0', scope: stack.owner, target: stack.source, fingerprint: stack.fingerprint, operation: { kind: 'style-create', name: 'space24', style: 'spacing', value: '24' } })
    expect(plan.ok && plan.changes.some(change => change.file === 'Sources/DesignSystem/Tokens.swift')).toBe(true)
  })
})
