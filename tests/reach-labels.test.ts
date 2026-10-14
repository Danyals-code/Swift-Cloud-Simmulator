import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringSnapshot, CompileResult, ViewLayer } from '@studio/shared'
import { layerForRenderNode } from '../apps/web/lib/layers'
import { XCODE, draw, typecheckInXcode } from './helpers/layer-project'

/**
 * Wave 3a: the views code puts in a label, an icon or a container's content (doc 18,
 * Concern 2, items 7 and 8). Each is read where it is written, and drawn where a click
 * on the canvas finds it.
 */
beforeEach(resetPipelineState)

const app = (body: string, declarations = '') =>
  `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View {\n    var body: some View {\n        ${body}\n    }\n}\n${declarations}`

function run(text: string): CompileResult {
  const result = draw([{ id: 'App.swift', text }])
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result
}
/** Every layer the canvas has, outermost first, as `Type "name"`. */
const layers = (result: CompileResult) => {
  const out: string[] = []
  const visit = (items: readonly ViewLayer[]) => { for (const item of items) { out.push(`${item.type} "${item.name}"`); visit(item.children) } }
  visit(result.viewHierarchy ?? [])
  return out
}

describe('a container of the project’s own', () => {
  const CARD = `struct Card<Content: View>: View {
    var title: String = ""
    @ViewBuilder var content: Content
    var body: some View {
        VStack {
            if !title.isEmpty { Text(title) }
            content
        }
    }
}`

  it('gives its trailing closure to the content, past a title that has a value already', () => {
    expect(layers(run(app('Card { Text("Inside") }', CARD)))).toContain('Text "Inside"')
    expect(layers(run(app('Card(title: "Plans") { Text("Inside") }', CARD)))).toEqual(expect.arrayContaining(['Text "Plans"', 'Text "Inside"']))
  })

  it('passes over a constant, which is no argument of its initialiser', () => {
    const card = CARD.replace('var title: String = ""', 'let id = 7\n    var title: String = ""')
    expect(layers(run(app('Card { Text("Inside") }', card)))).toContain('Text "Inside"')
  })

  it('reads the views given to it as its Content, where they are written', () => {
    expect(parts(app('Card(title: "Plans") { Text("Inside") }', CARD), 'Card')).toEqual(['Content: Text("Inside")'])
    const closure = CARD.replace('@ViewBuilder var content: Content', '@ViewBuilder let content: () -> Content').replace('            content\n', '            content()\n')
    expect(parts(app('Card { Text("Inside") }', closure), 'Card')).toEqual(['Content: Text("Inside")'])
    expect(parts(app('Card(content: { Text("Inside") })', closure), 'Card')).toEqual(['Content: Text("Inside")'])
  })

  it('draws those views as the ones the canvas selects', () => {
    const result = run(app('Card { Text("Inside") }', CARD))
    const inside = result.authoring!.nodes.find(node => node.name === 'Text' && node.parentId && result.authoring!.nodes.find(parent => parent.id === node.parentId)?.name === 'Content')!
    expect(inside.runtimeIds).toHaveLength(1)
  })
})

/** A generic container with an `init` of its own, as AI-written code declares one. */
const INIT_CARD = `struct Card<Content: View>: View {
    let title: String
    let content: Content
    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }
    var body: some View {
        VStack {
            Text(title)
            content
        }
    }
}`

describe('a container with an init of its own', () => {
  const CARD = INIT_CARD

  it('reads the views a call gives its init as its Content, named for the argument that takes them', () => {
    expect(parts(app('Card(title: "Settings") { Text("Inside") }', CARD), 'Card')).toEqual(['Content: Text("Inside")'])
    expect(parts(app('Card(title: "Settings", content: { Text("Inside") })', CARD), 'Card')).toEqual(['Content: Text("Inside")'])
    const plain = CARD.replace('@ViewBuilder content: () -> Content', 'content: () -> Content')
    expect(parts(app('Card(title: "Settings") { Text("Inside") }', plain), 'Card')).toEqual(['Content: Text("Inside")'])
  })

  it('draws those views as the ones the canvas selects', () => {
    const result = run(app('Card(title: "Settings") { Text("Inside") }', CARD))
    const inside = result.authoring!.nodes.find(node => node.name === 'Text' && result.authoring!.nodes.find(parent => parent.id === node.parentId)?.name === 'Content')!
    expect(inside.runtimeIds).toHaveLength(1)
  })

  it('leaves a call that fits none of its inits, or more than one, as written', () => {
    const two = CARD.replace('    var body: some View {', '    init(title: String, @ViewBuilder content: () -> Content, footer: String = "") {\n        self.init(title: title, content: content)\n    }\n    var body: some View {')
    expect(parts(app('Card(title: "Settings") { Text("Inside") }', two), 'Card')).toEqual([])
  })
})

