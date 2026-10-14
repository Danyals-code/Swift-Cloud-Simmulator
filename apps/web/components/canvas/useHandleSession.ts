'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { startKey, type Alignment9, type AuthoringNode, type CompileResult, type Point, type Rect, type ViewGeometry } from '@studio/shared'
import { arrowFor, changeFor, dragged, dragStartFor, ghostFor, hugFor, moveBlocked, type DragChange, type DragCommit, type DragStart, type Handle, type ResizeEdge } from '../../lib/canvasDrag'
import { keyFocus } from '../../lib/shortcuts'
import type { LayerDrafts } from '../../lib/useCompiler'
import { DraftQueue } from './draftQueue'
import { placeView, type PlacedView } from './SelectionHandles'

/** What the canvas's handles need from the workspace: the view, where it is drawn, and how a drag is shown and written (Wave 2b). */
export interface CanvasHandles {
  readonly node: AuthoringNode
  readonly geometry: ViewGeometry
  readonly drafts: LayerDrafts
  /** Writes what a drag, a burst of arrow keys or the pin made, as one edit: why it was refused, or whether the file changed. */
  readonly commit: (node: AuthoringNode, commit: DragCommit) => Promise<{ readonly refused?: string; readonly changed: boolean }>
  /** Moves the view one place earlier or later in its Column or Row, for the arrow keys along it. */
  readonly reorder: (direction: -1 | 1) => void
  /** Says why a drag or a key did nothing, where the designer is looking. */
  readonly note: (reason: string) => void
  /** Gives the Overlap the view is in its drawn size, so it can take a pin; absent with nothing to offer. */
  readonly sizeOverlap?: () => Promise<string | null>
  /** A sheet, or Layers, is over the canvas. */
  readonly covered?: boolean
}

/** How long after the last arrow key a burst is written, as one edit. */
const NUDGE_SETTLE_MS = 400

/** A drag or a burst of arrow keys on the selected view's handles, and the drafts it shows. */
interface Run {
  readonly kind: 'drag' | 'nudge'
  readonly queue: DraftQueue
  readonly owner: CanvasHandles
  readonly start: DragStart
  /** What letting go writes, as of now. */
  change: DragChange | null
  /** A burst of arrow keys: how far they have moved the view, in points. */
  total?: Point
  /** Takes away the run's listeners and timer. */
  stop: () => void
}

/** The click that ends a drag selects nothing: it was a drag. */
function swallowNextClick() {
  const swallow = (click: MouseEvent) => click.stopPropagation()
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
}

export interface HandleSessionOptions {
  /** The workspace's handles for the selected view, or null. */
  readonly handles: CanvasHandles | null
  /** The compile the canvas draws. */
  readonly revision: number | undefined
  /** An edit or a compile is on its way, and the canvas is out of date. */
  readonly stale: boolean
  /** The arrow keys act on the selection: designing with the Select tool, and nothing being picked. */
  readonly keys: boolean
  readonly canvasRef: RefObject<HTMLElement | null>
  /** The phone being edited, and the selection's nodes: which copy of the view the keys act on. */
  readonly focusedPage?: string
  readonly selected?: ReadonlySet<string>
}

/**
 * The selected view's handles at work (Wave 2b): a drag on one, or on the body of a view
 * in an Overlap, and a burst of arrow keys. Each shows a draft the worker lays out at most
 * once a frame; letting go, or the keys settling, writes it as one edit, and Escape puts
 * the page back as it was. A press that moves less than `DRAG_THRESHOLD` is a click.
 *
 * The draft is drawn instead of the committed page, and once written it stays until the
 * edit's own compile is drawn, so nothing flickers back. While an edit compiles the
 * workspace gives no handles; a written drag's own stay with its draft, and otherwise the
 * last ones keep the selection's outline where it is.
 */
