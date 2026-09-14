import {
  rgba,
  type CompileRequest,
  type CompileResult,
  type Diagnostic,
  type LogEntry,
  type RenderNode,
  type RenderTree,
  type ResolvedFont,
  type SourceSpan,
  type UIEvent,
} from '@studio/shared'
import { Parser, type SourceFileNode } from '@studio/swift-syntax'
import { Checker, type SemanticModel } from '@studio/swift-sema'
import { flattenOutline, outlineStatements, type OutlineNode } from './outline'

/**
 * The Phase 1 pipeline: parse -> check -> outline.
 *
 * The preview cannot draw the user's views yet — that needs the interpreter
 * (Phase 2) and the layout engine (Phase 3). What it *can* do honestly is show what
 * the front end actually understood: the declarations it found, the entry point it
 * resolved, and the shape of the view tree it parsed, updating on every keystroke.
 *
 * Showing a fixed demo instead would be a more impressive screenshot and a lie. The
 * outline is real output derived from real source, which is both more useful and the
 * thing that proves the phase works.
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
const BACKGROUND = rgba(246, 246, 249, 1)
const CARD = rgba(255, 255, 255, 1)
const SELECTED = rgba(0, 122, 255, 0.12)
const ERROR = rgba(200, 30, 30, 1)
const WARNING = rgba(170, 90, 0, 1)

const ROW_HEIGHT = 22
const INDENT = 14

/** Selection is the only mutable state this phase has; it proves the event round-trip. */
let selectedNodeId: string | null = null
let revision = 0

export function resetPipelineState(): void {
  selectedNodeId = null
}

