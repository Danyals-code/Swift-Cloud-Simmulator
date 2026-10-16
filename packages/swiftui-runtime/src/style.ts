import { dynamicTypeForScale, type DynamicTypeSize } from '@studio/shared'
import { glyphHeight } from '@studio/swiftui-layout'
import { scaledSize, typographyAt } from './appearance/typography'
import { parseFontToken, type FontSpec } from './font-token'
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
  type MeshPayload,
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

/**
 * UIKit's names for the SwiftUI colours: `Color(.systemRed)` is `Color.red`, as the
 * iOS 27 simulator draws them.
 */
const UIKIT_NAMES: Readonly<Record<string, string>> = {
  systemRed: 'red', systemOrange: 'orange', systemYellow: 'yellow', systemGreen: 'green',
  systemMint: 'mint', systemTeal: 'teal', systemCyan: 'cyan', systemBlue: 'blue',
  systemIndigo: 'indigo', systemPurple: 'purple', systemPink: 'pink', systemBrown: 'brown',
  systemGray: 'gray',
}

/**
 * The system ShapeStyles that are not colours by name, and the semantic colour iOS
 * draws each of their hierarchical levels with: `.fill.tertiary` is
 * `tertiarySystemFill`. `.background` has three levels, so the lower two repeat the
 * last. `.fill` drew black, and `.background.secondary` stopped the screen.
 */
const SYSTEM_STYLE_LEVELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  background: { primary: 'systemBackground', secondary: 'secondarySystemBackground', tertiary: 'tertiarySystemBackground', quaternary: 'tertiarySystemBackground', quinary: 'tertiarySystemBackground' },
  fill: { primary: 'systemFill', secondary: 'secondarySystemFill', tertiary: 'tertiarySystemFill', quaternary: 'quaternarySystemFill', quinary: 'quaternarySystemFill' },
  foreground: { primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', quaternary: 'quaternary', quinary: 'quinary' },
}

/** The colour name for one level of a system style, `.background.secondary`, or null for any other pair. */
export function systemStyleLevel(style: string, level: string): string | null {
  return SYSTEM_STYLE_LEVELS[style]?.[level] ?? null
}

