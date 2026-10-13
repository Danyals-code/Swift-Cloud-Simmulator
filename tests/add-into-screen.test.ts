import { beforeEach, describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { planDesignEdit } from '@studio/swift-sema'
import { insertionLayer } from '../apps/web/lib/layers'

/**
 * Add with nothing selected, on screens written as the AI writes them: the new view
 * goes into the screen's content, through a ScrollView or a Group to the stack or the
 * list they hold, and into a list of records as its last row. Each of these was
 * refused as "somewhere other than where it was dropped".
 */
beforeEach(resetPipelineState)

const FILE = 'Sources/App.swift'
const app = (screen: string) => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                ContentView()
            }
        }
    }
}

struct Item: Identifiable {
    let id: Int
    var name: String
}

struct ContentView: View {
    @State private var items: [Item] = [Item(id: 1, name: "One"), Item(id: 2, name: "Two")]
    @State private var showingForm = false

    var body: some View {
${screen}
    }
}
`
const TOOLBAR = `
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New") { showingForm = true }
            }
        }`

/** Add › Text with nothing selected: the studio's own target, then the planner. */
function addText(text: string): string {
  const files = [{ id: FILE, text }]
  const result = compile({ projectId: 'add', revision: 1, files, canvas: { width: 402, height: 874 }, colorScheme: 'light' })
  const layer = insertionLayer(result.viewHierarchy ?? [])!
  const node = result.authoring!.nodes.find(n => n.id === result.authoring!.runtimeToSource[layer.id])!
  const plan = planDesignEdit({ projectId: 'add', baseRevision: 1, files, scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'insert', snippet: 'Text("Text")' } })
  if (!plan.ok) throw new Error(plan.reason)
  return plan.changes[0]!.after
}

describe('Add with nothing selected, on the screens the AI writes', () => {
  it('goes through a ScrollView into the stack it holds, after its last view', () => {
    const screen = (last: string) => `        ScrollView {
            VStack(spacing: 14) {
                ForEach(items) { item in
                    Text(item.name)
                }${last}
            }
            .padding(20)
        }${TOOLBAR}`
    expect(addText(app(screen('')))).toBe(app(screen('\n                Text("Text")')))
  })

  it('makes the new view the last row of a list of records', () => {
    const before = app(`        List(items) { item in
            Text(item.name)
        }
        .navigationTitle("Items")${TOOLBAR}`)
    expect(addText(before)).toBe(app(`        List {
            ForEach(items) { item in
                Text(item.name)
            }
            Text("Text")
        }
        .navigationTitle("Items")${TOOLBAR}`))
  })

  it('keeps the rows\' id with them', () => {
    const before = app(`        List(items, id: \\.id) { item in Text(item.name) }${TOOLBAR}`)
    expect(addText(before)).toBe(app(`        List {
            ForEach(items, id: \\.id) { item in Text(item.name) }
            Text("Text")
        }${TOOLBAR}`))
  })

  it('goes into the list a Group shows when there are records, rather than beside its empty state', () => {
    const screen = (list: string) => `        Group {
            if items.isEmpty {
                ContentUnavailableView("No Items", systemImage: "tray", description: Text("Add one to start."))
            } else {
${list}
            }
        }
        .sheet(isPresented: $showingForm) {
            Text("Form")
        }`
    expect(addText(app(screen(`                List(items) { item in
                    Text(item.name)
                }`)))).toBe(app(screen(`                List {
                    ForEach(items) { item in
                        Text(item.name)
                    }
                    Text("Text")
                }`)))
  })
})
