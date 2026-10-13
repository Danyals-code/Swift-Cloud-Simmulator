import type { PagePreview } from './protocol'
import type { ComponentSource } from './view-layer'

/** Every view whose code draws a page's content, outermost first, each at its call site. */
export function viewsDrawing(page: PagePreview): readonly ComponentSource[] {
  return page.viewHierarchy?.[0]?.children[0]?.componentSources ?? []
}

const sameCall = (a: ComponentSource, b: ComponentSource) =>
  a.name === b.name && a.source.file === b.source.file && a.source.start === b.source.start && a.source.end === b.source.end

/** The calls two chains start with in common. */
function commonStart(a: readonly ComponentSource[], b: readonly ComponentSource[]): readonly ComponentSource[] {
  let length = 0
  while (length < a.length && length < b.length && sameCall(a[length]!, b[length]!)) length++
  return a.slice(0, length)
}

/**
 * The view each page is, by page id, where a page is a view's own.
 *
 * A page is written either as a view of its own, `ItemList(title: "All")` as a tab or
 * `DetailScreen()` pushed by a link, or in place, inside the view that holds the tab
 * bar or opens it. A page written in place is no view's: that view draws much more
 * than the page, and renaming, removing or restyling it from the page would change
 * another screen.
 *
 * - A tab is its innermost view's page when that view is called for this tab alone,
 *   below the calls every tab shares, which are the views holding the tab bar. Tabs a
 *   ForEach builds share one call, and are no view's.
 * - An app's one screen is its innermost view's page.
 * - A pushed or presented page is the innermost view called from where it is opened.
 */
export function pageViews(pages: readonly PagePreview[]): ReadonlyMap<string, string> {
  const tabs = pages.filter((page) => !page.parentId && !page.standalone)
  const chains = tabs.map(viewsDrawing)
  const shared = tabs.length > 1 ? chains.reduce(commonStart) : []
  const views = new Map<string, string>()
  for (const page of pages) {
    if (page.standalone) continue
    const chain = viewsDrawing(page)
    const source = page.source
    const own = page.parentId
      ? chain.filter((call) => source && call.source.file === source.file && call.source.start >= source.start && call.source.end <= source.end).at(-1)
      : chain.length > shared.length ? chain.at(-1) : undefined
    if (own) views.set(page.id, own.name)
  }
  return views
}
