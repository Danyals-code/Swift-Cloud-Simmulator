'use client'

import { useState } from 'react'
import type { AuthoringNode, AuthoringOperation, AuthoringSnapshot, DesignValue, PreviewInput, PreviewScenario, ResourceOperation, SharedStyle, SourceSpan, StateInput } from '@studio/shared'
import type { DesignScreenNode, DesignTree } from '../../lib/designTree'
import type { ScreenCommand } from '../../lib/screens'
import { screenRoot, screenTitleControl, scenarioScreen } from '../../lib/screens'
import { PropertyControl } from '../PropertyControl'
import { TokenField, valueFields } from './TokenField'
import { Icon } from '../ui/Icon'
import styles from './Settings.module.css'

export interface ScreenSettingsProps {
  screen: DesignScreenNode
  tree: DesignTree
  snapshot?: AuthoringSnapshot
  tokens: readonly SharedStyle[]
  busy: boolean
  scenarios: readonly PreviewScenario[]
  activeScenario: string
  onSelectScenario: (name: string) => void
  onSaveScenario: (name: string, inputs: readonly PreviewInput[]) => string | null
  onDeleteScenario: (name: string) => void
  /** Gives the screen a switch and saves a state that turns it on, in one step. */
  onCreateStateValue: (view: string, state: string, value: { name: string; initial: boolean; when: boolean }) => Promise<string | null>
  onScreenCommand: (command: ScreenCommand) => Promise<string | null>
  onNodeChange: (node: AuthoringNode, control: string, value: string) => Promise<string | null>
  onNodeCommand: (node: AuthoringNode, operation: AuthoringOperation) => Promise<string | null>
  onSelect: (node: AuthoringNode) => void
  onReveal: (span: SourceSpan) => void
}

/** The "make one" row in the Changes list. */
const NEW_VALUE = '__new__'
/** A switch name from the state's own name: "Signed out" becomes `signedOut`. */
function suggestValueName(state: string): string {
  const words = state.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const name = words.map((word, index) => index ? word.charAt(0).toUpperCase() + word.slice(1) : word).join('')
  if (!name) return 'showing'
  return /^[a-z]/.test(name) ? name : `is${name.charAt(0).toUpperCase()}${name.slice(1)}`
}

const OVERRIDES: readonly { modifier: string; label: string; property: string }[] = [
  { modifier: 'tint', label: 'Accent color', property: 'tint' },
  { modifier: 'foregroundColor', label: 'Text color', property: 'foregroundColor' },
  { modifier: 'font', label: 'Text style', property: 'font' },
]

/**
 * The Screen level: how one screen is reached, what it is called, and the states it
 * can be in. Values set here flow down to everything on the screen, and one that
 * replaces an App-wide value is marked as an override.
 */
export function ScreenSettings({ screen, tree, snapshot, tokens, busy, scenarios, activeScenario, onSelectScenario, onSaveScenario, onDeleteScenario, onCreateStateValue, onScreenCommand, onNodeChange, onNodeCommand, onSelect, onReveal }: ScreenSettingsProps) {
  const [name, setName] = useState(screen.name)
  const [savedName, setSavedName] = useState(screen.name)
  const [error, setError] = useState<string | null>(null)
  if (savedName !== screen.name) { setSavedName(screen.name); setName(screen.name) }
  const definition = snapshot?.nodes.find(node => node.kind === 'definition' && node.name === screen.view)
  const root = screenRoot(snapshot, definition)
  const title = screenTitleControl(snapshot, definition)
  const presentation = describePresentation(screen, tree)
  const run = async (task: Promise<string | null>) => setError(await task)
  const resource = (node: AuthoringNode) => (operation: ResourceOperation) => onNodeCommand(node, operation)
  const background = root ? valueFields(root, root.controls ?? []).find(field => field.style?.label === 'background' || field.control?.label.startsWith('background')) : undefined
  return <div className={styles.panel} data-testid="screen-settings">
    <div className={styles.lede}><strong>{screen.name}</strong><small>{presentation}</small></div>
    <section className={styles.section} aria-label="Screen">
      {screen.view && <div className={styles.row}><label htmlFor="screen-name">Name</label><input id="screen-name" aria-label="Screen name" maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} onBlur={() => { if (name.trim() && name !== screen.name) void run(onScreenCommand({ kind: 'rename', view: screen.view!, name })) }} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setName(screen.name) }} /></div>}
      {title ? <PropertyControl key={`${title.node.id}:${title.control.value}`} control={title.control} label="Title" onChange={(id, value) => onNodeChange(title.node, id, value)} />
        : root && <p className={styles.note}>No title bar title. Add a Title modifier to the screen’s first view to show one.</p>}
      {background && root && <TokenField field={background} label="Background" tokens={tokens} busy={busy} onChange={(id, value) => onNodeChange(root, id, value)} onCommand={resource(root)} />}
      {root && <button type="button" className={styles.link} onClick={() => onSelect(root)}>Edit {rootLabel(root)} settings</button>}
    </section>
    {root && <section className={styles.section} aria-label="Overrides">
      <div className={styles.sectionHeader}><h3>Overrides</h3></div>
      <p className={styles.note}>Replace an App value on this screen only. Everything on the screen inherits it.</p>
      {OVERRIDES.map(item => {
        const field = valueFields(root, root.controls ?? []).find(candidate => candidate.style?.label === item.property)
        if (field) return <TokenField key={item.modifier} field={field} label={item.label} tokens={tokens} busy={busy} override onChange={(id, value) => onNodeChange(root, id, value)} onCommand={resource(root)} />
        const available = root.modifierCatalog?.find(entry => entry.name === item.modifier)?.available
        return <div key={item.modifier} className={styles.row}><span>{item.label}</span><button type="button" className={styles.link} disabled={busy || !available} title={available ? undefined : 'This screen’s first view cannot take this override yet.'} onClick={() => void run(onNodeCommand(root, { kind: 'modifier-add', name: item.modifier }))}>From App · Override</button></div>
      })}
    </section>}
    <ScreenStates key={screen.id} screen={screen} snapshot={snapshot} busy={busy} scenarios={scenarios} active={activeScenario} onSelect={onSelectScenario} onSave={onSaveScenario} onDelete={onDeleteScenario} onCreateValue={onCreateStateValue} />
    <section className={styles.section} aria-label="Screen actions">
      <div className={styles.actions}>
        {screen.view && <button type="button" className={styles.button} disabled={busy} onClick={() => void run(onScreenCommand({ kind: 'duplicate', view: screen.view! }))}>Duplicate</button>}
        {screen.view && <button type="button" className={styles.button} disabled={busy} onClick={() => void run(onScreenCommand({ kind: 'remove', view: screen.view! }))}>Remove</button>}
        {definition && <button type="button" className={styles.button} onClick={() => onReveal(definition.source)}><Icon name="code" size={12} />Open in Code</button>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  </div>
}