export function useHandleSession({ handles: given, revision, stale, keys, canvasRef, focusedPage, selected }: HandleSessionOptions) {
  const [draft, setDraft] = useState<{ readonly result: CompileResult; readonly owner: CanvasHandles; readonly awaiting?: number } | null>(null)
  if (draft?.awaiting !== undefined && revision !== draft.awaiting) setDraft(null)
  const [kept, setKept] = useState<CanvasHandles | null>(null)
  if (given && given !== kept) setKept(given)
  else if (!given && !stale && kept) setKept(null)
  const handles = given ?? draft?.owner ?? (stale ? kept : null)
  const geometry = draft?.result.geometry ?? handles?.geometry

  const run = useRef<Run | null>(null)
  /** The handle being dragged, once it has moved, which keeps its band or gap drawn under the pointer. */
  const [dragging, setDragging] = useState<Handle | null>(null)
  /** Where a drag puts the view, drawn as a ghost box while a slow screen's drafts catch up. */
  const [ghost, setGhost] = useState<Rect | null>(null)
  const revisionRef = useRef(revision)
  useEffect(() => { revisionRef.current = revision }, [revision])

  /** A queue of drafts for the selected view, each shown as it comes back, with the handles it was started from. */
  const queueFor = useCallback((owner: CanvasHandles) => new DraftQueue(owner.drafts, owner.node.source, result => {
    if (result.renderTree && !result.renderTree.notice) setDraft({ result, owner })
  }), [])

  /** Ends what is under way: written as one edit, or, with `write` false, the page put back as it was. */
  const end = useCallback(async (write: boolean) => {
    const current = run.current
    if (!current) return
    run.current = null
    current.stop()
    setDragging(null)
    setGhost(null)
    void current.queue.end()
    if (!write || !current.change) { setDraft(null); return }
    const releasedAt = revisionRef.current
    const outcome = await current.owner.commit(current.owner.node, current.change.commit)
    if (outcome.refused || !outcome.changed) { setDraft(null); return }
    // The draft stands until the edit's compile is drawn; a compile that never comes still ends it.
    setDraft(shown => shown && { ...shown, awaiting: releasedAt })
    setTimeout(() => setDraft(shown => shown?.awaiting === releasedAt ? null : shown), 5000)
  }, [])

  /** A press on a handle, or on the body of a view in an Overlap, which `lazy` starts no draft for until it moves. */
  const begin = useCallback((handle: Handle, event: ReactPointerEvent, placed: PlacedView, lazy = false): boolean => {
    if (!handles || event.button !== 0 || run.current) return false
    const start = dragStartFor(handles.node, placed.instance)
    if (!start) return false
    event.stopPropagation()
    if (!lazy) event.preventDefault()
    const from = { x: event.clientX, y: event.clientY }
    let at: Point = from, moved = false
    const current: Run = { kind: 'drag', queue: queueFor(handles), owner: handles, start, change: null, stop: () => {} }
    if (!lazy) void current.queue.prepare()
    const follow = (held: { shiftKey: boolean; altKey: boolean }) => {
      current.change = changeFor(handle, start, { x: (at.x - from.x) / placed.zoom, y: (at.y - from.y) / placed.zoom }, { shift: held.shiftKey, alt: held.altKey })
      current.queue.update(current.change?.draft ?? {})
      if (current.queue.slow) setGhost(ghostFor(handle, start, current.change))
    }
    const move = (next: PointerEvent) => {
      at = { x: next.clientX, y: next.clientY }
      if (!moved && !dragged(from, at)) return
      if (!moved) setDragging(handle)
      moved = true
      follow(next)
    }
    const up = () => {
      if (moved) swallowNextClick()
      void end(moved)
    }
    const cancel = () => void end(false)
    const key = (press: KeyboardEvent) => {
      if (press.key === 'Escape') { press.preventDefault(); press.stopPropagation(); cancel() }
      else if (moved && (press.key === 'Shift' || press.key === 'Alt')) follow(press)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    current.stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('keyup', key, true)
    }
    run.current = current
    return true
  }, [handles, queueFor, end])

  /**
   * A press on the body of a view in an Overlap that can't be moved here: once it drags, the
   * canvas says why, rather than doing nothing or reordering the view instead.
   */
  const refuse = useCallback((event: ReactPointerEvent, reason: string) => {
    if (!handles || event.button !== 0 || run.current) return
    const from = { x: event.clientX, y: event.clientY }, note = handles.note
    let said = false
    const move = (next: PointerEvent) => { if (!said && dragged(from, { x: next.clientX, y: next.clientY })) { said = true; note(reason) } }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (said) swallowNextClick()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [handles])

  /** A double-click on a resize handle: that axis, or both from a corner, back to Hug. */
  const hug = useCallback((edge: ResizeEdge, placed: PlacedView) => {
    const start = handles && dragStartFor(handles.node, placed.instance)
    const commit = start && hugFor(edge, start)
    if (handles && commit) void handles.commit(handles.node, commit)
  }, [handles])

  /** The pin widget: the view pinned to a corner or edge of its Overlap, as the Layout section's pin grid does. */
  const pin = useCallback((place: Alignment9) => {
    if (handles) void handles.commit(handles.node, { kind: 'layer', changes: [{ section: 'layout', pin: place }] })
  }, [handles])

  /**
   * The arrow keys, where the canvas has the keys: inside an Overlap they nudge the view, as
   * a draft, written as one edit 400 ms after the last; in a Column or Row the arrows along
   * it move the view earlier or later. A view that can't be moved says why. Escape drops a
   * burst not yet written.
   */
  useEffect(() => {
    if (!handles || !keys) return
    const onKey = (event: KeyboardEvent) => {
      const current = run.current
      if (event.key === 'Escape' && current?.kind === 'nudge') { event.preventDefault(); event.stopPropagation(); void end(false); return }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || current?.kind === 'drag') return
      const action = arrowFor(event.key, event.shiftKey, handles.node.layer?.layout.context.parent ?? 'other')
      if (!action) return
      const focus = keyFocus(event.target), canvas = canvasRef.current
      if (focus !== 'page' && !(focus === 'control' && event.target instanceof Node && canvas?.contains(event.target))) return
      event.preventDefault()
      if ('reorder' in action) { if (!stale && !current) handles.reorder(action.reorder); return }
      if (!current && stale) return
      const placed = current || !canvas || !geometry ? null : placeView(canvas, geometry, focusedPage, selected)
      const start = current?.start ?? (placed && dragStartFor(handles.node, placed.instance))
      if (!start) return
      const blocked = moveBlocked(start)
      if (blocked) { handles.note(blocked); return }
      let timer = 0
      const burst: Run = current ?? { kind: 'nudge', queue: queueFor(handles), owner: handles, start, change: null, total: { x: 0, y: 0 }, stop: () => clearTimeout(timer) }
      run.current = burst
      burst.total = { x: burst.total!.x + action.nudge.x, y: burst.total!.y + action.nudge.y }
      burst.change = changeFor({ kind: 'move' }, burst.start, burst.total)
      burst.queue.update(burst.change?.draft ?? {})
      burst.stop()
      timer = window.setTimeout(() => void end(true), NUDGE_SETTLE_MS)
      burst.stop = () => clearTimeout(timer)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [handles, keys, stale, canvasRef, geometry, focusedPage, selected, queueFor, end])

  // A burst still settling when the selection moves on is written for the view it was on;
  // a drag cannot outlive its view.
  const selectionKey = handles ? startKey(handles.node.source) : ''
  useEffect(() => () => { void end(run.current?.kind === 'nudge') }, [selectionKey, end])

  return { handles, geometry, draft: draft?.result ?? null, dragging, ghost, begin, refuse, hug, pin }
}