export function applyEvent(event: UIEvent): void {
  if (event.kind !== 'tap') return
  selectedNodeId = selectedNodeId === event.handlerId ? null : event.handlerId
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

/**
 * Finds the view whose structure is worth showing: the entry point's `body` leads to
 * a `WindowGroup { ... }` containing the root view, so follow that one hop to land on
 * what the user actually composes.
 */
function rootViewOutline(model: SemanticModel): { title: string; nodes: OutlineNode[] } {
  const entry = model.entryPoint
  if (!entry) {
    const firstView = [...model.types.values()].find((t) => t.isView)
    if (!firstView) return { title: 'No views found', nodes: [] }
    return { title: firstView.name, nodes: bodyOutline(firstView.name, model) }
  }

  // Entry `body` is a Scene; its trailing closure holds the root view.
  const sceneNodes = bodyOutline(entry.name, model)
  const windowGroup = sceneNodes.find((n) => n.name === 'WindowGroup') ?? sceneNodes[0]
  const rootName = windowGroup?.children[0]?.name

  if (rootName && model.types.has(rootName)) {
    return { title: rootName, nodes: bodyOutline(rootName, model) }
  }
  return { title: entry.name, nodes: sceneNodes }
}

function bodyOutline(typeName: string, model: SemanticModel): OutlineNode[] {
  const type = model.types.get(typeName)
  const body = type?.properties.find((p) => p.name === 'body')
  if (!body?.decl.accessor) return []
  return outlineStatements(body.decl.accessor.statements)
}

function buildTree(request: CompileRequest, analysis: Analysis): RenderTree {
  const { model, diagnostics } = analysis
  const width = request.canvas.width
  const nodes: RenderNode[] = []
  const pad = 16
  const contentW = width - pad * 2
  let y = 75
  let z = 1

  const push = (node: RenderNode) => nodes.push(node)

  push({
    id: 'root',
    kind: 'layer',
    frame: { x: 0, y: 0, width, height: request.canvas.height },
    z: 0,
    opacity: 1,
    background: { kind: 'solid', color: BACKGROUND },
  })

  const text = (
    id: string,
    value: string,
    f: ResolvedFont,
    color: typeof LABEL,
    x: number,
    width: number,
    origin?: SourceSpan,
  ): RenderNode => ({
    id,
    kind: 'text',
    frame: { x, y, width, height: f.lineHeight },
    z: z++,
    opacity: 1,
    text: { runs: [{ text: value, font: f, color }], alignment: 'leading' },
    a11y: { role: 'text', label: value },
    ...(origin ? { origin } : {}),
  })

  push(text('outline-title', 'Parsed structure', TITLE, LABEL, pad, contentW))
  y += TITLE.lineHeight + 2

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length
  const summary =
    errorCount > 0
      ? `${errorCount} error${errorCount === 1 ? '' : 's'} — outline may be incomplete`
      : warningCount > 0
        ? `${model.types.size} type${model.types.size === 1 ? '' : 's'} · ${warningCount} coverage note${warningCount === 1 ? '' : 's'}`
        : `${model.types.size} type${model.types.size === 1 ? '' : 's'} · no problems`

  push(
    text(
      'outline-summary',
      summary,
      CAPTION,
      errorCount > 0 ? ERROR : warningCount > 0 ? WARNING : SECONDARY,
      pad,
      contentW,
    ),
  )
  y += CAPTION.lineHeight + 14

  const { title, nodes: outline } = rootViewOutline(model)
  const rows = flattenOutline(outline)

  push(
    text(
      'outline-entry',
      model.entryPoint ? `@main ${model.entryPoint.name} → ${title}` : title,
      CAPTION,
      ACCENT,
      pad,
      contentW,
    ),
  )
  y += CAPTION.lineHeight + 8

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
        errorCount > 0 ? 'Fix the errors to see the structure.' : 'No view body found.',
        ROW_DETAIL,
        TERTIARY,
        pad + 10,
        contentW - 20,
      ),
    )
  }

  rows.forEach(({ node, depth }, index) => {
    const id = `outline-row-${index}`
    const x = pad + 10 + depth * INDENT
    const rowWidth = contentW - 20 - depth * INDENT

    if (selectedNodeId === id) {
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
      ...text(id, node.name, ROW, LABEL, x, rowWidth, node.span),
      hitTarget: { handlerId: id, role: 'button', enabled: true },
      a11y: { role: 'button', label: `${node.name}${node.detail ? ` ${node.detail}` : ''}` },
    })

    const suffix = [node.detail, ...node.modifiers.map((m) => `.${m}`)].filter(Boolean).join(' ')
    if (suffix) {
      const nameWidth = node.name.length * 7.6 + 8
      push(text(`${id}-detail`, suffix, ROW_DETAIL, TERTIARY, x + nameWidth, rowWidth - nameWidth))
    }

    y += ROW_HEIGHT
  })

  y = cardTop + cardHeight + 16

  push({
    id: 'phase-1-notice',
    kind: 'placeholder',
    frame: { x: pad, y, width: contentW, height: 76 },
    z: z++,
    opacity: 1,
    placeholder: {
      feature: 'View rendering',
      reason:
        'Phase 1 parses and checks your Swift. Evaluating it (Phase 2) and laying it out (Phase 3) ' +
        'come next — then this panel becomes the real app. Tap a row to select it.',
    },
  })

  return { canvas: { width, height: request.canvas.height }, nodes, revision: ++revision }
}

export function compile(request: CompileRequest): CompileResult {
  const started = performance.now()
  const analysis = analyse(request)

  const layoutStart = performance.now()
  const renderTree = buildTree(request, analysis)
  const layoutMs = performance.now() - layoutStart

  const total = performance.now() - started
  const logs: LogEntry[] = [
    {
      level: 'log',
      message:
        `Parsed ${request.files.length} file(s): ${analysis.model.types.size} type(s), ` +
        `${analysis.diagnostics.length} diagnostic(s) in ${total.toFixed(1)}ms`,
      at: total,
    },
  ]

  return {
    revision: request.revision,
    diagnostics: analysis.diagnostics,
    renderTree,
    logs,
    timings: {
      parse: analysis.parseMs,
      check: analysis.checkMs,
      evaluate: 0,
      layout: layoutMs,
      total,
    },
  }
}
