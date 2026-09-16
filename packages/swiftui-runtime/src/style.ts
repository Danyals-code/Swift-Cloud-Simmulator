import {
  MONO_FAMILY,
  rgba,
  ROUNDED_FAMILY,
  UI_FONT_FAMILY,
  type Fill,
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

interface TextStyle {
  readonly size: number
  readonly lineHeight: number
  readonly weight: number
}

/** iOS text styles at the default (Large) Dynamic Type size. */
const TEXT_STYLES: Readonly<Record<string, TextStyle>> = {
  largeTitle: { size: 34, lineHeight: 41, weight: 400 },
  title: { size: 28, lineHeight: 34, weight: 400 },
  title2: { size: 22, lineHeight: 28, weight: 400 },
  title3: { size: 20, lineHeight: 25, weight: 400 },
  headline: { size: 17, lineHeight: 22, weight: 600 },
  body: { size: 17, lineHeight: 22, weight: 400 },
  callout: { size: 16, lineHeight: 21, weight: 400 },
  subheadline: { size: 15, lineHeight: 20, weight: 400 },
  footnote: { size: 13, lineHeight: 18, weight: 400 },
  caption: { size: 12, lineHeight: 16, weight: 400 },
  caption2: { size: 11, lineHeight: 13, weight: 400 },
}

export const BODY_FONT: ResolvedFont = {
  family: UI_FONT_FAMILY,
  size: TEXT_STYLES.body!.size,
  weight: TEXT_STYLES.body!.weight,
  italic: false,
  lineHeight: TEXT_STYLES.body!.lineHeight,
}

/** The font a `Button` label uses by default. */
export const BUTTON_FONT: ResolvedFont = { ...BODY_FONT }

/**
 * Resolves a text style, scaled for Dynamic Type.
 *
 * Line height scales with the size rather than being recomputed, which keeps the
 * ratio Apple designed for each style - a `.caption` at 200% must not end up with
 * body-text leading.
 */
export function fontForToken(name: string, scale = 1): ResolvedFont | null {
  const style = TEXT_STYLES[name]
  if (!style) return null
  return {
    family: UI_FONT_FAMILY,
    size: style.size * scale,
    weight: style.weight,
    italic: false,
    lineHeight: style.lineHeight * scale,
  }
}

/** The monospaced body face, as `.monospaced()` selects. */
export function monospacedFont(scale = 1): ResolvedFont {
  return { ...bodyFont(scale), family: MONO_FAMILY }
}

/** The body font at a given Dynamic Type scale - the root environment's font. */
export function bodyFont(scale = 1): ResolvedFont {
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
const LIGHT_COLORS: Readonly<Record<string, RGBA>> = {
  red: rgba(255, 59, 48),
  orange: rgba(255, 149, 0),
  yellow: rgba(255, 204, 0),
  green: rgba(52, 199, 89),
  mint: rgba(0, 199, 190),
  teal: rgba(48, 176, 199),
  cyan: rgba(50, 173, 230),
  blue: rgba(0, 122, 255),
  indigo: rgba(88, 86, 214),
  purple: rgba(175, 82, 222),
  pink: rgba(255, 45, 85),
  brown: rgba(162, 132, 94),
  gray: rgba(142, 142, 147),
  black: rgba(0, 0, 0),
  white: rgba(255, 255, 255),
  clear: rgba(0, 0, 0, 0),
  /**
   * Opaque, which is what `UIColor.label` is in both appearances.
   *
   * This was 85% black, and the 15% was on every string in every preview at once:
   * every title, every row, every button, every navigation bar. Nothing looked
   * broken and nothing looked like iOS either, and a washed-out screenshot is the
   * hardest kind of wrong to find, because there is no single view to point at.
   *
   * The *secondary* levels really are translucent, and they stay so - that is how
   * they keep working over a coloured background.
   */
  primary: rgba(0, 0, 0),
  secondary: rgba(60, 60, 67, 0.6),
  accentColor: rgba(0, 122, 255),
  accent: rgba(0, 122, 255),
  /**
   * `.tint` as a *style*: `Text("New").foregroundStyle(.tint)`.
   *
   * The accent colour, which is what the tint is until something changes it. There is
   * no tint in the environment to read - `.tint(.pink)` is applied where it is written
   * and does not flow down - so a `.tint` style below a custom one resolves to the
   * default rather than to that colour. Named here rather than special-cased, so the
   * token behaves like every other colour name, `.tint.opacity(0.5)` included.
   */
  tint: rgba(0, 122, 255),

  // Semantic colours. These adapt, which is the entire reason for two tables -
  // `Color(white: 0.95)` does not adapt, and a preview that treats them alike would
  // hide the most common dark-mode mistake there is.
  label: rgba(0, 0, 0),
  secondaryLabel: rgba(60, 60, 67, 0.6),
  tertiaryLabel: rgba(60, 60, 67, 0.3),
  separator: rgba(60, 60, 67, 0.29),
  systemBackground: rgba(255, 255, 255),
  secondarySystemBackground: rgba(242, 242, 247),
  tertiarySystemBackground: rgba(255, 255, 255),
  systemGroupedBackground: rgba(242, 242, 247),
  secondarySystemGroupedBackground: rgba(255, 255, 255),
  systemFill: rgba(120, 120, 128, 0.2),
  secondarySystemFill: rgba(120, 120, 128, 0.16),
  // The two lighter fills. A search field and a segmented track are both
  // `tertiarySystemFill` on iOS and were both drawn at `systemFill` here, which is
  // nearly twice as dark - the difference between a control resting on a surface and
  // one cut into it.
  tertiarySystemFill: rgba(118, 118, 128, 0.12),
  quaternarySystemFill: rgba(116, 116, 128, 0.08),
}

const DARK_COLORS: Readonly<Record<string, RGBA>> = {
  ...LIGHT_COLORS,
  red: rgba(255, 69, 58),
  orange: rgba(255, 159, 10),
  yellow: rgba(255, 214, 10),
  green: rgba(48, 209, 88),
  mint: rgba(99, 230, 226),
  teal: rgba(64, 200, 224),
  cyan: rgba(100, 210, 255),
  blue: rgba(10, 132, 255),
  indigo: rgba(94, 92, 230),
  purple: rgba(191, 90, 242),
  pink: rgba(255, 55, 95),
  brown: rgba(172, 142, 104),
  primary: rgba(255, 255, 255),
  secondary: rgba(235, 235, 245, 0.6),
  accentColor: rgba(10, 132, 255),
  accent: rgba(10, 132, 255),
  tint: rgba(10, 132, 255),

  label: rgba(255, 255, 255),
  secondaryLabel: rgba(235, 235, 245, 0.6),
  tertiaryLabel: rgba(235, 235, 245, 0.3),
  separator: rgba(84, 84, 88, 0.6),
  systemBackground: rgba(0, 0, 0),
  secondarySystemBackground: rgba(28, 28, 30),
  tertiarySystemBackground: rgba(44, 44, 46),
  systemGroupedBackground: rgba(0, 0, 0),
  secondarySystemGroupedBackground: rgba(28, 28, 30),
  systemFill: rgba(120, 120, 128, 0.36),
  secondarySystemFill: rgba(120, 120, 128, 0.32),
  tertiarySystemFill: rgba(118, 118, 128, 0.24),
  quaternarySystemFill: rgba(116, 116, 128, 0.18),
}

export function labelColor(scheme: ColorScheme): RGBA {
  return (scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS).primary!
}

export function systemBackground(scheme: ColorScheme): RGBA {
  return scheme === 'dark' ? rgba(0, 0, 0) : rgba(255, 255, 255)
}

export const LABEL_COLOR = labelColor('light')
export const SYSTEM_BACKGROUND = systemBackground('light')
export const ACCENT_COLOR = LIGHT_COLORS.accentColor!

export function colorForName(name: string, scheme: ColorScheme = 'light'): RGBA | null {
  return (scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS)[name] ?? null
}

/** Turns a `Color` payload - named, or built from components - into an RGBA. */
export function resolveColorPayload(payload: ColorPayload, scheme: ColorScheme = 'light'): RGBA {
  const base =
    payload.name !== null
      ? (colorForName(payload.name, scheme) ?? rgba(0, 0, 0, 0))
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
): Fill | null {
  if (!value || value.kind !== 'opaque') return null

  if (value.typeName === STYLE_TYPE) {
    const gradient = value.payload as GradientPayload
    const colors = gradient.colors
      .map((c) => resolveColorArg(c, scheme))
      .filter((c): c is RGBA => c !== null)
    if (colors.length === 0) return null

    const stops = colors.map((color, index) => ({
      color,
      location: colors.length === 1 ? 0 : index / (colors.length - 1),
    }))
    return {
      kind: 'linearGradient',
      stops,
      start: unitPoint(gradient.startPoint ?? 'top'),
      end: unitPoint(gradient.endPoint ?? 'bottom'),
    }
  }

  const color = resolveColorArg(value, scheme)
  return color ? { kind: 'solid', color } : null
}

/** SwiftUI's named unit points, in the (0,0) top-leading space the render tree uses. */
export function unitPoint(name: string): { x: number; y: number } {
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
): RGBA | null {
  if (!value || value.kind !== 'opaque') return null

  if (value.typeName === COLOR_TYPE) {
    return resolveColorPayload(value.payload as ColorPayload, scheme)
  }
  if (value.typeName === TOKEN_TYPE) {
    return colorForName((value.payload as TokenPayload).name, scheme)
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
export function resolveFontArg(value: SwiftValue | undefined, scale = 1): ResolvedFont | null {
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
        design === 'rounded' ? ROUNDED_FAMILY : design === 'monospaced' ? MONO_FAMILY : base.family,
      weight: FONT_WEIGHTS[weight ?? ''] ?? base.weight,
      italic: italic === 'italic',
    }
  }

  if (name.startsWith('system:')) {
    const [, size, weight, design] = name.split(':')
    const points = Number(size) || 17
    return {
      family: design === 'rounded' ? ROUNDED_FAMILY : design === 'monospaced' ? MONO_FAMILY : UI_FONT_FAMILY,
      size: points * scale,
      weight: FONT_WEIGHTS[weight ?? 'regular'] ?? 400,
      italic: false,
      lineHeight: Math.round(points * 1.29) * scale,
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
