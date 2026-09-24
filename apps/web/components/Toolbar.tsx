'use client'

import { useEffect, useRef, useState } from 'react'
import { EXPORT_FORMATS, type ArchiveFormat } from '@studio/shared'
import { BUILD_DATE, BUILD_DETAILS, BUILD_NAME } from '../lib/build'
import type { WorkspaceMode, WorkspaceTheme } from '../lib/layout'
import { unsaved, type StorageProblem } from '../lib/storageProblem'
import type { GallerySource } from './TemplateGallery'
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
  /** Opens the project sheet, on the projects in this browser or on starting a new one. */
  onOpenGallery: (source: GallerySource) => void
  projectName: string
  onRenameProject: (name: string) => boolean
  /** The project cannot be renamed now: an AI edit holds it. */
  renameDisabled?: boolean
  onReview?: () => void
  reviewDisabled?: boolean
  onShortcuts: () => void
  /** Copies which build this is, for a report or a question. */
  onCopyBuild: () => void
  savedAt: number | null
  /** What stands between the work and storage, which the label must not hide (B2, B3). */
  storage?: StorageProblem | null
  panes: ReadonlySet<PaneKey>
  suppressed: ReadonlySet<PaneKey>
  onTogglePane: (pane: PaneKey) => void
  onExport: (format: ArchiveFormat) => void
  exporting?: boolean
  onShare: () => Promise<'copied' | 'too-large' | 'failed'>
  /**
   * Design's preview environment - device, appearance, text size. It applies to
   * every screen at once, like SwiftUI's environment, so it lives here rather than
   * beside any one phone.
   */
  environment?: React.ReactNode
  /** Design only: whether the canvas is running the app rather than editing it. */
  previewing?: boolean
  onSetPreviewing?: (previewing: boolean) => void
  previewDisabled?: boolean
}

/** What a click on the canvas does while designing. */
export type CanvasTool = 'select' | 'delete'

interface PreviewToolsProps {
  /** Design selects and edits; Live Preview runs the app. One or the other, always. */
  inspecting: boolean
  onSetInspecting: (inspecting: boolean) => void
  /** Design only: the row of editing actions above the switch. */
  showEditActions?: boolean
  /** Code draws its Inspect/Preview switch here; Design's lives in the top bar. */
  showModeSwitch?: boolean
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
  onUndo: () => void
  onRedo: () => void
  onReset: () => void
  canUndo: boolean
  canRedo: boolean
  note?: string | null
  /** A way out of what the note reports - Show in Code, for a file that does not parse. */
  noteAction?: { readonly label: string; readonly onClick: () => void } | null
}

const debugPane = [{ key: 'debug', icon: 'sidebar-bottom' as const, label: 'Debug area', title: 'Show problems and output' }]

