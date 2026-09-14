import {
  hasBlockingError,
  rgba,
  type CompileRequest,
  type CompileResult,
  type Diagnostic,
  type LogEntry,
  type RenderNode,
  type RenderTree,
  type ResolvedFont,
  type RGBA,
  type SourceSpan,
  type UIEvent,
} from '@studio/shared'
import { Parser, type SourceFileNode } from '@studio/swift-syntax'
import { Checker, type SemanticModel } from '@studio/swift-sema'
import { actionId, AppRuntime, type EvaluationResult } from './app-runtime'
import { flattenViews, renderArg, type FlatView } from './view-value'

/**
 * The Phase 2 pipeline: parse -> check -> **evaluate** -> report.
 *
 * The preview now runs the user's code. Every value on screen is real: string
 * interpolations resolved, ternaries taken, `@State` read from a live instance.
 * Tapping a `Button` row runs its actual Swift closure and the tree re-evaluates.
 *
 * What is still missing is *drawing* — the layout engine and renderer land in
 * Phase 3. Until then the running app is presented as a structural tree rather than
 * as pixels, which is the honest way to show a program that is genuinely executing
 * but not yet laid out.
 */

const SYSTEM_FONT = '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif'
const MONO_FONT = 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace'

function font(family: string, size: number, weight: number, lineHeight: number): ResolvedFont {
  return { family, size, weight, italic: false, lineHeight }
}

const TITLE = font(SYSTEM_FONT, 20, 700, 26)
const CAPTION = font(SYSTEM_FONT, 12, 500, 16)
const ROW = font(MONO_FONT, 13, 600, 18)
const ROW_DETAIL = font(MONO_FONT, 12, 400, 18)

const LABEL = rgba(17, 17, 20, 1)
const SECONDARY = rgba(60, 60, 67, 0.62)
const TERTIARY = rgba(60, 60, 67, 0.4)
const ACCENT = rgba(0, 96, 200, 1)
const ACTIONABLE = rgba(0, 122, 60, 1)
const BACKGROUND = rgba(246, 246, 249, 1)
const CARD = rgba(255, 255, 255, 1)
const SELECTED = rgba(0, 122, 255, 0.12)
const ERROR = rgba(200, 30, 30, 1)
const WARNING = rgba(170, 90, 0, 1)

const ROW_HEIGHT = 22
const INDENT = 14

const runtime = new AppRuntime()
let selectedPath: string | null = null
let revision = 0
/** The most recent request, so `dispatch` and `reset` can re-render without it. */
let lastAnalysis: { request: CompileRequest; analysis: Analysis } | null = null

export function resetPipelineState(): void {
  selectedPath = null
  runtime.reset()
}

