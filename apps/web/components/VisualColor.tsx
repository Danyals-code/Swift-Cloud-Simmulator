'use client'

import { useState } from 'react'
import type { AuthoringSnapshot, ResourceOperation, StyleProperty } from '@studio/shared'
import styles from './AuthoringInspector.module.css'

export function VisualColor({ property, snapshot, busy, onCommand }: { property: StyleProperty; snapshot?: AuthoringSnapshot; busy: boolean; onCommand: (op: ResourceOperation) => Promise<void> }) {
  const [value, setValue] = useState(property.value ?? '#6D28D9'), [name, setName] = useState('brandColor')
  const [create, setCreate] = useState(false)
  const tokens = snapshot?.styles?.filter(token => token.kind === 'color') ?? []
  const isHex = /^#[0-9a-f]{6}$/i.test(value)
  return <div className={styles.visualColor}>
    <div className={styles.swatchValue}><input type="color" aria-label={`${property.label} color picker`} disabled={busy} value={isHex ? value : '#6D28D9'} onChange={e => setValue(e.target.value)} /><label>Custom color<input aria-label={`${property.label} hex color`} value={value} placeholder="#6D28D9" onChange={e => setValue(e.target.value)} /></label></div>
    <button type="button" disabled={busy || !value.trim()} onClick={() => void onCommand({ kind: 'style-local', property: property.property, value })}>Apply color</button>
    <label>Color style<select aria-label={`${property.label} color style`} disabled={busy} value={property.token ?? ''} onChange={e => { if (e.target.value === '__new') setCreate(true); else if (e.target.value) void onCommand({ kind: 'style-link', property: property.property, name: e.target.value }); else void onCommand({ kind: 'style-local', property: property.property, value: property.value ?? value }) }}><option value="">Local color</option>{tokens.map(token => <option key={token.name} value={token.name}>{token.name} · {token.value}</option>)}<option value="__new">+ Save as shared color…</option></select></label>
    {property.token && <p>Using {property.token} · {property.value}. Shared colors update together.</p>}
    {create && <><label>Shared color name<input aria-label="Shared color name" value={name} onChange={e => setName(e.target.value)} /></label><button type="button" disabled={busy || !name.trim()} onClick={() => void onCommand({ kind: 'style-create-link', property: property.property, name, style: 'color', value })}>Create and apply color</button><button type="button" onClick={() => setCreate(false)}>Cancel</button></>}
  </div>
}
