'use client'

import { useState } from 'react'
import { formatShortcut } from '../lib/shortcuts'
import { Spotlight } from './Spotlight'
import { Icon } from './ui/Icon'
import styles from './AddView.module.css'

/**
 * The shortcuts, by where they work; the note says where when the group alone does not.
 * Code before Design, so the two short groups share the first column.
 */
const groups = [
  ['Workspace', [
    ['Keyboard shortcuts', 'Mod /', 'Outside the code editor'],
    ['Open a file', 'Mod P'],
    ['Save', 'Mod S'],
    ['Switch Design / Code', '`', 'Outside fields'],
    ['Show / hide left panel', 'Mod 0'],
    ['Show / hide right panel', 'Mod Alt Enter'],
    ['Show / hide problems and output', 'Mod Shift Y'],
    ['Restart preview', 'Mod R'],
    ['Rename app', 'Enter / Double-click', 'On the app name'],
  ]],
  ['Code', [
    ['Toggle inspection', 'Mod I'],
    ['Comment line', 'Mod /', 'In the code editor'],
    ['Rename symbol', 'F2', 'In the code editor'],
    ['Rename file', 'F2 / Double-click', 'In Files'],
  ]],
  ['Design', [
    ['Select a whole card or row', 'Click'],
    ['Go into a view, or edit its text', 'Double-click'],
    ['Select the innermost view', 'Mod Click'],
    ['Add to the selection', 'Shift Click'],
    ['Select the view around it', 'Esc'],
    ['Add a view', 'A'],
    ['Select tool', 'V'],
    ['Delete selected view', 'Backspace'],
    ['Duplicate selected view', 'Mod D'],
    ['Hide selected view', 'Mod Shift H'],
    ['Group in a Column, Row or Overlap', 'Mod G'],
    ['Move selected view', 'Alt ↑ / Alt ↓'],
    ['Undo canvas edit', 'Mod Z'],
    ['Redo canvas edit', 'Mod Shift Z'],
    ['Copy / paste view', 'Mod C / Mod V'],
    ['Show all screens', 'Mod Shift A'],
    ['Pan canvas', 'Scroll'],
    ['Zoom canvas', 'Mod Scroll / Pinch'],
  ]],
] as const satisfies readonly (readonly [string, readonly (readonly [string, string, string?])[]])[]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const needle = query.trim().toLowerCase()
  const results = groups.map(([group, rows]) => [group, rows.filter(row => [group, ...row].join(' ').toLowerCase().includes(needle))] as const).filter(([, rows]) => rows.length)
  return <Spotlight label="Keyboard shortcuts" testId="shortcuts-dialog" onClose={onClose}>{close => <>
    <header className={styles.field}><Icon name="keyboard" size={16} /><input aria-label="Search shortcuts" placeholder="Find a shortcut…" value={query} onChange={e => setQuery(e.target.value)} />
      <button type="button" className={styles.close} aria-label="Close shortcuts" onClick={() => close()}><Icon name="xmark" size={12} /></button>
    </header>
    <div className={`${styles.list} ${styles.shortcutList}`}>
      {results.map(([group, rows]) => <section key={group} aria-label={group}>
        <h3 className={styles.shortcutGroup}>{group}</h3>
        {rows.map(([name, keys, context]) => <div className={styles.shortcutRow} key={name}>
          <div><span className={styles.name}>{name}</span>{context ? <span className={styles.shortcutContext}>{context}</span> : null}</div>
          <kbd>{formatShortcut(keys, mac)}</kbd>
        </div>)}
      </section>)}
      {!results.length ? <p className={styles.empty}>No matching shortcuts.</p> : null}
    </div>
    <footer className={styles.footer}><span>Shortcuts wait while you type in a field.</span><span>esc to close</span></footer>
  </>}</Spotlight>
}
