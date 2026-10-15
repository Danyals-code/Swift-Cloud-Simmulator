import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import { alertAction, alertDraft } from './alertActions'

describe('Show alert and Show options from When tapped (Wave 4a)', () => {
  it('asks "Delete the draft?" with a destructive Delete and a Cancel', () => {
    expect(alertAction('alert', { title: ' Delete the draft? ', message: 'This can\'t be undone.', buttons: [{ title: 'Delete', role: 'destructive' }, { title: 'Cancel', role: 'cancel' }] }))
      .toEqual({ action: { type: 'alert', title: 'Delete the draft?', message: 'This can\'t be undone.', actions: [{ title: 'Delete', role: 'destructive' }, { title: 'Cancel', role: 'cancel' }] } })
  })

  it('leaves a blank message out, and a button with no role has none', () => {
    expect(alertAction('dialog', { title: 'Share the photo', message: '  ', buttons: [{ title: ' Messages ' }, { title: 'Mail' }] }))
      .toEqual({ action: { type: 'dialog', title: 'Share the photo', actions: [{ title: 'Messages' }, { title: 'Mail' }] } })
  })

  it('says what is missing rather than writing an alert iOS would draw empty', () => {
    const buttons = [{ title: 'OK' }]
    expect(alertAction('alert', { title: ' ', message: '', buttons })).toEqual({ problem: 'Give the alert a title.' })
    expect(alertAction('dialog', { title: '', message: '', buttons })).toEqual({ problem: 'Give the options a title.' })
    expect(alertAction('alert', { title: 'Sure?', message: '', buttons: [{ title: 'Delete', role: 'destructive' }, { title: ' ' }] })).toEqual({ problem: 'Give each button a title.' })
    expect(alertAction('alert', { title: 'Sure?', message: '', buttons: [{ title: 'Cancel', role: 'cancel' }, { title: 'Not now', role: 'cancel' }] })).toEqual({ problem: 'Only one button can be Cancel.' })
  })

  it('may have no buttons, as iOS then shows OK', () => {
    expect(alertAction('alert', { title: 'Saved', message: '', buttons: [] })).toEqual({ action: { type: 'alert', title: 'Saved', actions: [] } })
  })

  it('starts from the alert a button already shows, so Save with Replace rewrites it', () => {
    expect(alertDraft({ type: 'alert', title: 'Sign out?', actions: [{ title: 'Sign out', role: 'destructive' }] }))
      .toEqual({ title: 'Sign out?', message: '', buttons: [{ title: 'Sign out', role: 'destructive' }] })
    expect(alertDraft(undefined)).toEqual({ title: 'Are you sure?', message: '', buttons: [{ title: 'Delete', role: 'destructive' }, { title: 'Cancel', role: 'cancel' }] })
  })

  it('shows an alert it cannot write back exactly read only, with why, and never saves over it', () => {
    // Saved as read, `Text("Delete it?")` would become the words `Text("Delete it?")` and its field would go.
    const readOnly = 'This alert has a text field. Change it in Code.'
    const draft = alertDraft({ type: 'alert', title: 'Delete it?', actions: [{ title: 'Delete', role: 'destructive' }], readOnly })
    expect(draft).toEqual({ title: 'Delete it?', message: '', buttons: [{ title: 'Delete', role: 'destructive' }], readOnly })
    expect(alertAction('alert', draft)).toEqual({ problem: readOnly })
    expect(alertAction('dialog', draft)).toEqual({ problem: readOnly })
  })

  it('keeps a button’s alert with a text field read only, as the model reads it, so Save never drops the field', () => {
    const text = `import SwiftUI
struct ContentView: View {
    @State private var isShowingAlert = false
    @State private var name = ""
    var body: some View {
        Button("Rename") { isShowingAlert = true }
            .alert("Name it", isPresented: $isShowingAlert) {
                TextField("Name", text: $name)
                Button("Save") { }
            }
    }
}`
    const button = buildAuthoringModel({ projectId: 'p', revision: 1, files: [{ id: 'App.swift', text }] }).nodes.find(node => node.name === 'Button' && node.behavior?.shows)!
    const draft = alertDraft(button.behavior!.shows)
    expect(draft).toMatchObject({ title: 'Name it', readOnly: expect.stringMatching(/Change it in Code\.$/) })
    expect(alertAction('alert', draft)).toEqual({ problem: draft.readOnly })
  })
})
