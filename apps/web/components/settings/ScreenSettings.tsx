'use client'

import { useState } from 'react'
import { LAYOUT_WORDS, stackLayoutOf, type AuthoringNode, type AuthoringOperation, type AuthoringSnapshot, type DesignValue, type PreviewInput, type PreviewScenario, type ResourceOperation, type SharedStyle, type SourceSpan, type StateInput } from '@studio/shared'
import { canRename, describeScreen, screenRemovalRefusal, type DesignScreenNode, type DesignTree } from '../../lib/designTree'
import type { ScreenCommand } from '../../lib/screens'
import { screenOverrideModifier, screenRoot, scenarioKey, scenarioScreen } from '../../lib/screens'
import { PAGE_KINDS } from '../../lib/pageKinds'
import { describeState, stateSuggestions } from '../../lib/screenStates'
import { TokenField, valueFields } from './TokenField'
import { BarsSection, SheetSection } from './ScreenBars'
import { searchTabScreen } from '../../lib/screenBars'
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

const OVERRIDES: readonly { modifier: string; label: string }[] = [
  { modifier: 'tint', label: 'Accent color' },
  // Written as current SwiftUI writes it; one written `.foregroundColor` still reads (D9).
  { modifier: 'foregroundStyle', label: 'Text color' },
  { modifier: 'font', label: 'Text style' },
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
  // A screen written inside another opens at its own code, not the view holding it.
  const code = definition?.source ?? screen.page.source
  const root = screenRoot(snapshot, definition)
  const presentation = describeScreen(screen, tree)
  // A `#Preview` is drawn on its own, with no screen's settings or states (Wave 3b).
  const preview = screen.presentation === 'preview'
  const run = async (task: Promise<string | null>) => setError(await task)
  // Duplicate and Remove are planned edits: a refusal shows at the foot of the canvas, as every one does, so it is not said here again.
  const plan = async (task: Promise<string | null>) => { setError(null); await task }
  const removedElsewhere = screenRemovalRefusal(screen, tree)
  const resource = (node: AuthoringNode) => (operation: ResourceOperation) => onNodeCommand(node, operation)
  const background = root ? valueFields(root, root.controls ?? []).find(field => field.style?.label === 'background' || field.control?.label.startsWith('background')) : undefined
  return <div className={styles.panel} data-testid="screen-settings">
    <div className={styles.lede}><strong>{screen.name}</strong><small>{presentation}</small></div>
    <section className={styles.section} aria-label="Screen">
      {!screen.view && <p className={styles.note}>{preview ? 'A #Preview has no settings of its own here. Open it in Code to change it.' : 'This screen is written inside another screen’s code, so it has no settings of its own here. Open it in Code to change it.'}</p>}
      {screen.shared && <p className={styles.note}>Its view draws other screens too, so it is named by its title.</p>}
      {canRename(screen) && <div className={styles.row}><label htmlFor="screen-name">Name</label><input id="screen-name" aria-label="Screen name" maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} onBlur={() => { if (name.trim() && name !== screen.name) void run(onScreenCommand({ kind: 'rename', view: screen.view!, name })) }} onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setName(screen.name) }} /></div>}
      {background && root && <TokenField field={background} label="Background" tokens={tokens} busy={busy} onChange={(id, value) => onNodeChange(root, id, value)} onCommand={resource(root)} />}
      {root && <button type="button" className={styles.button} onClick={() => onSelect(root)}>Edit {rootLabel(root)} settings</button>}
    </section>
    {/* How a sheet is presented is set where it is opened, whichever view it shows (Wave 4b). */}
    {PAGE_KINDS[screen.presentation].once && <SheetSection snapshot={snapshot} kind={screen.presentation} source={screen.page.source} onNodeChange={onNodeChange} onReveal={onReveal} />}
    {!preview && <BarsSection snapshot={snapshot} definition={definition} root={root} tabs={searchTabScreen(snapshot, definition, tree.lanes.some(lane => lane.tab && lane.root.id === screen.id))} busy={busy} onNodeChange={onNodeChange} onNodeCommand={onNodeCommand} onSelect={onSelect} />}
    {root && <section className={styles.section} aria-label="Overrides">
      <div className={styles.sectionHeader}><h3>Overrides</h3></div>
      <p className={styles.note}>Replace an App value on this screen only. Everything on the screen inherits it.</p>
      {OVERRIDES.map(item => {
        const existing = screenOverrideModifier(root, item.modifier)
        if (existing) {
          const fields = valueFields(root, existing.controls, existing.propertyIds)
          return <div key={item.modifier} data-testid={`screen-override-${item.modifier}`}>
            {fields.length > 1 && <div className={styles.sectionHeader}><h3>{item.label}</h3></div>}
            {fields.map((field, index) => <TokenField key={field.control?.id ?? field.style?.property ?? index} field={field} label={fields.length === 1 ? item.label : undefined} tokens={tokens} busy={busy} override onChange={(id, value) => onNodeChange(root, id, value)} onCommand={resource(root)} />)}
            {!fields.length && <div className={styles.row}><span>{item.label} · Set on this screen</span><button type="button" className={styles.button} onClick={() => onReveal(existing.source)}>Open in Code</button></div>}
          </div>
        }
        const available = root.modifierCatalog?.find(entry => entry.name === item.modifier)?.available
        return <div key={item.modifier} className={styles.row}><span>{item.label}</span><button type="button" className={styles.inherit} disabled={busy || !available} title={available ? undefined : 'This screen’s first view cannot take this override yet.'} onClick={() => void run(onNodeCommand(root, { kind: 'modifier-add', name: item.modifier }))}>From App · Override</button></div>
      })}
    </section>}
    {!preview && <ScreenStates key={screen.id} screen={screen} snapshot={snapshot} busy={busy} scenarios={scenarios} active={activeScenario} onSelect={onSelectScenario} onSave={onSaveScenario} onDelete={onDeleteScenario} onCreateValue={onCreateStateValue} />}
    <section className={styles.section} aria-label="Screen actions">
      <div className={styles.actions}>
        {screen.view && <button type="button" className={styles.button} disabled={busy} onClick={() => void plan(onScreenCommand({ kind: 'duplicate', view: screen.view! }))}>Duplicate</button>}
        {screen.view && <button type="button" className={styles.destructive} disabled={busy || !!removedElsewhere} title={removedElsewhere} onClick={() => void plan(onScreenCommand({ kind: 'remove', view: screen.view! }))}>Remove</button>}
        {code && <button type="button" className={styles.button} onClick={() => onReveal(code)}><Icon name="code" size={14} />Open in Code</button>}
      </div>
      {/* Said, not only in the tooltip of a button the keyboard cannot reach. */}
      {screen.view && removedElsewhere && <p className={styles.note}>{removedElsewhere}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  </div>
}

