import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import type { ScreenBars } from '@studio/shared'
import { sheetSettings, toolbarGroups } from './screenBars'

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
