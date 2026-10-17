'use client'

import { useId, useMemo, useState } from 'react'
import { SYMBOL_MAP } from '@studio/shared'
import { symbolAsset } from '@studio/swiftui-render-dom'
import { findSymbols, SYMBOL_CATEGORIES } from '../lib/symbolSearch'
import styles from './AuthoringInspector.module.css'

/** The most tiles drawn at once, so a long list stays quick to open and to scroll. */
const SHOWN = 120

export function SymbolPicker({ selected, onChoose }: { selected: string; onChoose: (name: string) => Promise<string | null> }) {
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [open, setOpen] = useState(false)
  const id = useId().replaceAll(':', '')
  // Only an open picker searches and draws its tiles, so a list of closed ones stays light.
  const found = useMemo(() => open ? findSymbols(Object.keys(SYMBOL_MAP), query, category || null) : [], [open, query, category])
  const names = found.slice(0, SHOWN)
  const note = !found.length ? 'No supported symbols match. Try a simpler word, or All categories.' : found.length > SHOWN ? `Showing ${SHOWN} of ${found.length} symbols. Search or choose a category to narrow the list.` : `${found.length} ${found.length === 1 ? 'symbol' : 'symbols'}.`
  // A real symbol the preview has no drawing for still builds; the canvas shows a placeholder for it.
  return <>{selected && !SYMBOL_MAP[selected] && <p className={styles.note}>The preview has no drawing for “{selected}” and shows a placeholder. If Apple has a symbol by that name, the app shows it.</p>}<details className={styles.symbolPicker} onToggle={e => setOpen(e.currentTarget.open)}><summary>Choose a symbol</summary><span><input aria-label="Search symbols" placeholder="Search symbols" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Symbol category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All</option>{SYMBOL_CATEGORIES.map(label => <option key={label} value={label}>{label}</option>)}</select></span><div>{names.map((name, index) => { const asset = symbolAsset(name, id + index); return asset && <button key={name} type="button" title={name} aria-label={`Use symbol ${name}`} aria-pressed={selected === name} disabled={busy} onClick={async () => { setBusy(true); try { setError(await onChoose(name)) } finally { setBusy(false) } }}><svg viewBox={asset.viewBox} width="24" height="24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: asset.body }} /><small>{name.replaceAll('.', ' ')}</small></button> })}</div><p aria-live="polite">{note}</p>{error && <p role="alert">{error}</p>}</details></>
}
