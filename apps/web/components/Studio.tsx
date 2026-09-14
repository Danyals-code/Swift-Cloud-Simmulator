'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExportFormat } from '@studio/shared'
import { encodeProject, shareLink } from '@studio/project-model'
import { findFile } from '@studio/project-model'
import { getDevice, type DeviceKey } from '@studio/sim-shell'
import type { FileId, RenderNode, SourceSpan, UIEvent } from '@studio/shared'
import { useStudio, type PreviewSettings } from '../lib/store'
import { useCompiler } from '../lib/useCompiler'
import { ConsolePane } from './ConsolePane'
import { DevicePane } from './DevicePane'
import { EditorPane } from './EditorPane'
import { FileRail } from './FileRail'
import { FileSwitcher } from './FileSwitcher'
import { TabBar } from './TabBar'
import { Toolbar } from './Toolbar'

const NO_FILES: never[] = []

export function Studio() {
  const project = useStudio((s) => s.project)
  const activeFileId = useStudio((s) => s.activeFileId)
  const openFileIds = useStudio((s) => s.openFileIds)
  const loaded = useStudio((s) => s.loaded)
  const lastSavedAt = useStudio((s) => s.lastSavedAt)
  const previewSettings = useStudio((s) => s.preview)

  const load = useStudio((s) => s.load)
  const flush = useStudio((s) => s.flush)
  const setFileText = useStudio((s) => s.setFileText)
  const setActiveFile = useStudio((s) => s.setActiveFile)
  const closeFile = useStudio((s) => s.closeFile)
  const createFile = useStudio((s) => s.createFile)
  const renameActiveFile = useStudio((s) => s.renameActiveFile)
  const deleteFile = useStudio((s) => s.deleteFile)
  const setDevice = useStudio((s) => s.setDevice)
  const setPreview = useStudio((s) => s.setPreview)
  const renameSymbol = useStudio((s) => s.renameSymbol)
  const applyTemplate = useStudio((s) => s.applyTemplate)

  const [showPreview, setShowPreview] = useState(true)
  const [inspecting, setInspecting] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [reveal, setReveal] = useState<{ offset: number; nonce: number } | null>(null)
  const revealNonce = useRef(0)

  useEffect(() => {
    void load()
  }, [load])

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

  const { result, stale, workerError, dispatch, reset, language } = useCompiler(
    files,
    device,
    previewSettings.colorScheme,
    previewSettings.typeScale,
  )

  const activeFile = useMemo(
    () => (project && activeFileId ? findFile(project, activeFileId) : undefined),
    [project, activeFileId],
  )

  const diagnostics = useMemo(
    () => (result?.diagnostics ?? []).filter((d) => d.span.file === activeFileId),
    [result, activeFileId],
  )

  /** Files carrying an error, so the rail and tabs can mark them without opening each. */
  const filesWithErrors = useMemo(() => {
    const out = new Set<FileId>()
    for (const d of result?.diagnostics ?? []) {
      if (d.severity === 'error') out.add(d.span.file)
    }
    return out
  }, [result])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()

      if (key === 'b') {
        e.preventDefault()
        setShowPreview((v) => !v)
      } else if (key === 'p') {
        e.preventDefault()
        setSwitcherOpen(true)
      } else if (key === 'i') {
        e.preventDefault()
        setInspecting((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
   * The project generator — pbxproj, plists, asset catalogues, four manifests — is
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
      <main className="grid h-dvh place-items-center bg-[#0d0d10] text-sm text-zinc-500">
        Loading project…
      </main>
    )
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#0d0d10] text-zinc-200">
      <Toolbar
        projectName={project.manifest.name}
        device={project.manifest.device}
        preview={previewSettings}
        savedAt={lastSavedAt}
        busy={stale}
        inspecting={inspecting}
        onDeviceChange={(d: DeviceKey) => setDevice(d)}
        onPreviewChange={(settings: Partial<PreviewSettings>) => setPreview(settings)}
        onToggleInspect={() => setInspecting((v) => !v)}
        onExport={handleExport}
        onShare={handleShare}
        onResetState={() => void reset()}
      />

      <div className="flex min-h-0 flex-1">
        <FileRail
          files={files}
          activeFileId={activeFileId}
          filesWithErrors={filesWithErrors}
          onSelect={setActiveFile}
          onCreate={createFile}
          onRename={(fileId, name) => {
            setActiveFile(fileId)
            renameActiveFile(name)
          }}
          onDelete={deleteFile}
          onApplyTemplate={applyTemplate}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <TabBar
            openFileIds={openFileIds}
            activeFileId={activeFileId}
            filesWithErrors={filesWithErrors}
            onSelect={setActiveFile}
            onClose={closeFile}
          />

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
              />
            ) : (
              <p className="p-4 text-sm text-zinc-600">No file selected.</p>
            )}
          </div>

          <div className="h-48 shrink-0 border-t border-white/5">
            <ConsolePane
              result={result}
              workerError={workerError}
              onRevealSpan={(offset) => {
                if (activeFileId) revealSpanIn(activeFileId, offset)
              }}
            />
          </div>
        </div>

        {showPreview ? (
          <div className="w-[clamp(360px,34vw,560px)] shrink-0 border-l border-white/5">
            <DevicePane
              device={device}
              tree={result?.renderTree ?? null}
              stale={stale}
              onEvent={handleEvent}
              inspecting={inspecting}
              onRevealSource={revealSource}
              colorScheme={previewSettings.colorScheme}
            />
          </div>
        ) : null}
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
    </main>
  )
}

/**
 * The rename prompt.
 *
 * It states the count and the file spread before anything changes, because that is the
 * one thing the analyser cannot decide for the user: matching is by name, so two
 * unrelated symbols spelled the same are indistinguishable to it. "12 occurrences in
 * 3 files" is how that ambiguity gets handed over — a number that looks wrong is a
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
      className="flex items-center gap-3 border-b border-white/5 bg-[#141418] px-3 py-2 text-xs"
      data-testid="rename-bar"
      onSubmit={(e) => {
        e.preventDefault()
        if (value && value !== rename.name) onConfirm(value)
        else onCancel()
      }}
    >
      <span className="text-zinc-400">
        Rename <span className="font-mono text-zinc-200">{rename.name}</span>
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
        className="w-48 rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-zinc-100 outline-none focus:border-sky-500"
      />
      <span className="text-zinc-500" data-testid="rename-count">
        {rename.spans.length} {rename.spans.length === 1 ? 'occurrence' : 'occurrences'} in{' '}
        {files} {files === 1 ? 'file' : 'files'}
      </span>
      <span className="ml-auto text-zinc-600">Enter to rename · Esc to cancel</span>
    </form>
  )
}
