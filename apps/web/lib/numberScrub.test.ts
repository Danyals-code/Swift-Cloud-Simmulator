import { describe, expect, it } from 'vitest'
import { clampNumber, formatNumber, parseNumber, scrubbedValue, steppedValue } from './numberScrub'

/** A number field as Figma's: drag its label to scrub, arrows to nudge, units typed or not. */
describe('scrubbing a number by dragging its label', () => {
  it('moves one step a pixel, and ten with Shift', () => {
    expect(scrubbedValue(10, 5)).toBe(15)
    expect(scrubbedValue(10, -4)).toBe(6)
    expect(scrubbedValue(10, 3, { fast: true })).toBe(40)
    expect(scrubbedValue(1, 3, { step: 0.1 })).toBe(1.3)
  })

  it('stays inside the field’s limits', () => {
    expect(scrubbedValue(10, -15, { min: 0 })).toBe(0)
    expect(scrubbedValue(90, 40, { max: 100 })).toBe(100)
    expect(scrubbedValue(0.5, 2, { step: 0.3, integer: true })).toBe(1)
  })
})

describe('nudging a number with the arrow keys', () => {
  it('steps by one, and by ten with Shift, inside the limits', () => {
    expect(steppedValue(10, 1)).toBe(11)
    expect(steppedValue(10, -1, { fast: true })).toBe(0)
    expect(steppedValue(5, -1, { fast: true, min: 0 })).toBe(0)
    expect(steppedValue(0.2, 1, { step: 0.1 })).toBe(0.3)
  })
})

describe('reading and showing a typed number', () => {
  it.each<[string, number | null]>([
    ['12', 12], [' 12.5 ', 12.5], ['-4', -4], ['.5', 0.5], ['12pt', 12], ['12 pt', 12], ['50%', 50],
    ['', null], ['abc', null], ['12px', null], ['1e3', null], ['--2', null],
  ])('reads %j as %j', (text, value) => {
    expect(parseNumber(text)).toBe(value)
  })

  it('shows a number without float noise or trailing zeros', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(12)).toBe('12')
    expect(formatNumber(39.444)).toBe('39.44')
    expect(formatNumber(-0)).toBe('0')
  })

  it('keeps a value to whole numbers when the field asks for them', () => {
    expect(clampNumber(12.6, { integer: true })).toBe(13)
    expect(clampNumber(-3, { min: 0 })).toBe(0)
    expect(clampNumber(1 / 3)).toBe(0.33)
  })
})
