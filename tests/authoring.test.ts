import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildAuthoringModel } from '@studio/swift-sema'
import { AUTHORING_CAPABILITIES, bindAuthoringRuntime, reconcileAuthoringSelection, type AuthoringSnapshot, type SourceFile } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { emptyStudioMetadata, MemoryProjectStore, projectFromFiles, readStudioMetadata } from '@studio/project-model'
import { buildExportBundle } from '@studio/exporter'

const wrap = (body: string) => `import SwiftUI\n@main struct TestApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { ${body} } }`
const files = (text: string, id = 'Main.swift'): SourceFile[] => [{ id, text }]
const model = (text: string, revision = 1, id = 'Main.swift', projectId = 'p') => buildAuthoringModel({ files: files(text, id), projectId, revision })
const views = (snapshot: AuthoringSnapshot, name: string) => snapshot.nodes.filter(n => n.name === name && n.kind !== 'definition')
const prop = (snapshot: AuthoringSnapshot, expr: string) => snapshot.nodes.flatMap(n => n.properties).find(p => p.expression === expr)
const fixture = readFileSync(new URL('./fixtures/authoring-core.swift', import.meta.url), 'utf8')

describe('source-aware authoring', () => {
  it('classifies literals, parameters, bindings, tokens and computed expressions independently of evaluation', () => {
    const snapshot = model(fixture)
    expect(snapshot.diagnostics).toEqual([])
    expect(prop(snapshot, '"Catalog"')?.valueKind).toBe('literal')
    expect(prop(snapshot, 'title')?.valueKind).toBe('component-argument')
    expect(prop(snapshot, '$favorite')?.valueKind).toBe('data-binding')
    expect(prop(snapshot, 'StudioStyle.spacing')?.valueKind).toBe('token')
    expect(prop(snapshot, 'price.formatted()')?.valueKind).toBe('computed')
    expect(snapshot.nodes.flatMap(n => n.properties).filter(p => ['data-binding', 'component-argument', 'computed', 'unsupported'].includes(p.valueKind)).every(p => p.writable === false)).toBe(true)
    expect(prop(snapshot, '"Catalog"')?.writable).toBe(true)
    const row = views(snapshot, 'ProductRow')[0]!
    expect(row.definitionId).toBe(snapshot.nodes.find(n => n.kind === 'definition' && n.name === 'ProductRow')?.id)
    expect(row.properties[0]?.scope).toBe('instance')
  })

  it('keeps modifier order, repeated properties, comments, strings and source bytes intact', () => {
    const text = wrap(String.raw`VStack { Text("🧑‍💻 quote: \"x\"") /* retain */ .padding(8).background(.blue).padding(.horizontal, 12) }`)
    const input = files(text)
    const before = JSON.stringify(input)
    const snapshot = buildAuthoringModel({ files: input, projectId: 'p', revision: 1 })
    expect(views(snapshot, 'Text')[0]?.properties.map(p => p.name)).toEqual(['content', 'padding', 'background', 'padding', 'padding', 'font'])
    expect(JSON.stringify(input)).toBe(before)
    expect(model(text)).toEqual(snapshot)
  })

  it('resolves lexical shadowing without treating local values as shared tokens', () => {
    const snapshot = model('import SwiftUI\nstruct Screen: View { let title: String; var body: some View { VStack { let title = "Local"; Text(title) }; Text(title) } }')
    const properties = views(snapshot, 'Text').map(n => n.properties[0]!)
    expect(properties.map(p => p.valueKind)).toEqual(['computed', 'component-argument'])
    expect(properties[0]?.declaration).not.toEqual(properties[1]?.declaration)
  })

  it('shows inherited style origin and preserves unsupported modifiers beside supported properties', () => {
    const snapshot = model(wrap('VStack { Text("Hello").customEffect(3).padding(8) }.font(.title)'))
    const text = views(snapshot, 'Text')[0]!
    expect(text.properties.find(p => p.name === 'customEffect')?.valueKind).toBe('unsupported')
    expect(text.properties.find(p => p.name === 'padding')?.valueKind).toBe('literal')
    expect(text.properties.find(p => p.name === 'font')).toMatchObject({ valueKind: 'inherited', expression: '.title', ownerId: views(snapshot, 'VStack')[0]?.id })
  })

  it('maps one source template to 100 runtime rows and keeps static siblings distinct', () => {
    resetPipelineState()
    const result = compile({ projectId: 'rows', files: files(wrap('VStack { ForEach(0..<100, id: \\.self) { index in Text(index.description) }; Text("A"); Text("B") }')), canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 1 })
    const snapshot = result.authoring!
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(views(snapshot, 'Row template')).toHaveLength(1)
    const texts = views(snapshot, 'Text')
    expect(texts).toHaveLength(3)
    expect(texts[0]?.runtimeIds).toHaveLength(100)
    expect(texts[0]?.properties[0]).toMatchObject({ valueKind: 'data-binding', scope: 'template' })
    expect(new Set(texts.map(n => n.id)).size).toBe(3)
  })

  it('does not interpret action closures as view-builder content', () => {
    const snapshot = model(wrap('VStack { Button("Go") { let x = Text("not a layer") }; Text("A") }'))
    expect(views(snapshot, 'Text')).toHaveLength(1)
  })

  it('keeps inactive branches in the source model and does not invent runtime instances', () => {
    const snapshot = model(wrap('if true { Text("A") } else { Text("B") }'))
    expect(views(snapshot, 'Text')).toHaveLength(2)
    const a = views(snapshot, 'Text')[0]!
    const bound = bindAuthoringRuntime(snapshot, [{ id: 'runtime-a', name: 'A', type: 'Text', source: a.source, children: [] }])
    expect(bound.runtimeToSource['runtime-a']).toBe(a.id)
    expect(views(bound, 'Text')[1]?.runtimeIds).toEqual([])
  })

  it('does not resolve duplicate component definitions to whichever file came first', () => {
    const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files: [{ id: 'A.swift', text: 'struct Card: View { var body: some View { Text("A") } }' }, { id: 'B.swift', text: 'struct Card: View { var body: some View { Text("B") } }' }, ...files(wrap('Card()'))] })
    const call = views(snapshot, 'Card')[0]!
    expect(call.definitionId).toBeUndefined()
    expect(call.properties[0]?.reason).toContain('ambiguous')
  })

  it('retains invalid source as read-only diagnostics without mutating it', () => {
    const text = wrap('Text("hello").padding(')
    const input = files(text)
    const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files: input })
    expect(snapshot.diagnostics.length).toBeGreaterThan(0)
    expect(input[0]?.text).toBe(text)
    expect(snapshot.nodes.flatMap(n => n.properties).every(p => !p.writable)).toBe(true)
  })

  it('represents standalone preview builders without pretending to execute other macros', () => {
    const snapshot = model('import SwiftUI\n#Preview { VStack { Text("Preview") } }')
    expect(snapshot.nodes.find(n => n.kind === 'definition')?.name).toBe('#Preview')
    expect(views(snapshot, 'Text')[0]?.owner).toBe('#Preview')
  })

  it('does not mistake private stored values or custom initializer behavior for exposed parameters', () => {
    const snapshot = model('struct Card: View { private let title = "Private"; init() {} ; var body: some View { Text(title) } }')
    expect(prop(snapshot, 'title')?.valueKind).toBe('computed')
  })

  it('does not select a shared token from duplicate declarations', () => {
    const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files: [
      { id: 'A.swift', text: 'enum Style { static let gap = 10 }' },
      { id: 'B.swift', text: 'enum Style { static let gap = 20 }' },
      ...files(wrap('VStack(spacing: Style.gap) { Text("A") }')),
    ] })
    expect(prop(snapshot, 'Style.gap')?.valueKind).toBe('unsupported')
    expect(prop(snapshot, 'Style.gap')?.declaration).toBeUndefined()
  })

  it('keeps a modifier without arguments tied to its source location', () => {
    const text = wrap('Text("A").bold()')
    const snapshot = model(text)
    const bold = views(snapshot, 'Text')[0]?.properties.find(p => p.name === 'bold')
    expect(text.slice(bold!.source!.start, bold!.source!.end)).toBe('bold')
  })
})

