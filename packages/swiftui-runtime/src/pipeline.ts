import {
  hasBlockingError,
  rgba,
  type CompileRequest,
  type CompileResult,
  type Diagnostic,
  type LogEntry,
  type Rect,
  type RenderNode,
  type RenderTree,
  type UIEvent,
} from '@studio/shared'
import { Parser, type SourceFileNode } from '@studio/swift-syntax'
import { Checker, lintStrictness, type SemanticModel } from '@studio/swift-sema'
import {
  CENTER,
  FontMetricsTable,
  LayoutEngine,
  type LayoutElement,
  type LayoutEnvironment,
  type MeasuredFont,
  type PlacedNode,
} from '@studio/swiftui-layout'
import { AppRuntime, type EvaluationResult } from './app-runtime'
import type { EnvironmentInputs } from './view-environment'
import { bodyFont, colorForName, labelColor, systemBackground } from './style'
import { appendPlaced, placedToRenderTree } from './to-render'
import { screenToLayout, TAB_BAR_HEIGHT, viewsToLayout } from './to-layout'

/**
 * The pipeline: parse -> check -> evaluate -> **compose** -> lay out -> render.
 *
 * Phase 6 adds the composition step. A screen is no longer just the user's content:
 * it is the content *plus* whatever the framework puts around and over it — a
 * navigation bar, a tab bar, a sheet. Each of those is positioned against the device
 * rather than against the content, so each gets its own layout pass against its own
 * rect, and the results are concatenated in paint order.
 *
 * When the program cannot run — parse errors, or a runtime trap — the last good tree
 * keeps being shown by the *renderer*, dimmed (FR-6.3). This module simply reports
 * `renderTree: null` and lets the UI decide, rather than blanking the screen.
 */

const runtime = new AppRuntime()

/** Replaced once the main thread measures the real fonts. */
let metrics = new FontMetricsTable()
let revision = 0
let lastAnalysis: { request: CompileRequest; analysis: Analysis } | null = null

/** z ranges, so bars always paint over content and presentations over everything. */
const BAR_Z = 100_000
const OVERLAY_Z = 200_000

export function setFontMetrics(fonts: readonly MeasuredFont[]): void {
  metrics = new FontMetricsTable(fonts)
}

export function resetPipelineState(): void {
  runtime.reset()
}

/** Returns true when the event changed something and a re-render is warranted. */
export function applyEvent(event: UIEvent): boolean {
  return runtime.dispatch(event)
}

interface Analysis {
  readonly files: readonly SourceFileNode[]
  readonly model: SemanticModel
  readonly diagnostics: readonly Diagnostic[]
  readonly parseMs: number
  readonly checkMs: number
}

function analyse(request: CompileRequest): Analysis {
  const parseStart = performance.now()
  const files: SourceFileNode[] = []
  const diagnostics: Diagnostic[] = []

  for (const file of request.files) {
    const result = Parser.parse(file.text, file.id)
    files.push(result.sourceFile)
    diagnostics.push(...result.diagnostics)
  }
  const parseMs = performance.now() - parseStart

  const checkStart = performance.now()
  const model = Checker.check(files)

  // The strictness pass runs only on code that parsed cleanly. On a half-typed file
  // its inference would be working from a broken tree, and a warning derived from
  // that is exactly the false positive the pass exists to avoid.
  const strict = diagnostics.some((d) => d.severity === 'error') ? [] : lintStrictness(files, model)
  const checkMs = performance.now() - checkStart

  return {
    files,
    model,
    diagnostics: [...diagnostics, ...model.diagnostics, ...strict],
    parseMs,
    checkMs,
  }
}

function rootEnvironment(request: CompileRequest): LayoutEnvironment {
  return {
    font: bodyFont(request.typeScale ?? 1),
    foregroundColor: labelColor(request.colorScheme),
    opacity: 1,
    cornerRadius: 0,
  }
}

/**
 * Lays out the composed screen.
 *
 * Each region is laid out against the rect it actually occupies on the device, which
 * is why they are separate passes rather than one tree: a tab bar is glued to the
 * bottom edge no matter what the content does, and a sheet deliberately covers the
 * status bar. Expressing that inside a single layout tree would need absolute
 * positioning, which is precisely the concept a proposal-based engine does not have.
 */