/** Project actions stay in the header; preview tools live beside the canvas. */
export function Toolbar({ onOpenGallery, projectName, savedAt, storage = null, mode, onModeChange, theme, onThemeChange,
  panes, suppressed, onTogglePane, onExport, onShare, onRenameProject, renameDisabled = false, onShortcuts, onCopyBuild, onReview, reviewDisabled,
  environment, previewing = false, onSetPreviewing, previewDisabled, exporting = false }: ToolbarProps) {
  const design = mode === 'design'
  // One Export menu: the four native formats, the editable archive, and - in Design -
  // the review sheet that exports PNGs. Two buttons that both "save the project
  // somewhere" were one decision presented as two.
  const exportItems = [
    { value: 'complete', label: 'Complete Xcode bundle', detail: 'Default', title: 'Xcode project, every screen PNG, settings report, prompts and chat history', disabled: exporting },
    ...EXPORT_FORMATS.map((f, index) => ({ value: f.id, label: f.id === 'xcodeproj' ? 'Xcode project only' : f.name, detail: f.shortName, title: f.description, separated: index === 0, disabled: exporting })),
    { value: 'editable', label: 'Editable archive', detail: '.swiftstudio.zip', title: 'Swift, images, app settings and designer metadata, to reopen here later', separated: true, disabled: exporting },
    ...(design && onReview ? [{ value: 'review', label: 'Review & export images…', title: 'Check contrast and touch targets, present screens, or export PNGs', disabled: reviewDisabled }] : []),
  ]
  const chooseExport = (value: string) => {
    if (value === 'review') onReview?.()
    else onExport(value as ArchiveFormat)
  }
  return <header data-testid="toolbar" className={styles.toolbar} data-mode={mode}>
    <div className={styles.project}>
      <button type="button" onClick={() => onOpenGallery('open')} title="Your projects, and new ones from templates" data-testid="app-icon" className={styles.home}><Icon name="screens" size={19} /><span>Projects</span></button>
      <div className={styles.projectCopy}><ProjectName key={projectName} name={projectName} onRename={onRenameProject} disabled={renameDisabled} /><SaveIndicator storage={storage} savedAt={savedAt} /></div>
    </div>
    <nav className={styles.modes} aria-label="Workspace view">
      {(['design', 'develop'] as const).map(value => <button key={value} type="button" data-testid={`workspace-${value}`} aria-pressed={mode === value} title={value === 'design' ? 'Design screens visually' : 'Swift code alongside the live preview'} onClick={() => onModeChange(value)}>{value === 'design' ? 'Design' : 'Code'}</button>)}
    </nav>
    <div className={styles.actions}>
      {design && environment && <div className={styles.environment} role="group" aria-label="Preview environment" data-testid="preview-environment">{environment}</div>}
      {design && onSetPreviewing && <button type="button" className={styles.previewToggle} data-testid={previewing ? 'inspect-toggle' : 'live-toggle'} aria-pressed={previewing} disabled={previewDisabled} title={previewing ? 'Back to editing (Tab)' : 'Try the app: tap, scroll and navigate (Tab)'} onClick={() => onSetPreviewing(!previewing)}><Icon name={previewing ? 'stop' : 'run'} size={13} />{previewing ? 'Stop preview' : 'Preview'}</button>}
      {!design && <span className={styles.paneControls}><PaneToggles options={debugPane} shown={panes} suppressed={suppressed} onToggle={key => onTogglePane(key as PaneKey)} /></span>}
      <span className={styles.share}><ShareButton onShare={onShare} /></span>
      <div className={styles.exportGroup}>
        <button type="button" onClick={() => onExport('complete')} disabled={exporting} aria-busy={exporting} data-testid="export-button" title="Export Xcode project, screen PNGs, settings report and AI conversation" className={styles.export}>{exporting ? 'Exporting…' : 'Export'}<Icon name="download" size={14} /></button>
        <MenuButton items={exportItems} onSelect={chooseExport} label="Export options" title="Other formats, the editable archive, and images" testId="export-format" className={styles.exportMenu}><Icon name="chevron-down" size={11} /></MenuButton>
      </div>
      <MenuButton items={[
        { value: 'new', label: 'New project…', icon: 'plus' },
        { value: 'projects', label: 'Your projects…', icon: 'folder' },
        { value: 'theme', label: theme === 'dark' ? 'Light workspace' : 'Dark workspace', icon: 'appearance', separated: true },
        { value: 'shortcuts', label: 'Keyboard shortcuts', detail: '⌘/', icon: 'keyboard' },
        ...(design ? [{ value: 'problems', label: 'Problems and output', detail: '⌘⇧Y', separated: true }] : []),
        { value: 'build', label: BUILD_NAME, detail: BUILD_DATE, title: `${BUILD_DETAILS}. Choose to copy it.`, icon: 'info' as const, separated: true },
      ]} onSelect={value => { if (value === 'new') onOpenGallery('design'); else if (value === 'projects') onOpenGallery('open'); else if (value === 'theme') onThemeChange(theme === 'dark' ? 'light' : 'dark'); else if (value === 'shortcuts') onShortcuts(); else if (value === 'problems') onTogglePane('debug'); else if (value === 'build') onCopyBuild() }} label="More" title="Workspace options" testId="workspace-more" className={styles.themeToggle}><Icon name="ellipsis" size={17} /></MenuButton>
    </div>
  </header>
}

/** Beside the project name: whether what is on screen is in this browser's storage. */
function SaveIndicator({ storage, savedAt }: { storage: StorageProblem | null; savedAt: number | null }) {
  const [label, title] = unsaved(storage) ? ['Could not save', storage?.kind === 'failing' ? storage.detail : 'Another tab has saved this project since.']
    : storage?.kind === 'memory' ? ['Not saved', 'This browser keeps nothing once the tab closes.']
    : [savedAt ? 'Saved locally' : 'Local project', undefined]
  return <span data-testid="save-indicator" title={title} className={title ? styles.saveError : styles.saveStatus}>{label}</span>
}

function ProjectName({ name, onRename, disabled }: { name: string; onRename: (name: string) => boolean; disabled: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const finished = useRef(false)
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select() } }, [editing])
  const finish = () => {
    if (finished.current) return
    finished.current = true
    if (!onRename(draft)) { finished.current = false; setError(true); input.current?.focus(); return }
    setEditing(false)
  }
  return editing ? <input ref={input} className={styles.projectNameInput} data-testid="project-name-input" aria-label="App name" aria-invalid={error} title={error ? 'Use a name without path separators or special filename characters.' : 'Enter to save, Escape to cancel'} value={draft}
    onChange={e => { setDraft(e.target.value); setError(false) }} onBlur={finish}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); finish() } else if (e.key === 'Escape') { finished.current = true; setEditing(false); setDraft(name) } }} />
    : <button type="button" className={styles.projectName} data-testid="project-name" disabled={disabled} title="Double-click to rename app" aria-label={`App name: ${name}. Double-click or press Enter to rename.`}
      onDoubleClick={() => { finished.current = false; setEditing(true) }}
      onKeyDown={e => { if (e.key === 'F2' || e.key === 'Enter') { e.preventDefault(); finished.current = false; setEditing(true) } }}>{name}</button>
}

