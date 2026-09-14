'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { downloadProjectZip } from '@studio/exporter'
import { findFile } from '@studio/project-model'
import { getDevice, type DeviceKey } from '@studio/sim-shell'
import type { UIEvent } from '@studio/shared'
import { useStudio } from '../lib/store'
import { useCompiler } from '../lib/useCompiler'
import { ConsolePane } from './ConsolePane'
import { DevicePane } from './DevicePane'
import { EditorPane } from './EditorPane'
import { FileRail } from './FileRail'
import { Toolbar } from './Toolbar'

const NO_FILES: never[] = []

export function Studio() {
  const project = useStudio((s) => s.project)
  const activeFileId = useStudio((s) => s.activeFileId)
  const loaded = useStudio((s) => s.loaded)
  const lastSavedAt = useStudio((s) => s.lastSavedAt)
  const load = useStudio((s) => s.load)
  const flush = useStudio((s) => s.flush)
  const setFileText = useStudio((s) => s.setFileText)
  const setActiveFile = useStudio((s) => s.setActiveFile)
  const setDevice = useStudio((s) => s.setDevice)
  const resetToTemplate = useStudio((s) => s.resetToTemplate)

  const [showPreview, setShowPreview] = useState(true)
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setShowPreview((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const device = getDevice(project?.manifest.device ?? 'iphone-15')
  const files = project?.files ?? NO_FILES
  const colorScheme = project?.manifest.colorScheme ?? 'light'

  const { result, stale, workerError, dispatch, reset } = useCompiler(files, device, colorScheme)

  const activeFile = useMemo(
    () => (project && activeFileId ? findFile(project, activeFileId) : undefined),
    [project, activeFileId],
  )

  const diagnostics = useMemo(
    () => (result?.diagnostics ?? []).filter((d) => d.span.file === activeFileId),
    [result, activeFileId],
  )

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

  const handleRevealSpan = useCallback((offset: number) => {
    setReveal({ offset, nonce: ++revealNonce.current })
  }, [])

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
        savedAt={lastSavedAt}
        busy={stale}
        onDeviceChange={(d: DeviceKey) => setDevice(d)}
        onExport={handleExport}
        onResetState={() => void reset()}
        onResetTemplate={resetToTemplate}
      />

      <div className="flex min-h-0 flex-1">
        <FileRail files={files} activeFileId={activeFileId} onSelect={setActiveFile} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {activeFile ? (
              <EditorPane
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
              onRevealSpan={handleRevealSpan}
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
            />
          </div>
        ) : null}
      </div>
    </main>
  )
}