function rootLabel(node: AuthoringNode): string {
  return ({ VStack: 'column', HStack: 'row', ZStack: 'layers', List: 'list', ScrollView: 'scroll area', Form: 'form' } as Record<string, string>)[node.name] ?? 'first view'
}

function describePresentation(screen: DesignScreenNode, tree: DesignTree): string {
  const byId = new Map<string, DesignScreenNode>()
  const index = (node: DesignScreenNode) => { byId.set(node.id, node); node.children.forEach(index) }
  tree.lanes.forEach(lane => index(lane.root)); tree.sheets.forEach(sheet => index(sheet.screen)); tree.detached.forEach(index)
  const lane = tree.lanes.find(candidate => candidate.root.id === screen.id)
  if (lane) return lane.tab ? `Tab · ${lane.name}` : 'The app starts here'
  if (tree.detached.some(node => node.id === screen.id)) return 'Not linked yet · add Navigate to on a button to connect it'
  const sheet = tree.sheets.find(candidate => candidate.screen.id === screen.id)
  const kind = screen.presentation === 'cover' ? 'Full screen' : screen.presentation === 'popover' ? 'Popover' : 'Sheet'
  if (sheet) return `${kind} · opened from ${sheet.openers.map(id => byId.get(id)?.name ?? 'a screen').join(', ')}`
  const parent = [...byId.values()].find(candidate => candidate.children.some(child => child.id === screen.id))
  return parent ? `Pushed from ${parent.name}` : 'Screen'
}

/**
 * The states a screen can be in: loading, empty, error, or anything else its inputs allow.
 *
 * A state never changes the app: it swaps the screen's preview inputs, using branches
 * the Swift already has, so the exported app still starts from its own defaults.
 */
