'use client'

import { Fragment, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PagePreview } from '@studio/shared'
import { designScreenPath, type DesignComponent, type DesignScreenNode, type DesignTree } from '../lib/designTree'
import type { ScreenCommand } from '../lib/screens'
import type { NavigatorLayout } from '../lib/layout'
import { Icon, type IconName } from './ui/Icon'
import { MenuButton, type MenuItem } from './ui/Menu'
import styles from './DesignNavigator.module.css'

/** Which of the three settings levels the right-hand panel is showing. */
export type DesignLevel = 'app' | 'screen' | 'view'

export interface DesignNavigatorProps {
  appName: string
  tree: DesignTree
  layout: NavigatorLayout
  onLayoutChange: (layout: NavigatorLayout) => void
  level: DesignLevel
  selectedScreenId?: string
  /** The Main being edited, when a component definition is selected. */
  selectedComponent?: string
  busy: boolean
  onTogglePanel: () => void
  onSelectApp: () => void
  onSelectScreen: (page: PagePreview) => void
  onSelectComponent: (component: DesignComponent) => void
  onInsertComponent?: (component: DesignComponent) => Promise<string | null>
  onScreenCommand: (command: ScreenCommand) => Promise<string | null>
  /** The focused screen's view tree: embedded in the outline, or as its own panel. */
  renderLayers: (options: { embedded: boolean; query: string; indent: number }) => ReactNode
}

const INDENT = 14
const BASE = 8

/**
 * Design's left panel: App > Screens > Views.
 *
 * One model drawn two ways. Merged is a single outline, which is how a small app
 * reads best; Three panels gives App, Screens and the selected screen's Layers a
 * scroll area each, which is how a large one stays navigable. The selection lives
 * above this component, so switching between the two never loses it.
 */
