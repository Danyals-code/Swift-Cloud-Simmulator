/**
 * A number field's arithmetic, as Figma's fields work: drag the label to scrub, one step a
 * pixel and ten with Shift; ArrowUp and ArrowDown nudge by the same steps; a unit may be
 * typed or left off. Kept apart from the field so the sums are tested on their own.
 */

export interface NumberLimits {
  readonly min?: number
  readonly max?: number
  /** Whole numbers only, such as a line count. */
  readonly integer?: boolean
}

export interface StepOptions extends NumberLimits {
  /** How much one pixel or one arrow press adds: 1 unless the field says otherwise. */
  readonly step?: number
  /** Shift is held: ten steps at a time. */
  readonly fast?: boolean
}

/**
 * A value kept to the field's limits: whole when the field takes whole numbers, and to
 * hundredths otherwise, so a sum such as 0.1 + 0.2 never shows its float noise.
 */
export function clampNumber(value: number, limits: NumberLimits = {}): number {
  const rounded = limits.integer ? Math.round(value) : Math.round(value * 100) / 100
  const clamped = Math.min(limits.max ?? Infinity, Math.max(limits.min ?? -Infinity, rounded))
  return clamped === 0 ? 0 : clamped
}

/** The value a drag of `pixels` along the label makes of `start`. */
export function scrubbedValue(start: number, pixels: number, options: StepOptions = {}): number {
  return clampNumber(start + Math.round(pixels) * (options.step ?? 1) * (options.fast ? 10 : 1), options)
}

/** The value one arrow press makes: `direction` 1 for ArrowUp, -1 for ArrowDown. */
export function steppedValue(value: number, direction: 1 | -1, options: StepOptions = {}): number {
  return clampNumber(value + direction * (options.step ?? 1) * (options.fast ? 10 : 1), options)
}

/** What a typed value means: a decimal number, with or without a `pt` or `%` after it; null for anything else. */
export function parseNumber(text: string): number | null {
  const match = /^\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:pt|%)?\s*$/.exec(text)
  return match ? Number(match[1]) : null
}

/** A number as a field shows it: to hundredths, with no trailing zeros. */
export function formatNumber(value: number): string {
  return String(clampNumber(value))
}
