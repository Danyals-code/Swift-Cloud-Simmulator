'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import type { AuthoringNode, AuthoringSelection, AuthoringSnapshot, DesignEditRequest, HiddenViewInfo, SourceFile, SourceSpan, ViewLayer } from '@studio/shared'
import { rebaseSourceLayers, sourceLayerHiddenOwner, sourceLayerHiddenInScope, sourceLayerIsVisual, sourceLayerLabel, sourceLayerNotShown, sourceLayerRows, sourceLayerType, sourceLayerVisibleId, sourceLayerPrimaryViewId, type SourceLayerNavigation } from '../lib/sourceLayers'
import { Icon, type IconName } from './ui/Icon'
import { MenuButton, type MenuItem } from './ui/Menu'
import styles from './Layers.module.css'

interface Props {
  labels?: readonly { owner: string; fingerprint: string; label: string; offset?: number }[]
  onRename?: (node: AuthoringNode, label: string) => string | null
  snapshot: AuthoringSnapshot
  files: readonly SourceFile[]
  selected?: string
  selectedAncestors?: readonly string[]
  selection?: AuthoringSelection
  hovered?: string
  hoveredAncestors?: readonly string[]
  runtimeLayers?: readonly ViewLayer[]
  pageSource?: SourceSpan
  pageId?: string
  pageName?: string
  selectedRuntimeId?: string | null
  hoveredRuntimeId?: string | null
  onHover?: (node: AuthoringNode | null, runtimeId?: string) => void
  stale: boolean
  onSelect: (node: AuthoringNode, runtimeId?: string) => void
  onEdit?: (node: AuthoringNode, operation: DesignEditRequest['operation']) => Promise<string | null>
  hidden?: readonly HiddenViewInfo[]
  onShow?: (view: HiddenViewInfo) => void
  editable?: boolean
}

const ICONS: Readonly<Record<string, IconName>> = {
  VStack: 'stack-v', LazyVStack: 'stack-v', HStack: 'stack-h', LazyHStack: 'stack-h', ZStack: 'stack-z',
  Text: 'text-lines', Label: 'text-lines', Image: 'image', AsyncImage: 'image', Button: 'button',
  Toggle: 'button', TextField: 'button', SecureField: 'button', Slider: 'button', Picker: 'button',
  List: 'list-rows', ForEach: 'rows', ScrollView: 'scroll', NavigationStack: 'nav', NavigationLink: 'nav',
  TabView: 'screens', Group: 'section', Section: 'section', Grid: 'grid', Spacer: 'spacer',
}
const structural = (node: AuthoringNode) => ['view', 'component', 'collection'].includes(node.kind)

