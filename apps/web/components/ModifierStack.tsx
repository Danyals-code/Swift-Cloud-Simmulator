'use client'

import { useRef, useState } from 'react'
import type { AuthoringModifier, AuthoringNode, DesignControl, SourceSpan } from '@studio/shared'
import type { FeatureChange } from './AuthoringFeatures'
import { PropertyControl, type PropertyChange } from './PropertyControl'
import { navigationDestinationEditorId } from './NavigationDestinationEditor'
import styles from './AuthoringInspector.module.css'

function controlLabel(control: DesignControl, modifier: AuthoringModifier): string {
  if (control.id.startsWith('fill:')) return control.label
  if (modifier.name === 'font') return control.label === 'Typography' ? 'Text style' : control.label
  const name = control.label.split(' · ')[1]
  if (modifier.name === 'frame') return name ? name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()) : control.label
  if (['foregroundColor', 'foregroundStyle', 'background', 'fill'].includes(modifier.name)) return 'Color'
  if (modifier.name === 'padding') return 'Padding'
  return modifier.label
}

export function ModifierStack({ node, onChange, onCommand, onReveal, behavior = false, navigationSlots = [] }: { navigationSlots?: readonly AuthoringNode[]; node: AuthoringNode; onChange?: PropertyChange; onCommand?: FeatureChange; onReveal?: (span: SourceSpan) => void; behavior?: boolean }) {
  const modifiers = node.modifiers ?? []
  const entries = modifiers.map((modifier, index) => ({ modifier, index })).filter(({ modifier }) => (modifier.category === 'behavior') === behavior)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set([0]))
  const [menu, setMenu] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const addButton = useRef<HTMLButtonElement | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const drag = useRef<{ id: string; index: number } | null>(null)
  async function run(operation: Parameters<FeatureChange>[0], openAfter?: ReadonlySet<number>) {
    if (!onCommand || inFlight.current) return
    inFlight.current = true; setBusy(true); setError(null); setMenu(null)
    try {
      const problem = await onCommand(operation)
      setError(problem)
      if (!problem) { if (openAfter) setExpanded(openAfter); setPicker(false); setQuery('') }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change this modifier.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  function move(from: number, to: number) {
    const modifier = modifiers[from]
    if (!modifier || from === to) return
    const reordered = [...modifiers]; reordered.splice(to, 0, reordered.splice(from, 1)[0]!)
    const open = new Set([...expanded].map(index => reordered.indexOf(modifiers[index]!)).filter(index => index >= 0))
    void run({ kind: 'modifier-move', modifier: modifier.id, toIndex: to }, open)
  }
  function drop(before: number) {
    const from = drag.current
    drag.current = null; setDropIndex(null)
    if (from && modifiers[from.index]?.id === from.id) move(from.index, from.index < before ? before - 1 : before)
  }
  const catalog = (node.modifierCatalog ?? []).filter(item => item.category !== 'behavior' && `${item.label} ${item.name} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className={styles.modifierStack} data-testid={behavior ? 'behavior-modifiers' : 'modifier-stack'} aria-busy={busy}>
    {!behavior && <div className={styles.sectionHeading}><h3>Modifiers</h3><span>{entries.length}</span></div>}
    {!entries.length && !behavior && <p className={styles.note}>Add a modifier to style this view.</p>}
    {entries.map(({ modifier, index }) => {
      const navigation = navigationSlots.find(slot => slot.navigation?.editable && slot.source.file === modifier.source.file && slot.source.start >= modifier.source.start && slot.source.end <= modifier.source.end)
      return <article key={modifier.id} className={`${styles.modifierCard} ${dropIndex === index ? styles.dropBefore : ''}`} data-testid="modifier-card" data-modifier-name={modifier.name}
      onDragOver={event => { if (event.dataTransfer.types.includes('application/x-studio-modifier') && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropIndex(index) } }}
      onDrop={event => { if (event.dataTransfer.types.includes('application/x-studio-modifier')) { event.preventDefault(); drop(index) } }}>
      <div className={styles.modifierHeader}>
        <span className={styles.dragHandle} aria-hidden="true" title="Drag to change order" draggable={!busy && (modifier.capabilities.moveUp || modifier.capabilities.moveDown)} onDragStart={event => { drag.current = { id: modifier.id, index }; event.dataTransfer.setData('application/x-studio-modifier', modifier.id); event.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { drag.current = null; setDropIndex(null) }}>⠿</span>
        <button type="button" className={styles.modifierToggle} aria-expanded={expanded.has(index)} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next })}>
          <span className={styles.chevron}>{expanded.has(index) ? '⌄' : '›'}</span><span><strong>{modifier.label}</strong><small>{navigation?.navigation?.display ?? modifier.summary}</small></span>
        </button>
        <button type="button" className={styles.modifierMenuButton} aria-label={`${modifier.label} actions`} aria-expanded={menu === modifier.id} onClick={() => setMenu(menu === modifier.id ? null : modifier.id)}>···</button>
      </div>
      {menu === modifier.id && <div className={styles.modifierActions} aria-label={`${modifier.label} actions`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setMenu(null) } }}>
        <button type="button" disabled={busy || !modifier.capabilities.moveUp} onClick={() => move(index, index - 1)}>Move up</button>
        <button type="button" disabled={busy || !modifier.capabilities.moveDown} onClick={() => move(index, index + 1)}>Move down</button>
        <button type="button" disabled={busy || !modifier.capabilities.duplicate} onClick={() => void run({ kind: 'modifier-duplicate', modifier: modifier.id }, new Set([...expanded].map(i => i > index ? i + 1 : i).concat(index + 1)))}>Duplicate</button>
        <button type="button" disabled={busy || !modifier.capabilities.remove} onClick={() => void run({ kind: 'modifier-remove', modifier: modifier.id }, new Set([...expanded].filter(i => i !== index).map(i => i > index ? i - 1 : i)))}>Remove</button>
      </div>}
      {expanded.has(index) && <div className={styles.modifierBody}>
        {modifier.controls.map(control => onChange && <PropertyControl key={`${control.id}:${control.value}`} control={control} label={controlLabel(control, modifier)} onChange={onChange} />)}
        {!modifier.controls.length && !navigation && <p className={styles.note}>{modifier.category === 'custom' ? 'Custom modifier' : 'Configured in code'}</p>}
        {modifier.capabilities.reason && <p className={styles.note}>{modifier.capabilities.reason}</p>}
        {navigation && <button type="button" onClick={() => { const editor = document.getElementById(navigationDestinationEditorId(navigation)); editor?.scrollIntoView({ block: 'nearest' }); editor?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus() }}>Change destination</button>}
        {!navigation && (!modifier.capabilities.edit || !modifier.controls.length) && onReveal && <button type="button" onClick={() => onReveal(modifier.source)}>Edit in Code</button>}
      </div>}
    </article>})}
    {!behavior && !!entries.length && <div className={`${styles.dropEnd} ${dropIndex === modifiers.length ? styles.dropBefore : ''}`} aria-hidden="true" onDragOver={event => { if (event.dataTransfer.types.includes('application/x-studio-modifier')) { event.preventDefault(); setDropIndex(modifiers.length) } }} onDrop={event => { event.preventDefault(); drop(modifiers.length) }} />}
    {!behavior && !!node.modifierCatalog?.length && <button type="button" ref={addButton} className={styles.addModifier} disabled={busy || !onCommand} aria-expanded={picker} onClick={() => { setPicker(!picker); setQuery('') }}>＋ Add modifier</button>}
    {picker && <div className={styles.modifierPicker} role="dialog" aria-label="Add modifier" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setPicker(false); addButton.current?.focus() } }}>
      <div className={styles.sectionHeading}><strong>Add modifier</strong><button type="button" aria-label="Close modifier list" onClick={() => { setPicker(false); addButton.current?.focus() }}>×</button></div>
      <input aria-label="Search modifiers" placeholder="Search modifiers…" value={query} onChange={event => setQuery(event.target.value)} autoFocus />
      <div className={styles.catalog}>{catalog.map(item => <button key={item.name} type="button" disabled={busy || !item.available} title={item.reason} onClick={() => void run({ kind: 'modifier-add', name: item.name }, new Set([...expanded, modifiers.length]))}><span>{item.label}</span><small>{item.available ? item.category : item.reason}</small></button>)}</div>
      {!catalog.length && <p className={styles.note}>No matching modifiers.</p>}
      <p className={styles.note}>Added at the end of the stack.</p>
    </div>}
    {busy && <p role="status" className={styles.note}>Applying modifier…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>
}
