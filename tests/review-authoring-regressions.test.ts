import { expect, it } from 'vitest'
import type { AuthoringNode, AuthoringOperation, PreviewColorAsset, SourceFile } from '@studio/shared'
import { buildAuthoringModel, findViewCopies, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'

const app = (body: string, extra = ''): SourceFile[] => [{ id: 'Sources/App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { var body: some View { ${body} } }
${extra}` }]
const model = (files: readonly SourceFile[], colors: readonly PreviewColorAsset[] = []) => buildAuthoringModel({ projectId: 'regression', revision: 1, files, colors, deploymentTarget: '17.0' })
function plan(files: readonly SourceFile[], operation: AuthoringOperation, node: AuthoringNode = model(files).nodes[0]!, colors: readonly PreviewColorAsset[] = []) {
  return planDesignEdit({ projectId: 'regression', baseRevision: 1, files, colors, deploymentTarget: '17.0', scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
}
function edit(files: readonly SourceFile[], operation: AuthoringOperation, node?: AuthoringNode) {
  const result = plan(files, operation, node)
  if (!result.ok) throw new Error(result.reason)
  return files.filter(f => !result.changes.some(c => c.file === f.id && c.deleted))
    .map(f => ({ ...f, text: result.changes.find(c => c.file === f.id)?.after ?? f.text }))
    .concat(result.changes.filter(c => c.before === null).map(c => ({ id: c.file, text: c.after })))
}
function texts(files: readonly SourceFile[]): string[] {
  resetPipelineState()
  const result = compile({ projectId: 'regression', revision: 1, files, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []) ?? []
}

it('extracts integer line limits while preserving CGFloat and Double inputs', () => {
  const files = app('VStack { Text("One").lineLimit(1).padding(8).opacity(0.5); Text("Two").lineLimit(2).padding(16).opacity(1) }')
  const node = model(files).nodes.find(n => n.kind !== 'definition' && n.name === 'Text')!
  const copies = findViewCopies(files, node.source, { screens: ['ContentView'] })
  const next = edit(files, { kind: 'make-component', name: 'LineLabel', copies: copies.copies.map(c => c.id), screens: ['ContentView'] }, node)
  const component = next.find(f => f.text.includes('struct LineLabel'))!.text
  expect(component).toContain('lineLimit: Int')
  expect(component).toContain('padding: CGFloat')
  expect(component).toContain('opacity: Double')
  expect(texts(next)).toEqual(expect.arrayContaining(['One', 'Two']))
})

it('keeps inline content, arguments, modifiers and local state when removing tabs', () => {
  const files = app('TabView { NavigationStack { Text(title) }.padding(13).tabItem { Label("Home", systemImage: "house") }.tag(0) }')
    .map(f => ({ ...f, text: f.text.replace('struct ContentView: View {', 'struct ContentView: View { @State var title = "Visible";') }))
  const next = edit(files, { kind: 'navigation-style', style: 'stack' })
  expect(next[0]!.text).toContain('NavigationStack { Text(title) }.padding(13)')
  expect(next[0]!.text).not.toContain('.tabItem')
  expect(next[0]!.text).not.toContain('.tag')
  expect(texts(next)).toContain('Visible')
})

it('repeatedly changes between tabs and one screen without losing content or adding navigation files', () => {
  let files = app('Text("Home")')
  for (let i = 0; i < 3; i++) {
    files = edit(files, { kind: 'navigation-style', style: 'tabs', name: 'Home', icon: 'house' })
    expect(model(files).navigation?.style).toBe('tabs')
    expect(texts(files)).toContain('Home')
    files = edit(files, { kind: 'navigation-style', style: 'stack' })
    expect(model(files).navigation?.style).toBe('stack')
    expect(texts(files)).toContain('Home')
  }
  expect(files).toHaveLength(2)
})

it.each(['Color("brand")', 'Color(resourceName)'])('retains a color set still reachable through %s', reference => {
  const files = app(`VStack { Text("Token").foregroundStyle(Color.brand); Text("Asset").foregroundStyle(${reference}) }`, 'let resourceName = "brand"\nextension Color { static let brand = Color("brand") }')
  const result = plan(files, { kind: 'style-edit', name: 'brand', value: 'red' }, undefined, [{ name: 'brand', light: '#112233' }])
  expect(result.ok && result.colorSets).toContainEqual({ name: 'brand', light: '#112233' })
})

it('still removes an unreferenced color set when changing its only token to a system color', () => {
  const files = app('Text("Token").foregroundStyle(Color.brand)', 'extension Color { static let brand = Color("brand") }')
  const result = plan(files, { kind: 'style-edit', name: 'brand', value: 'red' }, undefined, [{ name: 'brand', light: '#112233' }])
  expect(result.ok && result.colorSets).toEqual([])
})

it('duplicates a screen in its original lexical file when it has private dependencies', () => {
  const files: SourceFile[] = [
    { id: 'Sources/App/DemoApp.swift', text: 'import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }' },
    { id: 'Sources/Features/Home/HomeScreen.swift', text: 'import SwiftUI\nprivate let greeting = "Hello"\nstruct HomeScreen: View { var body: some View { Text(greeting) } }' },
  ]
  const node = model(files).nodes.find(n => n.kind === 'definition' && n.name === 'HomeScreen')!
  const next = edit(files, { kind: 'screen-duplicate', name: 'OtherScreen' }, node)
  expect(next).toHaveLength(files.length)
  expect(next[1]!.text).toContain('struct OtherScreen: View')
  expect(next[1]!.text.match(/private let greeting/g)).toHaveLength(1)
  expect(texts(next.map(f => ({ ...f, text: f.id.includes('/App/') ? f.text.replace('HomeScreen()', 'OtherScreen()') : f.text })))).toContain('Hello')
})
