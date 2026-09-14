import { rgba, type ResolvedFont, type RGBA } from '@studio/shared'
import type { SwiftValue } from '@studio/swift-runtime'
import { COLOR_TYPE, TOKEN_TYPE, type ColorPayload, type TokenPayload } from './view-value'

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

export const UI_FONT_FAMILY =
  '"Inter", -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif'

export const ROUNDED_FAMILY = '"Inter", ui-rounded, system-ui, sans-serif'
export const MONO_FAMILY = 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace'

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
 * ratio Apple designed for each style — a `.caption` at 200% must not end up with
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

/** The body font at a given Dynamic Type scale — the root environment's font. */
export function bodyFont(scale = 1): ResolvedFont {
  return fontForToken('body', scale)!
}

export type ColorScheme = 'light' | 'dark'

/**
 * iOS system colours, both appearances.
 *
 * Dark mode is not "the light palette inverted" — Apple brightens and desaturates
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
  primary: rgba(0, 0, 0, 0.85),
  secondary: rgba(60, 60, 67, 0.6),
  accentColor: rgba(0, 122, 255),
  accent: rgba(0, 122, 255),

  // Semantic colours. These adapt, which is the entire reason for two tables —
  // `Color(white: 0.95)` does not adapt, and a preview that treats them alike would
  // hide the most common dark-mode mistake there is.
  label: rgba(0, 0, 0, 0.85),
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
  primary: rgba(255, 255, 255, 0.9),
  secondary: rgba(235, 235, 245, 0.6),
  accentColor: rgba(10, 132, 255),
  accent: rgba(10, 132, 255),

  label: rgba(255, 255, 255, 0.9),
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

/** Turns a `Color` payload — named, or built from components — into an RGBA. */
export function resolveColorPayload(payload: ColorPayload, scheme: ColorScheme = 'light'): RGBA {
  const base =
    payload.name !== null
      ? (colorForName(payload.name, scheme) ?? rgba(0, 0, 0, 0))
      : grayscale(payload.white ?? 0)

  return payload.opacity === undefined ? base : { ...base, a: base.a * payload.opacity }
}

function grayscale(white: number): RGBA {
  const channel = Math.round(Math.max(0, Math.min(1, white)) * 255)
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

/** Resolves an argument that should be a font: a token like `.largeTitle`. */
export function resolveFontArg(value: SwiftValue | undefined, scale = 1): ResolvedFont | null {
  if (!value || value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return null
  return fontForToken((value.payload as TokenPayload).name, scale)
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
