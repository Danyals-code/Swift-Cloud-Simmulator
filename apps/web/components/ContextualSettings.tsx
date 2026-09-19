'use client'

import type { AuthoringNode, SourceSpan } from '@studio/shared'
import { type authoringSettingsContext, settingsContextLabel, settingsVisualChildren } from '../lib/authoringSettings'
import { sourceLayerLabel } from '../lib/sourceLayers'
import { ModifierStack } from './ModifierStack'
import { NavigationDestinationEditor } from './NavigationDestinationEditor'
import { PropertyControl } from './PropertyControl'
import type { FeatureProps } from './AuthoringFeatures'
import styles from './AuthoringInspector.module.css'

type Context = ReturnType<typeof authoringSettingsContext>

export function ContextualSettings({ context, features, onReveal }: { context: Context; features?: Omit<FeatureProps, 'node'>; onReveal?: (source: SourceSpan) => void }) {
  const ancestors = new Set(context.ancestors.map(ancestor => ancestor.id))
  const navigationLinks = new Set(context.navigation.filter(owner => owner.name === 'NavigationLink').map(owner => owner.id))
  const conditions = context.conditions.filter(condition => condition.name !== 'Otherwise' && !condition.name.startsWith('Case '))
  const contentButtons = (owner: AuthoringNode) => settingsVisualChildren(features?.snapshot, owner).map(child => <button key={child.id} type="button" onClick={() => features?.onSelect?.(child)}>{sourceLayerLabel(child)}</button>)
  if (!conditions.length && !context.navigation.length && !context.slots.length && !context.surrounding.length) return null
  return <div className={styles.contextSettings} data-testid="settings-context">
    {!!conditions.length && <section><h4>Visibility</h4>{conditions.map(condition => {
      const expression = condition.properties.map(property => property.expression).join(' and ')
      const alternate = context.ancestors.find(ancestor => ancestor.parentId === condition.id && (ancestor.name === 'Otherwise' || ancestor.name.startsWith('Case ')))
      const applies = ancestors.has(condition.id)
      const summary = condition.name === 'Switch' ? alternate?.name.startsWith('Case ') ? `Show when ${expression} matches ${alternate.name.slice(5)}` : alternate ? `Show for other values of ${expression}` : `Choose content using ${expression}` : alternate ? `Show when ${expression} is false` : `Show when ${expression}`
      return <div key={condition.id} className={styles.contextItem}><p>{summary}</p>{!applies && <div className={styles.contextLinks}>{contentButtons(condition)}</div>}<button type="button" onClick={() => onReveal?.(condition.source)}>Edit condition in Code</button></div>
    })}</section>}
    {!!context.navigation.length && <section><h4>Navigation</h4>{context.navigation.map(owner => <div key={owner.id} className={styles.contextItem}>
      {owner.name === 'NavigationLink' ? <NavigationDestinationEditor key={`${owner.id}:${owner.navigation?.destination ?? ''}`} owner={owner} features={features} onReveal={onReveal} /> : <p>This content is inside a screen navigation container.</p>}
    </div>)}</section>}
    {!!context.slots.length && <section><h4>Additional content</h4>{context.slots.map(slot => <div key={slot.id} className={styles.contextItem}><p>{slot.name === 'Destination' ? 'Destination screen' : slot.name}</p><div className={styles.contextLinks}>{contentButtons(slot)}</div>{slot.name === 'Destination' && slot.parentId && navigationLinks.has(slot.parentId) ? null : slot.navigation ? <NavigationDestinationEditor key={`${slot.id}:${slot.navigation.destination}`} owner={slot} features={features} onReveal={onReveal} /> : <button type="button" onClick={() => onReveal?.(slot.source)}>Edit {slot.name.toLowerCase()} in Code</button>}</div>)}</section>}
    {context.surrounding.map(owner => <details key={owner.id} className={styles.contextItem} data-settings-owner={`${owner.owner}:${owner.name}:${owner.source.file}:${owner.source.start}`}><summary>{settingsContextLabel(owner)} settings</summary><p className={styles.note}>These settings affect the content inside this {settingsContextLabel(owner).toLowerCase()}.</p>
      {owner.controls?.filter(control => !/^(modifier:|add:|fill:)/.test(control.id)).map(control => features?.onNodeChange && <PropertyControl key={`${owner.id}:${control.id}:${control.value}`} control={control} onChange={(id, value) => features.onNodeChange!(owner, id, value)} />)}
      {!!owner.modifiers?.length && <ModifierStack node={owner} onChange={features?.onNodeChange ? (id, value) => features.onNodeChange!(owner, id, value) : undefined} onCommand={features?.onNodeCommand ? operation => features.onNodeCommand!(owner, operation) : undefined} onReveal={onReveal} />}
      {!!owner.modifiers?.some(modifier => modifier.category === 'behavior') && <ModifierStack node={owner} onChange={features?.onNodeChange ? (id, value) => features.onNodeChange!(owner, id, value) : undefined} onCommand={features?.onNodeCommand ? operation => features.onNodeCommand!(owner, operation) : undefined} onReveal={onReveal} navigationSlots={context.slots} behavior />}
      <button type="button" onClick={() => onReveal?.(owner.source)}>View {settingsContextLabel(owner).toLowerCase()} source</button>
    </details>)}
  </div>
}
