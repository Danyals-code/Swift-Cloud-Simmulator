'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExportFormat } from '@studio/shared'
import { buildFileTree, encodeProject, isPristine, shareLink } from '@studio/project-model'
import { findFile } from '@studio/project-model'
import { getDevice, type DeviceKey } from '@studio/sim-shell'
import type { FileId, RenderNode, SourceSpan, UIEvent } from '@studio/shared'
import { useStudio, type PreviewSettings } from '../lib/store'
import { useLayout, PANE_LIMITS, type PaneKey } from '../lib/layout'
import { useCompiler } from '../lib/useCompiler'
import { ConsolePane } from './ConsolePane'
import { DevicePane } from './DevicePane'
import { EditorPane } from './EditorPane'
import { FileSwitcher } from './FileSwitcher'
import { JumpBar } from './JumpBar'
import { Navigator } from './Navigator'
import { TabBar } from './TabBar'
import { TemplateGallery } from './TemplateGallery'
import { Toolbar } from './Toolbar'
import { Splitter } from './ui/Splitter'
import { Icon } from './ui/Icon'

const NO_FILES: never[] = []

/** The narrowest the editor is allowed to get before the side panes start yielding. */
const EDITOR_MIN = 300

export function Studio() {
  const project = useStudio((s) => s.project)
  const activeFileId = useStudio((s) => s.activeFileId)
  const openFileIds = useStudio((s) => s.openFileIds)
  const loaded = useStudio((s) => s.loaded)
  const origin = useStudio((s) => s.origin)
  const lastSavedAt = useStudio((s) => s.lastSavedAt)
  const saveError = useStudio((s) => s.saveError)
  const previewSettings = useStudio((s) => s.preview)

  const load = useStudio((s) => s.load)
  const flush = useStudio((s) => s.flush)
  const setFileText = useStudio((s) => s.setFileText)
  const setActiveFile = useStudio((s) => s.setActiveFile)
  const closeFile = useStudio((s) => s.closeFile)
  const createFile = useStudio((s) => s.createFile)
  const renameFile = useStudio((s) => s.renameFile)
  const deleteFile = useStudio((s) => s.deleteFile)
  const duplicateFile = useStudio((s) => s.duplicateFile)
  const createFolder = useStudio((s) => s.createFolder)
  const renameFolder = useStudio((s) => s.renameFolder)
  const deleteFolder = useStudio((s) => s.deleteFolder)
  const moveFile = useStudio((s) => s.moveFile)
  const setDevice = useStudio((s) => s.setDevice)
  const setPreview = useStudio((s) => s.setPreview)
  const renameSymbol = useStudio((s) => s.renameSymbol)
  const applyTemplate = useStudio((s) => s.applyTemplate)
  const openFiles = useStudio((s) => s.openFiles)
  const openProject = useStudio((s) => s.openProject)
  const removeProject = useStudio((s) => s.removeProject)
  const recents = useStudio((s) => s.recents)

  const shown = useLayout((s) => s.shown)
  const navigatorWidth = useLayout((s) => s.navigatorWidth)
  const previewWidth = useLayout((s) => s.previewWidth)
  const debugHeight = useLayout((s) => s.debugHeight)
  const setSize = useLayout((s) => s.setSize)
  const setPane = useLayout((s) => s.setPane)

  const [inspecting, setInspecting] = useState(false)
  const [paused, setPaused] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  /**
   * Whether the sheet on screen opened by itself.
   *
   * Only the launch one refuses to close on a click outside: at launch nothing behind
   * it has been chosen yet, so a stray click dismissing it would leave somebody
   * looking at a project they did not pick.
   */
  const [galleryAtLaunch, setGalleryAtLaunch] = useState(false)
  const greeted = useRef(false)
  const [caret, setCaret] = useState(0)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY)
  const [reveal, setReveal] = useState<{ offset: number; nonce: number } | null>(null)
  const revealNonce = useRef(0)

  useEffect(() => {
    void load()
  }, [load])

  /**
   * The sheet at launch.
   *
   * Once, after the first load resolves, and never for a project that arrived in a
   * link - following one is already an explicit request to see *that* project, and
   * asking "what would you like to open?" over the top of it is a question that has
   * been answered.
   */
  useEffect(() => {
    if (!loaded || greeted.current || origin === 'shared') return
    greeted.current = true
    setGalleryAtLaunch(true)
    setGalleryOpen(true)
  }, [loaded, origin])

  const openGallery = useCallback(() => {
    setGalleryAtLaunch(false)
    setGalleryOpen(true)
  }, [])

  // Debounced autosave can lose the last edit when a tab is closed or backgrounded,
  // so force the pending write at both of the points the browser gives us.
  useEffect(() => {
    const onHide = () => void flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [flush])

  const device = getDevice(project?.manifest.device ?? 'iphone-15')
  const files = project?.files ?? NO_FILES

  const { result, stale, workerError, dispatch, reset, language } = useCompiler({
    projectId: project?.id,
    files,
    device,
    colorScheme: previewSettings.colorScheme,
    typeScale: previewSettings.typeScale,
    dynamicTypeSize: previewSettings.dynamicTypeSize,
    previewTarget: project?.manifest.previewTarget,
    paused,
  })

  const activeFile = useMemo(
    () => (project && activeFileId ? findFile(project, activeFileId) : undefined),
    [project, activeFileId],
  )

  const diagnostics = useMemo(
    () => (result?.diagnostics ?? []).filter((d) => d.span.file === activeFileId),
    [result, activeFileId],
  )

  const allDiagnostics = result?.diagnostics ?? NO_FILES

  /** Files carrying an error, so the navigator and tabs can mark them unopened. */
  const filesWithErrors = useMemo(() => {
    const out = new Set<FileId>()
    for (const d of result?.diagnostics ?? []) {
      if (d.severity === 'error') out.add(d.span.file)
    }
    return out
  }, [result])

  const fileTree = useMemo(() => (project ? buildFileTree(project) : NO_FILES), [project])

  // The split row's width, so the side panes can give way rather than pushing the
  // editor to nothing. Measured rather than read from `window`, because the app is
  // embedded in a pane as often as it fills a window.
  useEffect(() => {
    const el = splitRef.current
    if (!el) return
    const measure = () => setAvailable(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [loaded])

  /**
   * What the side panes actually get.
   *
   * Their stored widths and even their visibility are a preference, not a promise.
   * Below about 780px there is no arrangement in which a navigator, an editor and a
   * phone all have a usable width, so one of them has to go - and a preview squeezed
   * to 300px beside a 104px editor serves nobody. The preview yields first: a
   * narrower phone is still a phone, while an editor that fits eight characters is
   * not an editor.
   *
   * The preference is kept rather than written back, so widening the window brings
   * the pane back exactly as it was.
   */
  const layout = useMemo(() => {
    const navMin = PANE_LIMITS.navigator.min
    const previewMin = PANE_LIMITS.preview.min

    // Only the *combination* is refused. A single side pane the user asked for is
    // always shown, even if the editor then has to go under its comfortable
    // minimum: hiding the one thing somebody just switched on is worse than a
    // narrow editor, and they can close it again in one keystroke.
    const showNavigator = shown.navigator
    const showPreview =
      shown.preview &&
      !(
        showNavigator &&
        Number.isFinite(available) &&
        available < navMin + previewMin + EDITOR_MIN
      )

    const nav = showNavigator ? navigatorWidth : 0
    const prev = showPreview ? previewWidth : 0
    const overflow = nav + prev + EDITOR_MIN - available

    if (!Number.isFinite(overflow) || overflow <= 0) {
      return { nav, preview: prev, showNavigator, showPreview }
    }

    const fromPreview = Math.min(overflow, Math.max(0, prev - previewMin))
    const rest = overflow - fromPreview
    return {
      nav: Math.max(navMin, nav - Math.max(0, rest)),
      preview: prev - fromPreview,
      showNavigator,
      showPreview,
    }
  }, [available, navigatorWidth, previewWidth, shown.navigator, shown.preview])

  /**
   * Toggling a pane.
   *
   * Flips the stored preference and nothing else. An earlier version also turned
   * the *other* pane off to make room, which looked helpful and quietly wrote a
   * preference the user never expressed - so widening the window afterwards did not
   * bring the pane back, because as far as the store was concerned it had been
   * switched off on purpose. Space is a display concern and is settled in `layout`
   * above, where it can be reversed by resizing the window.
   */
  const togglePane = useCallback(
    (pane: PaneKey) => setPane(pane, !shown[pane]),
    [setPane, shown],
  )

  const revealSpanIn = useCallback(
    (file: FileId, offset: number) => {
      if (file !== activeFileId) setActiveFile(file)
      setReveal({ offset, nonce: ++revealNonce.current })
    },
    [activeFileId, setActiveFile],
  )

  /** Inspector click: jump the editor to the Swift that produced this view (FR-5.8). */
  const revealSource = useCallback(
    (node: RenderNode) => {
      if (!node.origin) return
      revealSpanIn(node.origin.file, node.origin.start)
    },
    [revealSpanIn],
  )

  /**
   * Run: drop the preview's state and evaluate from scratch.
   *
   * Also resumes, because pressing Run while paused can only mean one thing - and
   * a Run that left the preview frozen would look broken.
   */
  const run = useCallback(() => {
    setPaused(false)
    void reset()
  }, [reset])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (galleryOpen || switcherOpen) return
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()

      // Xcode's own bindings, which is the point: muscle memory is most of what
      // "feels like Xcode" means once the pixels are right.
      if (key === '0') {
        e.preventDefault()
        togglePane('navigator')
      } else if (key === 'y' && e.shiftKey) {
        e.preventDefault()
        togglePane('debug')
      } else if (key === 'enter' && e.altKey) {
        e.preventDefault()
        togglePane('preview')
      } else if (key === 'b') {
        e.preventDefault()
        togglePane('preview')
      } else if ((key === 'o' && e.shiftKey) || key === 'p') {
        e.preventDefault()
        setSwitcherOpen(true)
      } else if (key === 'i') {
        e.preventDefault()
        setInspecting((v) => !v)
      } else if (key === 'r') {
        e.preventDefault()
        run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePane, run, galleryOpen, switcherOpen])

  const handleChange = useCallback(
    (text: string) => {
      if (activeFileId) setFileText(activeFileId, text)
    },
    [activeFileId, setFileText],
  )

  const handleEvent = useCallback((event: UIEvent) => void dispatch(event), [dispatch])

  /** The rename in progress, if F2 found something to rename. */
  const [rename, setRename] = useState<{ name: string; spans: readonly SourceSpan[] } | null>(null)

  /**
   * Copies a link that carries the whole project.
   *
   * Three outcomes, and the caller shows all three: the clipboard can be refused (it
   * needs a user gesture and a secure context) and the project can be too big for a
   * URL. Reporting only success would leave a user pasting nothing and wondering.
   */
  const handleShare = useCallback(async (): Promise<'copied' | 'too-large' | 'failed'> => {
    if (!project) return 'failed'
    void flush()

    const encoded = encodeProject(project)
    if (!encoded) return 'too-large'

    try {
      await navigator.clipboard.writeText(
        shareLink(window.location.origin, window.location.pathname, encoded),
      )
      return 'copied'
    } catch {
      return 'failed'
    }
  }, [project, flush])

  /**
   * Loaded on click, not on first paint.
   *
   * The project generator - pbxproj, plists, asset catalogues, four manifests - is
   * about thirty kilobytes that runs once per session at most, and it was in the
   * initial bundle for the sake of one function reference. The menu itself is plain
   * data and stays static, so the button still knows its options before the code
   * behind them exists.
   */
  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (!project) return
      void flush()
      void import('@studio/exporter').then(({ downloadProjectZip }) => {
        downloadProjectZip(project, format)
      })
    },
    [project, flush],
  )

  if (!loaded || !project) {
    return (
      <main className="grid h-dvh place-items-center bg-xc-editor text-[12px] text-xc-text-3">
        Loading project…
      </main>
    )
  }

  const errors = allDiagnostics.filter((d) => d.severity === 'error').length
  const warnings = allDiagnostics.filter((d) => d.severity === 'warning').length

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-xc-editor text-xc-text">
      <div className="flex min-h-0 flex-1 flex-col" inert={galleryOpen || switcherOpen || rename !== null}>
      <Toolbar
        onOpenGallery={openGallery}
        projectName={project.manifest.name}
        device={project.manifest.device}
        savedAt={lastSavedAt}
        saveError={saveError}
        busy={stale}
        paused={paused}
        errors={errors}
        warnings={warnings}
        lastCompileMs={result?.timings.total ?? null}
        workerError={workerError}
        inspecting={inspecting}
        // The toggles report the preference, so each is a switch that always
        // responds; `suppressed` is how a pane that is on but has no room says so.
        panes={new Set((Object.keys(shown) as PaneKey[]).filter((key) => shown[key]))}
        suppressed={
          new Set<PaneKey>(shown.preview && !layout.showPreview ? (['preview'] as const) : [])
        }
        onTogglePane={togglePane}
        onDeviceChange={(d: DeviceKey) => setDevice(d)}
        onRun={run}
        onTogglePaused={() => setPaused((v) => !v)}
        onToggleInspect={() => setInspecting((v) => !v)}
        onExport={handleExport}
        onShare={handleShare}
      />

      <div ref={splitRef} className="flex min-h-0 flex-1">
        {layout.showNavigator ? (
          <>
            <div style={{ width: layout.nav }} className="shrink-0 overflow-hidden">
              <Navigator
                tree={fileTree}
                activeFileId={activeFileId}
                filesWithErrors={filesWithErrors}
                diagnostics={allDiagnostics}
                canDelete={files.length > 1}
                onSelect={setActiveFile}
                onCreateFile={createFile}
                onCreateFolder={createFolder}
                onRenameFile={renameFile}
                onRenameFolder={renameFolder}
                onDeleteFile={deleteFile}
                onDeleteFolder={deleteFolder}
                onDuplicateFile={duplicateFile}
                onMoveFile={moveFile}
                onRevealDiagnostic={revealSpanIn}
                onOpenTemplates={openGallery}
              />
            </div>
            <Splitter
              orientation="col"
              size={layout.nav}
              onResize={(size) => setSize('navigator', size)}
              min={PANE_LIMITS.navigator.min}
              max={PANE_LIMITS.navigator.max}
              direction={1}
              label="Navigator width"
              onToggle={() => togglePane('navigator')}
            />
          </>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <TabBar
            openFileIds={openFileIds}
            activeFileId={activeFileId}
            filesWithErrors={filesWithErrors}
            onSelect={setActiveFile}
            onClose={closeFile}
          />

          {activeFile ? (
            <JumpBar
              fileId={activeFile.id}
              text={activeFile.text}
              caret={caret}
              onJump={(offset) => revealSpanIn(activeFile.id, offset)}
            />
          ) : null}

          {rename ? (
            <RenameBar
              rename={rename}
              onCancel={() => setRename(null)}
              onConfirm={(newName) => {
                renameSymbol(rename.spans, newName)
                setRename(null)
              }}
            />
          ) : null}

          <div className="min-h-0 flex-1">
            {activeFile ? (
              <EditorPane
                // Remounting per file gives each its own undo history, which is what
                // switching tabs in any editor implies.
                key={activeFile.id}
                text={activeFile.text}
                diagnostics={diagnostics}
                onChange={handleChange}
                onSave={() => void flush()}
                reveal={reveal}
                fileId={activeFile.id}
                language={language}
                onOpenFile={revealSpanIn}
                onRename={(name, spans) => setRename({ name, spans })}
                onCaret={setCaret}
              />
            ) : (
              <p className="p-4 text-[12px] text-xc-text-3">No file selected.</p>
            )}
          </div>

          {shown.debug ? (
            <>
              <Splitter
                orientation="row"
                size={debugHeight}
                onResize={(size) => setSize('debug', size)}
                min={PANE_LIMITS.debug.min}
                max={PANE_LIMITS.debug.max}
                direction={-1}
                label="Debug area height"
                onToggle={() => togglePane('debug')}
              />
              <div style={{ height: debugHeight, maxHeight: '65%' }} className="shrink-0">
                <ConsolePane
                  result={result}
                  workerError={workerError}
                  onRevealSpan={revealSpanIn}
                />
              </div>
            </>
          ) : null}
        </div>

        {layout.showPreview ? (
          <>
            <Splitter
              orientation="col"
              size={layout.preview}
              onResize={(size) => setSize('preview', size)}
              min={PANE_LIMITS.preview.min}
              max={PANE_LIMITS.preview.max}
              direction={-1}
              label="Preview width"
              onToggle={() => togglePane('preview')}
            />
            <div style={{ width: layout.preview }} className="shrink-0 overflow-hidden">
              <DevicePane
                device={device}
                tree={result?.renderTree ?? null}
                stale={stale}
                paused={paused}
                onEvent={handleEvent}
                inspecting={inspecting}
                onRevealSource={revealSource}
                preview={previewSettings}
                onPreviewChange={(settings: Partial<PreviewSettings>) => setPreview(settings)}
              />
            </div>
          </>
        ) : null}
      </div>

      </div>
      {switcherOpen ? (
        <FileSwitcher
          files={files}
          onSelect={(fileId) => {
            setSwitcherOpen(false)
            setActiveFile(fileId)
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      ) : null}

      {galleryOpen ? (
        <TemplateGallery
          projectId={project.id}
          projectName={project.manifest.name}
          fileCount={files.length}
          recents={recents}
          pristine={isPristine(project)}
          origin={origin}
          savedAt={lastSavedAt}
          atLaunch={galleryAtLaunch}
          onClose={() => setGalleryOpen(false)}
          onChoose={async (templateId) => {
            const made = await applyTemplate(templateId)
            // Kept open on failure: the sheet is where the message goes, and closing
            // it would leave somebody looking at a project they did not ask for.
            if (made) setGalleryOpen(false)
            return made
          }}
          onOpenProject={openProject}
          onRemoveProject={(id) => void removeProject(id)}
          onOpenFiles={async (picked) => {
            const opened = await openFiles(picked)
            if (opened) setGalleryOpen(false)
            return opened
          }}
        />
      ) : null}
    </main>
  )
}

/**
 * The rename prompt.
 *
 * It states the count and the file spread before anything changes, because that is the
 * one thing the analyser cannot decide for the user: matching is by name, so two
 * unrelated symbols spelled the same are indistinguishable to it. "12 occurrences in
 * 3 files" is how that ambiguity gets handed over - a number that looks wrong is a
 * reason to press Escape.
 */
function RenameBar({
  rename,
  onConfirm,
  onCancel,
}: {
  rename: { name: string; spans: readonly SourceSpan[] }
  onConfirm: (newName: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(rename.name)
  const files = new Set(rename.spans.map((s) => s.file)).size

  return (
    <form
      className="flex h-[30px] shrink-0 items-center gap-2.5 border-b border-xc-line bg-xc-bar px-2.5 text-[11.5px]"
      data-testid="rename-bar"
      onSubmit={(e) => {
        e.preventDefault()
        if (value && value !== rename.name) onConfirm(value)
        else onCancel()
      }}
    >
      <Icon name="new-file" size={13} className="text-xc-text-3" />
      <span className="text-xc-text-2">
        Rename <span className="font-mono text-xc-text">{rename.name}</span>
      </span>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        spellCheck={false}
        aria-label="New name"
        data-testid="rename-input"
        className="h-[20px] w-48 rounded-[5px] border border-xc-accent bg-black/40 px-2 font-mono text-xc-text outline-none"
      />
      <span className="text-xc-text-3" data-testid="rename-count">
        {rename.spans.length} {rename.spans.length === 1 ? 'occurrence' : 'occurrences'} in{' '}
        {files} {files === 1 ? 'file' : 'files'}
      </span>
      <span className="ml-auto text-xc-text-3">Enter to rename · Esc to cancel</span>
    </form>
  )
}
