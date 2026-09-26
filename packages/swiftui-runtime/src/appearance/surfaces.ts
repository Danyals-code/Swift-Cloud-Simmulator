/** Points calibrated against the supplied light/default-text phone captures.
 * Other sizes and appearances remain provisional; see docs/parity/ios27.json.
 * A row's and a header's padding are measured from their text's glyphs, which is where
 * the simulator ends a text: a three-line row is its 64.33 pt of text and 15 above and below.
 * Where content starts under a bar, and how far apart a list's sections are, were measured
 * in the iOS 27 simulator (docs/parity/native/iphone18pro-under-bars): a section without a
 * header is `unheadedGap` below the one before it, or below the top of the list when it is
 * the first; a header is `headerTop` below the gap before it, which is `sectionGap`
 * (`plainSectionGap` in a plain list), or nothing at the top of the list. After a footer, the gap is `afterFooterGap`, or
 * `afterFooterHeaderGap` when the next section has a header. */
export const SURFACES = {
  list: { row: 52, rowX: 16, rowY: 15, inset: 16, regularMaxWidth: 720, corner: 26,
    sidebarTop: 10, bottom: 24, sectionGap: 53 / 3, plainSectionGap: 22, unheadedGap: 35, afterFooterGap: 71 / 3, afterFooterHeaderGap: 6, headerTop: 10, headerBottom: 10, footerTop: 8 },
  navigation: { height: 54, largeTitle: 52, inset: 16, titleInset: 16, buttonGap: 8 },
  tab: { height: 62, margin: 12, bottom: 8, inset: 4, itemWidth: 90, safeAreaOverlap: 21, selectedRadius: 999, regularWidth: 520 },
  // The capsule is a phone's search at the bottom of the screen, measured in the iOS 27
  // simulator (docs/parity/native/iphone18pro-misrenders).
  // In the bar's drawer the field sits right under the title, 10 pt above what follows.
  search: { height: 44, radius: 22, margin: 16, bottom: 6, drawerBottom: 10, capsuleHeight: 48, capsuleMargin: 28 },
  sheet: { radius: 34, margin: 8, top: 10, maxWidth: 640, grabberWidth: 58, grabberHeight: 4 },
  alert: { width: 320, radius: 34, buttonHeight: 48, margin: 24 },
  menu: { width: 280, radius: 24, row: 44, margin: 12 },
} as const

export type ListAppearance = 'plain' | 'inset' | 'grouped' | 'insetGrouped' | 'sidebar'
export function listAppearance(style: string | null, form: boolean, width: number): ListAppearance {
  if (style === 'plain' || style === 'inset' || style === 'grouped' || style === 'insetGrouped' || style === 'sidebar') return style
  // A regular-width ordinary list uses inset rows; forms remain grouped.
  return !form && width >= 600 ? 'sidebar' : 'insetGrouped'
}
