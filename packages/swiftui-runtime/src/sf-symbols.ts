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
