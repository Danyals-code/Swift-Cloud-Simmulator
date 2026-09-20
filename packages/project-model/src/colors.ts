/**
 * Colour sets: the asset-catalog half of a colour token.
 *
 * A colour token is two things - a Swift member, `static let accent = Color("accent")`,
 * and a colour set in `Assets.xcassets` that holds its light and dark values. Keeping
 * the values in the catalog is the standard Xcode arrangement: it needs no UIKit, it
 * is what a developer expects to find, and dark mode is the catalog's job.
 */
export interface ColorAsset {
  /** The colour set's name, which is also the Swift member that reads it. */
  readonly name: string
  /** `#RRGGBB` or `#RRGGBBAA`, sRGB. */
  readonly light: string
  /** The dark appearance. Absent means the light value is used in both. */
  readonly dark?: string
}

export const COLOR_LIMITS = { count: 256 } as const

const HEX = /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
/** Names Xcode's own templates already give a colour set. */
const RESERVED = new Set(['AccentColor'])

/** Upper-case `#RRGGBB`, with alpha only when it is not opaque. */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim().replace(/^#?/, '#').toUpperCase()
  if (/^#[0-9A-F]{3}$/.test(trimmed)) return '#' + [...trimmed.slice(1)].map(c => c + c).join('')
  if (!HEX.test(trimmed)) return null
  return trimmed.length === 9 && trimmed.endsWith('FF') ? trimmed.slice(0, 7) : trimmed
}

export function validColorName(name: string): boolean {
  return NAME.test(name) && !RESERVED.has(name)
}

export function validateColors(colors: readonly ColorAsset[]): void {
  if (!Array.isArray(colors) || colors.length > COLOR_LIMITS.count) throw new Error(`A project can contain up to ${COLOR_LIMITS.count} colour sets.`)
  const names = new Set<string>()
  for (const color of colors) {
    if (!color || typeof color.name !== 'string' || !validColorName(color.name) || names.has(color.name.toLowerCase())) throw new Error('Colour set names must be unique Swift names.')
    names.add(color.name.toLowerCase())
    if (typeof color.light !== 'string' || normalizeHex(color.light) !== color.light || color.dark !== undefined && (typeof color.dark !== 'string' || normalizeHex(color.dark) !== color.dark)) throw new Error(`Colour set ${color.name} needs hex values such as #0A84FF.`)
  }
}

const CATALOG_INFO = { author: 'xcode', version: 1 }

function components(hex: string) {
  const channel = (at: number) => `0x${hex.slice(at, at + 2)}`
  const alpha = hex.length === 9 ? (parseInt(hex.slice(7, 9), 16) / 255).toFixed(3) : '1.000'
  return { color: { 'color-space': 'srgb', components: { alpha, blue: channel(5), green: channel(3), red: channel(1) } }, idiom: 'universal' }
}

/** The `Contents.json` Xcode writes for a colour set with an optional dark appearance. */
export function colorSetContents(color: ColorAsset): string {
  const colors: unknown[] = [components(color.light)]
  if (color.dark) colors.push({ appearances: [{ appearance: 'luminosity', value: 'dark' }], ...components(color.dark) })
  return JSON.stringify({ colors, info: CATALOG_INFO }, null, 2)
}

/** A component as Xcode writes it: `0xFF`, `255`, or `1.000`. */
function channelOf(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim()
  if (/^0x[0-9a-f]{1,2}$/i.test(text)) return parseInt(text.slice(2), 16)
  const number = Number(text)
  if (!Number.isFinite(number) || number < 0) return null
  return text.includes('.') || number <= 1 && text !== '1' && text !== '0' ? Math.round(Math.min(1, number) * 255) : Math.min(255, Math.round(number))
}

function hexOf(entry: unknown): string | null {
  const color = (entry as { color?: { components?: Record<string, unknown>; 'color-space'?: string } } | null)?.color
  const parts = color?.components
  if (!parts || color['color-space'] && !['srgb', 'extended-srgb', 'display-p3'].includes(color['color-space'])) return null
  const [red, green, blue] = [parts.red, parts.green, parts.blue].map(channelOf)
  if (red === null || green === null || blue === null || red === undefined || green === undefined || blue === undefined) return null
  const alphaText = parts.alpha === undefined ? '1' : String(parts.alpha)
  const alpha = Number(alphaText)
  const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
  const base = `#${hex(red)}${hex(green)}${hex(blue)}`
  return Number.isFinite(alpha) && alpha < 1 ? base + hex(Math.round(Math.max(0, alpha) * 255)) : base
}

/**
 * Reads a colour set Xcode (or this studio) wrote. Only the universal sRGB form with
 * an optional dark appearance is accepted; anything richer - high contrast, per-device
 * values, system colour references - is refused rather than flattened, so a round trip
 * never silently loses what a developer set up.
 */
export function readColorSet(name: string, contents: string): ColorAsset {
  const value: unknown = JSON.parse(contents)
  const entries = (value as { colors?: unknown } | null)?.colors
  if (!Array.isArray(entries)) throw new Error(`Invalid colour set: ${name}`)
  let light: string | null = null, dark: string | null = null
  for (const entry of entries) {
    const appearances = (entry as { appearances?: unknown }).appearances
    const idiom = (entry as { idiom?: unknown }).idiom
    if (idiom !== undefined && idiom !== 'universal') throw new Error(`Colour set ${name} has per-device values. Keep one universal value per appearance.`)
    const hex = hexOf(entry)
    if (appearances === undefined || Array.isArray(appearances) && !appearances.length) {
      if (!hex) {
        // Xcode's empty AccentColor: no value means "system default", nothing to import.
        if ((entry as { color?: unknown }).color === undefined) continue
        throw new Error(`Colour set ${name} uses an unsupported colour form.`)
      }
      light = hex
    } else if (Array.isArray(appearances) && appearances.length === 1 && (appearances[0] as { appearance?: unknown; value?: unknown }).appearance === 'luminosity') {
      const mode = (appearances[0] as { value?: unknown }).value
      if (mode === 'light') { if (hex) light ??= hex; continue }
      if (mode !== 'dark' || !hex) throw new Error(`Colour set ${name} uses an unsupported appearance.`)
      dark = hex
    } else throw new Error(`Colour set ${name} uses an unsupported appearance.`)
  }
  if (!light) throw new Error(`Colour set ${name} has no default value.`)
  return { name, light, ...(dark && dark !== light ? { dark } : {}) }
}
