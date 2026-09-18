'use client'

import { useEffect, useState } from 'react'
import { EXPORT_FORMATS, type ExportFormat } from '@studio/shared'
import type { WorkspaceMode, WorkspaceTheme } from '../lib/layout'
import { Icon } from './ui/Icon'
import { MenuButton } from './ui/Menu'
import { PaneToggles, PushButton } from './ui/Control'
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

/** What a click on the canvas does while designing. */
export type CanvasTool = 'select' | 'delete'

interface PreviewToolsProps {
  /** Design selects and edits; Live Preview runs the app. One or the other, always. */
  inspecting: boolean
  onSetInspecting: (inspecting: boolean) => void
  /** Design only: the row of editing actions above the switch. */
  showEditActions?: boolean
  tool: CanvasTool
  onSetTool: (tool: CanvasTool) => void
  /** Code inspects the app; Design designs it. Same switch, honest about each. */
  mode?: WorkspaceMode
  onAdd: () => void
  canAdd: boolean
  busy: boolean
  errors: number
  warnings: number
  workerError: string | null
}

/**
 * The three sidebars, named for what they hold in the workspace you are in.
 *
 * The right-hand one is the simulator in Code and the preview's settings in
 * Design, and calling both "Preview" made the Design toggle look like a switch
 * for the phone itself - which is the one thing in that workspace it cannot hide.
 */
const panesFor = (mode: WorkspaceMode) => [
  { key: 'navigator', icon: 'sidebar-left' as const, label: mode === 'design' ? 'Layers' : 'Navigator', title: mode === 'design' ? 'Show layers (⌘0)' : 'Show navigator (⌘0)' },
  { key: 'debug', icon: 'sidebar-bottom' as const, label: 'Debug area', title: 'Show problems and output (⌘⇧Y)' },
  { key: 'preview', icon: 'sidebar-right' as const, label: mode === 'design' ? 'Preview settings' : 'Preview', title: mode === 'design' ? 'Show preview settings (⌘⌥↩)' : 'Show preview (⌘⌥↩)' },
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
      {(['design', 'develop'] as const).map(value => <button key={value} type="button" data-testid={`workspace-${value}`} aria-pressed={mode === value} title={value === 'design' ? 'Focus on the app preview' : 'Code alongside the live preview'} onClick={() => onModeChange(value)}>{value === 'design' ? 'Design' : 'Code'}</button>)}
    </nav>
    <div className={styles.actions}>
      <button type="button" data-testid="workspace-theme" className={styles.themeToggle} aria-label="Workspace dark mode" aria-pressed={theme === 'dark'} title={`Switch workspace to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}><Icon name="appearance" size={17} /></button>
      <span className={styles.paneControls}><PaneToggles options={panesFor(mode)} shown={panes} suppressed={suppressed} onToggle={key => onTogglePane(key as PaneKey)} /></span>
      <span className={styles.share}><ShareButton onShare={onShare} /></span>
      <div className={styles.exportGroup}>
        <button type="button" onClick={() => onExport('xcodeproj')} data-testid="export-button" title="Export an Xcode project" className={styles.export}>Export<Icon name="download" size={14} /></button>
        <MenuButton items={EXPORT_FORMATS.map(f => ({value:f.id,label:f.name,detail:f.shortName,title:f.description}))} onSelect={value => onExport(value as ExportFormat)} label="Export format" testId="export-format" className={styles.exportMenu}><Icon name="chevron-down" size={11} /></MenuButton>
      </div>
    </div>
  </header>
}

/**
 * What the canvas is for, in two positions.
 *
 * Edit points at the app: hovering names a view in Layers and clicking selects it,
 * and it is where the editing actions and the page gallery live. Live Preview hands
 * the phone back to the person using it. They are a switch rather than two toggles
 * because a pointer over a phone has to mean one thing at a time.
 */
export function PreviewTools({ inspecting, onSetInspecting, showEditActions = false, tool, onSetTool, onAdd, canAdd, mode = 'design' }: PreviewToolsProps) {
  // The workspace is called Design; what the pointer does inside it is called Edit,
  // so that no word names two different things.
  const designing = mode === 'design' ? 'Edit' : 'Inspect'
  // Two rows of one width: three tools over the switch they belong to. The rows are
  // grids rather than rows of natural-width buttons, so "Delete" and "Live Preview"
  // line up down the edge instead of ending wherever their words happen to.
  return <div className={styles.toolDock} aria-label="Preview tools">
    {showEditActions && inspecting ? (
      <div className={`${styles.dockRow} ${styles.dockTools}`} role="group" aria-label="Edit actions">
        <PushButton onClick={() => onSetTool('select')} active={tool === 'select'} label="Arrange views" title="Select a view, and move it among its neighbours (V)" testId="tool-select" icon="inspect">Arrange</PushButton>
        <PushButton onClick={onAdd} disabled={!canAdd} label="Add a view" title={canAdd ? 'Add a view to the screen (A)' : 'Waiting for the preview'} testId="add-view" icon="plus">Add</PushButton>
        <span className={styles.destructive}>
          <PushButton onClick={() => onSetTool(tool === 'delete' ? 'select' : 'delete')} active={tool === 'delete'} label="Delete views" title="Click a view on the canvas to delete it (D)" testId="tool-delete" icon="xmark">Delete</PushButton>
        </span>
      </div>
    ) : null}
    <div className={`${styles.dockRow} ${styles.dockModes}`}>
      <PushButton onClick={() => onSetInspecting(true)} active={inspecting} label={designing} title={mode === 'design' ? 'Arrange, add and delete views (Tab)' : 'Point at a view to find its code (Tab)'} testId="inspect-toggle" icon="inspect">{designing}</PushButton>
      <PushButton onClick={() => onSetInspecting(false)} active={!inspecting} label="Preview" title="Tap, scroll and use the app (Tab)" testId="live-toggle" icon="run">Preview</PushButton>
    </div>
  </div>
}

/**
 * What the preview is doing, at the top of the canvas.
 *
 * Beside the app rather than in the dock under it: it is a state of the thing being
 * previewed, and it was the one item in a row of controls that could not be pressed.
 */
export function PreviewStatus({ inspecting, tool, mode = 'design', busy, errors, warnings, workerError }: Pick<PreviewToolsProps, 'inspecting' | 'tool' | 'mode' | 'busy' | 'errors' | 'warnings' | 'workerError'>) {
  const editing = mode === 'design' ? 'Editing' : 'Inspecting'
  const message = workerError ? 'Preview stopped' : errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : busy ? 'Updating' : warnings ? `${warnings} warnings` : inspecting ? tool === 'delete' ? 'Click a view to delete it' : editing : 'Live preview'
  return <span data-testid="status-view" role="status" className={styles.previewStatus}>
    <i data-state={errors || workerError ? 'error' : 'ready'} />{message}
  </span>
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
