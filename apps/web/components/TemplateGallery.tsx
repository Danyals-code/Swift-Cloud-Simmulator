'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  TEMPLATE_CATALOG,
  type OpenedFile,
  type ProjectSummary,
  type TemplateInfo,
  type TemplateKind,
} from '@studio/project-model'
import { Icon, type IconName } from './ui/Icon'
import { PushButton } from './ui/Control'

/**
 * The sheet the studio opens with, and the one the app icon reopens.
 *
 * It answers one question - *where does this project come from* - and there are only
 * three honest answers, so they are the three things down the left: what is already
 * in this browser, a whole app to start from, or one feature to read. Xcode splits
 * the same question across a welcome window and a template sheet; merging them means
 * "continue what I was doing" is not two clicks further away than "throw it away".
 *
 * The split between App and Feature is the point of the left rail. A pile of twenty
 * cards sorted by name cannot tell you that Counter is a thing to read in a minute
 * and Trailhead is a project to work in, and picking the wrong one wastes the first
 * five minutes somebody spends here.
 */

export type GallerySource = 'open' | TemplateKind

export interface TemplateGalleryProps {
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
  onOpenFiles: (files: readonly OpenedFile[]) => boolean
  /** Reopens a project already in this browser. */
  onOpenProject: (id: string) => void
  /** Deletes one. Never the one that is open. */
  onRemoveProject: (id: string) => void
  onClose: () => void
}

const SOURCES: readonly { key: GallerySource; label: string; icon: IconName; hint: string }[] = [
  { key: 'open', label: 'Open', icon: 'folder', hint: 'What is already here, or files from your computer' },
  { key: 'app', label: 'App', icon: 'screens', hint: 'A whole project: several screens, a model, a store' },
  { key: 'feature', label: 'Feature', icon: 'grid', hint: 'One file, one idea, read in a minute' },
]

