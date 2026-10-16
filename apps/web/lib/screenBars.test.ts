import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import type { ScreenBars } from '@studio/shared'
import { searchTabScreen, sheetSettings, toolbarGroups } from './screenBars'

const model = (modifiers: string) => {
  const text = `import SwiftUI
struct HomeScreen: View {
  var body: some View {
    NavigationStack {
      List { Text("Row") }
        .navigationTitle("Home")${modifiers}
    }
  }
}`
  const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files: [{ id: 'App.swift', text }] })
  return { snapshot, definition: snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'HomeScreen')! }
}
const listed = (groups: ReturnType<typeof toolbarGroups>) => groups.map(group => [group.label, group.items.map(item => [item.node.name, item.label])])

/** The Bars section of Screen settings (Wave 4b): a screen's toolbar items, grouped by where they sit. */
describe('a screen’s toolbar items in the Bars section', () => {
  const { snapshot } = model(`
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) { Button("Add", systemImage: "plus") { } }
          ToolbarItem(placement: .principal) { Text("Custom") }
          ToolbarItemGroup(placement: .bottomBar) { Button("Archive") { }; Button("Flag") { } }
          ToolbarItem(placement: .topBarLeading) { Button("Cancel") { } }
          Button("Share") { }
          ToolbarItem(placement: .confirmationAction) { Button("Done") { } }
        }`)
  const node = (name: string, nth = 0) => snapshot.nodes.filter(item => item.name === name)[nth]!.id

  it('are grouped as the section offers them: leading, trailing, the title, the bottom bar, then where iOS puts them, then set in code', () => {
    const bars: ScreenBars = { items: [
      { node: node('ToolbarItem', 0), placement: 'trailing', label: 'Add' },
      { node: node('ToolbarItem', 1), placement: 'principal', label: 'Custom' },
      { node: node('ToolbarItemGroup'), placement: 'bottom', label: 'Archive, Flag' },
      { node: node('ToolbarItem', 2), placement: 'leading', label: 'Cancel' },
      { node: node('Button', 3), placement: 'automatic', label: 'Share' },
      { node: node('ToolbarItem', 3), placement: null, label: 'Done' },
    ] }
    expect(listed(toolbarGroups(snapshot, bars))).toEqual([
      ['Leading', [['ToolbarItem', 'Cancel']]],
      ['Trailing', [['ToolbarItem', 'Add']]],
      ['Title', [['ToolbarItem', 'Custom']]],
      ['Bottom', [['ToolbarItemGroup', 'Archive, Flag']]],
      ['Automatic', [['Button', 'Share']]],
      ['Set in code', [['ToolbarItem', 'Done']]],
    ])
  })

  it('list items where a menu button goes and at the bottom bar’s status under Navigation and Status, before where iOS puts them (Wave 6c)', () => {
    const bars: ScreenBars = { items: [
      { node: node('ToolbarItem', 0), placement: 'status', label: 'Add' },
      { node: node('ToolbarItem', 2), placement: 'navigation', label: 'Cancel' },
      { node: node('Button', 3), placement: 'automatic', label: 'Share' },
      { node: node('ToolbarItem', 1), placement: 'bottom', label: 'Custom' },
    ] }
    expect(listed(toolbarGroups(snapshot, bars))).toEqual([
      ['Bottom', [['ToolbarItem', 'Custom']]],
      ['Navigation', [['ToolbarItem', 'Cancel']]],
      ['Status', [['ToolbarItem', 'Add']]],
      ['Automatic', [['Button', 'Share']]],
    ])
  })

  it('leave out an item whose layer is gone, and are none when the screen has no toolbar', () => {
    expect(listed(toolbarGroups(snapshot, { items: [{ node: 'gone', placement: 'trailing', label: 'Add' }] }))).toEqual([])
    expect(toolbarGroups(snapshot, undefined)).toEqual([])
    expect(toolbarGroups(snapshot, { items: [] })).toEqual([])
  })

  it('are read from the screen’s own toolbar, each named by what it shows', () => {
    const { snapshot: written, definition } = model(`
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) { Button("Add", systemImage: "plus") { } }
          ToolbarItem(placement: .principal) { Text("Custom") }
          ToolbarItemGroup(placement: .bottomBar) { Button("Archive") { }; Button("Flag") { } }
        }`)
    expect(listed(toolbarGroups(written, definition.bars))).toEqual([
      ['Trailing', [['ToolbarItem', 'Add']]],
      ['Title', [['ToolbarItem', 'Custom']]],
      ['Bottom', [['ToolbarItemGroup', 'Archive, Flag']]],
    ])
  })

  it('read .navigation and .status from the code into their own groups, no longer Set in code (Wave 6c)', () => {
    const { snapshot: written, definition } = model(`
        .toolbar {
          ToolbarItem(placement: .navigation) { Button("Menu", systemImage: "line.3.horizontal") { } }
          ToolbarItem(placement: .status) { Text("Updated just now") }
        }`)
    expect(listed(toolbarGroups(written, definition.bars))).toEqual([
      ['Navigation', [['ToolbarItem', 'Menu']]],
      ['Status', [['ToolbarItem', 'Updated just now']]],
    ])
  })
})

