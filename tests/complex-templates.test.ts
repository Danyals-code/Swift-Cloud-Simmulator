import { beforeEach, describe, expect, it } from 'vitest'
import type { RenderTree } from '@studio/shared'
import { templateById } from '@studio/project-model/templates'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'
let revision = 1
function open(id: string) {
  const d = DEVICES['iphone-15']
  const result = compile({ files: [...templateById(id)!.files], canvas: { width: d.width, height: d.height }, safeArea: d.safeArea, colorScheme: 'light', revision: revision++ })
  expect(result.diagnostics).toEqual([])
  return result.renderTree!
}
const text = (tree: RenderTree) => tree.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []).join(' ')
function control(tree: RenderTree, label: string) {
  const node = tree.nodes.find(n => n.hitTarget && n.a11y?.label?.includes(label))
  expect(node, `Missing ${label}; controls: ${tree.nodes.filter(n=>n.hitTarget).map(n=>n.a11y?.label).join(', ')}`).toBeDefined()
  return node!.hitTarget!
}
function tap(tree: RenderTree, label: string) {
  applyEvent({ kind: 'tap', handlerId: control(tree, label).handlerId, location: { x: 0, y: 0 } })
  const result = rerender(revision++)
  expect(result.diagnostics.filter(d=>d.severity === 'error')).toEqual([])
  return result.renderTree!
}
function input(tree: RenderTree, name: string, value: string) {
  const hit = tree.nodes.find(n => n.hitTarget?.role === 'textField' && n.hitTarget.placeholder === name)!.hitTarget!
  applyEvent({ kind: 'textChange', handlerId: hit.handlerId, value })
  return rerender(revision++).renderTree!
}
beforeEach(() => resetPipelineState())
describe('Dispatch', () => {
  it('completes a task and records the change across tabs', () => {
    let tree = open('dispatch')
    expect(text(tree)).not.toContain('Mark complete')
    tree = tap(tree, 'Sketch the welcome flow')
    tree = tap(tree, 'Mark complete')
    expect(text(tree)).toContain('Completed')
    tree = tap(tree, 'Activity')
    expect(text(tree)).toContain('Completed: Sketch the welcome flow')
    tree = tap(tree, 'Projects')
    expect(text(tree)).toContain('Sketch the welcome flow')
  })
  it('validates, creates, and searches a task', () => {
    let tree = tap(open('dispatch'), 'New task')
    expect(control(tree, 'Create').enabled).toBe(false)
    tree = input(tree, 'Task title', 'Test keyboard navigation')
    tree = tap(tree, 'Create')
    tree = tap(tree, 'Projects')
    tree = input(tree, 'Search tasks', 'keyboard')
    expect(text(tree)).toContain('Test keyboard navigation')
    expect(text(tree)).not.toContain('Sketch the welcome flow')
  })
})
describe('Market', () => {
  it('adds a product, adjusts quantity, checks out, and keeps order history', () => {
    let tree = open('market')
    expect(text(tree)).not.toContain('Add to bag')
    expect(text(tree)).not.toContain('Quantity:')
    tree = tap(tree, 'Everyday tote')
    expect(text(tree)).toContain('Add to bag')
    tree = tap(tree, 'Add to bag')
    tree = tap(tree, 'Bag')
    expect(text(tree)).toContain('$38')
    tree = tap(tree, 'Add one Everyday tote')
    expect(text(tree)).toContain('$76')
    tree = tap(tree, 'Continue to checkout')
    expect(control(tree, 'Place demo order').enabled).toBe(false)
    tree = input(tree, 'Your name', 'Taylor')
    tree = tap(tree, 'Place demo order')
    expect(text(tree)).toContain('Order placed')
    tree = tap(tree, 'Done')
    expect(text(tree)).toContain('Your bag is empty')
    tree = tap(tree, 'Orders')
    // A title written as a literal puts separators in a number on iOS, and so does the preview.
    expect(text(tree)).toContain('Order 1,001')
    tree = tap(tree, 'Order 1,001')
    expect(text(tree)).toContain('Taylor')
    expect(text(tree)).toContain('$76')
  })
  it('removes the last bag item and recovers its empty state', () => {
    let tree = tap(open('market'), 'Everyday tote')
    tree = tap(tree, 'Add to bag')
    tree = tap(tree, 'Bag')
    tree = tap(tree, 'Remove one Everyday tote')
    expect(text(tree)).toContain('Your bag is empty')
  })
})
