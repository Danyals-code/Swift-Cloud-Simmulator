import { beforeEach, expect, it } from 'vitest'
import { applyEvent, compile, rerender, resetPipelineState, setAllPages } from '@studio/swiftui-runtime'
import type { CompileResult, RenderTree } from '@studio/shared'

/**
 * The page gallery.
 *
 * Design draws every page at once, which means composing and laying out pages the
 * device is not showing. The whole claim of this feature is that doing so is *free
 * of consequence*: every tab's body was evaluated by the pass that drew the live
 * one, so the extra pages cost a composition and a layout and change nothing about
 * the app that is running. Each test below is that claim from one side.
 */

beforeEach(resetPipelineState)
let revision = 0

function run(body: string, state = '', allPages = true): CompileResult {
  return compile({
    files: [{ id: 'App.swift', text: `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { ${state}
var body: some View { ${body} } }` }],
    canvas: { width: 402, height: 874 },
    safeArea: { top: 59, leading: 0, bottom: 34, trailing: 0 },
    colorScheme: 'light',
    allPages,
    revision: ++revision,
  })
}

const texts = (tree: RenderTree | null | undefined): string[] =>
  (tree?.nodes ?? []).flatMap(node => node.text?.runs.map(run => run.text) ?? [])

const TABS = `TabView {
  NavigationStack { VStack { Text("Home body"); Button("Add") { count += 1 }; Text("Count: \\(count)") } .navigationTitle("Home") }.tabItem { Label("Home", systemImage: "house") }
  NavigationStack { List { Text("Saved one"); Text("Saved two") }.navigationTitle("Saved") }.tabItem { Label("Saved", systemImage: "star") }
  NavigationStack { Form { Toggle("Enabled", isOn: $enabled) }.navigationTitle("Settings") }.tabItem { Label("Settings", systemImage: "gear") }
}`

it('draws every page, each composed as that page rather than as the one on screen', () => {
  const result = run(TABS, '@State var count = 0; @State var enabled = true')
  expect(result.diagnostics).toEqual([])

  const pages = result.pages!
  expect(pages.map(page => page.name)).toEqual(['Home', 'Saved', 'Settings'])
  expect(pages.map(page => page.active)).toEqual([true, false, false])
  expect(pages.every(page => !!page.handlerId)).toBe(true)
  // The ids are the hierarchy's, so Layers and the gallery name the same pages.
  expect(pages.map(page => page.id)).toEqual(result.viewHierarchy!.map(layer => layer.id))

  // Each page carries its own content and its own navigation title - which is the
  // part a snapshot of the live page could not have given.
  expect(texts(pages[0]!.tree)).toEqual(expect.arrayContaining(['Home body', 'Count: 0', 'Home']))
  expect(texts(pages[1]!.tree)).toEqual(expect.arrayContaining(['Saved one', 'Saved two', 'Saved']))
  expect(texts(pages[2]!.tree)).toEqual(expect.arrayContaining(['Enabled', 'Settings']))
  expect(texts(pages[1]!.tree)).not.toContain('Home body')

  // The live page is the tree on screen, not a second layout of the same views.
  expect(pages[0]!.tree).toBe(result.renderTree)
  // Every page draws the tab bar, each with its own tab selected.
  for (const page of pages) expect(texts(page.tree)).toEqual(expect.arrayContaining(['Home', 'Saved', 'Settings']))
})

it('changes nothing about the app it is drawing', () => {
  const opened = run(TABS, '@State var count = 0; @State var enabled = true')
  const before = texts(opened.renderTree!)

  // The selection is untouched: the live page is still the first tab, and the
  // hierarchy still says so.
  expect(opened.viewHierarchy!.map(page => page.page?.active)).toEqual([true, false, false])

  // State the other pages read is untouched too, and the live page still answers
  // to a press - the handler table belongs to the app, not to the last page drawn.
  const add = opened.pages![0]!.tree.nodes.find(node => node.a11y?.label === 'Add' && node.hitTarget?.enabled)!
  applyEvent({ kind: 'tap', handlerId: add.hitTarget!.handlerId, location: { x: 0, y: 0 } })
  const after = rerender(++revision)
  expect(texts(after.renderTree!)).toEqual(expect.arrayContaining(['Count: 1']))
  expect(after.pages!.map(page => page.active)).toEqual([true, false, false])
  expect(texts(after.pages![0]!.tree)).toEqual(expect.arrayContaining(['Count: 1']))
  expect(before).not.toEqual(texts(after.renderTree!))
})

it('follows the app when a page is opened, and is the same drawing either way', () => {
  const result = run(TABS, '@State var count = 0; @State var enabled = true')
  const saved = result.pages![1]!

  applyEvent({ kind: 'tap', handlerId: saved.handlerId!, location: { x: 0, y: 0 } })
  const opened = rerender(++revision)

  expect(opened.pages!.map(page => page.active)).toEqual([false, true, false])
  expect(texts(opened.renderTree!)).toEqual(expect.arrayContaining(['Saved one']))
  // The page drawn beside the live one was not a different screen from the live one.
  expect(texts(opened.pages![1]!.tree).sort()).toEqual(texts(saved.tree).sort())
})

it('is off unless it is asked for, and switches on without a recompile', () => {
  const plain = run(TABS, '@State var count = 0; @State var enabled = true', false)
  expect(plain.pages).toBeUndefined()

  const opened = setAllPages(true, ++revision)!
  expect(opened.pages).toHaveLength(3)
  expect(texts(opened.renderTree!)).toEqual(texts(plain.renderTree!))

  const closed = setAllPages(false, ++revision)!
  expect(closed.pages).toBeUndefined()

  resetPipelineState()
  // Nothing compiled yet: an answer rather than a throw, because the studio's
  // toggle can be pressed before the first program has run.
  expect(setAllPages(true, ++revision)).not.toBeNull()
})

it('reports a single page for an app that has one, and one that a tab cannot open', () => {
  const result = run('VStack { Text("Only screen") }')
  expect(result.pages).toHaveLength(1)
  expect(result.pages![0]!.name).toBe('Main page')
  expect(result.pages![0]!.active).toBe(true)
  expect(result.pages![0]!.handlerId).toBeUndefined()
  expect(result.pages![0]!.tree).toBe(result.renderTree)
})

it('draws the first twelve pages of an app that has more, and says the rest exist', () => {
  const result = run('TabView { ForEach(0..<20, id: \\.self) { index in Text("Screen \\(index)").tabItem { Text("Tab \\(index)") } } }')
  expect(result.diagnostics).toEqual([])
  expect(result.viewHierarchy).toHaveLength(20)
  expect(result.pages).toHaveLength(12)
  expect(texts(result.pages![11]!.tree)).toEqual(expect.arrayContaining(['Screen 11']))
})
