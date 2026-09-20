import type { PagePreview } from '@studio/shared'

/**
 * Where each screen goes on the canvas.
 *
 * Each axis means one thing. Horizontally, screens: column = navigation steps from the
 * lane's root. Vertically, states of the same screen, stacked inside its frame. A tab
 * is a lane; when one screen leads to several, the first stays in the row and each
 * other one starts a branch row further down the lane. Designers never place screens
 * by hand, so the canvas always matches the code.
 */
export interface PageSlot {
  readonly page: PagePreview
  /** Which tab's lane; the last lane holds screens nothing links to yet. */
  readonly lane: number
  readonly column: number
  readonly branchRow: number
  /** 0 is the screen itself; 1… are its states, below it in its frame. */
  readonly stateIndex: number
  /** How the screen is reached from the one to its left. */
  readonly presentation: 'root' | 'push' | 'sheet' | 'cover' | 'popover'
  /** The screen it is reached from, for the arrow. */
  readonly parentId?: string
}

const PRESENTED = new Set(['sheet', 'cover', 'popover'])

/**
 * Lanes, columns and branch rows for every screen, states excluded.
 *
 * A sheet opened from several screens is placed once, beside the first opener in lane
 * and column order; `sameScreen` says which pages are the same sheet. `visibleRootId`
 * narrows to the lane holding that root.
 */
export function pageSlots(pages: readonly PagePreview[], visibleRootId?: string, sameScreen: (page: PagePreview) => string = page => page.id): readonly PageSlot[] {
  const byId = new Map(pages.map(page => [page.id, page]))
  const roots = pages.filter(page => !page.parentId || !byId.has(page.parentId))
  const running = roots.filter(page => !page.standalone)
  const detached = roots.filter(page => page.standalone)
  const all = [...running.map(root => [root]), ...(detached.length ? [detached] : [])].map((laneRoots, lane) => ({ laneRoots, lane }))
  // A root that names no lane - a stale selection, or a page id that is not a root -
  // shows the whole app instead of an empty canvas.
  const narrowed = all.filter(({ laneRoots }) => laneRoots.some(root => root.id === visibleRootId))
  const lanes = visibleRootId && narrowed.length ? narrowed : all
  const childrenOf = (id: string) => pages.filter(child => child.parentId === id)
  // Which copy of a shared sheet is drawn: the one opened nearest the left of the
  // first lane, found breadth first so a deep opener never wins over a shallow one.
  const drawn = new Map<string, string>()
  const visited = new Set<string>()
  for (const { laneRoots } of lanes) {
    for (let frontier = [...laneRoots]; frontier.length;) {
      const next: PagePreview[] = []
      for (const page of frontier) {
        if (visited.has(page.id)) continue
        visited.add(page.id)
        for (const child of childrenOf(page.id)) {
          if (PRESENTED.has(child.kind ?? '') && !drawn.has(sameScreen(child))) drawn.set(sameScreen(child), child.id)
          next.push(child)
        }
      }
      frontier = next
    }
  }
  const placed = new Set<string>()
  const result: PageSlot[] = []
  for (const { laneRoots, lane } of lanes) {
    let rows = 0
    const place = (page: PagePreview, column: number, branchRow: number, parentId?: string) => {
      if (placed.has(page.id)) return
      placed.add(page.id)
      const presentation = !parentId ? 'root' : PRESENTED.has(page.kind ?? '') ? page.kind as PageSlot['presentation'] : 'push'
      result.push({ page, lane, column, branchRow, stateIndex: 0, presentation, ...(parentId ? { parentId } : {}) })
      let first = true
      for (const child of childrenOf(page.id)) {
        if (placed.has(child.id)) continue
        if (PRESENTED.has(child.kind ?? '') && drawn.get(sameScreen(child)) !== child.id) continue
        const row = first ? branchRow : rows++
        first = false
        place(child, column + 1, row, page.id)
      }
    }
    // A tab's lane has one root, in row 0. Screens nothing links to yet share the
    // last lane, each starting its own row below the one before.
    for (const root of laneRoots) place(root, 0, rows++)
  }
  // Anything the walk could not reach - a screen in a parent cycle, or one hanging
  // off a copy of a shared sheet that is not the drawn one - is still a screen the
  // designer made. It goes at the end rather than disappearing.
  const last = lanes.at(-1)
  if (last && lanes.length === all.length) {
    let rows = result.filter(slot => slot.lane === last.lane).reduce((most, slot) => Math.max(most, slot.branchRow + 1), 0)
    for (const page of pages) {
      if (placed.has(page.id) || PRESENTED.has(page.kind ?? '') && drawn.get(sameScreen(page)) !== page.id) continue
      placed.add(page.id)
      result.push({ page, lane: last.lane, column: 0, branchRow: rows++, stateIndex: 0, presentation: 'root' })
    }
  }
  return result
}

export interface CanvasOptions {
  /** A phone's outer size, bezel included. */
  readonly frame: { readonly width: number; readonly height: number }
  /** The saved states of the screen a page draws, by name. */
  readonly statesOf: (page: PagePreview) => readonly string[]
  /** Screens whose states are drawn; every other frame shows a "+N states" badge. */
  readonly expanded: ReadonlySet<string>
  readonly showAllStates: boolean
  /** How many of a screen's states may be drawn, when something is rationing them. */
  readonly budget?: ReadonlyMap<string, number>
  readonly collapsedLanes: ReadonlySet<number>
  readonly laneNames: readonly string[]
  readonly visibleRootId?: string
  readonly sameScreen?: (page: PagePreview) => string
}

