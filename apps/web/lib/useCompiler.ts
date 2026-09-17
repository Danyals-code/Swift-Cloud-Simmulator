'use client'

import * as Comlink from 'comlink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CompileResult,
  PreviewTarget,
  DynamicTypeSize,
  CompilerApi,
  CompletionResult,
  SourceSpan,
  SymbolInfo,
  MeasuredFontData,
  SourceFile,
  UIEvent,
} from '@studio/shared'
import type { DeviceSpec } from '@studio/sim-shell'
import { measureFontsWhenReady, measureTextBatch } from './fontMetrics'
import { recordCoverage } from './telemetry'
import { WorkerRequests } from './workerRequests'

/** Edit-to-recompile debounce. Long enough to coalesce a fast typist's burst, short enough to feel live. */
const DEBOUNCE_MS = 150

export interface CompilerState {
  result: CompileResult | null
  /** true while a compile is in flight and the displayed tree is from an older revision */
  stale: boolean
  /** set when the worker itself died, as opposed to the user's code failing */
  workerError: string | null
}

interface WorkerHandle {
  worker: Worker
  ready?: Promise<void>
  api: Comlink.Remote<CompilerApi>
  requests: WorkerRequests
  dispose(): void
}

function spawnWorker(onFailure: (error: Error) => void): WorkerHandle {
  const worker = new Worker(new URL('../workers/compiler.worker.ts', import.meta.url), {
    type: 'module',
  })
  const remote = Comlink.wrap<CompilerApi>(worker)
  const requests = new WorkerRequests((error) => { worker.terminate(); onFailure(error) })
  // Every RPC is bounded, including completion and font refinement.
  const api = new Proxy(remote, {
    get(target, key) {
      if (typeof key !== 'string') return Reflect.get(target, key)
      return (...args: unknown[]) => requests.run(() => Promise.resolve(Reflect.apply(Reflect.get(target, key), target, args)))
    },
  })
  return { worker, api, requests, dispose() { requests.stop(undefined, false); worker.terminate() } }
}

/**
 * Owns the compiler worker's lifecycle.
 *
 * Two things here are load-bearing beyond the obvious:
 *
 * 1. **Revision guarding.** Responses that arrive out of order are discarded rather
 *    than painted. Without it, a slow compile for an older edit lands after a fast
 *    one and the preview flickers backwards.
 * 2. **Restart on crash.** The document lives in the store, not the worker, so a
 *    dead worker is recoverable: respawn and recompile. The editor never goes down
 *    with it (requirement NFR-3).
 */
export interface CompilerOptions {
  projectId?: string
  previewTarget?: PreviewTarget
  files: readonly SourceFile[]
  device: DeviceSpec
  colorScheme: 'light' | 'dark'
  /** Dynamic Type multiplier, 1 = the Large default. */
  typeScale?: number
  dynamicTypeSize?: DynamicTypeSize
  /**
   * Suspends the recompile-on-edit loop.
   *
   * The preview keeps whatever it last drew and stays interactive; edits simply do
   * not run. `recompile()` still works, which is what Run does - so pausing is a
   * pause, not a disconnection.
   */
  paused?: boolean
}

