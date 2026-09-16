'use client'

import { useEffect, useState } from 'react'
import { EXPORT_FORMATS, type ExportFormat } from '@studio/shared'
import type { WorkspaceMode, WorkspaceTheme } from '../lib/layout'
import { Icon } from './ui/Icon'
import { MenuButton } from './ui/Menu'
import { PaneToggles, PushButton, ToolButton } from './ui/Control'
import styles from './Workspace.module.css'

export type PaneKey = 'navigator' | 'debug' | 'preview'

export interface ToolbarProps {
  mode: WorkspaceMode
  onModeChange: (mode: WorkspaceMode) => void
  theme: WorkspaceTheme
  onThemeChange: (theme: WorkspaceTheme) => void
  onOpenGallery: () => void
  projectName: string
  savedAt: number | null
  saveError: string | null
  panes: ReadonlySet<PaneKey>
  suppressed: ReadonlySet<PaneKey>
  onTogglePane: (pane: PaneKey) => void
  onExport: (format: ExportFormat) => void
  onShare: () => Promise<'copied' | 'too-large' | 'failed'>
}

interface PreviewToolsProps {
  paused: boolean
  inspecting: boolean
  busy: boolean
  errors: number
  warnings: number
  workerError: string | null
  onRun: () => void
  onTogglePaused: () => void
  onToggleInspect: () => void
}

const PANES = [
  { key: 'navigator', icon: 'sidebar-left' as const, label: 'Navigator', title: 'Show files (⌘0)' },
  { key: 'debug', icon: 'sidebar-bottom' as const, label: 'Debug area', title: 'Show problems and output (⌘⇧Y)' },
  { key: 'preview', icon: 'sidebar-right' as const, label: 'Preview', title: 'Show preview (⌘⌥↩)' },
]

/** Project actions stay in the header; preview tools live beside the canvas. */
export function Toolbar({ onOpenGallery, projectName, savedAt, saveError, mode, onModeChange, theme, onThemeChange,
  panes, suppressed, onTogglePane, onExport, onShare }: ToolbarProps) {
  return <header data-testid="toolbar" className={styles.toolbar}>
    <div className={styles.project}>
      <button type="button" onClick={onOpenGallery} aria-label="Open a project" title="Projects and templates" data-testid="app-icon" className={styles.home}><Icon name="screens" size={21} /></button>
      <div className={styles.projectCopy}><span className={styles.projectName} data-testid="project-name">{projectName}</span><span data-testid="save-indicator" className={saveError ? styles.saveError : styles.saveStatus}>{saveError ? 'Could not save' : savedAt ? 'Saved locally' : 'Local project'}</span></div>
    </div>
    <nav className={styles.modes} aria-label="Workspace view">
      {(['design', 'develop'] as const).map(value => <button key={value} type="button" data-testid={`workspace-${value}`} aria-pressed={mode === value} title={value === 'design' ? 'Focus on the app preview' : 'Code alongside the live preview'} onClick={() => onModeChange(value)}>{value === 'design' ? 'Design' : 'Develop'}</button>)}
    </nav>
    <div className={styles.actions}>
      <button type="button" data-testid="workspace-theme" className={styles.themeToggle} aria-label="Workspace dark mode" aria-pressed={theme === 'dark'} title={`Switch workspace to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}><Icon name="appearance" size={17} /></button>
      <span className={styles.paneControls}><PaneToggles options={PANES} shown={panes} suppressed={suppressed} onToggle={key => onTogglePane(key as PaneKey)} /></span>
      <span className={styles.share}><ShareButton onShare={onShare} /></span>
      <div className={styles.exportGroup}>
        <button type="button" onClick={() => onExport('xcodeproj')} data-testid="export-button" title="Export an Xcode project" className={styles.export}>Export<Icon name="download" size={14} /></button>
        <MenuButton items={EXPORT_FORMATS.map(f => ({value:f.id,label:f.name,detail:f.description}))} onSelect={value => onExport(value as ExportFormat)} label="Export format" testId="export-format" className={styles.exportMenu}><Icon name="chevron-down" size={11} /></MenuButton>
      </div>
    </div>
  </header>
}

export function PreviewTools({ paused, inspecting, busy, errors, warnings, workerError, onRun, onTogglePaused, onToggleInspect }: PreviewToolsProps) {
  const message = workerError ? 'Preview stopped' : errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : busy ? 'Updating' : paused ? 'Paused' : warnings ? `${warnings} warnings` : 'Live preview'
  return <div className={styles.toolDock} aria-label="Preview tools">
    <ToolButton icon="run" label="Run" title="Restart preview (⌘R)" onClick={onRun} testId="run-button" size={16} />
    <ToolButton icon="stop" label={paused ? 'Resume live preview' : 'Pause live preview'} active={paused} onClick={onTogglePaused} testId="pause-button" size={13} />
    <span className={styles.divider} />
    <PushButton onClick={onToggleInspect} active={inspecting} label="Inspect views" title="Inspect and reveal source (⌘I)" testId="inspect-toggle" icon="inspect">Inspect</PushButton>
    <span className={styles.divider} />
    <span data-testid="status-view" role="status" className={styles.previewStatus}><i data-state={errors || workerError ? 'error' : paused ? 'paused' : 'ready'} />{message}</span>
  </div>
}

function ShareButton({ onShare }: { onShare: ToolbarProps['onShare'] }) {
  const [result, setResult] = useState<'copied' | 'too-large' | 'failed' | null>(null)

  useEffect(() => {
    if (!result) return
    const timer = setTimeout(() => setResult(null), 2600)
    return () => clearTimeout(timer)
  }, [result])

  const label =
    result === 'copied'
      ? 'Link copied'
      : result === 'too-large'
        ? 'Too big to link'
        : result === 'failed'
          ? 'Copy failed'
          : 'Share'

  return (
    <PushButton
      onClick={() => void onShare().then(setResult)}
      title="Copy a link that carries this project - no account, no server"
      testId="share-button"
      icon="share"
    >
      {label}
    </PushButton>
  )
}
