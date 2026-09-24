import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@studio/shared'
import { compile, resetPipelineState, setFontMetrics } from '@studio/swiftui-runtime'
import { designScreenPath, designTree, emptyScreensNote } from './designTree'
import { screenCatalog, type DesignScreen } from './screens'

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
  function screensOf(declarations: string, saved: readonly DesignScreen[] = []) {
    resetPipelineState()
    setFontMetrics([])
    const text = `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }\n${declarations}`
    const result = compile({ files: [{ id: 'App.swift', text }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, allPages: true, designScreens: saved })
    expect(result.diagnostics).toEqual([])
    return designTree(result.pages, result.authoring, screenCatalog(result.authoring, result.pages, saved))
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

  const LISTS = `struct HomeScreen: View {
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
}`

  it("keeps each tab's title when the view they share was given a name", () => {
    const tree = screensOf(LISTS, [{ view: 'ItemList', name: 'Lists' }])
    expect(tree.lanes.map(({ root }) => root.name)).toEqual(['All', 'Favourites'])
  })

  it('names tabs written in place by their titles, and gives them no view to act on', () => {
    const tree = screensOf(`struct HomeScreen: View {
  var body: some View {
    TabView {
      NavigationStack { Text("Mail").navigationTitle("Inbox") }.tabItem { Label("Inbox", systemImage: "tray") }
      NavigationStack { Text("Out").navigationTitle("Sent") }.tabItem { Label("Sent", systemImage: "paperplane") }
    }
  }
}`)
    expect(tree.lanes.map(({ root }) => [root.name, root.view])).toEqual([['Inbox', undefined], ['Sent', undefined]])
  })

  it('treats one sheet opened from two screens as one screen, which can be renamed', () => {
    const tree = screensOf(`struct HomeScreen: View {
  @State private var editing = false
  var body: some View {
    NavigationStack {
      VStack { Button("Edit") { editing = true }; NavigationLink("More") { MoreScreen() } }
        .navigationTitle("Home")
        .sheet(isPresented: $editing) { EditScreen() }
    }
  }
}
struct MoreScreen: View {
  @State private var editing = false
  var body: some View { Button("Edit") { editing = true }.navigationTitle("More").sheet(isPresented: $editing) { EditScreen() } }
}
struct EditScreen: View {
  var body: some View { NavigationStack { Text("Form").navigationTitle("Edit") } }
}`)
    expect(tree.sheets.map(({ screen, openers }) => [screen.name, screen.view, screen.shared, openers.length])).toEqual([['Edit', 'EditScreen', undefined, 2]])
  })
})

/**
 * The rows the Design panel opens to show the selected screen (D13). A screen just
 * added is linked from nothing yet, and used to be selected inside a closed group.
 */
describe('the way the Design panel opens to a screen', () => {
  function treeOf(declarations: string, saved: readonly DesignScreen[] = []) {
    resetPipelineState()
    setFontMetrics([])
    const text = `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }\n${declarations}`
    const result = compile({ files: [{ id: 'App.swift', text }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, allPages: true, designScreens: saved })
    return designTree(result.pages, result.authoring, screenCatalog(result.authoring, result.pages, saved))
  }

  it('opens Not linked yet for a screen nothing links to, as one just added is', () => {
    const tree = treeOf('struct HomeScreen: View { var body: some View { Text("Home") } }\nstruct DraftScreen: View { var body: some View { Text("Draft") } }', [{ view: 'DraftScreen', name: 'Draft' }])
    const draft = tree.detached[0]!
    expect(draft.name).toBe('Draft')

    expect(designScreenPath(tree, draft.id)).toEqual(['group:detached', draft.id])
  })

  it('opens Sheets for a screen a sheet presents', () => {
    const tree = treeOf('struct HomeScreen: View {\n  @State private var editing = false\n  var body: some View { Button("Edit") { editing = true }.sheet(isPresented: $editing) { EditScreen() } }\n}\nstruct EditScreen: View { var body: some View { Text("Edit") } }')
    const edit = tree.sheets[0]!.screen

    expect(designScreenPath(tree, edit.id)).toEqual(['group:sheets', edit.id])
  })
})
