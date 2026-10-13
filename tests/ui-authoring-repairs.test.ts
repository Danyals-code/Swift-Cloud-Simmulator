import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { layerMoveProblem, type AuthoringNode, type DesignEditRequest } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'

const source = (body: string) => `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { @State var title = "Title"; var body: some View { ${body} } }`
const files = (text: string) => [{ id: 'App.swift', text }]
const model = (text: string) => buildAuthoringModel({ projectId: 'repairs', revision: 1, files: files(text) })
const node = (text: string, name: string) => model(text).nodes.find(item => item.name === name && item.kind !== 'definition')!
function edit(text: string, selected: AuthoringNode, operation: DesignEditRequest['operation']) {
  return planDesignEdit({ projectId: 'repairs', baseRevision: 1, files: files(text), scope: selected.owner, target: selected.source, fingerprint: selected.fingerprint, operation })
}
function after(text: string, selected: AuthoringNode, operation: DesignEditRequest['operation']) {
  const plan = edit(text, selected, operation)
  if (!plan.ok) throw new Error(plan.reason)
  return plan.changes[0]?.after ?? text
}
function render(text: string) {
  const result = compile({ projectId: 'repairs', revision: 1, files: files(text), canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  return result
}
beforeEach(resetPipelineState)

describe('stable layout control', () => {
  it('keeps a reason visible for axis-specific alignment, then permits a change after Center', () => {
    let text = source('HStack(alignment: .top, spacing: 12) { Text("A"); Text("B") }')
    const row = node(text, 'HStack')
    expect(row.controls?.find(control => control.id === 'layout')?.disabledReason).toContain('Center')
    expect(edit(text, row, { kind: 'property', control: 'layout', value: 'Column' })).toMatchObject({ ok: false })
    text = after(text, row, { kind: 'property', control: 'alignment', value: 'center' })
    expect(node(text, 'HStack').controls?.find(control => control.id === 'layout')?.disabledReason).toBeUndefined()
    text = after(text, node(text, 'HStack'), { kind: 'property', control: 'layout', value: 'Column' })
    expect(text).toContain('VStack(alignment: .center, spacing: 12)')
    render(text)
  })
  it('normalizes qualified Center without dropping spacing comments or modifiers', () => {
    const text = source('HStack(alignment: VerticalAlignment.center, spacing: 12 /* keep */) { Text("A") }.padding(4)')
    const result = after(text, node(text, 'HStack'), { kind: 'property', control: 'layout', value: 'Column' })
    expect(result).toBe(text.replace('HStack', 'VStack').replace('VerticalAlignment.center', '.center'))
    render(result)
  })
})

describe('layer move destinations', () => {
  it('offers lazy containers while excluding descendants and branch escapes', () => {
    const text = source('VStack { Text("A"); LazyVStack { Text("B") }; if true { HStack {} } }')
    const snapshot = model(text), a = snapshot.nodes.find(item => item.name === 'Text')!
    const lazy = snapshot.nodes.find(item => item.name === 'LazyVStack')!
    const outer = snapshot.nodes.find(item => item.name === 'VStack')!
    expect(layerMoveProblem(snapshot.nodes, [a.id], lazy)).toBeNull()
    expect(layerMoveProblem(snapshot.nodes, [outer.id], lazy)).toContain('itself')
    expect(layerMoveProblem(snapshot.nodes, [a.id], snapshot.nodes.find(item => item.name === 'HStack')!)).toContain('same screen')
    const changed = after(text, a, { kind: 'layer-reparent', ids: [a.id], destination: lazy.id })
    const moved = model(changed), movedA = moved.nodes.find(item => item.controls?.some(control => control.value === 'A'))!
    expect(moved.nodes.find(item => item.id === movedA.parentId)?.name).toBe('LazyVStack')
    render(changed)
  })
  it('excludes nonadjacent selections and shadowing components named like containers', () => {
    const text = source('VStack { Text("A"); Text("B"); Text("C"); HStack {} }')
    const snapshot = model(text), texts = snapshot.nodes.filter(item => item.name === 'Text')
    const row = snapshot.nodes.find(item => item.name === 'HStack')!
    expect(layerMoveProblem(snapshot.nodes, [texts[0]!.id, texts[2]!.id], row)).toContain('adjacent')
    expect(layerMoveProblem(snapshot.nodes, [texts[0]!.id], { ...row, kind: 'component' })).not.toBeNull()
  })
})

describe('editable card layout', () => {
  it('applies a custom card fill in one edit and retains title, content and outer modifiers', () => {
    const text = source('GroupBox("Title") { Text("Body") }.shadow(radius: 4)')
    const changed = after(text, node(text, 'GroupBox'), { kind: 'card-customize', color: '#DBEAFE' })
    expect(changed).toContain('.background(Color(red: 0.859, green: 0.918, blue: 0.996))')
    expect(changed).toContain('.clipShape(.rect(cornerRadius: 8)).shadow(radius: 4)')
    expect(changed).toContain('Text("Title").font(.headline)')
    expect(changed).toContain('Text("Body")')
    expect(node(changed, 'VStack').styles?.some(style => style.kind === 'color' && style.value?.toUpperCase() === '#DBEAFE')).toBe(true)
    render(changed)
  })
  it('exposes an existing background when customizing, including rounded corners', () => {
    const text = source('GroupBox("Title") { Text("Body") }.background(Color.red).opacity(0.8)')
    const changed = after(text, node(text, 'GroupBox'), { kind: 'card-customize' })
    expect(changed).not.toContain('secondarySystemBackground')
    expect(changed).toContain('.background(Color.red)')
    expect(changed).toMatch(/\.background\(Color.red\)\s*\.clipShape\(\.rect\(cornerRadius: 8\)\)\.opacity\(0.8\)/)
    render(changed)
  })
  it('replaces an existing color without stacking opaque card surfaces', () => {
    const text = source('GroupBox("Title") { Text("Body") }.background(Color.red).opacity(0.8)')
    const changed = after(text, node(text, 'GroupBox'), { kind: 'card-customize', color: '#DBEAFE' })
    expect(changed.match(/\.background\(/g)).toHaveLength(1)
    expect(changed).not.toContain('Color.red)')
    expect(changed).toContain('Color(red: 0.859, green: 0.918, blue: 0.996)')
    render(changed)
  })
  it('rejects invalid fill values and preserves the source', () => {
    const text = source('GroupBox("Title") { Text("Body") }')
    expect(edit(text, node(text, 'GroupBox'), { kind: 'card-customize', color: 'red); fatalError()' })).toMatchObject({ ok: false })
  })

  it('preserves title expressions, body comments, siblings and outer modifiers', () => {
    const text = source('VStack { GroupBox(title) {\n // keep this explanation\n Text("Body")\n }.opacity(0.8); Text("Sibling") }')
    const changed = after(text, node(text, 'GroupBox'), { kind: 'card-customize' })
    expect(changed).toContain('Text(title).font(.headline)')
    expect(changed).toContain('// keep this explanation')
    expect(changed).toContain('.clipShape(.rect(cornerRadius: 8)).opacity(0.8); Text("Sibling")')
    const card = model(changed).nodes.filter(item => item.name === 'VStack')[1]!
    expect(card.controls?.find(control => control.id === 'alignment')?.value).toBe('leading')
    expect(card.modifiers?.find(modifier => modifier.name === 'padding')?.controls.some(control => control.value === '16')).toBe(true)
    const drawn = render(changed)
    expect(drawn.renderTree?.nodes.flatMap(item => item.text?.runs.map(run => run.text) ?? [])).toEqual(expect.arrayContaining(['Title', 'Body', 'Sibling']))
  })
  it('supports cards without a title and preserves closure labels', () => {
    for (const body of ['GroupBox { Text("Body") }', 'GroupBox { Text("Body") } label: { Text("Custom title") }']) {
      const text = source(body)
      render(after(text, node(text, 'GroupBox'), { kind: 'card-customize' }))
    }
  })
  it('refuses to discard comments attached to a constructor', () => {
    for (const body of ['GroupBox(/* keep */ "Title") { Text("Body") }', 'GroupBox { Text("Body") } /* keep */ label: { Text("Title") }']) {
      const text = source(body)
      expect(edit(text, node(text, 'GroupBox'), { kind: 'card-customize' })).toMatchObject({ ok: false, reason: expect.stringContaining('comments') })
    }
  })
  it('keeps custom card styles under source control', () => {
    const text = source('GroupBox("Title") { Text("Body") }.groupBoxStyle(.automatic)')
    expect(edit(text, node(text, 'GroupBox'), { kind: 'card-customize' })).toMatchObject({ ok: false, reason: expect.stringContaining('custom style') })
  })
})
