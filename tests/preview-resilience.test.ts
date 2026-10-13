import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileResult, DesignEditRequest, SourceFile } from '@studio/shared'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'

/**
 * One ordinary line must not blank a file, a screen or the whole of Design.
 *
 * Each case here was found by pasting real SwiftUI into the studio: a `#if DEBUG`, a
 * typo in a file no screen uses, a generic card, a chart. Each one used to cost far
 * more than the line it was on.
 */

beforeEach(resetPipelineState)

const options = { canvas: { width: 393, height: 852 }, colorScheme: 'light' as const, safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } }
const app = (body: string, extra = '') => `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View {\n  var body: some View {\n${body}\n  }\n}\n${extra}`
const single = (text: string): SourceFile[] => [{ id: 'App.swift', text }]

function run(files: readonly SourceFile[]): CompileResult {
  return compile({ ...options, files, revision: 1 })
}
const texts = (result: CompileResult) => result.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []) ?? []
const errors = (result: CompileResult) => result.diagnostics.filter(d => d.severity === 'error')
const model = (files: readonly SourceFile[]) => buildAuthoringModel({ projectId: 'robust', revision: 1, files, deploymentTarget: '18.0' })

/** The view whose source reads `name(…`, and contains `marker` when given. */
function viewIn(files: readonly SourceFile[], name: string, marker = '') {
  const text = (span: { file: string; start: number; end: number }) => files.find(f => f.id === span.file)!.text.slice(span.start, span.end)
  const node = model(files).nodes.find(n => n.name === name && n.kind !== 'definition' && text(n.source).includes(marker))
  expect(node, `${name} ${marker}`).toBeDefined()
  return node!
}

function edit(files: readonly SourceFile[], name: string, marker: string, operation: DesignEditRequest['operation']) {
  const node = viewIn(files, name, marker)
  const plan = planDesignEdit({ projectId: 'robust', baseRevision: 1, files, scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation, deploymentTarget: '18.0' })
  if (!plan.ok) throw new Error(plan.reason)
  return plan.changes.find(change => change.file === node.source.file)?.after ?? ''
}

describe('#if inside a view', () => {
  const files = single(app(`    VStack {
      #if DEBUG
      Text("Debug build")
      #else
      Text("Release build")
      #endif
      Text("Always")
    }`))

  it('draws the clause a Debug build in the simulator compiles', () => {
    const result = run(files)
    expect(errors(result)).toEqual([])
    expect(texts(result)).toEqual(['Debug build', 'Always'])
  })

  it('leaves the views in that file editable in Design', () => {
    expect(edit(files, 'Text', 'Always', { kind: 'property', control: 'content', value: 'Every build' })).toContain('Text("Every build")')
    expect(edit(files, 'Text', 'Debug', { kind: 'property', control: 'content', value: 'Debug only' })).toContain('#if DEBUG\n      Text("Debug only")\n      #else')
  })
})

describe('a #if among a view\'s modifiers', () => {
  const files = single(app(`    Text("Hello")
      .italic()
      #if os(iOS)
      .padding()
      #endif
      .bold()`))

  it('keeps every modifier where it is written, since a move would change which builds apply it', () => {
    const node = viewIn(files, 'Text')
    expect(node.modifiers?.map(m => [m.name, m.capabilities.moveUp, m.capabilities.moveDown, m.capabilities.remove, m.capabilities.toggle])).toEqual([
      ['italic', false, false, false, false], ['padding', false, false, false, false], ['bold', false, false, false, false],
    ])
    expect(node.modifiers?.[1]?.capabilities.reason).toBe('A #if in this modifier chain decides which builds apply these modifiers. Change their order in Code.')
  })

  it('adds a modifier after the last one, outside the #if', () => {
    expect(edit(files, 'Text', '', { kind: 'modifier-add', name: 'opacity' })).toContain('      #endif\n      .bold()\n      .opacity(1)')
  })
})

