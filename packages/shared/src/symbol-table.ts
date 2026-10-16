import type { RGBA } from './render-tree'
import { symbolDefinition, type SymbolDefinition } from './symbol-map'

// How symbols are painted beyond their outline (Wave 6b): rendering modes, multicolor and
// variable values. A module of its own, beside the map in `symbol-map.ts`.

/** `SymbolRenderingMode`'s members, as `.symbolRenderingMode(...)` writes them (iOS 15). */
export const SYMBOL_RENDERING_MODES = ['monochrome', 'hierarchical', 'palette', 'multicolor'] as const
export type SymbolRenderingMode = (typeof SYMBOL_RENDERING_MODES)[number]

/** Whether `name` is a `SymbolRenderingMode` member, `palette` for `.palette`. */
export function isSymbolRenderingMode(name: string | undefined): name is SymbolRenderingMode {
  return (SYMBOL_RENDERING_MODES as readonly (string | undefined)[]).includes(name)
}

/**
 * `.symbolRenderingMode` where it paints a symbol's layers apart, and `variableValue` (Wave 6b).
 * `colors` are palette's styles in order, or multicolor's fixed colours by layer, `null` for
 * the foreground style.
 */
export interface SymbolPaint {
  readonly mode?: Exclude<SymbolRenderingMode, 'monochrome'>
  readonly colors?: readonly (RGBA | null)[]
  readonly variableValue?: number
}

/** What one of a symbol's layers is painted in: a colour of its own, or the foreground style (`null`) at a strength. */
export interface SymbolLayerStyle {
  readonly color: RGBA | null
  readonly opacity: number
}

const FOREGROUND: SymbolLayerStyle = { color: null, opacity: 1 }
const HIERARCHICAL: readonly [SymbolLayerStyle, SymbolLayerStyle, SymbolLayerStyle] = [FOREGROUND, { color: null, opacity: 0.5 }, { color: null, opacity: 0.25 }]

/**
 * What a symbol's three layers are painted in: the glyph or badge, what it sits on, then a
 * filled container. Hierarchical draws the second at half the foreground's strength and the
 * third at a quarter; palette's later layers repeat its last style, and a style that isn't a
 * colour, a gradient, is the foreground style, as SwiftUI 27 draws them
 * (docs/parity/native/iphone18pro-symbols, and ImageRenderer on macOS 27 for gradients).
 */
export function symbolLayerStyles(paint: SymbolPaint | undefined): readonly [SymbolLayerStyle, SymbolLayerStyle, SymbolLayerStyle] {
  if (paint?.mode === 'hierarchical') return HIERARCHICAL
  const colors = paint?.colors ?? []
  const style = (index: number): SymbolLayerStyle => colors[index] ? { color: colors[index]!, opacity: 1 } : FOREGROUND
  if (paint?.mode === 'multicolor') return [style(0), style(1), style(2)]
  const last = Math.max(0, colors.length - 1)
  return [style(0), style(Math.min(1, last)), style(Math.min(2, last))]
}

/** The colours a symbol's three layers are painted in, `symbolLayerStyles` over a foreground colour. */
export function symbolLayerColors(image: { readonly color: RGBA; readonly symbolPaint?: SymbolPaint }): readonly [RGBA, RGBA, RGBA] {
  const { color } = image
  const colour = (style: SymbolLayerStyle): RGBA => style.color ?? (style.opacity === 1 ? color : { ...color, a: color.a * style.opacity })
  const [first, second, third] = symbolLayerStyles(image.symbolPaint)
  return [colour(first), colour(second), colour(third)]
}

/** A symbol drawn as a glyph in a container, which hierarchical and palette paint apart. */
export interface SymbolEnclosure {
  readonly container: NonNullable<SymbolDefinition['container']>
  readonly filled: boolean
  /** The glyph inside, with its own turn and mirroring. */
  readonly glyph: SymbolDefinition
}

/**
 * The shape a symbol's glyph sits in, which hierarchical and palette paint as a layer of its
 * own: written in the table, or a `.circle` or `.square` name, filled or not, whose glyph is
 * a mapped name, as checkmark.circle.fill is. The filled glyph is drawn when there is one.
 * The one path the painter takes for both, so a mirrored glyph stays mirrored in either.
 */
export function symbolEnclosure(name: string): SymbolEnclosure | null {
  const definition = symbolDefinition(name)
  if (!definition) return null
  if (definition.container) return { container: definition.container, filled: definition.filled === true, glyph: definition }
  const match = /^(.+)\.(circle|square)(\.fill)?$/.exec(name)
  const glyph = match && (symbolDefinition(`${match[1]}${match[3] ?? ''}`) ?? symbolDefinition(match[1]!))
  if (!match || !glyph || glyph.container || glyph.badge || glyph.slash) return null
  return { container: match[2] as 'circle' | 'square', filled: match[3] !== undefined, glyph }
}

/**
 * Colours `.symbolRenderingMode(.multicolor)` paints, measured on iOS 27
 * (docs/parity/native/iphone18pro-symbols): by layer, the glyph or badge first, then what it
 * sits on, then a filled container; empty for the foreground style. Any other symbol is drawn
 * in the foreground style, as iOS draws a symbol with no colours of its own, such as flame
 * and drop.
 */
const MULTICOLOR = 'heart,heart.fill,trash,trash.fill:red;leaf,leaf.fill:green;bolt,bolt.fill,star,star.fill,sun.max.fill,exclamationmark.triangle.fill:yellow;flag.fill:orange;' +
  'trash.circle.fill,xmark.octagon.fill:white,,red;checkmark.circle.fill:white,,blue;plus.circle.fill:white,,green;' +
  'bell.badge,bell.badge.fill,app.badge,envelope.badge:red;folder.badge.plus,person.crop.circle.badge.plus,cart.badge.plus:green;calendar.badge.plus:green,red;person.crop.circle.badge.checkmark:blue'

let multicolor: Map<string, readonly string[]> | undefined

/** The system colour names multicolor paints `name`'s layers in, `''` for the foreground style, or null. */
export function symbolMulticolor(name: string): readonly string[] | null {
  if (!multicolor) {
    multicolor = new Map()
    for (const group of MULTICOLOR.split(';')) {
      const [names = '', colours = ''] = group.split(':')
      for (const each of names.split(',')) multicolor.set(each, colours.split(','))
    }
  }
  return multicolor.get(name) ?? null
}

/** Symbols whose bars or waves `variableValue` dims, as iOS 27 does. */
const VARIABLE = new Set(['wifi', 'cellularbars', 'speaker.wave.1', 'speaker.wave.2', 'speaker.wave.3', 'speaker.wave.1.fill', 'speaker.wave.2.fill', 'speaker.wave.3.fill'])

/**
 * Whether the preview paints `name` in `mode` differently from monochrome: hierarchical and
 * palette need a second layer, a container, a badge or a drawing with layers of its own;
 * multicolor needs colours in the table. Anything else is drawn in one colour.
 */
export function symbolDrawsMode(name: string, mode: Exclude<SymbolRenderingMode, 'monochrome'>): boolean {
  const definition = symbolDefinition(name)
  if (!definition) return false
  if (mode === 'multicolor') return symbolMulticolor(name) !== null
  return definition.badge !== undefined || definition.layered === true || symbolEnclosure(name) !== null
}

/** Whether `Image(systemName:variableValue:)` dims part of `name` here. */
export function symbolDrawsVariableValue(name: string): boolean {
  return VARIABLE.has(name) && symbolDefinition(name) !== null
}
