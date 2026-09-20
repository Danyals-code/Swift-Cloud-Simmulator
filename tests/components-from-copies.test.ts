import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, findViewCopies, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringNode, AuthoringOperation, SourceFile } from '@studio/shared'

/**
 * Components made from copies a designer already has.
 *
 * The rules are exact on purpose: same views, same nesting, same modifiers in the
 * same order. What differs becomes a parameter. Everything here checks the Swift
 * that comes out and that the project still draws.
 */

const app = (body: string, extra = '') => `import SwiftUI\n@main\nstruct CopiesApp: App {\n    var body: some Scene {\n        WindowGroup { ContentView() }\n    }\n}\nstruct ContentView: View {\n    var body: some View {\n        VStack(spacing: 12) {\n${body}\n        }\n    }\n}\n${extra}`
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
const BADGE = (icon: string, name: string, indent = '            ') => `${indent}HStack(spacing: 8) {\n${indent}    Image(systemName: "${icon}")\n${indent}    Text("${name}")\n${indent}}\n${indent}.padding(12)`

const model = (project: readonly SourceFile[]) => buildAuthoringModel({ projectId: 'copies', revision: 1, files: project, deploymentTarget: '17.0' })
/** The nth view of a kind, in source order. */
const nodeAt = (project: readonly SourceFile[], name: string, index = 0): AuthoringNode =>
  model(project).nodes.filter(n => n.name === name && n.kind !== 'definition').sort((a, b) => a.source.start - b.source.start)[index]!
const copiesOf = (project: readonly SourceFile[], node: AuthoringNode) => findViewCopies(project, node.source, { deploymentTarget: '17.0', screens: ['ContentView'] })

