'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import type { AuthoringNode, PropertyValueKind, SourceSpan } from '@studio/shared'
import { AuthoringFeatures, type FeatureProps } from './AuthoringFeatures'
import { PropertyControl, type PropertyChange } from './PropertyControl'
import { ModifierStack } from './ModifierStack'
import { sourceLayerIsVisual, sourceLayerLabel, sourceLayerType } from '../lib/sourceLayers'
import { authoringSettingsContext } from '../lib/authoringSettings'
import { ContextualSettings } from './ContextualSettings'
import styles from './AuthoringInspector.module.css'

const LABELS: Record<PropertyValueKind, string> = { literal: 'Literal', token: 'Shared style', 'data-binding': 'Linked data', 'component-argument': 'Component input', inherited: 'From parent', computed: 'Expression', unsupported: 'Custom code' }

export function AuthoringInspector({ node, stale, onReveal, onChange, features }: { features?: Omit<FeatureProps, 'node'>; node?: AuthoringNode; stale?: boolean; onReveal?: (span: SourceSpan) => void; onChange?: PropertyChange }) {
  const root = useRef<HTMLDivElement | null>(null)
  const focus = useRef<{ source: string; owner: string; control: string; label: string; caret: number | null } | null>(null)
  const [retained, setRetained] = useState(node)
  if (node && node !== retained) setRetained(node)
  // Keep card expansion and draft focus while the worker updates the preview.
  const selected = stale ? retained : node
  const sourceKey = selected ? `${features?.snapshot?.projectId}:${selected.owner}:${selected.source.file}:${selected.source.start}` : ''
  useLayoutEffect(() => {
    if (stale) return
    const previous = focus.current
    if (!previous || previous.source !== sourceKey) { focus.current = null; return }
    if (document.activeElement !== document.body) return
    const input = Array.from(root.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea') ?? []).find(element => (element.closest<HTMLElement>('[data-settings-owner]')?.dataset.settingsOwner ?? '') === previous.owner && (previous.control ? element.dataset.controlId === previous.control : element.getAttribute('aria-label')?.toLowerCase() === previous.label))
    if (!input) return
    input.focus({ preventScroll: true })
    if ((input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement && input.type === 'text') && previous.caret !== null) input.setSelectionRange(Math.min(previous.caret, input.value.length), Math.min(previous.caret, input.value.length))
  }, [selected, sourceKey, stale])
  if (!selected) return <p className={styles.empty} role={stale ? 'status' : undefined}>{stale ? 'Updating views…' : 'Select a view in Layers or on the canvas.'}</p>
  const basics = selected.controls?.filter(control => !/^(modifier:|add:|fill:)/.test(control.id)) ?? []
  const context = authoringSettingsContext(features?.snapshot, selected)
  const ancestors = context.ancestors
  const breadcrumbs = ancestors.filter(sourceLayerIsVisual)
  const nestedCollections = context.collections.filter(collection => collection.id !== selected.id)
  const forNode = (owner: AuthoringNode): Omit<FeatureProps, 'node'> | undefined => features ? { ...features, onCommand: owner.id === selected.id ? features.onCommand : features.onNodeCommand ? operation => features.onNodeCommand!(owner, operation) : undefined } : undefined
  const template = selected.kind === 'template' || ancestors.some(ancestor => ancestor.kind === 'template')
  const hasData = selected.name === 'List' || selected.kind === 'collection' || !!selected.fields?.length || !!context.repeatedBy && selected.kind !== 'template' || !!nestedCollections.length
  const hasContext = !!context.conditions.length || !!context.navigation.length || !!context.slots.length || !!context.surrounding.length
  const hasBehavior = hasContext || !!selected.modifiers?.some(modifier => modifier.category === 'behavior') || !!selected.behavior && (selected.behavior.canConfigureAction || !!selected.behavior.binding || selected.behavior.states.length > 0)
  const featureKey = `${sourceKey}:${selected.fingerprint}:${selected.collection?.signature}`
  const dataKey = `${featureKey}:${JSON.stringify(features?.previewInputs ?? [])}`
  const stackAlignment = selected.controls?.find(control => control.label === 'Alignment')?.value ?? 'center'
  const title = sourceLayerLabel(selected)
  const type = sourceLayerType(selected)
  const rememberFocus = (input: EventTarget) => {
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) focus.current = { source: sourceKey, owner: input.closest<HTMLElement>('[data-settings-owner]')?.dataset.settingsOwner ?? '', control: input.dataset.controlId ?? '', label: input.getAttribute('aria-label')?.toLowerCase() ?? '', caret: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.selectionStart : null }
  }
  return <div ref={root} className={styles.inspector} data-testid="authoring-inspector" aria-busy={stale}
    onFocusCapture={event => rememberFocus(event.target)} onSelectCapture={event => rememberFocus(event.target)} onInputCapture={event => rememberFocus(event.target)} onKeyDownCapture={event => rememberFocus(event.target)}
    onBlurCapture={event => { rememberFocus(event.target); if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focus.current = null }}>
    <fieldset disabled={stale} className={styles.inspectorFields}>
      <header className={styles.selectionHeader}><div><strong>{title}</strong>{title !== type && <small>{type}</small>}</div><button type="button" onClick={() => onReveal?.(selected.source)} aria-label="View source" title="View source">&lt;/&gt;</button></header>
      {template ? <p className={styles.scope}>Row design · changes apply to all rows</p> : selected.runtimeIds.length > 1 ? <p className={styles.scope}>Shared design · updates {selected.runtimeIds.length} preview instances</p> : null}
      {!!breadcrumbs.length && <nav className={styles.breadcrumbs} aria-label="Selection path">{breadcrumbs.map(ancestor => <button type="button" key={ancestor.id} onClick={() => features?.onSelect?.(ancestor)}>{sourceLayerLabel(ancestor)}</button>)}</nav>}
      {['VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack'].includes(selected.name) && <div className={styles.layoutGuide} aria-label="Layout preview"><div data-direction={selected.name.includes('HStack') ? 'row' : selected.name === 'ZStack' ? 'overlay' : 'column'} style={{ gap: Math.min(24, Math.max(0, Number(selected.controls?.find(c => c.label === 'Spacing')?.value ?? 8))), minHeight: 56, alignItems: ['leading', 'top'].includes(stackAlignment) ? 'flex-start' : ['trailing', 'bottom'].includes(stackAlignment) ? 'flex-end' : stackAlignment.includes('Baseline') ? 'baseline' : 'center' }}>{[1, 2, 3].map(i => <span key={i}>{i}</span>)}</div><p>{selected.name === 'ZStack' ? 'Children overlap, back to front.' : selected.name.includes('HStack') ? 'Children flow left to right. Spacing sets the gap.' : 'Children flow top to bottom. Spacing sets the gap.'} The canvas updates when you apply spacing or alignment.</p></div>}
      <section className={styles.settingsSection} data-testid="settings-basics"><h3>Basics</h3>
        {basics.map(control => onChange && <PropertyControl key={`${selected.id}:${control.id}:${control.value}`} control={control} onChange={onChange} />)}
        {!basics.length && !selected.component && !['definition', 'template'].includes(selected.kind) && <p className={styles.note}>{selected.properties.some(property => property.valueKind === 'data-binding' || property.valueKind === 'component-argument') ? 'Content is linked to data.' : 'This view has no basic inputs.'}</p>}
        {features && <AuthoringFeatures key={`basics:${featureKey}`} node={selected} {...features} section="basics" />}
      </section>
      {!['definition', 'template', 'branch'].includes(selected.kind) && <section className={styles.settingsSection}><ModifierStack snapshot={features?.snapshot} key={sourceKey} node={selected} onChange={onChange} onCommand={features?.onCommand} onReveal={onReveal} /></section>}
      {hasData && <section className={styles.settingsSection} data-testid="settings-data"><h3>Data</h3>
        {context.repeatedBy && selected.kind !== 'template' && <div className={styles.contextItem}><p>Repeat for each item · this view belongs to the shared row design.</p><button type="button" onClick={() => features?.onSelect?.(context.list ?? context.repeatedBy!)}>List settings</button></div>}
        {features && (selected.name !== 'List' || !nestedCollections.length || selected.kind === 'collection') && <AuthoringFeatures key={`data:${dataKey}`} node={selected} {...features} section="data" />}
        {nestedCollections.map(collection => <div key={`collection:${dataKey}:${collection.id}:${collection.fingerprint}:${collection.collection?.signature}`} data-settings-owner={`${collection.owner}:${collection.name}:${collection.source.file}:${collection.source.start}`}><AuthoringFeatures node={collection} {...forNode(collection)} section="data" /></div>)}
      </section>}
      {hasBehavior && <section className={styles.settingsSection} data-testid="settings-behavior"><h3>Behavior</h3><ModifierStack snapshot={features?.snapshot} key={`behavior:${sourceKey}`} node={selected} onChange={onChange} onCommand={features?.onCommand} onReveal={onReveal} navigationSlots={context.slots} behavior />{features && <AuthoringFeatures key={`behavior:${featureKey}`} node={selected} {...features} section="behavior" />}<ContextualSettings context={context} features={features} onReveal={onReveal} /></section>}
      {!!selected.styles?.length && features && <details className={styles.settingsSection}><summary>Shared styles</summary><AuthoringFeatures key={`styles:${featureKey}`} node={selected} {...features} section="styles" /></details>}
      <details className={`${styles.source} ${styles.settingsSection}`}><summary>Code details</summary>
        {features && <AuthoringFeatures key={`advanced:${featureKey}`} node={selected} {...features} section="advanced" />}
        <dl className={styles.properties}>{selected.properties.map(property => <div key={property.id} className={styles.property} data-testid="authoring-property"><dt><span>{property.name}</span><span className={styles.badge}>{LABELS[property.valueKind]}</span></dt><dd><code>{property.expression}</code>{property.valueKind !== 'literal' && <p>{property.reason}</p>}{(property.declaration ?? property.source) && <button type="button" aria-label={`Show source for ${property.name}`} onClick={() => onReveal?.((property.declaration ?? property.source)!)}>Show source</button>}</dd></div>)}</dl>
      </details>
    </fieldset>
    {stale && <p className={styles.note} role="status">Updating preview…</p>}
  </div>
}
