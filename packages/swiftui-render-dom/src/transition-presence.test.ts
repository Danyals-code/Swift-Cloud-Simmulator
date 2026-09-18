import { describe, expect, it } from 'vitest'
import type { RenderNode } from '@studio/shared'
import { finishExit, reconcilePresence, type RenderGroups } from './transition-presence'

const node = (id: string, duration = 0.25): RenderNode => ({ id, kind: 'layer', frame: { x: 8, y: 12, width: 80, height: 24 }, z: 0, opacity: 1, transition: { kind: 'opacity', duration } })
const groups: RenderGroups = new Map()

describe('transition presence and interruption', () => {
  it('retains the removed node and its original subtree until completion', () => {
    const child = { ...node('child'), parent: 'row' }, snapshot = new Map([['row', [child]]])
    const present = reconcilePresence([], [node('row')], snapshot, true)
    const removed = reconcilePresence(present, [], groups, true)
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatchObject({ exiting: true, node: { frame: { x: 8, y: 12 } } })
    expect(removed[0]!.groups.get('row')).toEqual([child])
    expect(finishExit(removed, 'row', removed[0]!.exitToken!)).toEqual([])
  })
  it('cancels a removal on reentry without duplicate nodes or stale completion', () => {
    const original = reconcilePresence([], [node('row')], groups, true)
    const firstExit = reconcilePresence(original, [], groups, true)
    const firstToken = firstExit[0]!.exitToken!
    const reentry = reconcilePresence(firstExit, [node('row')], groups, true)
    expect(reentry).toHaveLength(1)
    expect(finishExit(reentry, 'row', firstToken)).toEqual(reentry)
    const secondExit = reconcilePresence(reentry, [], groups, true)
    expect(secondExit[0]!.exitToken).not.toBe(firstToken)
    expect(finishExit(secondExit, 'row', firstToken)).toEqual(secondExit)
    expect(finishExit(secondExit, 'row', secondExit[0]!.exitToken!)).toEqual([])
  })
  it('does not restart an exit when unrelated content changes', () => {
    const old = reconcilePresence([], [node('old')], groups, true)
    const first = reconcilePresence(old, [node('new')], groups, true)
    const token = first.find(entry => entry.node.id === 'old')!.exitToken
    const next = reconcilePresence(first, [node('new'), node('other')], groups, true)
    expect(next.find(entry => entry.node.id === 'old')!.exitToken).toBe(token)
  })
  it('removes immediately for reduced motion, design mode or a stale preview', () => {
    const before = reconcilePresence([], [node('row')], groups, true)
    const exiting = reconcilePresence(before, [], groups, true)
    expect(reconcilePresence(exiting, [], groups, false)).toEqual([])
    expect(reconcilePresence([], [node('other')], groups, false).map(entry => entry.node.id)).toEqual(['other'])
  })
  it('bounds retained roots, subtree size and unsupported durations', () => {
    const many = reconcilePresence([], Array.from({ length: 100 }, (_, i) => node(String(i))), groups, true)
    expect(reconcilePresence(many, [], groups, true)).toHaveLength(64)
    const huge = new Map([['row', Array.from({ length: 256 }, (_, i) => ({ ...node(String(i)), parent: 'row' }))]])
    expect(reconcilePresence(reconcilePresence([], [node('row')], huge, true), [], groups, true)).toEqual([])
    for (const duration of [0, -1, 3, Infinity]) expect(reconcilePresence(reconcilePresence([], [node('row', duration)], groups, true), [], groups, true)).toEqual([])
  })
})
