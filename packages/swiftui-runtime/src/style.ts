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

export function fontForToken(name: string): ResolvedFont | null {
  const style = TEXT_STYLES[name]
  if (!style) return null
  return {
    family: UI_FONT_FAMILY,
    size: style.size,
    weight: style.weight,
    italic: false,
    lineHeight: style.lineHeight,
  }
}

/**
 * iOS system colours, light appearance.
 *
 * `primary` and `secondary` are the semantic label colours rather than pure black —
 * SwiftUI's default text is 85% black, and using pure black makes every preview look
 * subtly harsher than the real thing.
 */
const SYSTEM_COLORS: Readonly<Record<string, RGBA>> = {
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
}

export const LABEL_COLOR = SYSTEM_COLORS.primary!
export const ACCENT_COLOR = SYSTEM_COLORS.accentColor!
export const SYSTEM_BACKGROUND = rgba(255, 255, 255)

export function colorForName(name: string): RGBA | null {
  return SYSTEM_COLORS[name] ?? null
}

/** Turns a `Color` payload — named, or built from components — into an RGBA. */
export function resolveColorPayload(payload: ColorPayload): RGBA {
  const base =
    payload.name !== null
      ? (colorForName(payload.name) ?? rgba(0, 0, 0, 0))
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
export function resolveColorArg(value: SwiftValue | undefined): RGBA | null {
  if (!value || value.kind !== 'opaque') return null

  if (value.typeName === COLOR_TYPE) return resolveColorPayload(value.payload as ColorPayload)
  if (value.typeName === TOKEN_TYPE) return colorForName((value.payload as TokenPayload).name)
  return null
}

/** Resolves an argument that should be a font: a token like `.largeTitle`. */
export function resolveFontArg(value: SwiftValue | undefined): ResolvedFont | null {
  if (!value || value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return null
  return fontForToken((value.payload as TokenPayload).name)
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