export function DesignNavigator(props: DesignNavigatorProps) {
  const { appName, tree, layout, onLayoutChange, level, selectedScreenId, selectedComponent, busy, onTogglePanel, onSelectApp, onSelectScreen, onSelectComponent, onInsertComponent, onScreenCommand, renderLayers } = props
  const [query, setQuery] = useState('')
  const [focus, setFocus] = useState(false)
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(['app', 'group:screens']))
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set())
  const [editing, setEditing] = useState<{ view: string | null; name: string; layout: 'VStack' | 'HStack' | 'ZStack' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const needle = query.trim().toLowerCase()
  const path = useMemo(() => designScreenPath(tree, selectedScreenId), [tree, selectedScreenId])
  const isOpen = (id: string) => !!needle || (!closed.has(id) && (open.has(id) || path.includes(id)))
  const toggle = (id: string) => {
    const now = isOpen(id)
    setOpen(current => { const next = new Set(current); if (now) next.delete(id); else next.add(id); return next })
    setClosed(current => { const next = new Set(current); if (now) next.add(id); else next.delete(id); return next })
  }
  const command = async (action: ScreenCommand) => {
    if (pending || busy) return
    setPending(true); setError(null)
    try { const problem = await onScreenCommand(action); setError(problem); if (!problem) setEditing(null) }
    finally { setPending(false) }
  }
  const matches = (node: DesignScreenNode): boolean => !needle || node.name.toLowerCase().includes(needle) || node.id === selectedScreenId || node.children.some(matches)
  const inFocus = (node: DesignScreenNode): boolean => !focus || !selectedScreenId || path.includes(node.id) || node.id === selectedScreenId

  const screenActions = (node: DesignScreenNode): MenuItem[] => node.view ? [
    { value: 'rename', label: 'Rename…', disabled: busy },
    { value: 'duplicate', label: 'Duplicate', disabled: busy },
    { value: 'remove', label: 'Remove screen', disabled: busy, separated: true },
  ] : []
  const onScreenAction = (node: DesignScreenNode, value: string) => {
    if (!node.view) return
    if (value === 'rename') { setEditing({ view: node.view, name: node.name, layout: 'VStack' }); setError(null) }
    else void command({ kind: value as 'duplicate' | 'remove', view: node.view })
  }

  /** One screen, its layers when it is the one being edited, then the screens it pushes. */
  const screenRows = (node: DesignScreenNode, depth: number, withLayers: boolean, detail?: string): ReactNode => {
    if (!matches(node) || !inFocus(node)) return null
    const selected = node.id === selectedScreenId
    const expandable = withLayers && selected || node.children.length > 0
    const expanded = expandable && isOpen(node.id)
    return <Fragment key={node.id}>
      <Row id={node.id} depth={depth} icon={node.presentation === 'sheet' || node.presentation === 'cover' || node.presentation === 'popover' ? 'sheet' : 'phone'} label={node.name} detail={detail}
        selected={selected && level === 'screen'} current={selected && level !== 'screen'} expandable={expandable} expanded={expanded} onToggle={() => toggle(node.id)}
        onClick={() => onSelectScreen(node.page)} actions={screenActions(node)} onAction={value => onScreenAction(node, value)} testId="design-screen" />
      {expanded && withLayers && selected && <div className={styles.layers} data-testid="design-screen-layers">{renderLayers({ embedded: true, query, indent: BASE + (depth + 1) * INDENT })}</div>}
      {expanded && node.children.map(child => screenRows(child, depth + 1, withLayers))}
    </Fragment>
  }

  const screensGroup = (depth: number, withLayers: boolean) => <>
    {tree.lanes.map(lane => screenRows(lane.root, depth, withLayers))}
    {!focus && !!tree.detached.length && <>
      <GroupRow id="group:detached" depth={depth} label="Not linked yet" count={tree.detached.length} expanded={isOpen('group:detached')} onToggle={() => toggle('group:detached')} title="Screens nothing navigates to yet. Add a Navigate to action to connect one." />
      {isOpen('group:detached') && tree.detached.map(node => screenRows(node, depth + 1, withLayers))}
    </>}
    {!tree.lanes.length && !tree.detached.length && <p className={styles.empty}>{busy ? 'Drawing screens…' : 'No screens yet.'}</p>}
  </>
  const sheetsGroup = (depth: number, withLayers: boolean) => !tree.sheets.length ? null : <>
    <GroupRow id="group:sheets" depth={depth} label="Sheets" icon="sheet" count={tree.sheets.length} expanded={isOpen('group:sheets')} onToggle={() => toggle('group:sheets')} />
    {isOpen('group:sheets') && tree.sheets.map(sheet => screenRows(sheet.screen, depth + 1, withLayers, sheet.openers.length > 1 ? `Opened from ${sheet.openers.length} screens` : undefined))}
  </>
  const componentsGroup = (depth: number) => <>
    <GroupRow id="group:components" depth={depth} label="Components" icon="component" count={tree.components.length} expanded={isOpen('group:components')} onToggle={() => toggle('group:components')} />
    {isOpen('group:components') && (tree.components.length ? tree.components.filter(component => !needle || component.name.toLowerCase().includes(needle)).map(component =>
      <Row key={component.name} id={`component:${component.name}`} depth={depth + 1} icon="component" label={component.name} detail={`${component.copies} ${component.copies === 1 ? 'copy' : 'copies'}`}
        selected={selectedComponent === component.name} onClick={() => onSelectComponent(component)} testId="design-component"
        actions={[{ value: 'edit', label: 'Edit Main' }, ...(onInsertComponent ? [{ value: 'insert', label: 'Insert copy into selection', disabled: busy || !component.reusable, title: component.reusable ? 'Add another copy of this component where the selection is' : 'This component needs values from the screen it is on, so a copy cannot be placed elsewhere yet.' }] : [])]}
        onAction={value => { if (value === 'edit') onSelectComponent(component); else if (value === 'insert' && onInsertComponent) void onInsertComponent(component).then(setError) }} />)
      : <p className={styles.empty} style={{ paddingLeft: BASE + (depth + 1) * INDENT }}>Select a view and choose Make component to reuse it.</p>)}
  </>
  const addScreen = <button type="button" className={styles.add} aria-label="Add screen" title="Add screen" disabled={busy || pending} onClick={() => { setEditing({ view: null, name: 'New screen', layout: 'VStack' }); setError(null) }} data-testid="add-screen"><Icon name="plus" size={13} /></button>
  const form = editing && <form className={styles.form} onSubmit={event => { event.preventDefault(); void command(editing.view ? { kind: 'rename', view: editing.view, name: editing.name } : { kind: 'create', name: editing.name, layout: editing.layout }) }}>
    <label>{editing.view ? 'Screen name' : 'New screen name'}<input autoFocus aria-label="Screen name" maxLength={100} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(null) } }} /></label>
    {!editing.view && <label>Starts with<select aria-label="Screen layout" value={editing.layout} onChange={event => setEditing({ ...editing, layout: event.target.value as typeof editing.layout })}><option value="VStack">A column (top to bottom)</option><option value="HStack">A row (left to right)</option><option value="ZStack">Layers (front to back)</option></select></label>}
    <div><button type="submit" disabled={busy || pending || !editing.name.trim()}>{editing.view ? 'Rename' : 'Add screen'}</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
  </form>

  const header = <header className={styles.header}>
    <button type="button" className={styles.icon} data-testid="pane-toggle-navigator" aria-pressed="true" title="Collapse left panel (⌘0)" aria-label="Collapse left panel" onClick={onTogglePanel}><Icon name="sidebar-left" size={15} /></button>
    <strong>Design</strong>
    <span className={styles.switch} role="group" aria-label="Panel layout">
      <button type="button" aria-pressed={layout === 'merged'} title="One tree: App, screens and views together" aria-label="One tree" data-testid="navigator-layout-merged" onClick={() => onLayoutChange('merged')}><Icon name="outline" size={13} /></button>
      <button type="button" aria-pressed={layout === 'split'} title="Three panels: App, Screens and Layers" aria-label="Three panels" data-testid="navigator-layout-split" onClick={() => onLayoutChange('split')}><Icon name="panels" size={13} /></button>
    </span>
    <button type="button" className={styles.icon} aria-pressed={focus} title={focus ? 'Show every screen' : 'Focus on this screen'} aria-label="Focus on this screen" data-testid="focus-screen" disabled={!selectedScreenId} onClick={() => setFocus(value => !value)}><Icon name="focus" size={14} /></button>
  </header>
  const appRow = <Row id="app" depth={0} icon="app" label={appName} detail="App" selected={level === 'app'} expandable={layout === 'merged'} expanded={layout === 'merged' && isOpen('app')} onToggle={() => toggle('app')} onClick={onSelectApp} testId="design-app" title="App settings: tokens, navigation and images" />
  const feedback = <>{form}{error && <p className={styles.error} role="alert">{error}</p>}</>

  if (layout === 'split') return <nav className={styles.navigator} aria-label="Design" data-testid="design-navigator" data-layout="split">
    {header}
    <section className={styles.panel} aria-label="App" data-panel="app">
      <h2>App</h2>
      <div className={styles.scroll} role="tree" aria-label="App" onKeyDown={moveFocus}>{appRow}{componentsGroup(0)}</div>
    </section>
    <section className={styles.panel} aria-label="Screens" data-panel="screens">
      <h2>Screens{addScreen}</h2>
      <div className={styles.scroll} role="tree" aria-label="Screens" onKeyDown={moveFocus}>{screensGroup(0, false)}{sheetsGroup(0, false)}</div>
      {feedback}
    </section>
    <section className={`${styles.panel} ${styles.layersPanel}`} aria-label="Layers" data-panel="layers">
      {renderLayers({ embedded: false, query: '', indent: BASE })}
    </section>
  </nav>

  return <nav className={styles.navigator} aria-label="Design" data-testid="design-navigator" data-layout="merged">
    {header}
    <div className={styles.outline} role="tree" aria-label="App, screens and views" onKeyDown={moveFocus}>
      {appRow}
      {isOpen('app') && <>
        {!focus && componentsGroup(1)}
        <GroupRow id="group:screens" depth={1} label={tree.navigation === 'tabs' ? 'Tabs' : 'Screens'} icon={tree.navigation === 'tabs' ? 'tabs' : 'screens'} expanded={isOpen('group:screens')} onToggle={() => toggle('group:screens')} action={addScreen} />
        {isOpen('group:screens') && screensGroup(2, true)}
        {!focus && sheetsGroup(1, true)}
      </>}
    </div>
    {feedback}
    <label className={styles.search}><Icon name="search" size={14} /><input aria-label="Find a screen or layer" data-testid="design-search" value={query} placeholder="Find a screen or layer" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setQuery('') } }} /></label>
  </nav>
}

