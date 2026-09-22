import { describe, expect, it, beforeEach } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { Parser } from '@studio/swift-syntax'
import { applyProjectTransaction, DocumentHistory, emptyStudioMetadata, projectFromFiles } from '@studio/project-model'
import { buildExportBundle } from '@studio/exporter'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringNode, DesignEditPlan, DesignEditRequest, SourceFile } from '@studio/shared'

const wrap = (body: string, declarations = '') => `import SwiftUI\n@main struct TestApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { ${declarations}\nvar body: some View { ${body} } }`
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
function target(text: string, name = 'Text', index = 0): AuthoringNode {
  return buildAuthoringModel({ projectId: 'p', revision: 1, files: files(text) }).nodes.filter(n => n.name === name && n.kind !== 'definition')[index]!
}
function plan(text: string, label: string, value: string, name = 'Text', index = 0): DesignEditPlan {
  const node = target(text, name, index)
  const control = node.controls?.find(c => c.label === label)
  expect(control, `${name}.${label}: ${JSON.stringify(node.controls)}`).toBeDefined()
  return planDesignEdit({ projectId: 'p', baseRevision: 1, scope: node.owner, files: files(text), target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property', control: control!.id, value } })
}
function edited(text: string, label: string, value: string, name = 'Text', index = 0): string {
  const result = plan(text, label, value, name, index)
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.reason)
  const next = result.changes[0]?.after ?? text
  expect(Parser.parse(next, 'Sources/App.swift').diagnostics).toEqual([])
  return next
}

beforeEach(resetPipelineState)
describe('R03/R04 minimal source recipes', () => {
  it('changes only the selected string, preserving CRLF, Unicode and comments', () => {
    const source = wrap('VStack { Text("🦊").padding(8) /* keep */; Text("Other") }').replaceAll('\n', '\r\n')
    expect(edited(source, 'Text', 'quote " \\(value)\n\t\u0001 🧑‍💻')).toBe(source.replace('"🦊"', '"quote \\" \\\\(value)\\n\\t\\u{1} 🧑‍💻"'))
    expect(plan(source, 'Text', '🦊')).toMatchObject({ ok: true, changes: [] })
  })
  it('edits the selected repeated modifier occurrence without flattening the chain', () => {
    const source = wrap('Text("A").padding(8) /* order */ .background(.blue).padding(.horizontal, 12)')
    expect(edited(source, 'padding · 3', '24')).toBe(source.replace('horizontal, 12', 'horizontal, 24'))
    expect(edited(source, 'padding · 1', '16')).toBe(source.replace('padding(8)', 'padding(16)'))
    expect(plan(source, 'padding · 1', '8.0')).toMatchObject({ ok: true, changes: [] })
  })
  it('preserves a binding while editing a nested font size', () => {
    const source = wrap('Text(title).font(.system(size: 14, weight: .bold, design: .rounded))', '@State var title = "Hello"')
    expect(target(source).controls?.some(c => c.label === 'Text')).toBe(false)
    expect(edited(source, 'Font size', '24')).toBe(source.replace('size: 14', 'size: 24'))
    expect(edited(source, 'Font weight', 'regular')).toBe(source.replace('weight: .bold', 'weight: .regular'))
  })
  it('does not expose computed, token or unsupported values as writable', () => {
    const source = wrap('Text(title.uppercased()).padding(gap).opacity(0.5)', 'let title = "A"; let gap = 8')
    const controls = target(source).controls!
    expect(controls.some(c => ['Text', 'padding'].includes(c.label))).toBe(false)
    expect(edited(source, 'opacity', '0.75')).toBe(source.replace('opacity(0.5)', 'opacity(0.75)'))
  })
  it.each(['NaN', 'Infinity', '1e999', '', '-', '1 + 2', '0); bad()', '2'])('rejects invalid opacity %j without changing any source', value => {
    expect(plan(wrap('Text("A").opacity(0.5)'), 'opacity', value)).toMatchObject({ ok: false })
  })
  it('inserts stack arguments in Swift order and retains comments', () => {
    const source = wrap('VStack(spacing: 12 /* spacing */) { Text("A") }')
    expect(edited(source, 'Alignment', 'leading', 'VStack')).toBe(source.replace('spacing: 12', 'alignment: .leading, spacing: 12'))
    expect(edited(wrap('VStack { Text("A") }'), 'Spacing', '24', 'VStack')).toContain('VStack(spacing: 24) {')
    expect(edited(wrap('HStack(/* c */) { Text("A") }'), 'Spacing', '24', 'HStack')).toContain('HStack(/* c */spacing: 24)')
  })
  it.each([
    ['Font size', '24', '.font(.system(size: 24))'],
    ['Padding', '12', '.padding(12)'],
    ['Background', 'blue', '.background(Color.blue)'],
    ['Text color', 'white', '.foregroundColor(Color.white)'],
    ['Corner radius', '8', '.cornerRadius(8)'],
    ['Opacity', '0.8', '.opacity(0.8)'],
    ['Accessibility label', 'Card', '.accessibilityLabel("Card")'],
    ['Accessibility identifier', 'card', '.accessibilityIdentifier("card")'],
    ['Fixed width', '240', '.frame(width: 240)'],
    ['Fixed height', '120', '.frame(height: 120)'],
  ])('writes the %s recipe as exact Swift', (label, value, suffix) => {
    const source = wrap('Text("A")')
    expect(edited(source, label, value)).toBe(source.replace('Text("A")', 'Text("A")' + suffix))
  })
  it('adds and removes a flexible frame without affecting padding order', () => {
    const source = wrap('Text("A").padding(8)')
    const filled = edited(source, 'Width sizing', 'Fill')
    expect(filled).toBe(source.replace('.padding(8)', '.padding(8).frame(maxWidth: .infinity)'))
    expect(edited(filled, 'Width sizing', 'Content')).toBe(source)
  })
  it('changes row/column/overlay constructors without moving child code', () => {
    const source = wrap('VStack { Text("A"); Text("B") }.padding(12)')
    expect(edited(source, 'Layout', 'Row', 'VStack')).toBe(source.replace('VStack', 'HStack'))
    expect(edited(source, 'Layout', 'Stack', 'VStack')).toBe(source.replace('VStack', 'ZStack'))
    expect(target(wrap('VStack(alignment: .leading) { Text("A") }'), 'VStack').controls?.find(c => c.id === 'layout')?.disabledReason).toContain('Center')
  })
})

describe('R05/R06 atomic transaction and identity checks', () => {
  it('rejects stale node identities and syntax recovery trees', () => {
    const source = wrap('Text("A")'), node = target(source)
    const request = { projectId: 'p', baseRevision: 1, scope: node.owner, files: files(source), target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property' as const, control: 'content', value: 'B' } }
    expect(planDesignEdit({ ...request, files: files(source.replace('"A"', '"B"')) })).toMatchObject({ ok: false })
    expect(planDesignEdit({ ...request, files: files(source + '\nstruct Broken {') })).toMatchObject({ ok: false })
    expect(planDesignEdit({ ...request, operation: { ...request.operation, control: 'forged-offset' } })).toMatchObject({ ok: false })
  })
  it('commits two files, file creation and metadata as one unit, or nothing on any failure', () => {
    const project = projectFromFiles([{ name: 'Sources/A.swift', text: 'A' }, { name: 'Sources/B.swift', text: 'B' }])!
    const metadata = { ...emptyStudioMetadata(), labels: [{ owner: 'A', fingerprint: 'a', label: 'Card' }] }
    const transaction = { projectId: project.id, baseRevision: 4, changes: [{ file: 'Sources/A.swift', before: 'A', after: 'AA' }, { file: 'Sources/B.swift', before: 'B', after: 'BB' }, { file: 'Sources/C.swift', before: null, after: 'C' }], studio: { before: undefined, after: metadata } }
    const result = applyProjectTransaction(project, 4, transaction)
    expect(result.ok && result.project.files.map(f => f.text)).toEqual(['AA', 'BB', 'C'])
    expect(result.ok && result.project.studio).toEqual(metadata)
    for (const invalid of [ { ...transaction, baseRevision: 3 }, { ...transaction, projectId: 'other' }, { ...transaction, changes: [...transaction.changes, { file: 'Sources/A.swift', before: 'A', after: 'bad' }] }, { ...transaction, changes: [transaction.changes[0]!, { file: 'Sources/B.swift', before: 'stale', after: 'BB' }] } ]) expect(applyProjectTransaction(project, 4, invalid)).toMatchObject({ ok: false })
    expect(project.files.map(f => f.text)).toEqual(['A', 'B'])
    expect(project.studio).toBeUndefined()
  })
  it('undoes mixed typing/design/file creation/metadata in order and preserves selection', () => {
    const original = projectFromFiles([{ name: 'Sources/App.swift', text: 'A' }])!
    const typed = { ...original, files: files('AB') }
    const designed = { ...typed, files: [...files('ABC'), { id: 'Sources/Other.swift', text: 'D' }], studio: emptyStudioMetadata() }
    const history = new DocumentHistory()
    const selected = { file: 'Sources/App.swift', offset: 0 }
    history.record(original, typed, null, selected, 'typing', 1)
    history.record(typed, designed, selected, selected, undefined, 2)
    const undoDesign = history.take('undo', designed)!
    expect(undoDesign.project.files).toEqual(typed.files)
    expect(undoDesign.project.studio).toBeUndefined()
    expect(undoDesign.selection).toEqual(selected)
    const undoTyping = history.take('undo', undoDesign.project)!
    expect(undoTyping.project.files).toEqual(original.files)
    expect(history.take('redo', undoTyping.project)!.project.files).toEqual(typed.files)
    expect(history.take('redo', typed)!.project.files).toEqual(designed.files)
    expect(history.take('undo', { ...designed, id: 'another' })).toBeNull()
  })
  it('groups contiguous typing and breaks grouping across undo, design edits and long pauses', () => {
    const a = projectFromFiles([{ name: 'Sources/App.swift', text: 'A' }])!, b = { ...a, files: files('AB') }, c = { ...a, files: files('ABC') }
    const h = new DocumentHistory()
    h.record(a, b, null, null, 'typing:App.swift', 0)
    h.record(b, c, null, null, 'typing:App.swift', 100)
    expect(h.take('undo', c)!.project.files).toEqual(a.files)
    h.record(a, b, null, null, 'typing:App.swift', 200)
    expect(h.take('redo', b)).toBeNull()
    h.record(b, c, null, null, 'typing:App.swift', 2000)
    expect(h.take('undo', c)!.project.files).toEqual(b.files)
  })
})

describe('R10/R16 source → preview → export', () => {
  it('renders the edited string, font and dimensions, exporting the exact committed file', () => {
    let source = wrap('Text("A")')
    source = edited(source, 'Text', 'Designer card')
    source = edited(source, 'Font size', '24')
    source = edited(source, 'Fixed width', '240')
    source = edited(source, 'Fixed height', '120')
    const result = compile({ projectId: 'p', revision: 5, files: files(source), canvas: { width: 393, height: 852 }, colorScheme: 'light' })
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    const text = result.renderTree?.nodes.find(n => n.text?.runs.some(r => r.text === 'Designer card'))
    expect(text).toBeDefined()
    expect(text!.text!.runs[0]!.font.size).toBe(24)
    const project = projectFromFiles([{ name: 'Sources/App.swift', text: source }])!
    const bundle = buildExportBundle(project)
    expect(new TextDecoder().decode([...bundle].find(([path]) => path.endsWith('/App.swift'))?.[1])).toBe(source)
  })
  it('uses source identity for structural moves and renders the resulting order', () => {
    const source = wrap('VStack { Text("A"); Text("B") }')
    const node = target(source)
    const moved = planDesignEdit({ projectId: 'p', baseRevision: 1, scope: node.owner, files: files(source), target: node.source, fingerprint: node.fingerprint, operation: { kind: 'move', direction: 1 } })
    expect(moved).toMatchObject({ ok: true })
    if (!moved.ok) return
    const result = compile({ files: files(moved.changes[0]!.after), canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 2 })
    expect(result.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? [])).toEqual(['B', 'A'])
  })
})

it('converts mixed frame dimensions without producing an invalid Swift overload', () => {
  const source = wrap('Text("A").padding(8).frame(width: 240, height: 120, alignment: .leading).background(.blue)')
  expect(edited(source, 'Width sizing', 'Fill')).toBe(source.replace('.frame(width: 240, height: 120, alignment: .leading)', '.frame(height: 120, alignment: .leading).frame(maxWidth: .infinity, alignment: .leading)'))
  expect(edited(source, 'Height sizing', 'Content')).toBe(source.replace(', height: 120', ''))
  expect(edited(edited(wrap('Text("A")'), 'Width sizing', 'Fixed'), 'frame · width', '180')).toContain('.frame(width: 180)')
})

it('keeps commented and computed sizing constraints while offering adjacent literal controls', () => {
  const source = wrap('Text("A").frame(width: width, height: 100).opacity(0.8)', 'let width: CGFloat = 240')
  expect(target(source).controls?.some(c => c.label === 'Width sizing')).toBe(false)
  expect(edited(source, 'frame · height', '120')).toBe(source.replace('height: 100', 'height: 120'))
  expect(target(wrap('Text("A").frame(width: 100 /* do not remove */)')).controls?.some(c => c.label === 'Width sizing')).toBe(false)
})

it('checks scope and deployment availability again during planning', () => {
  const source = wrap('Text("A")'), node = target(source)
  const request = { projectId: 'p', baseRevision: 1, files: files(source), target: node.source, fingerprint: node.fingerprint, scope: node.owner, operation: { kind: 'property' as const, control: 'add:foreground', value: 'mint' } }
  expect(planDesignEdit({ ...request, deploymentTarget: '14.0' })).toMatchObject({ ok: false })
  expect(planDesignEdit({ ...request, deploymentTarget: '15.0' })).toMatchObject({ ok: true })
  expect(planDesignEdit({ ...request, scope: 'DifferentOwner' })).toMatchObject({ ok: false })
  expect(buildAuthoringModel({ projectId: 'p', revision: 1, files: files(source), deploymentTarget: '13.0' }).nodes.flatMap(n => n.controls ?? []).some(c => c.id === 'add:accessibilityIdentifier')).toBe(false)
})

it('edits the default padding overload and reports template-wide scope', () => {
  const source = wrap('VStack { ForEach(0..<3, id: \\.self) { index in Text(index.description).padding() } }')
  expect(target(source).controls?.every(c => c.scope === 'All rows in this template')).toBe(true)
  expect(edited(source, 'Padding', '20')).toBe(source.replace('.padding()', '.padding(20)'))
})

it('keeps a fresh selection anchor for a later code edit after a design edit', async () => {
  const { reconcileAuthoringSelection } = await import('@studio/shared')
  const before = wrap('Text("A")'), result = plan(before, 'Padding', '16')
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const after = result.changes[0]!.after, snapshot = result.authoring!
  const node = snapshot.nodes.find(n => n.name === 'Text')!
  const later = '// new code\n' + after.replace('Text("A")', 'Text("B")')
  const next = buildAuthoringModel({ projectId: 'p', revision: 2, files: files(later) })
  // Two disjoint edits can intentionally clear the conservative anchor; a normal
  // code edit within the view must retain it.
  const within = after.replace('Text("A")', 'Text("B")')
  expect(reconcileAuthoringSelection({ snapshot, nodeId: node.id, files: files(after) }, buildAuthoringModel({ projectId: 'p', revision: 2, files: files(within) }), files(within))?.name).toBe('Text')
  expect(reconcileAuthoringSelection({ snapshot, nodeId: node.id, files: files(after) }, next, files(later))).toBeNull()
})

it('reparents across stack containers through the same planner, preserving source and action closures', () => {
  const source = wrap('VStack { Text("A"); HStack { Text("B"); Button("Run") { print("Keep") } } }')
  const a = target(source), b = target(source, 'Text', 1)
  const moved = planDesignEdit({ projectId: 'p', baseRevision: 1, scope: a.owner, files: files(source), target: a.source, fingerprint: a.fingerprint, operation: { kind: 'moveTo', targetOffset: b.source.start, position: 'after' } })
  expect(moved).toMatchObject({ ok: true })
  if (!moved.ok) return
  const next = moved.changes[0]!.after
  const model = buildAuthoringModel({ projectId: 'p', revision: 2, files: files(next) })
  const aNext = model.nodes.find(n => n.name === 'Text' && n.properties[0]?.expression === '"A"')!
  expect(model.nodes.find(n => n.id === aNext.parentId)?.name).toBe('HStack')
  expect(next).toContain('Button("Run") { print("Keep") }')
})

it.each(['light', 'dark'] as const)('reflects layout, padding and accessibility in the %s render tree', colorScheme => {
  let source = wrap('VStack { Text("Alpha"); Text("Beta") }')
  source = edited(source, 'Layout', 'Row', 'VStack')
  source = edited(source, 'Spacing', '32', 'HStack')
  source = edited(source, 'Accessibility identifier', 'alpha')
  const result = compile({ files: files(source), canvas: { width: 393, height: 852 }, colorScheme, revision: 1 })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  const texts = result.renderTree!.nodes.filter(n => n.text)
  const alpha = texts.find(n => n.text!.runs.some(r => r.text === 'Alpha'))!, beta = texts.find(n => n.text!.runs.some(r => r.text === 'Beta'))!
  expect(beta.frame.x - alpha.frame.x - alpha.frame.width).toBeCloseTo(32, 3)
  expect(beta.frame.y).toBeCloseTo(alpha.frame.y, 3)
})

it('plans atomic edits across files, rejecting malformed creations or one invalid command', async () => {
  const { planDesignBatch } = await import('@studio/swift-sema')
  const sources = [...files(wrap('Text("A")')), { id: 'Sources/Other.swift', text: 'import SwiftUI\nstruct Other: View { var body: some View { Text("Other") } }' }]
  const model = buildAuthoringModel({ projectId: 'p', revision: 1, files: sources })
  const commands = model.nodes.filter(n => n.name === 'Text').map(node => ({ projectId: 'p', baseRevision: 1, scope: node.owner, files: sources, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property' as const, control: 'content', value: 'Updated' } }))
  const newFile = { id: 'Sources/Style.swift', text: 'import SwiftUI\nenum Style { static let gap: CGFloat = 12 }' }
  const result = planDesignBatch(commands, [newFile])
  expect(result).toMatchObject({ ok: true, changes: [{ file: 'Sources/App.swift' }, { file: 'Sources/Other.swift' }, { file: 'Sources/Style.swift', before: null }] })
  expect(planDesignBatch(commands, [{ ...newFile, text: 'struct Broken {' }])).toMatchObject({ ok: false })
  expect(planDesignBatch([commands[0]!, { ...commands[1]!, fingerprint: 'stale' }], [newFile])).toMatchObject({ ok: false })
  expect(sources[0]!.text).toContain('Text("A")')
})

it('can re-edit generated qualified colors but never rewrites a shadowing user color declaration', () => {
  const source = edited(wrap('Text("A")'), 'Background', 'blue')
  expect(edited(source, 'background', 'red')).toBe(source.replace('Color.blue', 'Color.red'))
  const custom = wrap('Text("A").background(Color.blue)') + '\nstruct Color { static let blue = 42 }'
  expect(target(custom).controls?.some(c => c.label === 'background')).toBe(false)
})

it('edits scroll direction, indicator literals and basic shape fills without changing content', () => {
  const source = wrap('ScrollView(.vertical, showsIndicators: true) { Text("A") }')
  expect(edited(source, 'Scroll direction', 'horizontal', 'ScrollView')).toBe(source.replace('.vertical', '.horizontal'))
  expect(edited(source, 'Show indicators', 'false', 'ScrollView')).toBe(source.replace('showsIndicators: true', 'showsIndicators: false'))
  expect(edited(wrap('ScrollView { Text("A") }'), 'Scroll direction', 'horizontal', 'ScrollView')).toContain('ScrollView(.horizontal)')
  expect(edited(wrap('Rectangle().fill(Color.blue)'), 'fill', 'red', 'Rectangle')).toContain('Rectangle().fill(Color.red)')
})

it('withholds conversions for unknown frame overloads and avoids appending to unknown modifier results', () => {
  const unknownFrame = wrap('Text("A").frame(width: 100, maxHeight: 120)')
  expect(target(unknownFrame).controls?.some(c => c.id === 'fill:width')).toBe(false)
  const unknownChain = wrap('Text("A").customEffect(3).padding(8)')
  expect(target(unknownChain).controls?.some(c => c.id.startsWith('add:'))).toBe(false)
  expect(edited(unknownChain, 'padding', '12')).toBe(unknownChain.replace('padding(8)', 'padding(12)'))
})

it('prepares independent Apple compiler fixtures from the actual writer output', async () => {
  const forms = [
    ['Text("A")', 'Font size', '24', 'Text'],
    ['Text("A").font(.title)', 'Typography', 'body', 'Text'],
    ['Text("A").font(.system(size: 14, weight: .bold, design: .rounded))', 'Font weight', 'regular', 'Text'],
    ['Text("A")', 'Background', 'blue', 'Text'],
    ['Text("A").foregroundStyle(.red)', 'foregroundStyle', 'blue', 'Text'],
    ['Text("A")', 'Text color', 'white', 'Text'],
    ['Text("A").padding()', 'Padding', '12', 'Text'],
    ['Text("A").padding(.horizontal, 12)', 'padding', '24', 'Text'],
    ['Text("A")', 'Corner radius', '8', 'Text'],
    ['Text("A")', 'Opacity', '0.5', 'Text'],
    ['Text("A")', 'Accessibility label', 'Card', 'Text'],
    ['Text("A")', 'Accessibility identifier', 'card', 'Text'],
    ['Text("A").frame(width: 120, height: 60, alignment: .leading)', 'Width sizing', 'Fill', 'Text'],
    ['Text("A").frame(width: 120, height: 60, alignment: .leading)', 'Height sizing', 'Content', 'Text'],
    ['Text("A")', 'Height sizing', 'Fill', 'Text'],
    ['VStack(spacing: 12) { Text("A") }', 'Alignment', 'leading', 'VStack'],
    ['VStack { Text("A"); Text("B") }', 'Layout', 'Stack', 'VStack'],
    ['ScrollView(.vertical, showsIndicators: true) { Text("A") }', 'Show indicators', 'false', 'ScrollView'],
    ['RoundedRectangle(cornerRadius: 8)', 'Shape corner radius', '12', 'RoundedRectangle'],
    ['Rectangle().fill(Color.blue)', 'fill', 'red', 'Rectangle'],
    ['Spacer()', 'Minimum spacing', '8', 'Spacer'],
  ] as const
  const output: string[] = ['import SwiftUI']
  for (const [index, [body, label, value, name]] of forms.entries()) {
    const source = edited(wrap(body), label, value, name)
    const node = buildAuthoringModel({ files: files(source), projectId: 'p', revision: 1 }).nodes.find(n => n.owner === 'ContentView' && n.kind === 'view')!
    const expression = source.slice(node.source.start, node.source.end)
    output.push(`struct NativeWriterForm${index}: View { var body: some View { ${expression} } }`)
  }
  const destination = process.env.AUTHORING_WRITER_FORMS
  if (destination) {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, output.join('\n\n') + '\n')
  }
  expect(output).toHaveLength(forms.length + 1)
})

it.each([
  ['Image("old")', 'Asset name', 'new', 'Image("new")', 'Image'],
  ['Image(systemName: "star")', 'System symbol', 'heart', 'Image(systemName: "heart")', 'Image'],
  ['Button("Old") { print("action") }', 'Title', 'New', 'Button("New") { print("action") }', 'Button'],
  ['TextField("Old", text: $title)', 'Title', 'New', 'TextField("New", text: $title)', 'TextField'],
  ['Toggle("Old", isOn: $enabled)', 'Title', 'New', 'Toggle("New", isOn: $enabled)', 'Toggle'],
  ['Text("A").lineLimit(2)', 'lineLimit', '3', 'Text("A").lineLimit(3)', 'Text'],
  ['Text("A").multilineTextAlignment(.leading)', 'multilineTextAlignment', 'trailing', 'Text("A").multilineTextAlignment(.trailing)', 'Text'],
  ['Text("A").font(.system(size: 14, design: .rounded))', 'Font design', 'serif', 'Text("A").font(.system(size: 14, design: .serif))', 'Text'],
  ['Text("A").navigationTitle("Old")', 'navigationTitle', 'New', 'Text("A").navigationTitle("New")', 'Text'],
])('edits %s through its exact supported argument', (body, label, value, expected, name) => {
  const declarations = '@State var title = ""; @State var enabled = false'
  const source = wrap(body, declarations)
  expect(edited(source, label, value, name)).toBe(wrap(expected, declarations))
})

it('never offers View modifiers on a Scene constructor', () => {
  const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files: files(wrap('Text("A")')) })
  expect(snapshot.nodes.find(n => n.name === 'WindowGroup')?.controls).toEqual([])
  expect(snapshot.nodes.find(n => n.name === 'Text')?.controls?.length).toBeGreaterThan(0)
})

it('keeps colors behind a user typealias or global value read-only', () => {
  const alias = wrap('Text("A").background(Color.blue)') + '\nstruct Palette { static let blue = SwiftUI.Color.blue }; typealias Color = Palette'
  expect(target(alias).controls?.some(c => c.label === 'background')).toBe(false)
  const value = wrap('Text("A").background(Color.blue)') + '\nlet Color = Palette(); struct Palette { let blue = SwiftUI.Color.blue }'
  expect(target(value).controls?.some(c => c.label === 'background')).toBe(false)
})

it('retains a frame’s alignment when switching its width to Fill', () => {
  const source = edited(wrap('Text("A").frame(width: 120, height: 60, alignment: .leading)'), 'Width sizing', 'Fill')
  const result = compile({ files: files(source), canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 1 })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  const text = result.renderTree!.nodes.find(n => n.text?.runs.some(r => r.text === 'A'))!
  expect(text.frame.x).toBeCloseTo(0, 3)
})

/** A structural edit - Add, Delete, Hide, Move - planned the way Layers and the canvas plan one. */
function restructure(text: string, operation: DesignEditRequest['operation'], name: string, index = 0): DesignEditPlan {
  const node = target(text, name, index)
  return planDesignEdit({ projectId: 'p', baseRevision: 1, scope: node.owner, files: files(text), target: node.source, fingerprint: node.fingerprint, operation })
}
function restructured(text: string, operation: DesignEditRequest['operation'], name: string, index = 0): string {
  const result = restructure(text, operation, name, index)
  if (!result.ok) throw new Error(result.reason)
  const next = result.changes[0]?.after ?? text
  expect(Parser.parse(next, 'Sources/App.swift').diagnostics).toEqual([])
  return next
}

describe('C1: adding into a container keeps what is already inside it', () => {
  it('keeps a hidden only child, and adds the new view after it', () => {
    const hidden = restructured(wrap('VStack {\n    Text("Secret")\n}'), { kind: 'hide' }, 'Text')
    const added = restructured(hidden, { kind: 'insert', snippet: 'Text("New")' }, 'VStack')
    expect(added).toContain('VStack {\n    // hidden by Swift Web Studio\n    // Text("Secret")\n    // end hidden view\n    Text("New")\n}')
  })
  it('keeps a ForEach’s parameter when its last row is deleted and another is added', () => {
    const emptied = restructured(wrap('List {\n    ForEach(items, id: \\.self) { item in\n        Text(item)\n    }\n}', 'let items = ["A", "B"]'), { kind: 'delete' }, 'Text')
    const added = restructured(emptied, { kind: 'insert', snippet: 'Text("New")' }, 'ForEach')
    expect(added).toContain('ForEach(items, id: \\.self) { item in\n        Text("New")\n    }')
  })
  it('keeps a hidden only child when another layer is moved into its container', () => {
    const hidden = restructured(wrap('VStack {\n    Text("Title")\n    HStack {\n        Text("Secret")\n    }\n}'), { kind: 'hide' }, 'Text', 1)
    const moved = restructured(hidden, { kind: 'layer-reparent', ids: [target(hidden, 'Text').id], destination: target(hidden, 'HStack').id }, 'Text')
    expect(moved).toContain('HStack {\n        // hidden by Swift Web Studio\n        // Text("Secret")\n        // end hidden view\n        Text("Title")\n    }')
  })
})

describe('C2: a view written as an argument is part of the view that takes it', () => {
  const card = wrap('VStack {\n    Text("Card")\n        .padding()\n        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray))\n    Text("Other")\n}')
  const refusal = (slot: string) => `The ${slot} is part of the view it is attached to, so it can’t be moved, copied, hidden or deleted on its own. Select that view instead.`

  it.each<[string, DesignEditRequest['operation']]>([
    ['delete', { kind: 'delete' }],
    ['hide', { kind: 'hide' }],
    ['move', { kind: 'move', direction: 1 }],
    ['drag', { kind: 'moveTo', targetOffset: card.indexOf('Text("Other")'), position: 'after' }],
    ['add beside', { kind: 'insert', snippet: 'Text("New")' }],
    ['duplicate', { kind: 'layer-duplicate' }],
    ['wrap', { kind: 'layer-wrap', ids: [target(card, 'RoundedRectangle').id], layout: 'VStack' }],
    ['move into', { kind: 'layer-reparent', ids: [target(card, 'RoundedRectangle').id], destination: target(card, 'VStack').id }],
  ])('refuses to %s an overlay’s shape on its own, and says why', (_, operation) => {
    expect(restructure(card, operation, 'RoundedRectangle')).toEqual({ ok: false, reason: refusal('overlay') })
  })

  it('edits an overlay shape’s own settings', () => {
    expect(edited(card, 'Shape corner radius', '20', 'RoundedRectangle')).toBe(card.replace('cornerRadius: 12', 'cornerRadius: 20'))
  })

  // The row is the first Text in the model; the header is the second.
  const section = wrap('List {\n    Section(header: Text("Header")) {\n        Text("Row")\n    }\n}')
  it('refuses to delete a section header written as an argument, and says why', () => {
    expect(restructure(section, { kind: 'delete' }, 'Text', 1)).toEqual({ ok: false, reason: refusal('header') })
  })

  it('edits a section header’s own text', () => {
    expect(edited(section, 'Text', 'Title', 'Text', 1)).toBe(section.replace('"Header"', '"Title"'))
  })
})
