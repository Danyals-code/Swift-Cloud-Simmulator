'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { HiddenViewInfo, ViewLayer } from '@studio/shared'
import { layerAncestors } from '../lib/layers'
import { Icon, type IconName } from './ui/Icon'
import styles from './Layers.module.css'

interface Props {
  pages: readonly ViewLayer[]
  selectedId: string | null
  /** What the inspector's pointer is over, for as long as it is over it. */
  hoveredId?: string | null
  stale: boolean
  onSelect: (layer: ViewLayer, page: ViewLayer) => void
  /**
   * Dropping one layer beside another, which is what a drag in the tree means.
   *
   * The tree is where the order *is*, so the order is changed by moving things in
   * it rather than by pressing arrows beside them - the same gesture as any other
   * layer list, and the one that can also carry a view into a different container.
   */
  onReorder?: (layer: ViewLayer, target: ViewLayer, position: 'before' | 'after') => void
  /** Views the file is hiding, shown in their place with the switch that restores them. */
  hidden?: readonly HiddenViewInfo[]
  onHide?: (layer: ViewLayer) => void
  onShow?: (view: HiddenViewInfo) => void
  /** Design only: hiding is an edit, and Live Preview does not edit. */
  editable?: boolean
}

/**
 * What each kind of view looks like in the tree.
 *
 * A hierarchy where a list, a stack and a button share one glyph is a hierarchy you
 * have to read word by word. These are shapes rather than pictures - rows for a
 * list, two boxes stacked for a VStack, two side by side for an HStack - so a screen's
 * structure can be recognised from the shape of the column.
 */
const LAYER_ICONS: Record<string, IconName> = {
  VStack: 'stack-v', LazyVStack: 'stack-v', Form: 'stack-v', GroupBox: 'section', Group: 'section',
  HStack: 'stack-h', LazyHStack: 'stack-h', GridRow: 'stack-h',
  ZStack: 'stack-z', Grid: 'grid', LazyVGrid: 'grid', LazyHGrid: 'grid',
  List: 'list-rows', Section: 'section', ForEach: 'rows',
  ScrollView: 'scroll',
  NavigationStack: 'nav', NavigationView: 'nav', NavigationSplitView: 'nav', NavigationLink: 'nav', TabView: 'screens',
  Text: 'text-lines', Label: 'text-lines', LabeledContent: 'text-lines', Link: 'text-lines',
  Button: 'button', Toggle: 'button', Picker: 'button', Stepper: 'button', Slider: 'button',
  TextField: 'button', SecureField: 'button', DatePicker: 'button', ColorPicker: 'button',
  Image: 'image', AsyncImage: 'image', ProgressView: 'rows',
  Spacer: 'spacer', Divider: 'rows',
  Rectangle: 'shape', RoundedRectangle: 'shape', Circle: 'shape', Capsule: 'shape', Ellipse: 'shape', Path: 'shape', Canvas: 'shape',
  Toolbar: 'rows', Destination: 'nav', Presentation: 'screens',
}

const iconFor = (type: string, expandable: boolean): IconName =>
  LAYER_ICONS[type] ?? (expandable ? 'section' : 'dot')

