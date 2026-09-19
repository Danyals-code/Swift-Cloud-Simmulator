'use client'

import { useState } from 'react'
import type { AuthoringNode, ComponentVariant } from '@studio/shared'
import styles from './AuthoringInspector.module.css'

export function ComponentVariants({ node, variants, onSave, onDelete, onApply, busy }: { node: AuthoringNode; variants: readonly ComponentVariant[]; onSave: (variant: ComponentVariant) => string | null; onDelete: (owner: string, name: string) => string | null; onApply: (variant: ComponentVariant) => Promise<void>; busy: boolean }) {
  const [name, setName] = useState('Primary'), [error, setError] = useState<string | null>(null)
  const info = node.component!
  const controls = info.controls.filter(c => info.variantControls.includes(c.id))
  return <details data-testid="component-variants"><summary>Variants · saved inputs</summary>
    <p>A variant copies this instance’s editable inputs. The shared design stays linked; later preset changes do not overwrite existing instances.</p>
    {variants.filter(v => v.owner === node.name).map(variant => <div key={variant.name} className={styles.control}>
      <strong>{variant.name}</strong><small>{variant.values.map(v => `${v.control.slice(10)}: ${v.value}`).join(' · ')}</small>
      <div className={styles.actions}><button type="button" disabled={busy || variant.signature !== info.signature} onClick={() => void onApply(variant)}>Apply {variant.name}</button><button type="button" disabled={busy} aria-label={`Delete variant ${variant.name}`} onClick={() => setError(onDelete(node.name, variant.name))}>Delete</button></div>
      {variant.signature !== info.signature && <p>Inputs changed. Save this variant again from a current instance.</p>}
    </div>)}
    {controls.length > 0 ? <><label>Variant name<input aria-label="Variant name" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      <button type="button" disabled={busy || !name.trim()} onClick={() => setError(onSave({ owner: node.name, signature: info.signature, name: name.trim(), values: controls.map(c => ({ control: c.id, value: c.value })) }))}>{variants.some(v => v.owner === node.name && v.name === name.trim()) ? 'Update variant from this instance' : 'Save variant from this instance'}</button></> : <p>This component has no editable instance inputs. Edit its shared design to update every instance.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </details>
}
