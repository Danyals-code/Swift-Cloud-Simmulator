'use client'

import { useState } from 'react'
import type { AuthoringNode, AuthoringSnapshot } from '@studio/shared'
import { Icon } from './ui/Icon'
import styles from './Layers.module.css'

/** Source hierarchy deliberately includes inactive branches and one copy of each template. */
export function LogicalLayers({ snapshot, selected, stale, onSelect }: { snapshot: AuthoringSnapshot; selected?: string; stale: boolean; onSelect: (node: AuthoringNode) => void }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const [entered, setEntered] = useState<{ owner: string; fingerprint: string } | null>(null)
  const [query, setQuery] = useState('')
  const nodes = new Map(snapshot.nodes.map(n => [n.id, n]))
  const entry = snapshot.nodes.find(n => n.owner === entered?.owner && n.fingerprint === entered.fingerprint)
  const appRoots = snapshot.roots.filter(id => nodes.get(id)?.children.some(child => nodes.get(child)?.name === 'WindowGroup'))
  const screens = new Set<string>()
  const discover = (id: string) => { const node = nodes.get(id); if (node?.definitionId) screens.add(node.definitionId); else node?.children.forEach(discover) }
  appRoots.forEach(discover)
  const roots = entry ? [entry.id] : snapshot.roots.filter(id => !appRoots.includes(id)).sort((a, b) => Number(screens.has(b)) - Number(screens.has(a)))
  const toggle = (id: string) => setClosed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const enter = (node: AuthoringNode) => { setEntered({ owner: node.owner, fingerprint: node.fingerprint }); onSelect(node); setClosed(new Set()) }
  const matches = (node: AuthoringNode): boolean => `${node.name} ${node.owner}`.toLowerCase().includes(query.toLowerCase()) || node.children.some(id => { const child = nodes.get(id); return !!child && matches(child) })
  const rows: { node: AuthoringNode; depth: number }[] = []
  const visit = (id: string, depth: number) => {
    const node = nodes.get(id)
    if (!node || query && !matches(node)) return
    rows.push({ node, depth })
    if ((!closed.has(id) || query) && (node.kind !== 'template' || entry?.id === id || query)) node.children.forEach(child => visit(child, depth + 1))
  }
  roots.forEach(id => visit(id, 0))
  return <section className={styles.panel} aria-label="Design layers" data-testid="logical-layers">
    <div className={styles.heading}><span>Design structure</span><button type="button" data-testid="collapse-layers" aria-label="Collapse all layers" onClick={() => { setQuery(''); setClosed(new Set(snapshot.nodes.map(n => n.id))) }}><Icon name="collapse" size={13} /></button></div>
    {entry && <div className={styles.note}><button type="button" onClick={() => setEntered(null)}>All screens</button> / {entry.owner} / {entry.name}<p>{entry.kind === 'template' ? 'All rows using this template' : 'Shared source'}</p></div>}
    <div className={styles.tree} role="tree" aria-label="Source layers" aria-busy={stale}>
      {rows.map(({ node, depth }) => <div key={node.id} className={styles.row} style={{ paddingLeft: 8 + depth * 14 }} data-source-name={node.name} data-source-owner={node.owner} data-source-kind={node.kind} role="treeitem" aria-level={depth + 1} aria-selected={selected === node.id} aria-expanded={node.children.length ? !closed.has(node.id) && (node.kind !== 'template' || entry?.id === node.id) : undefined} tabIndex={0}
        onClick={() => { if (!stale) onSelect(node) }} onDoubleClick={() => { if (!stale && node.kind === 'template') enter(node) }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!stale) { if (node.kind === 'template') enter(node); else onSelect(node) } }
          if (event.key === 'ArrowRight' && node.children.length) { event.preventDefault(); if (node.kind === 'template') enter(node); else if (closed.has(node.id)) toggle(node.id) }
          if (event.key === 'ArrowLeft' && !closed.has(node.id)) { event.preventDefault(); toggle(node.id) }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); const rows = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLElement>('[role="treeitem"]')); rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowUp' ? -1 : 1)]?.focus() }
        }}>
        <button type="button" tabIndex={-1} className={styles.disclosure} disabled={!node.children.length} aria-label={`Expand ${node.name}`} onClick={event => { event.stopPropagation(); if (node.kind === 'template') enter(node); else toggle(node.id) }}><Icon name={closed.has(node.id) || node.kind === 'template' && entry?.id !== node.id ? 'chevron-right' : 'chevron-down'} size={12} /></button>
        <span className={styles.name}>{node.kind === 'definition' ? node.owner : node.kind === 'branch' && node.properties[0] ? `If ${node.properties[0].expression}` : node.controls?.find(c => c.id === 'content')?.value || node.name}</span><span className={styles.kind}>{node.kind === 'template' ? 'All rows' : node.kind === 'component' ? 'Instance' : node.kind === 'branch' ? 'Branch' : node.kind === 'definition' ? screens.has(node.id) ? 'Screen' : 'Component' : ''}</span>
      </div>)}
    </div>
    <p className={styles.note}>Double-click a row template, or press Enter, to edit all its rows.</p>
    <label className={styles.filter}><Icon name="search" size={14} /><input aria-label="Filter design layers" value={query} placeholder="Filter design layers" onChange={e => setQuery(e.target.value)} /></label>
  </section>
}
