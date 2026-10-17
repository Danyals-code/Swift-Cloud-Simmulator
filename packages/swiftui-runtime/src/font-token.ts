import { iosFont, projectFont, projectFontFamily, type PreviewFontAsset } from '@studio/shared'
import { setProjectFontHeights } from '@studio/swiftui-layout'
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
  /**
   * `.custom(name, …)` of a family iOS ships (Wave 6a), or of a project font's CSS family
   * (Wave 6f): the family, and a PostScript name's weight.
   */
  readonly family?: string
  readonly faceWeight?: number
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

/**
 * The project's font files, for the compile in progress (Wave 6f). Held here as the asset
 * colours are in `style.ts`: `.custom(…)` is resolved while the view runs, and the pipeline
 * sets them before it does.
 */
let projectFonts: readonly PreviewFontAsset[] | undefined
export function setProjectFonts(fonts: readonly PreviewFontAsset[] | undefined): void {
  projectFonts = fonts
  setProjectFontHeights(fonts)
}

/**
 * `.custom("Avenir Next", size: 24, relativeTo: .title)`: a face the project has a file for
 * is drawn in it (Wave 6f), then a family or PostScript name iOS ships in that face (Wave
 * 6a), and any other in the system face, as iOS draws a font the app doesn't bundle.
 */
export function customFont(size: number, relativeTo: string | null, name?: string | null): FontSpec {
  const own = name && projectFonts?.length ? projectFont(name, projectFonts) : undefined
  const face = own ? { family: projectFontFamily(own.family), weight: own.weight, italic: own.italic } : name ? iosFont(name) : undefined
  return { ...PLAIN, style: null, size, relativeTo, ...face ? { family: face.family, italic: face.italic, ...face.weight ? { faceWeight: face.weight } : {} } : {} }
}
