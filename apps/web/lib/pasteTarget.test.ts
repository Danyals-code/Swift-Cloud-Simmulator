import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { pasteEdit } from './pasteTarget'

/**
 * Where ⌘V puts what was copied (D6): right after the selection, as Keynote and Figma
 * put it, and into a container only where nothing sensible is beside it.
 */
const FILE = 'App.swift'
const app = (content: string) => `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
    var body: some View {
${content}
    }
}
`
const LIST = app(`        NavigationStack {
            List {
                Section("Next up") {
                    Text("Sketch")
                    Text("Launch")
                }
                Section("Workspace") {
                    Text("Preferences")
                }
            }
        }`)

/** ⌘V with the view written at `selected` selected: the file after the paste. */
function paste(text: string, selected: string, snippet = 'Text("Pasted")'): string {
  const files = [{ id: FILE, text }]
  const model = buildAuthoringModel({ projectId: 'p', revision: 1, files })
  const node = model.nodes.find(n => n.kind !== 'definition' && n.source.start === text.indexOf(selected))
  if (!node) throw new Error(`No view at ${selected}`)
  const plan = planDesignEdit({ projectId: 'p', baseRevision: 1, files, scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: pasteEdit(model.nodes, node, { snippet, values: [] }) })
  if (!plan.ok) throw new Error(plan.reason)
  return plan.changes[0]!.after
}

describe('where a paste goes', () => {
  it('goes right after a section that has views in it, not into it', () => {
    expect(paste(LIST, 'Section("Next up")')).toContain(`                    Text("Launch")
                }
                Text("Pasted")
                Section("Workspace") {`)
  })

  it('goes into the screen\'s own stack, where beside it would be a second screen\'s worth of content', () => {
    const blank = app(`        VStack {
            Text("Hello")
        }`)
    expect(paste(blank, 'VStack')).toContain(`        VStack {
            Text("Hello")
            Text("Pasted")
        }`)
  })

  it('goes after a list in a navigation stack, which a click on the canvas selects as a whole', () => {
    expect(paste(LIST, 'List {')).toContain(`                    Text("Preferences")
                }
            }
            Text("Pasted")
        }`)
  })

  it('goes into an empty stack, and right after a view that holds none', () => {
    const empty = app(`        VStack {
            Text("Hello")
            HStack {
            }
        }`)
    expect(paste(empty, 'HStack')).toContain(`            HStack {
                Text("Pasted")
            }`)
    expect(paste(LIST, 'Text("Sketch")')).toContain(`                    Text("Sketch")
                    Text("Pasted")
                    Text("Launch")`)
  })

  it('goes into a repeated row\'s own stack, since beside it would be a second row for every item', () => {
    const rows = app(`        VStack {
            ForEach(0..<3, id: \\.self) { i in
                HStack {
                    Text("Row")
                }
            }
        }`)
    expect(paste(rows, 'HStack')).toContain(`                HStack {
                    Text("Row")
                    Text("Pasted")
                }
            }`)
  })
})
