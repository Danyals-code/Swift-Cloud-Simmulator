import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit, NAVIGATION_FILE } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringOperation, SourceFile } from '@studio/shared'

/**
 * The app's own navigation, edited as a list of tabs.
 *
 * The studio reads back the shape it writes - `Screen().tabItem { Label(…) } ` -
 * and refuses anything else, so a designer never silently loses hand-written tab
 * code. Every case here checks the Swift that comes out, not just the model.
 */

const APP = (content: string) => `import SwiftUI\n@main\nstruct DemoApp: App {\n    var body: some Scene {\n        WindowGroup { ${content} }\n    }\n}\n`
const SCREENS = `struct HomeScreen: View {\n    var body: some View { Text("Home") }\n}\nstruct SavedScreen: View {\n    var body: some View { Text("Saved") }\n}\nstruct ProfileScreen: View {\n    var body: some View { Text("Profile") }\n}\n`
const TABS = `struct RootView: View {\n    var body: some View {\n        TabView {\n            HomeScreen()\n                .tabItem { Label("Home", systemImage: "house") }\n            SavedScreen()\n                .tabItem { Label("Saved", systemImage: "bookmark") }\n        }\n    }\n}\n`

const files = (...texts: string[]): SourceFile[] => [{ id: 'Sources/App.swift', text: texts.join('\n') }]
const tabbed = () => files(APP('RootView()'), TABS, SCREENS)
const model = (project: readonly SourceFile[]) => buildAuthoringModel({ projectId: 'nav', revision: 1, files: project, deploymentTarget: '17.0' })

