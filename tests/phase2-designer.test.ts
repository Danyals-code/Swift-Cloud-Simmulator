import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { applyProjectTransaction, DocumentHistory, emptyStudioMetadata, projectFromFiles } from '@studio/project-model'
import type { AuthoringNode, CompileRequest, DesignEditRequest, SourceFile } from '@studio/shared'
import { screenCatalog } from '../apps/web/lib/screens'

beforeEach(resetPipelineState)
const wrap = (body: string, state = '') => `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { ${state}\nvar body: some View { ${body} } }`
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
const model = (text: string) => buildAuthoringModel({ projectId: 'p2', revision: 1, files: files(text) })
const selected = (text: string, name: string, index = 0) => model(text).nodes.filter(n => n.name === name)[index]!
function plan(text: string, node: AuthoringNode, operation: DesignEditRequest['operation']) {
  return planDesignEdit({ projectId: 'p2', baseRevision: 1, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
}
function edit(text: string, name: string, operation: DesignEditRequest['operation']) {
  const result = plan(text, selected(text, name), operation)
  if (!result.ok) throw new Error(result.reason)
  return result.changes[0]?.after ?? text
}
function render(text: string, extra: Partial<CompileRequest> = {}) {
  const result = compile({ projectId: 'p2', revision: 1, files: files(text), canvas: { width: 393, height: 852 }, colorScheme: 'light', allPages: true, ...extra })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}
const texts = (result: ReturnType<typeof compile>) => result.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []).join(' ')
const tap = (result: ReturnType<typeof compile>, title: string) => {
  const target = result.renderTree?.nodes.find(n => n.a11y?.label === title && n.hitTarget)
  expect(target, title).toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(2)
}

describe('screen authoring', () => {
  it('creates and previews an unconnected screen without changing the live app', () => {
    const source = edit(wrap('VStack { Text("Home") }'), 'ContentView', { kind: 'screen-create', name: 'ClubScreen', title: 'Club', layout: 'VStack' })
    const screens = [{ view: 'ClubScreen', name: 'Club' }]
    const result = render(source, { designScreens: screens })
    expect(texts(result)).toContain('Home')
    expect(texts(result)).not.toContain('Club')
    expect(result.pages?.find(p => p.id === 'screen:ClubScreen')?.tree.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? [])).toContain('Club')
    expect(screenCatalog(result.authoring, result.pages, screens).map(s => s.view)).toContain('ContentView')
    expect(texts(render(source, { previewScreen: 'ClubScreen' }))).toContain('Club')
  })
  it('duplicates a screen including state, removes only unused definitions, and preserves the root', () => {
    const source = wrap('VStack { Text("Home") }', '@State var joined = false')
    const copied = edit(source, 'ContentView', { kind: 'screen-duplicate', name: 'SecondScreen' })
    expect(copied.match(/@State var joined = false/g)).toHaveLength(2)
    expect(edit(copied, 'SecondScreen', { kind: 'screen-remove' })).toContain('struct ContentView')
    expect(plan(source, selected(source, 'ContentView'), { kind: 'screen-remove' })).toMatchObject({ ok: false, reason: expect.stringContaining('used') })
    expect(plan(source, selected(source, 'ContentView'), { kind: 'screen-duplicate', name: 'ContentView' })).toMatchObject({ ok: false })
  })
  it('undoes sources and screen names/order together', () => {
    const source = wrap('VStack {}'), project = { ...projectFromFiles([{ name: 'Sources/App.swift', text: source }])!, id: 'p2' }
    const result = plan(source, selected(source, 'ContentView'), { kind: 'screen-create', name: 'ClubScreen', title: 'Club', layout: 'HStack' })
    if (!result.ok) throw new Error(result.reason)
    const changed = applyProjectTransaction(project, 1, { ...result, studio: { before: undefined, after: { ...emptyStudioMetadata(), screens: [{ view: 'ClubScreen', name: 'Club' }] } } })
    if (!changed.ok) throw new Error(changed.reason)
    const history = new DocumentHistory(); history.record(project, changed.project, null, result.selection)
    const undone = history.take('undo', changed.project)!.project
    expect(undone.files).toEqual(project.files); expect(undone.studio).toBeUndefined()
    expect(history.take('redo', undone)?.project.studio?.screens?.[0]?.name).toBe('Club')
  })
  it('does not create duplicate gallery phones for a named app root', () => {
    const result = render(wrap('VStack { Text("Home") }'), { designScreens: [{ view: 'ContentView', name: 'Home screen' }] })
    expect(result.pages).toHaveLength(1)
    expect(result.pages?.[0]?.name).toBe('Home screen')
  })
  it('keeps connected destinations and standalone screen identities unique', () => {
    const source = edit(wrap('VStack { Button("Details") {} }'), 'Button', { kind: 'guided-action', action: { type: 'navigate', destination: 'DetailsScreen' }, replace: false, createScreen: { name: 'DetailsScreen', title: 'Club details' } })
    const result = render(source, { designScreens: [{ view: 'ContentView', name: 'Home' }, { view: 'DetailsScreen', name: 'Details' }] })
    expect(result.pages).toHaveLength(2)
    expect(result.pages?.find(p => p.id === 'screen:DetailsScreen')?.parentId).toBe('screen:ContentView')
    const ids: string[] = []
    const visit = (layers: NonNullable<ReturnType<typeof compile>['viewHierarchy']>) => layers.forEach(layer => { ids.push(layer.id); visit(layer.children) })
    result.pages?.forEach(p => visit(p.viewHierarchy ?? []))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('guided interactions', () => {
  it('creates a screen and navigation context atomically, then really navigates', () => {
    const source = edit(wrap('VStack { Button("Details") {} }.padding(12)'), 'Button', { kind: 'guided-action', action: { type: 'navigate', destination: 'DetailsScreen' }, replace: false, createScreen: { name: 'DetailsScreen', title: 'Club details' } })
    expect(source.match(/NavigationStack/g)).toHaveLength(1)
    expect(source).toContain('.padding(12)')
    expect(texts(tap(render(source), 'Details'))).toContain('Club details')
  })
  it('pushes from a screen that is itself pushed onto the same stack, with no second NavigationStack (D13)', () => {
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
            Button("More") { }
        }
    }
}
struct MoreScreen: View {
    var body: some View {
        Text("More details")
    }
}
`
    const pushed = edit(source, 'Button', { kind: 'guided-action', action: { type: 'navigate', destination: 'MoreScreen' }, replace: false })
    expect(pushed.match(/NavigationStack/g)).toHaveLength(1)
    expect(pushed).toContain('        VStack {\n            NavigationLink("More", destination: MoreScreen())\n        }')
    expect(texts(tap(tap(render(pushed), 'Details'), 'More'))).toContain('More details')
  })
  it('pushes from a pushed screen that has a #Preview of its own, as screens made in the studio have, with no second stack (D13)', () => {
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
            Button("More") { }
        }
    }
}

#Preview {
    DetailsScreen()
}
struct MoreScreen: View {
    var body: some View {
        Text("More details")
    }
}
`
    const pushed = edit(source, 'Button', { kind: 'guided-action', action: { type: 'navigate', destination: 'MoreScreen' }, replace: false })
    expect(pushed.match(/NavigationStack/g)).toHaveLength(1)
    expect(texts(tap(tap(render(pushed), 'Details'), 'More'))).toContain('More details')
  })
  it('pushes from a screen that links back to the one before it, with no second stack (D13)', () => {
    const source = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        NavigationStack {
            NavigationLink("Plans") { PlansScreen() }
        }
    }
}
struct PlansScreen: View {
    var body: some View {
        NavigationLink("Plan") { PlanScreen() }
    }
}
struct PlanScreen: View {
    var body: some View {
        VStack {
            NavigationLink("All plans") { PlansScreen() }
            Button("Notes") { }
        }
    }
}
struct NotesScreen: View {
    var body: some View {
        Text("Plan notes")
    }
}
`
    const pushed = edit(source, 'Button', { kind: 'guided-action', action: { type: 'navigate', destination: 'NotesScreen' }, replace: false })
    expect(pushed.match(/NavigationStack/g)).toHaveLength(1)
    expect(texts(tap(tap(tap(render(pushed), 'Plans'), 'Plan'), 'Notes'))).toContain('Plan notes')
  })
  it('wraps a screen that needs a stack for its first push, with what it wraps indented inside it (D13)', () => {
    const source = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack {
            Text("Home")
            Button("Details") { }
        }
    }
}
`
    const pushed = edit(source, 'Button', { kind: 'guided-action', action: { type: 'navigate', destination: 'DetailsScreen' }, replace: false, createScreen: { name: 'DetailsScreen', title: 'Club details' } })
    expect(pushed).toContain(`    var body: some View {
        NavigationStack {
            VStack {
                Text("Home")
                NavigationLink("Details", destination: DetailsScreen())
            }
        }
    }`)
  })
  it('creates and opens a sheet, preserving the current screen', () => {
    const source = edit(wrap('VStack { Text("Home"); Button("Join") {} }'), 'Button', { kind: 'guided-action', action: { type: 'sheet', destination: 'JoinScreen' }, replace: false, createScreen: { name: 'JoinScreen', title: 'Join the club' } })
    const result = tap(render(source), 'Join')
    expect(result.renderTree?.nodes.some(n => n.id === 'overlay-surface')).toBe(true)
    expect(texts(result)).toContain('Join the club')
  })
  it('creates an independent Boolean and visible selected label without touching another value', () => {
    const source = edit(wrap('VStack { Text(following ? "Following" : "Follow"); Button("Join") {} }', '@State var following = false'), 'Button', { kind: 'guided-action', action: { type: 'toggle', state: 'joined' }, replace: false, createValue: { name: 'joined', value: false, activeTitle: 'Joined' } })
    const result = tap(render(source), 'Join')
    expect(texts(result)).toContain('Joined'); expect(texts(result)).toContain('Follow'); expect(texts(result)).not.toContain('Following')
    expect(selected(source, 'Button').controls?.find(c => c.id === 'title:then')?.value).toBe('Joined')
  })
  it('reports actual value readers without matching words inside string literals', () => {
    const source = wrap('VStack { Text(joined ? "Member" : "Visitor"); Text("joined"); Button("Join") { joined.toggle() } }', '@State var joined = false')
    const snapshot = model(source), button = snapshot.nodes.find(n => n.name === 'Button')!
    const dependencies = button.behavior?.dependencies?.find(d => d.state === 'joined')?.nodeIds
    expect(dependencies).toContain(snapshot.nodes.find(n => n.name === 'Text')!.id)
    expect(dependencies).not.toContain(snapshot.nodes.filter(n => n.name === 'Text')[1]!.id)
  })
  it('rejects replacing existing actions and colliding values until explicitly resolved', () => {
    const source = wrap('Button("Join") { following.toggle() }', '@State var following = false')
    expect(plan(source, selected(source, 'Button'), { kind: 'guided-action', action: { type: 'toggle', state: 'following' }, replace: false })).toMatchObject({ ok: false })
    expect(plan(source, selected(source, 'Button'), { kind: 'guided-action', action: { type: 'toggle', state: 'following' }, replace: true, createValue: { name: 'following', value: false } })).toMatchObject({ ok: false })
  })
  it.each([
    ['Slider(value: .constant(0.5))', 'Slider', 0.5, 'Double'],
    ['Stepper("Count", value: .constant(1))', 'Stepper', 1, 'Int'],
    ['DatePicker("Date", selection: .constant(Date()))', 'DatePicker', 1700000000, 'Date'],
    ['ColorPicker("Color", selection: .constant(.blue))', 'ColorPicker', '#6D28D9', 'Color'],
  ] as const)('makes %s interactive without source editing', (snippet, name, value, type) => {
    const source = edit(wrap(`VStack { ${snippet} }`), name, { kind: 'bind-state', name: 'selectedValue', create: { value } })
    expect(source).toContain(`@State private var selectedValue: ${type}`)
    expect(source).toContain('$selectedValue')
    expect(selected(source, name).behavior?.states.find(s => s.name === 'selectedValue')?.type).toBe(type)
    render(source)
  })
})