describe('selection reconciliation', () => {
  const before = wrap('VStack { Text("A"); Text("B") }')
  const initial = model(before)
  const node = views(initial, 'Text')[1]!
  const selection = { snapshot: initial, nodeId: node.id, files: files(before) }
  it.each([
    ['insert lines', '\n// inserted\n' + before, 'Main.swift'],
    ['rename file', before, 'Renamed.swift'],
    ['move view', wrap('VStack { Text("B"); Text("A") }'), 'Main.swift'],
    ['edit literal', before.replace('"B"', '"Updated"'), 'Main.swift'],
  ])('reconciles %s', (_name, after, fileId) => {
    const next = model(after, 2, fileId)
    const resolved = reconcileAuthoringSelection(selection, next, files(after, fileId))
    expect(resolved?.properties[0]?.expression).toBe(after.includes('Updated') ? '"Updated"' : '"B"')
  })
  it('clears deleted, ambiguous and cross-project selections', () => {
    for (const after of [wrap('VStack { Text("A") }'), wrap('VStack { Text("B"); Text("B") }')]) expect(reconcileAuthoringSelection(selection, model(after, 2), files(after))).toBeNull()
    expect(reconcileAuthoringSelection(selection, model(before, 2, 'Main.swift', 'other'), files(before))).toBeNull()
    expect(reconcileAuthoringSelection(selection, model(before, 0), files(before))).toBeNull()
  })
  it('never substitutes a surviving identical sibling for a deleted one', () => {
    const text = wrap('VStack { Text("Same"); Text("Same") }')
    const old = model(text)
    const after = wrap('VStack { Text("Same") }')
    for (const node of views(old, 'Text')) {
      const selected = { snapshot: old, nodeId: node.id, files: files(text) }
      expect(reconcileAuthoringSelection(selected, model(after, 2), files(after))).toBeNull()
    }
  })
})

