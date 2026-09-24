import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@studio/shared'
import { compile, resetPipelineState, setFontMetrics } from '@studio/swiftui-runtime'
import { designTree, emptyScreensNote } from './designTree'
import { screenCatalog } from './screens'

/**
 * What the Screens list says when it has none to list.
 *
 * Screens are found by drawing them, so while a file doesn't parse there are none,
 * and after a reload nothing is kept from before. "No screens yet" then sent a
 * designer looking for screens that were there all along.
 */
describe('the note an empty Screens list shows', () => {
  const syntaxError: Diagnostic = { severity: 'error', code: 'expected_token', message: "Expected ')'", span: { file: 'Sources/HomeScreen.swift', start: 42, end: 43 } }

  it('says it is drawing while a compile is under way', () => {
    expect(emptyScreensNote(true, [syntaxError])).toEqual({ text: 'Drawing screens…' })
  })

  it('names the file whose error keeps the screens from being drawn, and where', () => {
    expect(emptyScreensNote(false, [syntaxError])).toEqual({
      text: 'Fix the error in HomeScreen.swift to see the screens.',
      at: { file: 'Sources/HomeScreen.swift', offset: 42 },
    })
  })

  it('says there are none when nothing is wrong', () => {
    expect(emptyScreensNote(false, [{ ...syntaxError, severity: 'warning' }])).toEqual({ text: 'No screens yet.' })
  })
})

/**
 * The screens the Design panel lists, from an app drawn the way the studio draws it.
 *
 * A screen's view is what Rename, Duplicate, Remove and its settings act on. A screen
 * written inside another one's code has no view of its own, and used to be taken for
 * that other screen: named after it, merged with it, and edited in its place.
 */
describe('the screens the Design panel lists', () => {
  function screensOf(declarations: string) {
    resetPipelineState()
    setFontMetrics([])
    const text = `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }\n${declarations}`
    const result = compile({ files: [{ id: 'App.swift', text }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, allPages: true })
    expect(result.diagnostics).toEqual([])
    return designTree(result.pages, result.authoring, screenCatalog(result.authoring, result.pages, []))
  }

  it('names a screen written inside another after its own title, and gives it no view to act on', () => {
    const tree = screensOf(`struct HomeScreen: View {
  var body: some View {
    NavigationStack { List { NavigationLink("Settings") { Text("Settings page").navigationTitle("Settings") } }.navigationTitle("Home") }
  }
}`)
    const home = tree.lanes[0]!.root
    expect([home.name, home.view]).toEqual(['Home', 'HomeScreen'])
    expect(home.children.map((screen) => [screen.name, screen.view])).toEqual([['Settings', undefined]])
  })

  it('lists each sheet written inside a screen on its own', () => {
    const tree = screensOf(`struct HomeScreen: View {
  @State private var filtering = false
  @State private var sharing = false
  var body: some View {
    NavigationStack {
      VStack { Button("Filters") { filtering = true }; Button("Share") { sharing = true } }
        .navigationTitle("Home")
        .sheet(isPresented: $filtering) { NavigationStack { Text("Filter options").navigationTitle("Filters") } }
        .sheet(isPresented: $sharing) { NavigationStack { Text("Share this").navigationTitle("Share") } }
    }
  }
}`)
    expect(tree.sheets.map(({ screen }) => [screen.name, screen.view])).toEqual([['Filters', undefined], ['Share', undefined]])
  })

  it('names each screen a view draws after its own title, and marks them as sharing it, so neither is renamed for both', () => {
    const tree = screensOf(`struct HomeScreen: View {
  var body: some View {
    TabView {
      ItemList(title: "All").tabItem { Label("All", systemImage: "list.bullet") }
      ItemList(title: "Favourites").tabItem { Label("Favourites", systemImage: "star") }
    }
  }
}
struct ItemList: View {
  let title: String
  var body: some View { NavigationStack { List { Text("Row") }.navigationTitle(title) } }
}`)
    expect(tree.lanes.map(({ name, root }) => [name, root.name, root.view, root.shared])).toEqual([
      ['All', 'All', 'ItemList', true],
      ['Favourites', 'Favourites', 'ItemList', true],
    ])
  })
})
