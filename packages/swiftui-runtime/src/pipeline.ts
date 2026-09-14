import {
  hasBlockingError,
  rgba,
  type CompileRequest,
  type CompileResult,
  type Diagnostic,
  type LogEntry,
  type RenderNode,
  type RenderTree,
  type UIEvent,
} from '@studio/shared'
import { Parser, type SourceFileNode } from '@studio/swift-syntax'
import { Checker, type SemanticModel } from '@studio/swift-sema'
import {
  CENTER,
  FontMetricsTable,
  LayoutEngine,
  type LayoutEnvironment,
  type MeasuredFont,
} from '@studio/swiftui-layout'
import { AppRuntime, type EvaluationResult } from './app-runtime'
import { bodyFont, labelColor, systemBackground } from './style'
import { placedToRenderTree } from './to-render'
import { viewsToLayout } from './to-layout'

/**
 * The Phase 3 pipeline: parse -> check -> evaluate -> **lay out** -> render.
 *
 * The preview is now the app. Views are measured by the proposal/response engine and
 * painted at absolute frames, so CSS never gets a chance to disagree with SwiftUI
 * about sizing.
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

export function setFontMetrics(fonts: readonly MeasuredFont[]): void {
  metrics = new FontMetricsTable(fonts)
}

export function resetPipelineState(): void {
  runtime.reset()
}

/** Returns true when the event changed something and a re-render is warranted. */
export function applyEvent(event: UIEvent): boolean {
  if (event.kind !== 'tap') return false
  return runtime.dispatch(event.handlerId)
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
  const checkMs = performance.now() - checkStart

  return { files, model, diagnostics: [...diagnostics, ...model.diagnostics], parseMs, checkMs }
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
 * Lays out the evaluated views into a render tree.
 *
 * The root proposal is the device's safe-area rect, which is what SwiftUI proposes to
 * a `WindowGroup`'s content.
 */
function render(request: CompileRequest, evaluation: EvaluationResult): RenderTree {
  const { element } = viewsToLayout(evaluation.views, {
    colorScheme: request.colorScheme,
    typeScale: request.typeScale ?? 1,
  })
  const engine = new LayoutEngine(metrics)

  const safeArea = request.safeArea ?? { top: 0, leading: 0, bottom: 0, trailing: 0 }
  const bounds = {
    x: safeArea.leading,
    y: safeArea.top,
    width: request.canvas.width - safeArea.leading - safeArea.trailing,
    height: request.canvas.height - safeArea.top - safeArea.bottom,
  }

  // SwiftUI centres root content in its window: a VStack hugging its content sits in
  // the middle of the screen rather than pinned to the top.
  const placed = engine.layout(element, bounds, rootEnvironment(request), CENTER)
  return placedToRenderTree(
    placed,
    request.canvas,
    ++revision,
    systemBackground(request.colorScheme),
  )
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
      background: { kind: 'solid', color: rgba(248, 248, 250) },
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
  const renderTree = render(request, evaluation)
  const layoutMs = performance.now() - layoutStart

  return toResult(request, analysis, evaluation, renderTree, startedAt, evaluateMs, layoutMs)
}

function programKeyOf(request: CompileRequest): string {
  return request.files.map((f) => `${f.id} ${f.text}`).join('')
}