function render(request: CompileRequest, evaluation: EvaluationResult): RenderTree {
  const engine = new LayoutEngine(metrics)
  // `withAnimation { … }` animates every change in its transaction, so the hint goes
  // on the root environment and every node below inherits it for exactly one frame.
  const env = withAnimation(rootEnvironment(request), evaluation)
  const scheme = request.colorScheme
  const canvas = request.canvas
  const safeArea = request.safeArea ?? { top: 0, leading: 0, bottom: 0, trailing: 0 }

  const ui = evaluation.ui
  const screen = ui
    ? screenToLayout(ui, { colorScheme: scheme, typeScale: request.typeScale ?? 1, safeArea })
    : {
        content: viewsToLayout(evaluation.views, {
          colorScheme: scheme,
          typeScale: request.typeScale ?? 1,
        }).element,
        navigationBar: null,
        tabBar: null,
        overlay: null,
      }

  const barHeight = screen.navigationBar?.height ?? 0
  const tabHeight = screen.tabBar ? TAB_BAR_HEIGHT : 0

  const contentBounds: Rect = {
    x: safeArea.leading,
    y: safeArea.top + barHeight,
    width: canvas.width - safeArea.leading - safeArea.trailing,
    height: canvas.height - safeArea.top - safeArea.bottom - barHeight - tabHeight,
  }

  // SwiftUI centres root content in its window: a VStack hugging its content sits in
  // the middle of the screen rather than pinned to the top.
  const placed = engine.layout(screen.content, contentBounds, env, CENTER)
  let tree = placedToRenderTree(placed, canvas, ++revision, systemBackground(scheme))

  if (screen.navigationBar) {
    // The bar extends up behind the status bar, as it does on a real device.
    const bar = engine.layout(
      screen.navigationBar.element,
      { x: 0, y: 0, width: canvas.width, height: safeArea.top + barHeight },
      env,
      CENTER,
    )
    tree = appendPlaced(tree, bar, BAR_Z)
  }

  if (screen.tabBar) {
    const bar = engine.layout(
      screen.tabBar,
      {
        x: 0,
        y: canvas.height - safeArea.bottom - tabHeight,
        width: canvas.width,
        height: tabHeight + safeArea.bottom,
      },
      env,
      CENTER,
    )
    tree = appendPlaced(tree, bar, BAR_Z)
  }

  if (screen.overlay) {
    tree = appendPlaced(
      tree,
      presentOverlay(engine, screen.overlay, canvas, safeArea, env),
      OVERLAY_Z,
    )
  }

  return tree
}

function withAnimation(
  env: LayoutEnvironment,
  evaluation: EvaluationResult,
): LayoutEnvironment {
  const animation = evaluation.ui?.animation
  return animation ? { ...env, animation } : env
}

/** Places a presentation: a dimming layer, then the presented surface over it. */
function presentOverlay(
  engine: LayoutEngine,
  overlay: NonNullable<ReturnType<typeof screenToLayout>['overlay']>,
  canvas: { width: number; height: number },
  safeArea: { top: number; leading: number; bottom: number; trailing: number },
  env: LayoutEnvironment,
): PlacedNode[] {
  const nodes: PlacedNode[] = []

  // Everything behind a presentation dims, and tapping the dimmed area dismisses it
  // — which is the only affordance a preview can offer in place of a swipe.
  nodes.push({
    id: 'overlay-dim',
    frame: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    z: 0,
    opacity: 1,
    cornerRadius: 0,
    paint: { kind: 'fill', fill: { kind: 'solid', color: rgba(0, 0, 0, 0.32) } },
    ...(overlay.dismissId
      ? {
          hitTarget: {
            handlerId: overlay.dismissId,
            label: 'Dismiss',
            role: 'button' as const,
            enabled: true,
          },
        }
      : {}),
  })

  const rect = overlayRect(overlay, canvas, safeArea)
  const surface = engine.layout(
    overlay.element,
    rect,
    { ...env, cornerRadius: overlay.kind === 'sheet' ? 12 : overlay.kind === 'cover' ? 0 : 14 },
    overlay.kind === 'alert'
      ? CENTER
      : overlay.kind === 'dialog'
        ? { horizontal: 'center', vertical: 'bottom' }
        : { horizontal: 'leading', vertical: 'top' },
  )

  // The dim layer is z 0 here; the surface must sit above it.
  for (const node of surface) nodes.push({ ...node, z: node.z + 1 })

  return nodes
}

