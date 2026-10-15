import { describe, expect, it } from 'vitest'
import { SCREEN_REMOVAL_REFUSALS, type Diagnostic } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState, setFontMetrics } from '@studio/swiftui-runtime'
import { templateById } from '@studio/project-model/templates'
import { canvasLanes, describeScreen, designScreenPath, designScreens, designTree, emptyScreensNote, focusedDesignScreen, liveDesignScreen, screenRemovalRefusal } from './designTree'
import { pageSlots } from './pageLayout'
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

/**
 * The screen Preview is showing, in the tree Design drew. Layers lists the running
 * screen's views under it, and the settings and their breadcrumb describe it, so a
 * screen pushed in Preview used to be filed under the tab it was pushed from.
 */
describe('the screen Preview is showing', () => {
  const files = [...templateById('dispatch')!.files]
  function designed(saved: readonly DesignScreen[] = []) {
    resetPipelineState()
    setFontMetrics([])
    const result = compile({ projectId: 'dispatch', files, canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, allPages: true, designScreens: saved })
    return designTree(result.pages, result.authoring, screenCatalog(result.authoring, result.pages, saved))
  }
  function running() {
    resetPipelineState()
    return compile({ projectId: 'dispatch', files, canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1 })
  }
  function tap(result: ReturnType<typeof compile>, label: string) {
    const target = result.renderTree!.nodes.find(node => node.hitTarget && node.a11y?.label === label)
    expect(target, label).toBeDefined()
    expect(applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
    return rerender(2)
  }
  const shown = (tree: ReturnType<typeof designed>, result: ReturnType<typeof compile>) => {
    const screen = liveDesignScreen(tree, result.viewHierarchy, result.authoring)
    return screen && [screen.name, screen.presentation, screen.depth]
  }

  it('is the screen a tapped row pushed, not the tab it was pushed from', () => {
    const tree = designed()
    expect(shown(tree, tap(running(), 'Preferences'))).toEqual(['Preferences', 'destination', 1])
  })

  // A screen given a name in the studio is drawn with an id of its own, which the running tab does not share.
  it('is the open tab, named as Design names it, before and after switching tabs', () => {
    const tree = designed([{ view: 'OverviewView', name: 'Today' }, { view: 'ProjectsView', name: 'Work' }])
    expect(tree.lanes.map(lane => lane.root.id)).toEqual(['screen:OverviewView', 'screen:ProjectsView', 'page:v-0-2'])
    const live = running()
    expect(shown(tree, live)).toEqual(['Today', 'root', 0])
    expect(shown(tree, tap(live, 'Projects'))).toEqual(['Work', 'root', 0])
  })

  it('is the sheet presented over the tab', () => {
    const tree = designed()
    expect(shown(tree, tap(running(), 'New task'))).toEqual(['New task', 'sheet', 1])
  })
})

describe('the screens Remove cannot take', () => {
  const files = [...templateById('dispatch')!.files]
  function designed() {
    resetPipelineState()
    setFontMetrics([])
    const result = compile({ projectId: 'dispatch', files, canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, allPages: true })
    return designTree(result.pages, result.authoring, screenCatalog(result.authoring, result.pages, []))
  }
  const refusal = (tree: ReturnType<typeof designed>, name: string) => {
    const screen = designScreens(tree).find(node => node.name === name)
    expect(screen, name).toBeDefined()
    return screenRemovalRefusal(screen!, tree)
  }

  it('says why, in the words the planner uses: tabs, and screens something opens', () => {
    const tree = designed()
    expect(refusal(tree, 'Overview')).toBe(SCREEN_REMOVAL_REFUSALS.tab)
    expect(refusal(tree, 'Preferences')).toBe(SCREEN_REMOVAL_REFUSALS.opened)
    expect(refusal(tree, 'New task')).toBe(SCREEN_REMOVAL_REFUSALS.opened)
  })
})

/**
 * A `#Preview` selected on the canvas is the screen Design is about (Wave 3b). Previews were
 * left out of the screens looked up, so selecting one named the app's first screen in the
 * breadcrumb, Screen settings and the Screens list.
 */
describe('a #Preview selected on the canvas', () => {
  function previewed() {
    resetPipelineState()
    setFontMetrics([])
    const text = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View { var body: some View { Text("Home") } }
#Preview("Short") { VStack { Text("Short preview") } }
`
    const result = compile({ files: [{ id: 'App.swift', text }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, allPages: true })
    expect(result.pages!.map(page => [page.name, page.kind])).toEqual([['Main page', 'root'], ['Short', 'preview']])
    return { pages: result.pages!, tree: designTree(result.pages, result.authoring, screenCatalog(result.authoring, result.pages, [])) }
  }

  it('is one of the screens Design looks up, after the app’s', () => {
    const { tree } = previewed()
    expect(designScreens(tree).map(screen => screen.name)).toEqual(['Home', 'Short'])
  })

  it('is the screen the breadcrumb, Screen settings and Screens list are about, not the app’s first', () => {
    const { pages, tree } = previewed()
    const focused = focusedDesignScreen(designScreens(tree), { selected: pages.find(page => page.name === 'Short')!.id })
    expect([focused?.name, focused?.page.kind, focused?.view]).toEqual(['Short', 'preview', undefined])
  })
})

/**
 * How Screen settings say each screen is reached, and the canvas's lanes, from one table of
 * page kinds (Wave 3b): a confirmation dialog has one name everywhere.
 */
describe('each kind of screen', () => {
  const APP = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
  @State private var composing = false
  @State private var confirming = false
  @State private var archiving = false
  var body: some View {
    NavigationStack {
      VStack { NavigationLink("More") { Text("More page").navigationTitle("More") } }
        .navigationTitle("Home")
        .sheet(isPresented: $composing) { Text("Compose").navigationTitle("Compose") }
        .alert("Delete the draft?", isPresented: $confirming) { Button("Delete", role: .destructive) { } }
        .confirmationDialog("Archive?", isPresented: $archiving) { Button("Archive") { } }
    }
  }
}
struct DraftScreen: View { var body: some View { Text("Draft") } }
#Preview("Short") { VStack { Text("Short preview") } }
`
  function drawn() {
    resetPipelineState()
    setFontMetrics([])
    const saved = [{ view: 'DraftScreen', name: 'Draft' }]
    const result = compile({ files: [{ id: 'App.swift', text: APP }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, allPages: true, designScreens: saved })
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    return { pages: result.pages!, tree: designTree(result.pages, result.authoring, screenCatalog(result.authoring, result.pages, saved)) }
  }

  it('says how it is reached in Screen settings', () => {
    const { tree } = drawn()
    expect(designScreens(tree).map(screen => [screen.name, describeScreen(screen, tree)])).toEqual([
      ['Home', 'The app starts here'],
      ['More', 'Pushed from Home'],
      ['Delete the draft?', 'Alert · shown over Home'],
      ['Archive?', 'Confirmation dialog · shown over Home'],
      ['Compose', 'Sheet · opened from Home'],
      ['Draft', 'Not linked yet · add Navigate to on a button to connect it'],
      ['Short', 'A #Preview · drawn on its own, not in the app'],
    ])
  })

  it('names the canvas’s lanes as the canvas numbers them: the app’s, then the screens not linked yet, then the previews', () => {
    const { pages, tree } = drawn()
    const lanes = canvasLanes(tree)
    expect(lanes.names).toEqual(['Home', 'Not linked yet', 'Previews'])
    expect(lanes.icons).toEqual([undefined, undefined, undefined])
    expect(pageSlots(pages).filter(slot => !slot.parentId).map(slot => [slot.page.name, lanes.names[slot.lane]])).toEqual([['Home', 'Home'], ['Draft', 'Not linked yet'], ['Short', 'Previews']])
  })
})
