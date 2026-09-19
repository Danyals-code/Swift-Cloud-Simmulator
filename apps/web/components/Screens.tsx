'use client'

import { useState } from 'react'
import type { AuthoringSnapshot, PagePreview } from '@studio/shared'
import { screenDefinition, type DesignScreen, type ScreenCommand } from '../lib/screens'
import { MenuButton } from './ui/Menu'
import { Icon } from './ui/Icon'
import styles from './Workspace.module.css'

export function Screens({ screens, pages, snapshot, selected, busy, onOpen, onCommand }: { screens: readonly DesignScreen[]; pages?: readonly PagePreview[]; snapshot?: AuthoringSnapshot; selected?: string; busy: boolean; onOpen: (page: PagePreview) => void; onCommand: (command: ScreenCommand) => Promise<string | null> }) {
  const [editing, setEditing] = useState<string | null>(null), [name, setName] = useState(''), [layout, setLayout] = useState<'VStack' | 'HStack' | 'ZStack'>('VStack')
  const [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false)
  const command = async (action: ScreenCommand) => { if (pending || busy) return; setPending(true); try { const problem = await onCommand(action); setError(problem); if (!problem) setEditing(null) } finally { setPending(false) } }
  return <section className={styles.screens} aria-label="Screens">
    <header><strong>Screens</strong><button type="button" aria-label="Add screen" disabled={busy || pending} onClick={() => { setEditing(''); setName('New screen'); setError(null) }}><Icon name="plus" size={14} /></button></header>
    <div className={styles.screenList}>{screens.map((screen, index) => {
      const page = pages?.find(p => p.id === 'screen:' + screen.view) ?? pages?.find(p => screenDefinition(snapshot, p)?.name === screen.view)
      const definition = snapshot?.nodes.find(n => n.kind === 'definition' && n.name === screen.view)
      const root = definition?.children.map(id => snapshot?.nodes.find(n => n.id === id)).find(n => n?.kind === 'view')
      const layoutName = root ? ({ VStack: 'Column', HStack: 'Row', ZStack: 'Overlay', NavigationStack: 'Navigation' }[root.name] ?? root.name) : 'Screen'
      const role = page?.kind === 'sheet' || page?.kind === 'cover' ? 'Sheet' : page?.parentId ? 'Destination' : page?.active ? 'App start' : 'Standalone'
      return <div className={styles.screenRow} key={screen.view} data-selected={page?.id === selected || undefined}>
        <button type="button" disabled={busy || !page} onClick={() => page && onOpen(page)} aria-label={`Open screen ${screen.name}`}><Icon name="screens" size={14} /><span>{screen.name}<small>{layoutName} · {role}</small></span></button>
        <MenuButton label={`Screen actions for ${screen.name}`} items={[
          { value: 'rename', label: 'Rename', disabled: busy }, { value: 'duplicate', label: 'Duplicate', disabled: busy },
          { value: 'up', label: 'Move up', disabled: busy || index === 0 }, { value: 'down', label: 'Move down', disabled: busy || index === screens.length - 1 },
          { value: 'remove', label: 'Remove screen', disabled: busy, separated: true },
        ]} onSelect={value => { if (value === 'rename') { setEditing(screen.view); setName(screen.name) } else void command({ kind: value as 'duplicate' | 'remove' | 'up' | 'down', view: screen.view }) }}><Icon name="ellipsis" size={14} /></MenuButton>
      </div>
    })}</div>
    {editing !== null && <form className={styles.screenForm} onSubmit={event => { event.preventDefault(); void command(editing ? { kind: 'rename', view: editing, name } : { kind: 'create', name, layout }) }}>
      <label>Screen name<input autoFocus aria-label="Screen name" maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      {!editing && <label>Root layout<select aria-label="Screen layout" value={layout} onChange={e => setLayout(e.target.value as typeof layout)}><option value="VStack">Column · top to bottom</option><option value="HStack">Row · left to right</option><option value="ZStack">Overlay · front to back</option></select></label>}
      <div><button type="submit" disabled={busy || pending || !name.trim()}>{editing ? 'Save screen name' : 'Create screen'}</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>
}
