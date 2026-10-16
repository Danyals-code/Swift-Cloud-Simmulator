import { SYMBOL_MAP, symbolDefinition, symbolVariantName } from '@studio/shared'

export interface ResolvedSymbol {
  readonly glyph: string
  readonly approximated: boolean
  readonly known: boolean
}

/** Worker and painter use the same exact-name mapping; never discard a slash or enclosure. */
export function resolveSymbol(name: string): ResolvedSymbol {
  const known = symbolDefinition(name) !== null
  return { glyph: known ? '' : '▢', approximated: true, known }
}

const VARIANTS = new Set(['none', 'fill', 'circle', 'square', 'rectangle', 'slash'])

/** Whether a name is a `.symbolVariant` chain, `fill.circle`, which a member of it may extend. */
export function isSymbolVariant(name: string): boolean {
  return name.split('.').every((part) => VARIANTS.has(part))
}

const EFFECTS = new Set(['appear', 'disappear', 'scale', 'bounce', 'pulse', 'variableColor', 'wiggle', 'breathe', 'rotate', 'replace'])
const EFFECT_OPTIONS = new Set(['up', 'down', 'left', 'right', 'forward', 'backward', 'clockwise', 'counterClockwise', 'byLayer', 'wholeSymbol',
  'iterative', 'cumulative', 'reversing', 'nonReversing', 'hideInactiveLayers', 'dimInactiveLayers', 'offUp', 'downUp', 'upUp', 'plain'])

/** Whether `.member` is an option of the symbol effect `effect` names, `.disappear.down` (Wave 6b). */
export function isSymbolEffectOption(effect: string, member: string): boolean {
  return EFFECTS.has(effect.split('.')[0]!) && EFFECT_OPTIONS.has(member)
}

/**
 * The symbol `.symbolVariant(variant)` draws for `name`, composed as `symbolVariantName`
 * says. Where the preview has no such symbol it draws the one written, as iOS 27 draws
 * folder for folder with `.square` (docs/parity/native/iphone18pro-text).
 */
export function variantSymbol(name: string, variant: string | undefined): string {
  const composed = symbolVariantName(name, variant)
  return symbolDefinition(composed) ? composed : name
}

export function isKnownSymbol(name: string): boolean {
  return symbolDefinition(name) !== null
}

export function symbolNames(): string[] {
  return Object.keys(SYMBOL_MAP).sort()
}