function rootLabel(node: AuthoringNode): string {
  const layout = stackLayoutOf(node.name)
  return layout ? LAYOUT_WORDS[layout].toLowerCase() : ({ List: 'list', ScrollView: 'scroll area', Form: 'form' } as Record<string, string>)[node.name] ?? 'first view'
}

/**
 * The states a screen can be in: loading, empty, error, or anything else its inputs allow.
 *
 * A state never changes the app: it swaps the screen's preview inputs, using branches
 * the Swift already has, so the exported app still starts from its own defaults. The
 * branches the screen's code draws are offered as states by name (Wave 3b), and one the
 * preview can't show says why.
 */
function ScreenStates({ screen, snapshot, busy, scenarios, active, onSelect, onSave, onDelete, onCreateValue }: { screen: DesignScreenNode; snapshot?: AuthoringSnapshot; busy: boolean; scenarios: readonly PreviewScenario[]; active: string; onSelect: (name: string) => void; onSave: ScreenSettingsProps['onSaveScenario']; onDelete: (name: string) => void; onCreateValue: ScreenSettingsProps['onCreateStateValue'] }) {
  const all = (snapshot?.inputs ?? []).filter(input => input.owner === screen.view || input.owner.startsWith(`${screen.view}.`))
  // A condition the preview can't set is not a value a state changes.
  const inputs = all.filter(input => !input.problem)
  const keyOf = (item: { owner: string; name: string }) => `${item.owner}.${item.name}`
  // A list a condition reads is picked as empty or with its items; its records are the same list.
  const collections = (snapshot?.nodes ?? []).flatMap(node => node.collection && node.collection.owner === screen.view && !inputs.some(input => keyOf(input) === keyOf(node.collection!)) ? [node.collection] : [])
  const own = scenarios.filter(scenario => scenarioScreen(scenario) === screen.view)
  const suggestions = stateSuggestions(all, own)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('Empty')
  const [inputKey, setInputKey] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const input = inputs.find(item => keyOf(item) === inputKey)
  const collection = collections.find(item => keyOf(item) === inputKey)
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
    const current = own.find(scenario => scenario.name === name.trim())
    const target = input ?? collection!
    const values = [...(current?.inputs ?? []).filter(item => item.owner !== target.owner || item.name !== target.name), { owner: target.owner, name: target.name, signature: target.signature, value: nextValue }]
    const problem = onSave(name, values)
    setError(problem)
    if (!problem) setAdding(false)
  }
  const choose = (key: string) => {
    setInputKey(key)
    const chosen = inputs.find(item => keyOf(item) === key)
    if (chosen?.choices) setValue(chosen.choices.some(choice => choice.value === chosen.value) ? String(chosen.value) : chosen.choices[0]?.value ?? '')
    else setValue(chosen?.type === 'Date' ? typeof chosen.value === 'number' ? new Date(chosen.value * 1000).toISOString().slice(0, 16) : '' : chosen ? String(chosen.value ?? '') : 'empty')
  }
  return <section className={styles.section} aria-label="States" data-testid="screen-states">
    <div className={styles.sectionHeader}><h3>States</h3><span><button type="button" className={styles.iconButton} aria-label="Add state" title="Add a state" aria-expanded={adding} disabled={busy || !screen.view} onClick={() => { setAdding(!adding); setError(null) }}><Icon name="plus" size={14} /></button></span></div>
    <div className={styles.states}>
      <button type="button" className={styles.stateRow} aria-pressed={!own.some(scenario => scenarioKey(scenario) === active)} onClick={() => onSelect('')}>Default<small>App data</small></button>
      {own.map(scenario => <div key={scenario.name} className={styles.inline}>
        <button type="button" className={styles.stateRow} aria-pressed={scenarioKey(scenario) === active} onClick={() => onSelect(scenarioKey(scenario))}>{scenario.name}<small title={describeState(scenario.inputs, inputs)}>{describeState(scenario.inputs, inputs)}</small></button>
        <button type="button" className={styles.iconButton} aria-label={`Delete state ${scenario.name}`} disabled={busy} onClick={() => onDelete(scenarioKey(scenario))}><Icon name="xmark" size={12} /></button>
      </div>)}
    </div>
    {!!suggestions.offered.length && <div className={styles.states} data-testid="state-suggestions">
      <p className={styles.note}>The screen’s code also draws these. Add one to show it.</p>
      {suggestions.offered.map(state => <button key={state.name} type="button" className={styles.stateRow} aria-label={`Add ${state.name} state`} title={`Add the ${state.name} state and show it · ${describeState(state.inputs, inputs)}`} disabled={busy} onClick={() => setError(onSave(state.name, state.inputs))}>
        <Icon name="plus" size={12} />{state.name}<small>{describeState(state.inputs, inputs)}</small>
      </button>)}
    </div>}
    {!!suggestions.refused.length && <div className={styles.states} data-testid="states-not-offered">
      {/* A reason that starts with what it is about is not headed by it again. */}
      {suggestions.refused.map((state, index) => <p key={`${index}:${state.name}`} className={styles.note}><strong>{state.name}</strong>{state.problem.startsWith(state.name) ? state.problem.slice(state.name.length) : ` · ${state.problem}`}</p>)}
    </div>}
    {!inputs.length && !collections.length && !adding && <p className={styles.note}>A state shows this screen with different content: loading, empty, signed out. Add one and the screen gets a switch it can read.</p>}
    {adding && <div className={styles.tokenRow} data-open>
      <div className={styles.row}><label htmlFor="state-name">Name</label><input id="state-name" aria-label="State name" list="state-names" value={name} onChange={event => setName(event.target.value)} /></div>
      <datalist id="state-names"><option>Loading</option><option>Empty</option><option>Error</option><option>Signed out</option></datalist>
      {!!(inputs.length || collections.length) && <div className={styles.row}><label htmlFor="state-input">Changes</label><select id="state-input" aria-label="State input" value={inputKey} onChange={event => choose(event.target.value)}><option value="" disabled>Choose…</option>{inputs.map(item => <option key={keyOf(item)} value={keyOf(item)}>{item.kind === 'list' ? `${item.name} (list)` : item.name}</option>)}{collections.map(item => <option key={keyOf(item)} value={keyOf(item)}>{item.name} (list)</option>)}<option value={NEW_VALUE}>A new on/off switch…</option></select></div>}
      {creating && <>
        <div className={styles.row}><label htmlFor="state-new-value">Switch</label><input id="state-new-value" aria-label="New value name" value={valueName} placeholder={suggestValueName(name)} onChange={event => setValueName(event.target.value)} /></div>
        <p className={styles.note}>The screen gets a switch called “{suggested}”, off to start with and on in this state. Use it with Shown when, or in any value field, to change what the screen shows.</p>
      </>}
      {input && <div className={styles.row}><label htmlFor="state-value">{input.type === 'Date' ? 'To (UTC)' : 'To'}</label>{input.choices ? <select id="state-value" aria-label="State value" value={value} onChange={event => setValue(event.target.value)}>{input.choices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select> : input.type === 'Bool' || input.options ? <select id="state-value" aria-label="State value" value={value} onChange={event => setValue(event.target.value)}>{(input.options ?? ['true', 'false']).map(option => <option key={option}>{option}</option>)}</select> : <input type={input.type === 'Date' ? 'datetime-local' : 'text'} id="state-value" aria-label="State value" value={value} onChange={event => setValue(event.target.value)} />}</div>}
      {collection && <div className={styles.row}><label htmlFor="state-records">To</label><select id="state-records" aria-label="State records" value={value} onChange={event => setValue(event.target.value)}><option value="empty">No items</option><option value="app">The app’s items</option></select></div>}
      <p className={styles.note}>Only the preview changes. The app still starts from its own values.</p>
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy || saving || !name.trim() || (!creating && !inputKey)} onClick={() => creating ? void createState() : save()}>Save state</button><button type="button" className={styles.button} onClick={() => setAdding(false)}>Cancel</button></div>
    </div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>
}

function parse(input: StateInput, value: string): DesignValue {
  if (input.options || input.choices) return value
  if (input.type === 'Date') return Date.parse(value + 'Z') / 1000
  if (input.type === 'Bool') return value === 'true'
  if (['Int', 'Double'].includes(input.type)) return value === '' ? null : Number(value)
  return value
}
