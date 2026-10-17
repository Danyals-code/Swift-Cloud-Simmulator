import { presentedRoot, TOOLBAR_PLACEMENT_WORDS as WORDS, type AuthoringNode, type AuthoringSnapshot, type DesignControl, type ScreenBars, type SourceSpan, type ToolbarPlacement } from '@studio/shared'

/** What a new search field asks for until the designer writes their own. */
export const SEARCH_PROMPT = 'Search'

/** The places the Bars section adds a toolbar item at, in the order it offers them, each named as the Placement field names it. */
export const TOOLBAR_PLACES: readonly { readonly placement: ToolbarPlacement; readonly label: string; readonly hint: string }[] = [
  { placement: 'leading', label: WORDS.leading, hint: 'Add a button at the left of the navigation bar' },
  { placement: 'trailing', label: WORDS.trailing, hint: 'Add a button at the right of the navigation bar' },
  { placement: 'principal', label: WORDS.principal, hint: 'Add a view in place of the title' },
  { placement: 'bottom', label: WORDS.bottom, hint: 'Add a button to a bar at the bottom of the screen' },
]

/**
 * Every group the Bars section lists items in: the places it adds at, then every other
 * placement the Placement field sets, in its order (Navigation, Status, then where iOS puts
 * one, since Wave 6c), then a placement set in code. Read from the field's words, so a new
 * placement is listed without a change here.
 */
const GROUPS: readonly { readonly placement: ToolbarPlacement | null; readonly label: string }[] = [
  ...TOOLBAR_PLACES,
  ...(Object.keys(WORDS) as ToolbarPlacement[]).filter(placement => !TOOLBAR_PLACES.some(place => place.placement === placement)).map(placement => ({ placement, label: WORDS[placement] })),
  { placement: null, label: 'Set in code' },
]

/** A toolbar item as the Bars section lists it: the layer it selects, and what it shows. */
export interface ToolbarRow { readonly node: AuthoringNode; readonly label: string }

/**
 * A screen's toolbar items (`bars.items`, Wave 4b) in the groups the Bars section lists them
 * in, each with the layer a click selects. Empty groups are left out, and so is an item whose
 * layer this snapshot no longer has.
 */
export function toolbarGroups(snapshot: AuthoringSnapshot | undefined, bars: ScreenBars | undefined): { readonly label: string; readonly items: readonly ToolbarRow[] }[] {
  if (!snapshot || !bars?.items.length) return []
  const rows = bars.items.flatMap(item => {
    const node = snapshot.nodes.find(candidate => candidate.id === item.node)
    return node ? [{ placement: item.placement, node, label: item.label }] : []
  })
  return GROUPS.map(group => ({ label: group.label, items: rows.filter(row => row.placement === group.placement).map(({ node, label }) => ({ node, label })) })).filter(group => group.items.length)
}

/**
 * The screen a Search tab switch writes (Wave 6c): the one holding the app's tab bar, whose
 * `bars.searchTab` says whether it has a search tab. That screen is never a Design screen of
 * its own, since its tabs are, so a tab's first screen (`tabRoot`) offers the switch for it.
 */
export function searchTabScreen(snapshot: AuthoringSnapshot | undefined, definition: AuthoringNode | undefined, tabRoot: boolean): AuthoringNode | undefined {
  if (definition?.bars?.searchTab) return definition
  return tabRoot ? snapshot?.nodes.find(node => node.kind === 'definition' && node.bars?.searchTab) : undefined
}

/** What the Sheet section of a sheet, popover or full screen cover page shows (Wave 4b). */
export interface SheetSettings {
  /** The one view its closure shows, which its settings are written on (`presentedRoot`). */
  readonly root?: AuthoringNode
  readonly controls: readonly DesignControl[]
  /** Why it has no settings here, so the section never shows only its heading. */
  readonly reason?: string
}

/**
 * The Sheet section of the page opened at `source` (Wave 4b): the settings of the one view its
 * closure shows, or why there are none. A view the model gives no settings, as while its code
 * has errors, says so rather than leaving the section empty.
 */
export function sheetSettings(snapshot: AuthoringSnapshot, source: SourceSpan): SheetSettings {
  const root = presentedRoot(snapshot.nodes, source)
  if (!root) return { controls: [], reason: 'It shows more than one view, or one picked by a condition, so how it is presented is set in Code.' }
  const controls = root.controls?.filter(control => control.id.startsWith('sheet:')) ?? []
  return controls.length ? { root, controls } : { root, controls, reason: 'Fix this view’s code first.' }
}