describe('a container’s own values where it is used', () => {
  const PANEL = `struct Panel<Content: View>: View {
    var title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack {
            Text(title)
            content
        }
    }
}`
  const panel = app('Panel(title: "Plans") { Text("Inside") }', PANEL)
  const card = app('Card(title: "Settings") { Text("Inside") }', INIT_CARD)
  const call = (text: string, name: string) => buildAuthoringModel({ projectId: 'labels', revision: 1, files: [{ id: 'App.swift', text }] }).nodes.find(node => node.kind === 'component' && node.name === name)!
  /** The file after the call's `title` is set to `value`, or the planner's reason. */
  const titled = (text: string, name: string, value: string) => {
    const target = call(text, name)
    const plan = planDesignEdit({ projectId: 'labels', baseRevision: 1, files: [{ id: 'App.swift', text }], scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation: { kind: 'property', control: 'component:title', value } })
    return plan.ok ? plan.changes[0]!.after : plan.reason
  }

  it('gives a generic container the fields a plain component has, from its memberwise init or its own', () => {
    expect(call(panel, 'Panel').controls?.find(control => control.id === 'component:title')).toMatchObject({ kind: 'text', value: 'Plans' })
    expect(call(card, 'Card').controls?.find(control => control.id === 'component:title')).toMatchObject({ kind: 'text', value: 'Settings' })
    expect(call(card, 'Card').controls?.some(control => control.id === 'component:content')).toBe(false)
  })

  it('writes the value where the container is used', () => {
    expect(titled(panel, 'Panel', 'Pricing')).toBe(panel.replace('Panel(title: "Plans")', 'Panel(title: "Pricing")'))
    expect(titled(card, 'Card', 'Account')).toBe(card.replace('Card(title: "Settings")', 'Card(title: "Account")'))
  })

  it('says inside a container whose init sets its title that the title is set where it is used', () => {
    const text = buildAuthoringModel({ projectId: 'labels', revision: 1, files: [{ id: 'App.swift', text: card }] }).nodes.find(node => node.name === 'Text' && card.slice(node.source.start, node.source.end) === 'Text(title)')!
    expect(text.controls?.find(control => control.id === 'content:data')).toMatchObject({ value: 'title', disabledReason: 'This text is set where this view is used. Change it there.' })
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds the values written where a generic container is used', () => {
      typecheckInXcode([titled(panel, 'Panel', 'Pricing'), titled(card, 'Card', 'Account')])
    }, 120_000)
  })
})

/** Each of a view's parts, as `Part: views` with the views as written, in the order they are written. */
function parts(text: string, view: string): string[] {
  const snapshot: AuthoringSnapshot = buildAuthoringModel({ projectId: 'labels', revision: 1, files: [{ id: 'App.swift', text }] })
  const byId = new Map(snapshot.nodes.map(node => [node.id, node]))
  const written = (id: string) => { const node = byId.get(id)!; return text.slice(node.source.start, node.source.end) }
  const owner = snapshot.nodes.find(node => (node.kind === 'view' || node.kind === 'component') && node.name === view)!
  return owner.children.map(id => {
    const child = byId.get(id)!
    return child.kind === 'branch' ? `${child.name}: ${child.children.map(written).join(', ')}` : written(id)
  })
}

