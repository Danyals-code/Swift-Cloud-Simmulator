import { dynamicTypeForScale, type DynamicTypeSize } from '@studio/shared'
import { typographyAt } from './appearance/typography'
import { IOS_27 } from './appearance/ios27'
import {
  MONO_FAMILY,
  rgba,
  ROUNDED_FAMILY,
  SERIF_FAMILY,
  UI_FONT_FAMILY,
  type Fill,
  type PreviewColorAsset,
  type ResolvedFont,
  type RGBA,
} from '@studio/shared'
import type { SwiftValue } from '@studio/swift-runtime'
import {
  COLOR_TYPE,
  STYLE_TYPE,
  TOKEN_TYPE,
  type ColorPayload,
  type GradientPayload,
  type TokenPayload,
} from './view-value'

/**
 * Resolving SwiftUI's design tokens to concrete fonts and colours.
 *
 * Sizes are the iOS Dynamic Type defaults at the Large content size, because that is
 * what a stock device uses and what Xcode previews show. Getting these right matters
 * for layout, not just looks: `.largeTitle` at the wrong size makes every frame above
 * it wrong too.
 *
 * The family is a metric-compatible open stack rather than SF Pro, which is not
 * licensed for web redistribution (risk R2).
 */

// Defined in `shared` so the main thread can name a font face without importing the
// interpreter to do it. Re-exported here because this is where the layout code looks.
export { MONO_FAMILY, ROUNDED_FAMILY, UI_FONT_FAMILY } from '@studio/shared'

const TEXT_STYLES = IOS_27.textStyles

export const BODY_FONT: ResolvedFont = {
  family: UI_FONT_FAMILY,
  size: TEXT_STYLES.body!.size,
  weight: TEXT_STYLES.body!.weight,
  italic: false,
  lineHeight: TEXT_STYLES.body!.lineHeight,
}

/** The font a `Button` label uses by default. */
export const BUTTON_FONT: ResolvedFont = { ...BODY_FONT }

/** Resolve the style's own size/leading table, with legacy scale compatibility. */
export function fontForToken(name: string, scale: number | DynamicTypeSize = 1): ResolvedFont | null {
  const style = TEXT_STYLES[name]
  if (!style) return null
  const metrics = typographyAt(name, typeof scale === 'number' ? dynamicTypeForScale(scale) : scale)!
  return {
    family: UI_FONT_FAMILY,
    size: metrics.size,
    weight: style.weight,
    italic: false,
    lineHeight: metrics.lineHeight,
  }
}

/** The monospaced body face, as `.monospaced()` selects. */
export function monospacedFont(scale: number | DynamicTypeSize = 1): ResolvedFont {
  return { ...bodyFont(scale), family: MONO_FAMILY }
}

/** The body font at a given Dynamic Type scale - the root environment's font. */
export function bodyFont(scale: number | DynamicTypeSize = 1): ResolvedFont {
  return fontForToken('body', scale)!
}

export type ColorScheme = 'light' | 'dark'

/**
 * iOS system colours, both appearances.
 *
 * Dark mode is not "the light palette inverted" - Apple brightens and desaturates
 * each hue so it stays legible on black, and the semantic label colours change
 * opacity rather than simply flipping. Two tables is the only honest way to express
 * that, and using one would make every dark preview subtly wrong.
 */
const LIGHT_COLORS = IOS_27.colors.light
const DARK_COLORS = IOS_27.colors.dark

export function labelColor(scheme: ColorScheme): RGBA {
  return (scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS).primary!
}

export function systemBackground(scheme: ColorScheme): RGBA {
  return scheme === 'dark' ? rgba(0, 0, 0) : rgba(255, 255, 255)
}

export const LABEL_COLOR = labelColor('light')
export const SYSTEM_BACKGROUND = systemBackground('light')
export const ACCENT_COLOR = LIGHT_COLORS.accentColor!

export function colorForName(name: string, scheme: ColorScheme = 'light', tint?: RGBA): RGBA | null {
  if (tint && ['tint', 'accent', 'accentColor'].includes(name)) return tint
  return (scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS)[name] ?? null
}

/** A colour set from the project's asset catalog: one value per appearance. */
export type AssetColor = PreviewColorAsset

/**
 * The colour sets `Color("name")` reads, for the compile in progress.
 *
 * Held here rather than threaded through every resolver: a colour is resolved in a
 * few dozen places, all within one synchronous compile, and every one of them must
 * answer the same way. The pipeline sets it before evaluation and it stays until the
 * next compile replaces it.
 */
