import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { applyProjectTransaction, projectFromFiles, emptyStudioMetadata, readStudioMetadata } from '@studio/project-model'
import type { AuthoringNode, ComponentVariant, DesignEditRequest, RenderNode, RenderTree, SourceFile } from '@studio/shared'
import { contrastRatio, reviewTree } from '../apps/web/lib/designReview'

beforeEach(resetPipelineState)
const app = (body: string, definitions = '') => `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { ${body} } }\n${definitions}`
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
const model = (text: string) => buildAuthoringModel({ projectId: 'p3', revision: 1, files: files(text) })
const component = (text: string, index = 0) => model(text).nodes.filter(n => n.kind === 'component' && n.name === 'Card')[index]!
const plan = (text: string, node: AuthoringNode, operation: DesignEditRequest['operation']) => planDesignEdit({ projectId: 'p3', baseRevision: 1, scope: node.owner, target: node.source, fingerprint: node.fingerprint, files: files(text), operation })
function apply(text: string, node: AuthoringNode, operation: DesignEditRequest['operation']) { const result = plan(text, node, operation); if (!result.ok) throw new Error(result.reason); return result.changes.find(c => c.file === 'Sources/App.swift')?.after ?? text }
const card = `enum Tone { case quiet, loud }\nstruct Card: View { var title: String = "Default"; var count: Int = 1; var featured: Bool = false; var tone: Tone = .quiet; var body: some View { Text(title) } }`
const variant = (text: string, values: ComponentVariant['values']): ComponentVariant => ({ name: 'Featured', owner: 'Card', signature: component(text).component!.signature, values })
const texts = (text: string) => { const result = compile({ projectId: 'p3', revision: 1, files: files(text), canvas: { width: 393, height: 852 }, colorScheme: 'light' }); expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]); return result.renderTree!.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []) }

