'use client'

import { useState } from 'react'
import type { AuthoringNode, AuthoringSnapshot } from '@studio/shared'
import { sourceLayerLabel } from '../lib/sourceLayers'
import styles from './AuthoringInspector.module.css'

export function ComponentLibrary({ snapshot, screenNames, target, busy, onSelect, onInsert }: { snapshot?: AuthoringSnapshot; screenNames: readonly string[]; target?: AuthoringNode; busy: boolean; onSelect: (node: AuthoringNode) => void; onInsert: (name: string) => Promise<string | null> }) {
  const [query, setQuery] = useState(''), [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false)
  const instances = snapshot?.nodes.filter(n => n.component && !screenNames.includes(n.name)) ?? []
  const components = [...new Set(instances.map(n => n.name))].filter(name => name.toLowerCase().includes(query.toLowerCase()))
  return <details className={`${styles.inspector} ${styles.features}`} data-testid="component-library"><summary>Components · {new Set(instances.map(n => n.name)).size}</summary>
    <p>Reuse a shared design, then customize each instance’s inputs.</p>
    <label>Find a component<input aria-label="Find a component" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {!components.length && <p>Select a layer and choose “Create reusable component” in Properties.</p>}
    {components.map(name => {
      const sites = instances.filter(n => n.name === name), instance = sites.find(n => n.component?.reusable) ?? sites[0]!
      const definition = snapshot?.nodes.find(n => n.id === instance.component!.definitionId)
      return <section key={name}><h3>{sourceLayerLabel(instance)}</h3><p>{sites.length} {sites.length === 1 ? 'instance' : 'instances'} · shared layout and style</p>
        <div className={styles.actions}><button type="button" disabled={busy || pending || !target || !instance.component!.reusable} onClick={async () => { setPending(true); try { setError(await onInsert(name)) } finally { setPending(false) } }}>Insert {name}</button><button type="button" disabled={busy || !definition} onClick={() => definition && onSelect(definition)}>Edit {name} design</button></div>
        {!instance.component!.reusable && <p>This instance needs values from its screen. Duplicate it there to preserve those connections.</p>}
      </section>
    })}
    {target && <p>Insertion uses the selected {sourceLayerLabel(target)}. Choose a layout to add inside it.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </details>
}
