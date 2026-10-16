'use client'

import { useState } from 'react'
import type { AuthoringNode, ComponentVariant } from '@studio/shared'
import styles from './AuthoringInspector.module.css'

/**
 * Saved inputs: the studio's presets of a copy's inputs, applied to another copy in one step.
 * They are not Swift, so they are not called Variants, which are (Wave 5b).
 */
export function ComponentVariants({ node, variants, onSave, onDelete, onApply, busy }: { node: AuthoringNode; variants: readonly ComponentVariant[]; onSave: (variant: ComponentVariant) => string | null; onDelete: (owner: string, name: string) => string | null; onApply: (variant: ComponentVariant) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState('Primary'), [error, setError] = useState<string | null>(null)
  const info = node.component!
  const controls = info.controls.filter(c => info.variantControls.includes(c.id))
  return <details data-testid="component-variants"><summary>Saved inputs</summary>
    <p>Saves this copy’s inputs under a name, to apply to other copies. The Main stays linked; changing a saved set later does not change copies it was applied to.</p>
    {variants.filter(v => v.owner === node.name).map(variant => <div key={variant.name} className={styles.control}>
      <strong>{variant.name}</strong><small>{variant.values.map(v => `${v.control.slice(10)}: ${v.value}`).join(' · ')}</small>
      <div className={styles.actions}><button type="button" disabled={busy || variant.signature !== info.signature} onClick={() => void onApply(variant)}>Apply {variant.name}</button><button type="button" disabled={busy} aria-label={`Delete saved inputs ${variant.name}`} onClick={() => setError(onDelete(node.name, variant.name))}>Delete</button></div>
      {variant.signature !== info.signature && <p>Inputs changed. Save these inputs again from a current copy.</p>}
    </div>)}
    {controls.length > 0 ? <><label>Name<input aria-label="Saved inputs name" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      <button type="button" disabled={busy || !name.trim()} onClick={() => setError(onSave({ owner: node.name, signature: info.signature, name: name.trim(), values: controls.map(c => ({ control: c.id, value: c.value })) }))}>{variants.some(v => v.owner === node.name && v.name === name.trim()) ? 'Update saved inputs from this copy' : 'Save inputs from this copy'}</button></> : <p>This component has no inputs a copy sets. Edit its Main to change every copy.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </details>
}
