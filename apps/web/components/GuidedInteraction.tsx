'use client'

import { useState } from 'react'
import type { AuthoringNode, AuthoringOperation, AuthoringSnapshot, BehaviorAction, DesignValue } from '@studio/shared'
import { sourceLayerLabel } from '../lib/sourceLayers'
import styles from './AuthoringInspector.module.css'

const readable = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Screen$/, '').replace(/^./, c => c.toUpperCase())
function uniqueName(label: string, snapshot?: AuthoringSnapshot, suffix = '') {
  const base = label.replace(/[^A-Za-z0-9 ]/g, '').split(/ +/).map((part, index) => index ? part.charAt(0).toUpperCase() + part.slice(1) : part).join('').replace(/^[0-9]+/, '') || 'newValue'
  let name = base + suffix, index = 2
  const existing = new Set([...(snapshot?.nodes.map(n => n.name) ?? []), ...(snapshot?.inputs?.map(n => n.name) ?? []), 'body', 'self', 'true', 'false', 'class', 'struct', 'return', 'var', 'let'])
  while (existing.has(name)) name = base + suffix + index++
  return name
}
export function GuidedInteraction({ node, snapshot, onSelect, onCommand, busy }: { node: AuthoringNode; snapshot?: AuthoringSnapshot; onSelect?: (node: AuthoringNode) => void; onCommand: (op: AuthoringOperation) => Promise<void>; busy: boolean }) {
  const info = node.behavior!
  const [kind, setKind] = useState<'navigate' | 'sheet' | 'cover' | 'dismiss' | 'toggle' | 'set'>('navigate')
  const [destination, setDestination] = useState(info.destinations[0] ?? '__new'), [screenName, setScreenName] = useState('Details')
  const [state, setState] = useState(info.states[0]?.name ?? '__new'), [valueName, setValueName] = useState('joined'), [valueType, setValueType] = useState<'Bool' | 'String' | 'Double'>('Bool')
  const [initial, setInitial] = useState('false'), [value, setValue] = useState(''), [activeTitle, setActiveTitle] = useState('Joined'), [replace, setReplace] = useState(false)
  const current = info.states.find(s => s.name === state), type = current?.type ?? valueType
  const selectedState = state === '__new' ? undefined : state
  const linked = snapshot?.nodes.filter(n => info.dependencies?.find(d => d.state === selectedState)?.nodeIds.includes(n.id)) ?? []
  const actionSource = info.currentAction?.replace(/^[\s{]*|[\s}]*$/g, '').trim() ?? ''
  const hasAction = !!actionSource
  const toggleAction = /^([A-Za-z_][A-Za-z0-9_]*)\.toggle\(\)$/.exec(actionSource)
  const setAction = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(actionSource)
  const presentation = snapshot?.nodes.find(n => n.navigation?.scope === 'presentation' && n.source.file === node.source.file && n.source.start >= node.source.start && n.source.end <= node.source.end)
  const dismissAction = /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(actionSource) && /dismiss/i.test(actionSource)
  const currentActionLabel = !hasAction ? 'Nothing yet' : presentation ? `Opens ${presentation.navigation!.display} as ${presentation.name === 'Full screen cover' ? 'a full screen' : 'a sheet'}` : dismissAction ? 'Goes back / closes this screen' : toggleAction ? `Switches ${readable(toggleAction[1]!)} on / off` : setAction ? `Changes ${readable(setAction[1]!)} to ${setAction[2]}` : 'A custom action from the code (see Advanced)'

  const scalar = (input: string): DesignValue => type === 'Bool' ? input === 'true' : type === 'Double' || type === 'Int' ? Number(input) : input
  const invalidNumber = (kind === 'set' || state === '__new') && ['Int', 'Double'].includes(type) && (!value.trim() || !Number.isFinite(Number(value)) || state === '__new' && (!initial.trim() || !Number.isFinite(Number(initial))))
  const apply = () => {
    const opens = kind === 'navigate' || kind === 'sheet' || kind === 'cover'
    const newScreen = destination === '__new' && opens ? { name: uniqueName(screenName, snapshot, 'Screen'), title: screenName.trim() } : undefined
    const createValue = state === '__new' && (kind === 'toggle' || kind === 'set') ? { name: uniqueName(valueName, snapshot), value: scalar(initial), ...(type === 'Bool' ? { activeTitle } : {}) } : undefined
    const action: BehaviorAction = opens ? { type: kind, destination: newScreen?.name ?? destination } : kind === 'dismiss' ? { type: 'dismiss', state: '' } : kind === 'toggle' ? { type: 'toggle', state: createValue?.name ?? state } : { type: 'set', state: createValue?.name ?? state, value: scalar(value || (type === 'Bool' ? 'true' : value)) }
    void onCommand({ kind: 'guided-action', action, replace, createValue, createScreen: newScreen })
  }
  return <div className={styles.guidedInteraction}>
    {info.canConfigureAction && <>
      <p><strong>Now:</strong> {currentActionLabel}</p>
      <label>{hasAction ? 'Change to' : 'When tapped'}<select aria-label="On tap" value={kind} onChange={e => { setKind(e.target.value as typeof kind); if (e.target.value === 'toggle') { setValueType('Bool'); setInitial('false'); if (current?.type !== 'Bool') setState('__new') } }}>
        <optgroup label="Navigate to"><option value="navigate">Push · slides in with a Back button</option><option value="sheet">Sheet · a card slides up</option><option value="cover">Full screen · covers everything</option><option value="dismiss">Back / Close · returns to the previous screen</option></optgroup>
        <optgroup label="Change a value"><option value="toggle">Switch on / off</option><option value="set">Set a value</option></optgroup>
      </select></label>
      {kind === 'dismiss' ? <p>Closes this screen if it was presented, or goes back one step if it was pushed.</p> : kind === 'navigate' || kind === 'sheet' || kind === 'cover' ? <>
        <label>Screen<select aria-label="Interaction screen" value={destination} onChange={e => setDestination(e.target.value)}>{info.destinations.map(name => <option key={name} value={name}>{readable(name)}</option>)}<option value="__new">+ Create a screen…</option></select></label>
        {destination === '__new' && <label>New screen name<input aria-label="Interaction screen name" value={screenName} maxLength={100} onChange={e => setScreenName(e.target.value)} /></label>}
        <p>{kind === 'navigate' ? 'Opens this screen with a Back button. Navigation is set up automatically.' : kind === 'cover' ? 'Covers the whole screen. Give it a Back / Close button so people can leave.' : 'Opens this screen above the current one. Drag down to close it.'}</p>
      </> : <>
        <label>Value<select aria-label="Interaction value" value={state} onChange={e => setState(e.target.value)}>{info.states.filter(s => ['Bool', 'String', 'Int', 'Double'].includes(s.type)).filter(s => kind !== 'toggle' || s.type === 'Bool' && !s.optional).map(s => <option key={s.name} value={s.name}>{readable(s.name)}</option>)}<option value="__new">+ Create a value…</option></select></label>
        {state === '__new' && <><label>Value name<input aria-label="Interaction value name" value={valueName} onChange={e => setValueName(e.target.value)} /></label>{kind === 'set' && <label>Kind<select aria-label="Interaction value kind" value={valueType} onChange={e => { setValueType(e.target.value as typeof valueType); setInitial(e.target.value === 'Bool' ? 'false' : e.target.value === 'Double' ? '0' : '') }}><option value="Bool">On / off</option><option value="String">Text</option><option value="Double">Number</option></select></label>}
          <label>Starts as{type === 'Bool' ? <select aria-label="Interaction initial value" value={initial} onChange={e => setInitial(e.target.value)}><option value="false">Off</option><option value="true">On</option></select> : <input aria-label="Interaction initial value" value={initial} onChange={e => setInitial(e.target.value)} />}</label>
          {type === 'Bool' && <label>Button label when on<input aria-label="Button label when on" value={activeTitle} onChange={e => setActiveTitle(e.target.value)} /></label>}
        </>}
        {kind === 'set' && <label>Change to{type === 'Bool' ? <select aria-label="Interaction changed value" value={value || 'true'} onChange={e => setValue(e.target.value)}><option value="true">On</option><option value="false">Off</option></select> : <input aria-label="Interaction changed value" value={value} onChange={e => setValue(e.target.value)} />}</label>}
        <div className={styles.valueFlow} aria-label="Value change preview"><span>{state === '__new' ? initial : String(current?.value ?? '')}</span><span aria-hidden="true">→</span><strong>{kind === 'toggle' ? current?.value === true || state === '__new' && initial === 'true' ? 'Off' : 'On' : value || (type === 'Bool' ? 'On' : '…')}</strong></div>
        <p>This value belongs to this screen. {state === '__new' && type === 'Bool' ? 'The button label will show whether it is on or off.' : !linked.length ? 'No visual controls are connected yet.' : 'Connected controls update together.'}</p>
        {!!linked.length && <div className={styles.dependencies} aria-label="Affected controls">{linked.map(layer => <button type="button" key={layer.id} onClick={() => onSelect?.(layer)}>{sourceLayerLabel(layer)}</button>)}</div>}
      </>}
      {hasAction && <label><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Replace this button’s existing action</label>}
      <button type="button" disabled={busy || hasAction && !replace || invalidNumber || (kind === 'navigate' || kind === 'sheet' || kind === 'cover') && destination === '__new' && !screenName.trim() || (kind === 'toggle' || kind === 'set') && state === '__new' && !valueName.trim()} onClick={apply}>Save</button>
    </>}
    {!info.canConfigureAction && !!info.states.length && <details><summary>Values used on this screen</summary>{info.states.map(input => {
      const dependencies = snapshot?.nodes.filter(n => info.dependencies?.find(d => d.state === input.name)?.nodeIds.includes(n.id)) ?? []
      return <div key={input.name}><strong>{readable(input.name)}</strong><p>Starts as {String(input.value)} · {dependencies.length} connected layers</p><div className={styles.dependencies}>{dependencies.map(layer => <button key={layer.id} type="button" onClick={() => onSelect?.(layer)}>{sourceLayerLabel(layer)}</button>)}</div></div>
    })}</details>}
  </div>
}