describe('component authoring and saved variants', () => {
  it('applies omitted inputs atomically in declaration order to one instance', () => {
    const source = app('VStack { Card(); Card(title: "Other") }', card)
    const result = apply(source, component(source), { kind: 'component-variant', variant: variant(source, [{ control: 'component:tone', value: 'loud' }, { control: 'component:featured', value: 'true' }, { control: 'component:count', value: '2' }, { control: 'component:title', value: 'Featured' }]) })
    expect(result).toContain('Card(title: "Featured", count: 2, featured: true, tone: Tone.loud)')
    expect(texts(result)).toEqual(['Featured', 'Other'])
  })
  it('rejects invalid variants without applying a partial input update', () => {
    const source = app('VStack { Card(); Card() }', card)
    for (const values of [[{ control: 'component:title', value: 'New' }, { control: 'component:count', value: '1.5' }], [{ control: 'component:tone', value: 'unknown' }], [{ control: 'component:title', value: 'a' }, { control: 'component:title', value: 'b' }]]) expect(plan(source, component(source), { kind: 'component-variant', variant: variant(source, values) })).toMatchObject({ ok: false })
  })
  it('keeps presets compatible with shared layout edits and rejects changed inputs', () => {
    const source = app('VStack { Card() }', card), preset = variant(source, [{ control: 'component:title', value: 'Featured' }])
    const styled = source.replace('Text(title)', 'Text(title).padding(20)')
    expect(texts(apply(styled, component(styled), { kind: 'component-variant', variant: preset }))).toEqual(['Featured'])
    const changed = source.replace('var title:', 'var caption:').replace('Text(title)', 'Text(caption)')
    expect(plan(changed, component(changed), { kind: 'component-variant', variant: preset })).toMatchObject({ ok: false })
  })
  it('does not replace a value linked to its screen or copy a captured action', () => {
    const source = app('VStack { Card(title: "Live".uppercased()) }', card)
    expect(component(source).component?.reusable).toBe(false)
    expect(plan(source, component(source), { kind: 'component-variant', variant: variant(source, [{ control: 'component:title', value: 'Lost' }]) })).toMatchObject({ ok: false })
    const action = app('VStack { Card(action: {}) }', 'struct Card: View { var action: () -> Void; var body: some View { Button("Tap", action: action) } }')
    expect(component(action).component?.variantControls).toEqual([])
    expect(component(action).component?.reusable).toBe(false)
  })
  it('reuses portable components but refuses direct and indirect self nesting', () => {
    const source = app('VStack { Card(title: "One") }', card)
    const column = model(source).nodes.find(n => n.name === 'VStack')!
    expect(texts(apply(source, column, { kind: 'component-insert', component: 'Card' }))).toEqual(['One', 'One'])
    const ownText = model(source).nodes.find(n => n.name === 'Text' && n.owner === 'Card')!
    expect(plan(source, ownText, { kind: 'component-insert', component: 'Card' })).toMatchObject({ ok: false, reason: expect.stringContaining('itself') })
    const indirect = app('VStack { Card(); Outer() }', 'struct Card: View { var body: some View { VStack { Text("Inner") } } }\nstruct Outer: View { var body: some View { Card() } }')
    const inner = model(indirect).nodes.find(n => n.name === 'VStack' && n.owner === 'Card')!
    expect(plan(indirect, inner, { kind: 'component-insert', component: 'Outer' })).toMatchObject({ ok: false, reason: expect.stringContaining('itself') })
  })
  it('promotes shared text to a defaulted instance input without changing other instances', () => {
    const source = app('VStack { Card(); Card() }', 'struct Card: View { var body: some View { Text("Member") } }')
    const text = model(source).nodes.find(n => n.name === 'Text')!
    const promoted = apply(source, text, { kind: 'component-expose', control: 'content', name: 'label' })
    expect(promoted).toContain('var label: String = "Member"')
    expect(promoted).toContain('Text(self.label)')
    expect(texts(promoted)).toEqual(['Member', 'Member'])
    expect(texts(apply(promoted, component(promoted), { kind: 'property', control: 'component:label', value: 'Guest' }))).toEqual(['Guest', 'Member'])
    expect(plan(promoted, model(promoted).nodes.find(n => n.name === 'Text')!, { kind: 'component-expose', control: 'content', name: 'another' })).toMatchObject({ ok: false })
  })
  it('preserves source identity when saving variants so selecting another instance remains immediate', () => {
    const source = app('VStack { Card(); Card() }', card)
    const project = { ...projectFromFiles([{ name: 'Sources/App.swift', text: source }])!, id: 'p3' }
    const result = applyProjectTransaction(project, 1, { projectId: 'p3', baseRevision: 1, changes: [], studio: { before: undefined, after: { ...emptyStudioMetadata(), variants: [variant(source, [{ control: 'component:title', value: 'Featured' }])] } } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.files).toBe(project.files)
  })
  it('validates variant metadata and remains compatible with earlier projects', () => {
    expect(readStudioMetadata(emptyStudioMetadata()).status).toBe('valid')
    const source = app('Card()', card), metadata = { ...emptyStudioMetadata(), variants: [variant(source, [{ control: 'component:title', value: 'Featured' }])] }
    expect(readStudioMetadata(JSON.parse(JSON.stringify(metadata)))).toEqual({ status: 'valid', metadata })
    expect(readStudioMetadata({ ...metadata, variants: [{ ...metadata.variants[0], values: [{ control: 'unsafe', value: 'bad' }] }] }).status).toBe('invalid')
  })
})

const white = { r: 255, g: 255, b: 255, a: 1 }, black = { r: 0, g: 0, b: 0, a: 1 }, gray = { r: 200, g: 200, b: 200, a: 1 }
const frame = { x: 20, y: 20, width: 100, height: 22 }
const textNode = (changes: Partial<RenderNode> = {}): RenderNode => ({ id: 'text', kind: 'text', frame, opacity: 1, z: 1, text: { alignment: 'leading', runs: [{ text: 'Hello', color: gray, font: { family: 'system', size: 17, weight: 400, italic: false, lineHeight: 22 } }] }, ...changes })
const tree = (...nodes: RenderNode[]): RenderTree => ({ revision: 1, canvas: { width: 375, height: 667 }, colorScheme: 'light', nodes })
describe('conservative design review', () => {
  it('measures contrast and small enabled targets with actionable dimensions', () => {
    expect(contrastRatio(white, black)).toBe(21)
    const result = reviewTree(tree(textNode({ hitTarget: { role: 'button', enabled: true, handlerId: 'tap' } })))
    expect(result.findings.map(f => f.kind)).toEqual(['touch', 'contrast'])
    expect(result.findings[0]?.detail).toContain('100 × 22 pt')
    expect(result.contrastChecked).toBe(1)
  })
  it('skips ambiguous backgrounds and transformed text rather than reporting a pass', () => {
    const background: RenderNode = { id: 'bg', kind: 'layer', z: 0, opacity: 1, frame: { x: 0, y: 0, width: 375, height: 667 }, background: { kind: 'linearGradient', stops: [{ color: black, location: 0 }, { color: white, location: 1 }], start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } }
    expect(reviewTree(tree(background, textNode()))).toMatchObject({ findings: [], contrastChecked: 0, contrastSkipped: 1 })
    expect(reviewTree(tree(textNode({ opacity: .5 })))).toMatchObject({ contrastChecked: 0, contrastSkipped: 1 })
  })
  it('finds screen overflow while allowing content to continue in its scroll direction', () => {
    const outside = textNode({ frame: { ...frame, y: 800 } })
    expect(reviewTree(tree(outside)).findings.map(f => f.kind)).toEqual(['overflow'])
    const scroll: RenderNode = { id: 'scroll', kind: 'layer', z: 0, opacity: 1, frame: { x: 0, y: 0, width: 375, height: 667 }, scroll: { axis: 'vertical', content: { width: 375, height: 1000 }, showsIndicators: true } }
    expect(reviewTree(tree(scroll, { ...outside, parent: 'scroll' })).findings).toEqual([])
    expect(reviewTree(tree(scroll, textNode({ parent: 'scroll', frame: { ...frame, x: 350 } }))).findings.some(f => f.kind === 'overflow')).toBe(true)
  })
  it('does not flag hidden, disabled, or already large controls as small targets', () => {
    const button = textNode({ text: undefined, hitTarget: { role: 'button', enabled: true, handlerId: 'tap' }, frame: { ...frame, height: 44 } })
    expect(reviewTree(tree(button)).findings).toEqual([])
    expect(reviewTree(tree({ ...button, frame, opacity: 0 })).findings).toEqual([])
    expect(reviewTree(tree({ ...button, frame, hitTarget: { role: 'button', enabled: false, handlerId: 'tap' } })).findings).toEqual([])
  })
})