/** Up and Down move between the outline's own rows; Layers rows keep their keys. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement
  if (!target.dataset.outlineRow || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-outline-row]'))
  const index = rows.indexOf(target)
  const next = rows[index + (event.key === 'ArrowUp' ? -1 : 1)]
  if (!next) return
  event.preventDefault()
  next.focus()
}

function Row({ id, depth, icon, label, detail, selected, current, expandable, expanded, onToggle, onClick, actions, onAction, testId, title }: {
  id: string; depth: number; icon: IconName; label: string; detail?: string; selected?: boolean; current?: boolean
  expandable?: boolean; expanded?: boolean; onToggle?: () => void; onClick: () => void
  actions?: readonly MenuItem[]; onAction?: (value: string) => void; testId?: string; title?: string
}) {
  return <div className={styles.row} role="treeitem" aria-level={depth + 1} aria-selected={!!selected} aria-expanded={expandable ? !!expanded : undefined} data-current={current || undefined} data-row-id={id} data-testid={testId} style={{ paddingLeft: BASE + depth * INDENT }}>
    <button type="button" tabIndex={-1} className={styles.disclosure} disabled={!expandable} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`} onClick={onToggle}>{expandable && <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} />}</button>
    <button type="button" className={styles.label} data-outline-row="true" title={title} onClick={onClick}
      onKeyDown={event => { if (event.key === 'ArrowRight' && expandable && !expanded) { event.preventDefault(); onToggle?.() } else if (event.key === 'ArrowLeft' && expandable && expanded) { event.preventDefault(); onToggle?.() } }}>
      <Icon name={icon} size={14} /><span>{label}</span>{detail && <small>{detail}</small>}
    </button>
    {!!actions?.length && <span className={styles.actions}><MenuButton label={`Actions for ${label}`} items={actions} onSelect={value => onAction?.(value)}><Icon name="ellipsis" size={14} /></MenuButton></span>}
  </div>
}

function GroupRow({ id, depth, label, icon = 'section', count, expanded, onToggle, action, title }: { id: string; depth: number; label: string; icon?: IconName; count?: number; expanded: boolean; onToggle: () => void; action?: ReactNode; title?: string }) {
  return <div className={styles.group} role="treeitem" aria-level={depth + 1} aria-expanded={expanded} aria-selected={false} data-row-id={id} style={{ paddingLeft: BASE + depth * INDENT }} title={title}>
    <button type="button" className={styles.groupToggle} data-outline-row="true" onClick={onToggle} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}>
      <span className={styles.disclosure}><Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={12} /></span>
      <Icon name={icon} size={13} /><span>{label}</span>{count !== undefined && <small>{count}</small>}
    </button>
    {action}
  </div>
}
