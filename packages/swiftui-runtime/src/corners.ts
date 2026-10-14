import { CORNER_RADIUS_LABELS, type CornerRadii } from '@studio/shared'
import { opaque, type SwiftValue } from '@studio/swift-runtime'
import { numberArg } from './style'

/**
 * A rectangle's corners as the preview draws them: each with its own radius, from
 * `UnevenRoundedRectangle(…)`, `.rect(topLeadingRadius:…)` or `.rect(cornerRadii:)`.
 */

interface Argument {
  readonly label: string | null
  readonly value: SwiftValue
}

/** `RectangleCornerRadii`'s own labels: `topLeading`, not `topLeadingRadius`. */
export const CORNER_NAMES: readonly string[] = CORNER_RADIUS_LABELS.map((label) => label.replace(/Radius$/, ''))
const CORNER_RADII_TYPE = 'RectangleCornerRadii'

/** `RectangleCornerRadii(topLeading: 8, bottomTrailing: 8)`: the four radii, a corner left out being square. */
export function cornerRadii(args: readonly Argument[]): SwiftValue {
  return radiiValue(radiiFrom(CORNER_NAMES.map((name) => numberArg(args.find((a) => a.label === name)?.value) ?? 0)))
}

/** The `RectangleCornerRadii` value with these radii. */
export function radiiValue(radii: CornerRadii): SwiftValue {
  return opaque(CORNER_RADII_TYPE, radii)
}

/** A `RectangleCornerRadii` value, or null for anything else. */
export function asCornerRadii(value: SwiftValue | undefined): CornerRadii | null {
  return value?.kind === 'opaque' && value.typeName === CORNER_RADII_TYPE ? value.payload as CornerRadii : null
}

/** A rectangle's corner radii, written one by one or as `cornerRadii:`. */
export function cornerRadiiOf(args: readonly Argument[]): CornerRadii {
  return asCornerRadii(args.find((a) => a.label === 'cornerRadii')?.value)
    ?? radiiFrom(CORNER_RADIUS_LABELS.map((label) => numberArg(args.find((a) => a.label === label)?.value) ?? 0))
}

/** The four radii in `CORNER_RADIUS_LABELS` order, none below zero. */
function radiiFrom([topLeading = 0, bottomLeading = 0, bottomTrailing = 0, topTrailing = 0]: readonly number[]): CornerRadii {
  return { topLeading: Math.max(0, topLeading), bottomLeading: Math.max(0, bottomLeading), bottomTrailing: Math.max(0, bottomTrailing), topTrailing: Math.max(0, topTrailing) }
}