/**
 * The Search tab switch (Wave 6c). The screen holding the app's tabs is never a screen of its
 * own in Design, since its tabs are, so the switch shows in the Bars of each tab's first
 * screen and writes the screen holding them.
 */
describe('the screen a Search tab switch writes', () => {
  /** The app, its TabView written alone or, by `around`, with views beside it. */
  const tabs = (search = '', around = (tabView: string) => tabView) => buildAuthoringModel({ projectId: 'p', revision: 1, files: [{ id: 'App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
  var body: some View {
    ${around(`TabView {
      Tab("Inbox", systemImage: "tray") { InboxScreen() }
      Tab("Sent", systemImage: "paperplane") { SentScreen() }${search}
    }`)}
  }
}
struct InboxScreen: View { var body: some View { NavigationStack { List { Text("Groceries") }.navigationTitle("Inbox") } } }
struct SentScreen: View { var body: some View { NavigationStack { Text("Nothing sent").navigationTitle("Sent") } } }` }] })
  const definition = (snapshot: ReturnType<typeof tabs>, name: string) => snapshot.nodes.find(node => node.kind === 'definition' && node.name === name)

  it('is the screen holding the tabs, from a tab’s first screen, with the switch off until it has one', () => {
    const snapshot = tabs()
    const holder = searchTabScreen(snapshot, definition(snapshot, 'InboxScreen'), true)
    expect(holder?.name).toBe('HomeScreen')
    expect(holder?.bars?.searchTab).toEqual({ on: false })
  })

  it('is on, with the layer it selects, once the tabs have a search tab', () => {
    const snapshot = tabs(`
      Tab(role: .search) { Text("Search") }`)
    const searchTab = searchTabScreen(snapshot, definition(snapshot, 'SentScreen'), true)?.bars?.searchTab
    expect(searchTab?.on).toBe(true)
    expect(snapshot.nodes.find(node => node.id === searchTab?.node)?.name).toBe('Tab')
  })

  it('is the screen holding the tabs when a floating button or a mini player is beside its TabView', () => {
    const floating = tabs('', tabView => `ZStack(alignment: .bottomTrailing) {
      ${tabView}
      Button("Add", systemImage: "plus") { }
    }`)
    expect(searchTabScreen(floating, definition(floating, 'InboxScreen'), true)?.bars?.searchTab).toEqual({ on: false })
    const player = tabs(`
      Tab(role: .search) { Text("Search") }`, tabView => `VStack(spacing: 0) {
      ${tabView}
      Text("Now Playing")
    }`)
    const holder = searchTabScreen(player, definition(player, 'SentScreen'), true)
    expect(holder?.name).toBe('HomeScreen')
    expect(holder?.bars?.searchTab?.on).toBe(true)
  })

  it('is none on a screen pushed from a tab, or in an app without tabs', () => {
    const snapshot = tabs()
    expect(searchTabScreen(snapshot, definition(snapshot, 'InboxScreen'), false)).toBeUndefined()
    const { snapshot: stack, definition: home } = model('')
    expect(searchTabScreen(stack, home, true)).toBeUndefined()
  })
})

/** The Sheet section of Screen settings for a sheet page (Wave 4b): the settings of the view its closure shows, or why there are none. */
describe('a sheet page’s Sheet section', () => {
  const text = `import SwiftUI
struct NotesScreen: View {
  @State private var composing = false
  @State private var choosing = false
  var body: some View {
    VStack {
      Text("All notes")
    }
    .sheet(isPresented: $composing) {
      ComposeScreen()
    }
    .sheet(isPresented: $choosing) {
      if composing { ComposeScreen() } else { Text("Pick one") }
    }
  }
}
struct ComposeScreen: View {
  var body: some View { Text("Write something") }
}`
  const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files: [{ id: 'App.swift', text }] })
  /** Where each sheet is opened, as its page's source is: the `.sheet(…)` call. */
  const opened = (nth: number) => {
    const start = text.split('.sheet(').slice(0, nth + 1).join('.sheet(').length
    return { file: 'App.swift', start: text.lastIndexOf('\n', start) + 1, end: text.indexOf('\n    }', start) + 6 }
  }
  const compose = snapshot.nodes.find(node => node.name === 'ComposeScreen' && node.presented)!

  it('lists the settings of the one view the sheet shows', () => {
    const section = sheetSettings(snapshot, opened(0))
    expect(section.root?.id).toBe(compose.id)
    expect(section.controls.map(control => control.label)).toEqual(['Height', 'Grabber', 'Background', 'Corner radius', 'Swipe to close'])
    expect(section.reason).toBeUndefined()
  })

  it('says why, with no settings, when the sheet shows a view picked by a condition', () => {
    const section = sheetSettings(snapshot, opened(1))
    expect(section.root).toBeUndefined()
    expect(section.controls).toEqual([])
    expect(section.reason).toBe('It shows more than one view, or one picked by a condition, so how it is presented is set in Code.')
  })

  it('says why, never an empty section, when the view it shows has no settings, as while its code has errors', () => {
    const { controls: _, ...settingless } = compose
    const section = sheetSettings({ ...snapshot, nodes: snapshot.nodes.map(node => node.id === compose.id ? settingless : node) }, opened(0))
    expect(section.root?.id).toBe(compose.id)
    expect(section.controls).toEqual([])
    expect(section.reason).toBe('Fix this view’s code first.')
  })
})