export interface CanvasPhone { readonly page: PagePreview; readonly state?: string; readonly x: number; readonly y: number; readonly slot: PageSlot }
export interface CanvasFrame { readonly page: PagePreview; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly states: readonly string[]; readonly expanded: boolean }
export interface CanvasLane { readonly index: number; readonly name: string; readonly y: number; readonly height: number; readonly collapsed: boolean; readonly screens: number }
export interface CanvasArrow { readonly from: string; readonly to: string; readonly kind: PageSlot['presentation'] }
export interface CanvasLayout {
  /** Every screen's place, including the ones a collapsed lane is hiding. */
  readonly slots: readonly PageSlot[]
  readonly phones: readonly CanvasPhone[]
  readonly frames: readonly CanvasFrame[]
  readonly lanes: readonly CanvasLane[]
  readonly arrows: readonly CanvasArrow[]
  readonly width: number
  readonly height: number
}

export const CANVAS = { columnGap: 132, rowGap: 72, stateGap: 44, lanePad: 24, laneHeader: 40, framePad: 14, caption: 26, badge: 32 } as const

/**
 * Pixel positions for the canvas, from the slots.
 *
 * A branch row starts below the full height of every frame above it in its lane, so a
 * tall stack of states never collides with the row under it. Everything inside a frame
 * is a state of that screen; everything outside is a different screen.
 */
export function canvasLayout(pages: readonly PagePreview[], options: CanvasOptions): CanvasLayout {
  const slots = pageSlots(pages, options.visibleRootId, options.sameScreen)
  const { frame } = options
  const cell = frame.height + CANVAS.caption
  const statesFor = (slot: PageSlot) => options.statesOf(slot.page)
  const shownStates = (slot: PageSlot) => {
    const open = options.showAllStates || options.expanded.has(slot.page.id)
    if (!open) return []
    const allowed = options.budget?.get(slot.page.id)
    return allowed === undefined ? statesFor(slot) : statesFor(slot).slice(0, allowed)
  }
  // A screen with states keeps a band at the foot of its frame for the states badge.
  const frameHeight = (slot: PageSlot) => CANVAS.framePad * 2 + cell + shownStates(slot).length * (cell + CANVAS.stateGap) + (statesFor(slot).length ? CANVAS.badge : 0)
  const phones: CanvasPhone[] = [], frames: CanvasFrame[] = [], lanes: CanvasLane[] = []
  const laneIndexes = [...new Set(slots.map(slot => slot.lane))]
  let y = 0, width = 0
  for (const lane of laneIndexes) {
    const members = slots.filter(slot => slot.lane === lane)
    const collapsed = options.collapsedLanes.has(lane)
    const top = y
    y += CANVAS.laneHeader
    if (!collapsed) {
      const rows = [...new Set(members.map(slot => slot.branchRow))].sort((a, b) => a - b)
      for (const row of rows) {
        const inRow = members.filter(slot => slot.branchRow === row)
        const height = Math.max(...inRow.map(frameHeight))
        for (const slot of inRow) {
          const x = CANVAS.lanePad + slot.column * (frame.width + CANVAS.framePad * 2 + CANVAS.columnGap)
          const states = statesFor(slot)
          const expanded = shownStates(slot).length > 0
          frames.push({ page: slot.page, x, y, width: frame.width + CANVAS.framePad * 2, height: frameHeight(slot), states, expanded })
          phones.push({ page: slot.page, x: x + CANVAS.framePad, y: y + CANVAS.framePad, slot })
          shownStates(slot).forEach((state, index) => phones.push({ page: slot.page, state, x: x + CANVAS.framePad, y: y + CANVAS.framePad + (index + 1) * (cell + CANVAS.stateGap), slot: { ...slot, stateIndex: index + 1 } }))
          width = Math.max(width, x + frame.width + CANVAS.framePad * 2 + CANVAS.lanePad)
        }
        y += height + CANVAS.rowGap
      }
      y -= CANVAS.rowGap
    }
    lanes.push({ index: lane, name: options.laneNames[lane] ?? members[0]?.page.name ?? `Lane ${lane + 1}`, y: top, height: y - top, collapsed, screens: members.length })
    y += CANVAS.lanePad * 2
  }
  const arrows: CanvasArrow[] = []
  const add = (arrow: CanvasArrow) => {
    if (arrow.from === arrow.to || arrows.some(other => other.from === arrow.from && other.to === arrow.to)) return
    arrows.push(arrow)
  }
  for (const slot of slots) if (slot.parentId) add({ from: slot.parentId, to: slot.page.id, kind: slot.presentation })
  // A shared sheet appears once; every other screen that opens it still points at it,
  // and a screen that opens it twice still draws one arrow.
  const sameScreen = options.sameScreen ?? (page => page.id)
  const shown = new Map(slots.map(slot => [sameScreen(slot.page), slot.page.id]))
  for (const page of pages) {
    if (!page.parentId || !PRESENTED.has(page.kind ?? '') || slots.some(slot => slot.page.id === page.id)) continue
    const target = shown.get(sameScreen(page))
    if (target && slots.some(slot => slot.page.id === page.parentId)) add({ from: page.parentId, to: target, kind: page.kind as CanvasArrow['kind'] })
  }
  return { slots, phones, frames, lanes, arrows, width: Math.max(width, frame.width + CANVAS.lanePad * 2), height: Math.max(y - CANVAS.lanePad, cell) }
}
