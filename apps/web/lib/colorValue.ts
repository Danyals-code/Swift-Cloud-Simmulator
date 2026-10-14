import type { ColorValue, FillValue, SharedStyle } from '@studio/shared'

/**
 * The colour fields' arithmetic, kept apart from the fields so it can be tested on its
 * own: what a typed hex or name means, how an opacity reads as a percent, what a swatch
 * draws, how a token is named and referred to, and what a fill becomes when its kind
 * changes.
 *
 * A colour's alpha is its opacity. A typed `#RRGGBBAA` is taken as `#RRGGBB` and an
 * opacity, because that is how the Swift says it and how the opacity field shows it.
 */

/**
 * The system colours a token or a raw field can name, with their light sRGB value for
 * swatches: the iOS 27 simulator's, as the preview draws them (a test keeps the two equal).
 */
export const SYSTEM_COLOR_SWATCHES: Readonly<Record<string, string>> = {
  primary: '#000000', secondary: '#3C3C4399', black: '#000000', white: '#FFFFFF', gray: '#8E8E93', red: '#FF383C', orange: '#FF8D28',
  yellow: '#FFCC00', green: '#34C759', mint: '#00C8B3', teal: '#00C3D0', cyan: '#00C0E8', blue: '#0088FF', indigo: '#6155F5',
  purple: '#CB30E0', pink: '#FF2D55', brown: '#AC7F5E', clear: '#00000000', accentColor: '#0088FF', systemBackground: '#FFFFFF',
  secondarySystemBackground: '#F2F2F7', tertiarySystemBackground: '#FFFFFF', systemGroupedBackground: '#F2F2F7',
  secondarySystemGroupedBackground: '#FFFFFF', tertiarySystemGroupedBackground: '#F2F2F7',
  systemGray2: '#AEAEB2', systemGray3: '#C7C7CC', systemGray4: '#D1D1D6', systemGray5: '#E5E5EA', systemGray6: '#F2F2F7',
}

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

/** A hex colour as the colour fields take it: #RRGGBB, or #RRGGBBAA with its alpha. */
export function isHexColor(text: string): boolean {
  return HEX_COLOR.test(text)
}

/** The value for an `<input type="color">`, which has no alpha: the draft's colour, or `fallback`. */
export function pickerColor(draft: string, fallback: string): string {
  return isHexColor(draft) ? draft.slice(0, 7) : fallback
}

/** A colour chosen in the picker, keeping the alpha the draft already had. */
export function withPickedColor(draft: string, picked: string): string {
  return picked.toUpperCase() + (isHexColor(draft) ? draft.slice(7) : '')
}

type Stop = Extract<FillValue, { kind: 'gradient' }>['stops'][number]

/** A typed hex, `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`, uppercased and with its alpha kept; null for anything else. */
export function parseHex(text: string): string | null {
  const digits = text.trim().replace(/^#/, '').toUpperCase()
  if (!/^[0-9A-F]+$/.test(digits) || ![3, 4, 6, 8].includes(digits.length)) return null
  const full = digits.length <= 4 ? [...digits].map(digit => digit + digit).join('') : digits
  return '#' + (full.length === 8 && full.endsWith('FF') ? full.slice(0, 6) : full)
}

/** Three places, as the Swift is written. */
const rounded = (value: number) => Math.round(value * 1000) / 1000

/** The colours whose Swift names say what they are for rather than what they look like, in the panel's words. */
export const COLOR_NAME_LABELS: Readonly<Record<string, string>> = {
  primary: 'Primary text', secondary: 'Secondary text', clear: 'Transparent', accentColor: 'App accent',
  systemBackground: 'Screen background', secondarySystemBackground: 'Secondary background', tertiarySystemBackground: 'Tertiary background',
  systemGroupedBackground: 'Grouped screen background', secondarySystemGroupedBackground: 'Grouped card background', tertiarySystemGroupedBackground: 'Grouped inset background',
}

/** A system colour's name as the panel shows it: `Screen background`, `System Gray 6`. */
export function systemColorLabel(name: string): string {
  return COLOR_NAME_LABELS[name] ?? name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase()).replace(/ ([a-z])/g, (_, letter: string) => ' ' + letter.toUpperCase())
}

const squash = (text: string) => text.replace(/\s/g, '').toLowerCase()