export function colorForName(name: string, scheme: ColorScheme = 'light', tint?: RGBA): RGBA | null {
  if (tint && ['tint', 'accent', 'accentColor'].includes(name)) return tint
  const named = UIKIT_NAMES[name] ?? SYSTEM_STYLE_LEVELS[name]?.primary ?? name
  return (scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS)[named] ?? null
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

/** Whether the project's asset catalog has a colour set by this name. */
export function hasAssetColor(name: string): boolean {
  return assetColors.has(name)
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
    payload.adaptive
      ? (resolveColorArg(scheme === 'dark' ? payload.adaptive.dark : payload.adaptive.light, scheme, tint) ?? rgba(0, 0, 0, 0))
      : payload.mix
      ? mixColors(
          resolveColorArg(payload.mix.from, scheme, tint) ?? rgba(0, 0, 0, 0),
          resolveColorArg(payload.mix.with, scheme, tint) ?? rgba(0, 0, 0, 0),
          payload.mix.by,
        )
      : payload.name !== null && payload.asset
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
 * `Color.mix(with:by:)` in its default `.perceptual` colour space, taken here as
 * OKLab: mixing red and blue passes through a purple of even lightness rather than
 * the darker one an sRGB average gives.
 */
function mixColors(from: RGBA, to: RGBA, by: number): RGBA {
  if (by <= 0) return from
  if (by >= 1) return to
  const a = toOklab(from)
  const b = toOklab(to)
  const [r, g, blue] = fromOklab(a.map((value, i) => value + (b[i]! - value) * by) as [number, number, number])
  return rgba(r, g, blue, Math.round((from.a + (to.a - from.a) * by) * 1000) / 1000)
}

function toOklab(color: RGBA): [number, number, number] {
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [linear(color.r), linear(color.g), linear(color.b)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromOklab([lightness, a, b]: [number, number, number]): [number, number, number] {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const encode = (c: number) => Math.round(clamp01(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255)
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
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
  const shaded = shadingPaint(value)
  if (shaded) return resolveFillArg(shaded, scheme, tint)

  // An inner shadow is drawn inside the paint, so it travels with it; a drop shadow is
  // cast by the view the paint fills, which `paintShadow` gives the layout.
  const shadow = paintShadow(value, scheme, tint)
  if (shadow) {
    const plain = resolveFillArg({ ...value, payload: { ...(value.payload as ColorPayload), shadow: undefined } }, scheme, tint)
    const { kind, ...inner } = shadow
    return plain && kind === 'inner' ? { ...plain, innerShadow: inner } : plain
  }

  // `.fill(Gradient(colors: [.red, .blue]))`: a Gradient is a ShapeStyle too, drawn top to bottom.
  if (value.typeName === 'Gradient') {
    const stops = value.payload as GradientPayload['stops']
    return resolveFillArg({ kind: 'opaque', typeName: STYLE_TYPE, payload: { kind: 'linear', colors: [], ...(stops ? { stops } : {}), startPoint: 'top', endPoint: 'bottom' } satisfies GradientPayload }, scheme, tint)
  }

  if (value.typeName === STYLE_TYPE) {
    const gradient = value.payload as GradientPayload | MeshPayload
    if (gradient.kind === 'mesh') return meshFill(gradient, scheme, tint)
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

/**
 * A `MeshGradient` as a fill (Wave 6d), or null when its grid can't be read: a point or a
 * colour short, or one that isn't a number, which a preview mustn't guess at.
 */
function meshFill(mesh: MeshPayload, scheme: ColorScheme, tint: RGBA | undefined): Fill | null {
  const count = mesh.width * mesh.height
  const colors = mesh.colors.map(color => resolveColorArg(color, scheme, tint))
  if (mesh.width < 2 || mesh.height < 2 || mesh.points.length !== count || colors.length !== count) return null
  if (colors.some(color => !color) || mesh.points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null
  const opacity = mesh.opacity ?? 1
  return { kind: 'mesh', width: mesh.width, height: mesh.height, points: mesh.points, colors: colors.map(color => opacity === 1 ? color! : { ...color!, a: color!.a * opacity }), smooth: mesh.smooth }
}

/**
 * The shadow a ShapeStyle carries, `.blue.shadow(.drop(radius: 4))`, or null. SwiftUI's
 * default shadow colour is black at a third opacity.
 */
export function paintShadow(
  value: SwiftValue | undefined,
  scheme: ColorScheme = 'light',
  tint?: RGBA,
): { readonly kind: 'drop' | 'inner'; readonly color: RGBA; readonly radius: number; readonly x: number; readonly y: number } | null {
  if (!value || value.kind !== 'opaque' || (value.typeName !== COLOR_TYPE && value.typeName !== STYLE_TYPE)) return null
  const shadow = (value.payload as ColorPayload | GradientPayload).shadow
  if (!shadow) return null
  const color = (shadow.color ? resolveColorArg(shadow.color, scheme, tint) : null) ?? rgba(0, 0, 0, 0.33)
  return { kind: shadow.kind, color, radius: shadow.radius, x: shadow.x, y: shadow.y }
}

/**
 * What a `.stroke(_:)` or `.strokeBorder(_:)` paints with: a colour, or a gradient.
 * A gradient keeps its first stop as the colour too, for anything that reads a
 * stroke as one colour. Null when the argument is no paint, so the stroke takes the
 * foreground style as SwiftUI's does.
 */
export function resolveStrokePaint(
  value: SwiftValue | undefined,
  scheme: ColorScheme = 'light',
  tint?: RGBA,
): { readonly color: RGBA; readonly fill?: Fill } | null {
  const fill = resolveFillArg(value, scheme, tint)
  if (!fill) return null
  if (fill.kind === 'solid') return { color: fill.color }
  // A mesh strokes in its first colour: a canvas paints it only where it fills a view (Wave 6d).
  return fill.kind === 'mesh' ? { color: fill.colors[0]! } : { color: fill.stops[0]!.color, fill }
}

/**
 * The paint a Canvas shading wraps: `with: .color(.red)` and `with: .style(.tint)`.
 * They arrive as contextual calls the host has no type for, so as a token with the
 * paint as its argument.
 */
function shadingPaint(value: SwiftValue): SwiftValue | undefined {
  if (value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return undefined
  const { name, args } = value.payload as TokenPayload
  return (name === 'color' || name === 'style') && args?.length === 1 ? args[0] : undefined
}

/**
 * A Canvas shading's gradient moved into the unit space a fill is drawn in. Its points
 * are `CGPoint`s in the canvas's own coordinates, where a ShapeStyle's are unit points;
 * the radii stay in points, as a fill's do.
 */
export function canvasShading(value: SwiftValue | null, size: { readonly width: number; readonly height: number } | undefined): SwiftValue | undefined {
  if (!value || !size || value.kind !== 'opaque' || value.typeName !== STYLE_TYPE) return value ?? undefined
  const gradient = value.payload as GradientPayload
  const unit = (point: GradientPayload['startPoint'] | undefined) =>
    point !== null && typeof point === 'object' ? { x: point.x / (size.width || 1), y: point.y / (size.height || 1) } : point ?? null
  return { ...value, payload: { ...gradient, startPoint: unit(gradient.startPoint), endPoint: unit(gradient.endPoint), ...(gradient.center === undefined ? {} : { center: unit(gradient.center) }) } satisfies GradientPayload }
}

/** SwiftUI's named unit points, in the (0,0) top-leading space the render tree uses. */
export function unitPoint(name: string | { x: number; y: number }): { x: number; y: number } {
  if (typeof name !== 'string') return name
  const points: Readonly<Record<string, { x: number; y: number }>> = {
    zero: { x: 0, y: 0 },
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
  const shaded = shadingPaint(value)
  if (shaded) return resolveColorArg(shaded, scheme, tint)

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
 * A text style token like `.largeTitle`, or the encoded form the host produces for
 * `Font.system(size:weight:design:)`, `.custom(_:size:)` and a font changed by one of
 * its members (`FontSpec`). Those carry their arguments in the token name because a
 * contextual member has no type information to hang them on - see `callImplicitMember`
 * in the host.
 */
export function resolveFontArg(value: SwiftValue | undefined, scale: number | DynamicTypeSize = 1): ResolvedFont | null {
  if (!value || value.kind !== 'opaque' || value.typeName !== TOKEN_TYPE) return null
  const name = (value.payload as TokenPayload).name

  // `.title.bold()`, `.body.leading(.tight)`, `.system(size: 20)`: a font described in
  // the token's name (`FontSpec`). A text style is kept by name rather than resolved to
  // a point size there, so it keeps the leading Apple designed for it: `.title`'s lines
  // are 34 pt apart, a 28 pt system font's 33.67.
  const font = parseFontToken(name)
  if (!font) return null
  const base = font.style ? fontForToken(font.style, scale) : sizedFont(font, scale)
  if (!base) return null
  return {
    ...base,
    family: font.design === 'rounded' ? ROUNDED_FAMILY : font.design === 'monospaced' ? MONO_FAMILY : font.design === 'serif' ? SERIF_FAMILY : base.family,
    weight: FONT_WEIGHTS[font.weight] ?? font.faceWeight ?? base.weight,
    italic: font.italic,
    lineHeight: base.lineHeight + leadingChange(font),
    ...(font.smallCaps ? { smallCaps: true } : {}),
  }
}

/**
 * `.system(size:)`, which keeps its size at every Dynamic Type size, and
 * `.custom(_:size:relativeTo:)`, which grows with the text style it names as UIKit's
 * `UIFontMetrics` scales it.
 */
function sizedFont(font: FontSpec, scale: number | DynamicTypeSize): ResolvedFont {
  const given = font.size ?? 17
  const size = font.relativeTo ? scaledSize(font.relativeTo, typeof scale === 'number' ? dynamicTypeForScale(scale) : scale, given) : given
  const family = font.family ? familyStack(font.family) : UI_FONT_FAMILY
  return { family, size, weight: 400, italic: false, lineHeight: glyphHeight({ family, size }) }
}

const SERIF_FAMILIES = /Baskerville|Bodoni|Charter|Cochin|Didot|Georgia|Hoefler|Mincho|Palatino|STIX|Times|Rockwell|Academy|Copperplate|Papyrus|Serif/
const SCRIPT_FAMILIES = /Snell|Zapfino|Savoye|Bradley|Noteworthy|Marker|Chalk|Party/

/**
 * The CSS stack for a family iOS ships (Wave 6a): the family itself, which a Mac has and
 * draws as iOS does, then the nearest kind of face a browser has.
 */
function familyStack(family: string): string {
  return `"${family}", ${/Menlo|Courier/.test(family) ? MONO_FAMILY : SERIF_FAMILIES.test(family) ? 'Georgia, "Times New Roman", serif' : SCRIPT_FAMILIES.test(family) ? 'cursive' : UI_FONT_FAMILY}`
}

/**
 * `.leading(.tight)` and `.leading(.loose)`: two points closer or further apart, as the
 * iOS 27 simulator spaces every text style, except that `.subheadline` and `.footnote`
 * keep their own spacing when loose.
 */
function leadingChange(font: FontSpec): number {
  if (font.leading === 'tight') return -2
  if (font.leading === 'loose') return font.style === 'subheadline' || font.style === 'footnote' ? 0 : 2
  return 0
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
