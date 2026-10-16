'use client'

import { useState } from 'react'
import { ANIMATION_STYLES, ANIMATION_STYLE_WORDS, DEFAULT_ANIMATION_DURATION, offersWhenTapped, takesDuration, type ActionAnimation, type AnimationStyle, type AuthoringNode, type AuthoringOperation, type AuthoringSnapshot, type AlertActionSpec, type BehaviorAction, type DesignValue } from '@studio/shared'
import { screenLabel } from '../lib/screens'
import { alertAction, alertDraft } from '../lib/alertActions'
import { sourceLayerLabel } from '../lib/sourceLayers'
import { actionStatement, animationWords } from '../lib/motion'
import { Icon } from './ui/Icon'
import styles from './AuthoringInspector.module.css'

const readable = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Screen$/, '').replace(/^./, c => c.toUpperCase())
/** A screen as the canvas names it: `PreferencesView` is Preferences. */
function uniqueName(label: string, snapshot?: AuthoringSnapshot, suffix = '') {
  const base = label.replace(/[^A-Za-z0-9 ]/g, '').split(/ +/).map((part, index) => index ? part.charAt(0).toUpperCase() + part.slice(1) : part).join('').replace(/^[0-9]+/, '') || 'newValue'
  let name = base + suffix, index = 2
  const existing = new Set([...(snapshot?.nodes.map(n => n.name) ?? []), ...(snapshot?.inputs?.map(n => n.name) ?? []), 'body', 'self', 'true', 'false', 'class', 'struct', 'return', 'var', 'let'])
  while (existing.has(name)) name = base + suffix + index++
  return name
}
export function GuidedInteraction({ node, snapshot, onSelect, onCommand, busy }: { node: AuthoringNode; snapshot?: AuthoringSnapshot; onSelect?: (node: AuthoringNode) => void; onCommand: (op: AuthoringOperation) => Promise<string | null>; busy: boolean }) {
  const info = node.behavior!
  // A button that already shows an alert starts on it, so Replace changes it in place.
  const [kind, setKind] = useState<'navigate' | 'sheet' | 'cover' | 'dismiss' | 'toggle' | 'set' | 'alert' | 'dialog'>(info.shows?.type ?? 'navigate')
  const [alert, setAlert] = useState(() => alertDraft(info.shows))
  const asks = kind === 'alert' || kind === 'dialog' ? alertAction(kind, alert) : undefined, locked = !!alert.readOnly
  const setButton = (index: number, button: AlertActionSpec) => setAlert({ ...alert, buttons: alert.buttons.map((item, at) => at === index ? button : item) })
  // Nothing is chosen while there are screens to choose from, so Save waits for one.
  const [destination, setDestination] = useState(info.destinations.length ? '' : '__new'), [screenName, setScreenName] = useState('Details')
  const [state, setState] = useState(info.states[0]?.name ?? '__new'), [valueName, setValueName] = useState('joined'), [valueType, setValueType] = useState<'Bool' | 'String' | 'Double'>('Bool')
  const [initial, setInitial] = useState('false'), [value, setValue] = useState(''), [activeTitle, setActiveTitle] = useState('Joined'), [replace, setReplace] = useState(false)
  const current = info.states.find(s => s.name === state), type = current?.type ?? valueType
  const selectedState = state === '__new' ? undefined : state
  const linked = snapshot?.nodes.filter(n => info.dependencies?.find(d => d.state === selectedState)?.nodeIds.includes(n.id)) ?? []
  const actionSource = actionStatement(info.currentAction, !!info.animation)
  const hasAction = !!actionSource
  const toggleAction = /^([A-Za-z_][A-Za-z0-9_]*)\.toggle\(\)$/.exec(actionSource)
  const setAction = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(actionSource)
  const presentation = snapshot?.nodes.find(n => n.navigation?.scope === 'presentation' && n.source.file === node.source.file && n.source.start >= node.source.start && n.source.end <= node.source.end)
  const dismissAction = /^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(actionSource) && /dismiss/i.test(actionSource)
  // Any other view is made tappable by what is chosen here, and keeps its look (D16).
  const taps = offersWhenTapped(info)
  const currentActionLabel = !info.canConfigureAction ? 'Nothing yet. Choosing what a tap does makes it tappable, and it keeps its look.' : !hasAction ? 'Nothing yet' : info.shows ? `${info.shows.type === 'alert' ? 'Show alert' : 'Show options'}: ${info.shows.title}` : presentation ? `Opens ${presentation.navigation!.display} as ${presentation.name === 'Full screen cover' ? 'a full screen' : 'a sheet'}` : dismissAction ? 'Goes back / closes this screen' : toggleAction ? `Switches ${readable(toggleAction[1]!)} on / off` : setAction ? `Changes ${readable(setAction[1]!)} to ${setAction[2]}` : 'A custom action from the code (see Advanced)'
  // A change a tap makes can animate (Wave 5a): the action there is animated in place, and a new one as it is saved.
  const [animation, setAnimation] = useState<ActionAnimation | null>(null)
  const animates = hasAction ? !info.shows && !presentation && !dismissAction || !!info.animation : kind === 'toggle' || kind === 'set'

  const scalar = (input: string): DesignValue => type === 'Bool' ? input === 'true' : type === 'Double' || type === 'Int' ? Number(input) : input
  const invalidNumber = (kind === 'set' || state === '__new') && ['Int', 'Double'].includes(type) && (!value.trim() || !Number.isFinite(Number(value)) || state === '__new' && (!initial.trim() || !Number.isFinite(Number(initial))))
  const apply = () => {
    if (asks) { if ('action' in asks) void onCommand({ kind: 'guided-action', action: asks.action, replace }); return }
    const opens = kind === 'navigate' || kind === 'sheet' || kind === 'cover'
    const newScreen = destination === '__new' && opens ? { name: uniqueName(screenName, snapshot, 'Screen'), title: screenName.trim() } : undefined
    const createValue = state === '__new' && (kind === 'toggle' || kind === 'set') ? { name: uniqueName(valueName, snapshot), value: scalar(initial), ...(type === 'Bool' && info.titled ? { activeTitle } : {}) } : undefined
    const action: BehaviorAction = opens ? { type: kind, destination: newScreen?.name ?? destination } : kind === 'dismiss' ? { type: 'dismiss', state: '' } : kind === 'toggle' ? { type: 'toggle', state: createValue?.name ?? state } : { type: 'set', state: createValue?.name ?? state, value: scalar(value || (type === 'Bool' ? 'true' : value)) }
    // Replace keeps the action's animation, which the Animate row above sets in place.
    void onCommand({ kind: 'guided-action', action: !hasAction && animation && (kind === 'toggle' || kind === 'set') ? { ...action, animation } : action, replace, createValue, createScreen: newScreen })
  }
  return <div className={styles.guidedInteraction}>
    {taps && <>
      <p><strong>Now:</strong> {currentActionLabel}{info.animation && ` · animated, ${animationWords(info.animation)}`}</p>
      {/* A new instance for each read-back, so what the code now says replaces the choice shown while it was written (Wave 5a). */}
      {animates && hasAction && <AnimateRow key={info.animation ? `on:${info.animation.written}` : 'off'} current={info.animation ? info.animation.style ? { style: info.animation.style, duration: info.animation.duration } : info.animation.written : null} busy={busy} onChange={next => onCommand({ kind: 'animate-action', animation: next })} />}
      <label>{hasAction ? 'Change to' : 'When tapped'}<select aria-label="On tap" value={kind} onChange={e => { setKind(e.target.value as typeof kind); if (e.target.value === 'toggle') { setValueType('Bool'); setInitial('false'); if (current?.type !== 'Bool') setState('__new') } }}>
        <optgroup label="Navigate to"><option value="navigate">Push · slides in with a Back button</option><option value="sheet">Sheet · a card slides up</option><option value="cover">Full screen · covers everything</option><option value="dismiss">Back / Close · returns to the previous screen</option></optgroup>
        <optgroup label="Ask first"><option value="alert">Show alert · asks before going on</option><option value="dialog">Show options · choices slide up from the bottom</option></optgroup>
        <optgroup label="Change a value"><option value="toggle">Switch on / off</option><option value="set">Set a value</option></optgroup>
      </select></label>
      {kind === 'dismiss' ? <p>Closes this screen if it was presented, or goes back one step if it was pushed.</p> : asks ? <>
        {/* An alert the panel can't write back exactly is shown as read, never saved over (Wave 4a). */}
        {locked && <p className={styles.note}>{alert.readOnly}</p>}
        <label>Title<input aria-label="Alert title" value={alert.title} maxLength={200} readOnly={locked} onChange={e => setAlert({ ...alert, title: e.target.value })} /></label>
        <label>Message<input aria-label="Alert message" placeholder="Optional" value={alert.message} maxLength={400} readOnly={locked} onChange={e => setAlert({ ...alert, message: e.target.value })} /></label>
        <div className={styles.alertButtons} role="group" aria-label="Alert buttons">
          {alert.buttons.map((button, index) => <div key={index}>
            <input aria-label={`Button ${index + 1} title`} value={button.title} maxLength={100} readOnly={locked} onChange={e => setButton(index, { ...button, title: e.target.value })} />
            <select aria-label={`Button ${index + 1} role`} value={button.role ?? ''} disabled={locked} onChange={e => setButton(index, e.target.value ? { title: button.title, role: e.target.value as 'destructive' | 'cancel' } : { title: button.title })}><option value="">None</option><option value="destructive">Destructive</option><option value="cancel">Cancel</option></select>
            {!locked && <button type="button" aria-label={`Remove button ${index + 1}`} title="Remove" onClick={() => setAlert({ ...alert, buttons: alert.buttons.filter((_, at) => at !== index) })}><Icon name="minus" size={12} /></button>}
          </div>)}
          {!locked && <button type="button" onClick={() => setAlert({ ...alert, buttons: [...alert.buttons, { title: 'OK' }] })}>Add button</button>}
        </div>
        <p>{kind === 'alert' ? 'Asks in the middle of the screen. It is listed under this screen as an Alert, where its words can be changed.' : 'Offers these choices from the bottom of the screen. It is listed under this screen as a Confirmation dialog, where its words can be changed.'}</p>
        {'problem' in asks && !locked && <p className={styles.note}>{asks.problem}</p>}
      </> : kind === 'navigate' || kind === 'sheet' || kind === 'cover' ? <>
        <label>Screen<select aria-label="Interaction screen" value={destination} onChange={e => setDestination(e.target.value)}>{!destination && <option value="" disabled>Choose…</option>}{info.destinations.map(name => <option key={name} value={name}>{readable(screenLabel(name))}</option>)}<option value="__new">+ Create a screen…</option></select></label>
        {destination === '__new' && <label>New screen name<input aria-label="Interaction screen name" value={screenName} maxLength={100} onChange={e => setScreenName(e.target.value)} /></label>}
        <p>{kind === 'navigate' ? 'Opens this screen with a Back button. Navigation is set up automatically.' : kind === 'cover' ? 'Covers the whole screen. Give it a Back / Close button so people can leave.' : 'Opens this screen above the current one. Drag down to close it.'}</p>
      </> : <>
        <label>Value<select aria-label="Interaction value" value={state} onChange={e => setState(e.target.value)}>{info.states.filter(s => ['Bool', 'String', 'Int', 'Double'].includes(s.type)).filter(s => kind !== 'toggle' || s.type === 'Bool' && !s.optional).map(s => <option key={s.name} value={s.name}>{readable(s.name)}</option>)}<option value="__new">+ Create a value…</option></select></label>
        {state === '__new' && <><label>Value name<input aria-label="Interaction value name" value={valueName} onChange={e => setValueName(e.target.value)} /></label>{kind === 'set' && <label>Kind<select aria-label="Interaction value kind" value={valueType} onChange={e => { setValueType(e.target.value as typeof valueType); setInitial(e.target.value === 'Bool' ? 'false' : e.target.value === 'Double' ? '0' : '') }}><option value="Bool">On / off</option><option value="String">Text</option><option value="Double">Number</option></select></label>}
          <label>Starts as{type === 'Bool' ? <select aria-label="Interaction initial value" value={initial} onChange={e => setInitial(e.target.value)}><option value="false">Off</option><option value="true">On</option></select> : <input aria-label="Interaction initial value" value={initial} onChange={e => setInitial(e.target.value)} />}</label>
          {type === 'Bool' && info.titled && <label>Button label when on<input aria-label="Button label when on" value={activeTitle} onChange={e => setActiveTitle(e.target.value)} /></label>}
        </>}
        {kind === 'set' && <label>Change to{type === 'Bool' ? <select aria-label="Interaction changed value" value={value || 'true'} onChange={e => setValue(e.target.value)}><option value="true">On</option><option value="false">Off</option></select> : <input aria-label="Interaction changed value" value={value} onChange={e => setValue(e.target.value)} />}</label>}
        <div className={styles.valueFlow} aria-label="Value change preview"><span>{state === '__new' ? initial : String(current?.value ?? '')}</span><span aria-hidden="true">→</span><strong>{kind === 'toggle' ? current?.value === true || state === '__new' && initial === 'true' ? 'Off' : 'On' : value || (type === 'Bool' ? 'On' : '…')}</strong></div>
        <p>This value belongs to this screen. {state === '__new' && type === 'Bool' && info.titled ? 'The button label will show whether it is on or off.' : !linked.length ? 'No visual controls are connected yet.' : 'Connected controls update together.'}</p>
        {!!linked.length && <div className={styles.dependencies} aria-label="Affected controls">{linked.map(layer => <button type="button" key={layer.id} onClick={() => onSelect?.(layer)}>{sourceLayerLabel(layer)}</button>)}</div>}
      </>}
      {animates && !hasAction && <AnimateRow current={animation} busy={busy} onChange={setAnimation} />}
      {hasAction && <label><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />Replace this button’s existing action</label>}
      <button type="button" disabled={busy || hasAction && !replace || invalidNumber || !!asks && 'problem' in asks || (kind === 'navigate' || kind === 'sheet' || kind === 'cover') && (!destination || destination === '__new' && !screenName.trim()) || (kind === 'toggle' || kind === 'set') && state === '__new' && !valueName.trim()} onClick={apply}>Save</button>
    </>}
    {!taps && !!info.states.length && <details><summary>Values used on this screen</summary>{info.states.map(input => {
      const dependencies = snapshot?.nodes.filter(n => info.dependencies?.find(d => d.state === input.name)?.nodeIds.includes(n.id)) ?? []
      return <div key={input.name}><strong>{readable(input.name)}</strong><p>Starts as {String(input.value)} · {dependencies.length} connected layers</p><div className={styles.dependencies}>{dependencies.map(layer => <button key={layer.id} type="button" onClick={() => onSelect?.(layer)}>{sourceLayerLabel(layer)}</button>)}</div></div>
    })}</details>}
  </div>
}

