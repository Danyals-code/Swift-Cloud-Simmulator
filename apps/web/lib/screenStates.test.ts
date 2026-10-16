import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import type { PreviewInput, PreviewScenario, StateInput } from '@studio/shared'
import { stateShowing } from './screenStates'

const span = { file: 'App.swift', start: 0, end: 1 }
const details = (value: boolean): PreviewInput => ({ owner: 'ContentView', name: 'showDetails', signature: 's', value })
const items = (value: string): PreviewInput => ({ owner: 'ContentView', name: 'items', signature: 'i', value })
const inputs: readonly StateInput[] = [
  { owner: 'ContentView', name: 'showDetails', signature: 's', type: 'Bool', value: false, source: span, kind: 'flag', states: [{ name: 'Show details', inputs: [details(true)] }] },
  { owner: 'ContentView', name: 'items', signature: 'i', type: '[String]', value: 'items', source: span, kind: 'list', states: [{ name: 'Empty', inputs: [items('empty')] }] },
]
const state = (name: string, values: readonly PreviewInput[]): PreviewScenario => ({ name, owner: 'ContentView', hook: '', inputs: values })

describe('the state Show it switches to (Wave 5a)', () => {
  it('picks a saved state that sets every value that shows the view, never the one showing now', () => {
    const open = state('Open', [details(true)]), both = state('Open and empty', [items('empty'), details(true)])
    expect(stateShowing({ shows: [details(true)] }, [state('Closed', [details(false)]), open, both], open, inputs)).toEqual({ select: both })
    expect(stateShowing({ shows: [details(true), items('empty')] }, [open, both], undefined, inputs)).toEqual({ select: both })
  })

  it('goes back to Default when the screen starts with the view showing and a state hides it', () => {
    const empty = state('Empty', [items('empty')])
    expect(stateShowing({ shows: [items('items')] }, [empty], empty, inputs)).toEqual({ select: null })
  })

  it('saves the suggested state that shows it, under its name', () => {
    expect(stateShowing({ shows: [details(true)], label: 'Details is on' }, [], undefined, inputs)).toEqual({ save: { name: 'Show details', inputs: [details(true)] } })
  })

  it('names a state no suggestion has by when the view shows, numbered past a saved state of that name', () => {
    const shows = [details(true), items('empty')]
    expect(stateShowing({ shows, label: 'Details is on' }, [], undefined, inputs)).toEqual({ save: { name: 'Details is on', inputs: shows } })
    expect(stateShowing({ shows, label: 'Details is on' }, [state('Details is on', [details(false)])], undefined, inputs)).toEqual({ save: { name: 'Details is on 2', inputs: shows } })
  })

  it('saves the state the screen’s code suggests for a view its if hides, as the authoring model reads them', () => {
    const text = 'import SwiftUI\nstruct ContentView: View {\n    @State private var showDetails = false\n    var body: some View {\n        VStack {\n            if showDetails {\n                Text("Details")\n            }\n        }\n    }\n}\n'
    const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files: [{ id: 'App.swift', text }] })
    const shown = snapshot.nodes.find(node => node.name === 'Text')!
    expect(shown.visibility?.hiddenWhile).toMatch(/ is off$/)
    expect(stateShowing(shown.visibility!, [], undefined, snapshot.inputs ?? [])).toEqual({ save: { name: 'Show details', inputs: [{ owner: 'ContentView', name: 'showDetails', signature: expect.any(String), value: true }] } })
  })

  it('says why when the preview cannot set what shows the view', () => {
    expect(stateShowing({}, [], undefined, inputs)).toEqual({ problem: 'The preview can’t set what shows this view. Open it in Code to see its condition.' })
  })
})