function edit(project: readonly SourceFile[], operation: AuthoringOperation) {
  const snapshot = model(project)
  const node = snapshot.nodes[0]!
  const plan = planDesignEdit({ projectId: 'nav', baseRevision: 1, files: project, deploymentTarget: '17.0', scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
  if (!plan.ok) throw new Error(plan.reason)
  return project.map(file => ({ ...file, text: plan.changes.find(change => change.file === file.id)?.after ?? file.text }))
    .concat(plan.changes.filter(change => change.before === null).map(change => ({ id: change.file, text: change.after })))
}
const refuse = (project: readonly SourceFile[], operation: AuthoringOperation) => {
  try { edit(project, operation); return null } catch (error) { return (error as Error).message }
}
const draws = (project: readonly SourceFile[]) => {
  resetPipelineState()
  const result = compile({ projectId: 'nav', revision: 1, files: project, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}

describe('reading the app’s navigation', () => {
  it('lists the tabs with their names, symbols and screens', () => {
    expect(model(tabbed()).navigation).toMatchObject({
      style: 'tabs',
      editable: true,
      tabs: [{ name: 'Home', icon: 'house', screen: 'HomeScreen' }, { name: 'Saved', icon: 'bookmark', screen: 'SavedScreen' }],
    })
  })

  it('reports a single-stack app with the screen it starts on', () => {
    expect(model(files(APP('HomeScreen()'), SCREENS)).navigation).toMatchObject({ style: 'stack', root: 'HomeScreen', editable: true, tabs: [] })
  })

  it('reads a tab label with interpolation as read-only instead of failing to open', () => {
    const interpolated = `struct RootView: View {\n    let who = "Ana"\n    var body: some View {\n        TabView {\n            HomeScreen()\n                .tabItem { Label("Hi \\(who)", systemImage: "house") }\n            SavedScreen()\n                .tabItem { Label("Saved", systemImage: "bookmark") }\n        }\n    }\n}\n`
    const project = files(APP('RootView()'), interpolated, SCREENS)
    // The bug this covers took the whole project down: the model could not be built.
    expect(() => model(project)).not.toThrow()
    expect(model(project).navigation).toMatchObject({ style: 'tabs', editable: false })
    draws(project)
  })

  it('finds a tab bar inside a navigation container rather than offering to build a second one', () => {
    const nested = `struct RootView: View {\n    var body: some View {\n        NavigationStack {\n            TabView {\n                HomeScreen()\n                    .tabItem { Label("Home", systemImage: "house") }\n                SavedScreen()\n                    .tabItem { Label("Saved", systemImage: "bookmark") }\n            }\n        }\n    }\n}\n`
    const project = files(APP('RootView()'), nested, SCREENS)
    expect(model(project).navigation).toMatchObject({ style: 'tabs', editable: true, tabs: [{ name: 'Home' }, { name: 'Saved' }] })
    const added = edit(project, { kind: 'tab-add', screen: 'ProfileScreen', name: 'Profile', icon: 'person' })
    expect(added.some(file => file.text.includes('struct AppNavigation'))).toBe(false)
    expect(model(added).navigation?.tabs).toHaveLength(3)
  })

  it('finds the tab bar one view further in, and reads the label inside the tab item', () => {
    // The shape several starters use: the root shows a view that holds the TabView,
    // and each tab's screen contains labels of its own.
    const main = `struct RootView: View {\n    var body: some View { MainTabs() }\n}\nstruct MainTabs: View {\n    var body: some View {\n        TabView {\n            NavigationStack {\n                Label("Take a walk outside", systemImage: "leaf")\n            }\n            .tabItem { Label("Today", systemImage: "sun.max") }\n            SavedScreen()\n                .tabItem { Label("Saved", systemImage: "bookmark") }\n        }\n    }\n}\n`
    const project = files(APP('RootView()'), main, SCREENS)
    expect(model(project).navigation).toMatchObject({ style: 'tabs', editable: true, tabs: [{ name: 'Today', icon: 'sun.max' }, { name: 'Saved', icon: 'bookmark' }] })
    // A tab whose screen is written inline can still be renamed, and never gets a
    // second tab bar built around the app.
    const renamed = edit(project, { kind: 'tab-update', index: 0, name: 'Home' })
    expect(renamed.some(file => file.text.includes('struct AppNavigation'))).toBe(false)
    expect(model(renamed).navigation?.tabs.map(tab => tab.name)).toEqual(['Home', 'Saved'])
    draws(renamed)
  })

  it('shows tabs built in Swift as read-only, with a reason to open the code', () => {
    const computed = `struct RootView: View {\n    let names = ["Home", "Saved"]\n    var body: some View {\n        TabView {\n            ForEach(names, id: \\.self) { name in\n                HomeScreen().tabItem { Label(name, systemImage: "house") }\n            }\n        }\n    }\n}\n`
    const navigation = model(files(APP('RootView()'), computed, SCREENS)).navigation!
    expect(navigation.style).toBe('tabs')
    expect(navigation.editable).toBe(false)
    expect(navigation.reason).toContain('Open the code')
  })
})

describe('editing tabs', () => {
  it('renames a tab and changes its symbol, leaving the rest of the line alone', () => {
    const renamed = edit(tabbed(), { kind: 'tab-update', index: 1, name: 'Bookmarks', icon: 'star' })
    expect(renamed[0]!.text).toContain('SavedScreen()\n                .tabItem { Label("Bookmarks", systemImage: "star") }')
    expect(model(renamed).navigation?.tabs.map(tab => tab.name)).toEqual(['Home', 'Bookmarks'])
    draws(renamed)
  })

  it('points a tab at another screen', () => {
    const moved = edit(tabbed(), { kind: 'tab-update', index: 1, screen: 'ProfileScreen' })
    expect(moved[0]!.text).toContain('ProfileScreen()\n                .tabItem { Label("Saved", systemImage: "bookmark") }')
    expect(refuse(moved, { kind: 'tab-update', index: 1, screen: 'HomeScreen' })).toContain('already a tab')
  })

  it('adds a tab at the end and refuses a screen that is already one', () => {
    const added = edit(tabbed(), { kind: 'tab-add', screen: 'ProfileScreen', name: 'Profile', icon: 'person' })
    expect(added[0]!.text).toContain('SavedScreen()\n                .tabItem { Label("Saved", systemImage: "bookmark") }\n            ProfileScreen()\n                .tabItem { Label("Profile", systemImage: "person") }')
    expect(model(added).navigation?.tabs).toHaveLength(3)
    expect(draws(added).renderTree?.nodes.some(node => node.text?.runs.some(run => run.text === 'Profile'))).toBe(true)
    expect(refuse(added, { kind: 'tab-add', screen: 'ProfileScreen', name: 'Again', icon: 'person' })).toContain('already a tab')
    expect(refuse(added, { kind: 'tab-add', screen: 'NoSuchScreen', name: 'Nope', icon: 'person' })).toContain('Choose a screen')
  })

  it('removes a tab, and keeps the last one', () => {
    const removed = edit(tabbed(), { kind: 'tab-remove', index: 0 })
    expect(removed[0]!.text).not.toContain('HomeScreen()\n                .tabItem')
    expect(model(removed).navigation?.tabs.map(tab => tab.screen)).toEqual(['SavedScreen'])
    expect(refuse(removed, { kind: 'tab-remove', index: 0 })).toContain('at least one')
    draws(removed)
  })

  it('moves a tab past the others rather than trading places with one', () => {
    const three = edit(tabbed(), { kind: 'tab-add', screen: 'ProfileScreen', name: 'Profile', icon: 'person' })
    const moved = edit(three, { kind: 'tab-move', index: 0, toIndex: 2 })
    expect(model(moved).navigation?.tabs.map(tab => tab.name)).toEqual(['Saved', 'Profile', 'Home'])
    draws(moved)
  })

  it('swaps two tabs without touching anything else on their lines', () => {
    const source = tabbed()
    const swapped = edit(source, { kind: 'tab-move', index: 0, toIndex: 1 })
    expect(model(swapped).navigation?.tabs.map(tab => tab.name)).toEqual(['Saved', 'Home'])
    expect(edit(swapped, { kind: 'tab-move', index: 1, toIndex: 0 })[0]!.text).toBe(source[0]!.text)
  })

  it('refuses every change to tabs built in Swift', () => {
    const computed = `struct RootView: View {\n    var body: some View {\n        TabView {\n            HomeScreen().tabItem { Label(title, systemImage: "house") }\n        }\n    }\n    var title: String { "Home" }\n}\n`
    const project = files(APP('RootView()'), computed, SCREENS)
    expect(refuse(project, { kind: 'tab-update', index: 0, name: 'Start' })).toContain('Open the code')
  })
})

describe('changing the navigation style', () => {
  it('moves a one-screen app onto a tab bar in its own file', () => {
    const project = files(APP('HomeScreen()'), SCREENS)
    const tabs = edit(project, { kind: 'navigation-style', style: 'tabs', name: 'Home', icon: 'house' })
    const navigation = tabs.find(file => file.id === NAVIGATION_FILE)!
    expect(navigation.text).toContain('struct AppNavigation: View {')
    expect(navigation.text).toContain('TabView {\n            HomeScreen()\n                .tabItem { Label("Home", systemImage: "house") }\n        }')
    expect(tabs[0]!.text).toContain('WindowGroup { AppNavigation() }')
    expect(model(tabs).navigation).toMatchObject({ style: 'tabs', editable: true, tabs: [{ name: 'Home', screen: 'HomeScreen' }] })
    expect(draws(tabs).renderTree?.nodes.some(node => node.text?.runs.some(run => run.text === 'Home'))).toBe(true)
  })

  it('adds a second tab to an app that had none, keeping the first screen’s own name', () => {
    const project = files(APP('HomeScreen()'), SCREENS)
    const tabs = edit(project, { kind: 'tab-add', screen: 'SavedScreen', name: 'Saved', icon: 'bookmark' })
    expect(model(tabs).navigation?.tabs.map(tab => [tab.screen, tab.name, tab.icon])).toEqual([['HomeScreen', 'Home', 'house'], ['SavedScreen', 'Saved', 'bookmark']])
    draws(tabs)
  })

  it('writes the tab bar beside the app’s own files, wherever they are', () => {
    const flat: SourceFile[] = [{ id: 'App.swift', text: APP('HomeScreen()') + SCREENS }]
    const snapshot = buildAuthoringModel({ projectId: 'nav', revision: 1, files: flat, deploymentTarget: '17.0' })
    const node = snapshot.nodes[0]!
    const plan = planDesignEdit({ projectId: 'nav', baseRevision: 1, files: flat, deploymentTarget: '17.0', scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'navigation-style', style: 'tabs', name: 'Home', icon: 'house' } })
    expect(plan.ok && plan.changes.some(change => change.file === 'App/AppNavigation.swift' && change.before === null)).toBe(true)
  })

  it('goes back to a single stack only once one tab is left', () => {
    expect(refuse(tabbed(), { kind: 'navigation-style', style: 'stack' })).toContain('Remove the other tabs first')
    const one = edit(tabbed(), { kind: 'tab-remove', index: 1 })
    const stack = edit(one, { kind: 'navigation-style', style: 'stack' })
    expect(stack[0]!.text).toContain('WindowGroup { HomeScreen() }')
    expect(model(stack).navigation).toMatchObject({ style: 'stack', root: 'HomeScreen' })
    draws(stack)
  })
})
