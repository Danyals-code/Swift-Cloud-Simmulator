import type { Diagnostic } from './diagnostics'
import type { FileId, SourceSpan } from './source'
import type { Point, RenderTree } from './render-tree'

/**
 * The worker RPC surface.
 *
 * Deliberately coarse: one `compile` call in, one result out. Chatty protocols
 * across a worker boundary are where interactive latency goes to die, and the
 * whole pipeline (parse -> check -> evaluate -> layout) is fast enough to run as
 * a unit.
 */

export interface SourceFile {
  readonly id: FileId
  readonly text: string
}

export interface CompileRequest {
  readonly files: readonly SourceFile[]
  /** logical point size of the target device, from sim-shell */
  readonly canvas: { readonly width: number; readonly height: number }
  readonly colorScheme: 'light' | 'dark'
  /**
   * Bumped by the caller on every request; echoed back so a slow response for an
   * older revision can be discarded rather than flashing stale output.
   */
  readonly revision: number
}

export type LogLevel = 'log' | 'warn' | 'error'

export interface LogEntry {
  readonly level: LogLevel
  readonly message: string
  /** `print()` call site, or the trap location */
  readonly origin?: SourceSpan
  /** ms since the compile started */
  readonly at: number
}

/** Per-stage timings, surfaced in the perf HUD and asserted against NFR-1 in CI. */
export interface CompileTimings {
  readonly parse: number
  readonly check: number
  readonly evaluate: number
  readonly layout: number
  readonly total: number
}

export interface CompileResult {
  readonly revision: number
  readonly diagnostics: readonly Diagnostic[]
  /**
   * `null` when evaluation could not produce a tree (blocking errors). The renderer
   * keeps painting the last good tree, dimmed, rather than blanking — requirement
   * FR-6.3, because the user is mid-keystroke most of the time.
   */
  readonly renderTree: RenderTree | null
  readonly logs: readonly LogEntry[]
  readonly timings: CompileTimings
}

/** Interactions travelling main thread -> worker. */
export type UIEvent =
  | { readonly kind: 'tap'; readonly handlerId: string; readonly location: Point }
  | { readonly kind: 'toggle'; readonly handlerId: string; readonly value: boolean }
  | { readonly kind: 'textChange'; readonly handlerId: string; readonly value: string }
  | { readonly kind: 'slide'; readonly handlerId: string; readonly value: number }
  | { readonly kind: 'scroll'; readonly handlerId: string; readonly offset: Point }

/** The interface exposed over Comlink. */
export interface CompilerApi {
  compile(request: CompileRequest): Promise<CompileResult>
  /** Dispatch an interaction, then re-evaluate. Returns the new tree. */
  dispatch(event: UIEvent): Promise<CompileResult>
  /** Drop all `@State` boxes and re-evaluate from scratch. */
  reset(): Promise<CompileResult>
}
