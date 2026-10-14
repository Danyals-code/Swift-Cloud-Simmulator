import { describe, expect, it } from 'vitest'
import type { AuthoringNode, CompileRequest, LayerDraft } from '@studio/shared'
import { TEMPLATES } from '@studio/project-model/templates'
import { beginLayerDraft, compile, endLayerDraft, resetPipelineState, setMeasureTarget, updateLayerDraft } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * A drag on the canvas follows the pointer (Wave 2b): each frame of it lays the page out
 * again with the dragged values, and nothing else. On the Task list template, a row's
 * title is dragged in each of its four rows at once, as the canvas drags a row design.
 * Timed in the performance project, with nothing running beside it; this Mac may be in
 * Low Power Mode, which the limits allow for.
 */

const device = DEVICES['iphone-15']
const template = TEMPLATES.find(t => t.name === 'Task list')!

function request(revision: number): CompileRequest {
  return {
    files: template.files.map(file => ({ id: file.id, text: file.text })),
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision,
  }
}

/** The row's title, as the canvas selects it. */
function rowTitle(): AuthoringNode {
  resetPipelineState()
  setMeasureTarget(null)
  const node = compile(request(1)).authoring!.nodes.find(n => n.name === 'Text' && n.layer && n.runtimeIds.length === 4)
  if (!node) throw new Error('No row title')
  return node
}

const median = (times: readonly number[]) => [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]!

describe('a drag on a template', () => {
  it('lays each frame out in under 8 ms', () => {
    const target = rowTitle()
    setMeasureTarget(target.source)
    for (let i = 0; i < 3; i++) compile(request(1))
    beginLayerDraft(target.source, 1)
    const frames: LayerDraft[] = Array.from({ length: 40 }, (_, at) => at % 2 ? { padding: { top: at, leading: at, bottom: at, trailing: at } } : { width: 120 + at * 2 })
    const times = frames.map(values => {
      const started = performance.now()
      const result = updateLayerDraft(values, 1)
      const took = performance.now() - started
      expect(result.geometry?.instances).toHaveLength(4)
      return took
    })
    endLayerDraft(1)
    expect(median(times)).toBeLessThan(8)
  })

  it('adds under a millisecond to a compile when a view is selected', () => {
    const target = rowTitle()
    const timed = (selected: boolean) => {
      setMeasureTarget(selected ? target.source : null)
      const started = performance.now()
      compile(request(1))
      return performance.now() - started
    }
    for (let i = 0; i < 3; i++) { timed(true); timed(false) }
    // In pairs, one with and one without, so anything else slowing the machine slows both.
    const added = Array.from({ length: 31 }, (_, at) => at % 2 ? timed(true) - timed(false) : -(timed(false) - timed(true)))
    expect(median(added)).toBeLessThan(1)
  })
})
