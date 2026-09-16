import { beforeEach, describe, expect, it } from 'vitest'
import type { RenderTree } from '@studio/shared'
import { FOLIO_FILES } from '@studio/project-model/templates'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

let revision = 1
const device = DEVICES['iphone-18-pro']
function open() {
  const result = compile({ files: [...FOLIO_FILES], canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: revision++ })
  expect(result.diagnostics).toEqual([])
  return result.renderTree!
}
function texts(tree: RenderTree) { return tree.nodes.flatMap((n) => n.text?.runs.map((r) => r.text) ?? []).join(' ') }
function target(tree: RenderTree, label: string) {
  const node = tree.nodes.find((n) => n.hitTarget && n.a11y?.label === label)
  expect(node, `Missing ${label}; controls: ${tree.nodes.filter((n) => n.hitTarget).map((n) => n.a11y?.label).join(', ')}`).toBeDefined()
  return node!
}
function tap(tree: RenderTree, label: string) {
  applyEvent({ kind: 'tap', handlerId: target(tree, label).hitTarget!.handlerId, location: { x: 0, y: 0 } })
  return rerender(revision++).renderTree!
}
function input(tree: RenderTree, placeholder: string, value: string) {
  const field = tree.nodes.find((n) => n.hitTarget?.role === 'textField' && n.hitTarget.placeholder === placeholder)
  expect(field).toBeDefined()
  applyEvent({ kind: 'textChange', handlerId: field!.hitTarget!.handlerId, value })
  return rerender(revision++).renderTree!
}
beforeEach(() => resetPipelineState())
describe('Folio screen flows', () => {
  it('saves a book in its details and removes it from the reading list', () => {
    let tree = open()
    tree = tap(tree, 'The Secret Garden, Frances Hodgson Burnett')
    expect(texts(tree)).toContain('A locked garden')
    tree = tap(tree, 'Save to reading list')
    tree = tap(tree, 'Reading list')
    expect(texts(tree)).toContain('The Secret Garden')
    expect(texts(tree)).not.toContain('The Time Machine')
    tree = tap(tree, 'The Secret Garden, Frances Hodgson Burnett')
    tree = tap(tree, 'Remove from reading list')
    expect(texts(tree)).toContain('Make room for a good book')
  })
  it('validates the add form, adds a book, and finds it through search', () => {
    let tree = tap(open(), 'Add book')
    expect(target(tree, 'Add').hitTarget!.enabled).toBe(false)
    tree = input(tree, 'Title', 'A new chapter')
    tree = input(tree, 'Author', 'Taylor')
    expect(target(tree, 'Add').hitTarget!.enabled).toBe(true)
    tree = tap(tree, 'Add')
    expect(tree.nodes.some((n) => n.id === 'overlay-surface')).toBe(false)
    tree = input(tree, 'Title or author', 'new chapter')
    expect(texts(tree)).toContain('A new chapter')
    expect(texts(tree)).not.toContain('The Secret Garden')
  })
  it('shows a helpful empty search and dismisses an unfinished book', () => {
    let tree = input(open(), 'Title or author', 'no such book')
    expect(texts(tree)).toContain('No matching books')
    tree = tap(tree, 'Add book')
    tree = input(tree, 'Title', 'Unfinished')
    tree = tap(tree, 'Cancel')
    tree = input(tree, 'Title or author', '')
    expect(texts(tree)).not.toContain('Unfinished')
    tree = tap(tree, 'Settings')
    expect(texts(tree)).toContain('20 minutes a day')
  })
})
