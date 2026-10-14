import type { ColorValue, LayerValue } from '@studio/shared'
import type { CallExpr, Expr } from '@studio/swift-syntax'
import { SWIFTUI_COLOR_NAMES as SWIFTUI, UIKIT_SEMANTIC_COLOR_NAMES as UIKIT } from '../builtins'
import type { LayerContext } from './context'
import { amount, isToken, numberOf, sourceOf } from './values'

/**
 * Colour, as every section that takes one reads and writes it: Fill, Stroke, Text and
 * the glass tint.
 *
 * A colour reads as a system name, a hex, or a token kept exactly as written, with its
 * opacity, however the code spells it: `.red`, `Color.red` and `Color(.systemGray6)`;
 * `Color(red:green:blue:opacity:)`; `Theme.accent`, `.brand` and `Color("Brand")`. It is
 * written back in the plainest spelling the place it goes takes.
 */

/**
 * Where a colour is written. A `ShapeStyle` is what `.background`, `.fill` and
 * `.foregroundStyle` take from iOS 15, where `.red` and `.secondary` name themselves; a
 * `Color` is a value that has to be one, such as a gradient's colours or a view below
 * iOS 15, where only `Color.red` says which type it is.
 */
export type ColorSlot = 'ShapeStyle' | 'Color'

/** Styles that shade with the content's level rather than being one colour: ShapeStyle only. */
export const HIERARCHICAL: ReadonlySet<string> = new Set(['tertiary', 'quaternary', 'quinary'])
/** ShapeStyles that are not one colour, which the panel shows but leaves to Code. */
const NOT_COLORS: ReadonlySet<string> = new Set(['tint', 'background', 'foreground', 'selection', 'separator', 'placeholder', 'link', 'fill', 'windowBackground'])
/** Names newer than iOS 13, with the version that has them. */
const NEWER: Readonly<Record<string, number>> = { mint: 15, teal: 15, cyan: 15, indigo: 15, brown: 15, tertiary: 15, quaternary: 15, quinary: 16 }

const COMPUTED = 'This color is worked out in Swift. Change it in Code.'

/** An identifier or a chain of members on one: `Theme.accent`, `Color.brand`, `.brand`. */
function plainName(value: Expr): boolean {
  if (value.kind === 'identifier') return true
  return value.kind === 'memberAccess' && (!value.base || plainName(value.base))
}

const isColorType = (value: Expr | null): boolean => value?.kind === 'identifier' && value.name === 'Color'
  || value?.kind === 'memberAccess' && value.member === 'Color' && value.base?.kind === 'identifier' && value.base.name === 'SwiftUI'

const channel = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0').toUpperCase()

/** `Color(red:green:blue:)`, `Color(.sRGB, red:…)` and `Color(white:)` with literal amounts, as a hex and its opacity. */
function rgbOf(call: CallExpr, ctx: LayerContext): ColorValue | undefined {
  const args = call.args.filter((arg, index) => !(index === 0 && arg.label === null && sourceOf(ctx, arg.value).replace(/\s/g, '') === '.sRGB'))
  const labels = args.map(arg => arg.label).join()
  const amounts = args.map(arg => numberOf(arg.value, ctx, false))
  if (amounts.some(amount => amount === undefined || amount > 1)) return undefined
  const [first, second, third, fourth] = amounts as number[]
  const opacity = (value: number | undefined) => value === undefined || value === 1 ? {} : { opacity: value }
  if (labels === 'red,green,blue' || labels === 'red,green,blue,opacity') return { hex: `#${channel(first!)}${channel(second!)}${channel(third!)}`, ...opacity(fourth) }
  if (labels === 'white' || labels === 'white,opacity') return { hex: `#${channel(first!).repeat(3)}`, ...opacity(second) }
  return undefined
}

/** A colour and whether it is a token, or undefined for one worked out in Swift. */
function colorOf(value: Expr, ctx: LayerContext): { color: ColorValue; token: boolean } | undefined {
  const written = sourceOf(ctx, value)
  if (value.kind === 'call' && !value.trailingClosure && value.callee.kind === 'memberAccess' && value.callee.member === 'opacity' && value.callee.base) {
    const inner = colorOf(value.callee.base, ctx)
    const amount = value.args.length === 1 && value.args[0]!.label === null ? numberOf(value.args[0]!.value, ctx, false) : undefined
    // A colour that has an opacity of its own and another on top is two numbers the panel would show as one.
    if (!inner || amount === undefined || inner.color.opacity !== undefined) return undefined
    return { color: { ...inner.color, opacity: amount }, token: inner.token }
  }
  if (value.kind === 'memberAccess' && (!value.base || isColorType(value.base))) {
    const name = value.member
    if (SWIFTUI.has(name) || !value.base && HIERARCHICAL.has(name)) return { color: { name }, token: false }
    if (!value.base && NOT_COLORS.has(name) || /Material$|^gradient$/.test(name)) return undefined
    return { color: { token: written }, token: true }
  }
  if (plainName(value)) {
    // A value the view is given, or works out, is data: only a constant stays linked as a token.
    const property = ctx.node.properties.find(p => p.source?.start === value.span.start && p.source.end === value.span.end)
    if (property && ['data-binding', 'component-argument', 'computed', 'unsupported'].includes(property.valueKind)) return undefined
    return { color: { token: written }, token: true }
  }
  if (value.kind === 'call' && !value.trailingClosure && isColorType(value.callee)) {
    const [first] = value.args
    if (value.args.length === 1 && first!.label === null && first!.value.kind === 'stringLiteral' && first!.value.segments.every(segment => segment.kind === 'text') && !written.includes('\\')) return { color: { token: written }, token: true }
    const uikit = value.args.length === 1 && (first!.label === null || first!.label === 'uiColor') ? first!.value : undefined
    if (uikit?.kind === 'memberAccess' && UIKIT.has(uikit.member) && (!uikit.base || uikit.base.kind === 'identifier' && uikit.base.name === 'UIColor')) return { color: { name: uikit.member }, token: false }
    const rgb = rgbOf(value, ctx)
    return rgb && { color: rgb, token: false }
  }
  return undefined
}