describe('the views in a label or a slot', () => {
  it.each([
    ['Toggle', 'Toggle(isOn: .constant(true)) { Text("Wi-Fi") }', ['Label: Text("Wi-Fi")']],
    ['Stepper', 'Stepper(value: .constant(2), in: 0...10) { Text("Count") }', ['Label: Text("Count")']],
    ['Slider', 'Slider(value: .constant(0.5)) { Text("Volume") } minimumValueLabel: { Image(systemName: "speaker") } maximumValueLabel: { Image(systemName: "speaker.wave.3") }', ['Label: Text("Volume")', 'Minimum label: Image(systemName: "speaker")', 'Maximum label: Image(systemName: "speaker.wave.3")']],
    ['Menu', 'Menu { Button("Copy") { } } label: { Image(systemName: "ellipsis") }', ['Button("Copy") { }', 'Label: Image(systemName: "ellipsis")']],
    ['Label', 'Label { Text("Title") } icon: { Image(systemName: "star") }', ['Title: Text("Title")', 'Icon: Image(systemName: "star")']],
    ['LabeledContent', 'LabeledContent("Name") { Text("Value") }', ['Content: Text("Value")']],
    ['LabeledContent', 'LabeledContent { Text("Value") } label: { Text("Name") }', ['Content: Text("Value")', 'Label: Text("Name")']],
    ['DisclosureGroup', 'DisclosureGroup { Text("Inside") } label: { Text("More") }', ['Text("Inside")', 'Label: Text("More")']],
    ['Picker', 'Picker(selection: .constant(1)) { Text("One").tag(1) } label: { Text("Number") }', ['Text("One").tag(1)', 'Label: Text("Number")']],
    ['GroupBox', 'GroupBox { Text("Content") } label: { Text("Settings") }', ['Text("Content")', 'Label: Text("Settings")']],
    ['ContentUnavailableView', 'ContentUnavailableView { Label("No Mail", systemImage: "tray") } description: { Text("Nothing here") } actions: { Button("Refresh") { } }', ['Label: Label("No Mail", systemImage: "tray")', 'Description: Text("Nothing here")', 'Actions: Button("Refresh") { }']],
    ['ContentUnavailableView', 'ContentUnavailableView("No Mail", systemImage: "tray", description: Text("Nothing here"))', ['Description: Text("Nothing here")']],
    ['Section', 'List { Section { Text("Row") } header: { Text("Header") } footer: { Text("Footer") } }', ['Text("Row")', 'Header: Text("Header")', 'Footer: Text("Footer")']],
  ])('reads a %s’s parts: %s', (view, body, expected) => {
    expect(parts(app(body), view)).toEqual(expected)
  })
})

describe('a label on the canvas', () => {
  /** Whether a click on what the canvas draws for the view written as `view` selects that view. */
  function clickable(body: string, view: string): boolean {
    const text = app(body)
    const result = run(text)
    const node = result.authoring!.nodes.find(item => item.kind !== 'branch' && text.slice(item.source.start, item.source.end) === view)
    if (!node?.runtimeIds.length) return false
    return result.renderTree!.nodes.some(drawn => node.runtimeIds.includes(layerForRenderNode(result.viewHierarchy ?? [], drawn)?.id ?? ''))
  }

  it.each([
    ['Menu { Button("Copy") { } } label: { Image(systemName: "ellipsis") }', 'Image(systemName: "ellipsis")'],
    ['DisclosureGroup { Text("Inside") } label: { Text("More") }', 'Text("More")'],
    ['Form { Picker(selection: .constant(1)) { Text("One").tag(1) } label: { Text("Number") } }', 'Text("Number")'],
    ['GroupBox { Text("Content") } label: { Text("Settings") }', 'Text("Settings")'],
    ['Label { Text("Title") } icon: { Image(systemName: "star") }', 'Image(systemName: "star")'],
    ['LabeledContent { Text("Value") } label: { Text("Name") }', 'Text("Name")'],
    ['Toggle(isOn: .constant(true)) { Text("Wi-Fi") }', 'Text("Wi-Fi")'],
  ])('selects the label of %s', (body, view) => {
    expect(clickable(body, view)).toBe(true)
  })
})

describe('the words a text draws', () => {
  it('names its layer with them, whatever it is given to draw', () => {
    const members = '    let price = 12.5\n    let count = 3\n'
    const text = app('VStack { Text(price, format: .currency(code: "USD")); Text("Total: \\(count) of 6"); Text(count, format: .number) }').replace('struct ContentView: View {\n', `struct ContentView: View {\n${members}`)
    expect(layers(run(text)).filter(layer => layer.startsWith('Text'))).toEqual(['Text "$12.50"', 'Text "Total: 3 of 6"', 'Text "3"'])
  })
})