function overlayRect(
  overlay: NonNullable<ReturnType<typeof screenToLayout>['overlay']>,
  canvas: { width: number; height: number },
  safeArea: { top: number; leading: number; bottom: number; trailing: number },
): Rect {
  if (overlay.kind === 'cover') {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  }

  if (overlay.kind === 'alert') {
    const width = Math.min(270, canvas.width - 80)
    return { x: (canvas.width - width) / 2, y: 0, width, height: canvas.height }
  }

  if (overlay.kind === 'dialog') {
    const width = canvas.width - 16
    return { x: 8, y: 0, width, height: canvas.height - safeArea.bottom - 8 }
  }

  // A sheet: a negative detent is an absolute height in points, a positive one a
  // fraction of the screen — which is exactly how `PresentationDetent` is spelled.
  const height =
    overlay.detent < 0
      ? Math.min(-overlay.detent, canvas.height - safeArea.top)
      : canvas.height * overlay.detent
  return { x: 0, y: canvas.height - height, width: canvas.width, height }
}

/** A tree carrying only a message, for states where there is nothing to draw. */
function noticeTree(request: CompileRequest, title: string, detail: string): RenderTree {
  const pad = 20
  const width = request.canvas.width - pad * 2
  const nodes: RenderNode[] = [
    {
      id: 'screen',
      kind: 'layer',
      frame: { x: 0, y: 0, width: request.canvas.width, height: request.canvas.height },
      z: 0,
      opacity: 1,
      background: {
        kind: 'solid',
        color:
          request.colorScheme === 'dark'
            ? (colorForName('secondarySystemBackground', 'dark') ?? rgba(28, 28, 30))
            : rgba(248, 248, 250),
      },
    },
    {
      id: 'notice',
      kind: 'placeholder',
      frame: { x: pad, y: (request.safeArea?.top ?? 0) + 24, width, height: 92 },
      z: 1,
      opacity: 1,
      placeholder: { feature: title, reason: detail },
    },
  ]
  return { canvas: request.canvas, nodes, revision: ++revision }
}

function toResult(
  request: CompileRequest,
  analysis: Analysis,
  evaluation: EvaluationResult | null,
  renderTree: RenderTree | null,
  startedAt: number,
  evaluateMs: number,
  layoutMs: number,
): CompileResult {
  const total = performance.now() - startedAt

  const logs: LogEntry[] = (evaluation?.logs ?? []).map((entry) => ({
    level: 'log' as const,
    message: entry.message,
    origin: entry.span,
    at: total,
  }))

  const diagnostics = [...analysis.diagnostics]
  if (evaluation?.failure) {
    diagnostics.push({
      span: evaluation.failure.span,
      severity: 'error',
      code: evaluation.failure.kind === 'budget' ? 'execution_budget_exceeded' : 'runtime_trap',
      message:
        evaluation.failure.frames.length > 0
          ? `${evaluation.failure.message} (in ${evaluation.failure.frames[0]})`
          : evaluation.failure.message,
    })
  }

  return {
    revision: request.revision,
    diagnostics,
    renderTree,
    logs,
    timings: {
      parse: analysis.parseMs,
      check: analysis.checkMs,
      evaluate: evaluateMs,
      layout: layoutMs,
      total,
    },
  }
}

export function compile(request: CompileRequest): CompileResult {
  const startedAt = performance.now()
  const analysis = analyse(request)
  lastAnalysis = { request, analysis }

  // Evaluation needs a well-formed program. Running one with parse errors would
  // produce failures that describe the broken parse rather than the user's code.
  if (hasBlockingError(analysis.diagnostics)) {
    const errors = analysis.diagnostics.filter((d) => d.severity === 'error')
    return toResult(
      request,
      analysis,
      null,
      noticeTree(
        request,
        `${errors.length} error${errors.length === 1 ? '' : 's'}`,
        errors[0]?.message ?? 'Fix the errors to run.',
      ),
      startedAt,
      0,
      0,
    )
  }

  const evaluateStart = performance.now()
  runtime.load(analysis.files, analysis.model, programKeyOf(request))
  runtime.setEnvironment(environmentFor(request))
  runtime.setDefaultGeometry(contentSizeOf(request))
  const evaluation = runtime.evaluate()
  const evaluateMs = performance.now() - evaluateStart

  return finish(request, analysis, evaluation, startedAt, evaluateMs)
}

