import { DYNAMIC_TYPE_SIZES, type DynamicTypeSize } from '@studio/shared'

/**
 * Initial iOS semantic size tables, in category order. These preserve each style's
 * own scaling curve and minimum size. iOS 27 native calibration is still pending.
 * Reference: https://developer.apple.com/design/human-interface-guidelines/typography
 */
const sizes: Record<string, readonly number[]> = {
  largeTitle: [31, 32, 33, 34, 36, 38, 40, 44, 48, 52, 56, 60],
  title: [25, 26, 27, 28, 30, 32, 34, 38, 43, 48, 53, 58],
  title2: [19, 20, 21, 22, 24, 26, 28, 34, 39, 44, 50, 56],
  title3: [17, 18, 19, 20, 22, 24, 26, 31, 37, 43, 49, 55],
  headline: [14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53],
  body: [14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53],
  callout: [13, 14, 15, 16, 18, 20, 22, 26, 32, 38, 44, 51],
  subheadline: [12, 13, 14, 15, 17, 19, 21, 25, 30, 36, 42, 49],
  footnote: [12, 12, 12, 13, 15, 17, 19, 23, 27, 33, 38, 44],
  caption: [11, 11, 11, 12, 14, 16, 18, 22, 26, 32, 37, 43],
  caption2: [11, 11, 11, 11, 12, 13, 14, 18, 22, 28, 33, 39],
}

const heights: Record<string, readonly number[]> = {
  largeTitle: [38, 39, 40, 41, 43, 46, 48, 53, 58, 63, 68, 73],
  title: [31, 32, 33, 34, 36, 38, 41, 46, 52, 58, 64, 70],
  title2: [24, 25, 26, 28, 30, 32, 35, 41, 47, 53, 60, 67],
  title3: [22, 23, 24, 25, 28, 30, 32, 38, 45, 52, 59, 66],
  headline: [19, 20, 21, 22, 24, 26, 29, 34, 40, 48, 56, 63],
  body: [19, 20, 21, 22, 24, 26, 29, 34, 40, 48, 56, 63],
  callout: [18, 19, 20, 21, 23, 25, 28, 32, 39, 46, 53, 61],
  subheadline: [16, 18, 19, 20, 22, 24, 26, 31, 37, 44, 51, 59],
  footnote: [16, 16, 16, 18, 20, 22, 24, 29, 33, 40, 46, 53],
  caption: [13, 13, 13, 16, 18, 21, 23, 28, 32, 39, 45, 52],
  caption2: [13, 13, 13, 13, 16, 18, 19, 23, 28, 34, 40, 47],
}

export function typographyAt(style: string, category: DynamicTypeSize): { size: number; lineHeight: number } | null {
  const index = DYNAMIC_TYPE_SIZES.indexOf(category)
  const size = sizes[style]?.[index]
  const lineHeight = heights[style]?.[index]
  return size === undefined || lineHeight === undefined ? null : { size, lineHeight }
}
