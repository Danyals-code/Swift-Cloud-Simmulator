import type { PagePreview } from '@studio/shared'

export interface PageSlot {
  readonly page: PagePreview
  readonly rootId: string
  readonly column: number
  readonly row: number
  readonly depth: number
}

/** Tab columns never wrap; each tab's destinations stay underneath it. */
export function pageSlots(pages: readonly PagePreview[], visibleRootId?: string): readonly PageSlot[] {
  const byId = new Map(pages.map(page => [page.id, page]))
  const roots = pages.filter(page => !page.parentId || !byId.has(page.parentId))
  const result: PageSlot[] = []
  let column = 0
  for (const root of roots) {
    if (visibleRootId && root.id !== visibleRootId) continue
    let row = 0
    const seen = new Set<string>()
    const visit = (page: PagePreview, depth: number) => {
      if (seen.has(page.id)) return
      seen.add(page.id)
      result.push({ page, rootId: root.id, column, row: row++, depth })
      pages.filter(child => child.parentId === page.id).forEach(child => visit(child, depth + 1))
    }
    visit(root, 0)
    column++
  }
  return result
}
