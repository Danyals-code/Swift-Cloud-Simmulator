'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import type { AuthoringNode, ResourceOperation, SourceSpan } from '@studio/shared'
import { AuthoringFeatures, type FeatureProps } from './AuthoringFeatures'
import { PropertyControl, type PropertyChange } from './PropertyControl'
import { LayoutGuide } from './LayoutGuide'
import { ModifierStack } from './ModifierStack'
import { SurfaceFill } from './SurfaceFill'
import { NavigationDestinationEditor } from './NavigationDestinationEditor'
import { TokenField, valueFields } from './settings/TokenField'
import { sourceLayerIsVisual, sourceLayerLabel, sourceLayerType } from '../lib/sourceLayers'
import { authoringSettingsContext, settingsContextLabel, settingsVisualChildren } from '../lib/authoringSettings'
import { MenuButton } from './ui/Menu'
import { Icon } from './ui/Icon'
import styles from './AuthoringInspector.module.css'

/**
 * The View level: what the view is, then how it looks, in the order the code has it.
 *
 * Basics are the values the view is created with - what sits inside its parentheses,
 * like a column's spacing or a button's title and action. The modifier stack is
 * everything after, top to bottom. Data appears only for a list or a repeat, because
 * only those have any.
 */
/** The three ways a screen can open, in the words the canvas uses for its arrows. */
const NAVIGATE_TYPES: readonly { type: 'push' | 'sheet' | 'cover'; label: string }[] = [
  { type: 'push', label: 'Push' },
  { type: 'sheet', label: 'Sheet' },
  { type: 'cover', label: 'Full screen' },
]