describe('a generic container component', () => {
  const card = {
    'a @ViewBuilder stored view': 'struct Card<Content: View>: View {\n  let title: String\n  @ViewBuilder var content: Content\n  var body: some View { VStack { Text(title); content } }\n}',
    'a view its init builds': 'struct Card<Content: View>: View {\n  let title: String\n  let content: Content\n  init(title: String, @ViewBuilder content: () -> Content) {\n    self.title = title\n    self.content = content()\n  }\n  var body: some View { VStack { Text(title); content } }\n}',
    'a @ViewBuilder closure it calls': 'struct Card<Content: View>: View {\n  let title: String\n  @ViewBuilder let content: () -> Content\n  var body: some View { VStack { Text(title); content() } }\n}',
    'a closure its init keeps': 'struct Card<Content: View>: View {\n  let title: String\n  let content: () -> Content\n  init(title: String, @ViewBuilder content: @escaping () -> Content) {\n    self.title = title\n    self.content = content\n  }\n  var body: some View { VStack { Text(title); content() } }\n}',
  }

  it.each(Object.entries(card))('draws every view given to %s', (_, declaration) => {
    const result = run(single(app('    Card(title: "Plan") {\n      Text("One")\n      Text("Two")\n    }', declaration)))
    expect(errors(result)).toEqual([])
    expect(texts(result)).toEqual(['Plan', 'One', 'Two'])
  })

  it.each(Object.entries(card))('draws the branch an if picks in %s', (_, declaration) => {
    const result = run(single(app('    Card(title: "Plan") {\n      if 1 > 2 { Text("Never") } else { Text("Picked") }\n    }', declaration)))
    expect(texts(result)).toEqual(['Plan', 'Picked'])
  })
})

describe('a view the preview draws as a labelled box', () => {
  const placeholders = [
    ['Chart', 'Chart {\n        BarMark(x: .value("Day", "Mon"), y: .value("Steps", 4000))\n      }'],
    ['Map', 'Map()'],
    ['PhotosPicker', 'PhotosPicker("Choose a photo", selection: $item)'],
  ] as const
  const screen = (view: string) => single(`import SwiftUI\nimport Charts\nimport MapKit\nimport PhotosUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View {\n  @State private var item: PhotosPickerItem?\n  var body: some View {\n    VStack {\n      ${view}\n        .frame(height: 200)\n        .padding()\n    }\n  }\n}\n`)

  it.each(placeholders)('keeps the frame and padding of a %s editable', (name, view) => {
    const files = screen(view)
    const node = viewIn(files, name)
    expect(node.modifiers?.map(m => [m.name, m.capabilities.edit, m.capabilities.remove, m.capabilities.reason])).toEqual([['frame', true, true, undefined], ['padding', true, true, undefined]])
    expect(node.modifierCatalog?.find(entry => entry.name === 'background')).toMatchObject({ available: true })
    expect(edit(files, name, '', { kind: 'property', control: 'modifier:0:0', value: '240' })).toContain('.frame(height: 240)')
  })

  it('names the deployment target, not diagnostics, when the view is newer than the project', () => {
    const files = screen(placeholders[0][1])
    const node = buildAuthoringModel({ projectId: 'robust', revision: 1, files, deploymentTarget: '15.0' }).nodes.find(n => n.name === 'Chart')!
    expect(node.modifiers?.[0]?.capabilities.reason).toBe('Chart needs iOS 16 or newer. Change the deployment target to edit it here.')
  })
})

