import { expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import type { PagePreview } from '@studio/shared'
import { screenCatalog, screenLabel } from './screens'

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
