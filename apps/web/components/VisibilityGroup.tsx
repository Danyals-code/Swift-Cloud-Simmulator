'use client'

import { useState } from 'react'
import { swiftIdentifier, type AuthoringNode, type AuthoringOperation, type DesignControl } from '@studio/shared'
import { PropertyControl, type PropertyChange } from './PropertyControl'
import { sourceLayerHiddenWords } from '../lib/sourceLayers'
import { shownWhenChoices, shownWhenValue } from '../lib/visibility'
import styles from './AuthoringInspector.module.css'

/** The Shown when choice that makes a new on/off switch. */
const NEW_SWITCH = '__new'

/**
 * The Visibility group of Basics (Wave 5a): when the view is shown, written as an `if` around
 * it, then how it comes and goes, the view it moves with and whether its digits roll, which
 * are the view's `motion:` controls. A new switch starts on, so nothing vanishes while it is
 * designed; Layers keeps a view hidden in this state, dimmed.
 */
export function VisibilityGroup({ node, controls, hiddenView, busy, onCommand, onChange, onShowIt }: { node: AuthoringNode; controls: readonly DesignControl[]; /** When the view isn't drawn in this state, the view its branch holds, as Layers marks it: it says why, and Show it shows it. */ hiddenView?: AuthoringNode; busy: boolean; onCommand?: (operation: AuthoringOperation) => Promise<string | null>; onChange?: PropertyChange; onShowIt?: (node: AuthoringNode) => void }) {
  const visibility = node.visibility
  const [creating, setCreating] = useState(false), [name, setName] = useState(visibility?.newName ?? ''), [startsOn, setStartsOn] = useState(true)
  const [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false)
  const run = async (operation: AuthoringOperation) => {
    if (!onCommand) return 'Select the view again.'
    setPending(true)
    try { const problem = await onCommand(operation); setError(problem); return problem } finally { setPending(false) }
  }
  const { current, choices } = visibility ? shownWhenChoices(visibility) : { current: '', choices: [] }
  // Inside a Main the new on/off is a property each copy sets, not the screen's state (Wave 5b).
  const property = !!visibility?.property
  const choose = (value: string) => {
    setCreating(value === NEW_SWITCH)
    if (value !== NEW_SWITCH && value !== current) void run({ kind: 'visibility', when: visibility?.options.find(option => shownWhenValue(option.when) === value)?.when ?? null })
  }
  const create = async () => { if (!await run({ kind: 'visibility', when: { input: name.trim(), is: true }, create: { name: name.trim(), value: startsOn } })) setCreating(false) }
  return <div className={styles.visibility} role="group" aria-label="Visibility" data-testid="settings-visibility">
    <small>Visibility</small>
    {visibility && <div className={styles.control}>
      <label className={styles.controlLabel}><span>Shown when</span>
        <select aria-label="Shown when" value={creating ? NEW_SWITCH : current} disabled={busy || pending || !visibility.editable || !onCommand} onChange={event => choose(event.target.value)}>
          {choices.map(choice => <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.label}</option>)}
          <option value={NEW_SWITCH}>{property ? '+ New on/off property…' : '+ New on/off switch…'}</option>
        </select>
      </label>
      {visibility.problem && <p className={styles.note}>{visibility.problem}</p>}
    </div>}
    {hiddenView && <p className={styles.note}>{sourceLayerHiddenWords(hiddenView)}. {onShowIt && <button type="button" className={styles.linkButton} disabled={busy} onClick={() => onShowIt(hiddenView)}>Show it</button>}</p>}
    {creating && <div className={styles.control}>
      <label className={styles.controlLabel}><span>{property ? 'Property name' : 'Switch name'}</span><input aria-label={property ? 'New property name' : 'New switch name'} value={name} maxLength={60} onChange={event => setName(event.target.value)} /></label>
      <label className={styles.controlLabel}><span>Starts as</span><select aria-label="New switch starts as" value={String(startsOn)} onChange={event => setStartsOn(event.target.value === 'true')}><option value="true">On</option><option value="false">Off</option></select></label>
      <p className={styles.note}>{property ? `Each copy gets an on/off property called “${name.trim() || '…'}”, and this view shows while it is on.` : `The screen gets a switch called “${name.trim() || '…'}”, and this view shows while it is on.`}</p>
      <div className={styles.destinationActions}><button type="button" disabled={busy || pending || !swiftIdentifier(name.trim())} onClick={() => void create()}>{property ? 'Create property' : 'Create switch'}</button><button type="button" onClick={() => setCreating(false)}>Cancel</button></div>
    </div>}
    {onChange && controls.map(control => <PropertyControl key={`${control.id}:${control.value}`} control={{ ...control, group: undefined }} onChange={onChange} />)}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>
}