let assetColors: ReadonlyMap<string, AssetColor> = new Map()
export function setAssetColors(colors: readonly AssetColor[] | undefined): void {
  assetColors = new Map((colors ?? []).map(color => [color.name, color]))
}

/** `#RRGGBB` or `#RRGGBBAA`, as the asset catalog stores a colour. */
export function hexColor(value: string): RGBA | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim())
  if (!match) return null
  const channel = (at: number) => parseInt(match[1]!.slice(at, at + 2), 16)
  return rgba(channel(0), channel(2), channel(4), match[2] ? Math.round(parseInt(match[2], 16) / 255 * 1000) / 1000 : 1)
}

/**
 * A named asset colour for one appearance. A missing set is clear, which is what
 * SwiftUI draws for a name the catalog does not have; `AccentColor` falls back to
 * the system accent because every Xcode template ships one.
 */
function assetColor(name: string, scheme: ColorScheme, tint?: RGBA): RGBA {
  const set = assetColors.get(name)
  if (set) return hexColor(scheme === 'dark' && set.dark ? set.dark : set.light) ?? rgba(0, 0, 0, 0)
  if (name === 'AccentColor') return colorForName('accentColor', scheme, tint) ?? rgba(0, 0, 0, 0)
  return rgba(0, 0, 0, 0)
}

/** Turns a `Color` payload - named, or built from components - into an RGBA. */
export function resolveColorPayload(payload: ColorPayload, scheme: ColorScheme = 'light', tint?: RGBA): RGBA {
  const base =
    payload.name !== null && payload.asset
      ? assetColor(payload.name, scheme, tint)
      : payload.name !== null
      ? (colorForName(payload.name, scheme, tint) ?? rgba(0, 0, 0, 0))
      : payload.red !== undefined
        ? rgba(
            Math.round(clamp01(payload.red) * 255),
            Math.round(clamp01(payload.green ?? 0) * 255),
            Math.round(clamp01(payload.blue ?? 0) * 255),
          )
        : grayscale(payload.white ?? 0)

  const shaded =
    payload.shade === undefined
      ? base
      : {
          ...base,
          r: Math.round(base.r * payload.shade),
          g: Math.round(base.g * payload.shade),
          b: Math.round(base.b * payload.shade),
        }

  return payload.opacity === undefined ? shaded : { ...shaded, a: shaded.a * payload.opacity }
}

/**
 * Resolves anything usable as a `ShapeStyle`: a colour, a token, or a gradient.
 *
 * `.background`, `.foregroundStyle` and `.fill` all take the same protocol in
 * SwiftUI, so they take the same thing here - which is why a gradient works in every
 * one of them without three separate code paths.
 */
export function resolveFillArg(
  value: SwiftValue | undefined,
  scheme: ColorScheme = 'light',
  tint?: RGBA,
): Fill | null {
  if (!value || value.kind !== 'opaque') return null

  if (value.typeName === STYLE_TYPE) {
    const gradient = value.payload as GradientPayload
    const values = gradient.stops ?? gradient.colors.map((color, index) => ({ color, location: gradient.colors.length < 2 ? 0 : index / (gradient.colors.length - 1) }))
    const stops = values.flatMap(stop => {
      const color = resolveColorArg(stop.color, scheme, tint)
      return color ? [{ color: { ...color, a: color.a * (gradient.opacity ?? 1) }, location: stop.location }] : []
    })
    if (!stops.length) return null
    if (gradient.kind === 'radial') return { kind: 'radialGradient', stops, center: unitPoint(gradient.center ?? 'center'), startRadius: gradient.startRadius ?? 0, endRadius: gradient.endRadius ?? 100 }
    if (gradient.kind === 'angular') return { kind: 'angularGradient', stops, center: unitPoint(gradient.center ?? 'center'), startAngle: gradient.startAngle ?? 0, endAngle: gradient.endAngle ?? 360 }
    return {
      kind: 'linearGradient',
      stops,
      start: unitPoint(gradient.startPoint ?? 'top'),
      end: unitPoint(gradient.endPoint ?? 'bottom'),
    }
  }

  const color = resolveColorArg(value, scheme, tint)
  return color ? { kind: 'solid', color } : null
}