/**
 * A colour as the panel shows it. One worked out in Swift is `'code'`, with its
 * expression as written for the panel to show.
 */
export function readColor(value: Expr, ctx: LayerContext): LayerValue<ColorValue> {
  const read = colorOf(value, ctx)
  if (!read) return { value: { token: sourceOf(ctx, value) }, state: 'code', disabledReason: COMPUTED }
  return { value: read.color, state: read.token ? 'token' : 'literal' }
}

const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

/** A hex as its channels and alpha, each 0 to 1; undefined for one that is not `#RRGGBB` or `#RRGGBBAA`. */
export function hexChannels(hex: string): { red: number; green: number; blue: number; alpha: number } | undefined {
  if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(hex)) return undefined
  const at = (index: number) => parseInt(hex.slice(index, index + 2), 16) / 255
  return { red: at(1), green: at(3), blue: at(5), alpha: hex.length === 9 ? at(7) : 1 }
}

/**
 * The plainest Swift for a colour in `slot`, for the project's iOS version. Throws the
 * reason, in the panel's words, when the colour cannot go there.
 */
export function colorSource(value: ColorValue, slot: ColorSlot, ctx: Pick<LayerContext, 'target'>): string {
  const opacity = value.opacity ?? 1
  if (!(opacity >= 0 && opacity <= 1)) throw new Error('Opacity is between 0 and 100%.')
  // `.red` names `Color.red` where a ShapeStyle is taken, which views do from iOS 15.
  const short = slot === 'ShapeStyle' && ctx.target >= 15
  let base: string
  if ('hex' in value) {
    const channels = hexChannels(value.hex)
    if (!channels) throw new Error('Use a hex color such as #0A84FF or #0A84FF80.')
    const alpha = amount(channels.alpha * opacity)
    return `Color(red: ${amount(channels.red)}, green: ${amount(channels.green)}, blue: ${amount(channels.blue)}${alpha === '1' ? '' : `, opacity: ${alpha}`})`
  } else if ('name' in value) {
    const name = value.name, newer = NEWER[name]
    if (newer && ctx.target < newer) throw new Error(`${capitalized(name)} needs iOS ${newer}. Choose another color, or raise the deployment target.`)
    if (UIKIT.has(name)) base = `Color(.${name})`
    else if (HIERARCHICAL.has(name)) {
      if (!short) throw new Error(`${capitalized(name)} is a style that shades with the content, not a color, so it can’t go here. Choose a color.`)
      base = `.${name}`
    } else if (SWIFTUI.has(name)) base = short && name !== 'accentColor' ? `.${name}` : `Color.${name}`
    else throw new Error(`${name} isn’t a color the studio knows. Choose another one.`)
  } else {
    const token = value.token.trim()
    if (!isToken(token) && !/^Color\("[^"\\]*"\)$/.test(token)) throw new Error('This token can’t be written here. Choose it from the list.')
    base = token.startsWith('.') && !short ? `Color${token}` : token
  }
  return opacity === 1 ? base : `${base}.opacity(${amount(opacity)})`
}

/**
 * A colour as Swift in `slot`, in the spelling it was `written` in when it is still the
 * colour it was `before`: a token, or `Color.gray.opacity(0.3)`, stays as written.
 */
export function keptColor(next: ColorValue, before: ColorValue | undefined, written: string | undefined, slot: ColorSlot, ctx: Pick<LayerContext, 'target'>): string {
  return before && written !== undefined && sameColor(before, next) ? written : colorSource(next, slot, ctx)
}

/** A hex with its alpha and opacity taken together, `#RRGGBB` and an amount, so two spellings of one colour compare equal. */
function hexKey(value: { hex: string; opacity?: number }): string {
  const channels = hexChannels(value.hex)
  return channels ? `${value.hex.slice(0, 7).toUpperCase()}@${amount(channels.alpha * (value.opacity ?? 1))}` : value.hex
}

/** Whether two colours are the same colour at the same opacity, however the hex was spelled. */
export function sameColor(a: ColorValue, b: ColorValue): boolean {
  if ('hex' in a || 'hex' in b) return 'hex' in a && 'hex' in b && hexKey(a) === hexKey(b)
  const opacity = (a.opacity ?? 1) === (b.opacity ?? 1)
  if ('name' in a) return 'name' in b && a.name === b.name && opacity
  return 'token' in b && a.token === b.token && opacity
}
