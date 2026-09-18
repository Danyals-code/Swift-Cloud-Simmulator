'use client'

import { useState } from 'react'
import type { AuthoringNode, AuthoringSnapshot, ResourceOperation, SharedStyle, StyleKind } from '@studio/shared'
import styles from './AuthoringInspector.module.css'

export function StyleValue({ kind, value, onChange, label = 'Style value' }: { kind: StyleKind; value: string; onChange: (value: string) => void; label?: string }) {
  return <label>{label}{kind === 'font' ? <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{['largeTitle', 'title', 'title2', 'title3', 'headline', 'subheadline', 'body', 'callout', 'footnote', 'caption', 'caption2'].map(font => <option key={font}>{font}</option>)}</select> : <input aria-label={label} value={value} inputMode={kind === 'spacing' ? 'decimal' : 'text'} placeholder={kind === 'spacing' ? '0–1024 points' : 'blue or #2563eb'} onChange={e => onChange(e.target.value)} />}</label>
}
export function SharedStyleEditor({ token, onCommand, busy }: { token: SharedStyle; onCommand: (op: ResourceOperation) => Promise<void>; busy: boolean }) {
  const [value, setValue] = useState(token.value)
  return <details><summary>{token.name} · {token.kind} · {token.value}</summary><p>Shared Swift declaration · {token.uses.length} source references</p>
    <ul>{token.uses.map(s => <li key={`${s.file}:${s.start}`}>{s.file} · offset {s.start}</li>)}</ul>
    <StyleValue kind={token.kind} value={value} onChange={setValue} label={`${token.name} value`} />
    <button type="button" disabled={busy || token.value === value} onClick={() => void onCommand({ kind: 'style-edit', name: token.name, value })}>Update shared value · all uses</button>
  </details>
}
export function SharedStyleProperties({ node, snapshot, onCommand, busy }: { node: AuthoringNode; snapshot?: AuthoringSnapshot; onCommand: (op: ResourceOperation) => Promise<void>; busy: boolean }) {
  return <>{node.styles?.map(property => <StylePropertyEditor key={property.property + property.token} property={property} snapshot={snapshot} onCommand={onCommand} busy={busy} />)}</>
}
function StylePropertyEditor({ property, snapshot, onCommand, busy }: { property: NonNullable<AuthoringNode['styles']>[number]; snapshot?: AuthoringSnapshot; onCommand: (op: ResourceOperation) => Promise<void>; busy: boolean }) {
  const tokens = snapshot?.styles?.filter(t => t.kind === property.kind) ?? []
  const current = tokens.find(t => t.name === property.token)
  const [token, setToken] = useState(property.token ?? tokens[0]?.name ?? '')
  const [value, setValue] = useState(current?.value ?? (property.kind === 'color' ? 'blue' : property.kind === 'font' ? 'body' : '16'))
  return <details className={styles.control}><summary>{property.label} · {property.token ? `Linked to ${property.token}` : 'Local value'}</summary>
    <p>Applies to this source view and every runtime instance it creates.</p>
    {!!tokens.length && <><label>Shared style<select aria-label={`${property.label} shared style`} value={token} onChange={e => setToken(e.target.value)}>{tokens.map(t => <option key={t.name}>{t.name}</option>)}</select></label><button type="button" disabled={busy || token === property.token} onClick={() => void onCommand({ kind: 'style-link', property: property.property, name: token })}>Use selected shared style</button></>}
    {current && <SharedStyleEditor key={current.name + current.value} token={current} onCommand={onCommand} busy={busy} />}
    <StyleValue kind={property.kind} value={value} onChange={setValue} label={`${property.label} local value`} />
    <button type="button" disabled={busy} onClick={() => void onCommand({ kind: 'style-local', property: property.property, value })}>Apply local override</button>
  </details>
}
