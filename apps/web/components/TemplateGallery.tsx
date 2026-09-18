'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  TEMPLATE_CATALOG,
  type OpenedFile, type Project,
  type ProjectSummary,
  type TemplateInfo,
  type TemplateKind,
} from '@studio/project-model'
import type { Handoff } from '@studio/exporter'
import { readSwiftFiles } from '../lib/importSourceFiles'
import { Icon, type IconName } from './ui/Icon'
import { PushButton } from './ui/Control'
import dynamic from 'next/dynamic'
import styles from './TemplateGallery.module.css'

const ImportReview = dynamic(() => import('./ImportReview').then(m => m.ImportReview))

const PromptCreator = dynamic(() => import('./PromptCreator').then(m => m.PromptCreator), { loading: () => <p className="p-8 text-xc-text-2">Loading project creator…</p> })

/** Welcome window and project browser. Template sources load only after selection. */

export type GallerySource = 'open' | 'prompt' | TemplateKind

export interface TemplateGalleryProps {
  currentProject?: Project
  onImport?: (expected: Project, project: Project, removedNames: readonly string[]) => Promise<string | null>
  /** The project on screen, so the sheet can say what replacing it would cost. */
  projectId: string | null
  projectName: string
  fileCount: number
  /** Every project in this browser, newest first. */
  recents: readonly ProjectSummary[]
  /** Nothing has been typed since this project was laid down, so nothing is at risk. */
  pristine: boolean
  /** What the first load found. `null` before it resolves. */
  origin: 'restored' | 'shared' | 'fresh' | null
  savedAt: number | null
  /** True when the sheet opened by itself at launch rather than being asked for. */
  atLaunch?: boolean
  /** Returns false when the template's sources could not be fetched. */
  onChoose: (templateId: string) => Promise<boolean>
  /** Returns false when nothing usable was in the selection. */
  onOpenFiles: (files: readonly OpenedFile[]) => Promise<boolean>
  /** Reopens a project already in this browser. */
  onOpenProject: (id: string) => Promise<boolean>
  /** Deletes one. Never the one that is open. */
  onRemoveProject: (id: string) => void
  onClose: () => void
}

const SOURCES: readonly { key: GallerySource; label: string; icon: IconName; hint: string }[] = [
  { key: 'open', label: 'Your projects', icon: 'folder', hint: 'Continue a project or import Swift files' },
  { key: 'prompt', label: 'Agentic Coding', icon: 'new-file', hint: 'Describe an app and generate its first version' },
  { key: 'app', label: 'App templates', icon: 'screens', hint: 'Complete apps with connected screens' },
  { key: 'feature', label: 'Features', icon: 'grid', hint: 'Small examples of one SwiftUI concept' },
]

