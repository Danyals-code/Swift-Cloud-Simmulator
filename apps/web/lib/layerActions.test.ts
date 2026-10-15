import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import type { AuthoringNode, DesignEditRequest, SourceFile } from '@studio/shared'
import { containerActions } from './layerActions'

const files = (body: string): SourceFile[] => [{ id: 'App.swift', text: `import SwiftUI\nstruct ContentView: View {\n    var body: some View {\n${body}\n    }\n}\n` }]
const read = (body: string) => buildAuthoringModel({ projectId: 'p', revision: 1, files: files(body) }).nodes
/** The view of `nodes` written first as `name`. */
const named = (nodes: readonly AuthoringNode[], name: string) => nodes.find(node => node.kind === 'view' && node.name === name)!
/** Why the planner refuses `operation` on `target`, or null when it makes the change. */
function refusal(body: string, target: AuthoringNode, operation: DesignEditRequest['operation']): string | null {
  const plan = planDesignEdit({ projectId: 'p', baseRevision: 1, files: files(body), scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation })
  return plan.ok ? null : plan.reason
}
/** Each of the Layers menu's container actions by its label, with why it is off, or null. */
const reasons = (nodes: readonly AuthoringNode[], node: AuthoringNode, ids = [node.id]) => Object.fromEntries(containerActions(nodes, node, ids).map(action => [action.label, action.reason]))

/**
 * The Layers menu's Group in and Unwrap (Wave 4c): each is off where the planner would refuse
 * it, and says why in the planner's own words, so a designer never chooses one only to be told no.
 */
describe('Group in and Unwrap in the Layers menu', () => {
  it('turns off Group in List and Group in Form inside a scroll view, with the reason the planner refuses them', () => {
    const body = '        ScrollView {\n            VStack {\n                Text("Groceries")\n                Text("Errands")\n            }\n        }'
    const nodes = read(body), text = named(nodes, 'Text')
    const offered = reasons(nodes, text)
    expect(offered['Group in List']).toMatch(/^A List inside a scroll view or a list has no height of its own/)
    expect(offered['Group in List']).toBe(refusal(body, text, { kind: 'layer-wrap', ids: [text.id], layout: 'List' }))
    expect(offered['Group in Form']).toBe(refusal(body, text, { kind: 'layer-wrap', ids: [text.id], layout: 'Form' }))
    expect([offered['Group in Column'], offered['Group in Row'], offered['Group in Overlap'], offered['Group in Scroll']]).toEqual([null, null, null, null])
  })

  it('offers Unwrap on a plain column in a column, which the planner unwraps', () => {
    const body = '        VStack {\n            VStack {\n                Text("Groceries")\n                Text("Errands")\n            }\n        }'
    const nodes = read(body), inner = nodes.filter(node => node.name === 'VStack')[1]!
    expect(reasons(nodes, inner).Unwrap).toBeNull()
    expect(refusal(body, inner, { kind: 'layer-unwrap' })).toBeNull()
  })

  it('turns Unwrap off with the planner’s whole reason where a row’s arguments or its axis would be lost in a column', () => {
    const body = '        VStack(spacing: 24) {\n            HStack(alignment: .top, spacing: 2) {\n                Text("Groceries")\n                Text("Errands")\n            }\n        }'
    const nodes = read(body), row = named(nodes, 'HStack')
    const reason = refusal(body, row, { kind: 'layer-unwrap' })
    expect(reason).not.toBeNull()
    expect(reasons(nodes, row).Unwrap).toBe(reason)
  })
})
