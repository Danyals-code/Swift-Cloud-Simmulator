import type { AuthoringNode, AuthoringSnapshot, PagePreview } from '@studio/shared'
import { screenDefinition, type DesignScreen } from './screens'

/** How a screen is reached from the one before it. `root` starts a lane. */
export type ScreenPresentation = 'root' | 'push' | 'sheet' | 'cover' | 'popover'

export interface DesignScreenNode {
  /** The page this screen is drawn as. Selection and canvas focus use this id. */
  readonly id: string
  readonly name: string
  /** The Swift view that draws it, when the source names one. */
  readonly view?: string
  readonly page: PagePreview
  readonly presentation: ScreenPresentation
  /** Navigation steps from the lane's root: the canvas column. */
  readonly depth: number
  /** Screens pushed from this one, in source order. Presented screens live in `sheets`. */
  readonly children: readonly DesignScreenNode[]
}

export interface DesignLane {
  readonly id: string
  readonly name: string
  /** True when the app has a tab bar and this lane is one of its tabs. */
  readonly tab: boolean
  readonly root: DesignScreenNode
}

export interface DesignSheet {
  readonly screen: DesignScreenNode
  /** Every screen that presents it. A shared sheet is listed once, with each opener. */
  readonly openers: readonly string[]
}

export interface DesignComponent {
  readonly name: string
  readonly definition?: AuthoringNode
  /** Source call sites, including repeated rows. */
  readonly copies: number
  /** False when a copy needs values from its screen and cannot be inserted elsewhere. */
  readonly reusable: boolean
}

/**
 * The one tree Design shows: App > Components, the navigation lanes, the sheets.
 *
 * Built from what the preview actually drew - its pages and their parents - so the
 * merged outline, the three panels and the canvas all describe the same app, and
 * none of them can show a screen the others do not.
 */
export interface DesignTree {
  readonly navigation: 'tabs' | 'stack' | 'none'
  readonly lanes: readonly DesignLane[]
  readonly sheets: readonly DesignSheet[]
  /** Screens made in the studio that nothing navigates to yet. */
  readonly detached: readonly DesignScreenNode[]
  readonly components: readonly DesignComponent[]
}

const PRESENTED = new Set(['sheet', 'cover', 'popover'])

export function designTree(pages: readonly PagePreview[] | undefined, snapshot: AuthoringSnapshot | undefined, screens: readonly DesignScreen[]): DesignTree {
  const all = pages ?? []
  const byId = new Map(all.map(page => [page.id, page]))
  const viewOf = (page: PagePreview) => page.id.startsWith('screen:') ? page.id.slice(7) : screenDefinition(snapshot, page)?.name
  const nameOf = (page: PagePreview) => {
    const view = viewOf(page)
    return screens.find(screen => screen.view === view)?.name ?? page.name
  }
  const presentationOf = (page: PagePreview): ScreenPresentation => !page.parentId || !byId.has(page.parentId) ? 'root' : page.kind === 'destination' ? 'push' : page.kind === 'sheet' || page.kind === 'cover' || page.kind === 'popover' ? page.kind : 'push'
  const sheets = new Map<string, { screen: DesignScreenNode; openers: string[] }>()
  const build = (page: PagePreview, depth: number, seen: ReadonlySet<string>): DesignScreenNode => {
    const next = new Set([...seen, page.id])
    const children: DesignScreenNode[] = []
    for (const child of all) {
      if (child.parentId !== page.id || next.has(child.id)) continue
      if (PRESENTED.has(child.kind ?? '')) {
        // Presented once, wherever it is presented from: the first opener in lane
        // order owns its place, and every other opener only draws an arrow to it.
        const key = viewOf(child) ?? child.id
        const existing = sheets.get(key)
        if (existing) existing.openers.push(page.id)
        else sheets.set(key, { screen: build(child, depth + 1, next), openers: [page.id] })
      } else children.push(build(child, depth + 1, next))
    }
    return { id: page.id, name: nameOf(page), view: viewOf(page), page, presentation: presentationOf(page), depth, children }
  }
  const roots = all.filter(page => !page.parentId || !byId.has(page.parentId))
  const running = roots.filter(page => !page.standalone)
  const lanes = running.map(page => ({ id: page.id, name: nameOf(page), tab: running.length > 1, root: build(page, 0, new Set()) }))
  const detached = roots.filter(page => page.standalone).map(page => build(page, 0, new Set()))
  return {
    navigation: running.length > 1 ? 'tabs' : running.length === 1 ? 'stack' : 'none',
    lanes,
    sheets: [...sheets.values()],
    detached,
    components: designComponents(snapshot, screens.map(screen => screen.view)),
  }
}

/** The view the studio writes for the app's tab bar, which belongs to the App node. */
const NAVIGATION_VIEW = 'AppNavigation'

/** Reusable view definitions with at least one copy, excluding screens. */
export function designComponents(snapshot: AuthoringSnapshot | undefined, screenViews: readonly string[]): DesignComponent[] {
  const copies = snapshot?.nodes.filter(node => node.component && node.name !== NAVIGATION_VIEW && !screenViews.includes(node.name)) ?? []
  const names = [...new Set(copies.map(node => node.name))].sort((a, b) => a.localeCompare(b))
  return names.map(name => {
    const sites = copies.filter(node => node.name === name)
    const first = sites.find(node => node.component?.reusable) ?? sites[0]!
    return { name, definition: snapshot?.nodes.find(node => node.id === first.component!.definitionId), copies: sites.length, reusable: !!first.component?.reusable }
  })
}

/** Every screen in the tree, lanes first, in the order the outline lists them. */
export function designScreens(tree: DesignTree): DesignScreenNode[] {
  const out: DesignScreenNode[] = []
  const visit = (node: DesignScreenNode) => { out.push(node); node.children.forEach(visit) }
  tree.lanes.forEach(lane => visit(lane.root))
  tree.sheets.forEach(sheet => visit(sheet.screen))
  tree.detached.forEach(visit)
  return out
}

/** The chain of screens from a lane root down to `id`, for revealing it in the outline. */
export function designScreenPath(tree: DesignTree, id: string | undefined): string[] {
  if (!id) return []
  const find = (node: DesignScreenNode, path: string[]): string[] | null => {
    const next = [...path, node.id]
    if (node.id === id) return next
    for (const child of node.children) { const found = find(child, next); if (found) return found }
    return null
  }
  for (const root of [...tree.lanes.map(lane => lane.root), ...tree.sheets.map(sheet => sheet.screen), ...tree.detached]) {
    const found = find(root, [])
    if (found) return found
  }
  return []
}
