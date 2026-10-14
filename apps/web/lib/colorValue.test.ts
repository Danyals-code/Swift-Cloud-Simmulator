import { describe, expect, it } from 'vitest'
import type { FillValue, SharedStyle } from '@studio/shared'
import { addStop, cardColor, colorFromText, colorLabel, fillOfKind, gradientOfType, isHexColor, keepOpacity, opacityPercent, parseHex, pickerColor, removeStop, stopTrack, swatchCss, tokenFor, tokenReference, withOpacity, withPickedColor } from './colorValue'

/**
 * The colour fields' own arithmetic: what a typed hex or name means, how an opacity reads
 * as a percent, what a swatch draws, and how a token is named and referred to.
 */

const token = (name: string, light: string, form: 'token' | 'legacy' = 'token'): SharedStyle =>
  ({ name, kind: 'color', value: light, light, form, reference: form === 'token' ? `.${name}` : name, source: { file: 'Tokens.swift', start: 0, end: 0 }, uses: [] })
const TOKENS = [token('accent', '#FF2D55'), token('Theme.brand', '#336699', 'legacy')]

describe('a typed hex', () => {
  it.each([
    ['#f00', '#FF0000'], ['#f008', '#FF000088'], ['#0a84ff', '#0A84FF'], ['0A84FF', '#0A84FF'],
    ['#0a84ff80', '#0A84FF80'], [' #0A84FFff ', '#0A84FF'],
  ])('reads %s as %s, keeping its alpha', (typed, hex) => {
    expect(parseHex(typed)).toBe(hex)
  })

  it.each(['#12', '#GGGGGG', '#12345', 'red', ''])('refuses %j', typed => {
    expect(parseHex(typed)).toBeNull()
  })
})

describe('what the colour field takes', () => {
  it.each([
    ['#0a84ff', { hex: '#0A84FF' }],
    ['#FF000080', { hex: '#FF0000', opacity: 0.502 }],
    ['#f008', { hex: '#FF0000', opacity: 0.533 }],
    ['red', { name: 'red' }],
    ['System Gray 6', { name: 'systemGray6' }],
    ['Grouped card background', { name: 'secondarySystemGroupedBackground' }],
  ])('takes %j', (typed, color) => {
    expect(colorFromText(typed)).toEqual(color)
  })

  it('takes nothing it cannot write', () => {
    expect(colorFromText('salmon')).toBeNull()
  })
})

describe('opacity as a percent', () => {
  it.each([[{ name: 'red' }, 100], [{ name: 'red', opacity: 0.5 }, 50], [{ hex: '#FF0000', opacity: 0.502 }, 50.2]])('shows %j at %d%%', (color, percent) => {
    expect(opacityPercent(color)).toBe(percent)
  })

  it('sets one from a percent, dropping it at 100% and keeping it in range', () => {
    expect(withOpacity({ name: 'red' }, 40)).toEqual({ name: 'red', opacity: 0.4 })
    expect(withOpacity({ name: 'red', opacity: 0.4 }, 100)).toEqual({ name: 'red' })
    expect(withOpacity({ hex: '#FF0000' }, 150)).toEqual({ hex: '#FF0000' })
    expect(withOpacity({ hex: '#FF0000' }, -5)).toEqual({ hex: '#FF0000', opacity: 0 })
  })

  it('stays when another colour is picked, as Figma keeps it, unless the pick has its own', () => {
    expect(keepOpacity({ name: 'blue' }, { hex: '#FF0000', opacity: 0.5 })).toEqual({ name: 'blue', opacity: 0.5 })
    expect(keepOpacity({ token: 'Color.accent' }, { name: 'red', opacity: 0.25 })).toEqual({ token: 'Color.accent', opacity: 0.25 })
    expect(keepOpacity({ hex: '#00FF00', opacity: 0.8 }, { name: 'red', opacity: 0.25 })).toEqual({ hex: '#00FF00', opacity: 0.8 })
    expect(keepOpacity({ name: 'blue' }, { name: 'red' })).toEqual({ name: 'blue' })
  })
})

describe('the system colour picker', () => {
  it('takes a hex with or without its alpha', () => {
    expect(['#0A84FF', '#0a84ff80'].map(isHexColor)).toEqual([true, true])
    expect(['#0A84F', 'blue', '#0A84FF8'].map(isHexColor)).toEqual([false, false, false])
  })

  it('shows the draft without its alpha, which it has no place for, and keeps that alpha when a colour is picked', () => {
    expect(pickerColor('#0A84FF80', '#000000')).toBe('#0A84FF')
    expect(pickerColor('blue', '#000000')).toBe('#000000')
    expect(withPickedColor('#0A84FF80', '#ff0000')).toBe('#FF000080')
    expect(withPickedColor('blue', '#ff0000')).toBe('#FF0000')
  })
})