describe('an error in a file no screen draws from', () => {
  const screen: SourceFile = { id: 'Sources/HomeScreen.swift', text: `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct Item: Identifiable {
    let id: Int
    let name: String
}
struct HomeScreen: View {
    let items: [Item] = [Item(id: 1, name: "Milk"), Item(id: 2, name: "Bread")]
    var body: some View {
        VStack {
            Badge(title: "New")
            ForEach(items) { item in
                Text(item.name)
            }
        }
        .foregroundStyle(.brand)
    }
}
struct Badge: View {
    let title: String
    var body: some View { Text(title) }
}
` }
  const tokens: SourceFile = { id: 'Sources/Tokens.swift', text: 'import SwiftUI\nextension Color {\n    static let brand = Color(red: 0.1, green: 0.4, blue: 0.9)\n}\n' }
  const services: SourceFile = { id: 'Sources/Services.swift', text: 'struct Service {\n    func load() -> Int { return missingThing }\n}\n' }

  it('keeps component, collection and token settings everywhere else', () => {
    const snapshot = run([screen, tokens, services]).authoring!
    expect(snapshot.diagnostics.filter(d => d.severity === 'error').map(d => d.span.file)).toEqual([services.id])
    expect(snapshot.nodes.find(n => n.name === 'Badge' && n.kind === 'component')?.controls?.map(c => c.id)).toContain('component:title')
    expect(snapshot.nodes.find(n => n.name === 'ForEach')?.collection?.records).toHaveLength(2)
    expect(snapshot.styles?.map(style => style.name)).toContain('brand')
  })

  it('still turns off the settings of what is declared in the file with the error', () => {
    const broken: SourceFile = { id: 'Sources/Badge.swift', text: 'import SwiftUI\nstruct Badge: View {\n    let title: String\n    var body: some View { Text(title).tint(missingColor) }\n}\n' }
    const withoutBadge: SourceFile = { ...screen, text: screen.text.slice(0, screen.text.indexOf('struct Badge')) }
    const snapshot = run([withoutBadge, tokens, broken]).authoring!
    expect(snapshot.nodes.find(n => n.name === 'Badge' && n.kind === 'component')?.component).toBeUndefined()
    expect(snapshot.nodes.find(n => n.name === 'ForEach')?.collection?.records).toHaveLength(2)
  })
})

describe('the preview with an error in code no drawn screen runs', () => {
  const home = (body: string): SourceFile => ({ id: 'Sources/App.swift', text: `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { HomeScreen() } } }\nstruct HomeScreen: View {\n    @State private var total = 0\n    var body: some View {\n${body}\n    }\n}\n` })
  const services: SourceFile = { id: 'Sources/Services.swift', text: 'struct Service {\n    func load() -> Int {\n        let base = 10\n        return base + missingThing\n    }\n}\n' }

  it('draws the screens, and still reports the error', () => {
    const result = run([home('        Text("Groceries")'), services])
    expect(result.renderTree?.notice).toBeUndefined()
    expect(texts(result)).toEqual(['Groceries'])
    expect(errors(result).map(d => [d.span.file, d.message])).toEqual([[services.id, "Cannot find 'missingThing' in scope."]])
  })

  it('draws nothing new when the screen runs the code with the error, and says why', () => {
    const result = run([home('        Text("Total \\(Service().load())")'), services])
    expect(result.renderTree?.notice).toEqual({ title: '1 error', detail: "Cannot find 'missingThing' in scope." })
  })

  it('draws nothing new when the screen runs it as it appears, and names the error it ran', () => {
    const typo: SourceFile = { id: 'Sources/Typo.swift', text: 'func unused() -> Int { anotherTypo }\n' }
    const result = run([home('        Text("Total \\(total)")\n            .onAppear { total = Service().load() }'), typo, services])
    expect(result.renderTree?.notice).toEqual({ title: '2 errors', detail: "Cannot find 'missingThing' in scope." })
  })

  it('stops a tap that runs the code with the error, naming the error', () => {
    const first = run([home('        Button("Load") { total = Service().load() }'), services])
    expect(first.renderTree?.notice).toBeUndefined()
    const button = first.renderTree!.nodes.find(n => n.a11y?.label === 'Load' && n.hitTarget?.enabled)!.hitTarget!
    applyEvent({ kind: 'tap', handlerId: button.handlerId, location: { x: 0, y: 0 } })
    const after = rerender(2)
    expect(after.renderTree?.notice).toBeUndefined()
    expect(after.logs.map(log => log.message).join('\n')).toContain("Cannot find 'missingThing' in scope.")
  })

  it('still stops at an error that is not inside code it can set aside', () => {
    const unfinished: SourceFile = { id: 'Sources/Draft.swift', text: 'import SwiftUI\nstruct Draft: View {\n}\n' }
    const result = run([home('        Text("Groceries")'), unfinished])
    expect(result.renderTree?.notice?.title).toBe('1 error')
  })
})
