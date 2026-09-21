import { describe, expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { Parser } from '@studio/swift-syntax'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { applyProjectTransaction, DocumentHistory, projectFromFiles } from '@studio/project-model'
import type { AuthoringNode, DesignEditRequest, ModifierOperation } from '@studio/shared'

const wrap = (body: string, declarations = '') => `import SwiftUI\n@main struct ModifierApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { ${declarations}\nvar body: some View { ${body} } }`
const files = (text: string) => [{ id: 'Sources/App.swift', text }]
function node(text: string, name = 'Text'): AuthoringNode {
  return buildAuthoringModel({ projectId: 'modifiers', revision: 1, files: files(text) }).nodes.find(n => n.name === name && n.kind !== 'definition')!
}
function request(text: string, operation: DesignEditRequest['operation'], name = 'Text'): DesignEditRequest {
  const selected = node(text, name)
  return { projectId: 'modifiers', baseRevision: 1, scope: selected.owner, files: files(text), target: selected.source, fingerprint: selected.fingerprint, operation }
}
function edit(text: string, operation: ModifierOperation, name = 'Text'): string {
  const plan = planDesignEdit(request(text, operation, name))
  expect(plan).toMatchObject({ ok: true })
  if (!plan.ok) throw new Error(plan.reason)
  const result = plan.changes[0]?.after ?? text
  expect(Parser.parse(result, 'Sources/App.swift').diagnostics).toEqual([])
  expect(plan.selection).toEqual({ file: 'Sources/App.swift', offset: node(text, name).source.start })
  return result
}

describe('source modifier inventory and writers', () => {
  it('inventories repeated, custom, lifecycle and view-content modifiers in actual source order', () => {
    const source = wrap('Text("Hello").padding(8).customThing().padding(8).background { Text("Backdrop") }.task { }.onAppear { }')
    const selected = node(source)
    expect(selected.modifiers?.map(m => m.name)).toEqual(['padding', 'customThing', 'padding', 'background', 'task', 'onAppear'])
    expect(new Set(selected.modifiers!.map(m => m.id)).size).toBe(6)
    expect(selected.modifiers!.map(m => m.category)).toEqual(['layout', 'custom', 'layout', 'appearance', 'behavior', 'behavior'])
    expect(selected.modifiers![0]!.capabilities.moveDown).toBe(false)
    expect(selected.modifiers![2]!.capabilities.moveUp).toBe(false)
    expect(selected.modifiers![4]!.capabilities.remove).toBe(false)
    expect(selected.modifierCatalog!.every(c => !c.available)).toBe(true)
  })
  it('associates controls with each occurrence and existing frame sizing with its Size card', () => {
    const selected = node(wrap('Text("Hello").padding(8).frame(width: 100, height: 50).padding(8)'))
    expect(selected.modifiers![0]!.controls.map(c => c.id)).toEqual(['modifier:0:0', 'modifier:0:advanced:edges'])
    expect(selected.modifiers![2]!.controls.map(c => c.id)).toEqual(['modifier:2:0', 'modifier:2:advanced:edges'])
    expect(selected.modifiers![1]!.controls.map(c => c.id)).toEqual(['modifier:1:0', 'modifier:1:1', 'fill:width', 'fill:height'])
    expect(selected.modifiers!.flatMap(m => m.controls).some(c => c.id.startsWith('add:'))).toBe(false)
  })
  it.each(['padding', 'frame', 'font', 'foregroundColor', 'background', 'cornerRadius', 'opacity', 'lineLimit'])('adds %s with a validated editable default', name => {
    const source = wrap('Text("Hello")')
    const result = edit(source, { kind: 'modifier-add', name })
    const modifier = node(result).modifiers![0]!
    expect(modifier.name).toBe(name)
    expect(modifier.controls.length).toBeGreaterThan(0)
    expect(modifier.capabilities.edit).toBe(true)
  })
  it('adds duplicate occurrences rather than overwriting an existing modifier', () => {
    const source = wrap('Text("Hello").padding(8)')
    expect(edit(source, { kind: 'modifier-add', name: 'padding' })).toBe(source.replace('.padding(8)', '.padding(8).padding(16)'))
  })
  it('moves a specific repeated occurrence across safe entries without changing other bytes', () => {
    const source = wrap('VStack { Text("🧑‍💻").padding(8)\n  .background(Color.blue)\n  .padding(12); Text("Sibling") }').replaceAll('\n', '\r\n')
    const selected = node(source)
    const result = edit(source, { kind: 'modifier-move', modifier: selected.modifiers![2]!.id, toIndex: 0 })
    expect(result).toBe(source.replace('.padding(8)\r\n  .background(Color.blue)\r\n  .padding(12)', '\r\n  .padding(12).padding(8)\r\n  .background(Color.blue)'))
  })
  it('duplicates and removes only the selected occurrence and can target an explicit insertion gap', () => {
    const source = wrap('Text("A").padding(8).background(Color.blue).padding(8)')
    const second = node(source).modifiers![2]!
    const duplicated = edit(source, { kind: 'modifier-duplicate', modifier: second.id })
    expect(duplicated).toBe(source.replace('.background(Color.blue).padding(8)', '.background(Color.blue).padding(8).padding(8)'))
    const removed = edit(duplicated, { kind: 'modifier-remove', modifier: node(duplicated).modifiers![3]!.id })
    expect(removed).toBe(source)
    const inserted = edit(source, { kind: 'modifier-add', name: 'opacity', before: node(source).modifiers![1]!.id })
    expect(inserted).toBe(source.replace('.background', '.opacity(1).background'))
  })
  it('preserves comments during value edits and refuses structural edits with ambiguous trivia', () => {
    const source = wrap('Text("A").padding(8) // padding explanation\n.background(Color.blue)')
    const selected = node(source), modifier = selected.modifiers![0]!
    expect(modifier.capabilities.edit).toBe(true)
    expect(modifier.capabilities.remove).toBe(false)
    const changed = planDesignEdit(request(source, { kind: 'property', control: modifier.controls[0]!.id, value: '24' }))
    expect(changed.ok && changed.changes[0]?.after).toBe(source.replace('padding(8)', 'padding(24)'))
    for (const operation of [ { kind: 'modifier-remove', modifier: modifier.id }, { kind: 'modifier-duplicate', modifier: modifier.id }, { kind: 'modifier-move', modifier: modifier.id, toIndex: 1 } ] as const) expect(planDesignEdit(request(source, operation))).toMatchObject({ ok: false })
    expect(edit(source, { kind: 'modifier-add', name: 'opacity' })).toBe(source.replace('.background(Color.blue)', '.background(Color.blue).opacity(1)'))
  })
  it('pins a modifier with a trailing same-line comment while retaining editable values', () => {
    const selected = node(wrap('Text("A").padding(8) // spacing comment\n'))
    expect(selected.modifiers![0]!.capabilities).toMatchObject({ edit: true, remove: false, duplicate: false })
  })
  it('keeps image and shape operations pinned and rejects crossing them or inserting before them', () => {
    for (const [name, body] of [['Image', 'Image(systemName: "star").resizable().frame(width: 80).opacity(0.8)'], ['Circle', 'Circle().fill(Color.red).padding(8).opacity(0.8)']] as const) {
      const source = wrap(body), modifiers = node(source, name).modifiers!
      expect(modifiers[0]!.capabilities.remove).toBe(false)
      expect(modifiers[1]!.capabilities.moveUp).toBe(false)
      expect(planDesignEdit(request(source, { kind: 'modifier-move', modifier: modifiers[1]!.id, toIndex: 0 }, name))).toMatchObject({ ok: false })
      expect(planDesignEdit(request(source, { kind: 'modifier-add', name: 'padding', before: modifiers[0]!.id }, name))).toMatchObject({ ok: false })
      // A new background lands in its slot - after size and padding, before opacity - so it
      // fills the sized box and fades with it. Pinned entries stay put.
      expect(edit(source, { kind: 'modifier-add', name: 'background' }, name)).toContain('.background(Color.blue).opacity(0.8)')
    }
  })
  it('supports visual modifiers on component instances without changing the shared definition', () => {
    const source = wrap('Card().padding(8)') + '\nstruct Card: View { var body: some View { Text("Shared") } }'
    const result = edit(source, { kind: 'modifier-add', name: 'background' }, 'Card')
    expect(result).toBe(source.replace('Card().padding(8)', 'Card().padding(8).background(Color.blue)'))
    expect(node(result, 'Card').modifiers![0]!.controls[0]?.value).toBe('8')
  })
  it('does not expose built-in constructor controls on a same-named custom component', () => {
    const source = wrap('VStack(spacing: 3).padding(8)') + '\nstruct VStack: View { let spacing: Int; var body: some View { Rectangle() } }'
    const selected = node(source, 'VStack')
    expect(selected.kind).toBe('component')
    expect(selected.controls?.some(c => ['layout', 'spacing', 'alignment'].includes(c.id))).toBe(false)
    expect(selected.controls?.some(c => c.id.startsWith('component:'))).toBe(true)
    expect(edit(source, { kind: 'modifier-add', name: 'background' }, 'VStack')).toContain('VStack(spacing: 3).padding(8).background(Color.blue)')
  })
  it('rejects stale occurrences, forged names, invalid destinations and unavailable deployment targets', () => {
    const source = wrap('Text("A").padding(8).opacity(0.5)'), selected = node(source)
    const old = request(source, { kind: 'modifier-remove', modifier: selected.modifiers![0]!.id })
    expect(planDesignEdit({ ...old, files: files(source.replace('padding(8)', 'padding(12)')) })).toMatchObject({ ok: false })
    expect(planDesignEdit(request(source, { kind: 'modifier-remove', modifier: 'forged' }))).toMatchObject({ ok: false })
    expect(planDesignEdit(request(source, { kind: 'modifier-add', name: 'padding(9).evil' }))).toMatchObject({ ok: false })
    for (const toIndex of [-1, 2, 0.5, NaN]) expect(planDesignEdit(request(source, { kind: 'modifier-move', modifier: selected.modifiers![0]!.id, toIndex }))).toMatchObject({ ok: false })
    expect(planDesignEdit({ ...request(source, { kind: 'modifier-add', name: 'padding' }), deploymentTarget: '12.0' })).toMatchObject({ ok: false })
  })
  it('commits a reorder atomically and history restores the exact original source', () => {
    const source = wrap('Text("Hello").padding(16).background(Color.blue)')
    const project = projectFromFiles([{ name: 'Sources/App.swift', text: source }])!
    const selected = node(source)
    const plan = planDesignEdit({ ...request(source, { kind: 'modifier-move', modifier: selected.modifiers![0]!.id, toIndex: 1 }), projectId: project.id })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.reason)
    const result = applyProjectTransaction(project, 1, plan)
    if (!result.ok) throw new Error('Transaction rejected')
    const history = new DocumentHistory()
    history.record(project, result.project, { file: selected.source.file, offset: selected.source.start }, plan.selection)
    expect(history.take('undo', result.project)?.project.files).toEqual(project.files)
    expect(history.take('redo', project)?.project.files).toEqual(result.project.files)
    resetPipelineState()
    const compiled = compile({ projectId: project.id, revision: 2, files: result.project.files, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
    expect(compiled.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(compiled.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? [])).toContain('Hello')
  })
  it('exports actual writer output covering the catalog, reorder, duplicate, removal, component and image constraints for native typechecking', () => {
    let source = wrap('VStack { Text("Native modifier stack"); Image(systemName: "star").resizable().frame(width: 40, height: 40); Circle().fill(Color.red); Card() }') + '\nstruct Card: View { var body: some View { Text("Shared card") } }'
    for (const name of ['padding', 'frame', 'font', 'foregroundColor', 'background', 'cornerRadius', 'opacity', 'lineLimit']) source = edit(source, { kind: 'modifier-add', name })
    source = edit(source, { kind: 'modifier-move', modifier: node(source).modifiers![0]!.id, toIndex: 4 })
    source = edit(source, { kind: 'modifier-duplicate', modifier: node(source).modifiers![4]!.id })
    source = edit(source, { kind: 'modifier-remove', modifier: node(source).modifiers![5]!.id })
    source = edit(source, { kind: 'modifier-add', name: 'padding' }, 'Image')
    source = edit(source, { kind: 'modifier-add', name: 'frame' }, 'Circle')
    source = edit(source, { kind: 'modifier-add', name: 'background' }, 'Card')
    const output = process.env.MODIFIER_NATIVE_SOURCE
    if (output) writeFileSync(output, source)
    expect(source).toContain('Card().background(Color.blue)')
  })
})