/** Returns true when the event changed something and a re-render is warranted. */
export function applyEvent(event: UIEvent): boolean {
  if (event.kind !== 'tap') return false

  if (event.handlerId.startsWith('action-')) return runtime.dispatch(event.handlerId)

  selectedPath = selectedPath === event.handlerId ? null : event.handlerId
  return true
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

// ------------------------------------------------------------------ rendering

function buildTree(
  request: CompileRequest,
  analysis: Analysis,
  evaluation: EvaluationResult | null,
): RenderTree {
  const width = request.canvas.width
  const nodes: RenderNode[] = []
  const pad = 16
  const contentW = width - pad * 2
  let y = 75
  let z = 1

  const push = (node: RenderNode) => nodes.push(node)
  const text = (
    id: string,
    value: string,
    f: ResolvedFont,
    color: RGBA,
    x: number,
    w: number,
    origin?: SourceSpan,
  ): RenderNode => ({
    id,
    kind: 'text',
    frame: { x, y, width: w, height: f.lineHeight },
    z: z++,
    opacity: 1,
    text: { runs: [{ text: value, font: f, color }], alignment: 'leading' },
    a11y: { role: 'text', label: value },
    ...(origin ? { origin } : {}),
  })

  push({
    id: 'root',
    kind: 'layer',
    frame: { x: 0, y: 0, width, height: request.canvas.height },
    z: 0,
    opacity: 1,
    background: { kind: 'solid', color: BACKGROUND },
  })

  const errorCount = analysis.diagnostics.filter((d) => d.severity === 'error').length
  const warningCount = analysis.diagnostics.filter((d) => d.severity === 'warning').length
  const failure = evaluation?.failure ?? null
  const running = evaluation !== null && !failure

  push(text('outline-title', running ? 'Running' : 'Not running', TITLE, LABEL, pad, contentW))
  y += TITLE.lineHeight + 2

  const summary = failure
    ? failure.message
    : errorCount > 0
      ? `${errorCount} error${errorCount === 1 ? '' : 's'} — fix these to run`
      : warningCount > 0
        ? `${analysis.model.types.size} types · ${warningCount} coverage note${warningCount === 1 ? '' : 's'}`
        : `${analysis.model.types.size} types · no problems`

  push(
    text(
      'outline-summary',
      summary,
      CAPTION,
      failure || errorCount > 0 ? ERROR : warningCount > 0 ? WARNING : SECONDARY,
      pad,
      contentW,
    ),
  )
  y += CAPTION.lineHeight + 14

  const entry = analysis.model.entryPoint
  push(
    text(
      'outline-entry',
      entry ? `@main ${entry.name} → ${evaluation?.rootTypeName ?? '?'}` : 'No entry point',
      CAPTION,
      ACCENT,
      pad,
      contentW,
    ),
  )
  y += CAPTION.lineHeight + 8

  const rows: FlatView[] = evaluation ? flattenViews(evaluation.views) : []

  const cardTop = y
  const cardHeight = Math.max(ROW_HEIGHT, rows.length * ROW_HEIGHT) + 16
  push({
    id: 'outline-card',
    kind: 'layer',
    frame: { x: pad, y: cardTop, width: contentW, height: cardHeight },
    z: z++,
    opacity: 1,
    background: { kind: 'solid', color: CARD },
    cornerRadius: 10,
  })
  y = cardTop + 8

  if (rows.length === 0) {
    push(
      text(
        'outline-empty',
        failure
          ? 'Execution stopped.'
          : errorCount > 0
            ? 'Fix the errors to run.'
            : 'No views produced.',
        ROW_DETAIL,
        TERTIARY,
        pad + 10,
        contentW - 20,
      ),
    )
  }

  for (const { view, depth, path } of rows) {
    const x = pad + 10 + depth * INDENT
    const rowWidth = contentW - 20 - depth * INDENT
    const interactive = view.action !== null
    const id = `outline-row-${path}`

    if (selectedPath === path) {
      push({
        id: `${id}-highlight`,
        kind: 'layer',
        frame: { x: pad + 4, y: y - 2, width: contentW - 8, height: ROW_HEIGHT },
        z: z++,
        opacity: 1,
        background: { kind: 'solid', color: SELECTED },
        cornerRadius: 5,
      })
    }

    push({
      ...text(id, view.name, ROW, interactive ? ACTIONABLE : LABEL, x, rowWidth, view.span),
      // A button's row runs its actual Swift closure; every other row just selects.
      hitTarget: {
        handlerId: interactive ? actionId(path) : path,
        role: 'button',
        enabled: true,
      },
      a11y: {
        role: 'button',
        label: interactive ? `Run ${view.name} action` : `Select ${view.name}`,
      },
    })

    const detail = [
      view.args.length > 0
        ? `(${view.args.map((a) => (a.label ? `${a.label}: ${renderArg(a.value)}` : renderArg(a.value))).join(', ')})`
        : '',
      ...view.modifiers.map((m) => `.${m.name}`),
    ]
      .filter(Boolean)
      .join(' ')

    if (detail) {
      const nameWidth = view.name.length * 7.6 + 8
      push(text(`${id}-detail`, detail, ROW_DETAIL, TERTIARY, x + nameWidth, rowWidth - nameWidth))
    }

    y += ROW_HEIGHT
  }

  y = cardTop + cardHeight + 16

  push({
    id: 'phase-2-notice',
    kind: 'placeholder',
    frame: { x: pad, y, width: contentW, height: 76 },
    z: z++,
    opacity: 1,
    placeholder: {
      feature: 'Layout and drawing',
      reason: running
        ? 'Your code is running — these are real evaluated values. Tap a Button row to run its action. ' +
          'Phase 3 adds the layout engine and turns this into the actual interface.'
        : 'Phase 3 adds the layout engine and renderer.',
    },
  })

  return { canvas: { width, height: request.canvas.height }, nodes, revision: ++revision }
}

// -------------------------------------------------------------------- compile

function programKeyOf(request: CompileRequest): string {
  return request.files.map((f) => `${f.id} ${f.text}`).join('')
}

function toResult(
  request: CompileRequest,
  analysis: Analysis,
  evaluation: EvaluationResult | null,
  startedAt: number,
  evaluateMs: number,
): CompileResult {
  const layoutStart = performance.now()
  const renderTree = buildTree(request, analysis, evaluation)
  const layoutMs = performance.now() - layoutStart
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
    return toResult(request, analysis, null, startedAt, 0)
  }

  const evaluateStart = performance.now()
  runtime.load(analysis.files, analysis.model, programKeyOf(request))
  const evaluation = runtime.evaluate()
  const evaluateMs = performance.now() - evaluateStart

  return toResult(request, analysis, evaluation, startedAt, evaluateMs)
}

/** Re-renders after an interaction, without re-parsing unchanged source. */
export function rerender(revisionBump = 1): CompileResult {
  if (!lastAnalysis) throw new Error('rerender called before any compile')

  const { request, analysis } = lastAnalysis
  const next = { ...request, revision: request.revision + revisionBump }
  lastAnalysis = { request: next, analysis }

  const startedAt = performance.now()
  if (hasBlockingError(analysis.diagnostics)) return toResult(next, analysis, null, startedAt, 0)

  const evaluateStart = performance.now()
  const evaluation = runtime.evaluate()
  return toResult(next, analysis, evaluation, startedAt, performance.now() - evaluateStart)
}