export function AuthoringInspector({ node, stale, onReveal, onChange, features }: { features?: Omit<FeatureProps, 'node'>; node?: AuthoringNode; stale?: boolean; onReveal?: (span: SourceSpan) => void; onChange?: PropertyChange }) {
  const root = useRef<HTMLDivElement | null>(null)
  const focus = useRef<{ source: string; owner: string; control: string; label: string; caret: number | null; modifier?: string; button?: string } | null>(null)
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
    if (previous.modifier !== undefined) {
      const card = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-modifier-key]') ?? []).find(element => element.dataset.modifierKey === previous.modifier && (element.closest<HTMLElement>('[data-settings-owner]')?.dataset.settingsOwner ?? '') === previous.owner)
      const button = Array.from(card?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(element => (element.getAttribute('aria-label') ?? 'toggle') === previous.button)
      if (button) { button.focus({ preventScroll: true }); return }
    }
    const input = Array.from(root.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea') ?? []).find(element => (element.closest<HTMLElement>('[data-settings-owner]')?.dataset.settingsOwner ?? '') === previous.owner && (previous.control ? element.dataset.controlId === previous.control : element.getAttribute('aria-label')?.toLowerCase() === previous.label))
    if (!input) return
    input.focus({ preventScroll: true })
    if ((input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement && input.type === 'text') && previous.caret !== null) input.setSelectionRange(Math.min(previous.caret, input.value.length), Math.min(previous.caret, input.value.length))
  }, [selected, sourceKey, stale])
  const [navigateError, setNavigateError] = useState<string | null>(null)
  if (!selected) return <p className={styles.empty} role={stale ? 'status' : undefined}>{stale ? 'Updating views…' : 'Select a view in the tree or on the canvas.'}</p>
  const modifierControlIds = new Set(selected.modifiers?.flatMap(modifier => modifier.controls.map(control => control.id)) ?? [])
  const basics = selected.controls?.filter(control => !control.id.startsWith('modifier:') && !modifierControlIds.has(control.id) && (!control.id.startsWith('add:') || control.id === 'add:listStyle')) ?? []
  // A value inside a modifier belongs to that modifier's card; the rest are the view's own.
  const modifierProperties = new Set(selected.modifiers?.flatMap(modifier => modifier.propertyIds) ?? [])
  const basicProperties = selected.properties.filter(property => !modifierProperties.has(property.id)).map(property => property.id)
  const context = authoringSettingsContext(features?.snapshot, selected)
  const ancestors = context.ancestors
  const breadcrumbs = ancestors.filter(sourceLayerIsVisual).slice(-3)
  const nestedCollections = context.collections.filter(collection => collection.id !== selected.id)
  const forNode = (owner: AuthoringNode): Omit<FeatureProps, 'node'> | undefined => features ? { ...features, onCommand: owner.id === selected.id ? features.onCommand : features.onNodeCommand ? operation => features.onNodeCommand!(owner, operation) : undefined } : undefined
  const template = selected.kind === 'template' || ancestors.some(ancestor => ancestor.kind === 'template')
  const isList = selected.name === 'List' || selected.kind === 'collection' || selected.kind === 'template'
  const featureKey = `${sourceKey}:${selected.fingerprint}:${selected.collection?.signature}`
  const dataKey = `${featureKey}:${JSON.stringify(features?.previewInputs ?? [])}`
  const title = sourceLayerLabel(selected)
  const type = sourceLayerType(selected)
  const tokens = features?.snapshot?.styles ?? []
  const resource = (operation: ResourceOperation) => features?.onCommand ? features.onCommand(operation) : Promise.resolve('Select the view again.')
  const conditions = context.conditions.filter(condition => condition.name !== 'Otherwise' && !condition.name.startsWith('Case '))
  const links = context.navigation.filter(owner => owner.name === 'NavigationLink' && owner.navigation)
  // A button that presents a screen is a Navigate to as much as a link is, and it is
  // the only place the designer can turn a sheet back into a push.
  const presented = selected.modifiers?.find(modifier => ['sheet', 'fullScreenCover'].includes(modifier.name) && modifier.enabled !== false)
  const navigateCards: { node: AuthoringNode; type: 'push' | 'sheet' | 'cover' }[] = [
    ...links.map(owner => ({ node: owner, type: 'push' as const })),
    ...(presented && !links.length ? [{ node: selected, type: presented.name === 'sheet' ? 'sheet' as const : 'cover' as const }] : []),
  ]
  const interaction = !!selected.behavior && (selected.behavior.canConfigureAction || !!selected.behavior.binding)
  const advanced = !!selected.behavior && (selected.behavior.canConfigureAction || selected.behavior.states.length > 0) || !!selected.component
  // Only wrappers with something to set: a bare NavigationStack around every view is not news.
  const wrappers = context.surrounding.filter(owner => !!owner.modifiers?.length || owner.controls?.some(control => !/^(modifier:|add:|fill:)/.test(control.id)))
  const rememberFocus = (input: EventTarget) => {
    if (input instanceof HTMLButtonElement) {
      const modifier = input.closest<HTMLElement>('[data-modifier-key]')?.dataset.modifierKey
      if (modifier !== undefined) focus.current = { source: sourceKey, owner: input.closest<HTMLElement>('[data-settings-owner]')?.dataset.settingsOwner ?? '', modifier, button: input.getAttribute('aria-label') ?? 'toggle', control: '', label: '', caret: null }
    }
    if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) focus.current = { source: sourceKey, owner: input.closest<HTMLElement>('[data-settings-owner]')?.dataset.settingsOwner ?? '', control: input.dataset.controlId ?? '', label: input.getAttribute('aria-label')?.toLowerCase() ?? '', caret: input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.selectionStart : null }
  }
  return <div ref={root} className={styles.inspector} data-testid="authoring-inspector" aria-busy={stale}
    onFocusCapture={event => rememberFocus(event.target)} onSelectCapture={event => rememberFocus(event.target)} onInputCapture={event => rememberFocus(event.target)} onKeyDownCapture={event => rememberFocus(event.target)}
    onBlurCapture={event => { rememberFocus(event.target); if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focus.current = null }}>
    <fieldset disabled={stale} className={styles.inspectorFields}>
      <header className={styles.selectionHeader}>
        <div><strong>{title}</strong>{title !== type && <small>{type}</small>}</div>
        {onReveal && <MenuButton label="View actions" items={[{ value: 'code', label: 'Open in Code', icon: 'code' }, ...(breadcrumbs.length ? [{ value: 'parent', label: `Select ${sourceLayerLabel(breadcrumbs.at(-1)!)}` }] : [])]} onSelect={value => { if (value === 'code') onReveal(selected.source); else if (value === 'parent') features?.onSelect?.(breadcrumbs.at(-1)!) }}><Icon name="ellipsis" size={15} /></MenuButton>}
      </header>
      {template ? <p className={styles.scope}>Row design · changes apply to every row</p> : selected.kind === 'definition' && features?.snapshot ? <p className={styles.scope}>The Main · changes apply to every copy ({features.snapshot.nodes.filter(n => n.definitionId === selected.id).length})</p> : selected.runtimeIds.length > 1 ? <p className={styles.scope}>One design · changes apply to {selected.runtimeIds.length} places on screen</p> : null}
      {!!breadcrumbs.length && <nav className={styles.breadcrumbs} aria-label="Selection path">{breadcrumbs.map(ancestor => <button type="button" key={ancestor.id} onClick={() => features?.onSelect?.(ancestor)}>{sourceLayerLabel(ancestor)}</button>)}</nav>}
      {/* Code the studio does not rewrite is shown as what it is - a locked block -
          rather than as controls that quietly do nothing. */}
      {selected.kind === 'opaque' && <p className={styles.locked} data-testid="locked-block">
        <Icon name="lock" size={12} />
        <span>{selected.undrawn === 'unsupported' ? 'Written in Swift. The preview doesn’t draw it yet, and Xcode draws it as written. It is kept exactly as written.'
          : selected.undrawn === 'unknown' ? 'Written in Swift. The preview doesn’t know this view and shows a labelled box in its place. It is kept exactly as written.'
          : 'Written in Swift. It runs and draws here, and it is kept exactly as written.'}</span>
        {onReveal && <button type="button" className={styles.linkButton} onClick={() => onReveal(selected.source)}>Open in Code</button>}
      </p>}

      <SurfaceFill key={sourceKey} node={selected} onCommand={features?.onCommand} />
      <section className={styles.settingsSection} data-testid="settings-basics"><h3>Basics</h3>
        {['VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack'].includes(selected.name) && <LayoutGuide node={selected} />}
        {valueFields(selected, basics, basicProperties).map(field => field.style
          ? <TokenField key={`${field.style.property}:${field.style.token ?? field.style.value}`} field={field} tokens={tokens} busy={stale} onChange={onChange} onCommand={resource} />
          : field.control && onChange ? <PropertyControl key={`${selected.id}:${field.control.id}:${field.control.value}`} control={field.control} onChange={onChange} /> : null)}
        {!basics.length && !selected.component && !['definition', 'template'].includes(selected.kind) && !interaction && <p className={styles.note}>{selected.properties.some(property => property.valueKind === 'data-binding' || property.valueKind === 'component-argument') ? 'Its content comes from data.' : 'Nothing to set when it is created.'}</p>}
        {features && <AuthoringFeatures key={`basics:${featureKey}`} node={selected} {...features} section="basics" />}
        {interaction && features && <AuthoringFeatures key={`interaction:${featureKey}`} node={selected} {...features} section="interaction" />}
        {!!selected.fields?.length && features && <AuthoringFeatures key={`field:${dataKey}`} node={selected} {...features} section="field" />}
        {!!conditions.length && <div className={styles.shownWhen} data-testid="shown-when">{conditions.map(condition => {
          const expression = condition.properties.map(property => property.expression).join(' and ')
          const alternate = context.ancestors.find(ancestor => ancestor.parentId === condition.id && (ancestor.name === 'Otherwise' || ancestor.name.startsWith('Case ')))
          const summary = condition.name === 'Switch' ? alternate?.name.startsWith('Case ') ? `${expression} is ${alternate.name.slice(5)}` : `${expression} has another value` : alternate ? `${expression} is false` : expression
          return <div key={condition.id} className={styles.row}><span>Shown when</span><span><code>{summary}</code>{onReveal && <button type="button" className={styles.linkButton} onClick={() => onReveal(condition.source)}>Open in Code</button>}</span></div>
        })}</div>}
      </section>

      {!['definition', 'template', 'branch'].includes(selected.kind) && <section className={styles.settingsSection}>
        <ModifierStack disabled={stale} snapshot={features?.snapshot} key={sourceKey} node={selected} onChange={onChange} onCommand={features?.onCommand} onReveal={onReveal} features={features}
          leading={navigateCards.map(({ node, type }) => <div key={`${node.id}:${type}`} className={styles.navigateCard} data-testid="navigate-to" data-nav-type={type} data-settings-owner={`${node.owner}:${node.name}:${node.source.file}:${node.source.start}`}>
            <strong>Navigate to · {NAVIGATE_TYPES.find(item => item.type === type)?.label}</strong>
            {/* How the screen opens is a choice, not a fact of the code: changing it
                here rewrites the link or the button that presents it. */}
            <label className={styles.navigateType}>Opens
              <select aria-label="How it opens" value={type} disabled={stale || !features?.onNodeCommand} onChange={async event => {
                const next = event.target.value as 'push' | 'sheet' | 'cover'
                setNavigateError(await features!.onNodeCommand!(node, { kind: 'navigation-type', type: next }))
              }}>{NAVIGATE_TYPES.map(item => <option key={item.type} value={item.type}>{item.label}</option>)}</select>
            </label>
            {node.navigation && <NavigationDestinationEditor key={`${node.id}:${node.navigation.destination}`} owner={node} features={features} onReveal={onReveal} />}
            {navigateError && <p role="alert" className={styles.error}>{navigateError}</p>}
          </div>)} />
      </section>}

      {isList && <section className={styles.settingsSection} data-testid="settings-data"><h3>Data</h3>
        {features && (selected.name !== 'List' || !nestedCollections.length || selected.kind === 'collection') && <AuthoringFeatures key={`data:${dataKey}`} node={selected} {...features} section="data" />}
        {nestedCollections.map(collection => <div key={`collection:${dataKey}:${collection.id}:${collection.fingerprint}:${collection.collection?.signature}`} data-settings-owner={`${collection.owner}:${collection.name}:${collection.source.file}:${collection.source.start}`}><AuthoringFeatures node={collection} {...forNode(collection)} section="data" /></div>)}
      </section>}
      {context.repeatedBy && !isList && <p className={styles.note}>Part of a repeated row. <button type="button" className={styles.linkButton} onClick={() => features?.onSelect?.(context.list ?? context.repeatedBy!)}>Edit the list</button></p>}

      {!!wrappers.length && <details className={styles.settingsSection}><summary>Wrapped in · {wrappers.map(settingsContextLabel).join(', ')}</summary>
        {wrappers.map(owner => <div key={`${owner.owner}:${owner.name}:${owner.source.file}:${owner.source.start}`} className={styles.contextItem} data-settings-owner={`${owner.owner}:${owner.name}:${owner.source.file}:${owner.source.start}`}>
          <strong>{settingsContextLabel(owner)}</strong><p className={styles.note}>These settings apply to everything inside it.</p>
          {owner.controls?.filter(control => !/^(modifier:|add:|fill:)/.test(control.id)).map(control => features?.onNodeChange && <PropertyControl key={`${owner.id}:${control.id}:${control.value}`} control={control} onChange={(id, value) => features.onNodeChange!(owner, id, value)} />)}
          {!!owner.modifiers?.length && <ModifierStack disabled={stale} node={owner} snapshot={features?.snapshot} features={features} onChange={features?.onNodeChange ? (id, value) => features.onNodeChange!(owner, id, value) : undefined} onCommand={features?.onNodeCommand ? operation => features.onNodeCommand!(owner, operation) : undefined} onReveal={onReveal} />}
          {!owner.modifiers?.length && !owner.controls?.length && <div className={styles.contextLinks}>{settingsVisualChildren(features?.snapshot, owner).map(child => <button key={child.id} type="button" onClick={() => features?.onSelect?.(child)}>{sourceLayerLabel(child)}</button>)}</div>}
        </div>)}
      </details>}

      {advanced && features && <details className={styles.settingsSection} data-testid="settings-advanced"><summary>Advanced</summary>
        <AuthoringFeatures key={`advanced:${featureKey}`} node={selected} {...features} section="advanced" />
      </details>}
    </fieldset>
    {stale && <p className={styles.note} role="status">Updating preview…</p>}
  </div>
}
