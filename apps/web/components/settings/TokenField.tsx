'use client'

import { useState } from 'react'
import type { AuthoringNode, DesignControl, ResourceOperation, SharedStyle, StyleProperty } from '@studio/shared'
import { PropertyControl, type PropertyChange } from '../PropertyControl'
import { SYSTEM_COLOR_SWATCHES, suggestedName, nameHint } from '../../lib/tokens'
import styles from './Settings.module.css'

const CUSTOM = '__custom'

/** A field is one value in the source: its raw control, its token linkage, or both. */
export interface ValueField { readonly control?: DesignControl; readonly style?: StyleProperty }

/**
 * Pairs a view's raw controls with the token linkage of the same source value.
 *
 * Both describe one argument - `.padding(16)` has a number control *and* a spacing
 * property - and showing them separately put the same value on screen twice.
 */
export function valueFields(node: AuthoringNode, controls: readonly DesignControl[], propertyIds?: readonly string[]): ValueField[] {
  const styles = (node.styles ?? []).filter(style => !propertyIds || propertyIds.includes(style.property))
  const spanOf = (style: StyleProperty) => node.properties.find(p => p.id === style.property)?.source
  const used = new Set<StyleProperty>()
  const fields: ValueField[] = controls.map(control => {
    const style = styles.find(candidate => { const span = spanOf(candidate); return !!span && span.file === control.source.file && span.start === control.source.start && span.end === control.source.end })
    if (style) used.add(style)
    return { control, ...(style ? { style } : {}) }
  })
  for (const style of styles) if (!used.has(style)) fields.push({ style })
  return fields
}

export interface TokenFieldProps {
  field: ValueField
  label?: string
  tokens: readonly SharedStyle[]
  busy?: boolean
  onChange?: PropertyChange
  onCommand?: (operation: ResourceOperation) => Promise<string | null>
  /** Marks a value set on a screen that overrides the App's, for screen-level overrides. */
  override?: boolean
}

/**
 * A value field that offers the App's tokens first.
 *
 * The raw value stays available - some values are genuinely one-off - but it is flagged,
 * because a raw value is the thing a design system is there to avoid.
 */
export function TokenField({ field, label, tokens, busy = false, onChange, onCommand, override = false }: TokenFieldProps) {
  const { control, style } = field
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  if (!style) return control && onChange ? <PropertyControl control={control} label={label} onChange={onChange} /> : null
  const kind = style.kind
  const choices = tokens.filter(token => token.kind === kind || kind === 'radius' && token.kind === 'spacing' && token.form === 'legacy')
  const linked = style.token ? choices.find(token => token.name === style.token) : undefined
  const title = label ?? control?.label ?? style.label
  const run = async (operation: ResourceOperation) => {
    if (!onCommand || pending) return
    setPending(true); setError(null)
    try { const problem = await onCommand(operation); setError(problem); if (!problem) setSaving(false) }
    finally { setPending(false) }
  }
  const rawValue = style.value ?? control?.value ?? ''
  const tokenValue = kind === 'color' ? (/^#/.test(rawValue) ? rawValue.toUpperCase() : SYSTEM_COLOR_SWATCHES[rawValue]?.slice(0, 7) ?? '#000000') : rawValue
  return <div className={styles.tokenField} data-testid="token-field" data-kind={kind}>
    <div className={styles.row}>
      <span title={title}>{title}</span>
      <span className={styles.tokenPicker}>
        <select title={linked ? `${linked.name}: ${linked.value}` : `Custom: ${rawValue || 'default'}`} aria-label={`${title} token`} data-linked={linked ? true : undefined} value={linked ? linked.name : CUSTOM} disabled={busy || pending || !onCommand}
          onChange={event => {
            const value = event.target.value
            if (value === CUSTOM) { if (linked) void run({ kind: 'style-local', property: style.property, value: kind === 'color' ? (linked.light ?? linked.value) : kind === 'font' ? (linked.font?.style ?? linked.value) : linked.value }) }
            else void run({ kind: 'style-link', property: style.property, name: value })
          }}>
          {choices.map(token => <option key={token.name} value={token.name}>{token.form === 'token' ? '.' : ''}{token.name}{kind === 'color' ? '' : ` · ${token.value}`}</option>)}
          {!!choices.length && <option disabled>──────────</option>}
          <option value={CUSTOM}>Custom</option>
        </select>
      </span>
    </div>
    {override && <span className={styles.note}>Overrides the App value</span>}
    {!linked && control && onChange && <PropertyControl control={control} label={`${title} value`} onChange={onChange} />}
    {!linked && kind === 'color' && onCommand && <CustomColor value={tokenValue} disabled={busy || pending} onApply={hex => void run({ kind: 'style-local', property: style.property, value: hex })} />}
    {!linked && onCommand && kind !== 'shadow' && (saving
      ? <form className={styles.inline} onSubmit={event => { event.preventDefault(); if (nameHint(kind, name)) return; void run({ kind: 'style-create-link', property: style.property, name: name.trim(), style: kind, value: tokenValue, token: kind === 'font' ? { value: tokenValue, font: { style: tokenValue } } : { value: tokenValue } }) }}>
          <input aria-label="New token name" autoFocus value={name} spellCheck={false} onChange={event => { setName(event.target.value); setError(null) }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setSaving(false) } }} />
          <button type="submit" className={styles.button} disabled={pending || !!nameHint(kind, name)}>Save</button>
        </form>
      : <button type="button" className={styles.link} disabled={busy || pending || !rawValue} onClick={() => { setSaving(true); setName(suggestedName(kind, tokens.map(t => t.name), rawValue)) }}>Save as token…</button>)}
    {saving && nameHint(kind, name) && <p className={styles.note}>{nameHint(kind, name)}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>
}

/** Any colour, not only the system ones: committed when the picker closes, not per drag. */
function CustomColor({ value, disabled, onApply }: { value: string; disabled: boolean; onApply: (hex: string) => void }) {
  const [draft, setDraft] = useState(value)
  const [base, setBase] = useState(value)
  if (base !== value) { setBase(value); setDraft(value) }
  const valid = /^#[0-9a-f]{6}$/i.test(draft)
  return <div className={styles.row}><span>Custom color</span><span className={styles.inline}>
    <input type="color" aria-label="Custom color swatch" value={valid ? draft : '#000000'} disabled={disabled} onChange={event => setDraft(event.target.value.toUpperCase())} onBlur={() => { if (valid && draft.toUpperCase() !== value.toUpperCase()) onApply(draft) }} />
    <input aria-label="Custom color hex" value={draft} disabled={disabled} spellCheck={false} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && valid) onApply(draft.toUpperCase()) }} onBlur={() => { if (valid && draft.toUpperCase() !== value.toUpperCase()) onApply(draft.toUpperCase()) }} />
  </span></div>
}
