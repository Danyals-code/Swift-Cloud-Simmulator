import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringNode, AuthoringOperation, SourceFile } from '@studio/shared'

/**
 * Two things a designer reaches for constantly: how a screen opens, and what a
 * screen's states switch.
 *
 * Changing how a screen opens is not a setting - a push and a sheet are different
 * Swift - so every case here reads the Swift that comes out and checks the project
 * still draws.
 */

const screen = (body: string, members = '') => `struct HomeScreen: View {\n${members}    var body: some View {\n        NavigationStack {\n            VStack(spacing: 12) {\n${body}\n            }\n        }\n    }\n}\nstruct DetailScreen: View {\n    var body: some View { Text("Detail") }\n}\n`
const app = (body: string, members = '') => `import SwiftUI\n@main\nstruct DemoApp: App {\n    var body: some Scene {\n        WindowGroup { HomeScreen() }\n    }\n}\n${screen(body, members)}`
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]

const model = (project: readonly SourceFile[]) => buildAuthoringModel({ projectId: 'nav', revision: 1, files: project, deploymentTarget: '17.0' })
const nodeOf = (project: readonly SourceFile[], name: string): AuthoringNode =>
  model(project).nodes.filter(n => n.name === name && n.kind !== 'definition').sort((a, b) => a.source.start - b.source.start)[0]!

function plan(project: readonly SourceFile[], node: AuthoringNode, operation: AuthoringOperation) {
  return planDesignEdit({ projectId: 'nav', baseRevision: 1, files: project, deploymentTarget: '17.0', scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
}
function edit(project: readonly SourceFile[], node: AuthoringNode, operation: AuthoringOperation) {
  const result = plan(project, node, operation)
  if (!result.ok) throw new Error(result.reason)
  return project.map(file => ({ ...file, text: result.changes.find(change => change.file === file.id)?.after ?? file.text }))
}
const draws = (project: readonly SourceFile[]) => {
  resetPipelineState()
  const result = compile({ projectId: 'nav', revision: 1, files: project, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}

describe('changing how a screen opens', () => {
  const pushed = () => files(app('                NavigationLink("Open detail", destination: DetailScreen())\n                    .padding(8)'))

  it('turns a push into a sheet, keeping the label and the modifiers that were there', () => {
    const next = edit(pushed(), nodeOf(pushed(), 'NavigationLink'), { kind: 'navigation-type', type: 'sheet' })
    expect(next[0]!.text).toContain('@State private var isDetailScreenPresented: Bool = false')
    expect(next[0]!.text).toContain('Button("Open detail") { isDetailScreenPresented = true }\n                    .padding(8)\n                    .sheet(isPresented: $isDetailScreenPresented) { DetailScreen() }')
    draws(next)
  })

  it('goes on to a full screen cover, and back to a push, with nothing left behind', () => {
    const sheet = edit(pushed(), nodeOf(pushed(), 'NavigationLink'), { kind: 'navigation-type', type: 'sheet' })
    const cover = edit(sheet, nodeOf(sheet, 'Button'), { kind: 'navigation-type', type: 'cover' })
    expect(cover[0]!.text).toContain('.fullScreenCover(isPresented: $isDetailScreenPresented) { DetailScreen() }')
    const back = edit(cover, nodeOf(cover, 'Button'), { kind: 'navigation-type', type: 'push' })
    expect(back[0]!.text).toContain('NavigationLink("Open detail", destination: DetailScreen())')
    expect(back[0]!.text).not.toContain('isDetailScreenPresented')
    // Its whole line goes: what was written before `var` would otherwise fall on the next declaration.
    expect(back[0]!.text).toContain('struct HomeScreen: View {\n    var body: some View {')
    expect(back[0]!.text).toContain('.padding(8)')
    draws(back)
  })

  it('refuses a button that does more than open the screen', () => {
    const busy = files(app('                Button("Open") { count += 1; isDetailScreenPresented = true }\n                    .sheet(isPresented: $isDetailScreenPresented) { DetailScreen() }', '    @State private var count = 0\n    @State private var isDetailScreenPresented = false\n'))
    expect(plan(busy, nodeOf(busy, 'Button'), { kind: 'navigation-type', type: 'push' })).toMatchObject({ ok: false, reason: expect.stringContaining('does more than open the screen') })
  })

  it('refuses a push where there is nothing to push onto', () => {
    const flat = files(`import SwiftUI\n@main\nstruct DemoApp: App {\n    var body: some Scene {\n        WindowGroup { HomeScreen() }\n    }\n}\nstruct HomeScreen: View {\n    @State private var isDetailScreenPresented = false\n    var body: some View {\n        Button("Open") { isDetailScreenPresented = true }\n            .sheet(isPresented: $isDetailScreenPresented) { DetailScreen() }\n    }\n}\nstruct DetailScreen: View {\n    var body: some View { Text("Detail") }\n}\n`)
    expect(plan(flat, nodeOf(flat, 'Button'), { kind: 'navigation-type', type: 'push' })).toMatchObject({ ok: false, reason: expect.stringContaining('needs a navigation container') })
  })

  it('keeps a value that something else on the screen still uses', () => {
    const shared = files(app('                Button("Open") { isDetailScreenPresented = true }\n                    .sheet(isPresented: $isDetailScreenPresented) { DetailScreen() }\n                Text(isDetailScreenPresented ? "Open" : "Closed")', '    @State private var isDetailScreenPresented = false\n'))
    const back = edit(shared, nodeOf(shared, 'Button'), { kind: 'navigation-type', type: 'push' })
    expect(back[0]!.text).toContain('@State private var isDetailScreenPresented = false')
    expect(back[0]!.text).toContain('NavigationLink("Open", destination: DetailScreen())')
    draws(back)
  })

  it('says how the screen opens, so the picker knows where it stands', () => {
    const link = nodeOf(pushed(), 'NavigationLink')
    expect(link.navigation?.type).toBe('push')
  })
})

describe('giving a screen something to switch', () => {
  const plain = () => files(app('                Text("Hello")'))

  it('adds a value to the screen, which is what a state changes', () => {
    const definition = model(plain()).nodes.find(node => node.kind === 'definition' && node.name === 'HomeScreen')!
    const next = edit(plain(), definition, { kind: 'value-create', name: 'loading', value: false })
    expect(next[0]!.text).toContain('struct HomeScreen: View {\n    @State private var loading: Bool = false\n    var body: some View {')
    // The new value is what the States list offers to switch.
    expect(model(next).inputs?.map(input => [input.owner, input.name, input.type, input.value])).toContainEqual(['HomeScreen', 'loading', 'Bool', false])
    draws(next)
  })

  it('refuses a name the screen already uses, and an unusable one', () => {
    const definition = model(plain()).nodes.find(node => node.kind === 'definition' && node.name === 'HomeScreen')!
    const once = edit(plain(), definition, { kind: 'value-create', name: 'loading', value: false })
    const again = model(once).nodes.find(node => node.kind === 'definition' && node.name === 'HomeScreen')!
    expect(plan(once, again, { kind: 'value-create', name: 'loading', value: true })).toMatchObject({ ok: false, reason: expect.stringContaining('already has something called') })
    expect(plan(plain(), definition, { kind: 'value-create', name: '2fast', value: true })).toMatchObject({ ok: false, reason: expect.stringContaining('letters and numbers') })
  })
})
