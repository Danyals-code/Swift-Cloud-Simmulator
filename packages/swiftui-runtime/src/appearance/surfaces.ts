/** Points calibrated against the supplied light/default-text phone captures.
 * Other sizes and appearances remain provisional; see docs/parity/ios27.json. */
export const SURFACES = {
  list: { row: 52, rowX: 16, rowY: 14, inset: 16, regularMaxWidth: 720, corner: 26,
    top: 10, bottom: 24, sectionGap: 24, unheadedGap: 35, afterFooterGap: 10, headerTop: 4, headerBottom: 8, footerTop: 8 },
  navigation: { height: 54, largeTitle: 48, inset: 16, titleInset: 16, buttonGap: 8 },
  tab: { height: 62, margin: 12, bottom: 8, inset: 4, itemWidth: 90, safeAreaOverlap: 21, selectedRadius: 999, regularWidth: 520 },
  search: { height: 44, radius: 22, margin: 16, bottom: 6 },
  sheet: { radius: 34, margin: 8, top: 10, maxWidth: 640, grabberWidth: 58, grabberHeight: 4 },
  alert: { width: 320, radius: 34, buttonHeight: 48, margin: 24 },
  menu: { width: 280, radius: 24, row: 44, margin: 12 },
} as const

export type ListAppearance = 'plain' | 'grouped' | 'insetGrouped' | 'sidebar'
export function listAppearance(style: string | null, form: boolean, width: number): ListAppearance {
  if (style === 'plain' || style === 'grouped' || style === 'insetGrouped' || style === 'sidebar') return style
  // A regular-width ordinary list uses inset rows; forms remain grouped.
  return !form && width >= 600 ? 'sidebar' : 'insetGrouped'
}
