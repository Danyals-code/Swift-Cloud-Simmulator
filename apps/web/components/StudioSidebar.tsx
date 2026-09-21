'use client'

import dynamic from 'next/dynamic'
import { useState, type ReactNode } from 'react'
import type { PromptSelection } from '@studio/project-model'
import { Icon } from './ui/Icon'
import styles from './Workspace.module.css'

const PromptEditor = dynamic(() => import('./PromptEditor').then(module => module.PromptEditor), { ssr: false, loading: () => <p className="p-3 text-xs">Loading Prompt Editing…</p> })
export function StudioSidebar({ children, design, selection, stale, onApplied, onCollapse }: { children: ReactNode; design: boolean; selection: PromptSelection | null; stale: boolean; onApplied: () => void; onCollapse: () => void }) {
  const [tab, setTab] = useState<'layers' | 'prompt'>('layers'), [opened, setOpened] = useState(false)
  const choose = (next: 'layers' | 'prompt') => { setTab(next); if (next === 'prompt') setOpened(true) }
  return <div className={styles.sidebar}>
    <div className={styles.sidebarHeader}><button type="button" aria-label="Collapse left panel" title="Collapse left panel (⌘0)" data-testid="pane-toggle-navigator" onClick={onCollapse}><Icon name="sidebar-left" size={14} /></button>
      <div role="tablist" aria-label="Left panel" className={styles.sidebarTabs} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'layers' : event.key === 'End' ? 'prompt' : tab === 'layers' ? 'prompt' : 'layers'; choose(next); event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus() } }}>
        <button type="button" id="sidebar-layers-tab" role="tab" data-tab="layers" aria-controls="sidebar-layers" aria-selected={tab === 'layers'} tabIndex={tab === 'layers' ? 0 : -1} onClick={() => choose('layers')}>{design ? 'Layers' : 'Files'}</button>
        <button type="button" id="sidebar-prompt-tab" role="tab" data-tab="prompt" aria-controls="sidebar-prompt" aria-selected={tab === 'prompt'} tabIndex={tab === 'prompt' ? 0 : -1} onClick={() => choose('prompt')}>Prompt Editing</button>
      </div>
    </div>
    <div id="sidebar-layers" role="tabpanel" aria-labelledby="sidebar-layers-tab" hidden={tab !== 'layers'} className={styles.sidebarContent}>{children}</div>
    <div id="sidebar-prompt" role="tabpanel" aria-labelledby="sidebar-prompt-tab" hidden={tab !== 'prompt'} className={styles.sidebarContent}>{opened && <PromptEditor selection={selection} stale={stale} onApplied={onApplied} />}</div>
  </div>
}
