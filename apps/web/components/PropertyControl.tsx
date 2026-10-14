'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { AUTO_SPACING, LAYOUT_WORDS, spreadOut, type Alignment9, type DesignControl } from '@studio/shared'
import { Icon, type IconName } from './ui/Icon'
import { COLOR_NAME_LABELS } from '../lib/colorValue'
import styles from './AuthoringInspector.module.css'

const RANGE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
const OPTION_LABELS: Record<string, string> = {
  Row: LAYOUT_WORDS.HStack, Column: LAYOUT_WORDS.VStack, Stack: LAYOUT_WORDS.ZStack,
  largeTitle: 'Large title', title: 'Title', title2: 'Title 2', title3: 'Title 3',
  ...COLOR_NAME_LABELS,
  borderedProminent: 'Filled', bordered: 'Bordered', borderless: 'Borderless', plain: 'Plain',
  leading: 'Start', trailing: 'End', firstTextBaseline: 'First text baseline', lastTextBaseline: 'Last text baseline',
  topLeading: 'Top start', topTrailing: 'Top end', bottomLeading: 'Bottom start', bottomTrailing: 'Bottom end',
}
export function propertyOptionLabel(value: string): string {
  return OPTION_LABELS[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())
}

/** `value` times `scale`, with no float noise; text that isn't a number is left for the check to refuse. */
function scaled(value: string, scale: number): string {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? String(Number((Number(value) * scale).toPrecision(12))) : value
}
/** A value as its field shows it: a share of one as a percentage, so 0.5 shows as 50. */
const shown = (control: DesignControl, value: string) => control.unit === '%' ? scaled(value, 100) : value
/** What a typed value means in Swift: a percentage as a share of one, and the unit it may be typed with left off. */
function stored(control: DesignControl, typed: string): string {
  const bare = control.unit ? typed.replace(new RegExp(`\\s*${control.unit}\\s*$`), '') : typed
  return control.unit === '%' ? scaled(bare, 0.01) : bare
}
/** A value as a card's summary reads it: a choice by its name, and a percentage or an angle with its sign. */
export function propertyValueLabel(control: DesignControl): string {
  if (control.kind === 'select' || control.kind === 'toggle') return propertyOptionLabel(control.value)
  return control.value ? shown(control, control.value) + (control.unit === '%' || control.unit === '°' ? control.unit : '') : 'Default'
}

export type PropertyChange = (control: string, value: string) => Promise<string | null>

/** Each choice of a stack's Layout and Alignment, in the order Figma shows them, with its glyph (D4); a Text's alignment is `across`. */
export const CHOICES = {
  layout: [['Column', 'stack-v'], ['Row', 'stack-h'], ['Stack', 'stack-z']],
  across: [['leading', 'align-left'], ['center', 'align-center-x'], ['trailing', 'align-right']],
  down: [['top', 'align-top'], ['center', 'align-center-y'], ['bottom', 'align-bottom'], ['firstTextBaseline', 'align-baseline'], ['lastTextBaseline', 'align-baseline-last']],
} as const satisfies Readonly<Record<string, readonly (readonly [string, IconName])[]>>
/** An Overlap's nine places, row by row: a frame's alignment and a pin take them too. */
export const PLACES: readonly Alignment9[] = ['topLeading', 'top', 'topTrailing', 'leading', 'center', 'trailing', 'bottomLeading', 'bottom', 'bottomTrailing']

/**
 * Choices as one radio group of icon buttons, each named as its option reads: a row of
 * glyphs, or, for options without one such as `PLACES`, a 3 by 3 grid of dots.
 */
export function Choices<T extends string>({ label, options, value, disabled, onChoose, controlId }: { label: string; options: readonly (T | readonly [T, IconName])[]; value: T | null; disabled: boolean; onChoose: (option: T) => void; controlId?: string }) {
  return <div role="radiogroup" aria-label={label} data-control-id={controlId} className={typeof options[0] === 'string' ? styles.places : styles.choices}>
    {options.map(entry => {
      const [option, icon] = typeof entry === 'string' ? [entry, undefined] as const : entry
      return <button key={option} type="button" role="radio" aria-checked={value === option} aria-label={propertyOptionLabel(option)} title={propertyOptionLabel(option)} disabled={disabled} onClick={() => { if (option !== value) onChoose(option) }}>{icon ? <Icon name={icon} size={14} /> : <i />}</button>
    })}
  </div>
}

/**
 * The icon buttons a control is drawn as, or none for a menu: a stack's Layout, and a
 * Column's or Row's Alignment, which its options tell apart (a Row's run top to bottom;
 * an Overlap's nine places are drawn as a grid instead).
 */
function choicesFor(control: DesignControl): readonly (readonly [string, IconName])[] | undefined {
  const options = control.options ?? []
  const set = control.id === 'layout' ? CHOICES.layout : control.id === 'alignment' && !options.includes('topLeading') ? options.includes('top') ? CHOICES.down : CHOICES.across : undefined
  return set?.filter(([option]) => options.includes(option))
}

