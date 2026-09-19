'use client'

import { useId, useState } from 'react'
import { SYMBOL_MAP } from '@studio/shared'
import { symbolAsset } from '@studio/swiftui-render-dom'
import styles from './AuthoringInspector.module.css'

export function SymbolPicker({ selected, onChoose }: { selected: string; onChoose: (name: string) => Promise<string | null> }) {
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const id = useId().replaceAll(':', '')
  const names = Object.keys(SYMBOL_MAP).filter(name => name.includes(query.trim().toLowerCase())).slice(0, 48)
  return <details className={styles.symbolPicker}><summary>Choose a symbol</summary><input aria-label="Search symbols" placeholder="Search: person, star, heart…" value={query} onChange={e => setQuery(e.target.value)} /><div>{names.map((name, index) => { const asset = symbolAsset(name, id + index); return asset && <button key={name} type="button" title={name} aria-label={`Use symbol ${name}`} aria-pressed={selected === name} disabled={busy} onClick={async () => { setBusy(true); try { setError(await onChoose(name)) } finally { setBusy(false) } }}><svg viewBox={asset.viewBox} width="24" height="24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: asset.body }} /><small>{name.replaceAll('.', ' ')}</small></button> })}</div><p>{names.length ? 'Showing up to 48 supported symbols. Search to narrow the list.' : 'No supported symbols match. Try a simpler word.'}</p>{error && <p role="alert">{error}</p>}</details>
}
