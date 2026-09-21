import type { PreviewScenario, ComponentDescription, CopyMatch, CopyValue } from './authoring-features'
import type { DesignEditRequest, DesignEditPlan } from './design-edit'
import type { ViewLayer } from './view-layer'
import type { AuthoringSnapshot } from './authoring'
import type { DynamicTypeSize } from './dynamic-type'
import type { MeasuredTextData, TextMeasureRequest } from './text-measurement'
import type { PreviewTarget } from './appearance'
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

export interface PreviewImageAsset {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly light: string
  readonly dark?: string
}

/** A colour set from the asset catalog, as `Color("name")` reads it. Hex, `#RRGGBB[AA]`. */
export interface PreviewColorAsset {
  readonly name: string
  readonly light: string
  readonly dark?: string
}

export interface CompileRequest {
  readonly images?: readonly PreviewImageAsset[]
  /** The project's colour sets, one value per appearance. */
  readonly colors?: readonly PreviewColorAsset[]
  /** Separates live app state when the IDE opens a different project. */
  readonly projectId?: string
  readonly deploymentTarget?: string
  readonly scenario?: PreviewScenario
  readonly componentDescriptions?: readonly ComponentDescription[]
  /** Standalone design screens, including destinations not connected yet. */
  readonly designScreens?: readonly { readonly view: string; readonly name: string }[]
  readonly previewScreen?: string
  readonly previewTarget?: PreviewTarget
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
  readonly dynamicTypeSize?: DynamicTypeSize
  readonly displayScale?: number
  /**
   * Render every page, not only the one on screen.
   *
   * Off by default and switched on by the studio's page gallery, because it costs
   * one layout pass per page. Deferred destinations and presentations are built
   * from a detached copy of current app state, without actions or lifecycle hooks.
   * Main tabs remain root pages; related screens carry their owning page id.
   */
  readonly allPages?: boolean
  /** Snapshot exports may request more pages than the interactive gallery. Maximum 128 per category. */
  readonly galleryLimit?: number
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

/**
 * One page of the app, drawn on its own.
 *
 * `id` is the `ViewLayer` id of the same page, so the gallery, Layers and the
 * preview are all naming the same thing; `handlerId` is that page's tab item, which
 * is what makes a page the live one.
 */
export interface PagePreview {
  /** A design-only root that is not reachable from the app entry point yet. */
  readonly standalone?: boolean
  readonly id: string
  readonly name: string
  readonly active: boolean
  readonly handlerId?: string
  readonly tree: RenderTree
  /** Related screens are placed below their owning page, rather than beside tabs. */
  readonly parentId?: string
  readonly rootId?: string
  readonly kind?: 'root' | 'destination' | 'sheet' | 'cover' | 'popover'
  /** A tab's SF Symbol, for its lane header. */
  readonly icon?: string
  readonly source?: SourceSpan
  /** Source mapping for views only present in this isolated preview. */
  readonly viewHierarchy?: readonly ViewLayer[]
}

export interface CompileResult {
  readonly revision: number
  readonly authoring?: AuthoringSnapshot
  readonly diagnostics: readonly Diagnostic[]
  /**
   * `null` when evaluation could not produce a tree (blocking errors). The renderer
   * keeps painting the last good tree, dimmed, rather than blanking - requirement
   * FR-6.3, because the user is mid-keystroke most of the time.
   */
  readonly renderTree: RenderTree | null
  readonly viewHierarchy?: readonly ViewLayer[]
  /**
   * Every page, composed and laid out, when `allPages` asked for them.
   *
   * Root tabs are capped separately from related screens. Child pages include
   * their own hierarchy because their views are absent from the live screen.
   */
  readonly pages?: readonly PagePreview[]
  readonly logs: readonly LogEntry[]
  readonly timings: CompileTimings
  /** Pending shaped runs are resolved in one bounded main-thread batch. */
  readonly textMeasurement?: { readonly generation?: number; readonly provisional: boolean; readonly requests: readonly TextMeasureRequest[] }
}

/**
 * Interactions travelling main thread -> worker.
 *
 * Gesture events carry a *phase* rather than being three separate kinds, because a
 * gesture is one interaction with a beginning, a middle and an end - and the handlers
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

/**
 * An edit the canvas asks for, named by where the view is written.
 *
 * The offset is the view's own source span, which is what the hierarchy and the
 * render tree both carry - so "this view" means the same thing to the canvas, to
 * Layers and to the parser that performs the edit.
 */
export type ViewEdit =
  | { readonly kind: 'delete' }
  | { readonly kind: 'move'; readonly direction: -1 | 1 }
  | { readonly kind: 'insert'; readonly snippet: string }
  /** A drag: put this view before or after another one, wherever that one is. */
  | { readonly kind: 'moveTo'; readonly targetOffset: number; readonly position: 'before' | 'after' }
  | { readonly kind: 'hide' }
  | { readonly kind: 'show' }

/**
 * A view this file is hiding, which is a view commented out of it.
 *
 * Carried on the compile result because the hierarchy cannot carry it: a
 * commented-out view is exactly what the parser produces no tree for, and the studio
 * still has to draw the switch that brings it back.
 */
export interface HiddenViewInfo {
  readonly file: FileId
  readonly offset: number
  readonly name: string
  readonly type: string
  /** The container it was hidden from, as that view's own offset. */
  readonly container: number | null
}

/** What the canvas can do to a view, which is what its controls are drawn from. */
export interface ViewSiteInfo {
  readonly index: number
  readonly siblings: number
  readonly container: boolean
  readonly inContent: boolean
}

/** The interface exposed over Comlink. */
export interface CompilerApi {
  validateResourceRemoval(files: readonly SourceFile[], removedNames: readonly string[], removedColors?: readonly string[]): Promise<string | null>
  planDesignEdit(request: DesignEditRequest): Promise<DesignEditPlan>
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
  setTextMeasurements(data: readonly MeasuredTextData[], revision: number, generation?: number): Promise<CompileResult | null>
  relayout(revision: number): Promise<CompileResult>
  /**
   * Turns the page gallery on or off and re-renders at once.
   *
   * A separate call rather than a recompile: the source has not changed, and going
   * through `compile` would debounce the answer behind a keystroke timer and throw
   * away nothing but time. Returns null before the first compile, when there is no
   * program to draw.
   */
  setAllPages(enabled: boolean, revision: number): Promise<CompileResult | null>
  /** What can be done to the view at this offset, for drawing the controls. */
  describeView(text: string, file: FileId, offset: number): Promise<ViewSiteInfo | null>
  /** The Swift that draws this view, for a copy. */
  copyView(text: string, file: FileId, offset: number): Promise<string | null>
  /** Views elsewhere in the project with the same shape as the one at this span. */
  findCopies(files: readonly SourceFile[], target: SourceSpan, options?: { deploymentTarget?: string; screens?: readonly string[] }): Promise<{ copies: readonly CopyMatch[]; values: readonly CopyValue[]; eligible: boolean; reason?: string }>
  /** Every view the given files are hiding. */
  hiddenViews(files: readonly SourceFile[]): Promise<readonly HiddenViewInfo[]>

  /**
   * Editor intelligence, all three asking the same question from a different angle:
   * what is the name at this offset?
   *
   * They take the files rather than reading a cached parse, because the editor asks
   * *between* compiles - that is what a debounce is for - and a cached tree would be
   * one keystroke stale exactly when it is consulted.
   */
  complete(files: readonly SourceFile[], fileId: FileId, offset: number): Promise<CompletionResult>
  definition(files: readonly SourceFile[], fileId: FileId, offset: number): Promise<SymbolInfo | null>
  hover(files: readonly SourceFile[], fileId: FileId, offset: number): Promise<SymbolInfo | null>
  /** The name at `offset` and every occurrence of it, project-wide, for rename. */
  references(
    files: readonly SourceFile[],
    fileId: FileId,
    offset: number,
  ): Promise<{ readonly name: string; readonly spans: readonly SourceSpan[] }>
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
  readonly resolvedFamily?: string
  readonly referenceWidth?: number
  readonly weight: number
  readonly advances: Readonly<Record<string, number>>
  readonly fallback: number
  readonly ascent: number
  readonly descent: number
}
