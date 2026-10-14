'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { SELECTION_COLOR, SELECTION_OUTLINE } from '@studio/swiftui-render-dom'
import type { Alignment9, Rect, ViewGeometry, ViewInstance } from '@studio/shared'
import { handleLayout, SIDES, type DragStart, type Handle, type ResizeEdge, type Side } from '../../lib/canvasDrag'
import { OVERLAP_SIZE } from '../layer/LayoutSection'
import { Choices, PLACES } from '../PropertyControl'
import styles from './SelectionHandles.module.css'

/** One drawn copy of the selected view, found on the canvas: where its points start, and how big one is. */
export interface PlacedView {
  readonly instance: ViewInstance
  /** Where the render tree's point (0, 0) of the anchor's space is, in the canvas's pixels. */
  readonly origin: { readonly x: number; readonly y: number }
  /** Pixels per point, the canvas's zoom. */
  readonly zoom: number
}

/**
 * The copy of the selected view the handles go on: one drawn on the focused phone, and
 * among the selection's own nodes, where it has a copy there. Each copy is looked for on
 * its own page, as node ids repeat from one phone to the next; a state phone is a compile
 * of its own, which a draft does not change, so it never has handles.
 */
export function placeView(canvas: HTMLElement, geometry: ViewGeometry, focusedPage?: string, selected?: ReadonlySet<string>): PlacedView | null {
  const box = canvas.getBoundingClientRect()
  let best: { placed: PlacedView; score: number } | null = null
  for (const instance of geometry.instances) {
    for (const element of canvas.querySelectorAll<HTMLElement>(`[data-node-id="${CSS.escape(instance.anchor)}"]`)) {
      const page = element.closest<HTMLElement>('[data-page-id]')?.dataset.pageId
      if (element.closest('[data-state]') || page !== instance.page) continue
      const tree = element.closest<HTMLElement>('[data-testid="render-tree"]')
      if (!tree?.offsetWidth) continue
      const zoom = tree.getBoundingClientRect().width / tree.offsetWidth
      const drawn = element.getBoundingClientRect()
      const score = (page === focusedPage || !page ? 4 : 0) + (selected?.has(instance.anchor) ? 2 : 0)
        + (Math.abs(drawn.width - instance.anchorFrame.width * zoom) < 2 && Math.abs(drawn.height - instance.anchorFrame.height * zoom) < 2 ? 1 : 0)
      if (best && best.score >= score) continue
      best = { score, placed: { instance, zoom, origin: { x: drawn.left - box.left - instance.anchorFrame.x * zoom, y: drawn.top - box.top - instance.anchorFrame.y * zoom } } }
    }
  }
  return best?.placed ?? null
}

const samePlace = (a: PlacedView | null, b: PlacedView | null) =>
  a === b || !!a && !!b && a.instance === b.instance && a.zoom === b.zoom && a.origin.x === b.origin.x && a.origin.y === b.origin.y

/** Each resize handle, and where it sits along the box's width and height. */
const EDGES: readonly (readonly [ResizeEdge, number, number])[] = [
  ['topLeading', 0, 0], ['top', 0.5, 0], ['topTrailing', 1, 0], ['trailing', 1, 0.5],
  ['bottomTrailing', 1, 1], ['bottom', 0.5, 1], ['bottomLeading', 0, 1], ['leading', 0, 0.5],
]
// Corners first, so the edges between them are over them on a small view.
const BY_EDGE = [...EDGES].sort(([, x1, y1], [, x2, y2]) => Number(x1 === 0.5 || y1 === 0.5) - Number(x2 === 0.5 || y2 === 0.5))
const CURSORS: Readonly<Record<ResizeEdge, string>> = {
  top: 'ns-resize', bottom: 'ns-resize', leading: 'ew-resize', trailing: 'ew-resize',
  topLeading: 'nwse-resize', bottomTrailing: 'nwse-resize', topTrailing: 'nesw-resize', bottomLeading: 'nesw-resize',
}

