'use client'

import { useState } from 'react'
import { Spotlight } from './Spotlight'
import { Icon } from './ui/Icon'
import styles from './AddView.module.css'

const shortcuts = [
  ['Keyboard shortcuts', 'Mod /', 'Workspace'],
  ['Open a file', 'Mod P', 'Workspace'],
  ['Save', 'Mod S', 'Workspace'],
  ['Switch Design / Code', '`', 'Outside fields'],
  ['Switch Inspect / Preview', 'Tab', 'Code, with nothing focused'],
  ['Show / hide left panel', 'Mod 0', 'Workspace'],
  ['Show / hide right panel', 'Mod Alt Enter', 'Workspace'],
  ['Show / hide problems and output', 'Mod Shift Y', 'Workspace'],
  ['Restart preview', 'Mod R', 'Workspace'],
  ['Toggle inspection', 'Mod I', 'Code'],
  ['Show all pages', 'Mod Shift A', 'Design · Edit'],
  ['Add a view', 'A', 'Design · Edit'],
  ['Arrange views', 'V', 'Design · Edit'],
  ['Delete selected view', 'Backspace', 'Design · Edit'],
  ['Duplicate selected view', 'Mod D', 'Design · Edit'],
  ['Hide selected view', 'Mod Shift H', 'Design · Edit'],
  ['Move selected view', 'Alt ↑ / ↓', 'Design · Edit'],
  ['Undo canvas edit', 'Mod Z', 'Design · Edit'],
  ['Redo canvas edit', 'Mod Shift Z', 'Design · Edit'],
  ['Copy / paste view', 'Mod C / V', 'Design · Edit'],
  ['Rename symbol', 'F2', 'Code editor'],
  ['Rename file', 'F2 / double-click', 'Files panel'],
  ['Rename app', 'Enter / double-click', 'App name'],
  ['Pan canvas', 'Space + drag', 'Design'],
  ['Zoom canvas', 'Scroll', 'Design · Edit'],
] as const

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const results = shortcuts.filter(row => row.join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  return <Spotlight label="Keyboard shortcuts" testId="shortcuts-dialog" onClose={onClose}>{close => <>
    <header className={styles.field}><Icon name="keyboard" size={20} /><input aria-label="Search shortcuts" placeholder="Find a shortcut…" value={query} onChange={e => setQuery(e.target.value)} />
      <button type="button" aria-label="Close shortcuts" onClick={() => close()}><Icon name="xmark" /></button>
    </header>
    <div className={styles.list}>
      {results.map(([name, keys, context]) => <div className={styles.shortcutRow} key={name}>
        <div><span className={styles.name}>{name}</span><span className={styles.shortcutContext}>{context}</span></div>
        <kbd>{keys.replaceAll('Mod', mac ? '⌘' : 'Ctrl').replaceAll('Alt', mac ? '⌥' : 'Alt').replaceAll('Shift', '⇧')}</kbd>
      </div>)}
      {!results.length ? <p className={styles.empty}>No matching shortcuts.</p> : null}
    </div>
    <footer className={styles.footer}><span>Shortcuts wait while you type in a field.</span><span>esc to close</span></footer>
  </>}</Spotlight>
}
