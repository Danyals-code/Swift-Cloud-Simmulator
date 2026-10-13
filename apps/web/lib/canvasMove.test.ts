import { describe, expect, it } from 'vitest'
import { dropSlot, unionBox, type Box } from './canvasMove'

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })

describe('where a canvas drop lands', () => {
  // A column: three rows 20 high with 10 between them.
  const column = box(0, 0, 100, 80)
  const rows = [box(0, 0, 100, 20), box(0, 30, 100, 50), box(0, 60, 100, 80)]

  it('counts the children whose middle the pointer has passed, along the column', () => {
    expect(dropSlot('vertical', column, rows, { x: 50, y: 5 }).index).toBe(0)
    expect(dropSlot('vertical', column, rows, { x: 50, y: 15 }).index).toBe(1)
    expect(dropSlot('vertical', column, rows, { x: 50, y: 41 }).index).toBe(2)
    expect(dropSlot('vertical', column, rows, { x: 50, y: 79 }).index).toBe(3)
  })

  it('draws the line in the gap, or on the outer edge, across the whole container', () => {
    expect(dropSlot('vertical', column, rows, { x: 50, y: 15 }).line).toEqual(box(0, 24, 100, 26))
    expect(dropSlot('vertical', column, rows, { x: 50, y: 2 }).line).toEqual(box(0, -1, 100, 1))
    expect(dropSlot('vertical', column, rows, { x: 50, y: 79 }).line).toEqual(box(0, 79, 100, 81))
  })

  it('measures a row across, not down', () => {
    const row = box(0, 0, 90, 20)
    const items = [box(0, 0, 20, 20), box(35, 0, 55, 20), box(70, 0, 90, 20)]
    const slot = dropSlot('horizontal', row, items, { x: 60, y: 999 })
    expect(slot.index).toBe(2)
    expect(slot.line).toEqual(box(61.5, 0, 63.5, 20))
  })

  it('drops into an empty container at its middle, and on top of a ZStack without a line', () => {
    expect(dropSlot('vertical', column, [], { x: 50, y: 70 })).toEqual({ index: 0, line: box(0, 39, 100, 41) })
    expect(dropSlot('depth', column, rows, { x: 50, y: 5 })).toEqual({ index: 3, line: null })
  })

  it('unions boxes, and has nothing to union for nothing', () => {
    expect(unionBox([box(5, 5, 10, 10), box(0, 8, 7, 20)])).toEqual(box(0, 5, 10, 20))
    expect(unionBox([])).toBeNull()
  })
})
