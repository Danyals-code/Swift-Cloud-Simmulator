import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import { modifierDropIndex, reconcileModifierRows } from './modifierRows'

function modifiers(chain: string) {
  return buildAuthoringModel({ projectId: 'rows', revision: 1, files: [{ id: 'Main.swift', text: `import SwiftUI\nstruct Main: View { var body: some View { Text("Hello")${chain} } }` }] }).nodes.find(node => node.name === 'Text')!.modifiers!
}
const initial = (chain: string) => reconcileModifierRows({ rows: [], nextKey: 0 }, modifiers(chain))

describe('modifier UI identity', () => {
  it('keeps controls mounted when offsets and modifier order change', () => {
    const first = initial('.padding(8).background(Color.blue).cornerRadius(12)')
    const next = reconcileModifierRows(first, modifiers('.background(Color.blue).cornerRadius(12).padding(8)'))
    expect(next.rows.map(row => row.key)).toEqual([1, 2, 0])
    expect(next.rows[2]!.modifier.id).not.toBe(first.rows[0]!.modifier.id)
  })
  it('follows the intended occurrence when identical modifiers are reordered', () => {
    const first = initial('.padding(8).background(Color.blue).padding(8)')
    const expected = { ...first, rows: [first.rows[0]!, first.rows[2]!, first.rows[1]!] }
    const next = reconcileModifierRows(expected, modifiers('.padding(8).padding(8).background(Color.blue)'))
    expect(next.rows.map(row => row.key)).toEqual([0, 2, 1])
  })
  it('does not give an edited occurrence the identity of an unchanged duplicate', () => {
    const first = initial('.padding(8).padding(8)')
    const next = reconcileModifierRows(first, modifiers('.padding(24).padding(8)'))
    expect(next.rows.map(row => row.key)).toEqual([0, 1])
    const different = initial('.padding(8).padding(16)')
    expect(reconcileModifierRows(different, modifiers('.padding(24).padding(16)')).rows.map(row => row.key)).toEqual([0, 1])
  })
  it('allocates fresh keys after remove, duplicate, add and undo', () => {
    const first = initial('.padding(8).background(Color.blue)')
    const duplicated = reconcileModifierRows(first, modifiers('.padding(8).padding(8).background(Color.blue)'))
    expect(duplicated.rows.map(row => row.key)).toEqual([0, 2, 1])
    const removed = reconcileModifierRows(duplicated, modifiers('.background(Color.blue)'))
    const restored = reconcileModifierRows(removed, modifiers('.padding(8).background(Color.blue)'))
    expect(restored.rows.map(row => row.key)).toEqual([3, 1])
  })
  it('uses both halves of a card, including the last card, as drop targets', () => {
    expect(modifierDropIndex(100, 44, 110, 2)).toBe(2)
    expect(modifierDropIndex(100, 44, 132, 2)).toBe(3)
    expect(modifierDropIndex(100, 300, 360, 2)).toBe(3)
  })
})
