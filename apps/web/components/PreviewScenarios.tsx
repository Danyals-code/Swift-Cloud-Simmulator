'use client'

import { useState } from 'react'
import type { AuthoringSnapshot, DesignValue, PreviewInput, PreviewScenario } from '@studio/shared'
import styles from './AuthoringInspector.module.css'

export function PreviewScenarios({ snapshot, scenarios, active, onSelect, onSave, onDelete, onReset, stale }: { snapshot?: AuthoringSnapshot; scenarios: readonly PreviewScenario[]; active: string; onSelect: (name: string) => void; onSave: (name: string, inputs: readonly PreviewInput[]) => string | null; onDelete: (name: string) => void; onReset: () => void; stale: boolean }) {
  const [name, setName] = useState('Content'), [inputName, setInputName] = useState(''), [value, setValue] = useState(''), [error, setError] = useState<string | null>(null)
  const input = snapshot?.inputs?.find(s => `${s.owner}.${s.name}` === inputName)
  const current = scenarios.find(s => s.name === active)
  const save = () => {
    if (!input) { setError('Choose an existing source input. Scenarios use the branches already in your app.'); return }
    const nextValue: DesignValue = input.type === 'Bool' ? value === 'true' : ['Int', 'Double'].includes(input.type) ? (value === '' ? null : Number(value)) : value
    const values = [...(current?.inputs ?? []).filter(i => i.owner !== input.owner || i.name !== input.name), { owner: input.owner, name: input.name, signature: input.signature, value: nextValue }]
    setError(onSave(name, values))
  }
  return <div className={styles.inspector}><details className={styles.features} data-testid="preview-scenarios"><summary>Preview scenarios</summary>
    <label>Scenario<select aria-label="Preview scenario" value={active} onChange={e => onSelect(e.target.value)}><option value="">App defaults</option>{scenarios.map(s => <option key={s.name}>{s.name}</option>)}</select></label>
    <p>Scenario inputs are preview-only. Swift and exported app defaults remain authoritative.</p><div className={styles.actions}><button type="button" onClick={onReset}>Reset preview state</button>{active && <button type="button" onClick={() => onDelete(active)}>Delete scenario</button>}</div>
    {current && <ul>{current.inputs?.map(i => <li key={`${i.owner}.${i.name}`}>{i.owner}.{i.name}: {Array.isArray(i.value) ? `${i.value.length} records` : String(i.value)}</li>)}</ul>}
    <label>Scenario name<input aria-label="Scenario name" value={name} onChange={e => setName(e.target.value)} list="scenario-names" /></label><datalist id="scenario-names"><option>Content</option><option>Empty</option><option>Loading</option><option>Error</option></datalist>
    <label>Existing state input<select aria-label="Scenario input" value={inputName} onChange={e => { setInputName(e.target.value); const selected = snapshot?.inputs?.find(s => `${s.owner}.${s.name}` === e.target.value); setValue(String(selected?.value ?? '')) }}><option value="" disabled>Select input</option>{snapshot?.inputs?.map(s => <option key={`${s.owner}.${s.name}`}>{s.owner}.{s.name}</option>)}</select></label>
    <label>Preview value{input?.type === 'Bool' || input?.options ? <select aria-label="Scenario value" value={value} onChange={e => setValue(e.target.value)}>{(input.options ?? ['true', 'false']).map(v => <option key={v}>{v}</option>)}</select> : <input aria-label="Scenario value" value={value} onChange={e => setValue(e.target.value)} />}</label>
    <button type="button" disabled={stale} onClick={save}>Save and preview scenario</button>{error && <p role="alert" className={styles.error}>{error}</p>}
  </details></div>
}
