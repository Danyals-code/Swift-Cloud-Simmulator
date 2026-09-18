import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compile, applyEvent, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { buildAuthoringModel, planDesignEdit, validateResourceRemoval } from '@studio/swift-sema'
import { readImage, validateAssets, isPristine, emptyStudioMetadata, projectFromFiles } from '@studio/project-model'
import type { CompileResult } from '@studio/shared'

const app = (body: string, state = '') => `import SwiftUI
@main struct ReleaseApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { ${state} var body: some View { ${body} } }`
const text = (result: CompileResult) => result.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []) ?? []
beforeEach(() => resetPipelineState())

it.each([100, 1000])('keeps %i runtime records in one logical template and exports only real initial data', count => {
  const source = 'struct Item: Identifiable { let id: String; var title: String }\n' + app('List(items) { item in Text(item.title) }', `@State private var items: [Item] = [${Array.from({ length: count }, (_, i) => `Item(id: "${i}", title: "Record ${i}")`).join(',')}]\n`)
  const result = compile({ projectId: 'records', files: [{ id: 'Sources/App.swift', text: source }], revision: 1, colorScheme: 'light', canvas: { width: 393, height: 852 } })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  expect(result.authoring?.nodes.filter(n => n.kind === 'template')).toHaveLength(1)
  expect(result.authoring?.nodes.find(n => n.collection)?.collection?.records).toHaveLength(count)
  expect(text(result)).toContain(`Record ${count - 1}`)
})

it('handles deep supported layout without losing the leaf ownership', () => {
  const source = app('VStack { '.repeat(30) + 'Text("Deep leaf")' + ' }'.repeat(30))
  const result = compile({ projectId: 'deep', files: [{ id: 'Sources/App.swift', text: source }], revision: 1, colorScheme: 'light', canvas: { width: 393, height: 852 } })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  expect(text(result)).toContain('Deep leaf')
  expect(result.authoring?.nodes.find(n => n.name === 'Text')?.runtimeIds.length).toBeGreaterThan(0)
})

it('isolates state and retired action handlers through 50 project and scenario switches', () => {
  const source = app('VStack { Text("Count \\(count)"); Button("Increment") { count += 1 } }', '@State private var count = 0\n')
  const files = [{ id: 'Sources/App.swift', text: source }]
  const state = buildAuthoringModel({ files, projectId: 'p', revision: 1 }).inputs!.find(s => s.name === 'count')!
  let firstHandler: string | undefined
  for (let i = 0; i < 50; i++) {
    const result = compile({ projectId: `project-${Math.floor(i / 2) % 2}`, scenario: { name: `Zero-${i % 2}`, owner: 'ContentView', hook: '', inputs: [{ owner: state.owner, name: state.name, signature: state.signature, value: 0 }] }, files, revision: i * 2 + 1, colorScheme: 'light', canvas: { width: 393, height: 852 } })
    expect(text(result)).toContain('Count 0')
    const handler = result.renderTree?.nodes.find(n => n.hitTarget?.role === 'button')?.hitTarget?.handlerId
    expect(handler).toBeDefined()
    firstHandler ??= handler
    expect(applyEvent({ kind: 'tap', handlerId: handler!, location: { x: 0, y: 0 } })).toBe(true)
    expect(text(rerender(i * 2 + 2))).toContain('Count 1')
  }
  resetPipelineState()
  expect(applyEvent({ kind: 'tap', handlerId: firstHandler!, location: { x: 0, y: 0 } })).toBe(false)
})

it('does not discard catalog projects that acquired images or designer metadata', () => {
  const p = projectFromFiles([{ name: 'App.swift', text: app('Text("A")') }])!
  expect(isPristine(p)).toBe(true)
  expect(isPristine({ ...p, studio: { ...emptyStudioMetadata(), labels: [{ owner: 'ContentView', fingerprint: 'a', label: 'Home' }] } })).toBe(false)
  const light = readImage(new Uint8Array(readFileSync(new URL('./fixtures/authoring-photo.png', import.meta.url))))
  expect(isPristine({ ...p, assets: [{ id: 'photo', name: 'Photo', scale: 1, light }] })).toBe(false)
})

it('accepts real JPEG bytes and rejects resource count/type limits before a transaction', () => {
  const jpeg = readImage(new Uint8Array(readFileSync(new URL('./fixtures/authoring-photo.jpg', import.meta.url))))
  expect(jpeg).toMatchObject({ width: 2, height: 1, mime: 'image/jpeg' })
  expect(() => readImage(jpeg.bytes.subarray(0, -2))).toThrow()
  expect(() => validateAssets(Array.from({ length: 65 }, (_, i) => ({ id: `id-${i}`, name: `Image${i}`, light: jpeg, scale: 1 as const })))).toThrow(/64/)
})

it('checks native API availability for shared-style creation without raising deployment targets', () => {
  const files = [{ id: 'Sources/App.swift', text: app('Text("A")') }]
  const node = buildAuthoringModel({ files, projectId: 'p', revision: 1 }).nodes.find(n => n.name === 'Text')!
  const result = planDesignEdit({ projectId: 'p', baseRevision: 1, scope: node.owner, deploymentTarget: '13.0', files, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'style-create', name: 'brand', style: 'color', value: 'mint' } })
  expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('iOS 15') })
})


it('prevents mixed import choices from leaving deleted bundled images referenced in Swift', () => {
  const files = [{ id: 'Sources/App.swift', text: app('Image("NewPhoto")') }]
  expect(validateResourceRemoval(files, ['NewPhoto'])).toContain('unresolved image reference')
  expect(validateResourceRemoval(files, ['OldPhoto'])).toBeNull()
  expect(validateResourceRemoval([{ id: files[0]!.id, text: 'let name = "Photo"\n' + app('Image(name)') }], ['Photo'])).toContain('Dynamic image names')
})

it('lets a designer replace an inserted system-symbol Image with a bundled image', () => {
  const files = [{ id: 'Sources/App.swift', text: app('Image(systemName: "star").resizable().frame(width: 20, height: 10)') }]
  const node = buildAuthoringModel({ files, projectId: 'p', revision: 1 }).nodes.find(n => n.name === 'Image')!
  const plan = planDesignEdit({ projectId: 'p', baseRevision: 1, scope: node.owner, files, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'asset-use', name: 'Photo' } })
  expect(plan.ok).toBe(true)
  if (plan.ok) expect(plan.changes[0]!.after).toBe(files[0]!.text.replace('systemName: "star"', '"Photo"'))
})