/**
 * What the canvas is for, in two positions.
 *
 * Edit points at the app: hovering names a view in Layers and clicking selects it,
 * and it is where the editing actions and the page gallery live. Live Preview hands
 * the phone back to the person using it. They are a switch rather than two toggles
 * because a pointer over a phone has to mean one thing at a time.
 */
export function PreviewTools({ inspecting, onSetInspecting, showEditActions = false, showModeSwitch = true, tool, onSetTool, onAdd, canAdd, mode = 'design', busy, onUndo, onRedo, onReset, canUndo, canRedo, note, noteAction }: PreviewToolsProps) {
  // The workspace is called Design; what the pointer does inside it is called Edit,
  // so that no word names two different things.
  const designing = mode === 'design' ? 'Edit' : 'Inspect'
  // Two rows of one width: three tools over the switch they belong to. The rows are
  // grids rather than rows of natural-width buttons, so "Delete" and "Live Preview"
  // line up down the edge instead of ending wherever their words happen to.
  return <div className={styles.toolDock} aria-label="Preview tools">
    {note && <div className={styles.dockFeedback}>
      <span role="status" data-testid="design-feedback">{note}</span>
      {noteAction && <button type="button" className={styles.dockFeedbackAction} onClick={noteAction.onClick}>{noteAction.label}</button>}
    </div>}
    <div className={`${styles.dockRow} ${styles.dockHistory}`} role="group" aria-label="History and preview">
      <button type="button" onClick={onUndo} disabled={busy || !canUndo} aria-label="Undo" title="Undo the last document change (⌘Z)" data-testid="design-undo"><Icon name="undo" size={13} />Undo</button>
      <button type="button" onClick={onRedo} disabled={busy || !canRedo} aria-label="Redo" title="Redo the last undone change (⌘⇧Z)" data-testid="design-redo"><Icon name="redo" size={13} />Redo</button>
      <button type="button" onClick={onReset} disabled={busy} aria-label="Reset preview" title="Restart app interactions without changing your design" data-testid="reset-preview"><Icon name="refresh" size={13} />Reset</button>
    </div>
    {showEditActions && inspecting ? (
      <div className={`${styles.dockRow} ${styles.dockTools}`} role="group" aria-label="Edit actions">
        <PushButton onClick={() => onSetTool('select')} active={tool === 'select'} label="Select views" title="Select a view to change its properties (V)" testId="tool-select" icon="inspect">Select</PushButton>
        <PushButton onClick={onAdd} disabled={!canAdd} label="Add a view" title={canAdd ? 'Add a view to the screen (A)' : 'Waiting for the preview'} testId="add-view" icon="plus">Add</PushButton>
        <span className={styles.destructive}>
          <PushButton onClick={() => onSetTool(tool === 'delete' ? 'select' : 'delete')} active={tool === 'delete'} label="Delete views" title="Click a view on the canvas to delete it (D)" testId="tool-delete" icon="xmark">Delete</PushButton>
        </span>
      </div>
    ) : null}
    {showModeSwitch && <div className={`${styles.dockRow} ${styles.dockModes}`}>
      <PushButton disabled={busy} onClick={() => onSetInspecting(true)} active={inspecting} label={designing} title={mode === 'design' ? 'Arrange, add and delete views (Tab)' : 'Point at a view to find its code (Tab)'} testId="inspect-toggle" icon="inspect">{designing}</PushButton>
      <PushButton disabled={busy} onClick={() => onSetInspecting(false)} active={!inspecting} label="Preview" title="Tap, scroll and use the app (Tab)" testId="live-toggle" icon="run">Preview</PushButton>
    </div>}
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
  const message = workerError ? 'Preview stopped' : errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : warnings ? `${warnings} warnings` : inspecting ? tool === 'delete' ? 'Click a view to delete it' : editing : 'Live preview'
  return <span data-testid="status-view" role="status" aria-busy={busy} title={busy ? 'Updating preview…' : message} className={styles.previewStatus}>
    <i data-state={errors || workerError ? 'error' : busy ? 'updating' : 'ready'} />{message}
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
        ? 'Use Export › Editable archive'
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
