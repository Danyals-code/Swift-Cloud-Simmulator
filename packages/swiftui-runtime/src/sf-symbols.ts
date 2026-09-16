import { SYMBOL_MAP, symbolDefinition } from '@studio/shared'

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

export function isKnownSymbol(name: string): boolean {
  return symbolDefinition(name) !== null
}

export function symbolNames(): string[] {
  return Object.keys(SYMBOL_MAP).sort()
}