/**
 * Animate this change (Wave 5a): off, or the style the change plays with, Smooth to start,
 * and a duration for the two that take one. `current` is a curve Design doesn't name as the
 * code writes it, which a style replaces. The designer's choice shows at once, and the action
 * as read back once it is written; a refusal, which `onChange` returns, puts it back.
 */
function AnimateRow({ current, busy, onChange }: { current: ActionAnimation | string | null; busy: boolean; onChange: (animation: ActionAnimation | null) => Promise<string | null> | void }) {
  const [chosen, setChosen] = useState<{ readonly animation: ActionAnimation | null }>()
  const shown = chosen ? chosen.animation : current
  const choose = (animation: ActionAnimation | null) => {
    setChosen({ animation })
    void Promise.resolve(onChange(animation)).then(problem => { if (problem) setChosen(undefined) })
  }
  const named = typeof shown === 'object' ? shown : null
  const [duration, setDuration] = useState(String(named?.duration ?? DEFAULT_ANIMATION_DURATION))
  const timed = takesDuration(named?.style)
  const commitDuration = () => { const seconds = Number(duration); if (named && timed && seconds > 0 && seconds !== (named.duration ?? DEFAULT_ANIMATION_DURATION)) choose({ style: named.style, duration: seconds }) }
  return <>
    <label><input type="checkbox" aria-label="Animate this change" checked={shown !== null} disabled={busy} onChange={e => choose(e.target.checked ? { style: 'smooth' } : null)} />Animate this change</label>
    {shown !== null && <>
      <label>Style<select aria-label="Animation style" value={named?.style ?? ''} disabled={busy} onChange={e => { const style = e.target.value as AnimationStyle; choose(takesDuration(style) ? { style, duration: Number(duration) > 0 ? Number(duration) : DEFAULT_ANIMATION_DURATION } : { style }) }}>
        {typeof shown === 'string' && <option value="" disabled>{shown}</option>}
        {ANIMATION_STYLES.map(style => <option key={style} value={style}>{ANIMATION_STYLE_WORDS[style]}</option>)}
      </select></label>
      {timed && <label>Duration<input aria-label="Animation duration" inputMode="decimal" value={duration} disabled={busy} onChange={e => setDuration(e.target.value)} onBlur={commitDuration} onKeyDown={e => { if (e.key === 'Enter') commitDuration() }} /></label>}
      <p className={styles.note}>Plays in Preview. The Design canvas stays still.</p>
    </>}
  </>
}