/** What the colour field takes: a hex, its alpha as the opacity, or a system colour by name; null for anything else. */
export function colorFromText(text: string): ColorValue | null {
  const hex = parseHex(text)
  if (hex) {
    const alpha = hex.length === 9 ? rounded(parseInt(hex.slice(7), 16) / 255) : 1
    return { hex: hex.slice(0, 7), ...(alpha === 1 ? {} : { opacity: alpha }) }
  }
  const name = Object.keys(SYSTEM_COLOR_SWATCHES).find(known => squash(known) === squash(text) || squash(systemColorLabel(known)) === squash(text))
  return name ? { name } : null
}

/** A colour's opacity as the opacity field shows it, 0 to 100. */
export function opacityPercent(color: ColorValue): number {
  return Math.round((color.opacity ?? 1) * 1000) / 10
}

/** The colour at an opacity given as a percent, kept between 0 and 100; full opacity is no opacity. */
export function withOpacity(color: ColorValue, percent: number): ColorValue {
  const opacity = rounded(Math.min(100, Math.max(0, percent)) / 100)
  const { opacity: _, ...rest } = color
  return opacity === 1 ? rest as ColorValue : { ...rest, opacity } as ColorValue
}

/**
 * A colour picked in place of `current`, as Figma's colour fields take one: without an
 * opacity of its own, such as a swatch or a hex typed without its alpha, it keeps the one
 * `current` had.
 */
export function keepOpacity(picked: ColorValue, current: ColorValue): ColorValue {
  return picked.opacity === undefined && current.opacity !== undefined ? { ...picked, opacity: current.opacity } as ColorValue : picked
}

/** How a token is referred to wherever a colour goes: `Color.accent` builds as a view and as a ShapeStyle alike. */
export function tokenReference(style: SharedStyle): string {
  return style.form === 'token' ? `Color.${style.name}` : style.reference ?? style.name
}

/** The project's token a colour is, however its reference was written. */
export function tokenFor(color: ColorValue, tokens: readonly SharedStyle[]): SharedStyle | undefined {
  if (!('token' in color)) return undefined
  return tokens.find(style => style.kind === 'color' && [style.reference, style.name, tokenReference(style), `.${style.name}`].includes(color.token))
}

/** A colour's hex without opacity, for the swatch and the field: null for one the studio has no value for. */
export function colorHex(color: ColorValue, tokens: readonly SharedStyle[]): string | null {
  if ('hex' in color) return isHexColor(color.hex) ? color.hex.toUpperCase() : null
  if ('name' in color) return SYSTEM_COLOR_SWATCHES[color.name]?.toUpperCase() ?? null
  const style = tokenFor(color, tokens)
  const value = style?.light ?? style?.value
  if (value && isHexColor(value)) return value.toUpperCase()
  return value ? SYSTEM_COLOR_SWATCHES[value] ?? null : null
}

/** The CSS a swatch draws a colour with, its opacity included; a checkered nothing for one with no known value. */
export function swatchCss(color: ColorValue, tokens: readonly SharedStyle[]): string {
  const hex = colorHex(color, tokens)
  if (!hex) return 'transparent'
  const channel = (index: number) => parseInt(hex.slice(index, index + 2), 16)
  const alpha = rounded((hex.length === 9 ? channel(7) / 255 : 1) * (color.opacity ?? 1))
  return `rgba(${channel(1)}, ${channel(3)}, ${channel(5)}, ${alpha})`
}

/** A colour as the panel names it: its hex, a system colour's name, or a token's. */
export function colorLabel(color: ColorValue, tokens: readonly SharedStyle[]): string {
  if ('hex' in color) return color.hex.slice(0, 7).toUpperCase()
  if ('name' in color) return systemColorLabel(color.name)
  const style = tokenFor(color, tokens)
  if (style) return style.name
  const asset = /^Color\("(.*)"\)$/.exec(color.token)
  return asset ? asset[1]! : color.token.replace(/^(?:Color)?\./, '')
}

/** The colour a fill shows first: its colour, its first stop, or its tint. */
function firstColor(fill: FillValue | null): ColorValue | undefined {
  if (!fill) return undefined
  if (fill.kind === 'color') return fill.color
  if (fill.kind === 'gradient') return fill.stops[0]?.color
  return fill.kind === 'glass' ? fill.tint : undefined
}

