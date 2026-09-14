'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadProjectZip } from '@studio/exporter'
import { findFile } from '@studio/project-model'
import { getDevice, type DeviceKey } from '@studio/sim-shell'
import type { FileId, RenderNode, UIEvent } from '@studio/shared'
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

  const { result, stale, workerError, dispatch, reset } = useCompiler(
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

  const handleExport = useCallback(() => {
    if (!project) return
    void flush()
    downloadProjectZip(project)
  }, [project, flush])

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
