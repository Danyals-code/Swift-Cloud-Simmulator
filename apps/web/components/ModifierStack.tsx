'use client'

import { useRef, useState } from 'react'
import type { AuthoringModifier, AuthoringNode, AuthoringSnapshot, DesignControl, ModifierCatalogEntry, ResourceOperation, SourceSpan } from '@studio/shared'
import type { FeatureChange, FeatureProps } from './AuthoringFeatures'
import { PropertyControl, propertyOptionLabel, type PropertyChange } from './PropertyControl'
import { NavigationDestinationEditor } from './NavigationDestinationEditor'
import { TokenField, valueFields } from './settings/TokenField'
import { MenuButton } from './ui/Menu'
import { Icon } from './ui/Icon'
import styles from './AuthoringInspector.module.css'

/** A control's label inside its card: the argument it edits, not the modifier again. */
function controlLabel(control: DesignControl, modifier: AuthoringModifier): string {
  if (/:(then|else)$/.test(control.id)) return `${modifier.label} · ${control.label.split(' · ').slice(1).join(' · ')}`
  if (control.id.startsWith('fill:')) return control.label
  if (modifier.name === 'font') return control.label === 'Typography' ? 'Text style' : control.label
  if (control.id.endsWith(':degrees')) return 'Degrees'
  if (control.id.endsWith(':cornerRadius')) return 'Radius'
  const name = control.label.split(' · ')[1]
  if (name && !/^\d+$/.test(name)) return name === 'radius' && modifier.name === 'shadow' ? 'Blur' : name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
  if (['foregroundColor', 'foregroundStyle', 'background', 'fill', 'tint', 'border'].includes(modifier.name)) return 'Color'
  return modifier.label
}

const GROUPS: readonly { category: ModifierCatalogEntry['category']; title: string }[] = [
  { category: 'layout', title: 'Layout' }, { category: 'appearance', title: 'Look' }, { category: 'text', title: 'Text' }, { category: 'behavior', title: 'Behavior' },
]
/** Three likely first modifiers for each kind of view. */
function suggestions(node: AuthoringNode): readonly string[] {
  if (['Text', 'Label'].includes(node.name)) return ['font', 'foregroundStyle', 'padding']
  if (node.name === 'Button') return ['buttonStyle', 'tint', 'padding']
  if (['Image', 'AsyncImage'].includes(node.name)) return ['frame', 'clipShape', 'shadow']
  return ['padding', 'background', 'clipShape']
}
const PRESENTATIONS: Readonly<Record<string, string>> = { sheet: 'Sheet', fullScreenCover: 'Full screen', navigationDestination: 'Push', popover: 'Popover' }

export interface ModifierStackProps {
  node: AuthoringNode
  snapshot?: AuthoringSnapshot
  onChange?: PropertyChange
  onCommand?: FeatureChange
  onReveal?: (span: SourceSpan) => void
  features?: Omit<FeatureProps, 'node'>
  /** Shown above the list: navigation that belongs to this view, as a Navigate to card. */
  leading?: React.ReactNode
}

/**
 * The modifier stack, as the code has it.
 *
 * Every modifier after the view, in source order - top runs first, and each one wraps
 * everything above it. Behaviour (when shown, when tapped, sheets) sits at its real
 * position rather than in a section of its own, because moving it changes what it
 * applies to exactly as it does for padding.
 */
