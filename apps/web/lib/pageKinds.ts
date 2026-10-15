import { MODIFIER_SLOTS, type PagePreview } from '@studio/shared'

/** How a page is reached: started on, a `#Preview` of its own, pushed, or presented over the screen it is reached from. */
export type PageKind = NonNullable<PagePreview['kind']>

export interface PageKindInfo {
  /** What it is called, on the canvas's arrow to it and in Screen settings. */
  readonly label: string
  /** Its icon in the Screens list. */
  readonly icon: 'phone' | 'sheet' | 'button' | 'list-rows'
  /**
   * How it is shown over the screen that reaches it: as a screen of its own, which the Screens
   * list puts with the sheets and the canvas draws once however many screens open it, or up
   * over that screen, listed under it. None for a page pushed or started on.
   */
  readonly presented?: 'screen' | 'over'
  /** The Layers slot its views are written in (`MODIFIER_SLOTS`), which draws on a page of its own. */
  readonly slot?: string
  /** How Screen settings say it is reached, from the names of the screens that reach it. */
  readonly reached: (from: string) => string
}

/** A kind presented over the screen that reaches it, under one name everywhere. */
const presented = (label: string, icon: PageKindInfo['icon'], over: boolean, slot?: string): PageKindInfo =>
  ({ label, icon, presented: over ? 'over' : 'screen', ...(slot ? { slot } : {}), reached: from => `${label} · ${over ? 'shown over' : 'opened from'} ${from}` })

/** Everything the web app says and draws for each kind of page, in one place. */
export const PAGE_KINDS: Readonly<Record<PageKind, PageKindInfo>> = {
  // A lane's root or a screen nothing links to yet: Screen settings say which from the tree.
  root: { label: 'Start', icon: 'phone', reached: () => 'Screen' },
  preview: { label: '#Preview', icon: 'phone', reached: () => 'A #Preview · drawn on its own, not in the app' },
  destination: { label: 'Push', icon: 'phone', slot: MODIFIER_SLOTS.navigationDestination, reached: from => `Pushed from ${from}` },
  sheet: presented('Sheet', 'sheet', false, MODIFIER_SLOTS.sheet),
  cover: presented('Full screen', 'sheet', false, MODIFIER_SLOTS.fullScreenCover),
  popover: presented('Popover', 'sheet', false),
  alert: presented('Alert', 'button', true, MODIFIER_SLOTS.alert),
  dialog: presented('Confirmation dialog', 'list-rows', true, MODIFIER_SLOTS.confirmationDialog),
}

/** The Layers slots whose views draw on a page of their own, not on the screen they are written in. */
export const PAGE_SLOTS: ReadonlySet<string> = new Set(Object.values(PAGE_KINDS).flatMap(kind => kind.slot ? [kind.slot] : []))

/**
 * How `page` is reached, given whether a page drawn beside it reaches it: started on or a
 * `#Preview` when none does, and otherwise presented as its kind says, or pushed.
 */
export function reachedAs(page: PagePreview, reached: boolean): PageKind {
  if (!reached) return page.kind === 'preview' ? 'preview' : 'root'
  return page.kind && PAGE_KINDS[page.kind].presented ? page.kind : 'destination'
}

/**
 * The pages no page drawn beside them reaches, as Design lays them out: each of the app's in a
 * lane of its own, then the screens nothing links to yet, then the `#Preview`s the app doesn't
 * run, each group sharing a lane.
 */
export function pageRoots(pages: readonly PagePreview[]): { readonly running: PagePreview[]; readonly detached: PagePreview[]; readonly previews: PagePreview[] } {
  const ids = new Set(pages.map(page => page.id))
  const running: PagePreview[] = [], detached: PagePreview[] = [], previews: PagePreview[] = []
  for (const page of pages) {
    if (page.parentId && ids.has(page.parentId)) continue
    if (!page.standalone) running.push(page)
    else if (reachedAs(page, false) === 'preview') previews.push(page)
    else detached.push(page)
  }
  return { running, detached, previews }
}