/** SwiftUI's named unit points, in the (0,0) top-leading space the render tree uses. */
export function unitPoint(name: string | { x: number; y: number }): { x: number; y: number } {
  if (typeof name !== 'string') return name
  const points: Readonly<Record<string, { x: number; y: number }>> = {
    topLeading: { x: 0, y: 0 },
    top: { x: 0.5, y: 0 },
    topTrailing: { x: 1, y: 0 },
    leading: { x: 0, y: 0.5 },
    center: { x: 0.5, y: 0.5 },
    trailing: { x: 1, y: 0.5 },
    bottomLeading: { x: 0, y: 1 },
    bottom: { x: 0.5, y: 1 },
    bottomTrailing: { x: 1, y: 1 },
  }
  return points[name] ?? { x: 0.5, y: 0 }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function grayscale(white: number): RGBA {
  const channel = Math.round(clamp01(white) * 255)
  return rgba(channel, channel, channel)
}

/**
 * Resolves an argument that should be a colour.
 *
 * Accepts a `Color` value or a bare token, because `.foregroundStyle(.primary)` and
 * `.foregroundStyle(Color.primary)` both appear in ordinary SwiftUI and mean the same
 * thing. Returns null for anything else so the caller can fall back rather than
 * inventing a colour.
 */
export function resolveColorArg(
  value: SwiftValue | undefined,
  scheme: ColorScheme = 'light',
  tint?: RGBA,
): RGBA | null {
  if (!value || value.kind !== 'opaque') return null

  if (value.typeName === COLOR_TYPE) {
    return resolveColorPayload(value.payload as ColorPayload, scheme, tint)
  }
  if (value.typeName === TOKEN_TYPE) {
    return colorForName((value.payload as TokenPayload).name, scheme, tint)
  }
  return null
}

/**
 * Named font weights, as `.fontWeight(.semibold)` and `Font.system(weight:)` take them.
 */
export const FONT_WEIGHTS: Readonly<Record<string, number>> = {
  ultraLight: 100,
  thin: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
  black: 900,
}

/**
 * Resolves an argument that should be a font.
 *
 * Two shapes: a text style token like `.largeTitle`, and the encoded form the host
 * produces for `Font.system(size:weight:design:)`. The second carries its arguments
 * in the token name because a contextual member has no type information to hang them
 * on - see `callImplicitMember` in the host.
 */
export function resolveFontArg(value: SwiftValue | undefined, scale: number | DynamicTypeSize = 1): ResolvedFont | null {
  if (!value || value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return null
  const name = (value.payload as TokenPayload).name

  // `.title.bold()`, `.body.weight(.semibold)`, `.caption.italic()` - a text style
  // with a face change on it. Encoded as the style's own name plus the changes rather
  // than resolved to a point size here, so the style keeps the line height Apple
  // designed for it: `.title` leads at 34, where 28 * 1.29 would round to 36.
  if (name.startsWith('style:')) {
    const [style, weight, design, italic] = name.slice('style:'.length).split(':')
    const base = fontForToken(style ?? 'body', scale)
    if (!base) return null
    return {
      ...base,
      family:
        design === 'rounded' ? ROUNDED_FAMILY : design === 'monospaced' ? MONO_FAMILY : design === 'serif' ? SERIF_FAMILY : base.family,
      weight: FONT_WEIGHTS[weight ?? ''] ?? base.weight,
      italic: italic === 'italic',
    }
  }

  if (name.startsWith('system:')) {
    const [, size, weight, design] = name.split(':')
    const points = Number(size) || 17
    return {
      family: design === 'rounded' ? ROUNDED_FAMILY : design === 'monospaced' ? MONO_FAMILY : design === 'serif' ? SERIF_FAMILY : UI_FONT_FAMILY,
      size: points,
      weight: FONT_WEIGHTS[weight ?? 'regular'] ?? 400,
      italic: false,
      lineHeight: Math.round(points * 1.29),
    }
  }

  return fontForToken(name, scale)
}

/** `.fontWeight(.bold)` and `.bold()` change weight without changing size. */
export function resolveWeightArg(value: SwiftValue | undefined): number | null {
  if (!value || value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return null
  return FONT_WEIGHTS[(value.payload as TokenPayload).name] ?? null
}

/** Numeric argument, accepting both `Int` and `Double`. */
export function numberArg(value: SwiftValue | undefined): number | null {
  if (!value) return null
  if (value.kind === 'int' || value.kind === 'double') return value.value
  return null
}

export function stringArg(value: SwiftValue | undefined): string | null {
  return value?.kind === 'string' ? value.value : null
}