describe('project metadata and capability contract', () => {
  it('reads legacy, current, invalid and future metadata without changing the input', () => {
    expect(readStudioMetadata(undefined)).toEqual({ status: 'missing' })
    expect(readStudioMetadata(emptyStudioMetadata()).status).toBe('valid')
    expect(readStudioMetadata({ schemaVersion: 2 })).toEqual({ status: 'unsupported', version: 2 })
    expect(readStudioMetadata({ ...emptyStudioMetadata(), canvas: [{ screen: 'A', x: NaN, y: 0 }] }).status).toBe('invalid')
  })
  it('round-trips metadata through storage without changing source or native export', async () => {
    const project = projectFromFiles([{ name: 'Main.swift', text: fixture }], 0)!
    const store = new MemoryProjectStore()
    const next = { ...project, studio: { ...emptyStudioMetadata(), labels: [{ owner: 'CatalogScreen', fingerprint: 'source', label: 'Catalog' }] } }
    await store.save(next)
    expect((await store.load(next.id))?.studio).toEqual(next.studio)
    expect((await store.load(next.id))?.files).toEqual(project.files)
    expect(buildExportBundle(next)).toEqual(buildExportBundle(project))
  })
  it('keeps editing and native verification separate from preview recognition', () => {
    expect(new Set(AUTHORING_CAPABILITIES.map(c => c.id)).size).toBe(AUTHORING_CAPABILITIES.length)
    expect(AUTHORING_CAPABILITIES.every(c => ['planned', 'subset'].includes(c.editing) && c.native === 'unverified' && c.forms.length > 0 && c.writeRule.length > 0)).toBe(true)
  })
})
