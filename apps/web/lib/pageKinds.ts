import type { PagePreview } from '@studio/shared'

/** How a page is reached: started on, a `#Preview` of its own, pushed, or presented over the screen it is reached from. */
export type PageKind = NonNullable<PagePreview['kind']>

export interface PageKindInfo {
  /** What it is called, on the canvas's arrow to it and in Screen settings. */
  readonly label: string
  /** Its icon in the Screens list. */
  readonly icon: 'phone' | 'sheet' | 'button' | 'list-rows'
  /**
   * How it is shown over the screen that reaches it: as a screen of its own, which the Screens
   * list puts in its Full screens group, or up over that screen, drawn over it and listed under
   * it. None for a page pushed or started on.
   */
  readonly presented?: 'screen' | 'over'
  /**
   * One screen however many screens open it, as a sheet is: drawn and listed once, with the
   * first screen that opens it (`firstOpened`). An alert is its screen's own, so it is not.
   */
  readonly once?: true
  /** How Screen settings say it is reached, from the names of the screens that reach it. */
  readonly reached: (from: string) => string
}

/** A kind presented over the screen that reaches it, `over` it or as a screen of its own, under one name everywhere. */
const presented = (label: string, icon: PageKindInfo['icon'], shown: 'over' | 'screen', once?: 'once'): PageKindInfo =>
  ({ label, icon, presented: shown, ...(once ? { once: true } : {}), reached: from => `${label} · ${shown === 'over' ? 'shown over' : 'opened from'} ${from}` })

/** Everything the web app says and draws for each kind of page, in one place. */
export const PAGE_KINDS: Readonly<Record<PageKind, PageKindInfo>> = {
  // A lane's root or a screen nothing links to yet: Screen settings say which from the tree.
  root: { label: 'Start', icon: 'phone', reached: () => 'Screen' },
  preview: { label: '#Preview', icon: 'phone', reached: () => 'A #Preview · drawn on its own, not in the app' },
  destination: { label: 'Push', icon: 'phone', reached: from => `Pushed from ${from}` },
  // A sheet or a popover is drawn over its screen at its height (Wave 4b); a full screen cover hides it, so it is a screen of its own.
  sheet: presented('Sheet', 'sheet', 'over', 'once'),
  cover: presented('Full screen', 'sheet', 'screen', 'once'),
  popover: presented('Popover', 'sheet', 'over', 'once'),
  alert: presented('Alert', 'button', 'over'),
  dialog: presented('Confirmation dialog', 'list-rows', 'over'),
}

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

/** Whether a page reached from another is one screen however many open it (`once`), as a sheet is. */
export const openedOnce = (page: PagePreview) => !!PAGE_KINDS[reachedAs(page, true)].once

/**
 * Which copy of each screen opened from several is the one drawn and listed, by `sameScreen`:
 * the one opened nearest the start of the first of `lanes`, found breadth first, so a deep
 * opener never wins over a shallow one. The canvas and the Screens list both ask here, so
 * the sheet listed under a screen is the one drawn beside it.
 */
export function firstOpened(pages: readonly PagePreview[], lanes: readonly (readonly PagePreview[])[], sameScreen: (page: PagePreview) => string): ReadonlyMap<string, string> {
  const children = new Map<string, PagePreview[]>()
  for (const page of pages) if (page.parentId) children.set(page.parentId, [...children.get(page.parentId) ?? [], page])
  const drawn = new Map<string, string>()
  const visited = new Set<string>()
  for (const roots of lanes) {
    for (let frontier: readonly PagePreview[] = roots; frontier.length;) {
      const next: PagePreview[] = []
      for (const page of frontier) {
        if (visited.has(page.id)) continue
        visited.add(page.id)
        for (const child of children.get(page.id) ?? []) {
          if (openedOnce(child) && !drawn.has(sameScreen(child))) drawn.set(sameScreen(child), child.id)
          next.push(child)
        }
      }
      frontier = next
    }
  }
  return drawn
}