/**
 * A grip's grab area, in pixels: across its band no thicker than the band and never
 * thinner than `least`; along it, half the band's length within `shortest` and `longest`,
 * so the four grips of a small view don't lie over each other.
 */
const GRIP = { least: 4, most: 14, shortest: 8, longest: 24 }
const gripLength = (length: number) => Math.min(GRIP.longest, Math.max(GRIP.shortest, length / 2))
/** How close to an edge with no padding the pointer comes, in pixels, inside the view or out, for its grip to show. */
const EDGE_ZONE = 6
const NOWHERE = { inside: false, edges: '' } as const

/**
 * Where a band's grip goes, in pixels: along the middle of the band, or, in a band thinner
 * than the grip, from the band's inner edge into the view, so a side with no padding yet
 * has a grip just inside it to drag the padding in from. The resize knob on that edge
 * leans outward, so both can be grabbed.
 */
function gripFor(side: Side, band: { left: number; top: number; width: number; height: number }): CSSProperties {
  const across = side === 'top' || side === 'bottom'
  const thickness = across ? band.height : band.width, length = gripLength(across ? band.width : band.height)
  const grip = Math.min(GRIP.most, Math.max(GRIP.least, thickness))
  const inset = thickness >= grip ? (thickness - grip) / 2 : side === 'top' || side === 'leading' ? 0 : thickness - grip
  return across
    ? { left: band.left + band.width / 2 - length / 2, top: band.top + inset, width: length, height: grip }
    : { left: band.left + inset, top: band.top + band.height / 2 - length / 2, width: grip, height: length }
}

export interface SelectionHandlesProps {
  /** The canvas the handles are drawn over, and placed in. */
  readonly canvasRef: React.RefObject<HTMLElement | null>
  readonly geometry: ViewGeometry
  /** The phone being edited, whose copy of the view takes the handles. */
  readonly focusedPage?: string
  /** The selection's nodes, which copy of the view is the selected one. */
  readonly selected?: ReadonlySet<string>
  /** The drag's start for a copy of the view, or null when it has none. */
  readonly startFor: (instance: ViewInstance) => DragStart | null
  /** The handles can be used; without them, while an edit compiles or something covers the canvas, only the outline is drawn. */
  readonly interactive: boolean
  /** Told which copy of the view the outline is drawn around, by page and anchor, so the render tree leaves it out. */
  readonly onOutline: (outlined: { readonly page?: string; readonly anchor: string } | null) => void
  /** The handle being dragged: its own band or gap stays drawn under the pointer, and the others hide. */
  readonly dragging?: Handle | null
  /** Where the drag puts the view, in points, while a slow screen's drafts catch up. */
  readonly ghost?: Rect | null
  /** Tells the handles the canvas was panned or zoomed, which moves no element they can watch. */
  readonly subscribe: (listener: () => void) => () => void
  readonly onHandleDown: (handle: Handle, event: ReactPointerEvent<HTMLElement>, placed: PlacedView) => void
  /** A double-click on a resize handle: that axis back to Hug. */
  readonly onHug: (edge: ResizeEdge, placed: PlacedView) => void
  /**
   * In an Overlap, the 9-dot pin: where the view is pinned, why it can't be, and, for an
   * Overlap that hugs, the offer to give it its drawn size so that it can be.
   */
  readonly pin?: {
    readonly value: Alignment9 | null
    readonly reason?: string
    readonly onChoose: (place: Alignment9) => void
    readonly offer?: () => Promise<string | null>
  }
}

/**
 * Figma's handles on the selected view (Wave 2b), drawn over the canvas as tool chrome:
 * the selection's outline and eight resize handles on its box; while the pointer is over
 * it, or with Alt held, a band for each side of its padding and a bar in each gap of a
 * stack, each with a grip to drag; and in an Overlap, a 9-dot pin beside it.
 *
 * They sit outside the world's transform, so they keep their size at any zoom, and are
 * placed from the anchor node's box on screen: they follow a pan, a zoom and a scroll as
 * the view does. The body of a view in an Overlap is dragged from the view itself, on the
 * canvas, so a click there still selects as it always did.
 */
