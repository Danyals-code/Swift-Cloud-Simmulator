import { expect, it } from 'vitest'
import { decodeProject, encodeProject, MemoryProjectStore } from '@studio/project-model'
import { createDefaultProject } from '@studio/project-model/templates'
import { hideView, showView, insertView } from '@studio/swift-syntax'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { insertionLayer } from '../apps/web/lib/layers'
import type { CompileResult } from '@studio/shared'

it('keeps two separately opened share links as separate saved projects', async () => {
  const original = createDefaultProject()
  const first = decodeProject(encodeProject(original)!, 1)!
  const second = decodeProject(encodeProject({ ...original, manifest: { ...original.manifest, name: 'SecondApp' } })!, 2)!
  const storage = new MemoryProjectStore()
  await storage.save(first)
  await storage.save(second)
  expect((await storage.list()).map(p => p.name)).toHaveLength(2)
})

it('restores a hidden view without uncommenting the following ordinary comment', () => {
  const source = 'struct ContentView: View {\n    var body: some View {\n        VStack {\n            Text("A")\n            // Keep this comment\n            Text("B")\n        }\n    }\n}\n'
  const hidden = hideView(source, 'Sources/App.swift', source.indexOf('Text("A")'))!
  const shown = showView(hidden.text, 'Sources/App.swift', hidden.offset)!
  expect(shown.text).toBe(source)
})

it('preserves a trailing modifier closure when adding to an empty stack', () => {
  const source = 'struct ContentView: View {\n    var body: some View {\n        VStack { }.background { Color.red }\n    }\n}\n'
  const edited = insertView(source, 'Sources/App.swift', source.indexOf('VStack'), 'Text("Added")')!
  expect(edited.text).toContain('.background { Color.red }')
})

const textOf = (result: CompileResult) => result.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []).join(' ')
it('resets global mutable state when changing to a project with identical sources', () => {
  resetPipelineState()
  const request = {
    files: [{ id: 'Sources/App.swift', text: 'import SwiftUI\nvar count = 0\n@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { Button("Count \\(count)") { count += 1 } } }' }],
    canvas: { width: 393, height: 852 }, colorScheme: 'light' as const, revision: 1,
  }
  const initial = compile({ ...request, projectId: 'first' })
  expect(initial.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  expect(textOf(initial)).toContain('Count 0')
  const button = initial.renderTree!.nodes.find(n => n.hitTarget?.role === 'button')!
  applyEvent({ kind: 'tap', handlerId: button.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  expect(textOf(rerender(2))).toContain('Count 1')
  expect(textOf(compile({ ...request, projectId: 'second', revision: 3 }))).toContain('Count 0')
})

it('resets global mutable state when Run resets the already loaded program', () => {
  resetPipelineState()
  const request = {
    projectId: 'run-probe',
    files: [{ id: 'Sources/Run.swift', text: 'import SwiftUI\nvar tally = 0\n@main struct RunApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { Button("Tally \\(tally)") { tally += 1 } } }' }],
    canvas: { width: 393, height: 852 }, colorScheme: 'light' as const, revision: 4,
  }
  const initial = compile(request)
  expect(textOf(initial)).toContain('Tally 0')
  const button = initial.renderTree!.nodes.find(n => n.hitTarget?.role === 'button')!
  applyEvent({ kind: 'tap', handlerId: button.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  expect(textOf(rerender(5))).toContain('Tally 1')
  resetPipelineState()
  expect(textOf(rerender(6))).toContain('Tally 0')
})

it('preserves ordinary comments after a legacy hidden-view marker', () => {
  const source = 'struct V: View { var body: some View {\n  VStack {\n    // hidden by Swift Web Studio\n    // Text("A")\n    // Keep this comment\n    Text("B")\n  }\n} }'
  const shown = showView(source, 'App.swift', source.indexOf('// hidden') - 4)!
  expect(shown.text).toContain('    Text("A")\n    // Keep this comment\n')
})


it('adds to the visible screen instead of creating an accidental sibling tab', () => {
  const source = `import SwiftUI
@main struct Example: App { var body: some Scene { WindowGroup { Root() } } }
struct Root: View { var body: some View {
  TabView {
    Tab("First", systemImage: "star", value: 0) { FirstView() }
    Tab("Second", systemImage: "star", value: 1) { Text("Second") }
  }
} }
struct FirstView: View { var body: some View {
  VStack { Text("First content") }
} }`
  const request = { projectId: 'insertion-target', files: [{ id: 'App.swift', text: source }], canvas: { width: 393, height: 852 }, colorScheme: 'light' as const, revision: 10 }
  const result = compile(request)
  const target = insertionLayer(result.viewHierarchy!)!
  const edited = insertView(source, 'App.swift', target.source!.start, 'Text("Added")')!
  expect(edited.text.indexOf('Text("Added")')).toBeGreaterThan(edited.text.indexOf('struct FirstView'))
  const after = compile({ ...request, files: [{ id: 'App.swift', text: edited.text }], revision: 11 })
  expect(textOf(after)).toContain('Added')
})
