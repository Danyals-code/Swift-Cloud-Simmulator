'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import type { DesignControl } from '@studio/shared'
import styles from './AuthoringInspector.module.css'

const RANGE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
const OPTION_LABELS: Record<string, string> = {
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
    <label><span>{label}</span>
      {control.kind === 'select' ? <select {...input} disabled={pending} onChange={event => { change(event.target.value); void commit() }}>
        {control.value === '' && <option value="" disabled>Use inherited / default</option>}
        {control.options?.map(option => <option key={option} value={option}>{propertyOptionLabel(option)}</option>)}
      </select> : control.kind === 'text' && /^(content|title)(:|$)/.test(control.id) ? <textarea {...input} readOnly={pending} rows={2} aria-description="Enter to apply. Shift+Enter for a new line." onChange={event => change(event.target.value)} /> : <input {...input} readOnly={pending} type="text" inputMode={control.kind === 'number' ? 'decimal' : 'text'} placeholder={control.kind === 'number' ? 'Default' : 'Enter value'} onChange={event => change(event.target.value)} />}
    </label>
    {control.kind === 'number' && /spacing|padding|size|radius|width|height/i.test(label) && <small>Points (pt)</small>}
    {control.min === 0 && control.max === 1 && <input
      type="range" min="0" max="1" step="0.01"
      aria-label={`${label} slider`}
      value={draft || '1'} disabled={pending}
      onPointerDown={() => { cancelledGesture.current = false }}
      onChange={event => { if (!cancelledGesture.current) change(event.target.value) }}
      onPointerUp={finishDrag}
      onPointerCancel={() => { cancelledGesture.current = true; cancel() }}
      onBlur={() => void commit()}
      onKeyDown={keyDown}
      onKeyUp={event => { if (RANGE_KEYS.includes(event.key)) void commit() }}
    />}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {pending && <small role="status">Applying…</small>}
  </div>
}