export function TemplateGallery({
  projectId,
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

  // Opens on whatever the visitor most likely wants: their own work if there is any,
  // otherwise the apps, because a first-time reader learns more from a project than
  // from a counter.
  const [source, setSource] = useState<GallerySource>(origin === 'restored' ? 'open' : 'app')
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

  const shown = source === 'feature' ? features : source === 'app' ? apps : []
  const template = TEMPLATE_CATALOG.find((t) => t.id === selected)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (pending) setPending(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pending])

  /**
   * Every path that replaces the project goes through here.
   *
   * A confirmation on untouched work is a dialog that has taught people to dismiss
   * dialogs, so it is asked only when there is genuinely something to lose - and when
   * it is asked, it names the project and says plainly that there is no undo.
   */
  const replacing = useCallback(
    (what: string, run: () => void) => {
      if (pristine) run()
      else setPending({ what, run })
    },
    [pristine],
  )

  const create = useCallback(() => {
    if (!template) return
    replacing(template.name, () => {
      void onChoose(template.id).then((made) => {
        if (!made) setCreateError(`${template.name} could not be loaded. Check the connection.`)
      })
    })
  }, [template, replacing, onChoose])

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
        const { readProjectArchive } = await import('@studio/exporter')
        const { files, problem } = readProjectArchive(new Uint8Array(await archive.arrayBuffer()))
        if (problem) {
          setOpenError(problem)
          return
        }
        setOpenError(null)
        replacing(`${archive.name}`, () => {
          if (!onOpenFiles(files)) setOpenError('Nothing in that archive could be opened.')
        })
        return
      }

      const swift = await Promise.all(
        picked
          .filter((file) => file.name.endsWith('.swift'))
          .map(async (file) => ({ name: file.name, text: await file.text() })),
      )
      if (swift.length === 0) {
        setOpenError('Pick .swift files, or the .zip an export wrote.')
        return
      }

      setOpenError(null)
      replacing(`${swift.length} file${swift.length === 1 ? '' : 's'}`, () => {
        if (!onOpenFiles(swift)) setOpenError('Those files could not be opened.')
      })
    },
    [onOpenFiles, replacing],
  )

  const primary = source === 'open' ? 'Continue' : 'Create'

  return (
    <div
      className="fixed inset-0 z-[950] flex items-start justify-center bg-black/55 pt-[7vh] backdrop-blur-[2px]"
      onPointerDown={atLaunch ? undefined : onClose}
      data-testid="template-gallery"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Choose what to open"
        onPointerDown={(event) => event.stopPropagation()}
        className="flex h-[min(620px,82vh)] w-[min(880px,94vw)] flex-col overflow-hidden rounded-[10px] border border-black/60 bg-xc-bar shadow-[0_28px_80px_rgb(0_0_0/0.6)]"
      >
        <header className="shrink-0 border-b border-black/40 px-5 py-3.5">
          <h2 className="text-[13px] font-semibold text-xc-text">
            {atLaunch ? 'Welcome to SwiftUI Web Studio' : 'Open a project'}
          </h2>
          <p className="mt-0.5 text-[11px] text-xc-text-3">
            Pick up where you left off, start from a whole app, or read one feature.
          </p>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[172px_1fr]">
          <nav
            aria-label="Source"
            className="flex min-h-0 flex-col gap-0.5 overflow-auto border-r border-black/40 bg-black/15 p-2"
          >
            {SOURCES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setCreateError(null)
                  setSource(item.key)
                  if (item.key === 'app') setSelected(apps[0]?.id ?? '')
                  if (item.key === 'feature') setSelected(features[0]?.id ?? '')
                }}
                aria-pressed={source === item.key}
                title={item.hint}
                data-testid={`gallery-source-${item.key}`}
                className={`flex items-center gap-2 rounded-[6px] px-2.5 py-[7px] text-left text-[12px] transition-colors ${
                  source === item.key
                    ? 'bg-xc-accent/20 text-xc-text'
                    : 'text-xc-text-2 hover:bg-white/[0.06] hover:text-xc-text'
                }`}
              >
                <Icon name={item.icon} size={14} className="shrink-0 text-xc-text-3" />
                <span className="truncate">{item.label}</span>
                {item.key !== 'open' ? (
                  <span className="ml-auto text-[10.5px] text-xc-text-3">
                    {item.key === 'app' ? apps.length : features.length}
                  </span>
                ) : null}
              </button>
            ))}

            <p className="mt-auto px-2.5 pb-1 pt-4 text-[10.5px] leading-relaxed text-xc-text-3">
              Every template renders with nothing missing. That is the gate they have to
              pass to be in here.
            </p>
          </nav>

          <div className="flex min-h-0 min-w-0 flex-col">
            {source === 'open' ? (
              <OpenPane
                projectId={projectId}
                recents={recents}
                origin={origin}
                savedAt={savedAt}
                error={openError}
                onOpen={(id) => {
                  if (id === projectId) {
                    onClose()
                    return
                  }
                  // Switching projects is not a replacement: the one being left is
                  // written down and stays in the list, so there is nothing to lose
                  // and nothing to confirm.
                  onOpenProject(id)
                  onClose()
                }}
                onRemove={(id) => {
                  const summary = recents.find((r) => r.id === id)
                  if (!summary) return
                  setDeleting(summary)
                }}
                onBrowse={() => fileInput.current?.click()}
              />
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-auto p-4">
                  <div
                    className={`grid gap-3 ${
                      source === 'app'
                        ? 'grid-cols-[repeat(auto-fill,minmax(176px,1fr))]'
                        : 'grid-cols-[repeat(auto-fill,minmax(124px,1fr))]'
                    }`}
                  >
                    {shown.map((item) => (
                      <TemplateCard
                        key={item.id}
                        template={item}
                        selected={item.id === selected}
                        onSelect={() => setSelected(item.id)}
                        onConfirm={() => replacing(item.name, () => onChoose(item.id))}
                      />
                    ))}
                  </div>
                </div>

                <TemplateDetail template={template} />
              </>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-black/40 px-5 py-3">
          <span className={`text-[11px] ${createError ? 'text-xc-error' : 'text-xc-text-3'}`}>
            {createError ??
              (source === 'open'
                ? 'Opening files replaces everything currently in the project.'
                : 'Creating from a template replaces everything currently in the project.')}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <PushButton onClick={onClose} testId="gallery-dismiss">
              {atLaunch ? 'Not now' : 'Cancel'}
            </PushButton>
            <PushButton
              onClick={source === 'open' ? onClose : create}
              active
              testId="template-confirm"
            >
              {primary}
            </PushButton>
          </span>
        </footer>
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
          void handleFiles(event.target.files)
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
    <div className="min-h-0 flex-1 overflow-auto p-4">
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
            ? 'Nothing here has left this browser. A project you edited is kept when you start another; one you never touched is not.'
            : 'Nothing here has left this browser.'}
      </p>

      <h3 className="mt-6 text-[10px] font-semibold uppercase tracking-wider text-xc-text-3">
        From your computer
      </h3>

      <div className="mt-2 rounded-[8px] border border-dashed border-white/12 bg-white/[0.02] p-4">
        <p className="text-[11.5px] leading-relaxed text-xc-text-2">
          Pick the <span className="font-mono text-[11px] text-xc-text">.swift</span> files from a
          project you exported and have since edited on a Mac, or the{' '}
          <span className="font-mono text-[11px] text-xc-text">.zip</span> the export itself wrote.
          Folders are rebuilt from the names, and the target is named after whichever file declares{' '}
          <span className="font-mono text-[11px] text-xc-text">@main</span>.
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
            : 'border-white/10 bg-white/[0.04] hover:border-xc-accent/60 hover:bg-white/[0.07]'
        }`}
      >
        <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[7px] bg-gradient-to-b from-[#ff7a45] to-xc-swift text-[13px] font-bold text-white">
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
        className="grid h-[30px] w-[26px] shrink-0 place-items-center rounded-[6px] text-xc-text-3 opacity-0 transition-opacity hover:bg-white/10 hover:text-xc-error focus-visible:opacity-100 disabled:pointer-events-none group-hover/row:opacity-100"
      >
        <Icon name="xmark" size={12} />
      </button>
    </li>
  )
}

/** The strip under the grid: what the selected template is, and what it lays down. */
function TemplateDetail({ template }: { template: TemplateInfo | undefined }) {
  if (!template) return null

  return (
    <div className="shrink-0 border-t border-black/40 bg-black/15 px-4 py-3">
      <span className="flex items-baseline gap-2">
        <h3 className="text-[12px] font-semibold text-xc-text">{template.name}</h3>
        <p className="min-w-0 truncate text-[11px] text-xc-text-2">{template.tagline}</p>
      </span>
      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-xc-text-3">
        {template.description}
      </p>
      <p className="mt-1.5 truncate font-mono text-[10.5px] text-xc-text-3">
        {template.files.length} {template.files.length === 1 ? 'file' : 'files'} ·{' '}
        {template.files.map((path) => path.replace(/^Sources\//, '')).join('  ')}
      </p>
    </div>
  )
}

function TemplateCard({
  template,
  selected,
  onSelect,
  onConfirm,
}: {
  template: TemplateInfo
  selected: boolean
  onSelect: () => void
  onConfirm: () => void
}) {
  const app = template.kind === 'app'

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onConfirm}
      aria-pressed={selected}
      data-testid={`template-${template.id}`}
      className={`flex flex-col items-center gap-2 rounded-[8px] border p-3 text-center transition-colors ${
        selected
          ? 'border-xc-accent bg-xc-accent/15'
          : 'border-transparent hover:border-white/10 hover:bg-white/[0.05]'
      }`}
    >
      {/*
        A stand-in for the screen the template draws rather than a real thumbnail:
        rendering twenty-two previews to make a picker would mean running the whole
        pipeline twenty-two times before anyone has chosen anything. An app template
        is drawn as a stack, which is the one thing the shape can honestly say.
      */}
      <span className="relative grid h-[52px] w-[40px] place-items-center">
        {app ? (
          <span className="absolute left-[7px] top-0 h-[46px] w-[33px] rounded-[5px] border border-white/10 bg-white/[0.04]" />
        ) : null}
        <span
          className={`absolute ${
            app ? 'bottom-0 left-0 h-[46px] w-[33px]' : 'inset-0'
          } grid place-items-center rounded-[6px] border border-white/10 bg-gradient-to-b from-white/[0.12] to-white/[0.03]`}
        >
          <Icon
            name={app ? 'screens' : 'disclosure-closed'}
            size={14}
            className="text-xc-text-3"
          />
        </span>
      </span>

      <span className="w-full truncate text-[11.5px] text-xc-text">{template.name}</span>
      {app ? (
        <span className="line-clamp-2 text-[10px] leading-snug text-xc-text-3">
          {template.tagline}
        </span>
      ) : template.files.length > 1 ? (
        <span className="text-[10px] text-xc-text-3">{template.files.length} files</span>
      ) : null}
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
      title={`Replace “${projectName}” with ${what}?`}
      body={`This project has been edited since it was created. Replacing its ${fileCount} ${fileCount === 1 ? 'file' : 'files'} cannot be undone, and nothing here has a copy anywhere else.`}
      note="Export or copy a share link first if you want to keep it."
      cancel="Keep editing"
      confirm="Replace"
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
        className="w-[min(380px,90vw)] rounded-[10px] border border-black/60 bg-xc-bar p-5 text-center shadow-[0_28px_80px_rgb(0_0_0/0.65)]"
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