function edit(project: readonly SourceFile[], node: AuthoringNode, operation: AuthoringOperation) {
  const plan = planDesignEdit({ projectId: 'copies', baseRevision: 1, files: project, deploymentTarget: '17.0', scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
  if (!plan.ok) throw new Error(plan.reason)
  return project.map(file => ({ ...file, text: plan.changes.find(change => change.file === file.id)?.after ?? file.text }))
    .concat(plan.changes.filter(change => change.before === null).map(change => ({ id: change.file, text: change.after })))
}
const draws = (project: readonly SourceFile[]) => {
  resetPipelineState()
  const result = compile({ projectId: 'copies', revision: 1, files: project, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}
const texts = (project: readonly SourceFile[]) => draws(project).renderTree?.nodes.flatMap(node => node.text?.runs.map(run => run.text) ?? []) ?? []

describe('finding copies', () => {
  it('finds the other view with the same shape, and says what differs', () => {
    const project = files(app([BADGE('person', 'Ana'), BADGE('star', 'Ben')].join('\n')))
    const found = copiesOf(project, nodeAt(project, 'HStack'))
    expect(found.eligible).toBe(true)
    expect(found.copies).toHaveLength(1)
    expect(found.copies[0]!.differences).toBe(2)
    expect(found.copies[0]!.values.map(value => [value.kind, value.role, value.text])).toEqual([['number', 'spacing', '8'], ['symbol', 'icon', '"star"'], ['text', 'title', '"Ben"'], ['number', 'padding', '12']])
  })

  it('never links a different shape: another modifier, another order, another view', () => {
    const cases = [
      `            HStack(spacing: 8) {\n                Image(systemName: "star")\n                Text("Ben")\n            }\n            .padding(12)\n            .opacity(0.5)`,
      `            HStack(spacing: 8) {\n                Text("Ben")\n                Image(systemName: "star")\n            }\n            .padding(12)`,
      `            VStack(spacing: 8) {\n                Image(systemName: "star")\n                Text("Ben")\n            }\n            .padding(12)`,
      `            HStack(spacing: 4) {\n                Image(systemName: "star")\n                Text("Ben")\n            }\n            .padding(12)`,
    ]
    // The first differs only by a modifier at the very end, which is the one
    // exception; the last differs in a number, which is a value, so it is a copy.
    const linked = cases.map(other => copiesOf(files(app([BADGE('person', 'Ana'), other].join('\n'))), nodeAt(files(app([BADGE('person', 'Ana'), other].join('\n'))), 'HStack')).copies.length)
    expect(linked).toEqual([1, 0, 0, 1])
  })

  it('leaves out views that are too small, and code it cannot rewrite', () => {
    const small = files(app('            Text("Hi")\n            Text("Ho")'))
    expect(copiesOf(small, nodeAt(small, 'Text'))).toMatchObject({ eligible: false, reason: expect.stringContaining('too small') })
    const commented = files(app([BADGE('person', 'Ana'), `            // a note\n${BADGE('star', 'Ben')}`].join('\n')))
    expect(copiesOf(commented, nodeAt(commented, 'HStack')).copies).toHaveLength(1)
    const interpolated = files(app([BADGE('person', 'Ana'), `            HStack(spacing: 8) {\n                Image(systemName: "star")\n                Text("\\(name)")\n            }\n            .padding(12)`].join('\n'), 'let name = "Ben"\n'))
    expect(copiesOf(interpolated, nodeAt(interpolated, 'HStack')).copies).toHaveLength(0)
  })

  it('skips views inside a component, which already follow a Main', () => {
    const component = `struct Badge: View {\n    var body: some View {\n        HStack(spacing: 8) {\n            Image(systemName: "person")\n            Text("Ana")\n        }\n        .padding(12)\n    }\n}\n`
    const project = files(app([BADGE('star', 'Ben'), '            Badge()'].join('\n'), component))
    expect(copiesOf(project, nodeAt(project, 'HStack')).copies).toHaveLength(0)
  })
})

describe('making the component', () => {
  const project = files(app([BADGE('person', 'Ana'), BADGE('star', 'Ben')].join('\n')))

  it('writes the Main with a parameter per differing value and replaces every copy', () => {
    const node = nodeAt(project, 'HStack')
    const copy = copiesOf(project, node).copies[0]!
    const next = edit(project, node, { kind: 'make-component', name: 'ProfileBadge', copies: [copy.id], screens: ['ContentView'] })
    const main = next.find(file => file.id === 'Sources/DesignSystem/Components/ProfileBadge.swift')!
    expect(main.text).toContain('struct ProfileBadge: View {\n    let icon: String\n    let title: String\n')
    expect(main.text).toContain('    var body: some View {\n        HStack(spacing: 8) {\n            Image(systemName: icon)')
    expect(main.text).toContain('Text(title)')
    // The padding is the same in both copies, so it stays inside the component.
    expect(main.text).toContain('.padding(12)')
    expect(next[0]!.text).toContain('ProfileBadge(icon: "person", title: "Ana")')
    expect(next[0]!.text).toContain('ProfileBadge(icon: "star", title: "Ben")')
    expect(texts(next)).toEqual(expect.arrayContaining(['Ana', 'Ben']))
  })

  it('keeps a copy’s extra trailing modifier on the call', () => {
    const withExtra = files(app([BADGE('person', 'Ana'), `${BADGE('star', 'Ben')}\n            .opacity(0.5)`].join('\n')))
    const node = nodeAt(withExtra, 'HStack')
    const copy = copiesOf(withExtra, node).copies[0]!
    const next = edit(withExtra, node, { kind: 'make-component', name: 'ProfileBadge', copies: [copy.id], screens: ['ContentView'] })
    expect(next[0]!.text).toContain('ProfileBadge(icon: "star", title: "Ben")\n            .opacity(0.5)')
    expect(next.find(file => file.id === 'Sources/DesignSystem/Components/ProfileBadge.swift')!.text).not.toContain('opacity')
    draws(next)
  })

  it('takes chosen parameter names and refuses a name that is taken', () => {
    const node = nodeAt(project, 'HStack')
    const copy = copiesOf(project, node).copies[0]!
    const next = edit(project, node, { kind: 'make-component', name: 'ProfileBadge', copies: [copy.id], names: { title: 'label' }, screens: ['ContentView'] })
    expect(next.find(file => file.id === 'Sources/DesignSystem/Components/ProfileBadge.swift')!.text).toContain('let label: String')
    expect(next[0]!.text).toContain('ProfileBadge(icon: "person", label: "Ana")')
    expect(() => edit(project, node, { kind: 'make-component', name: 'ContentView', copies: [copy.id], screens: ['ContentView'] })).toThrow(/unused component name/)
  })

  it('makes a button’s action a parameter, so each copy keeps doing its own thing', () => {
    const button = (title: string, value: string) => `            Button("${title}") { saved = ${value} }\n                .padding(8)\n                .background(Color.blue)`
    const buttons = files(app([button('Save', 'true'), button('Undo', 'false')].join('\n')).replace('    var body: some View {\n        VStack', '    @State private var saved = false\n    var body: some View {\n        VStack'))
    const node = nodeAt(buttons, 'Button')
    const copy = copiesOf(buttons, node).copies[0]!
    const next = edit(buttons, node, { kind: 'make-component', name: 'ActionButton', copies: [copy.id], screens: ['ContentView'] })
    const main = next.find(file => file.id === 'Sources/DesignSystem/Components/ActionButton.swift')!
    expect(main.text).toContain('let action: () -> Void')
    expect(main.text).toContain('Button(title) { action() }')
    // The blue background is the same on both, so it stays inside the component.
    expect(main.text).toContain('.background(Color.blue)')
    expect(next[0]!.text).toContain('ActionButton(title: "Save", action: { saved = true })')
    expect(texts(next)).toEqual(expect.arrayContaining(['Save', 'Undo']))
  })

  it('leaves the copies a designer unticked exactly as they were', () => {
    const three = files(app([BADGE('person', 'Ana'), BADGE('star', 'Ben'), BADGE('flag', 'Cal')].join('\n')))
    const node = nodeAt(three, 'HStack')
    const found = copiesOf(three, node).copies
    expect(found).toHaveLength(2)
    const next = edit(three, node, { kind: 'make-component', name: 'ProfileBadge', copies: [found[0]!.id], screens: ['ContentView'] })
    expect(next[0]!.text).toContain('ProfileBadge(icon: "star", title: "Ben")')
    expect(next[0]!.text).toContain('Text("Cal")')
    expect(texts(next)).toEqual(expect.arrayContaining(['Ana', 'Ben', 'Cal']))
  })
})

describe('what a component cannot take with it', () => {
  const screenState = (first: string, second: string) => files(app(`            ${first}\n            ${second}`).replace('    var body: some View {\n        VStack', '    @State private var saved = false\n    var body: some View {\n        VStack'))

  it('takes an action that reads the screen as a parameter, even when both copies do the same', () => {
    const button = (title: string) => `Button("${title}") { saved = true }\n                .padding(8)\n                .background(Color.blue)`
    const project = screenState(button('Save'), button('Keep'))
    const node = nodeAt(project, 'Button')
    const copy = copiesOf(project, node).copies[0]!
    const next = edit(project, node, { kind: 'make-component', name: 'SaveButton', copies: [copy.id], screens: ['ContentView'] })
    const main = next.find(file => file.id === 'Sources/DesignSystem/Components/SaveButton.swift')!
    expect(main.text).toContain('let action: () -> Void')
    expect(main.text).not.toContain('saved')
    expect(next[0]!.text).toContain('SaveButton(title: "Save", action: { saved = true })')
    draws(next)
  })

  it('says so plainly when the view reads a screen value it cannot pass', () => {
    const row = (label: string) => `HStack(spacing: 8) {\n                Text("${label}")\n                Text(saved ? "on" : "off")\n            }\n            .padding(12)`
    const project = screenState(row('One'), row('Two'))
    const node = nodeAt(project, 'HStack')
    const found = copiesOf(project, node)
    expect(found.copies).toHaveLength(1)
    expect(() => edit(project, node, { kind: 'make-component', name: 'StateRow', copies: [found.copies[0]!.id], screens: ['ContentView'] }))
      .toThrow(/uses “saved” from its screen/)
  })
})