export function useCompiler({
  projectId,
  files,
  device,
  colorScheme,
  typeScale = 1,
  dynamicTypeSize,
  previewTarget,
  paused = false,
}: CompilerOptions) {
  const handleRef = useRef<WorkerHandle | null>(null)
  const revisionRef = useRef(0)
  /** highest revision actually painted, so stale responses can be dropped */
  const paintedRef = useRef(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [state, setState] = useState<CompilerState>({
    result: null,
    stale: false,
    workerError: null,
  })

  /**
   * Real font measurements, taken once and re-sent to every worker.
   *
   * A respawned worker starts with the built-in estimates, so it has to be told
   * again - otherwise a crash would silently degrade layout for the rest of the
   * session.
   */
  const fontsRef = useRef<Promise<MeasuredFontData[]> | null>(null)

  const ensureWorker = useCallback((): WorkerHandle => {
    if (handleRef.current) return handleRef.current

    const handle = spawnWorker((error) => {
      if (handleRef.current !== handle) return
      handleRef.current = null
      setState((s) => ({ ...s, stale: false, workerError: error.message }))
    })
    fontsRef.current ??= measureFontsWhenReady()
    handle.ready = fontsRef.current.then(async (fonts) => {
      if (fonts.length > 0) await handle.api.setFontMetrics(fonts)
    })
    handle.worker.addEventListener('error', (event) => {
      handle.requests.stop(new Error(event.message || 'The compiler worker stopped unexpectedly.'))
    })
    handleRef.current = handle
    return handle
  }, [])

  const accept = useCallback((result: CompileResult) => {
    if (result.revision < revisionRef.current || result.revision < paintedRef.current) return
    paintedRef.current = result.revision
    // Recorded before the paint, so what the Coverage panel shows always describes
    // the tree on screen rather than the one before it.
    recordCoverage(result)
    setState({ result, stale: false, workerError: null })
  }, [])

  const refine = useCallback(async (initial: CompileResult, handle: WorkerHandle) => {
    let result = initial
    // New wrapping can ask for new runs. Bound refinement and expose any remaining
    // estimates instead of looping indefinitely or issuing one RPC per string.
    for (let pass = 0; pass < 8; pass++) {
      if (result.revision !== revisionRef.current || handle !== handleRef.current) return
      const requests = result.textMeasurement?.requests ?? []
      if (!requests.length) break
      const measured = measureTextBatch(requests)
      if (!measured.length) break
      const next = await handle.api.setTextMeasurements(measured, result.revision, result.textMeasurement?.generation)
      if (!next) return
      result = next
    }
    if (handle === handleRef.current) accept(result)
  }, [accept])

  const runCompile = useCallback(async () => {
    const handle = ensureWorker()
    const revision = ++revisionRef.current
    setState((s) => (s.result ? { ...s, stale: true } : s))

    try {
      await handle.ready
      if (revision !== revisionRef.current || handle !== handleRef.current) return
      await refine(
        await handle.api.compile({
          projectId,
          files: files.map((f) => ({ id: f.id, text: f.text })),
          canvas: { width: device.width, height: device.height },
          safeArea: device.safeArea,
          colorScheme,
          previewTarget,
          typeScale,
          dynamicTypeSize,
          displayScale: device.scale,
          revision,
        }), handle,
      )
    } catch (error) {
      if (handleRef.current !== handle) return
      handle.dispose()
      setState((s) => ({
        ...s,
        stale: false,
        workerError: error instanceof Error ? error.message : String(error),
      }))
      handleRef.current = null
    }
  }, [refine, colorScheme, device, ensureWorker, files, typeScale, dynamicTypeSize, previewTarget, projectId])

  const latestCompile = useRef(runCompile)
  const latestPaused = useRef(paused)
  useEffect(() => { latestCompile.current = runCompile; latestPaused.current = paused }, [runCompile, paused])
  useEffect(() => {
    let active = true
    const refresh = () => {
      const handle = handleRef.current
      fontsRef.current = measureFontsWhenReady()
      if (!handle) return
      handle.ready = fontsRef.current.then(async (fonts) => {
        if (!active || handle !== handleRef.current) return
        await handle.api.setFontMetrics(fonts)
      })
      void handle.ready.then(() => {
        if (!active || handle !== handleRef.current) return
        if (latestPaused.current && paintedRef.current >= 0) {
          return handle.api.relayout(++revisionRef.current).then((result) => refine(result, handle))
        }
        void latestCompile.current()
      }).catch(() => { /* The normal compile path reports a worker failure. */ })
    }
    document.fonts?.addEventListener('loadingdone', refresh)
    return () => { active = false; document.fonts?.removeEventListener('loadingdone', refresh) }
  }, [refine])

  /**
   * Debounced recompile whenever the sources or the device change.
   *
   * Skipped entirely while paused rather than compiled-and-discarded: the point of
   * pausing is to stop the work, and on a project whose `body` is expensive that is
   * the difference between a responsive editor and a stuttering one. The first
   * compile after resuming is immediate, because the edits are already made and
   * there is nothing left to coalesce.
   */
  const first = useRef(true)
  const compiledProject = useRef<string | undefined>(undefined)
  useEffect(() => {
    const changedProject = compiledProject.current !== projectId
    if (paused && !changedProject) return
    compiledProject.current = projectId
    const immediate = first.current || changedProject
    first.current = false

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void runCompile(), immediate ? 0 : DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [runCompile, paused, projectId])

  useEffect(() => {
    return () => {
      handleRef.current?.dispose()
      handleRef.current = null
    }
  }, [])

  const dispatch = useCallback(
    async (event: UIEvent) => {
      const handle = ensureWorker()
      try {
        await handle.ready
        await refine(await handle.api.dispatch(event, ++revisionRef.current), handle)
      } catch (error) {
        handle.requests.stop(error instanceof Error ? error : new Error(String(error)))
      }
    },
    [refine, ensureWorker],
  )

  const reset = useCallback(async () => {
    const handle = ensureWorker()
    try {
      await handle.ready
      await refine(await handle.api.reset(++revisionRef.current), handle)
    } catch (error) {
      handle.requests.stop(error instanceof Error ? error : new Error(String(error)))
    }
  }, [refine, ensureWorker])

  /**
   * Editor intelligence, asked of the worker on demand.
   *
   * The current `files` are sent with every request rather than relying on whatever
   * the worker last compiled: the editor asks *between* compiles, which is the whole
   * point of the debounce, so the worker's copy is one keystroke stale exactly when
   * completion is consulted.
   *
   * A dead worker returns the empty answer rather than respawning. Completion is not
   * worth a restart on its own - the next compile will bring one back - and a
   * half-second stall on a keystroke is more disruptive than a missing list.
   */
  const language = useMemo(
    () => ({
      complete: async (fileId: string, offset: number): Promise<CompletionResult> => {
        try {
          return await ensureWorker().api.complete(files, fileId, offset)
        } catch {
          return { from: offset, items: [] }
        }
      },
      definition: async (fileId: string, offset: number): Promise<SymbolInfo | null> => {
        try {
          return await ensureWorker().api.definition(files, fileId, offset)
        } catch {
          return null
        }
      },
      hover: async (fileId: string, offset: number): Promise<SymbolInfo | null> => {
        try {
          return await ensureWorker().api.hover(files, fileId, offset)
        } catch {
          return null
        }
      },
      references: async (
        fileId: string,
        offset: number,
      ): Promise<{ name: string; spans: readonly SourceSpan[] }> => {
        try {
          return await ensureWorker().api.references(files, fileId, offset)
        } catch {
          return { name: '', spans: [] }
        }
      },
    }),
    [ensureWorker, files],
  )

  return useMemo(
    () => ({ ...state, dispatch, reset, recompile: runCompile, language }),
    [state, dispatch, reset, runCompile, language],
  )
}

export type LanguageService = ReturnType<typeof useCompiler>['language']
