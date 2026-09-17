'use client'

import { useMemo, useRef, useState } from 'react'
import type { ViewLayer } from '@studio/shared'
import { Icon } from './ui/Icon'
import styles from './Layers.module.css'

interface Props {
  pages: readonly ViewLayer[]
  selectedId: string | null
  stale: boolean
  onSelect: (layer: ViewLayer, page: ViewLayer) => void
}

/** The current evaluated contents of every tab; deferred destinations appear when opened. */
export function Layers({ pages, selectedId, stale, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState<string | null>(null)
  const tree = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const result: { layer: ViewLayer; page: ViewLayer; depth: number; parent: string | null }[] = []
    const matches = (layer: ViewLayer): boolean => !needle || `${layer.name} ${layer.type}`.toLowerCase().includes(needle) || layer.children.some(matches)
    const visit = (layer: ViewLayer, page: ViewLayer, depth: number, parent: string | null) => {
      if (!matches(layer)) return
      result.push({ layer, page, depth, parent })
      if (needle || !collapsed.has(layer.id)) layer.children.forEach(child => visit(child, page, depth + 1, layer.id))
    }
    pages.forEach(page => visit(page, page, 0, null))
    return result
  }, [pages, collapsed, query])
  const tabStop = rows.some(row => row.layer.id === focused) ? focused : rows[0]?.layer.id
  const toggle = (id: string) => setCollapsed(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const focusRow = (index: number) => {
    const item = tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')[index]
    item?.focus()
  }

  return <section className={styles.panel} data-testid="layers-panel" aria-label="Layers">
    <div className={styles.heading}><span>Pages & layers</span><span>{stale ? 'Updating…' : `${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`}</span></div>
    <div ref={tree} className={styles.tree} role="tree" aria-label="App layers" aria-busy={stale}>
      {rows.map(({ layer, page, depth, parent }, index) => {
        const expandable = layer.children.length > 0
        const expanded = expandable && (!!query.trim() || !collapsed.has(layer.id))
        return <div key={layer.id} role="treeitem" aria-level={depth + 1} aria-label={`${layer.name}, ${layer.type}`}
          aria-expanded={expandable ? expanded : undefined} aria-selected={selectedId === layer.id}
          tabIndex={tabStop === layer.id ? 0 : -1} data-layer-id={layer.id} data-page={!!layer.page}
          className={styles.row} style={{ paddingLeft: 8 + depth * 14 }}
          title={`${layer.type}${layer.source ? ` · ${layer.source.file}` : ''}`}
          onFocus={() => setFocused(layer.id)}
          onClick={() => onSelect(layer, page)}
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
          <span className={styles.icon}>{layer.type === 'Text' ? 'T' : <Icon name={layer.page ? 'screens' : expandable ? 'grid' : 'dot'} size={14} />}</span>
          <span className={styles.name}>{layer.name}</span>
          {layer.page?.active && <span className={styles.current} title="Visible page" aria-label="Visible page" />}
          {!layer.page && layer.name !== layer.type && <span className={styles.kind}>{layer.type}</span>}
        </div>
      })}
      {!rows.length && <p className={styles.empty}>{pages.length ? 'No matching layers.' : stale ? 'Building the view hierarchy…' : 'No layers to show. Check Issues if the preview cannot run.'}</p>}
    </div>
    <p className={styles.note}>Navigate or open a presentation to see its contents here.</p>
    <label className={styles.filter}><Icon name="search" size={14} /><input aria-label="Filter layers" placeholder="Filter layers" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setQuery('') }} /></label>
  </section>
}