export function TemplateGallery({
  projectId,
  currentProject, onImport,
  projectName,
  fileCount,
  recents,
  pristine,
  origin,
  savedAt,
  atLaunch = false,
  onChoose,
  onOpenFiles,
  onOpenProject,
  onRemoveProject,
  onClose,
}: TemplateGalleryProps) {
  const apps = useMemo(() => TEMPLATE_CATALOG.filter((t) => t.kind === 'app'), [])
  const features = useMemo(() => TEMPLATE_CATALOG.filter((t) => t.kind === 'feature'), [])

  const [imported, setImported] = useState<{ local: Project; project: Project; handoff: Handoff } | null>(null)
  const [source, setSource] = useState<GallerySource>('prompt')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const creatingRef = useRef(false)
  const setGenerationBusy = useCallback((busy: boolean) => { creatingRef.current = busy; setCreating(busy) }, [])
  const [selected, setSelected] = useState<string>(apps[0]?.id ?? '')
  const [pending, setPending] = useState<{ what: string; run: () => void } | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  /**
   * The project a delete is waiting on.
   *
   * Deleting is the one action here that destroys something and makes nothing: a
   * replaced project can at least be recreated from its template, and this cannot be
   * recovered at all. It gets the same interruption, for the same reason.
   */
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const candidates = source === 'feature' ? features : source === 'app' ? apps : []
  const shown = candidates.filter((item) =>
    [item.name, item.tagline, item.description, ...(item.highlights ?? [])]
      .join(' ').toLowerCase().includes(query.trim().toLowerCase()),
  )
  const template = shown.find((item) => item.id === selected) ?? shown[0]

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (creatingRef.current) return
        if (deleting) setDeleting(null)
        else if (pending) setPending(null)
        else onClose()
      }
      if (event.key !== 'Tab') return
      const root = panelRef.current?.parentElement
      const activeDialog = root?.querySelector('[role="alertdialog"]') ?? panelRef.current
      const controls = activeDialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]):not([type="file"]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
      )
      const first = controls?.[0]
      const last = controls?.[controls.length - 1]
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !activeDialog?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === activeDialog || !activeDialog?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pending, deleting])

  /** Confirm before leaving an edited project; the saved copy remains in recents. */
  const replacing = useCallback(
    (what: string, run: () => void) => {
      if (pristine) run()
      else setPending({ what, run })
    },
    [pristine],
  )

  const choose = useCallback((item: TemplateInfo) => {
    if (creatingRef.current) return
    replacing(item.name, () => {
      creatingRef.current = true
      setCreating(true)
      setCreateError(null)
      void onChoose(item.id)
        .then((made) => {
          if (!made) setCreateError(`${item.name} could not be loaded. Please try again.`)
        })
        .catch(() => setCreateError(`${item.name} could not be loaded. Please try again.`))
        .finally(() => {
          creatingRef.current = false
          setCreating(false)
        })
    })
  }, [replacing, onChoose])

  /**
   * What came out of the picker, whichever of the two shapes it was.
   *
   * Loose `.swift` files are what a person can produce from Finder; a `.zip` is what
   * Export actually wrote. Both have to work, or the round trip this feature exists
   * for has a manual step in the middle of it.
   *
   * The archive reader is loaded on demand, in the chunk the exporter already has:
   * unzipping is not something the studio does on the way to its first paint.
   */
  const handleFiles = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return
      const picked = [...list]

      const archive = picked.find((file) => file.name.endsWith('.zip'))
      if (archive) {
        if (archive.size > 48 * 1024 * 1024) { setOpenError('That archive is too large. The limit is 48 MB.'); return }
        const { readProjectArchive } = await import('@studio/exporter')
        const { files, problem, project, handoff } = readProjectArchive(new Uint8Array(await archive.arrayBuffer()))
        if (problem) {
          setOpenError(problem)
          return
        }
        if (project && handoff && currentProject && onImport) { setImported({ local: currentProject, project, handoff }); return }
        setOpenError(null)
        replacing(`${archive.name}`, () => {
          void onOpenFiles(files).then((opened) => { if (!opened) setOpenError('Nothing in that archive could be opened.') })
        })
        return
      }

      let swift: readonly OpenedFile[]
      try { swift = await readSwiftFiles(picked) }
      catch (error) { setOpenError(error instanceof Error ? error.message : 'Those files could not be read.'); return }

      setOpenError(null)
      replacing(`${swift.length} file${swift.length === 1 ? '' : 's'}`, () => {
        void onOpenFiles(swift).then((opened) => { if (!opened) setOpenError('Those files could not be opened.') })
      })
    },
    [onOpenFiles, replacing, currentProject, onImport],
  )

  return (
    <div
      className={styles.backdrop}
      onPointerDown={atLaunch || creating ? undefined : onClose}
      data-testid="template-gallery"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Choose what to open"
        onPointerDown={(event) => event.stopPropagation()}
        className={styles.window}
      >
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}><GallerySymbol name="code-slash" /></span>
            <span><strong>Swift</strong><span>Web Studio</span></span>
          </div>
          <nav aria-label="Source" className={styles.navigation}>
            {SOURCES.map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={creating}
                onClick={() => {
                  setCreateError(null)
                  setQuery('')
                  setSource(item.key)
                  if (item.key === 'app') setSelected(apps[0]?.id ?? '')
                  if (item.key === 'feature') setSelected(features[0]?.id ?? '')
                }}
                aria-pressed={source === item.key}
                title={item.hint}
                data-testid={`gallery-source-${item.key}`}
                className={styles.navItem}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
                {(item.key === 'app' || item.key === 'feature') && <small>{item.key === 'app' ? apps.length : features.length}</small>}
              </button>
            ))}
          </nav>
          <div className={styles.sidebarNote}>
            <strong>Swift Web Studio</strong>
            <p>Local projects.<br />Live preview. Xcode export.</p>
          </div>
        </aside>

        <div className={styles.main}>
          <header className={styles.header}>
            <div>
              <h2>{source === 'open' ? 'Your projects' : source === 'app' ? 'App templates' : source === 'prompt' ? 'Agentic Coding' : 'Feature examples'}</h2>
              <p className={styles.subtitle}>
                {source === 'open' ? 'Continue working or import a Swift project.' : source === 'app' ? 'A starting point with connected screens and working interactions.' : source === 'prompt' ? 'Describe your app. Review its first version. Make it yours.' : 'Focused examples you can run, read, and adapt.'}
              </p>
            </div>
            <button type="button" className={styles.close} onClick={onClose} disabled={creating} aria-label="Close welcome screen" data-testid="gallery-dismiss">
              <Icon name="xmark" size={17} />
            </button>
          </header>
          {imported && onImport ? <ImportReview {...imported} incoming={imported.project} onCancel={() => setImported(null)} onApply={onImport} /> : source === 'prompt' ? <PromptCreator onOpenFiles={onOpenFiles} onBusy={setGenerationBusy} /> : source === 'open' ? (
            <OpenPane
              projectId={projectId}
              recents={recents}
              origin={origin}
              savedAt={savedAt}
              error={openError}
              onOpen={(id) => {
                void onOpenProject(id).then((opened) => {
                  if (opened) onClose()
                  else setOpenError('This project is no longer available. It may have been removed in another tab.')
                })
              }}
              onRemove={(id) => {
                const summary = recents.find((r) => r.id === id)
                if (summary) setDeleting(summary)
              }}
              onBrowse={() => fileInput.current?.click()}
            />
          ) : (
            <>
              <div className={styles.catalogBar}>
                <span>{shown.length} {source === 'app' ? 'app templates' : 'feature examples'}</span>
                <label className={styles.search}>
                  <Icon name="search" size={15} />
                  <input aria-label="Search templates" placeholder={source === 'app' ? 'Find an app…' : 'Find a feature…'} value={query} onChange={(event) => setQuery(event.target.value)} />
                  {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="xmark" size={13} /></button>}
                </label>
              </div>
              <div className={styles.catalog}>
                <div className={source === 'app' ? styles.appGrid : styles.featureGrid}>
                  {shown.map((item) => (
                    <TemplateCard key={item.id} template={item} selected={item.id === template?.id}
                      disabled={creating} onSelect={() => setSelected(item.id)} onConfirm={() => choose(item)} />
                  ))}
                </div>
                {shown.length === 0 && <div className={styles.empty} role="status"><Icon name="search" size={28} /><strong>No templates found</strong><p>Try “navigation”, “settings”, or “list”.</p><button type="button" onClick={() => setQuery('')}>Show all templates</button></div>}
              </div>
              <TemplateDetail template={template} />
            </>
          )}
          {source !== 'prompt' && <footer className={styles.footer}>
            <span className={styles.footerNote} role={createError ? 'alert' : undefined}>
              {createError ?? (source === 'open' ? 'Projects are saved in this browser.' : 'Creates a new project, ready to edit and preview.')}
            </span>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={onClose} disabled={creating} data-testid="gallery-cancel">{atLaunch ? 'Not now' : 'Cancel'}</button>
              <button type="button" className={styles.primary} disabled={creating || (source !== 'open' && !template)} data-testid="template-confirm"
                onClick={source === 'open' ? onClose : () => { if (template) choose(template) }}>
                {creating ? 'Creating…' : source === 'open' ? 'Continue editing' : source === 'app' ? 'Create app' : 'Open example'}
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          </footer>}
        </div>
      </div>

      {/*
        Outside the panel so it is not clipped by the sheet's own overflow, and so a
        click anywhere but the two buttons does nothing - which is the whole point of
        asking before something irreversible.
      */}
      {deleting ? (
        <Confirm
          icon="error"
          title={`Delete “${deleting.name}”?`}
          body={`Its ${deleting.fileCount} ${deleting.fileCount === 1 ? 'file' : 'files'} are only in this browser. Deleting cannot be undone, and there is no copy anywhere else.`}
          note="Export it or copy a share link first if you want to keep it."
          cancel="Keep it"
          confirm="Delete"
          testId="delete-confirm"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onRemoveProject(deleting.id)
            setDeleting(null)
          }}
        />
      ) : null}

      {pending ? (
        <ReplaceConfirm
          projectName={projectName}
          fileCount={fileCount}
          what={pending.what}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const run = pending.run
            setPending(null)
            run()
          }}
        />
      ) : null}

      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".swift,.zip"
        className="hidden"
        data-testid="open-files-input"
        onChange={(event) => {
          void handleFiles(event.target.files).catch(() => setOpenError('Those files could not be read. Please select them again.'))
          // Cleared so picking the same files twice in a row fires again.
          event.target.value = ''
        }}
      />
    </div>
  )
}

