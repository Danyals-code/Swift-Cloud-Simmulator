import { SCREEN_REMOVAL_REFUSALS, type AuthoringNode, type AuthoringSnapshot, type Diagnostic, type PagePreview, type ViewLayer } from '@studio/shared'
import { screenDefinition, type DesignScreen } from './screens'

/** How a screen is reached from the one before it. `root` starts a lane. */
export type ScreenPresentation = 'root' | 'push' | 'sheet' | 'cover' | 'popover'

export interface DesignScreenNode {
  /** The page this screen is drawn as. Selection and canvas focus use this id. */
  readonly id: string
  readonly name: string
  /** The Swift view that draws it, when it is that view's own page: what its settings and actions change. */
  readonly view?: string
  /**
   * Its view draws other screens too, as one list view can be two tabs. Each is named
   * by its own title, and none is renamed on its own, since the name belongs to the view.
   */
  readonly shared?: true
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

/**
 * Whose page each page is, and what it is called.
 *
 * A page is named by its view's screen name when it is that view's page, and by its
 * own title otherwise: written in place inside another view, or one of several screens
 * a view draws. A view draws several when its pages have different titles, as one list
 * view can be two tabs; a sheet opened from two screens has one title, and is one screen.
 */
export function screenNaming(pages: readonly PagePreview[], snapshot: AuthoringSnapshot | undefined, screens: readonly DesignScreen[]) {
  const views = new Map(pages.map(page => [page.id, page.id.startsWith('screen:') ? page.id.slice(7) : screenDefinition(snapshot, page)?.name]))
  const titles = new Map<string, Set<string>>()
  for (const page of pages) {
    const view = views.get(page.id)
    if (view) titles.set(view, (titles.get(view) ?? new Set()).add(page.name))
  }
  const viewOf = (page: PagePreview) => views.get(page.id)
  const shared = (view: string | undefined) => !!view && (titles.get(view)?.size ?? 0) > 1
  const nameOf = (page: PagePreview) => {
    const view = viewOf(page)
    return (!shared(view) && screens.find(screen => screen.view === view)?.name) || page.name
  }
  return { viewOf, shared, nameOf }
}

/** Whether a screen is renamed on its own: it is its view's page, and the view names no other screen. */
export const canRename = (screen: DesignScreenNode) => !!screen.view && !screen.shared

export function designTree(pages: readonly PagePreview[] | undefined, snapshot: AuthoringSnapshot | undefined, screens: readonly DesignScreen[]): DesignTree {
  const all = pages ?? []
  const byId = new Map(all.map(page => [page.id, page]))
  const { viewOf, shared, nameOf } = screenNaming(all, snapshot, screens)
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
    const view = viewOf(page)
    return { id: page.id, name: nameOf(page), view, ...(shared(view) ? { shared: true as const } : {}), page, presentation: presentationOf(page), depth, children }
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

/**
 * The screen Preview is showing, found in the tree Design drew: the tab that is open,
 * the screen pushed onto it, or the sheet presented over it. Undefined when it is not
 * one of the tree's screens.
 *
 * The running app names its tab by the tab's own page, and a pushed or presented
 * screen only by its title and the views it draws, so one is matched by the Swift
 * view that draws it, then by its title, among the screens that tab can push or the
 * sheets.
 */
export function liveDesignScreen(tree: DesignTree, live: readonly ViewLayer[] | undefined, snapshot: AuthoringSnapshot | undefined): DesignScreenNode | undefined {
  const tab = live?.find(layer => layer.type === 'Page' && layer.page?.active)
  if (!tab) return undefined
  const roots = tree.lanes.map(lane => lane.root)
  const root = roots.find(screen => screen.page.id === tab.id || !!tab.page?.handlerId && screen.page.handlerId === tab.page.handlerId) ?? (roots.length === 1 ? roots[0] : undefined)
  const below = (screens: readonly DesignScreenNode[]): DesignScreenNode[] => screens.flatMap(screen => [screen, ...below(screen.children)])
  // A sheet is over everything; an alert or a menu is not a screen, and leaves the one under it.
  const presented = live?.find(layer => layer.type === 'Presentation')
  const sheet = presented && matchScreen(below(tree.sheets.map(item => item.screen)), presented, snapshot)
  if (sheet) return sheet
  const pushed = tab.children.find(layer => layer.type === 'Destination')
  if (!root || !pushed) return root
  return matchScreen(below(root.children), pushed, snapshot)
}

/** One of `screens` drawing `shown`: by the Swift view that draws its first view, then by its title. */
function matchScreen(screens: readonly DesignScreenNode[], shown: ViewLayer, snapshot: AuthoringSnapshot | undefined): DesignScreenNode | undefined {
  const view = ownerOfFirstView(shown.children, snapshot)
  const byView = view ? screens.filter(screen => screen.view === view) : []
  const titled = (list: readonly DesignScreenNode[]) => list.filter(screen => screen.name === shown.name || screen.page.name === shown.name)
  if (byView.length) return titled(byView)[0] ?? byView[0]
  const byTitle = titled(screens)
  return byTitle.length === 1 ? byTitle[0] : undefined
}

/** The Swift view written around the first view a running screen draws, skipping navigation chrome. */
function ownerOfFirstView(layers: readonly ViewLayer[], snapshot: AuthoringSnapshot | undefined): string | undefined {
  if (!snapshot) return undefined
  for (const layer of layers) {
    if (layer.type.startsWith('_')) continue
    const node = snapshot.nodes.find(item => item.id === snapshot.runtimeToSource[layer.id])
    if (node && node.kind !== 'definition') return node.owner
    const inner = ownerOfFirstView(layer.children, snapshot)
    if (inner) return inner
  }
  return undefined
}

/** The outline's rows that list the sheets, and the screens nothing links to yet. */
export const SHEETS_GROUP = 'group:sheets'
export const DETACHED_GROUP = 'group:detached'

/**
 * The rows from the outline's top down to screen `id`, for revealing it: the screens
 * above it, and for a sheet or a screen nothing links to yet, the group it is listed in.
 * A screen just added is in "Not linked yet", which would otherwise stay closed (D13).
 */
export function designScreenPath(tree: DesignTree, id: string | undefined): string[] {
  if (!id) return []
  const find = (node: DesignScreenNode, path: string[]): string[] | null => {
    const next = [...path, node.id]
    if (node.id === id) return next
    for (const child of node.children) { const found = find(child, next); if (found) return found }
    return null
  }
  const roots = [
    ...tree.lanes.map(lane => ({ root: lane.root, groups: [] as string[] })),
    ...tree.sheets.map(sheet => ({ root: sheet.screen, groups: [SHEETS_GROUP] })),
    ...tree.detached.map(root => ({ root, groups: [DETACHED_GROUP] })),
  ]
  for (const { root, groups } of roots) {
    const found = find(root, groups)
    if (found) return found
  }
  return []
}

/**
 * What an empty Screens list says, and where to look when an error is the reason.
 *
 * Screens are found by drawing them, so while a file doesn't parse there are none,
 * and after a reload nothing is kept from before: "No screens yet" then sent a
 * designer looking for screens that were there all along.
 */
export function emptyScreensNote(busy: boolean, diagnostics: readonly Diagnostic[]): { readonly text: string; readonly at?: { readonly file: string; readonly offset: number } } {
  if (busy) return { text: 'Drawing screens…' }
  const error = diagnostics.find((d) => d.severity === 'error')
  if (!error) return { text: 'No screens yet.' }
  return { text: `Fix the error in ${error.span.file.split('/').pop()} to see the screens.`, at: { file: error.span.file, offset: error.span.start } }
}

/** Why a screen cannot be removed from its settings, or nothing when it can. */
export function screenRemovalRefusal(screen: DesignScreenNode, tree: DesignTree): string | undefined {
  const lane = tree.lanes.find(candidate => candidate.root.id === screen.id)
  if (lane) return lane.tab ? SCREEN_REMOVAL_REFUSALS.tab : SCREEN_REMOVAL_REFUSALS.start
  const opened = tree.sheets.some(sheet => sheet.screen.id === screen.id) || designScreens(tree).some(node => node.children.some(child => child.id === screen.id))
  return opened ? SCREEN_REMOVAL_REFUSALS.opened : undefined
}