export function SelectionHandles({ canvasRef, geometry, focusedPage, selected, startFor, interactive, onOutline, dragging, ghost, subscribe, onHandleDown, onHug, pin }: SelectionHandlesProps) {
  const [placed, setPlaced] = useState<PlacedView | null>(null)
  const measure = useCallback(() => {
    const canvas = canvasRef.current
    const next = canvas ? placeView(canvas, geometry, focusedPage, selected) : null
    setPlaced(previous => samePlace(previous, next) ? previous : next)
  }, [canvasRef, geometry, focusedPage, selected])
  // After every render: the canvas redraws the phone around the handles without telling them.
  useLayoutEffect(measure)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const unsubscribe = subscribe(measure)
    canvas.addEventListener('scroll', measure, true)
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => { unsubscribe(); canvas.removeEventListener('scroll', measure, true); observer.disconnect() }
  }, [canvasRef, subscribe, measure])

  const start = placed ? startFor(placed.instance) : null
  const layout = start ? handleLayout(start) : null
  // Before paint, so the render tree's outline and this one never show together or not at all.
  const outlined = layout && placed ? placed.instance : null
  useLayoutEffect(() => { onOutline(outlined ? { ...outlined.page ? { page: outlined.page } : {}, anchor: outlined.anchor } : null) }, [outlined, onOutline])
  useLayoutEffect(() => () => onOutline(null), [onOutline])
  const px = useCallback((rect: Rect) => placed ? {
    left: placed.origin.x + rect.x * placed.zoom, top: placed.origin.y + rect.y * placed.zoom,
    width: rect.width * placed.zoom, height: rect.height * placed.zoom,
  } : { left: 0, top: 0, width: 0, height: 0 }, [placed])

  /**
   * The bands and gaps show while the pointer is over the view, or with Alt held. A grip at
   * an edge with no padding yet lies over the view's content, so it shows only while the
   * pointer is at that edge, of a view big enough that its middle stays clear: passing over
   * the views inside it leaves them free to click, drag and double-click.
   */
  const [over, setOver] = useState<{ readonly inside: boolean; readonly edges: string }>(NOWHERE)
  const [alt, setAlt] = useState(false)
  const boundsRef = useRef<ReturnType<typeof px> | null>(null)
  useLayoutEffect(() => { boundsRef.current = layout ? px(layout.bounds) : null })
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const move = (event: PointerEvent) => {
      const bounds = boundsRef.current, box = canvas.getBoundingClientRect()
      if (!bounds) { setOver(NOWHERE); return }
      const x = event.clientX - box.left, y = event.clientY - box.top
      const right = bounds.left + bounds.width, bottom = bounds.top + bounds.height
      const across = x > bounds.left && x < right, down = y > bounds.top && y < bottom
      const near = (distance: number) => Math.abs(distance) < EDGE_ZONE
      const tall = bounds.height >= EDGE_ZONE * 3, wide = bounds.width >= EDGE_ZONE * 3
      const edges = [
        tall && across && near(y - bounds.top) ? 'top' : '', wide && down && near(x - bounds.left) ? 'leading' : '',
        tall && across && near(bottom - y) ? 'bottom' : '', wide && down && near(right - x) ? 'trailing' : '',
      ].filter(Boolean).join(' ')
      const inside = across && down
      setOver(previous => previous.inside === inside && previous.edges === edges ? previous : inside || edges ? { inside, edges } : NOWHERE)
    }
    const leave = () => setOver(NOWHERE)
    const key = (event: KeyboardEvent) => setAlt(event.altKey)
    const blur = () => setAlt(false)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    window.addEventListener('keydown', key)
    window.addEventListener('keyup', key)
    window.addEventListener('blur', blur)
    return () => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', leave)
      window.removeEventListener('keydown', key)
      window.removeEventListener('keyup', key)
      window.removeEventListener('blur', blur)
    }
  }, [canvasRef])

  if (!placed || !layout) return null
  const bounds = px(layout.bounds)
  const press = (handle: Handle) => (event: ReactPointerEvent<HTMLElement>) => onHandleDown(handle, event, placed)
  const showing = dragging ? dragging.kind === 'padding' || dragging.kind === 'spacing' : over.inside || !!over.edges || alt
  /** A grip at an edge with less padding than a grip is thick shows only with the pointer at that edge, or Alt held. */
  const hidden = (side: Side, thickness: number) => thickness < GRIP.least && !alt && !over.edges.includes(side) && !(dragging?.kind === 'padding' && dragging.side === side)
  // The render tree's own outline, drawn at its scale, inside the box.
  const outline = <div className={styles.outline} data-testid="selection-outline" data-outline="handles"
    style={{ ...bounds, outlineWidth: SELECTION_OUTLINE * placed.zoom, outlineOffset: -SELECTION_OUTLINE * placed.zoom }} />
  const color = { '--selection': SELECTION_COLOR } as CSSProperties
  if (!interactive) return <div className={styles.handles} style={color} aria-hidden="true">{outline}</div>

  return <>
    <div className={styles.handles} style={color} data-testid="selection-handles" aria-hidden="true">
      {outline}
      {ghost && <div className={styles.ghost} style={px(ghost)} />}
      {BY_EDGE.map(([edge, across, along]) => {
        if (!((across === 0.5 || layout.resize.width) && (along === 0.5 || layout.resize.height))) return null
        // The grab area leans outside the view, so the bands just inside it stay free to grab.
        const lean = { '--dx': across === 0.5 ? 0 : across * 2 - 1, '--dy': along === 0.5 ? 0 : along * 2 - 1 } as CSSProperties
        return <div key={edge} className={styles.resize} data-testid="resize-handle" data-edge={edge}
          style={{ ...lean, left: bounds.left + bounds.width * across, top: bounds.top + bounds.height * along, cursor: CURSORS[edge] }}
          onPointerDown={press({ kind: 'resize', edge })} onDoubleClick={event => { event.stopPropagation(); onHug(edge, placed) }} />
      })}
      {showing && layout.padding && SIDES.map(side => {
        const band = px(layout.padding![side])
        if (hidden(side, side === 'top' || side === 'bottom' ? band.height : band.width)) return null
        return <div key={side}>
          <div className={styles.band} style={band} />
          <div className={styles.grip} style={gripFor(side, band)} data-testid="padding-handle" data-side={side} data-axis={side === 'top' || side === 'bottom' ? 'vertical' : 'horizontal'} onPointerDown={press({ kind: 'padding', side })} />
        </div>
      })}
      {showing && layout.gaps?.map((gap, index) => {
        const box = px(gap), vertical = start?.stack === 'vertical', length = gripLength(vertical ? box.width : box.height)
        const grip = Math.min(GRIP.most, Math.max(GRIP.least, vertical ? box.height : box.width))
        const at = vertical
          ? { left: box.left + box.width / 2 - length / 2, top: box.top + box.height / 2 - grip / 2, width: length, height: grip }
          : { left: box.left + box.width / 2 - grip / 2, top: box.top + box.height / 2 - length / 2, width: grip, height: length }
        return <div key={index}>
          <div className={styles.band} style={box} />
          <div className={styles.grip} style={at} data-testid="spacing-handle" data-gap={index} data-axis={start?.stack} onPointerDown={press({ kind: 'spacing', gap: index })} />
        </div>
      })}
    </div>
    {pin && !dragging && <div className={styles.pin} style={{ ...color, left: bounds.left + bounds.width, top: bounds.top + bounds.height + 10 }} title={pin.reason}
      onPointerDown={event => event.stopPropagation()}>
      {pin.reason && pin.offer
        ? <button type="button" className={styles.offer} onClick={() => void pin.offer!()}>{OVERLAP_SIZE}</button>
        : <Choices label="Pin on canvas" options={PLACES} value={pin.value} disabled={!!pin.reason} onChoose={pin.onChoose} />}
    </div>}
  </>
}
