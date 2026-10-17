'use client'

import type { AuthoringNode, AuthoringOperation, AuthoringSnapshot, SourceSpan } from '@studio/shared'
import { screenTitleControl } from '../../lib/screens'
import { SEARCH_PROMPT, sheetSettings, TOOLBAR_PLACES, toolbarGroups } from '../../lib/screenBars'
import { PAGE_KINDS, type PageKind } from '../../lib/pageKinds'
import { PropertyControl } from '../PropertyControl'
import styles from './Settings.module.css'
import inspector from '../AuthoringInspector.module.css'

interface BarsProps {
  snapshot?: AuthoringSnapshot
  definition?: AuthoringNode
  /** The screen's first view, when it has one: a screen with none says nothing about a title. */
  root?: AuthoringNode
  /** The screen holding the app's tabs, which the Search tab switch writes (`searchTabScreen`, Wave 6c). */
  tabs?: AuthoringNode
  busy: boolean
  onNodeChange: (node: AuthoringNode, control: string, value: string) => Promise<string | null>
  onNodeCommand: (node: AuthoringNode, operation: AuthoringOperation) => Promise<string | null>
  onSelect: (node: AuthoringNode) => void
}

/**
 * The bars a screen draws (Wave 4b): its title, its toolbar items by where they sit, its
 * search field, and on a tab's first screen, the app's search tab (Wave 6c). Each item
 * selects its layer, where its Placement and contents are changed; the + buttons and the
 * switches write the screen's code, making a toolbar or a navigation stack where it has none.
 * A refusal shows at the foot of the canvas, as every planned edit's does.
 */
export function BarsSection({ snapshot, definition, root, tabs, busy, onNodeChange, onNodeCommand, onSelect }: BarsProps) {
  const bars = definition?.bars
  const title = screenTitleControl(snapshot, definition)
  const search = bars?.search
  const searchNode = search && snapshot?.nodes.find(node => node.id === search.node)
  const prompt = search?.control ? searchNode?.controls?.find(control => control.id === search.control) : undefined
  const searchTab = tabs?.bars?.searchTab
  const searchTabNode = searchTab?.node ? snapshot?.nodes.find(node => node.id === searchTab.node) : undefined
  const command = (operation: AuthoringOperation) => { if (definition) void onNodeCommand(definition, operation) }
  if (!title && !root && !bars && !searchTab) return null
  return <section className={styles.section} aria-label="Bars" data-testid="screen-bars">
    <div className={styles.sectionHeader}><h3>Bars</h3></div>
    {title ? <PropertyControl key={`${title.node.id}:${title.control.value}`} control={title.control} label="Title" onChange={(id, value) => onNodeChange(title.node, id, value)} />
      : root && <p className={styles.note}>{bars?.barless
        ? 'This screen has no navigation bar here, so a title would not show.'
        : 'No title bar title. Add a Title modifier to the screen’s first view to show one.'}</p>}
    {toolbarGroups(snapshot, bars).map(group => <div key={group.label} className={styles.row} role="group" aria-label={`${group.label} toolbar items`} data-testid="toolbar-group">
      <span>{group.label}</span>
      <div className={styles.states}>{group.items.map(item => <button key={item.node.id} type="button" className={styles.stateRow} title="Select this toolbar item" onClick={() => onSelect(item.node)}>
        {item.label || item.node.name}{item.node.name === 'ToolbarItemGroup' && <small>Group</small>}
      </button>)}</div>
    </div>)}
    {bars && <>
      <div className={styles.placements} role="group" aria-label="Add a toolbar item">
        {TOOLBAR_PLACES.map(place => <button key={place.placement} type="button" className={styles.button} disabled={busy || !!bars.problem} title={bars.problem ?? place.hint} onClick={() => command({ kind: 'toolbar-item-add', placement: place.placement })}>+ {place.label}</button>)}
      </div>
      {bars.problem && <p className={styles.note}>{bars.problem}</p>}
      <div className={styles.row}><span>Search field</span>
        <button type="button" role="switch" className={inspector.switch} aria-label="Search field" aria-checked={!!search} disabled={busy || !search && !!bars.searchProblem} title={search ? undefined : bars.searchProblem}
          onClick={() => command(search ? { kind: 'searchable-remove' } : { kind: 'searchable-add', prompt: SEARCH_PROMPT })}><i /></button>
      </div>
      {!search && bars.searchProblem && <p className={styles.note}>{bars.searchProblem}</p>}
      {search && (prompt && searchNode
        ? <PropertyControl key={`${searchNode.id}:${prompt.value}`} control={prompt} label="Prompt" onChange={(id, value) => onNodeChange(searchNode, id, value)} />
        : <div className={styles.row}><span>Prompt</span><span className={styles.note}>{search.prompt ?? 'Worked out in code. Change it in Code.'}</span></div>)}
    </>}
    {tabs && searchTab && <>
      <div className={styles.row}><span>{searchTabNode
        ? <button type="button" className={styles.link} title="Select the search tab" onClick={() => onSelect(searchTabNode)}>Search tab</button>
        : 'Search tab'}</span>
        <button type="button" role="switch" className={inspector.switch} aria-label="Search tab" aria-checked={searchTab.on} disabled={busy || !!searchTab.problem}
          onClick={() => void onNodeCommand(tabs, { kind: searchTab.on ? 'search-tab-remove' : 'search-tab-add' })}><i /></button>
      </div>
      {searchTab.problem && <p className={styles.note}>{searchTab.problem}</p>}
    </>}
  </section>
}

interface SheetProps {
  snapshot?: AuthoringSnapshot
  kind: PageKind
  /** Where the page is opened: the `.sheet(…)` its view is shown by. */
  source?: SourceSpan
  onNodeChange: (node: AuthoringNode, control: string, value: string) => Promise<string | null>
  onReveal: (span: SourceSpan) => void
}

/**
 * How a sheet, popover or full screen cover is presented (Wave 4b): its height, grabber,
 * background, corners and swipe to close. They are written on the one view its closure
 * shows, `EditScreen().presentationDetents([.medium])`, never inside that view's body, so
 * one shown in several places is set at each.
 */
export function SheetSection({ snapshot, kind, source, onNodeChange, onReveal }: SheetProps) {
  if (!snapshot || !source) return null
  const { root, controls, reason } = sheetSettings(snapshot, source)
  const label = PAGE_KINDS[kind].label
  return <section className={styles.section} aria-label={label} data-testid="screen-sheet">
    <div className={styles.sectionHeader}><h3>{label}</h3></div>
    {root && controls.map(control => <PropertyControl key={`${root.id}:${control.id}:${control.value}`} control={control} onChange={(id, value) => onNodeChange(root, id, value)} />)}
    {reason && <div className={styles.row}><span>Settings</span><span className={styles.note}>{reason}<button type="button" className={styles.link} onClick={() => onReveal(source)}>Open in Code</button></span></div>}
  </section>
}
