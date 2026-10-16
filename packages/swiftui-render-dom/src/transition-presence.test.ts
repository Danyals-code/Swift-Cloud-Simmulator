import { describe, expect, it } from 'vitest'
import type { AnimationSpec, RenderNode, TransitionSpec, TreeAnimation } from '@studio/shared'
import { finishExit, reconcilePresence, transitionParts, type RenderGroups } from './transition-presence'

const LINEAR: AnimationSpec = { curve: 'linear', duration: 0.25 }
const ANIMATED: TreeAnimation = { all: LINEAR }
const node = (id: string): RenderNode => ({ id, kind: 'layer', frame: { x: 8, y: 12, width: 80, height: 24 }, z: 0, opacity: 1, transition: { kind: 'opacity' } })
const plain = (id: string, extra: Partial<RenderNode> = {}): RenderNode => ({ id, kind: 'layer', frame: { x: 0, y: 0, width: 10, height: 10 }, z: 0, opacity: 1, ...extra })
const groups: RenderGroups = new Map()

describe('transition presence and interruption', () => {
  it('retains the removed node and its original subtree until completion', () => {
    const child = { ...node('child'), parent: 'row' }, snapshot = new Map([['row', [child]]])
    const present = reconcilePresence([], [node('row')], snapshot, true)
    const removed = reconcilePresence(present, [], groups, true, ANIMATED)
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatchObject({ exiting: true, node: { frame: { x: 8, y: 12 } } })
    expect(removed[0]!.groups.get('row')).toEqual([child])
    expect(finishExit(removed, 'row', removed[0]!.exitToken!)).toEqual([])
  })
  it('cancels a removal on reentry without duplicate nodes or stale completion', () => {
    const original = reconcilePresence([], [node('row')], groups, true)
    const firstExit = reconcilePresence(original, [], groups, true, ANIMATED)
    const firstToken = firstExit[0]!.exitToken!
    const reentry = reconcilePresence(firstExit, [node('row')], groups, true, ANIMATED)
    expect(reentry).toHaveLength(1)
    expect(finishExit(reentry, 'row', firstToken)).toEqual(reentry)
    const secondExit = reconcilePresence(reentry, [], groups, true, ANIMATED)
    expect(secondExit[0]!.exitToken).not.toBe(firstToken)
    expect(finishExit(secondExit, 'row', firstToken)).toEqual(secondExit)
    expect(finishExit(secondExit, 'row', secondExit[0]!.exitToken!)).toEqual([])
  })
  it('does not restart an exit when unrelated content changes', () => {
    const old = reconcilePresence([], [node('old')], groups, true)
    const first = reconcilePresence(old, [node('new')], groups, true, ANIMATED)
    const token = first.find(entry => entry.node.id === 'old')!.exitToken
    const next = reconcilePresence(first, [node('new'), node('other')], groups, true)
    expect(next.find(entry => entry.node.id === 'old')!.exitToken).toBe(token)
  })
  it('removes immediately for reduced motion, design mode or a stale preview', () => {
    const before = reconcilePresence([], [node('row')], groups, true)
    const exiting = reconcilePresence(before, [], groups, true, ANIMATED)
    expect(reconcilePresence(exiting, [], groups, false)).toEqual([])
    expect(reconcilePresence([], [node('other')], groups, false).map(entry => entry.node.id)).toEqual(['other'])
  })
  it('bounds retained roots, subtree size and unsupported durations', () => {
    const many = reconcilePresence([], Array.from({ length: 100 }, (_, i) => node(String(i))), groups, true)
    expect(reconcilePresence(many, [], groups, true, ANIMATED)).toHaveLength(64)
    const huge = new Map([['row', Array.from({ length: 256 }, (_, i) => ({ ...node(String(i)), parent: 'row' }))]])
    expect(reconcilePresence(reconcilePresence([], [node('row')], huge, true), [], groups, true, ANIMATED)).toEqual([])
    for (const duration of [0, -1, 11, Infinity]) expect(reconcilePresence(reconcilePresence([], [node('row')], groups, true), [], groups, true, { all: { curve: 'linear', duration } })).toEqual([])
  })
})

