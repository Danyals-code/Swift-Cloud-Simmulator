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
  /**
   * Device safe-area insets.
   *
   * This is the rect SwiftUI proposes to a `WindowGroup`'s content, so the layout
   * engine needs it to produce the same frames a real device would.
   */
  readonly safeArea?: {
    readonly top: number
    readonly leading: number
    readonly bottom: number
    readonly trailing: number
  }
  readonly colorScheme: 'light' | 'dark'
  /**
   * Dynamic Type multiplier, 1 = the Large default.
   *
   * A layout input, not a styling one: text grows, so every frame above it changes.
   * That is exactly what makes it worth previewing.
   */
  readonly typeScale?: number
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

/**
 * Interactions travelling main thread -> worker.
 *
 * Gesture events carry a *phase* rather than being three separate kinds, because a
 * gesture is one interaction with a beginning, a middle and an end — and the handlers
 * that run differ only by which phase arrived. `translation` is cumulative from the
 * start of the drag, as SwiftUI reports it, not per-move.
 */
export type UIEvent =
  | { readonly kind: 'tap'; readonly handlerId: string; readonly location: Point }
  | { readonly kind: 'toggle'; readonly handlerId: string; readonly value: boolean }
  | { readonly kind: 'textChange'; readonly handlerId: string; readonly value: string }
  | { readonly kind: 'slide'; readonly handlerId: string; readonly value: number }
  | { readonly kind: 'scroll'; readonly handlerId: string; readonly offset: Point }
  | {
      readonly kind: 'drag'
      readonly handlerId: string
      readonly phase: GesturePhase
      /** Where the pointer is now, in the view's own coordinates. */
      readonly location: Point
      readonly startLocation: Point
      /** Cumulative movement since the drag began. */
      readonly translation: Point
    }
  | {
      readonly kind: 'magnify'
      readonly handlerId: string
      readonly phase: GesturePhase
      readonly scale: number
    }
  | {
      readonly kind: 'rotate'
      readonly handlerId: string
      readonly phase: GesturePhase
      readonly degrees: number
    }
  | { readonly kind: 'longPress'; readonly handlerId: string; readonly phase: GesturePhase }

export type GesturePhase = 'began' | 'changed' | 'ended'

/** Every event carries the handler it is for. */
export function handlerOf(event: UIEvent): string {
  return event.handlerId
}

/** The interface exposed over Comlink. */
export interface CompilerApi {
  compile(request: CompileRequest): Promise<CompileResult>
  /**
   * Dispatch an interaction, then re-evaluate.
   *
   * Takes a `revision` because the caller owns the sequence: the worker inventing
   * its own would let the two counters drift, and the caller's stale-response guard
   * would then discard current results.
   */
  dispatch(event: UIEvent, revision: number): Promise<CompileResult>
  /** Drop all `@State` boxes and re-evaluate from scratch. */
  reset(revision: number): Promise<CompileResult>
  /**
   * Supplies real font measurements.
   *
   * The worker has no fonts, so layout runs against built-in estimates until the
   * main thread measures the actual faces and sends them over. Called once at
   * startup, before the first compile.
   */
  setFontMetrics(fonts: readonly MeasuredFontData[]): Promise<void>

  /**
   * Editor intelligence, all three asking the same question from a different angle:
   * what is the name at this offset?
   *
   * They take the files rather than reading a cached parse, because the editor asks
   * *between* compiles — that is what a debounce is for — and a cached tree would be
   * one keystroke stale exactly when it is consulted.
   */
  complete(files: readonly SourceFile[], fileId: FileId, offset: number): Promise<CompletionResult>
  definition(files: readonly SourceFile[], fileId: FileId, offset: number): Promise<SymbolInfo | null>
  hover(files: readonly SourceFile[], fileId: FileId, offset: number): Promise<SymbolInfo | null>
  references(
    files: readonly SourceFile[],
    fileId: FileId,
    offset: number,
  ): Promise<readonly SourceSpan[]>
}

/** One completion candidate. Mirrors `SymbolInfo` in `swift-sema`. */
export interface SymbolInfo {
  readonly name: string
  readonly kind: string
  readonly detail: string
  readonly span?: SourceSpan
  readonly insert?: string
  readonly doc?: string
}

export interface CompletionResult {
  /** Offset where the word being completed starts, so the editor can replace it. */
  readonly from: number
  readonly items: readonly SymbolInfo[]
}

/** One measured font face. Mirrors `MeasuredFont` in `swiftui-layout`. */
export interface MeasuredFontData {
  readonly family: string
  readonly weight: number
  readonly advances: Readonly<Record<string, number>>
  readonly fallback: number
  readonly ascent: number
  readonly descent: number
}