/**
 * The Open pane.
 *
 * Two things live here because there are exactly two places a project can come from
 * that is not a template: this browser, and this computer. The first used to be a
 * single card, because storage held a single project - every template ever created
 * was written to the same key and destroyed whatever was there. It is a list now,
 * which is what the sheet was always shaped for.
 */
function OpenPane({
  projectId,
  recents,
  origin,
  savedAt,
  error,
  onOpen,
  onRemove,
  onBrowse,
}: {
  projectId: string | null
  recents: readonly ProjectSummary[]
  origin: 'restored' | 'shared' | 'fresh' | null
  savedAt: number | null
  error: string | null
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  onBrowse: () => void
}) {
  return (
    <div className={styles.openPane}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-xc-text-3">
        In this browser
      </h3>

      <ul className="mt-2 space-y-1.5" data-testid="gallery-recents">
        {recents.map((summary) => (
          <RecentRow
            key={summary.id}
            summary={summary}
            open={summary.id === projectId}
            savedAt={summary.id === projectId ? savedAt : null}
            onOpen={() => onOpen(summary.id)}
            onRemove={() => onRemove(summary.id)}
          />
        ))}
      </ul>

      <p className="mt-1.5 text-[11px] leading-relaxed text-xc-text-3">
        {origin === 'shared'
          ? 'The project open now arrived in a link. It is yours once you edit it.'
          : recents.length > 1
            ? 'Imported and generated projects are kept. Untouched catalog templates can be recreated from App templates.'
            : 'Nothing here has left this browser.'}
      </p>

      <h3 className="mt-6 text-[10px] font-semibold uppercase tracking-wider text-xc-text-3">
        From your computer
      </h3>

      <div className="mt-2 rounded-[8px] border border-dashed border-white/12 bg-xc-line-soft p-4">
        <p className="text-[11.5px] leading-relaxed text-xc-text-2">
          Open <span className="font-mono text-[11px] text-xc-text">.swift</span> files from
          your project, or an exported{' '}
          <span className="font-mono text-[11px] text-xc-text">.zip</span> archive. Your files stay on this device.
        </p>
        <span className="mt-3 flex items-center gap-2">
          <PushButton onClick={onBrowse} icon="folder" testId="gallery-browse">
            Choose files…
          </PushButton>
          <span className="text-[11px] text-xc-text-3">Nothing is uploaded anywhere.</span>
        </span>
        {error ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-xc-error" role="alert">
            <Icon name="error" size={12} />
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * One project in the list.
 *
 * The delete button is on the row rather than behind a context menu because this is
 * the only place a project can be got rid of, and a list that only grows is one
 * people stop reading. It refuses the open project - there would be nothing to show
 * afterwards - and says so rather than going quiet.
 */
function RecentRow({
  summary,
  open,
  savedAt,
  onOpen,
  onRemove,
}: {
  summary: ProjectSummary
  open: boolean
  savedAt: number | null
  onOpen: () => void
  onRemove: () => void
}) {
  return (
    <li className="group/row flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        data-testid={open ? 'gallery-continue' : `gallery-open-${summary.id}`}
        aria-current={open ? 'true' : undefined}
        className={`flex min-w-0 flex-1 items-center gap-3 rounded-[8px] border p-3 text-left transition-colors ${
          open
            ? 'border-xc-accent/60 bg-xc-accent/10'
            : 'border-xc-line bg-xc-line-soft hover:border-xc-accent/60 hover:bg-xc-line-soft'
        }`}
      >
        <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[7px] bg-xc-line-soft text-[13px] font-medium text-xc-text">
          {summary.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] text-xc-text">{summary.name}</span>
          <span className="block truncate text-[11px] text-xc-text-3">
            {summary.fileCount} {summary.fileCount === 1 ? 'file' : 'files'}
            {' · '}
            {open
              ? savedAt
                ? `open, saved ${relative(savedAt)}`
                : 'open now'
              : `edited ${relative(summary.updatedAt)}`}
          </span>
        </span>
        <Icon name="chevron-right" size={12} className="ml-auto shrink-0 text-xc-text-3" />
      </button>

      <button
        type="button"
        onClick={onRemove}
        disabled={open}
        aria-label={`Delete ${summary.name}`}
        title={open ? 'Open another project first' : `Delete ${summary.name} from this browser`}
        data-testid={`gallery-remove-${summary.id}`}
        className="grid h-[30px] w-[26px] shrink-0 place-items-center rounded-[6px] text-xc-text-3 opacity-0 transition-opacity hover:bg-xc-line-soft hover:text-xc-error focus-visible:opacity-100 disabled:pointer-events-none group-hover/row:opacity-100"
      >
        <Icon name="xmark" size={12} />
      </button>
    </li>
  )
}

const TEMPLATE_ART: Readonly<Record<string, readonly [string, string]>> = {
  dispatch: ['albums-outline', '#b1aac8'], market: ['bag-handle-outline', '#93bcb6'],
  folio: ['library', '#ab9af5'], trailhead: ['leaf', '#79d6af'], ledger: ['bar-chart', '#7ab8ff'],
  kitchen: ['flame-outline', '#f4bb80'], pulse: ['pulse', '#ee95ad'], counter: ['add-circle-outline', '#7ab8ff'],
  stacks: ['grid', '#ab9af5'], tasks: ['checkbox-outline', '#79d6af'], card: ['person-circle-outline', '#f4bb80'],
  palette: ['color-wand-outline', '#ee95ad'], navigation: ['navigate-outline', '#7ab8ff'], settings: ['settings-outline', '#ab9af5'],
  gallery: ['image-outline', '#79d6af'], tabs: ['menu', '#7ab8ff'], motion: ['sparkles-outline', '#f4bb80'],
  inbox: ['mail-outline', '#7ab8ff'], store: ['cart-outline', '#79d6af'], flow: ['flag-outline', '#ab9af5'],
  drawing: ['pencil', '#ee95ad'], drag: ['swap-vertical', '#f4bb80'], styled: ['color-wand', '#ab9af5'],
  typesetting: ['document-text-outline', '#7ab8ff'], loader: ['cloud-outline', '#79d6af'],
}

function GallerySymbol({ name }: { name: string }) {
  return <svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" focusable="false"><use href={`/ionicons-8.0.13.svg#${name}`} /></svg>
}

function TemplateDetail({ template }: { template: TemplateInfo | undefined }) {
  if (!template) return null
  return (
    <div className={styles.detail} data-testid="template-detail">
      <div className={styles.detailHeading}><strong>{template.name}</strong><span>{template.files.length} {template.files.length === 1 ? 'Swift file' : 'Swift files'}</span></div>
      <p>{template.description}</p>
      {template.highlights && <div className={styles.screenList} aria-label="Included screens">{template.highlights.map((screen) => <span key={screen}>{screen}</span>)}</div>}
    </div>
  )
}

function TemplateCard({ template, selected, disabled, onSelect, onConfirm }: {
  template: TemplateInfo
  selected: boolean
  disabled: boolean
  onSelect: () => void
  onConfirm: () => void
}) {
  const [symbol, color] = TEMPLATE_ART[template.id] ?? ['code-slash', '#7ab8ff']
  return (
    <button type="button" onClick={onSelect} onDoubleClick={onConfirm} aria-pressed={selected} disabled={disabled}
      data-testid={`template-${template.id}`} className={template.kind === 'app' ? styles.appCard : styles.featureCard}>
      <span className={styles.templateIcon} style={{ color, backgroundColor: `${color}18` }}><GallerySymbol name={symbol} /></span>
      <span className={styles.cardCopy}>
        <span className={styles.cardTitle}>{template.name}</span>
        <span className={styles.cardTagline}>{template.tagline}</span>
        {template.kind === 'app' && <span className={styles.cardMeta}>{template.highlights?.length ?? 3} screens · {template.files.length} files</span>}
      </span>
      <span className={styles.selectedMark}>{selected && <Icon name="check" size={12} />}</span>
    </button>
  )
}

/**
 * The two dialogs in here that are allowed to interrupt.
 *
 * Both name the thing and the count rather than saying "unsaved changes", because
 * the number is what makes somebody stop and read: "Ledger, 8 files" is checkable and
 * "your changes" is not.
 */
function ReplaceConfirm({
  projectName,
  fileCount,
  what,
  onCancel,
  onConfirm,
}: {
  projectName: string
  fileCount: number
  what: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Confirm
      icon="warning"
      title={`Open ${what}?`}
      body={`You are leaving “${projectName}” and its ${fileCount} ${fileCount === 1 ? 'file' : 'files'}. Your edited project will stay in Your projects.`}
      note="Export a copy whenever you want a backup outside this browser."
      cancel="Keep editing"
      confirm="Open project"
      testId="replace-confirm"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

function Confirm({
  icon,
  title,
  body,
  note,
  cancel,
  confirm,
  testId,
  onCancel,
  onConfirm,
}: {
  icon: IconName
  title: string
  body: string
  note: string
  cancel: string
  confirm: string
  testId: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[960] grid place-items-center bg-black/40"
      onPointerDown={onCancel}
      data-testid={testId}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
        className="w-[min(380px,90vw)] rounded-[10px] border border-xc-line bg-xc-bar p-5 text-center shadow-[0_28px_80px_rgb(0_0_0/0.65)]"
      >
        <span
          className={`mx-auto grid h-[34px] w-[34px] place-items-center rounded-full ${
            icon === 'error' ? 'bg-xc-error/15 text-xc-error' : 'bg-xc-warn/15 text-xc-warn'
          }`}
        >
          <Icon name={icon} size={17} />
        </span>
        <h3 className="mt-3 text-[13px] font-semibold text-xc-text">{title}</h3>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-xc-text-2">{body}</p>
        <p className="mt-2 text-[11px] text-xc-text-3">{note}</p>
        <span className="mt-4 flex items-center justify-center gap-2">
          <PushButton onClick={onCancel} testId={`${testId}-cancel`}>
            {cancel}
          </PushButton>
          <PushButton onClick={onConfirm} active testId={`${testId}-button`}>
            {confirm}
          </PushButton>
        </span>
      </div>
    </div>
  )
}

/** "3 minutes ago", and coarser the further back it goes. */
function relative(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 45) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
