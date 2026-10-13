import { describe, expect, it } from 'vitest'
import type { ModifierCatalogEntry } from '@studio/shared'
import { buildAuthoringModel } from './authoring'

/** The Add modifier menu says what each modifier does, in a designer's words. */
const APP = `import SwiftUI

@main
struct MenuApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct ContentView: View {
    @State private var on = true
    @State private var choice = 0
    @State private var text = ""
    var body: some View {
        ScrollView {
            Text("Hello")
            Button("Go") {
            }
            Toggle("On", isOn: $on)
            Picker("Choice", selection: $choice) {
                Text("One").tag(0)
            }
            ProgressView(value: 0.5)
            Gauge(value: 0.5) {
                Text("Level")
            }
            Label("Inbox", systemImage: "tray")
            TextField("Name", text: $text)
            Image(systemName: "star")
            List {
                Text("Row")
            }
        }
    }
}
`

describe('the Add modifier menu', () => {
  it('describes each modifier in other words than its name', () => {
    const nodes = buildAuthoringModel({ projectId: 'menu', revision: 1, files: [{ id: 'Sources/App.swift', text: APP }], deploymentTarget: '17.0' }).nodes
    const entries = new Map<string, ModifierCatalogEntry>()
    for (const node of nodes) for (const entry of node.modifierCatalog ?? []) if (!entry.hidden) entries.set(entry.name, entry)
    expect(entries.size).toBeGreaterThan(60)
    const repeated = [...entries.values()].filter(entry => !entry.description || entry.description.toLowerCase() === entry.label.toLowerCase()).map(entry => entry.label)
    expect(repeated).toEqual([])
  })
})
