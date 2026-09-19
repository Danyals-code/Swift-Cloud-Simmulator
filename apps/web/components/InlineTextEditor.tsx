'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './Workspace.module.css'

export function InlineTextEditor({ value, x, y, width, onSave, onClose }: { value: string; x: number; y: number; width: number; onSave: (value: string) => Promise<string | null>; onClose: () => void }) {
  const [draft, setDraft] = useState(value), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const save = async () => { if (saving.current) return; if (value === draft) { onClose(); return }; saving.current = true; setBusy(true); try { const problem = await onSave(draft); setError(problem); if (!problem) onClose() } finally { saving.current = false; setBusy(false) } }
  return createPortal(<form className={styles.inlineText} style={{ left: Math.max(8, Math.min(x, window.innerWidth - 280)), top: Math.max(8, Math.min(y, window.innerHeight - 180)), width: Math.min(Math.max(260, width), window.innerWidth - 16) }} aria-label="Edit canvas text" onSubmit={event => { event.preventDefault(); void save() }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose() } }}>
    <textarea autoFocus aria-label="Canvas text" value={draft} disabled={busy} rows={3} onFocus={event => event.currentTarget.select()} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void save() } }} />
    <div><small>Enter to save · Esc to cancel</small><button type="submit" disabled={busy}>Save</button><button type="button" disabled={busy} onClick={onClose}>Cancel</button></div>{error && <p role="alert">{error}</p>}
  </form>, document.body)
}
