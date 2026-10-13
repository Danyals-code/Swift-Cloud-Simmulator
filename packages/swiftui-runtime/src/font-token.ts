import { IOS_27 } from './appearance/ios27'

/**
 * A `Font` as it travels from the host to `resolveFontArg`: in a contextual token's
 * name, because `.title` has no type information to hang a font on until `.font()`
 * reads it.
 *
 * Three spellings arrive. A text style's bare name, `body`; the two the host has always
 * written, `style:title:bold:rounded:italic` and `system:20:bold:default`; and `font:`
 * followed by this record as JSON, which is what a font asked to change itself becomes.
 * The record carries what the older two have no field for: `.leading(.tight)`,
 * `.smallCaps()` and a custom face's size.
 */
export interface FontSpec {
  /** A text style's name, or null for a face given in points. */
  readonly style: string | null
  /** Points, where `style` is null. */
  readonly size: number | null
  /**
   * `.custom(_:size:)` only: the text style whose Dynamic Type curve its size follows,
   * `body` unless `relativeTo:` names another, and null for `fixedSize:`.
   */
  readonly relativeTo?: string | null
  readonly weight: string
  readonly design: string
  readonly italic: boolean
  /** `tight`, `loose`, or '' for the style's own. */
  readonly leading: string
  readonly smallCaps: boolean
}

const PLAIN: Omit<FontSpec, 'style' | 'size'> = { weight: '', design: '', italic: false, leading: '', smallCaps: false }

export function isTextStyle(name: string): boolean {
  return IOS_27.textStyles[name] !== undefined
}

/** The font a token's name describes, or null for a token that is not a font. */
export function parseFontToken(name: string): FontSpec | null {
  if (name.startsWith('font:')) return JSON.parse(name.slice('font:'.length)) as FontSpec
  if (name.startsWith('style:')) {
    const [style = '', weight = '', design = '', italic = ''] = name.slice('style:'.length).split(':')
    return isTextStyle(style) ? { ...PLAIN, style, size: null, weight, design, italic: italic === 'italic' } : null
  }
  if (name.startsWith('system:')) {
    const [, size, weight = '', design = ''] = name.split(':')
    return { ...PLAIN, style: null, size: Number(size) || 17, weight: weight === 'regular' ? '' : weight, design: design === 'default' ? '' : design }
  }
  return isTextStyle(name) ? { ...PLAIN, style: name, size: null } : null
}

export function fontTokenName(font: FontSpec): string {
  return `font:${JSON.stringify(font)}`
}

/** `.custom("Avenir", size: 24, relativeTo: .title)`, drawn in the system face. */
export function customFont(size: number, relativeTo: string | null): FontSpec {
  return { ...PLAIN, style: null, size, relativeTo }
}
