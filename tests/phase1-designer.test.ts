import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DocumentHistory, projectFromFiles } from '@studio/project-model'
import { templateById, TEMPLATES } from '@studio/project-model/templates'
import { symbolDefinition, type DesignEditRequest } from '@studio/shared'
import { VIEW_CATALOG } from '../apps/web/lib/viewCatalog'

beforeEach(resetPipelineState)
const wrap = (body: string, declarations = '') => `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { ${declarations}\nvar body: some View { ${body} } }`
const files = (text: string) => [{ id: 'Sources/App.swift', text }]
const model = (text: string) => buildAuthoringModel({ projectId: 'phase1', revision: 1, files: files(text) })
const selected = (text: string, name: string) => model(text).nodes.find(n => n.name === name && n.kind !== 'definition')!
function plan(text: string, name: string, operation: DesignEditRequest['operation'], deploymentTarget = '17') {
  const node = selected(text, name)
  expect(node).toBeDefined()
  return planDesignEdit({ projectId: 'phase1', baseRevision: 1, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation, deploymentTarget })
}
function edit(text: string, name: string, operation: DesignEditRequest['operation']) {
  const result = plan(text, name, operation)
  if (!result.ok) throw new Error(result.reason)
  return result.changes[0]?.after ?? text
}
function render(text: string) {
  const result = compile({ projectId: 'phase1', revision: 1, files: files(text), canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}

describe('editable visual starter properties', () => {
  it('changes both button label branches without changing their condition or action', () => {
    const source = wrap('Button(following ? "Following" : "Follow") { following.toggle() }', '@State private var following = false')
    expect(selected(source, 'Button').controls?.filter(c => c.id.startsWith('title')).map(c => c.id)).toEqual(['title:then', 'title:else'])
    const first = edit(source, 'Button', { kind: 'property', control: 'title:then', value: 'Joined' })
    const changed = edit(first, 'Button', { kind: 'property', control: 'title:else', value: 'Join' })
    expect(changed).toBe(source.replace('"Following" : "Follow"', '"Joined" : "Join"'))
    const initial = render(changed)
    const button = initial.renderTree!.nodes.find(n => n.a11y?.label === 'Join' && n.hitTarget)!
    expect(applyEvent({ kind: 'tap', handlerId: button.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
    expect(rerender(2).renderTree!.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? [])).toContain('Joined')
  })
  it('keeps nonliteral dynamic labels read only', () => {
    const source = wrap('Text(active ? title.uppercased() : "Ready")', 'let title = "Hello"; let active = false')
    const controls = selected(source, 'Text').controls!
    expect(controls.some(c => c.id === 'content:then')).toBe(false)
    expect(controls.find(c => c.id === 'content:else')?.value).toBe('Ready')
  })
  it('edits semantic and conditional colors without erasing the condition', () => {
    const source = wrap('Text("Hello").background(Color(.secondarySystemGroupedBackground)).foregroundColor(active ? Color.blue : Color.red)', 'let active = true')
    const controls = selected(source, 'Text').controls!
    expect(controls.find(c => c.id === 'modifier:0:0')?.value).toBe('secondarySystemGroupedBackground')
    const changed = edit(source, 'Text', { kind: 'property', control: 'modifier:0:0', value: 'systemBackground' })
    expect(changed).toBe(source.replace('secondarySystemGroupedBackground', 'systemBackground'))
    expect(edit(changed, 'Text', { kind: 'property', control: 'modifier:1:0:else', value: 'green' })).toContain('active ? Color.blue : Color.green')
    expect(edit(changed, 'Text', { kind: 'property', control: 'modifier:0:0', value: 'blue' })).toContain('.background(Color.blue)')
  })
  it.each(['buttonStyle', 'buttonBorderShape', 'controlSize', 'tint'])('adds an editable %s and preserves the action', name => {
    const source = wrap('Button("Join") { active.toggle() }', '@State private var active = false')
    const changed = edit(source, 'Button', { kind: 'modifier-add', name })
    expect(selected(changed, 'Button').modifiers?.find(m => m.name === name)?.controls.length).toBeGreaterThan(0)
    expect(changed).toContain('{ active.toggle() }')
    render(changed)
  })
  it('keeps newer button options out of older deployment targets', () => {
    const source = wrap('Button("Join") { }')
    expect(plan(source, 'Button', { kind: 'modifier-add', name: 'buttonStyle' }, '14')).toMatchObject({ ok: false })
    expect(plan(source, 'Button', { kind: 'modifier-add', name: 'tint' }, '14')).toMatchObject({ ok: false })
  })
  it('offers a blank editable full-size column with a semantic background', () => {
    const starter = templateById('blank')!
    // A new project is laid out the way the design panels expect: the entry point
    // in App/, one folder per screen under Features/, each screen previewable.
    expect(starter.files.map(file => file.id)).toEqual(['Sources/App/MyDesignApp.swift', 'Sources/Features/Home/HomeScreen.swift'])
    const source = starter.files.find(file => file.id.includes('Features/'))!.text
    expect(source).toContain('#Preview {\n    HomeScreen()\n}')
    expect(selected(source, 'VStack').controls?.find(c => c.label === 'Spacing')).toBeDefined()
    const changed = edit(source, 'VStack', { kind: 'insert', snippet: 'Text("My first design")' })
    expect(render(changed).renderTree!.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? [])).toContain('My first design')
  })
})

describe('working screen links from the insertion library', () => {
  const snippet = VIEW_CATALOG.find(item => item.id === 'navigationlink')?.snippet ?? VIEW_CATALOG.find(item => item.snippet.startsWith('NavigationLink'))!.snippet
  it('wraps the root once, preserves comments, and navigates after insertion', () => {
    const source = wrap('VStack {\n    // Existing content\n    Text("Start")\n}.padding(12)')
    const result = plan(source, 'Text', { kind: 'insert', snippet })
    if (!result.ok) throw new Error(result.reason)
    const changed = result.changes[0]!.after!
    expect(changed.match(/NavigationStack/g)).toHaveLength(1)
    expect(changed).toContain('// Existing content')
    expect(changed).toContain('.padding(12)')
    expect(result.authoring?.nodes.find(n => n.source.start === result.selection?.offset)?.name).toBe('NavigationLink')
    const link = selected(changed, 'NavigationLink')
    expect(link.controls?.find(c => c.id === 'title')?.value).toBeTruthy()
    const initial = render(changed)
    const target = initial.renderTree!.nodes.find(n => n.hitTarget && n.a11y?.label === link.controls?.find(c => c.id === 'title')?.value)!
    expect(target).toBeDefined()
    expect(applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
    expect(rerender(2).renderTree!.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? [])).toContain('Details')
  })
  it('adds a link to a pushed screen with a #Preview of its own onto the stack it is on (D13)', () => {
    const source = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        NavigationStack {
            NavigationLink("Details") { DetailsScreen() }
        }
    }
}
struct DetailsScreen: View {
    var body: some View {
        VStack {
            Text("Start")
        }
    }
}

#Preview {
    DetailsScreen()
}
`
    const result = plan(source, 'Text', { kind: 'insert', snippet })
    if (!result.ok) throw new Error(result.reason)
    expect(result.changes[0]!.after!.match(/NavigationStack/g)).toHaveLength(1)
  })
  it('indents what it wraps as the screen is indented, with tabs where it uses tabs (D13)', () => {
    const source = 'import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View {\n\tvar body: some View {\n\t\tVStack {\n\t\t\tText("Start")\n\t\t}\n\t}\n}\n'
    const result = plan(source, 'Text', { kind: 'insert', snippet })
    if (!result.ok) throw new Error(result.reason)
    expect(result.changes[0]!.after).toContain('\tvar body: some View {\n\t\tNavigationStack {\n\t\t\tVStack {\n\t\t\t\tText("Start")\n')
    expect(result.changes[0]!.after).toContain('\t\t\t}\n\t\t}\n\t}\n}\n')
  })
  it.each(['NavigationStack', 'NavigationView'])('uses the existing %s', container => {
    const changed = edit(wrap(`${container} { VStack { Text("Start") } }`), 'VStack', { kind: 'insert', snippet })
    expect(changed.match(/NavigationStack|NavigationView/g)).toHaveLength(1)
  })
  it('does not add a second container around a self-contained navigation snippet', () => {
    const changed = edit(wrap('VStack { Text("Start") }'), 'VStack', { kind: 'insert', snippet: `NavigationStack { ${snippet} }` })
    expect(changed.match(/NavigationStack/g)).toHaveLength(1)
  })
  it('refuses to add an unavailable navigation container', () => {
    expect(plan(wrap('VStack { Text("Start") }'), 'VStack', { kind: 'insert', snippet }, '15')).toMatchObject({ ok: false })
  })
  it('edits the title-plus-destination closure overload', () => {
    const source = wrap('NavigationStack { NavigationLink("Go") { FirstView() } }') + '\nstruct FirstView: View { var body: some View { Text("First") } }\nstruct SecondView: View { var body: some View { Text("Second") } }'
    expect(selected(source, 'NavigationLink').navigation?.editable).toBe(true)
    expect(edit(source, 'NavigationLink', { kind: 'navigation-target', destination: 'SecondView()' })).toBe(source.replace('{ FirstView() }', '{ SecondView() }'))
  })
})

it('exposes history availability through edit, undo, redo, and project switch', () => {
  const before = projectFromFiles([{ name: 'App.swift', text: wrap('Text("Before")') }])!
  const after = { ...before, files: before.files.map(file => ({ ...file, text: file.text.replace('Before', 'After') })) }
  const history = new DocumentHistory()
  expect([history.canUndo, history.canRedo]).toEqual([false, false])
  history.record(before, after, null, null)
  expect([history.canUndo, history.canRedo]).toEqual([true, false])
  const undo = history.take('undo', after)!
  expect([history.canUndo, history.canRedo]).toEqual([false, true])
  expect(history.take('redo', undo.project)?.project.files).toEqual(after.files)
  expect([history.canUndo, history.canRedo]).toEqual([true, false])
  history.record(after, { ...after, id: 'another-project' }, null, null)
  expect([history.canUndo, history.canRedo]).toEqual([false, false])
})

it('recognizes navigation containers outside a conditional branch', () => {
  const source = wrap('NavigationStack { if visible { VStack { Text("Start") } } }', 'let visible = true')
  const changed = edit(source, 'VStack', { kind: 'insert', snippet: 'NavigationLink("Go") { Text("Destination") }' })
  expect(changed.match(/NavigationStack/g)).toHaveLength(1)
})

it.each(VIEW_CATALOG.filter(item => !item.action))('inserts, styles, renders, and undoes the $name starter', item => {
  const source = wrap('VStack { Text("Existing") }')
  const inserted = plan(source, 'VStack', { kind: 'insert', snippet: item.snippet })
  if (!inserted.ok) throw new Error(inserted.reason)
  const text = inserted.changes[0]!.after!
  const node = inserted.authoring!.nodes.find(n => n.source.start === inserted.selection!.offset && n.kind !== 'definition')!
  const styled = planDesignEdit({ projectId: 'phase1', baseRevision: 1, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'modifier-add', name: 'opacity' } })
  if (!styled.ok) throw new Error(`${item.name}: ${styled.reason}`)
  const afterText = styled.changes[0]!.after!
  const updated = model(afterText).nodes.find(n => n.source.start === node.source.start && n.kind !== 'definition')!
  expect(updated.modifiers?.find(m => m.name === 'opacity')?.controls.length, item.name).toBeGreaterThan(0)
  render(afterText)
  const before = projectFromFiles([{ name: 'Sources/App.swift', text: source }])!
  const after = { ...before, files: files(afterText) }
  const history = new DocumentHistory()
  history.record(before, after, null, null)
  expect(history.take('undo', after)?.project.files).toEqual(before.files)
})

it.each([
  ['Label', 'Label("Old", systemImage: "star")', 'title', 'New', 'Label("New", systemImage: "star")'],
  ['Label', 'Label("Old", systemImage: "star")', 'image', 'heart', 'Label("Old", systemImage: "heart")'],
  ['LabeledContent', 'LabeledContent("Title", value: "Old")', 'value', 'New', 'LabeledContent("Title", value: "New")'],
  ['ProgressView', 'ProgressView(value: 0.5)', 'progress', '0.75', 'ProgressView(value: 0.75)'],
  ['GroupBox', 'GroupBox("Old") { Text("Body") }', 'title', 'New', 'GroupBox("New") { Text("Body") }'],
])('edits %s starter content without changing its other arguments', (name, source, control, value, expected) => {
  expect(edit(wrap(source!), name!, { kind: 'property', control: control!, value: value! })).toBe(wrap(expected!))
})


it('uses supported static symbols in every shipped template', () => {
  for (const template of TEMPLATES) for (const file of template.files) {
    for (const match of file.text.matchAll(/(?:systemName|systemImage):\s*"([^"\n]+)"/g)) {
      if (match[1]!.includes('\\')) continue
      expect(symbolDefinition(match[1]!), `${template.name}: ${match[1]}`).not.toBeNull()
    }
  }
})
