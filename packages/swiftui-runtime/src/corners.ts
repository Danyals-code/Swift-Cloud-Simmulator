import { CORNER_RADIUS_LABELS } from '@studio/shared'
import { opaque, type SwiftValue } from '@studio/swift-runtime'
import { numberArg } from './style'

/**
 * A rectangle's corners as the preview draws them: one radius on every corner, the
 * largest of those written (D7a). `UnevenRoundedRectangle`, `.rect(topLeadingRadius:…)`
 * and `.rect(cornerRadii:)` all come here, and the checker says so where they are written.
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
  return opaque(CORNER_RADII_TYPE, CORNER_NAMES.map((name) => numberArg(args.find((a) => a.label === name)?.value) ?? 0))
}

/** The largest of a rectangle's corner radii, written one by one or as `cornerRadii:`. */
export function largestCorner(args: readonly Argument[]): number {
  const given = args.find((a) => a.label === 'cornerRadii')?.value
  const radii = given?.kind === 'opaque' && given.typeName === CORNER_RADII_TYPE ? given.payload as readonly number[] : []
  return Math.max(0, ...radii, ...args.filter((a) => CORNER_RADIUS_LABELS.includes(a.label ?? '')).map((a) => numberArg(a.value) ?? 0))
}