function ScreenStates({ screen, snapshot, busy, scenarios, active, onSelect, onSave, onDelete, onCreateValue }: { screen: DesignScreenNode; snapshot?: AuthoringSnapshot; busy: boolean; scenarios: readonly PreviewScenario[]; active: string; onSelect: (name: string) => void; onSave: ScreenSettingsProps['onSaveScenario']; onDelete: (name: string) => void; onCreateValue: ScreenSettingsProps['onCreateStateValue'] }) {
  const inputs = (snapshot?.inputs ?? []).filter(input => input.owner === screen.view || input.owner.startsWith(`${screen.view}.`))
  const collections = (snapshot?.nodes ?? []).flatMap(node => node.collection && node.collection.owner === screen.view ? [node.collection] : [])
  const own = scenarios.filter(scenario => scenarioScreen(scenario) === screen.view)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('Empty')
  const [inputKey, setInputKey] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const input = inputs.find(item => `${item.owner}.${item.name}` === inputKey)
  const collection = collections.find(item => `${item.owner}.${item.name}` === inputKey)
  // A screen with nothing to switch cannot have states, so the form makes the first
  // value itself rather than telling a designer to go and find one.
  const creating = inputKey === NEW_VALUE || (!inputs.length && !collections.length)
  const [valueName, setValueName] = useState('')
  const suggested = valueName.trim() || suggestValueName(name)
  const createState = async () => {
    setSaving(true)
    try {
      const problem = await onCreateValue(screen.view ?? '', name.trim(), { name: suggested, initial: false, when: true })
      setError(problem)
      if (!problem) { setAdding(false); setValueName('') }
    } finally { setSaving(false) }
  }
  const save = () => {
    let nextValue: PreviewInput['value']
    if (collection) nextValue = value === 'empty' ? [] : collection.records
    else if (input) nextValue = parse(input, value)
    else { setError('Choose what the state changes.'); return }
    const current = scenarios.find(scenario => scenario.name === name.trim())
    const target = input ?? collection!
    const values = [...(current?.inputs ?? []).filter(item => item.owner !== target.owner || item.name !== target.name), { owner: target.owner, name: target.name, signature: target.signature, value: nextValue }]
    const problem = onSave(name, values)
    setError(problem)
    if (!problem) setAdding(false)
  }
  return <section className={styles.section} aria-label="States" data-testid="screen-states">
    <div className={styles.sectionHeader}><h3>States</h3><span><button type="button" className={styles.iconButton} aria-label="Add state" title="Add a state" aria-expanded={adding} disabled={busy || !screen.view} onClick={() => { setAdding(!adding); setError(null) }}><Icon name="plus" size={13} /></button></span></div>
    <div className={styles.states}>
      <button type="button" className={styles.stateRow} aria-pressed={!own.some(scenario => scenario.name === active)} onClick={() => onSelect('')}>Default<small>App data</small></button>
      {own.map(scenario => <div key={scenario.name} className={styles.inline}>
        <button type="button" className={styles.stateRow} aria-pressed={scenario.name === active} onClick={() => onSelect(scenario.name)}>{scenario.name}<small>{scenario.inputs?.map(item => Array.isArray(item.value) ? `${item.name}: ${item.value.length} items` : `${item.name}: ${String(item.value)}`).join(', ')}</small></button>
        <button type="button" className={styles.iconButton} aria-label={`Delete state ${scenario.name}`} disabled={busy} onClick={() => onDelete(scenario.name)}><Icon name="xmark" size={11} /></button>
      </div>)}
    </div>
    {!inputs.length && !collections.length && !adding && <p className={styles.note}>A state shows this screen with different content — loading, empty, signed out. Add one and the screen gets a switch it can read.</p>}
    {adding && <div className={styles.tokenRow} data-open>
      <div className={styles.row}><label htmlFor="state-name">Name</label><input id="state-name" aria-label="State name" list="state-names" value={name} onChange={event => setName(event.target.value)} /></div>
      <datalist id="state-names"><option>Loading</option><option>Empty</option><option>Error</option><option>Signed out</option></datalist>
      {!!(inputs.length || collections.length) && <div className={styles.row}><label htmlFor="state-input">Changes</label><select id="state-input" aria-label="State input" value={inputKey} onChange={event => { setInputKey(event.target.value); const chosen = inputs.find(item => `${item.owner}.${item.name}` === event.target.value); setValue(chosen ? String(chosen.value ?? '') : 'empty') }}><option value="" disabled>Choose…</option>{inputs.map(item => <option key={`${item.owner}.${item.name}`} value={`${item.owner}.${item.name}`}>{item.name}</option>)}{collections.map(item => <option key={`${item.owner}.${item.name}`} value={`${item.owner}.${item.name}`}>{item.name} (list)</option>)}<option value={NEW_VALUE}>A new on/off switch…</option></select></div>}
      {creating && <>
        <div className={styles.row}><label htmlFor="state-new-value">Switch</label><input id="state-new-value" aria-label="New value name" value={valueName} placeholder={suggestValueName(name)} onChange={event => setValueName(event.target.value)} /></div>
        <p className={styles.note}>The screen gets a switch called “{suggested}”, off to start with and on in this state. Use it with Shown when, or in any value field, to change what the screen shows.</p>
      </>}
      {input && <div className={styles.row}><label htmlFor="state-value">To</label>{input.type === 'Bool' || input.options ? <select id="state-value" aria-label="State value" value={value} onChange={event => setValue(event.target.value)}>{(input.options ?? ['true', 'false']).map(option => <option key={option}>{option}</option>)}</select> : <input id="state-value" aria-label="State value" value={value} onChange={event => setValue(event.target.value)} />}</div>}
      {collection && <div className={styles.row}><label htmlFor="state-records">To</label><select id="state-records" aria-label="State records" value={value} onChange={event => setValue(event.target.value)}><option value="empty">No items</option><option value="app">The app’s items</option></select></div>}
      <p className={styles.note}>Only the preview changes. The app still starts from its own values.</p>
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || saving || !name.trim() || (!creating && !inputKey)} onClick={() => creating ? void createState() : save()}>Save state</button><button type="button" className={styles.button} onClick={() => setAdding(false)}>Cancel</button></div>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>
}

function parse(input: StateInput, value: string): DesignValue {
  if (input.options) return value
  if (input.type === 'Bool') return value === 'true'
  if (['Int', 'Double'].includes(input.type)) return value === '' ? null : Number(value)
  return value
}
