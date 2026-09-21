'use client'

import { useState } from 'react'
import type { AuthoringNode } from '@studio/shared'
import type { FeatureChange } from './AuthoringFeatures'
import { SYSTEM_COLOR_SWATCHES } from '../lib/tokens'
import styles from './SurfaceFill.module.css'

const COLORS = [
  ['Rose', '#FCE7F3'], ['Peach', '#FFEDD5'], ['Lemon', '#FEF3C7'],
  ['Mint', '#D1FAE5'], ['Sky', '#DBEAFE'], ['Lavender', '#EDE9FE'],
] as const

/** Direct access to the visible card surface, including native GroupBox cards. */
export function SurfaceFill({ node, onCommand }: { node: AuthoringNode; onCommand?: FeatureChange }) {
  const native = node.kind === 'view' && node.name === 'GroupBox'
  const background = node.modifiers?.find(modifier => modifier.name === 'background' && modifier.enabled !== false)
  const property = node.styles?.find(style => style.kind === 'color' && background?.propertyIds.includes(style.property))
  const value = native ? '#F2F2F7' : property?.value ?? ''
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : SYSTEM_COLOR_SWATCHES[value]?.slice(0, 7).toUpperCase() ?? ''
  const [base, setBase] = useState(hex), [draft, setDraft] = useState(hex)
  const [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null)
  if (base !== hex) { setBase(hex); setDraft(hex) }
  if (!onCommand || !native && (!['VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack'].includes(node.name) || !property)) return null
  const valid = /^#[0-9a-f]{6}$/i.test(draft)
  const apply = async (color: string) => {
    if (pending) return
    setPending(true); setError(null)
    try {
      const problem = await onCommand(native ? { kind: 'card-customize', color } : { kind: 'style-local', property: property!.property, value: color })
      setError(problem)
      if (!problem) setDraft(color)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the fill.') }
    finally { setPending(false) }
  }
  return <section className={styles.surface} aria-label="Fill" data-testid="surface-fill">
    <h3>{native ? 'Card fill' : 'Fill'}</h3>
    <div className={styles.palette} role="group" aria-label="Fill colors">{COLORS.map(([name, color]) =>
      <button key={name} type="button" aria-label={`${name} fill`} title={name} aria-pressed={!native && hex === color} disabled={pending} style={{ backgroundColor: color }} onClick={() => void apply(color)} />
    )}</div>
    <form className={styles.custom} onSubmit={event => { event.preventDefault(); if (valid) void apply(draft.toUpperCase()) }}>
      <input type="color" aria-label="Fill color picker" value={valid ? draft : '#F2F2F7'} disabled={pending} onChange={event => setDraft(event.target.value.toUpperCase())} />
      <input type="text" aria-label="Fill hex color" placeholder="#RRGGBB" value={draft} maxLength={7} spellCheck={false} aria-invalid={!!draft && !valid} disabled={pending} onChange={event => setDraft(event.target.value)} />
      <button type="submit" disabled={pending || !valid || !native && draft.toUpperCase() === hex}>Apply</button>
    </form>
    {native && <p>Pick a color to make this card fully editable, with aligned title and content. Undo restores the original card.</p>}
    {!native && property?.token && <p>Choosing a color changes only this fill. The shared token stays unchanged.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>
}