/** `label` names the control for assistive tech; `caption`, when given, is what the row shows instead. */
export function PropertyControl({ control, onChange, label = control.label, caption }: { control: DesignControl; onChange: PropertyChange; label?: string; caption?: string }) {
  // The field works in what it shows, and a commit turns that back into Swift's value.
  const initial = shown(control, control.value)
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const latest = useRef(initial)
  const committing = useRef(false)
  const cancelBlur = useRef(false)
  const cancelledGesture = useRef(false)
  /**
   * The slider drag under way, and how to stop listening for it. WebKit doesn't focus a
   * slider it is dragged by: a press on one that has focus blurs it, which saved the
   * first value of the drag, and Escape goes to the canvas, which deselected the view
   * (C6). A drag whose release never comes, as when the window loses focus, ends there.
   */
  const drag = useRef<{ readonly stop: () => void } | null>(null)
  function startDrag() {
    cancelledGesture.current = false
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelledGesture.current = true
      cancel()
    }
    const leave = () => { endDrag(); finishDrag() }
    endDrag()
    document.addEventListener('keydown', escape, true)
    window.addEventListener('blur', leave)
    drag.current = { stop: () => { document.removeEventListener('keydown', escape, true); window.removeEventListener('blur', leave) } }
  }
  function endDrag() {
    drag.current?.stop()
    drag.current = null
  }
  useEffect(() => endDrag, [])
  function change(value: string) { latest.current = value; setDraft(value); setError(null); cancelBlur.current = false }
  function cancel() { latest.current = initial; setDraft(initial); setError(null); cancelBlur.current = true }
  async function commit() {
    if (cancelBlur.current) { cancelBlur.current = false; return }
    if (committing.current || latest.current === initial) return
    committing.current = true
    setPending(true)
    try { setError(await onChange(control.id, stored(control, latest.current))) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply this value.') }
    finally { committing.current = false; setPending(false) }
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelledGesture.current = true
      cancel()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void commit()
    } else if (RANGE_KEYS.includes(event.key)) cancelledGesture.current = false
  }
  function finishDrag() {
    if (cancelledGesture.current) {
      cancelledGesture.current = false
      cancel()
      return
    }
    void commit()
  }
  const input = {
    'aria-label': label,
    'data-control-id': control.id,
    'aria-invalid': !!error,
    value: draft,
    onBlur: () => void commit(),
    onKeyDown: keyDown,
  }
  const busy = pending || !!control.disabledReason
  const choose = (value: string) => { if (value !== latest.current) { change(value); void commit() } }
  const choices = choicesFor(control)
  const places = control.id === 'alignment' && control.options?.includes('topLeading')
  // Auto beside the number: a Spacer between each pair of views (D4).
  const auto = control.id === 'spacing' && control.options?.includes(AUTO_SPACING)
  /** A number's field with its unit at the end, as the layer sections' fields show one. */
  const withUnit = (field: ReactElement) => control.kind === 'number' && control.unit ? <span className={styles.unit}>{field}<span aria-hidden="true">{control.unit}</span></span> : field
  /** A share of one is dragged in percent; other sliders run from 0 to 1. */
  const scale = control.unit === '%' ? 100 : 1
  return <div className={styles.control} data-testid="design-control">
    {control.group && <small>{control.group}</small>}
    {choices || places ? <div className={styles.controlLabel}><span>{caption ?? label}</span>
      <Choices<string> label={label} controlId={control.id} options={places ? PLACES : choices!} value={draft} disabled={busy} onChoose={choose} />
    </div> : <label className={styles.controlLabel}><span>{caption ?? label}</span>
      {control.kind === 'toggle' ? <button type="button" role="switch" className={styles.switch} aria-label={label} aria-checked={draft === 'true'} data-control-id={control.id} disabled={busy} onClick={() => choose(draft === 'true' ? 'false' : 'true')}><i /></button>
        : control.kind === 'select' ? <select {...input} disabled={busy} onChange={event => { change(event.target.value); void commit() }}>
        {control.value === '' && <option value="" disabled>Use inherited / default</option>}
        {control.options?.map(option => <option key={option} value={option}>{propertyOptionLabel(option)}</option>)}
      </select> : control.kind === 'text' && /^(content|title)(:|$)/.test(control.id) ? <textarea {...input} readOnly={busy} rows={2} aria-description="Enter to apply. Shift+Enter for a new line." onChange={event => change(event.target.value)} /> : auto ? <span className={styles.spacing}>
        {withUnit(<input {...input} value={spreadOut(draft) ? '' : draft} readOnly={busy} type="text" inputMode="decimal" placeholder={spreadOut(draft) ? 'Auto' : 'Default'} onChange={event => change(event.target.value)} />)}
        <button type="button" aria-pressed={spreadOut(draft)} disabled={busy} title="Spread the views out, with a Spacer between each pair. Type a number to go back." onClick={() => choose(AUTO_SPACING)}>Auto</button>
      </span> : withUnit(<input {...input} readOnly={busy} type={/^date:(from|through)$/.test(control.id) ? "datetime-local" : "text"} inputMode={control.kind === 'number' ? 'decimal' : 'text'} placeholder={control.kind === 'number' ? 'Default' : 'Enter value'} onChange={event => change(event.target.value)} />)}
    </label>}
    {control.min === 0 && control.max === 1 && <input
      type="range" min="0" max={scale} step={(control.step ?? 0.01) * scale}
      aria-label={`${label} slider`}
      value={draft || scale} disabled={busy}
      onPointerDown={startDrag}
      onChange={event => { if (!cancelledGesture.current) change(event.target.value) }}
      onPointerUp={() => { endDrag(); finishDrag() }}
      onPointerCancel={() => { endDrag(); cancelledGesture.current = true; cancel() }}
      onBlur={() => { if (!drag.current) void commit() }}
      onKeyDown={keyDown}
      onKeyUp={event => { if (RANGE_KEYS.includes(event.key)) void commit() }}
    />}
    {control.disabledReason && <p className={styles.note}>{control.disabledReason}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {pending && <small role="status">Applying…</small>}
  </div>
}