describe('swatches and names', () => {
  it.each([
    [{ hex: '#0A84FF', opacity: 0.5 }, 'rgba(10, 132, 255, 0.5)'],
    [{ name: 'red' }, 'rgba(255, 56, 60, 1)'],
    [{ token: '.accent' }, 'rgba(255, 45, 85, 1)'],
    [{ token: 'Theme.brand', opacity: 0.25 }, 'rgba(51, 102, 153, 0.25)'],
  ])('draws %j', (color, css) => {
    expect(swatchCss(color, TOKENS)).toBe(css)
  })

  it.each([
    [{ hex: '#0A84FF' }, '#0A84FF'], [{ name: 'red' }, 'Red'], [{ name: 'systemGray6' }, 'System Gray 6'], [{ name: 'accentColor' }, 'App accent'], [{ name: 'secondarySystemGroupedBackground' }, 'Grouped card background'],
    [{ token: 'Color.accent' }, 'accent'], [{ token: 'Theme.brand' }, 'Theme.brand'], [{ token: 'Color("Brand")' }, 'Brand'], [{ token: '.unknown' }, 'unknown'],
  ])('names %j', (color, label) => {
    expect(colorLabel(color, TOKENS)).toBe(label)
  })

  it('refers to a token in the spelling every place takes, and finds it again however it was written', () => {
    expect(tokenReference(TOKENS[0]!)).toBe('Color.accent')
    expect(tokenReference(TOKENS[1]!)).toBe('Theme.brand')
    for (const written of ['.accent', 'Color.accent']) expect(tokenFor({ token: written }, TOKENS)?.name).toBe('accent')
    expect(tokenFor({ name: 'red' }, TOKENS)).toBeUndefined()
  })
})

describe('switching the kind of fill', () => {
  const red = { kind: 'color', color: { name: 'red' } } as const
  it.each([
    ['nothing to a solid', null, 'color', { kind: 'color', color: { name: 'systemGray5' } }],
    ['a solid to a gradient, fading out as Figma does', red, 'gradient', { kind: 'gradient', type: 'linear', angle: 0, stops: [{ color: { name: 'red' }, location: 0 }, { color: { name: 'red', opacity: 0 }, location: 1 }] }],
    ['a gradient to a solid, its first colour', { kind: 'gradient', type: 'linear', angle: 90, stops: [{ color: { name: 'blue' }, location: 0 }, { color: { name: 'red' }, location: 1 }] }, 'color', { kind: 'color', color: { name: 'blue' } }],
    ['anything to a material', red, 'material', { kind: 'material', thickness: 'regular' }],
    ['anything to glass', red, 'glass', { kind: 'glass', variant: 'regular' }],
  ] as const)('turns %s', (_, fill, kind, expected) => {
    expect(fillOfKind(kind, fill as FillValue | null)).toEqual(expected)
  })
})

describe('gradient stops', () => {
  const stops = [{ color: { name: 'red' }, location: 0 }, { color: { name: 'blue' }, location: 1 }]
  it('adds one in the middle of the widest gap, in the colour before it', () => {
    expect(addStop(stops)).toEqual([stops[0], { color: { name: 'red' }, location: 0.5 }, stops[1]])
    expect(addStop([stops[0]!, { color: { name: 'green' }, location: 0.2 }, stops[1]!])).toEqual([stops[0], { color: { name: 'green' }, location: 0.2 }, { color: { name: 'green' }, location: 0.6 }, stops[1]])
  })

  it('keeps two stops', () => {
    expect(removeStop(addStop(stops), 1)).toEqual(stops)
    expect(removeStop(stops, 0)).toEqual(stops)
  })
})

describe('a gradient’s type and stop bar', () => {
  type Gradient = Extract<FillValue, { kind: 'gradient' }>
  const stops = [{ color: { name: 'red' }, location: 0 }, { color: { hex: '#0A84FF', opacity: 0.5 }, location: 1 }]
  const linear: Gradient = { kind: 'gradient', type: 'linear', angle: 90, stops }
  it.each([
    ['radial, from the middle', 'radial', { kind: 'gradient', type: 'radial', stops, center: { x: 0.5, y: 0.5 }, startRadius: 0, endRadius: 100 }],
    ['angular, round the middle', 'angular', { kind: 'gradient', type: 'angular', stops, center: { x: 0.5, y: 0.5 } }],
    ['linear, keeping its angle', 'linear', linear],
  ] as const)('turns linear %s', (_, type, expected) => {
    expect(gradientOfType(linear, type)).toEqual(expected)
  })

  it('gives a colour’s own gradient a second stop when it becomes one the designer sets', () => {
    const automatic: Gradient = { kind: 'gradient', type: 'linear', angle: 0, automatic: true, stops: [{ color: { name: 'blue' }, location: 0 }] }
    expect(addStop(automatic.stops)).toEqual([{ color: { name: 'blue' }, location: 0 }, { color: { name: 'blue', opacity: 0 }, location: 1 }])
    expect(gradientOfType(automatic, 'radial')).toMatchObject({ type: 'radial', stops: [{ location: 0 }, { location: 1 }] })
    expect(gradientOfType(automatic, 'radial')).not.toHaveProperty('automatic')
  })

  it('draws its stops along a bar from left to right, whatever its angle', () => {
    expect(stopTrack(linear, [])).toBe('linear-gradient(90deg, rgba(255, 56, 60, 1) 0%, rgba(10, 132, 255, 0.5) 100%)')
    expect(stopTrack({ ...linear, stops: [stops[0]!, { ...stops[1]!, location: 0.25 }] }, [])).toBe('linear-gradient(90deg, rgba(255, 56, 60, 1) 0%, rgba(10, 132, 255, 0.5) 25%)')
  })
})

describe('a Card’s colour', () => {
  it.each([
    [{ name: 'secondarySystemBackground' }, 'secondarySystemBackground'],
    [{ hex: '#DBEAFE' }, '#DBEAFE'],
    [{ hex: '#DBEAFE', opacity: 0.5 }, '#DBEAFE80'],
    [{ name: 'red', opacity: 0.5 }, '#FF383C80'],
  ])('is %j as the card takes it', (color, expected) => {
    expect(cardColor(color, [])).toBe(expected)
  })

  it('takes a token by its value, which the card cannot link', () => {
    expect(cardColor({ token: '.accent' }, TOKENS)).toBe('#FF2D55')
    expect(cardColor({ token: 'Theme.unknown' }, TOKENS)).toBeNull()
  })
})