/** The designer hierarchy has one copy of a row design, never individual records. */
export function LogicalLayers({ labels = [], onRename, snapshot, files, selected, selectedAncestors = [], selection, hovered, hoveredAncestors = [], onHover, runtimeLayers, pageSource, pageId, pageName, selectedRuntimeId, stale, onSelect, onEdit, hidden = [], onShow, editable = false }: Props) {
  const [navigation, setNavigation] = useState<SourceLayerNavigation>({ snapshot, files, pageId, closed: new Set() })
  const [multiple, setMultiple] = useState<{ files: readonly SourceFile[]; ids: string[] }>({ files, ids: [] })
  const [organizing, setOrganizing] = useState<{ node: AuthoringNode; kind: 'rename' | 'reparent' } | null>(null)
  const [draft, setDraft] = useState('')
  const [destination, setDestination] = useState('')
  const labelFor = (node: AuthoringNode) => labels.find(l => l.owner === node.owner && l.fingerprint === node.fingerprint && (l.offset === undefined || l.offset === node.source.start))?.label ?? sourceLayerLabel(node)
  const [query, setQuery] = useState('')
  const [expandNext, setExpandNext] = useState(false)
  const [focused, setFocused] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; over?: string; position?: 'before' | 'after' }>()
  const tree = useRef<HTMLDivElement>(null)
  // Reconcile navigation only against the files belonging to a completed snapshot.
  const current = navigation.pageId !== pageId ? { snapshot, files, pageId, closed: new Set<string>(), selection } : stale ? navigation : rebaseSourceLayers(navigation, snapshot, files, selection)
  const { rows, entry, scope } = sourceLayerRows(snapshot, current, selected, query, runtimeLayers ? { runtimeLayers, pageSource } : undefined)
  const next = !stale && entry?.id !== current.entered ? { ...current, entered: entry?.id } : current
  if (next !== navigation) setNavigation(next)
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]))
  const runtimeParents = new Map<string, string | undefined>()
  const indexRuntime = (items: readonly ViewLayer[], parent?: string) => { for (const item of items) { runtimeParents.set(item.id, parent); indexRuntime(item.children, item.id) } }
  if (runtimeLayers) indexRuntime(runtimeLayers)
  const runtimeFor = (node: AuthoringNode) => {
    const candidates = node.runtimeIds.filter(id => !runtimeLayers || runtimeParents.has(id))
    if (candidates.length === 1) return candidates[0]
    let current = selectedRuntimeId ?? undefined
    while (current) { if (candidates.includes(current)) return current; current = runtimeParents.get(current) }
    return undefined
  }
  const rowIds = rows.map(({ node }) => node.id).join('\n')
  const selectionCandidates = [selected, ...selectedAncestors].filter((id): id is string => !!id)
  const selectedRow = selectionCandidates.map(id => sourceLayerPrimaryViewId(snapshot, id, rows)).find(Boolean) ?? selectionCandidates.map(id => sourceLayerVisibleId(snapshot, id, rows)).find(Boolean)
  const hoverCandidates = [hovered, ...hoveredAncestors].filter((id): id is string => !!id)
  const hoveredRow = hoverCandidates.map(id => sourceLayerPrimaryViewId(snapshot, id, rows)).find(Boolean) ?? hoverCandidates.map(id => sourceLayerVisibleId(snapshot, id, rows)).find(Boolean)
  useEffect(() => {
    if (!selectedRow || stale) return
    const row = Array.from(tree.current?.querySelectorAll<HTMLElement>('[data-source-id]') ?? []).find(element => element.dataset.sourceId === selectedRow)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedRow, stale, rowIds])
  // Font measurement can replace the completed snapshot without changing any
  // source row. Keep its hover while the pointer is still there; actual source
  // edits replace files, and page/context changes clear it immediately.
  useEffect(() => () => onHover?.(null), [snapshot.projectId, files, rowIds, entry?.id, query, pageId, onHover])
  const disabled = stale || busy
  const toggle = (id: string, expanded: boolean) => setNavigation(state => {
    const closed = new Set(state.closed), opened = new Set(state.opened)
    if (expanded) { closed.add(id); opened.delete(id) } else { closed.delete(id); opened.add(id) }
    return { ...state, closed, opened, dismissed: expanded ? selected : undefined }
  })
  const enter = (node: AuthoringNode) => {
    if (disabled) return
    const target = node.definitionId ? nodes.get(node.definitionId) : node
    if (!target) return
    setNavigation({ snapshot, files, pageId, entered: target.id, closed: new Set(), selection })
    onSelect(target, runtimeFor(node) ?? selectedRuntimeId ?? undefined)
  }
  const focusRow = (id?: string) => {
    const row = Array.from(tree.current?.querySelectorAll<HTMLElement>('[data-source-id]') ?? []).find(element => element.dataset.sourceId === id)
    row?.focus()
  }
  const edit = async (node: AuthoringNode, operation: DesignEditRequest['operation']) => {
    if (disabled || !editable || !onEdit) return
    setError(null); setBusy(true)
    try { setError(await onEdit(node, operation)) }
    catch { setError('This change could not be completed. Try again.') }
    finally { setBusy(false) }
  }
  const selectedIds = multiple.files === files && multiple.ids.length ? multiple.ids : selected ? [selected] : []
  const idsFor = (node: AuthoringNode) => selectedIds.includes(node.id) ? selectedIds : [node.id]
  const menus = (node: AuthoringNode): MenuItem[] => {
    const siblings = nodes.get(node.parentId ?? '')?.children ?? []
    const index = siblings.indexOf(node.id)
    const canEdit = editable && !!onEdit && !disabled && structural(node)
    return [
      ...(node.kind === 'template' ? [{ value: 'enter', label: 'Edit row design' }] : []),
      ...(node.definitionId ? [{ value: 'enter', label: 'Edit main component' }] : []),
      ...(structural(node) ? [
        { value: 'rename', label: 'Rename layer…', disabled: !canEdit || !onRename },
        { value: 'duplicate', label: 'Duplicate', disabled: !canEdit },
        { value: 'VStack', label: 'Wrap in Column', disabled: !canEdit },
        { value: 'HStack', label: 'Wrap in Row', disabled: !canEdit },
        { value: 'ZStack', label: 'Wrap in Overlay', disabled: !canEdit },
        { value: 'reparent', label: 'Move into…', disabled: !canEdit },
        { value: 'up', label: 'Move up', disabled: !canEdit || index <= 0 || !rows.some(row => row.node.id === siblings[index - 1]) },
        { value: 'down', label: 'Move down', disabled: !canEdit || index < 0 || index >= siblings.length - 1 || !rows.some(row => row.node.id === siblings[index + 1]) },
        { value: 'hide', label: 'Hide', disabled: !canEdit, separated: true },
        { value: 'delete', label: 'Delete', disabled: !canEdit },
      ] : []),
    ]
  }
  const action = (node: AuthoringNode, value: string) => {
    if (value === 'rename' || value === 'reparent') { setOrganizing({ node, kind: value }); setDraft(labelFor(node)); setDestination('') }
    else if (value === 'duplicate') void edit(node, { kind: 'layer-duplicate' })
    else if (value === 'VStack' || value === 'HStack' || value === 'ZStack') void edit(node, { kind: 'layer-wrap', ids: idsFor(node), layout: value })
    else if (value === 'enter') enter(node)
    else if ((value === 'up' || value === 'down') && !menus(node).find(item => item.value === value)?.disabled) void edit(node, { kind: 'move', direction: value === 'up' ? -1 : 1 })
    else if (value === 'hide' || value === 'delete') void edit(node, { kind: value })
  }
  const tabStop = rows.some(row => row.node.id === focused) ? focused : rows.find(row => row.node.id === selectedRow)?.node.id ?? rows[0]?.node.id
  const owners = new Map(hidden.map(view => {
    let owner = nodes.get(sourceLayerHiddenOwner(snapshot, view) ?? '')
    while (owner && !sourceLayerIsVisual(owner)) owner = nodes.get(owner.parentId ?? '')
    return [view, sourceLayerVisibleId(snapshot, owner?.id, rows)]
  }))
  const visibleHidden = hidden.filter(view => entry ? view.file === entry.source.file && view.offset >= entry.source.start && view.offset <= entry.source.end : sourceLayerHiddenInScope(snapshot, view, scope))
  const hiddenRows = (views: readonly HiddenViewInfo[], depth: number) => views.filter(view => !query.trim() || `${view.name} ${sourceLayerType({ name: view.type, kind: 'view' })}`.toLowerCase().includes(query.trim().toLowerCase())).map(view => <div key={`hidden:${view.file}:${view.offset}`} role="treeitem" aria-level={depth + 1} aria-label={`${view.name}, hidden`} aria-selected={false} className={`${styles.row} ${styles.hiddenRow}`} data-testid="hidden-layer" style={{ paddingLeft: 8 + depth * 14 }}>
    <span className={styles.disclosure} /><span className={styles.icon}><Icon name="eye-off" /></span><span className={styles.name}>{view.name === view.type ? sourceLayerType({ name: view.type, kind: 'view' }) : view.name}</span>
    <span className={styles.move}><button type="button" data-testid="layer-show" disabled={disabled || !editable || !onShow} aria-label={`Show ${view.name}`} title="Restore this view" onClick={() => onShow?.(view)}><Icon name="eye-off" size={13} /></button></span>
  </div>)
  return <section className={styles.panel} aria-label="Design layers" data-testid="logical-layers">
    <div className={styles.heading}><span>{entry ? entry.kind === 'template' ? 'Row design' : entry.kind === 'branch' ? 'Page' : 'Main component' : pageName ? `${pageName} layers` : 'Layers'}</span><button type="button" data-testid="collapse-layers" title={expandNext ? 'Expand all layers' : 'Collapse all layers'} aria-label={expandNext ? 'Expand all layers' : 'Collapse all layers'} onClick={() => {
      const ids = new Set(snapshot.nodes.map(node => node.id))
      setQuery('')
      setNavigation(state => ({
        ...state,
        closed: expandNext ? new Set() : ids,
        opened: expandNext ? ids : new Set(),
        dismissed: expandNext ? undefined : selected,
      }))
      setExpandNext(value => !value)
    }}><Icon name={expandNext ? 'expand' : 'collapse'} size={13} /></button></div>
    {entry && <div className={styles.context}><button type="button" onClick={() => setNavigation(state => ({ ...state, entered: undefined, dismissedEntry: selected }))}>{pageName || 'All screens'}</button><Icon name="chevron-right" size={11} /><span>{entry.kind === 'template' ? 'Row design' : sourceLayerLabel(entry)}</span>{entry.kind !== 'branch' && <p>{entry.kind === 'template' ? 'Changes affect all rows using this design.' : 'Changes affect every instance of this component.'}</p>}</div>}
    <div ref={tree} className={styles.tree} role="tree" aria-multiselectable="true" aria-label="Design layers" aria-busy={disabled} inert={disabled || undefined} onMouseLeave={() => onHover?.(null)}>
      {rows.map(({ node, depth, expanded: modelExpanded, parentId, children, shared }, index) => {
        const ownHidden = visibleHidden.filter(view => owners.get(view) === node.id)
        const expandable = children.length > 0 || ownHidden.length > 0
        const expanded = modelExpanded || ownHidden.length > 0 && !current.closed.has(node.id)
        const actions = menus(node)
        const displayDepth = depth
        const notShown = sourceLayerNotShown(snapshot, node)
        const label = labelFor(node), type = sourceLayerType(node)
        const canDrag = editable && !!onEdit && !disabled && structural(node)
        return <Fragment key={node.id}>
          <div className={styles.row} style={{ paddingLeft: 8 + displayDepth * 14 }} data-source-id={node.id} data-source-name={node.name} data-source-owner={node.owner} data-source-kind={node.kind} data-shared-design={shared || undefined} role="treeitem" aria-label={`${label}${label !== type ? `, ${type}` : ''}`} aria-level={displayDepth + 1} aria-selected={selectedIds.length > 1 ? selectedIds.includes(node.id) : selectedRow === node.id} data-hovered={hoveredRow === node.id || undefined} aria-expanded={expandable ? expanded : undefined} tabIndex={tabStop === node.id ? 0 : -1} data-inactive={notShown || undefined} data-dragging={drag?.id === node.id || undefined} data-drop={drag?.over === node.id ? drag.position : undefined} draggable={canDrag}
            onMouseEnter={() => { if (!stale) onHover?.(node, shared ? undefined : runtimeFor(node)) }} onMouseLeave={() => onHover?.(null)}
            onDragStart={event => { if (!canDrag) { event.preventDefault(); return } event.dataTransfer.setData('text/studio-source-layer', node.id); event.dataTransfer.effectAllowed = 'move'; setDrag({ id: node.id }) }}
            onDragOver={event => { const from = nodes.get(drag?.id ?? ''); if (!from || !canDrag || from.id === node.id || from.source.file !== node.source.file || from.owner !== node.owner || from.parentId !== node.parentId) return; event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setDrag({ id: from.id, over: node.id, position: event.clientY < box.top + box.height / 2 ? 'before' : 'after' }) }}
            onDrop={event => { event.preventDefault(); const from = nodes.get(event.dataTransfer.getData('text/studio-source-layer')); if (from && drag?.over === node.id && drag.position && from.source.file === node.source.file && from.owner === node.owner && from.parentId === node.parentId) void edit(from, { kind: 'moveTo', targetOffset: node.source.start, position: drag.position }); setDrag(undefined) }}
            onDragEnd={() => setDrag(undefined)}
            onFocus={() => setFocused(node.id)} onClick={event => { if (!disabled) {
              setError(null)
              if (event.shiftKey || event.metaKey || event.ctrlKey) {
                const existing = multiple.files === files && multiple.ids.length ? multiple.ids : selectedRow ? [selectedRow] : []
                const anchor = rows.findIndex(r => r.node.id === selectedRow)
                const ids = event.shiftKey && anchor >= 0 ? rows.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map(r => r.node.id) : existing.includes(node.id) ? existing.filter(id => id !== node.id) : [...existing, node.id]
                setMultiple({ files, ids }); if (!selectedRow) onSelect(node, shared ? undefined : runtimeFor(node))
              } else { setMultiple({ files, ids: [] }); onSelect(node, shared ? undefined : runtimeFor(node)) }
            } }} onDoubleClick={() => { if (node.kind === 'template' || node.definitionId) enter(node) }}
            onKeyDown={event => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Escape') { setDrag(undefined); return }
              if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); if (structural(node)) action(node, event.key === 'ArrowUp' ? 'up' : 'down'); return }
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!disabled) onSelect(node, shared ? undefined : runtimeFor(node)) }
              if (event.key === 'ArrowRight' && expandable) { event.preventDefault(); if (!expanded) toggle(node.id, false); else focusRow(children.find(id => rows.some(row => row.node.id === id))) }
              if (event.key === 'ArrowLeft') { event.preventDefault(); if (expanded) toggle(node.id, true); else focusRow(parentId) }
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); focusRow(rows[index + (event.key === 'ArrowUp' ? -1 : 1)]?.node.id) }
              if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); focusRow((event.key === 'Home' ? rows[0] : rows[rows.length - 1])?.node.id) }
            }}>
            <button type="button" tabIndex={-1} className={styles.disclosure} disabled={!expandable} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`} onClick={event => { event.stopPropagation(); toggle(node.id, expanded) }}>{expandable && <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />}</button>
            <span className={styles.icon}><Icon name={ICONS[node.name] ?? (children.length ? 'section' : 'shape')} /></span>
            <span className={styles.name}>{label}</span>
            <span className={styles.kind}>{notShown ? 'Not shown' : shared ? 'Shared design' : node.kind === 'component' ? 'Component' : label !== type ? type : ''}</span>
            {actions.length > 0 && <span className={styles.move} onClick={event => event.stopPropagation()}><MenuButton label={`Actions for ${label}`} items={actions} onSelect={value => action(node, value)} testId="source-layer-actions"><Icon name="ellipsis" size={14} /></MenuButton></span>}
          </div>
          {expanded && hiddenRows(ownHidden, displayDepth + 1)}
        </Fragment>
      })}
      {hiddenRows(visibleHidden.filter(view => !owners.get(view)), 0)}
      {!rows.length && <p className={styles.empty}>{query.trim() ? 'No matching layers.' : stale ? 'Building the view hierarchy…' : 'No views to show.'}</p>}
    </div>
    {selectedIds.length > 1 && <div className={styles.context}><span>{selectedIds.length} layers selected</span><button type="button" disabled={disabled} onClick={() => { const n = nodes.get(selectedIds[0]!); if (n) void edit(n, { kind: 'layer-wrap', ids: selectedIds, layout: 'VStack' }) }}>Group in Column</button><button type="button" onClick={() => setMultiple({ files, ids: [] })}>Clear selection</button></div>}
    {organizing && <form className={styles.organize} onSubmit={event => {
      event.preventDefault()
      if (organizing.kind === 'rename') { const problem = onRename?.(organizing.node, draft) ?? null; setError(problem); if (!problem) setOrganizing(null) }
      else { void edit(organizing.node, { kind: 'layer-reparent', ids: idsFor(organizing.node), destination }); setOrganizing(null) }
    }}><label>{organizing.kind === 'rename' ? 'Layer name' : 'Move selected layers into'}{organizing.kind === 'rename' ? <input autoFocus aria-label="Layer name" maxLength={100} value={draft} onChange={e => setDraft(e.target.value)} /> : <select aria-label="Destination container" value={destination} onChange={e => setDestination(e.target.value)}><option value="" disabled>Choose container</option>{snapshot.nodes.filter(n => n.owner === organizing.node.owner && ['VStack', 'HStack', 'ZStack', 'Group', 'ScrollView'].includes(n.name) && !idsFor(organizing.node).includes(n.id)).map(n => <option key={n.id} value={n.id}>{labelFor(n)} · container {snapshot.nodes.filter(item => item.owner === n.owner && item.name === n.name).indexOf(n) + 1}</option>)}</select>}</label><p>{organizing.kind === 'reparent' ? 'Layers are placed at the end of this container, in selection order.' : 'An empty name restores the content label.'}</p><div><button type="submit" disabled={disabled || organizing.kind === 'reparent' && !destination}>{organizing.kind === 'rename' ? 'Save layer name' : 'Move layers'}</button><button type="button" onClick={() => setOrganizing(null)}>Cancel</button></div></form>}
    <p className={styles.selectionHint}>Shift-click adjacent layers to group them. ⌘/Ctrl-click adds a layer.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <label className={styles.filter}><Icon name="search" size={14} /><input aria-label="Filter design layers" value={query} placeholder="Find a layer" onChange={e => setQuery(e.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setQuery('') } }} /></label>
  </section>
}
