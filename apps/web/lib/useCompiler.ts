'use client'

import * as Comlink from 'comlink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CompileResult,
  CompilerApi,
  MeasuredFontData,
  SourceFile,
  UIEvent,
} from '@studio/shared'
import type { DeviceSpec } from '@studio/sim-shell'
import { measureFontsWhenReady } from './fontMetrics'

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
  api: Comlink.Remote<CompilerApi>
}

function spawnWorker(): WorkerHandle {
  const worker = new Worker(new URL('../workers/compiler.worker.ts', import.meta.url), {
    type: 'module',
  })
  return { worker, api: Comlink.wrap<CompilerApi>(worker) }
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
export function useCompiler(
  files: readonly SourceFile[],
  device: DeviceSpec,
  colorScheme: 'light' | 'dark',
  typeScale = 1,
) {
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
   * again — otherwise a crash would silently degrade layout for the rest of the
   * session.
   */
  const fontsRef = useRef<Promise<MeasuredFontData[]> | null>(null)

  const ensureWorker = useCallback((): WorkerHandle => {
    if (handleRef.current) return handleRef.current

    const handle = spawnWorker()
    fontsRef.current ??= measureFontsWhenReady()
    void fontsRef.current.then((fonts) => {
      if (fonts.length > 0) void handle.api.setFontMetrics(fonts)
    })
    handle.worker.addEventListener('error', (event) => {
      setState((s) => ({
        ...s,
        workerError: event.message || 'The compiler worker stopped unexpectedly.',
      }))
      // Drop the handle so the next call respawns rather than talking to a corpse.
      handleRef.current = null
    })
    handleRef.current = handle
    return handle
  }, [])

  const accept = useCallback((result: CompileResult) => {
    if (result.revision < paintedRef.current) return
    paintedRef.current = result.revision
    setState({ result, stale: false, workerError: null })
  }, [])

  const runCompile = useCallback(async () => {
    const handle = ensureWorker()
    const revision = ++revisionRef.current
    setState((s) => (s.result ? { ...s, stale: true } : s))

    try {
      accept(
        await handle.api.compile({
          files: files.map((f) => ({ id: f.id, text: f.text })),
          canvas: { width: device.width, height: device.height },
          safeArea: device.safeArea,
          colorScheme,
          typeScale,
          revision,
        }),
      )
    } catch (error) {
      setState((s) => ({
        ...s,
        stale: false,
        workerError: error instanceof Error ? error.message : String(error),
      }))
      handleRef.current = null
    }
  }, [accept, colorScheme, device, ensureWorker, files, typeScale])

  // Debounced recompile whenever the sources or the device change.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void runCompile(), DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [runCompile])

  useEffect(() => {
    return () => {
      handleRef.current?.worker.terminate()
      handleRef.current = null
    }
  }, [])

  const dispatch = useCallback(
    async (event: UIEvent) => {
      try {
        accept(await ensureWorker().api.dispatch(event, ++revisionRef.current))
      } catch {
        // A dead worker during interaction: respawn and recompile from source.
        handleRef.current = null
        void runCompile()
      }
    },
    [accept, ensureWorker, runCompile],
  )

  const reset = useCallback(async () => {
    try {
      accept(await ensureWorker().api.reset(++revisionRef.current))
    } catch {
      handleRef.current = null
      void runCompile()
    }
  }, [accept, ensureWorker, runCompile])

  return useMemo(
    () => ({ ...state, dispatch, reset, recompile: runCompile }),
    [state, dispatch, reset, runCompile],
  )
}
