import { describe, expect, it } from 'vitest'
import type { RenderNode } from '@studio/shared'
import { matchedMorphs, rollsUp, textChange } from './motion'

// Native: docs/parity/native/iphone18pro-motion/measurements.json, `numericText` and
// `matchedGeometry`.
describe('what a number rolls', () => {
  it('rolls the characters between what stays at the start and at the end', () => {
    expect(textChange('9', '10')).toEqual({ prefix: 0, suffix: 0 })
    expect(textChange('Score: 9', 'Score: 10')).toEqual({ prefix: 7, suffix: 0 })
    expect(textChange('120', '121')).toEqual({ prefix: 2, suffix: 0 })
    expect(textChange('$1.50', '$2.50')).toEqual({ prefix: 1, suffix: 3 })
    expect(textChange('11', '111')).toEqual({ prefix: 2, suffix: 0 })
  })

  it('rolls up unless it counts down, or its value went down', () => {
    expect(rollsUp({ kind: 'numeric' }, undefined)).toBe(true)
    expect(rollsUp({ kind: 'numeric' }, { kind: 'numeric' })).toBe(true)
    expect(rollsUp({ kind: 'numeric', countsDown: true }, undefined)).toBe(false)
    expect(rollsUp({ kind: 'numeric', value: 9 }, { kind: 'numeric', value: 10 })).toBe(false)
    expect(rollsUp({ kind: 'numeric', value: 10 }, { kind: 'numeric', value: 9 })).toBe(true)
  })
})

const card = (key: string, x: number, y: number, side: number, extra: Partial<RenderNode> = {}): RenderNode => ({
  id: key, key, kind: 'shape', frame: { x, y, width: side, height: side }, z: 1, opacity: 1, matched: { id: 'hero:card' }, ...extra,
})

describe('matched geometry', () => {
  it('moves the view that comes in from where the one that went was, and that one to where it goes', () => {
    const big = card('big', 51, 192.33, 300), small = card('small', 298, 592.33, 80)
    const morphs = matchedMorphs([big], [small])
    expect(morphs.from.get('small')).toEqual({ x: 51, y: 192.33, width: 300, height: 300 })
    expect(morphs.to.get('big')).toEqual({ x: 298, y: 592.33, width: 80, height: 80 })
    expect(matchedMorphs([big], [big, small]).from.size).toBe(1)
    expect(matchedMorphs([big], [card('big', 0, 0, 10)]).from.size).toBe(0)
  })

  it('measures where they are on the screen, whatever they are inside', () => {
    const scroller: RenderNode = { id: 'list', kind: 'layer', frame: { x: 0, y: 100, width: 402, height: 600 }, z: 0, opacity: 1 }
    const small = card('small', 298, 492.33, 80, { parent: 'list' })
    expect(matchedMorphs([card('big', 51, 192.33, 300)], [scroller, small]).from.get('small')).toEqual({ x: 51, y: 92.33, width: 300, height: 300 })
  })

  it('moves only the position or the size where the effect says, and takes nothing from a view that is not a source', () => {
    const big = card('big', 51, 192.33, 300)
    const position = card('small', 298, 592.33, 80, { matched: { id: 'hero:card', properties: 'position' } })
    expect(matchedMorphs([big], [position]).from.get('small')).toEqual({ x: 161, y: 302.33, width: 80, height: 80 })
    const size = card('small', 298, 592.33, 80, { matched: { id: 'hero:card', properties: 'size' } })
    expect(matchedMorphs([big], [size]).from.get('small')).toEqual({ x: 298, y: 592.33, width: 300, height: 300 })
    const borrowed = card('big', 51, 192.33, 300, { matched: { id: 'hero:card', isSource: false } })
    expect(matchedMorphs([borrowed], [card('small', 298, 592.33, 80)]).from.size).toBe(0)
  })
})
