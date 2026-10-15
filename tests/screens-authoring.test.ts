import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import type { AuthoringNode } from '@studio/shared'
import { XCODE, typecheckInXcode } from './helpers/layer-project'

/**
 * Wave 3b-2: an alert's or a confirmation dialog's parts as Design lists and edits them,
 * where they are written (doc 18, Concern 1 item 11).
 */

const app = (body: string, state = '') => `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    ${state}
    var body: some View {
        ${body}
    }
}
`
const model = (text: string) => buildAuthoringModel({ projectId: 'screens', revision: 1, files: [{ id: 'App.swift', text }] })
const writtenAs = (text: string, node: AuthoringNode) => text.slice(node.source.start, node.source.end)

/** The parts of the view written as `written`, `Slot: [views]` with each view as written. */
function parts(text: string, written: string): string[] {
  const snapshot = model(text)
  const byId = new Map(snapshot.nodes.map(node => [node.id, node]))
  const listed = (id: string): string => {
    const node = byId.get(id)!
    return node.kind === 'branch' ? `${node.name}: [${node.children.map(listed).join(', ')}]` : writtenAs(text, node)
  }
  const owner = snapshot.nodes.find(node => node.kind !== 'branch' && node.kind !== 'definition' && writtenAs(text, node).startsWith(written))!
  return owner.children.map(listed)
}

const LEGACY_APP = app(`Text("Inbox")
            .alert(isPresented: $deleted) {
                Alert(title: Text("Deleted"), message: Text("Gone for good"), dismissButton: .default(Text("OK")))
            }`, '@State private var deleted = false')

describe('an alert written with SwiftUI’s older Alert', () => {
  const LEGACY = LEGACY_APP
  const ALERT = 'Alert(title: Text("Deleted"), message: Text("Gone for good"), dismissButton: .default(Text("OK")))'

  it('is listed as the Alert it returns, not as actions', () => {
    expect(parts(LEGACY, 'Text("Inbox")')).toEqual([`Alert: [${ALERT}]`])
  })

  it('is shown read only, each of its values saying why', () => {
    const alert = model(LEGACY).nodes.find(node => writtenAs(LEGACY, node) === ALERT)!
    expect(alert.kind).toBe('opaque')
    expect(alert.controls).toEqual([])
    expect(alert.modifierCatalog?.filter(entry => entry.available)).toEqual([])
    expect(alert.properties.map(property => [property.name, property.writable, !!property.reason])).toEqual([['title', false, true], ['message', false, true], ['dismissButton', false, true]])
  })
})

/** The file after the view written as `written` has `control` set to `value`, or the planner's reason. */
function edit(text: string, written: string, control: string, value: string): string {
  const target = model(text).nodes.find(node => node.kind !== 'branch' && writtenAs(text, node) === written)!
  const plan = planDesignEdit({ projectId: 'screens', baseRevision: 1, files: [{ id: 'App.swift', text }], scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation: { kind: 'property', control, value } })
  return plan.ok ? plan.changes[0]!.after : plan.reason
}

describe('a title written as words', () => {
  const ALERT = app(`Text("Inbox")
            .alert("Delete the draft?", isPresented: $confirming) {
                Button("Delete", role: .destructive) { }
            } message: {
                Text("This can't be undone.")
            }`, '@State private var confirming = false')
  const DIALOG = app(`Text("Inbox")
            .confirmationDialog("Archive the list?", isPresented: $archiving, titleVisibility: .visible) {
                Button("Archive") { }
            }`, '@State private var archiving = false')

  it('is the Text SwiftUI makes of it, offering only its words', () => {
    const title = model(ALERT).nodes.find(node => writtenAs(ALERT, node) === '"Delete the draft?"')!
    expect([title.name, title.controls?.map(control => [control.id, control.value])]).toEqual(['Text', [['content', 'Delete the draft?']]])
    expect([title.layer, title.modifiers, title.modifierCatalog]).toEqual([undefined, undefined, undefined])
    // The message after it is a Text written out, and keeps everything a Text has.
    const message = model(ALERT).nodes.find(node => writtenAs(ALERT, node) === 'Text("This can\'t be undone.")')!
    expect(message.layer).toBeDefined()
    expect(message.modifierCatalog?.length).toBeGreaterThan(0)
  })

  it('is changed where it is written, in an alert and a dialog', () => {
    expect(edit(ALERT, '"Delete the draft?"', 'content', 'Discard "the" draft?')).toBe(ALERT.replace('"Delete the draft?"', '"Discard \\"the\\" draft?"'))
    expect(edit(DIALOG, '"Archive the list?"', 'content', 'Archive it all?')).toBe(DIALOG.replace('"Archive the list?"', '"Archive it all?"'))
  })

  it('is shown read only when it comes from data', () => {
    const text = ALERT.replace('"Delete the draft?"', 'prompt').replace('@State private var confirming = false', '@State private var confirming = false\n    @State private var prompt = "Delete the draft?"')
    const title = model(text).nodes.find(node => node.name === 'Text' && writtenAs(text, node) === 'prompt')!
    expect(title.controls).toEqual([expect.objectContaining({ id: 'content:data', value: 'prompt', disabledReason: 'This text comes from data. Change it in Code.' })])
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds the titles Design writes', () => {
      typecheckInXcode([edit(ALERT, '"Delete the draft?"', 'content', 'Discard "the" draft?'), edit(DIALOG, '"Archive the list?"', 'content', 'Archive it all?'), LEGACY_APP])
    }, 120_000)
  })
})
