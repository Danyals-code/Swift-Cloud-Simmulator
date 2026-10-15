import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import type { DesignEditRequest, SourceFile } from '@studio/shared'
import { reconcileLayerLabel } from './layerLabels'

const files = (body: string): SourceFile[] => [{ id: 'App.swift', text: `import SwiftUI\nstruct ContentView: View {\n    var body: some View {\n${body}\n    }\n}\n` }]

/**
 * The layer each `Text` of `body` is after `operation` on the layer called `on`, by the order of
 * the Texts after it: where a name the designer gave it goes, or null where it is let go.
 */
function followed(body: string, on: string, operation: DesignEditRequest['operation']): (number | null)[] {
  const before = files(body), model = buildAuthoringModel({ projectId: 'p', revision: 1, files: before })
  const target = model.nodes.find(node => node.name === on)!
  const plan = planDesignEdit({ projectId: 'p', baseRevision: 1, files: before, scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation })
  if (!plan.ok) throw new Error(plan.reason)
  const after = before.map(file => ({ ...file, text: plan.changes.find(change => change.file === file.id)?.after ?? file.text }))
  const texts = plan.authoring!.nodes.filter(node => node.name === 'Text')
  return model.nodes.filter(node => node.name === 'Text').map(text => {
    const moved = reconcileLayerLabel(text, model, plan.authoring!, before, after, operation, target.source, plan.selection?.offset)
    return moved ? texts.indexOf(moved) : null
  })
}

describe('a layer’s name, after the change that moved it', () => {
  it('stays on each view Unwrap puts in its container’s place, and on the views beside it (Wave 4c)', () => {
    const body = '        VStack {\n            List {\n                Text("Row")\n                Text("Row")\n            }\n            Text("End")\n        }'
    expect(followed(body, 'List', { kind: 'layer-unwrap' })).toEqual([0, 1, 2])
  })
})
