/** Named iOS categories. The preview's default is Large, as on a stock device. */
export const DYNAMIC_TYPE_SIZES = [
  'xSmall', 'small', 'medium', 'large', 'xLarge', 'xxLarge', 'xxxLarge',
  'accessibility1', 'accessibility2', 'accessibility3', 'accessibility4', 'accessibility5',
] as const

export type DynamicTypeSize = typeof DYNAMIC_TYPE_SIZES[number]

/** Compatibility for callers that still send the old approximate multiplier. */
export function dynamicTypeForScale(scale = 1): DynamicTypeSize {
  const sizes = [14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53]
  let nearest = 3
  let distance = Infinity
  sizes.forEach((size, index) => {
    const next = Math.abs(size / 17 - scale)
    if (next < distance) { nearest = index; distance = next }
  })
  return DYNAMIC_TYPE_SIZES[nearest]!
}

export function isDynamicTypeSize(value: unknown): value is DynamicTypeSize {
  return typeof value === 'string' && (DYNAMIC_TYPE_SIZES as readonly string[]).includes(value)
}