export function ModifierStack({ node, snapshot, onChange, onCommand, onReveal, features, leading }: ModifierStackProps) {
  const modifiers = node.modifiers ?? []
  const tokens = snapshot?.styles ?? []
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set(modifiers.length === 1 ? [0] : []))
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
    inFlight.current = true; setBusy(true); setError(null)
    try {
      const problem = await onCommand(operation)
      setError(problem)
      if (!problem) { if (openAfter) setExpanded(openAfter); setPicker(false); setQuery('') }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change this modifier.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const resource = (operation: ResourceOperation) => onCommand ? onCommand(operation) : Promise.resolve('Select the view again.')
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
  const add = (name: string) => void run({ kind: 'modifier-add', name }, new Set([...expanded, modifiers.length]))
  const catalog = (node.modifierCatalog ?? []).filter(item => !item.hidden)
  const needle = query.trim().toLowerCase()
  const matching = catalog.filter(item => !needle || `${item.label} ${item.description ?? ''} ${item.name}`.toLowerCase().includes(needle))
  const suggested = suggestions(node).map(name => catalog.find(item => item.name === name)).filter((item): item is ModifierCatalogEntry => !!item?.available)
  const slots = snapshot?.nodes.filter(n => n.kind === 'branch' && !!n.navigation) ?? []
  return <div className={styles.modifierStack} data-testid="modifier-stack" aria-busy={busy}>
    <div className={styles.sectionHeading}><h3>Modifiers</h3>{!!node.modifierCatalog?.length && <button type="button" ref={addButton} className={styles.addButton} disabled={busy || !onCommand} aria-expanded={picker} aria-label="Add modifier" title="Add modifier" onClick={() => { setPicker(!picker); setQuery('') }}><Icon name="plus" size={13} /></button>}</div>
    {leading}
    {picker && <div className={styles.modifierPicker} role="dialog" aria-label="Add modifier" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setPicker(false); addButton.current?.focus() } }}>
      <input aria-label="Search modifiers" placeholder="Search modifiers…" value={query} onChange={event => setQuery(event.target.value)} autoFocus onKeyDown={event => { if (event.key === 'Enter') { const first = matching.find(item => item.available); if (first) { event.preventDefault(); add(first.name) } } }} />
      {!needle && !!suggested.length && <div className={styles.suggested}><small>Suggested</small>{suggested.map(item => <button key={item.name} type="button" disabled={busy} onClick={() => add(item.name)}>{item.label}</button>)}</div>}
      <div className={styles.catalog}>{GROUPS.map(group => {
        const items = matching.filter(item => item.category === group.category)
        return items.length ? <div key={group.category} role="group" aria-label={group.title}><small className={styles.catalogGroup}>{group.title}</small>{items.map(item => <button key={item.name} type="button" disabled={busy || !item.available} title={item.reason} onClick={() => add(item.name)}><span>{item.label}</span><small>{item.available ? item.description : item.reason}</small></button>)}</div> : null
      })}</div>
      {!matching.length && <p className={styles.note}>No matching modifiers.</p>}
      <p className={styles.note}>New modifiers go where they usually belong. Drag to reorder: the top one runs first.</p>
    </div>}
    {!modifiers.length && <div className={styles.emptyStack}><p className={styles.note}>No modifiers yet.</p>{!!suggested.length && <div className={styles.suggested}>{suggested.map(item => <button key={item.name} type="button" disabled={busy || !onCommand} onClick={() => add(item.name)}>+ {item.label}</button>)}</div>}</div>}
    {modifiers.map((modifier, index) => {
      const enabled = modifier.enabled !== false
      const slot = slots.find(candidate => candidate.navigation?.editable && candidate.source.file === modifier.source.file && candidate.source.start >= modifier.source.start && candidate.source.end <= modifier.source.end)
      const presentation = PRESENTATIONS[modifier.name]
      const label = presentation ? 'Navigate to' : modifier.label
      const summary = !enabled ? 'Off' : presentation ? `${presentation}${slot?.navigation?.display ? ` · ${slot.navigation.display}` : ''}` : modifier.controls.length ? modifier.controls.filter(control => !control.id.startsWith('fill:')).map(control => control.kind === 'select' ? propertyOptionLabel(control.value) : control.value || 'Default').join(' · ') : modifier.summary
      const open = expanded.has(index)
      const actions = [
        { value: 'up', label: 'Move up', disabled: busy || !modifier.capabilities.moveUp },
        { value: 'down', label: 'Move down', disabled: busy || !modifier.capabilities.moveDown },
        { value: 'duplicate', label: 'Duplicate', disabled: busy || !modifier.capabilities.duplicate },
        { value: 'remove', label: 'Remove', disabled: busy || !modifier.capabilities.remove, separated: true },
        ...(onReveal ? [{ value: 'code', label: 'Open in Code', separated: true }] : []),
      ]
      return <article key={modifier.id} className={`${styles.modifierCard} ${dropIndex === index ? styles.dropBefore : ''}`} data-testid="modifier-card" data-modifier-name={modifier.name} data-enabled={enabled}
        onDragOver={event => { if (event.dataTransfer.types.includes('application/x-studio-modifier') && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropIndex(index) } }}
        onDrop={event => { if (event.dataTransfer.types.includes('application/x-studio-modifier')) { event.preventDefault(); drop(index) } }}>
        <div className={styles.modifierHeader}>
          <span className={styles.dragHandle} aria-hidden="true" title="Drag to reorder" draggable={!busy && (modifier.capabilities.moveUp || modifier.capabilities.moveDown)} onDragStart={event => { drag.current = { id: modifier.id, index }; event.dataTransfer.setData('application/x-studio-modifier', modifier.id); event.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { drag.current = null; setDropIndex(null) }}>⠿</span>
          <button type="button" className={styles.modifierToggle} aria-expanded={open} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next })}>
            <span className={styles.chevron}>{open ? '⌄' : '›'}</span><span><strong>{label}</strong><small>{summary}</small></span>
          </button>
          {modifier.capabilities.toggle && <button type="button" role="switch" className={styles.switch} aria-checked={enabled} aria-label={`${label} ${enabled ? 'on' : 'off'}`} title={enabled ? 'Switch off (keeps it in the code, commented out)' : 'Switch on'} disabled={busy} onClick={() => void run({ kind: 'modifier-toggle', modifier: modifier.id, enabled: !enabled }, expanded)}><i /></button>}
          <span className={styles.modifierMenu}><MenuButton label={`${label} actions`} items={actions} onSelect={value => {
            if (value === 'up') move(index, index - 1)
            else if (value === 'down') move(index, index + 1)
            else if (value === 'duplicate') void run({ kind: 'modifier-duplicate', modifier: modifier.id }, new Set([...expanded].map(i => i > index ? i + 1 : i).concat(index + 1)))
            else if (value === 'remove') void run({ kind: 'modifier-remove', modifier: modifier.id }, new Set([...expanded].filter(i => i !== index).map(i => i > index ? i - 1 : i)))
            else if (value === 'code') onReveal?.(modifier.source)
          }}><Icon name="ellipsis" size={14} /></MenuButton></span>
        </div>
        {open && <div className={styles.modifierBody}>
          {!enabled ? <p className={styles.note}>Switched off. It stays in the code as a comment, and switching it on restores it exactly.</p> : <>
            {valueFields(node, modifier.controls, modifier.propertyIds).map((field, fieldIndex) => field.style
              ? <TokenField key={`${field.style.property}:${field.style.token ?? field.style.value}`} field={field} label={field.control ? controlLabel(field.control, modifier) : modifier.label} tokens={tokens} busy={busy} onChange={onChange} onCommand={resource} />
              : field.control && onChange ? <PropertyControl key={`${field.control.id}:${field.control.value}`} control={field.control} label={controlLabel(field.control, modifier)} onChange={onChange} /> : <span key={fieldIndex} />)}
            {slot && <NavigationDestinationEditor key={`${slot.id}:${slot.navigation?.destination}`} owner={slot} features={features} onReveal={onReveal} />}
            {!modifier.controls.length && !slot && !valueFields(node, [], modifier.propertyIds).length && <p className={styles.note}>{modifier.category === 'custom' ? 'A custom modifier from your code.' : modifier.summary === 'On' ? 'No settings. Switch it off or remove it to undo.' : 'Set in code.'}</p>}
          </>}
          {modifier.capabilities.reason && <p className={styles.note}>{modifier.controls.length && !modifier.capabilities.moveUp && !modifier.capabilities.moveDown ? 'Values are editable. This one stays in place to keep its layout and behavior.' : modifier.capabilities.reason}</p>}
        </div>}
      </article>
    })}
    {!!modifiers.length && <div className={`${styles.dropEnd} ${dropIndex === modifiers.length ? styles.dropBefore : ''}`} aria-hidden="true" onDragOver={event => { if (event.dataTransfer.types.includes('application/x-studio-modifier')) { event.preventDefault(); setDropIndex(modifiers.length) } }} onDrop={event => { event.preventDefault(); drop(modifiers.length) }} />}
    {busy && <p role="status" className={styles.note}>Applying…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>
}