// Native: docs/parity/native/iphone18pro-motion/measurements.json, `unanimated`, `defaultFade`
// and `valueOnlyChild`.
describe('presence plays only when the change is animated', () => {
  it('plays an entry only in the frame that inserts it animated, and keeps it while it stays', () => {
    const present = reconcilePresence([], [plain('row')], groups, true)
    const unanimated = reconcilePresence(present, [plain('row'), plain('new', { transition: { kind: 'scale' } })], groups, true)
    expect(unanimated.find(entry => entry.node.id === 'new')!.entry).toBeUndefined()
    const animated = reconcilePresence(present, [plain('row', { animation: LINEAR }), plain('new', { animation: LINEAR })], groups, true, ANIMATED)
    expect(animated.find(entry => entry.node.id === 'row')!.entry).toBeUndefined()
    const entry = animated.find(entry => entry.node.id === 'new')!.entry
    expect(entry).toEqual({ parts: ['opacity'], animation: LINEAR })
    const later = reconcilePresence(animated, [plain('row'), plain('new')], groups, true)
    expect(later.find(entry => entry.node.id === 'new')!.entry).toBe(entry)
  })

  it('plays an exit only for withAnimation or the .animation(_:value:) around the view', () => {
    const present = reconcilePresence([], [plain('v-0-1'), plain('v-0-10', { transition: { kind: 'move', edge: 'top' } })], groups, true)
    expect(reconcilePresence(present, [], groups, true)).toEqual([])
    const fades = reconcilePresence(present, [], groups, true, { all: LINEAR })
    expect(fades.map(entry => [entry.node.id, entry.exit?.parts])).toEqual([['v-0-1', ['opacity']], ['v-0-10', ['move-top']]])
    const spring: AnimationSpec = { curve: 'spring', duration: 0.5, bounce: 0 }
    const scoped = reconcilePresence(present, [], groups, true, { under: [{ key: 'v-0-1', animation: spring }] })
    expect(scoped.map(entry => [entry.node.id, entry.exit?.animation])).toEqual([['v-0-1', spring]])
  })

  it('plays nothing in or out for .identity, as iOS does, and only the side that has a transition of an asymmetric one', () => {
    const still: TransitionSpec = { kind: 'identity' }
    const present = reconcilePresence([], [plain('row')], groups, true)
    const inserted = reconcilePresence(present, [plain('row', { animation: LINEAR }), plain('still', { animation: LINEAR, transition: still }), plain('in', { animation: LINEAR, transition: { kind: 'scale', removal: still } })], groups, true, ANIMATED)
    expect(inserted.map(entry => [entry.node.id, entry.entry?.parts])).toEqual([['row', undefined], ['still', undefined], ['in', ['scale']]])
    expect(reconcilePresence(inserted, [plain('row')], groups, true, ANIMATED).map(entry => entry.node.id)).toEqual(['row'])
  })

  it('follows a view by its key when its id moves', () => {
    const present = reconcilePresence([], [plain('v-0-1', { key: 'v-0-0' })], groups, true)
    const moved = reconcilePresence(present, [plain('v-0-2', { key: 'v-0-0', animation: LINEAR })], groups, true, ANIMATED)
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ exiting: false, node: { id: 'v-0-2' } })
    expect(moved[0]!.entry).toBeUndefined()
  })
})

describe('transition parts', () => {
  it('plays each of Apple\'s transitions as the simulator does', () => {
    const both = (transition: TransitionSpec | undefined) => [transitionParts(transition, 'in'), transitionParts(transition, 'out')]
    expect(both(undefined)).toEqual([['opacity'], ['opacity']])
    expect(both({ kind: 'move', edge: 'top' })).toEqual([['move-top'], ['move-top']])
    expect(both({ kind: 'push', edge: 'trailing' })).toEqual([['move-trailing', 'opacity'], ['move-leading', 'opacity']])
    expect(both({ kind: 'slide' })).toEqual([['move-leading'], ['move-trailing']])
    expect(both({ kind: 'scale' })).toEqual([['scale'], ['scale']])
    expect(both({ kind: 'blur' })).toEqual([['blur', 'opacity'], ['blur', 'opacity']])
    expect(both({ kind: 'move', edge: 'top', also: [{ kind: 'opacity' }] })).toEqual([['move-top', 'opacity'], ['move-top', 'opacity']])
    expect(both({ kind: 'scale', removal: { kind: 'opacity' } })).toEqual([['scale'], ['opacity']])
    expect(both({ kind: 'push', edge: 'top', also: [{ kind: 'opacity' }] })).toEqual([['move-top', 'opacity'], ['move-bottom', 'opacity']])
  })
})
