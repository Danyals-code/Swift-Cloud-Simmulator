import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SYMBOL_MAP } from '@studio/shared'
import { COMMON_SYMBOLS } from './generation/common-symbols'
import { offeredSymbols } from './generation/offered-symbols'
import { findSymbols, SYMBOL_CATEGORIES, symbolCategory } from './symbolSearch'

/** The symbols the picker can offer: every one the preview draws. */
const names = Object.keys(SYMBOL_MAP)
/** The SF Symbols app's categories for each symbol it files, several to a symbol (macOS only). */
const APPLE_CATEGORIES = '/System/Library/CoreServices/CoreGlyphs.bundle/Contents/Resources/symbol_categories.plist'

describe('the symbol picker’s categories (Wave 6b)', () => {
  it('puts every symbol the preview draws in exactly one category', () => {
    const shown = SYMBOL_CATEGORIES.flatMap(category => findSymbols(names, '', category))
    expect(shown).toHaveLength(names.length)
    expect(new Set(shown)).toEqual(new Set(names))
    expect(names.filter(name => !symbolCategory(name))).toEqual([])
  })

  it('puts a symbol in the category of the longest name it starts with', () => {
    expect(symbolCategory('house')).toBe('Essentials')
    expect(symbolCategory('cloud.sun.rain.fill')).toBe('Weather & Nature')
    expect(symbolCategory('square.and.arrow.up')).toBe('Arrows')
    expect(symbolCategory('square.and.pencil')).toBe('Editing')
    expect(symbolCategory('square.fill')).toBe('Shapes')
    expect(symbolCategory('person.crop.circle')).toBe('Human')
    expect(symbolCategory('figure.run')).toBe('Health & Fitness')
    expect(symbolCategory('checkmark.shield')).toBe('Privacy & Security')
    expect(symbolCategory('fork.knife')).toBe('Home & Food')
    // A word that only starts the same way is not the same kind: "car" is not "cart".
    expect(symbolCategory('cart')).toBe('Commerce')
    expect(symbolCategory('car.fill')).toBe('Travel')
  })
})

describe.skipIf(!existsSync(APPLE_CATEGORIES))('the symbol picker’s categories, against the SF Symbols app’s (Wave 6b)', () => {
  it('takes an app category’s name only where the app files every one of its symbols there', () => {
    const filed = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', APPLE_CATEGORIES], { encoding: 'utf8', maxBuffer: 64 << 20 })) as Record<string, string[]>
    // The app's keys for the categories the picker names as the app does; the others are the studio's own groups.
    const named: Record<string, string> = { Human: 'human', Arrows: 'arrows', 'Privacy & Security': 'privacyandsecurity', 'Objects & Tools': 'objectsandtools' }
    for (const [category, key] of Object.entries(named)) {
      const symbols = findSymbols(names, '', category).filter(name => filed[name])
      expect(symbols.length, category).toBeGreaterThan(10)
      expect(symbols.filter(name => !filed[name]!.includes(key)), category).toEqual([])
    }
  })
})

describe('finding a symbol (Wave 6b)', () => {
  it('lists every symbol, the plainest kinds first, with no search and no category', () => {
    const all = findSymbols(names, '', null)
    expect(new Set(all)).toEqual(new Set(names))
    expect(all[0]).toBe('house')
    expect(all.indexOf('heart')).toBeLessThan(all.indexOf('heart.fill'))
  })

  it('shows one category, in its order', () => {
    const weather = findSymbols(names, '', 'Weather & Nature')
    expect(weather).toContain('sun.max')
    expect(weather).toContain('snowflake')
    expect(weather.every(name => symbolCategory(name) === 'Weather & Nature')).toBe(true)
  })

  it('matches every word typed, with dots read as spaces', () => {
    const found = findSymbols(names, 'Arrow  up', null)
    expect(found).toContain('arrow.up')
    expect(found).toContain('square.and.arrow.up')
    expect(found).not.toContain('arrow.down')
    // A name that starts with the words comes before one that only has them inside.
    expect(found.indexOf('arrow.up')).toBeLessThan(found.indexOf('square.and.arrow.up'))
    expect(findSymbols(names, 'square.and.arrow', null)).toContain('square.and.arrow.up')
  })

  it('shows a symbol first when its whole name is typed, before longer names in an earlier category', () => {
    expect(findSymbols(names, 'square', null)[0]).toBe('square')
    expect(findSymbols(names, 'circle', null)[0]).toBe('circle')
    expect(findSymbols(names, 'person.crop.circle', null)[0]).toBe('person.crop.circle')
  })

  it('finds a symbol by the everyday word for it, or by its category', () => {
    expect(findSymbols(names, 'settings', null)).toContain('gearshape')
    expect(findSymbols(names, 'home', null)).toContain('house')
    expect(findSymbols(names, 'delete', null)).toContain('trash')
    expect(findSymbols(names, 'close', null)).toContain('xmark')
    expect(findSymbols(names, 'weather', null)).toContain('sun.max')
    expect(findSymbols(names, 'security', null)).toContain('lock')
  })

  it('searches within the chosen category', () => {
    expect(findSymbols(names, 'circle', 'Shapes')).toContain('circle')
    expect(findSymbols(names, 'circle', 'Shapes')).not.toContain('person.circle')
  })

  it('finds nothing for a word no symbol has', () => {
    expect(findSymbols(names, 'zzzz', null)).toEqual([])
    expect(findSymbols(names, 'constructor', null)).toEqual([])
  })
})

describe('the picker and the prompts, which group the same everyday names apart (Wave 6b)', () => {
  it('finds every everyday name the preview draws, and shows each name the prompts offer first when it is typed', () => {
    const everyday = COMMON_SYMBOLS.split(/\s+/).filter(name => SYMBOL_MAP[name])
    expect(everyday.length).toBeGreaterThan(600)
    expect(everyday.filter(name => !symbolCategory(name))).toEqual([])
    const offered = offeredSymbols(300)
    expect(offered).toHaveLength(300)
    expect(offered.filter(name => findSymbols(names, name, null)[0] !== name)).toEqual([])
  })
})