/**
 * A fill of another kind, starting from what the layer had, as Figma does: a solid keeps
 * the first colour, and a new gradient fades that colour out from top to bottom.
 */
export function fillOfKind(kind: FillValue['kind'], fill: FillValue | null): FillValue {
  const color = firstColor(fill)
  if (kind === 'color') return { kind: 'color', color: color ?? { name: 'systemGray5' } }
  if (kind === 'material') return { kind: 'material', thickness: fill?.kind === 'material' ? fill.thickness : 'regular' }
  if (kind === 'glass') return { kind: 'glass', variant: 'regular' }
  const from = color ?? { name: 'systemGray5' }
  return { kind: 'gradient', type: 'linear', angle: 0, stops: [{ color: from, location: 0 }, { color: { ...from, opacity: 0 } as ColorValue, location: 1 }] }
}

/**
 * A new stop in the middle of the widest gap between two, in the colour of the stop before
 * it. A colour's own gradient, one stop, gets the second stop Figma starts a gradient
 * with: the same colour faded out.
 */
export function addStop(stops: readonly Stop[]): Stop[] {
  if (stops.length < 2) {
    const color = stops[0]?.color ?? { name: 'systemGray5' }
    return [{ color, location: 0 }, { color: { ...color, opacity: 0 } as ColorValue, location: 1 }]
  }
  const sorted = [...stops].sort((a, b) => a.location - b.location)
  let at = 0
  for (let index = 1; index < sorted.length - 1; index++) if (sorted[index + 1]!.location - sorted[index]!.location > sorted[at + 1]!.location - sorted[at]!.location) at = index
  const before = sorted[at]!, after = sorted[at + 1] ?? before
  const stop = { color: before.color, location: rounded((before.location + after.location) / 2) }
  return [...sorted.slice(0, at + 1), stop, ...sorted.slice(at + 1)]
}

/** The stops without one, keeping the two a gradient needs. */
export function removeStop(stops: readonly Stop[], index: number): Stop[] {
  return stops.length <= 2 ? [...stops] : stops.filter((_, at) => at !== index)
}

type Gradient = Extract<FillValue, { kind: 'gradient' }>
const CENTER = { x: 0.5, y: 0.5 }

/** The gradient as another type, its stops kept; one the designer sets has two or more. */
export function gradientOfType(fill: Gradient, type: Gradient['type']): Gradient {
  const stops = fill.automatic || fill.stops.length < 2 ? addStop(fill.stops) : fill.stops
  if (type === 'linear') return { kind: 'gradient', type, angle: fill.type === 'linear' ? fill.angle ?? 0 : 0, stops }
  const center = fill.center ?? CENTER
  if (type === 'angular') return { kind: 'gradient', type, stops, center }
  return { kind: 'gradient', type, stops, center, startRadius: fill.startRadius ?? 0, endRadius: fill.endRadius ?? 100 }
}

/** The CSS for a gradient's stops along a bar, left to right, as Figma's gradient bar shows them whatever the angle. */
export function stopTrack(fill: Gradient, tokens: readonly SharedStyle[]): string {
  return `linear-gradient(90deg, ${fill.stops.map(stop => `${swatchCss(stop.color, tokens)} ${Math.round(stop.location * 1000) / 10}%`).join(', ')})`
}

/** The system colours a Card's own fill takes by name; the others go as their hex. */
const CARD_NAMES = new Set(Object.keys(SYSTEM_COLOR_SWATCHES).filter(name => !/^systemGray\d$/.test(name)))

/**
 * A colour as a native Card takes it when it becomes an editable layer: a system colour's
 * name, or a hex with its opacity as the alpha. A token goes as its value, since the card
 * has no way to link one; null for a token the studio has no value for.
 */
export function cardColor(color: ColorValue, tokens: readonly SharedStyle[]): string | null {
  if ('name' in color && CARD_NAMES.has(color.name) && color.opacity === undefined) return color.name
  const hex = colorHex(color, tokens)
  if (!hex) return null
  const alpha = Math.round((hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1) * (color.opacity ?? 1) * 255)
  return hex.slice(0, 7) + (alpha === 255 ? '' : alpha.toString(16).padStart(2, '0').toUpperCase())
}