/**
 * Re-renders after an interaction, without re-parsing unchanged source.
 *
 * `revision` comes from the caller, never from here. The worker keeping its own
 * counter would let it run ahead of the caller's, after which every genuinely newer
 * compile looks stale and is dropped.
 */
export function rerender(revision: number): CompileResult {
  if (!lastAnalysis) throw new Error('rerender called before any compile')

  const { request, analysis } = lastAnalysis
  const next = { ...request, revision }
  lastAnalysis = { request: next, analysis }

  const startedAt = performance.now()
  if (hasBlockingError(analysis.diagnostics)) {
    return toResult(next, analysis, null, null, startedAt, 0, 0)
  }

  const evaluateStart = performance.now()
  const evaluation = runtime.evaluate()
  return finish(next, analysis, evaluation, startedAt, performance.now() - evaluateStart)
}

function finish(
  request: CompileRequest,
  analysis: Analysis,
  evaluation: EvaluationResult,
  startedAt: number,
  evaluateMs: number,
): CompileResult {
  if (evaluation.failure) {
    return toResult(
      request,
      analysis,
      evaluation,
      noticeTree(request, 'Execution stopped', evaluation.failure.message),
      startedAt,
      evaluateMs,
      0,
    )
  }

  const layoutStart = performance.now()
  let renderTree = render(request, evaluation)

  // A `GeometryReader` has to report a size before layout has decided one, so the
  // first pass uses the size it had last time. If that was wrong, the sizes are now
  // known and one more pass fixes it. Bounded at one retry: a reader is greedy, so
  // its size does not depend on what its closure produced and the second pass is
  // always right.
  if (runtime.updateGeometry(geometryFrom(renderTree))) {
    const corrected = runtime.evaluate()
    if (!corrected.failure) {
      evaluation = corrected
      renderTree = render(request, corrected)
    }
  }

  const layoutMs = performance.now() - layoutStart

  return toResult(request, analysis, evaluation, renderTree, startedAt, evaluateMs, layoutMs)
}

/** The measured size of every geometry reader in a tree, keyed as it reported. */
function geometryFrom(tree: RenderTree): Map<string, { width: number; height: number }> {
  const sizes = new Map<string, { width: number; height: number }>()
  for (const node of tree.nodes) {
    if (!node.id.startsWith('geo:')) continue
    sizes.set(node.id.slice(4), { width: node.frame.width, height: node.frame.height })
  }
  return sizes
}

/**
 * What `@Environment` reports, from what the preview controls are set to.
 *
 * Read on every compile rather than at load, because appearance and Dynamic Type
 * change without the program changing — and reloading would discard every `@State`.
 */
/** The rect a root view is proposed — what a geometry reader reports before layout. */
function contentSizeOf(request: CompileRequest): { width: number; height: number } {
  const safeArea = request.safeArea ?? { top: 0, leading: 0, bottom: 0, trailing: 0 }
  return {
    width: request.canvas.width - safeArea.leading - safeArea.trailing,
    height: request.canvas.height - safeArea.top - safeArea.bottom,
  }
}

function environmentFor(request: CompileRequest): EnvironmentInputs {
  const scale = request.typeScale ?? 1
  return {
    colorScheme: request.colorScheme,
    typeScale: scale,
    locale: 'en_US',
    layoutDirection: 'leftToRight',
    // A phone is compact across and regular down; a landscape phone and an iPad are
    // not, but the device model does not report that yet.
    horizontalSizeClass: request.canvas.width >= 700 ? 'regular' : 'compact',
    verticalSizeClass: request.canvas.height >= 700 ? 'regular' : 'compact',
  }
}

function programKeyOf(request: CompileRequest): string {
  return request.files.map((f) => `${f.id} ${f.text}`).join('')
}

export type { LayoutElement }