describe('layer organization', () => {
  it('duplicates a whole modified layer as a sibling', () => {
    const source = edit(wrap('VStack { Text("Hello").padding(12); Text("Last") }'), 'Text', { kind: 'layer-duplicate' })
    expect(source.match(/Text\("Hello"\)\.padding\(12\)/g)).toHaveLength(2)
    expect(texts(render(source))).toContain('Hello Hello Last')
  })
  it('wraps adjacent layers, preserving modifiers and comments', () => {
    const source = wrap('VStack {\n Text("A").padding(8)\n // keep comment\n Text("B")\n Text("C")\n}')
    const nodes = model(source).nodes.filter(n => n.name === 'Text')
    const result = plan(source, nodes[0]!, { kind: 'layer-wrap', ids: nodes.slice(0, 2).map(n => n.id), layout: 'HStack' })
    if (!result.ok) throw new Error(result.reason)
    expect(result.changes[0]?.after).toContain('// keep comment')
    expect(result.changes[0]?.after).toContain('HStack(spacing: 16)')
    render(result.changes[0]!.after)
    expect(plan(source, nodes[0]!, { kind: 'layer-wrap', ids: [nodes[0]!.id, nodes[2]!.id], layout: 'HStack' })).toMatchObject({ ok: false })
  })
  it('rejects a move that would silently bind to a different local value', () => {
    const source = wrap('VStack { let label = "Original"; Text(label); HStack { let label = "Other"; Text(label) } }')
    const node = selected(source, 'Text'), row = selected(source, 'HStack')
    expect(plan(source, node, { kind: 'layer-reparent', ids: [node.id], destination: row.id })).toMatchObject({ ok: false, reason: expect.stringContaining('local value') })
  })
  it('moves layers into an empty container and rejects cycles and branch escapes', () => {
    const source = wrap('VStack { Text("A"); HStack {} }'), node = selected(source, 'Text'), row = selected(source, 'HStack')
    const result = plan(source, node, { kind: 'layer-reparent', ids: [node.id], destination: row.id })
    if (!result.ok) throw new Error(result.reason)
    const next = model(result.changes[0]!.after)
    expect(next.nodes.find(n => n.id === next.nodes.find(n => n.name === 'Text')?.parentId)?.name).toBe('HStack')
    const column = selected(source, 'VStack')
    expect(plan(source, column, { kind: 'layer-reparent', ids: [column.id], destination: row.id })).toMatchObject({ ok: false })
    const conditional = wrap('VStack { if true { Text("A") }; HStack {} }'), nested = selected(conditional, 'Text')
    expect(plan(conditional, nested, { kind: 'layer-reparent', ids: [nested.id], destination: selected(conditional, 'HStack').id })).toMatchObject({ ok: false })
  })
})

it('creates and applies a custom colour token in one transaction, then keeps it editable', () => {
  const source = wrap('Text("Brand").foregroundColor(.blue)'), node = selected(source, 'Text'), property = node.styles!.find(p => p.kind === 'color')!
  const result = plan(source, node, { kind: 'style-create-link', property: property.property, name: 'brandColor', style: 'color', value: '#6D28D9' })
  if (!result.ok) throw new Error(result.reason)
  expect(result.changes).toHaveLength(2)
  // A token is a static member in Tokens.swift, read with dot syntax; its value is a colour set.
  expect(result.changes.find(c => c.file === 'Sources/App.swift')?.after).toContain('.foregroundColor(.brandColor)')
  expect(result.changes.find(c => c.file === 'Sources/DesignSystem/Tokens.swift')?.after).toContain('static let brandColor = Color("brandColor")')
  expect(result.colorSets).toEqual([{ name: 'brandColor', light: '#6D28D9' }])
  const local = edit(source, 'Text', { kind: 'style-local', property: property.property, value: '#6D28D9' })
  expect(selected(local, 'Text').styles?.find(p => p.kind === 'color')?.value).toBe('#6d28d9')
})