/** The current evaluated contents of every tab; deferred destinations appear when opened. */
export function Layers({ pages, selectedId, hoveredId = null, stale, onSelect, onReorder, hidden = [], onHide, onShow, editable = false }: Props) {
  /** The row being dragged, and the gap the pointer is currently over. */
  const [drag, setDrag] = useState<{ id: string; over: string | null; position: 'before' | 'after' } | null>(null)
  /** True from the press, whether or not it has become a drag yet. */
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ id: string; x: number; y: number } | null>(null)
  const started = useRef(false)
  const dragRef = useRef<typeof drag>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [expandNext, setExpandNext] = useState(false)
  /** A selection whose auto-revealed ancestors the user has since collapsed by hand. */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState<string | null>(null)
  const tree = useRef<HTMLDivElement>(null)
  /**
   * The ancestors of a selection, open whether or not the tree was collapsed.
   *
   * A selection can arrive from the preview - inspect a view and click it - and
   * naming a row inside a collapsed page would select something nobody can see.
   * Derived rather than written into `collapsed`, so collapsing one of them by
   * hand is still the last word: that press says "not this one", and the tree
   * stops opening it.
   */
  const revealed = useMemo(
    () => new Set(dismissed === selectedId ? [] : layerAncestors(pages, selectedId)),
    [pages, selectedId, dismissed],
  )

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const result: { layer: ViewLayer; page: ViewLayer; depth: number; parent: string | null }[] = []
    const matches = (layer: ViewLayer): boolean => !needle || `${layer.name} ${layer.type}`.toLowerCase().includes(needle) || layer.children.some(matches)
    const visit = (layer: ViewLayer, page: ViewLayer, depth: number, parent: string | null) => {
      if (!matches(layer)) return
      result.push({ layer, page, depth, parent })
      if (needle || !collapsed.has(layer.id) || revealed.has(layer.id)) layer.children.forEach(child => visit(child, page, depth + 1, layer.id))
    }
    pages.forEach(page => visit(page, page, 0, null))
    return result
  }, [pages, collapsed, query, revealed])
  const tabStop = rows.some(row => row.layer.id === focused) ? focused : rows[0]?.layer.id

  /**
   * The nearest row that is actually drawn.
   *
   * Hovering a view inside a collapsed page has an answer - the page - and
   * expanding the tree under the pointer would rearrange it while somebody is
   * reading it. A selection is a decision, so that one opens the tree instead.
   */
  const visible = (id: string | null): string | null => {
    if (!id) return null
    if (rows.some(row => row.layer.id === id)) return id
    for (const ancestor of [...layerAncestors(pages, id)].reverse()) {
      if (rows.some(row => row.layer.id === ancestor)) return ancestor
    }
    return null
  }
  const hovered = visible(hoveredId)

  useEffect(() => {
    const id = selectedId ?? hovered
    if (!id) return
    tree.current?.querySelector(`[data-layer-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, hovered])
  const toggle = (id: string) => {
    if (revealed.has(id)) setDismissed(selectedId)
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  /**
   * Dragging a row.
   *
   * Pointer events rather than HTML drag-and-drop: this has to work inside a
   * scrolling panel, has to be able to say *between which two rows* the pointer is,
   * and has to be cancellable with Escape - three things the drag-and-drop API
   * makes harder rather than easier. A drag only starts after a few pixels, so a
   * click is still a click.
   */
  const rowAt = (y: number): { id: string; position: 'before' | 'after' } | null => {
    const items = tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"][data-layer-id]')
    if (!items) return null
    for (const item of items) {
      const box = item.getBoundingClientRect()
      if (y < box.top || y > box.bottom) continue
      return { id: item.dataset.layerId!, position: y < box.top + box.height / 2 ? 'before' : 'after' }
    }
    return null
  }

  useEffect(() => { dragRef.current = drag }, [drag])

  useEffect(() => {
    if (!dragging) return

    const move = (event: PointerEvent) => {
      const start = dragStart.current
      if (!start) return
      // The drag begins once the pointer has travelled a few pixels, wherever it has
      // travelled to: tracking on the row itself missed every drag that left the row
      // before the browser sent it a move, which is most of them.
      if (!started.current) {
        if (Math.abs(event.clientY - start.y) + Math.abs(event.clientX - start.x) < 5) return
        started.current = true
        setDrag({ id: start.id, over: null, position: 'after' })
      }
      const over = rowAt(event.clientY)
      setDrag((current) => {
        if (!current) return current
        if (!over || over.id === current.id) return current.over === null ? current : { ...current, over: null }
        return current.over === over.id && current.position === over.position
          ? current
          : { ...current, over: over.id, position: over.position }
      })
    }

    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      dragStart.current = null
      started.current = false
      setDragging(false)
      setDrag(null)
    }

    const up = () => {
      const current = dragRef.current
      dragStart.current = null
      started.current = false
      setDragging(false)
      setDrag(null)
      if (!current?.over) return
      const from = rows.find((row) => row.layer.id === current.id)?.layer
      const to = rows.find((row) => row.layer.id === current.over)?.layer
      if (from && to) onReorder?.(from, to, current.position)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('keydown', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', cancel)
    }
  }, [dragging, rows, onReorder])

  const onRowPointerDown = (layer: ViewLayer) => (event: React.PointerEvent) => {
    if (!onReorder || event.button !== 0) return
    if ((event.target as HTMLElement).closest('button')) return
    dragStart.current = { id: layer.id, x: event.clientX, y: event.clientY }
    started.current = false
    setDragging(true)
  }

  /** The hidden views a given layer was hiding, matched by where they were cut from. */
  const hiddenUnder = (layer: ViewLayer) =>
    hidden.filter((view) => (view.container === null
      ? !!layer.page
      : layer.source?.file === view.file && layer.source.start === view.container))

  const focusRow = (index: number) => {
    const item = tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[index]
    item?.focus()
  }

  return <section className={styles.panel} data-testid="layers-panel" aria-label="Layers">
    <div className={styles.heading}><span>Pages & layers</span><span>{`${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`} <button type="button" data-testid="collapse-layers" title={expandNext ? 'Expand all layers' : 'Collapse all layers'} aria-label={expandNext ? 'Expand all layers' : 'Collapse all layers'} onClick={() => {
      const ids = new Set<string>()
      if (!expandNext) {
        const collect = (layer: ViewLayer) => { if (layer.children.length) ids.add(layer.id); layer.children.forEach(collect) }
        pages.forEach(collect)
      }
      setQuery('')
      setDismissed(expandNext ? null : selectedId)
      setCollapsed(ids)
      setExpandNext(value => !value)
    }}><Icon name={expandNext ? 'expand' : 'collapse'} size={13} /></button></span></div>
    <div ref={tree} className={styles.tree} role="tree" aria-label="App layers" aria-busy={stale}>
      {rows.map(({ layer, page, depth, parent }, index) => {
        const expandable = layer.children.length > 0
        const expanded = expandable && (!!query.trim() || !collapsed.has(layer.id) || revealed.has(layer.id))
        return [
        <div key={layer.id} role="treeitem" aria-level={depth + 1} aria-label={`${layer.name}, ${layer.type}`}
          aria-expanded={expandable ? expanded : undefined} aria-selected={selectedId === layer.id}
          data-hovered={hovered === layer.id || undefined}
          tabIndex={tabStop === layer.id ? 0 : -1} data-layer-id={layer.id} data-page={!!layer.page}
          className={styles.row} style={{ paddingLeft: 8 + depth * 14 }}
          title={`${layer.type}${layer.source ? ` · ${layer.source.file}` : ''}`}
          data-dragging={drag?.id === layer.id || undefined}
          data-drop={drag?.over === layer.id ? drag.position : undefined}
          onFocus={() => setFocused(layer.id)}
          onPointerDown={onRowPointerDown(layer)}
          onClick={() => { if (!drag) onSelect(layer, page) }}
          onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
            event.preventDefault()
            if (event.key === 'ArrowDown') focusRow(Math.min(index + 1, rows.length - 1))
            else if (event.key === 'ArrowUp') focusRow(Math.max(0, index - 1))
            else if (event.key === 'Home') focusRow(0)
            else if (event.key === 'End') focusRow(rows.length - 1)
            else if (event.key === 'ArrowRight' && expandable) { if (!expanded) toggle(layer.id); else focusRow(index + 1) }
            else if (event.key === 'ArrowLeft') { if (expanded && !query.trim()) toggle(layer.id); else if (parent) focusRow(rows.findIndex(row => row.layer.id === parent)) }
            else if (event.key === 'Enter' || event.key === ' ') onSelect(layer, page)
          }}>
          <button type="button" tabIndex={-1} className={styles.disclosure} disabled={!expandable}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${layer.name}`}
            onClick={event => { event.stopPropagation(); toggle(layer.id) }}>
            {expandable && <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />}
          </button>
          <span className={styles.icon}>{layer.page ? <Icon name="screens" size={14} /> : <Icon name={iconFor(layer.type, expandable)} size={14} />}</span>
          <span className={styles.name}>{layer.name}</span>
          {editable && !layer.page && onHide ? (
            <span className={styles.move}>
              <button type="button" tabIndex={-1} data-testid="layer-hide"
                aria-label={`Hide ${layer.name}`} title="Hide this view (⌘H)"
                onClick={event => { event.stopPropagation(); onHide(layer) }}>
                <Icon name="eye" size={13} />
              </button>
            </span>
          ) : null}
          {layer.page?.active && <span className={styles.current} title="Visible page" aria-label="Visible page" />}
          {!layer.page && layer.name !== layer.type && <span className={styles.kind}>{layer.type}</span>}
        </div>,
        /**
         * The views this container is hiding.
         *
         * Drawn where they were rather than in a list of their own: a hidden view is
         * still part of the screen's shape, and the only thing you want to do with
         * one is put it back where it came from.
         */
        ...hiddenUnder(layer).map(view => (
          <div key={`hidden:${view.file}:${view.offset}`} role="treeitem" aria-level={depth + 2}
            aria-label={`${view.name}, ${view.type}, hidden`} aria-selected={false}
            data-testid="hidden-layer" className={`${styles.row} ${styles.hiddenRow}`}
            style={{ paddingLeft: 8 + (depth + 1) * 14 }} tabIndex={-1}
            title={`Hidden · ${view.type}`}>
            <span className={styles.disclosure} />
            <span className={styles.icon}><Icon name="eye-off" size={13} /></span>
            <span className={styles.name}>{view.name}</span>
            <span className={styles.move}>
              <button type="button" tabIndex={-1} data-testid="layer-show"
                aria-label={`Show ${view.name}`} title="Show this view again"
                onClick={event => { event.stopPropagation(); onShow?.(view) }}>
                <Icon name="eye-off" size={13} />
              </button>
            </span>
          </div>
        )),
      ]
      })}
      {!rows.length && <p className={styles.empty}>{pages.length ? 'No matching layers.' : stale ? 'Building the view hierarchy…' : 'No layers to show. Check Issues if the preview cannot run.'}</p>}
    </div>
    <p className={styles.note}>Navigate or open a presentation to see its contents here.</p>
    <label className={styles.filter}><Icon name="search" size={14} /><input aria-label="Filter layers" placeholder="Filter layers" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery('') }} /></label>
  </section>
}
