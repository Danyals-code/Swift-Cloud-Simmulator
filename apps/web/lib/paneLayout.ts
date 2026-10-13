import { PANE_LIMITS, type WorkspaceMode } from './layout'

/** The narrowest the editor is allowed to get before the side panes start yielding. */
const EDITOR_MIN = 300

/** Below this, Design has no room for Layers beside the canvas, and draws it over the canvas when asked (D15). */
const NARROW_DESIGN = 820

/** The width the studio is laid out for. Below it a note asks for a wider window (D15). */
export const COMFORTABLE_WIDTH = 1200

/** The widest windows whose toolbar has no room for the text size, and then for any picker. */
const NO_ROOM_FOR_TEXT_SIZE = 1180, NO_ROOM_FOR_PICKERS = 1020

export interface PaneLayout {
  readonly nav: number
  readonly preview: number
  readonly showNavigator: boolean
  readonly showPreview: boolean
  /** A Design window too narrow for Layers beside the canvas. */
  readonly narrow: boolean
  /** Layers is drawn over the canvas, in a narrow window, because it was asked for. */
  readonly layersOver: boolean
}

/**
 * What the side panes actually get.
 *
 * Their stored widths and even their visibility are a preference, not a promise.
 * Below about 780px there is no arrangement in which a navigator, an editor and a
 * phone all have a usable width, so one of them has to go - and a preview squeezed
 * to 300px beside a 104px editor serves nobody. The preview yields first: a
 * narrower phone is still a phone, while an editor that fits eight characters is
 * not an editor.
 *
 * The preference is kept rather than written back, so widening the window brings
 * the pane back exactly as it was. A narrow Design window keeps the canvas, and
 * draws Layers over it while `layersOver` asks for it (D15).
 */
export function paneLayout({ available, mode, shown, widths, layersOver }: {
  readonly available: number
  readonly mode: WorkspaceMode
  readonly shown: { readonly navigator: boolean; readonly preview: boolean }
  readonly widths: { readonly navigator: number; readonly preview: number }
  /** Layers asked for in a narrow Design window, where the stored choice does not open it. */
  readonly layersOver: boolean
}): PaneLayout {
  const navMin = PANE_LIMITS.navigator.min
  const previewMin = PANE_LIMITS.preview.min

  if (mode === 'design') {
    const narrow = available < NARROW_DESIGN
    const showNavigator = narrow ? layersOver : shown.navigator
    return { nav: showNavigator ? widths.navigator : 0, preview: 0, showNavigator, showPreview: true, narrow, layersOver: narrow && layersOver }
  }

  // Only the *combination* is refused. A single side pane the user asked for is
  // always shown, even if the editor then has to go under its comfortable
  // minimum: hiding the one thing somebody just switched on is worse than a
  // narrow editor, and they can close it again in one keystroke.
  const showNavigator = shown.navigator
  const showPreview =
    shown.preview &&
    !(
      showNavigator &&
      Number.isFinite(available) &&
      available < navMin + previewMin + EDITOR_MIN
    )

  const nav = showNavigator ? widths.navigator : 0
  const prev = showPreview ? widths.preview : 0
  const overflow = nav + prev + EDITOR_MIN - available

  if (!Number.isFinite(overflow) || overflow <= 0) {
    return { nav, preview: prev, showNavigator, showPreview, narrow: false, layersOver: false }
  }

  const fromPreview = Math.min(overflow, Math.max(0, prev - previewMin))
  const rest = overflow - fromPreview
  return {
    nav: Math.max(navMin, nav - Math.max(0, rest)),
    preview: prev - fromPreview,
    showNavigator,
    showPreview,
    narrow: false,
    layersOver: false,
  }
}

export type EnvironmentPicker = 'device' | 'appearance' | 'text-size'

/**
 * Where Design draws its preview environment: in the toolbar while there is room, and in
 * the canvas heading a picker at a time as the toolbar runs out of it. They used to be
 * hidden with no other copy anywhere, from 1,180 px for text size and 1,020 px for all (D15).
 */
export function environmentPlacement(available: number): { readonly toolbar: readonly EnvironmentPicker[]; readonly heading: readonly EnvironmentPicker[] } {
  if (available <= NO_ROOM_FOR_PICKERS) return { toolbar: [], heading: ['device', 'appearance', 'text-size'] }
  if (available <= NO_ROOM_FOR_TEXT_SIZE) return { toolbar: ['device', 'appearance'], heading: ['text-size'] }
  return { toolbar: ['device', 'appearance', 'text-size'], heading: [] }
}
