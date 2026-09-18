'use client'

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AuthoringNode, DesignControl, PropertyValueKind, SourceSpan } from '@studio/shared'
import { AuthoringFeatures, type FeatureProps } from './AuthoringFeatures'
import styles from './AuthoringInspector.module.css'

const LABELS: Record<PropertyValueKind, string> = { literal: 'Literal', token: 'Token', 'data-binding': 'Data binding', 'component-argument': 'Component input', inherited: 'Inherited', computed: 'Computed', unsupported: 'Unsupported' }
const RANGE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']

type Change = (control: string, value: string) => Promise<string | null>

function PropertyControl({ control, onChange }: { control: DesignControl; onChange: Change }) {
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
    finally { committing.current = false; setPending(false) }
  }
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelledGesture.current = true
      cancel()
    } else if (event.key === 'Enter') {
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
    'aria-label': control.label,
    'aria-invalid': !!error,
    disabled: pending,
    value: draft,
    onBlur: () => void commit(),
    onKeyDown: keyDown,
  }
  return <div className={styles.control} data-testid="design-control">
    {control.group && <small>{control.group}</small>}
    <label><span>{control.label}</span>
      {control.kind === 'select' ? <select {...input} onChange={event => { change(event.target.value); void commit() }}>
        {control.value === '' && <option value="" disabled>Use inherited / default</option>}
        {control.options?.map(option => <option key={option} value={option}>{option}</option>)}
      </select> : <input {...input} type="text" inputMode={control.kind === 'number' ? 'decimal' : 'text'} placeholder={control.kind === 'number' ? 'Default' : 'Enter value'} onChange={event => change(event.target.value)} />}
    </label>
    {control.min === 0 && control.max === 1 && <input
      type="range" min="0" max="1" step="0.01"
      aria-label={`${control.label} slider`}
      value={draft || '1'} disabled={pending}
      onPointerDown={() => { cancelledGesture.current = false }}
      onChange={event => { if (!cancelledGesture.current) change(event.target.value) }}
      onPointerUp={finishDrag}
      onPointerCancel={() => { cancelledGesture.current = true; cancel() }}
      onBlur={() => void commit()}
      onKeyDown={keyDown}
      onKeyUp={event => { if (RANGE_KEYS.includes(event.key)) void commit() }}
    />}
    <small>{control.scope}</small>
    <details><summary>How this changes Swift</summary><p>{control.description}</p></details>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {pending && <small role="status">Applying…</small>}
  </div>
}

export function AuthoringInspector({ node, stale, onReveal, onChange, features }: { features?: Omit<FeatureProps, 'node'>; node?: AuthoringNode; stale?: boolean; onReveal?: (span: SourceSpan) => void; onChange?: Change }) {
  const root = useRef<HTMLDivElement | null>(null)
  const focus = useRef<{ source: string; label: string; caret: number | null } | null>(null)
  const sourceKey = node ? `${node.owner}:${node.source.file}:${node.source.start}` : ''
  useLayoutEffect(() => {
    if (stale) return
    const previous = focus.current
    if (!previous || previous.source !== sourceKey) { focus.current = null; return }
    if (document.activeElement !== document.body) return
    const input = Array.from(root.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select') ?? []).find(element => element.getAttribute('aria-label')?.toLowerCase() === previous.label)
    if (!input) return
    input.focus({ preventScroll: true })
    if (input instanceof HTMLInputElement && input.type === 'text' && previous.caret !== null) input.setSelectionRange(Math.min(previous.caret, input.value.length), Math.min(previous.caret, input.value.length))
  }, [node, sourceKey, stale])
  if (stale) return <p className={styles.empty} role="status">Updating source properties…</p>
  if (!node) return <p className={styles.empty}>Select a source view to inspect its properties.</p>
  return <div ref={root} className={styles.inspector} data-testid="authoring-inspector" onFocusCapture={event => {
    const input = event.target
    focus.current = input instanceof HTMLInputElement || input instanceof HTMLSelectElement ? { source: sourceKey, label: input.getAttribute('aria-label')?.toLowerCase() ?? '', caret: input instanceof HTMLInputElement ? input.selectionStart : null } : null
  }} onBlurCapture={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focus.current = null }} >
    <header><strong>{node.owner}</strong><button type="button" onClick={() => onReveal?.(node.source)}>View source</button></header>
    {node.runtimeIds.length > 1 && <p>This source creates {node.runtimeIds.length} preview instances. Changes apply to their shared source.</p>}
    {features && <AuthoringFeatures key={`${features.snapshot?.projectId}:${node.id}:${node.fingerprint}:${node.collection?.signature}`} node={node} {...features} />}
    {!!node.controls?.length && onChange && <div className={styles.controls}>
      <p className={styles.note}>Design properties</p>
      {node.controls.map(control => <PropertyControl key={`${node.id}:${control.id}:${control.value}`} control={control} onChange={onChange} />)}
    </div>}
    <details className={styles.source} open={!node.controls?.length}>
      <summary>Source values and ownership</summary>
      <dl className={styles.properties}>
        {node.properties.map(property => <div key={property.id} className={styles.property} data-testid="authoring-property">
          <dt><span>{property.name}</span><span className={styles.badge}>{LABELS[property.valueKind]}</span></dt>
          <dd><code>{property.expression}</code><small>{property.scope === 'template' ? 'All rows in this template' : property.scope === 'instance' ? 'This component instance' : property.scope === 'inherited' ? 'Inherited style' : `Defined in ${node.owner}`}</small>
            {property.valueKind !== 'literal' && <p>{property.reason}</p>}
            {(property.declaration ?? property.source) && <button type="button" aria-label={`Show source for ${property.name}`} onClick={() => onReveal?.((property.declaration ?? property.source)!)}>Show source</button>}
          </dd>
        </div>)}
      </dl>
      {!node.properties.length && <p>This view has no declared properties in the supported subset.</p>}
    </details>
  </div>
}
