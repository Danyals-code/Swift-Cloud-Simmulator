'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { DesignControl } from '@studio/shared'
import styles from './AuthoringInspector.module.css'

const RANGE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
const OPTION_LABELS: Record<string, string> = {
  Row: 'Horizontal Stack', Column: 'Vertical Stack', Stack: 'ZStack',
  largeTitle: 'Large title', title: 'Title', title2: 'Title 2', title3: 'Title 3',
  primary: 'Primary text', secondary: 'Secondary text', clear: 'Transparent', accentColor: 'App accent',
  systemBackground: 'Screen background', secondarySystemBackground: 'Secondary background', tertiarySystemBackground: 'Tertiary background',
  systemGroupedBackground: 'Grouped screen background', secondarySystemGroupedBackground: 'Grouped card background', tertiarySystemGroupedBackground: 'Grouped inset background',
  borderedProminent: 'Filled', bordered: 'Bordered', borderless: 'Borderless', plain: 'Plain',
  leading: 'Start', trailing: 'End', firstTextBaseline: 'First text baseline', lastTextBaseline: 'Last text baseline',
}
export function propertyOptionLabel(value: string): string {
  return OPTION_LABELS[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())
}

export type PropertyChange = (control: string, value: string) => Promise<string | null>

export function PropertyControl({ control, onChange, label = control.label }: { control: DesignControl; onChange: PropertyChange; label?: string }) {
  const [draft, setDraft] = useState(control.value)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const latest = useRef(control.value)
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
  function cancel() { latest.current = control.value; setDraft(control.value); setError(null); cancelBlur.current = true }
  async function commit() {
    if (cancelBlur.current) { cancelBlur.current = false; return }
    if (committing.current || latest.current === control.value) return
    committing.current = true
    setPending(true)
    try { setError(await onChange(control.id, latest.current)) }
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
  return <div className={styles.control} data-testid="design-control">
    {control.group && <small>{control.group}</small>}
    <label className={styles.controlLabel}><span>{label}</span>
      {control.kind === 'select' ? <select {...input} disabled={pending || !!control.disabledReason} onChange={event => { change(event.target.value); void commit() }}>
        {control.value === '' && <option value="" disabled>Use inherited / default</option>}
        {control.options?.map(option => <option key={option} value={option}>{propertyOptionLabel(option)}</option>)}
      </select> : control.kind === 'text' && /^(content|title)(:|$)/.test(control.id) ? <textarea {...input} readOnly={pending || !!control.disabledReason} rows={2} aria-description="Enter to apply. Shift+Enter for a new line." onChange={event => change(event.target.value)} /> : <input {...input} readOnly={pending || !!control.disabledReason} type={/^date:(from|through)$/.test(control.id) ? "datetime-local" : "text"} inputMode={control.kind === 'number' ? 'decimal' : 'text'} placeholder={control.kind === 'number' ? 'Default' : 'Enter value'} onChange={event => change(event.target.value)} />}
    </label>
    {control.kind === 'number' && /spacing|padding|size|radius|width|height/i.test(label) && <small>Points (pt)</small>}
    {control.min === 0 && control.max === 1 && <input
      type="range" min="0" max="1" step="0.01"
      aria-label={`${label} slider`}
      value={draft || '1'} disabled={pending || !!control.disabledReason}
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
