import { expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import type { PagePreview } from '@studio/shared'
import { screenCatalog, screenLabel, screenTitleControl } from './screens'

/**
 * What a screen is called.
 *
 * The preview names a screen after its title bar, and calls one without a title
 * "Main page" - which is a description of a page, not the name of a screen. The
 * view the designer's screen is written as says it better.
 */

const source = `import SwiftUI\n@main\nstruct DemoApp: App {\n    var body: some Scene {\n        WindowGroup { HomeScreen() }\n    }\n}\nstruct HomeScreen: View {\n    var body: some View { Text("Hi") }\n}\nstruct SettingsScreen: View {\n    var body: some View { Text("Settings").navigationTitle("Settings") }\n}\n`
const snapshot = buildAuthoringModel({ projectId: 'names', revision: 1, files: [{ id: 'Sources/App.swift', text: source }] })
const page = (id: string, name: string): PagePreview => ({ id: `screen:${id}`, name, active: false, tree: { nodes: [], canvas: { width: 402, height: 874 }, revision: 1 } })

it('names a screen after its view when the preview had nothing better to call it', () => {
  expect(screenLabel('HomeScreen')).toBe('Home')
  expect(screenLabel('Screen')).toBe('Screen')
  const found = screenCatalog(snapshot, [page('HomeScreen', 'Main page'), page('SettingsScreen', 'Settings')])
  expect(found).toEqual([{ view: 'HomeScreen', name: 'Home' }, { view: 'SettingsScreen', name: 'Settings' }])
})

it('keeps a name the designer already gave a screen', () => {
  expect(screenCatalog(snapshot, [page('HomeScreen', 'Main page')], [{ view: 'HomeScreen', name: 'Start' }]))
    .toEqual([{ view: 'HomeScreen', name: 'Start' }])
})

/**
 * A screen's title shows in a navigation bar, which only a navigation stack gives it. A sheet
 * starts without one, so a Title written on a sheet's screen never shows (doc 18, Fix first 8).
 */
const titled = (sheet: string, presented = 'SettingsSheet()') => buildAuthoringModel({ projectId: 'titles', revision: 1, files: [{ id: 'Sources/App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
    @State private var showing = false
    var body: some View {
        NavigationStack {
            VStack {
                Button("Open") { showing = true }
                NavigationLink("Details") { DetailScreen() }
            }
            .sheet(isPresented: $showing) { ${presented} }
            .navigationTitle("Home")
        }
    }
}
struct DetailScreen: View { var body: some View { Text("Details").navigationTitle("Details") } }
struct SettingsSheet: View { var body: some View { ${sheet} } }
` }] })
const titleOf = (snapshot: ReturnType<typeof titled>, view: string) => screenTitleControl(snapshot, snapshot.nodes.find(n => n.kind === 'definition' && n.name === view))

it('offers a screen title only where a navigation bar shows it, and says why not elsewhere', () => {
  const plain = titled('VStack { Text("Hi") }.navigationTitle("Settings")')
  expect(titleOf(plain, 'SettingsSheet')?.control.disabledReason).toMatch(/no navigation bar/)
  expect(titleOf(plain, 'HomeScreen')?.control.disabledReason).toBeUndefined()
  expect(titleOf(plain, 'DetailScreen')?.control.disabledReason).toBeUndefined()
  // A sheet that brings its own stack, or is shown in one, has a bar for the title.
  expect(titleOf(titled('NavigationStack { VStack { Text("Hi") }.navigationTitle("Settings") }'), 'SettingsSheet')?.control.disabledReason).toBeUndefined()
  expect(titleOf(titled('VStack { Text("Hi") }.navigationTitle("Settings")', 'NavigationStack { SettingsSheet() }'), 'SettingsSheet')?.control.disabledReason).toBeUndefined()
})

it('invites a title only on a screen whose first view sits under a navigation bar', () => {
  const plain = titled('VStack { Text("Hi") }')
  const definitionOf = (view: string) => plain.nodes.find(n => n.kind === 'definition' && n.name === view)
  // Bars says a title would not show where the screen certainly has no navigation bar (`bars.barless`).
  expect(definitionOf('SettingsSheet')?.bars?.barless).toBe(true)
  expect(definitionOf('DetailScreen')?.bars?.barless).toBeFalsy()
})

/** Where the model can't follow how a screen is shown, the title stays editable: only a certain "no bar" turns it off. */
it.each([
  ['the sidebar of a split view', 'NavigationSplitView { ListScreen() } detail: { Text("Pick one") }', ''],
  ['a stack around a helper property', 'NavigationStack { content }', '\n    var content: some View { ListScreen() }'],
  ['nothing the model can see', 'Text("Home")', ''],
])('keeps the title of a screen shown in %s', (_, body, members) => {
  const snapshot = buildAuthoringModel({ projectId: 'split', revision: 1, files: [{ id: 'Sources/App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
    var body: some View { ${body} }${members}
}
struct ListScreen: View { var body: some View { List { Text("A") }.navigationTitle("Items") } }
` }] })
  expect(titleOf(snapshot, 'ListScreen')?.control.disabledReason).toBeUndefined()
})

it('turns the title off on the screen the app starts on when no stack is around it', () => {
  const snapshot = buildAuthoringModel({ projectId: 'root', revision: 1, files: [{ id: 'Sources/App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View { var body: some View { Text("Hi").navigationTitle("Home") } }
` }] })
  expect(titleOf(snapshot, 'HomeScreen')?.control.disabledReason).toMatch(/no navigation bar/)
})
