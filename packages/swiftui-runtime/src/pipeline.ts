import { SURFACES } from './appearance/surfaces'
import { primaryScroll, scrollInsets } from './containers/screen'
import type { ScreenLayout } from './to-layout'
import {
  APPEARANCE_CALIBRATION,
  bindAuthoringRuntime,
  hasBlockingError,
  rgba,
  type CompileRequest,
  type AuthoringSnapshot,
  type CompileResult,
  type Diagnostic,
  type LogEntry,
  type MeasuredTextData,
  type PagePreview,
  type Rect,
  type RenderNode,
  type RenderTree,
  type UIEvent,
} from '@studio/shared'
import { Parser, type SourceFileNode } from '@studio/swift-syntax'
import { buildAuthoringModel, scenarioFiles, Checker, lintStrictness, type SemanticModel } from '@studio/swift-sema'
import {
  CENTER,
  FontMetricsTable,
  LayoutEngine,
  type LayoutElement,
  type LayoutEnvironment,
  type MeasuredFont,
  type RunMeasurer,
  type PlacedNode,
} from '@studio/swiftui-layout'
import { AppRuntime, type EvaluationResult } from './app-runtime'
import type { EnvironmentInputs } from './view-environment'
import { bodyFont, colorForName, labelColor, setAssetColors, systemBackground } from './style'
import { appendPlaced, placedToRenderTree } from './to-render'
import { screenToLayout, NAV_BAR_HEIGHT, TAB_BAR_HEIGHT, viewsToLayout } from './to-layout'
import type { NotDrawn, OverlayKind } from './presentation'
import type { GeometryPayload } from './view-value'

/**
 * The pipeline: parse -> check -> evaluate -> **compose** -> lay out -> render.
 *
 * Phase 6 adds the composition step. A screen is no longer just the user's content:
 * it is the content *plus* whatever the framework puts around and over it - a
 * navigation bar, a tab bar, a sheet. Each of those is positioned against the device
 * rather than against the content, so each gets its own layout pass against its own
 * rect, and the results are concatenated in paint order.
 *
 * When the program cannot run - parse errors, or a runtime trap - the last good tree
 * keeps being shown by the *renderer*, dimmed (FR-6.3). This module simply reports
 * `renderTree: null` and lets the UI decide, rather than blanking the screen.
 */

const runtime = new AppRuntime()

/** Replaced once the main thread measures the real fonts. */
let metrics = new FontMetricsTable()
let fontGeneration = 0
let revision = 0
let lastEvaluation: EvaluationResult | null = null
let lastAnalysis: { request: CompileRequest; analysis: Analysis } | null = null

/** z ranges, so bars always paint over content and presentations over everything. */
const BAR_Z = 100_000
const OVERLAY_Z = 200_000

export function setFontMetrics(fonts: readonly MeasuredFont[], measurer?: RunMeasurer, collectRequests = false): void {
  fontGeneration++
  metrics = new FontMetricsTable(fonts, measurer, collectRequests)
}

/** Font-only refinement reuses the evaluated view and preserves live state. */
export function relayout(revision: number): CompileResult {
  if (!lastAnalysis || !lastEvaluation) return rerender(revision)
  const { analysis, request } = lastAnalysis
  const next = { ...request, revision }
  lastAnalysis = { analysis, request: next }
  if (hasBlockingError(analysis.diagnostics)) return toResult(next, analysis, null, null, performance.now(), 0, 0)
  return finish(next, analysis, lastEvaluation, performance.now(), 0)
}

/**
 * Turns the page gallery on, and redraws with it.
 *
 * The flag lives on the last request so every later re-render carries it too - a
 * tap while the gallery is open must come back as a gallery, not as one phone.
 */
export function setAllPages(enabled: boolean, revision: number): CompileResult | null {
  if (!lastAnalysis) return null
  lastAnalysis = { ...lastAnalysis, request: { ...lastAnalysis.request, allPages: enabled } }
  return rerender(revision)
}

export function setTextMeasurements(data: readonly MeasuredTextData[], revision: number, generation = fontGeneration): CompileResult | null {
  if (generation !== fontGeneration || lastAnalysis?.request.revision !== revision) return null
  metrics.setRuns(data)
  return relayout(revision)
}

export function resetPipelineState(): void {
  runtime.reset()
  lastEvaluation = null
}

/** Returns true when the event changed something and a re-render is warranted. */
export function applyEvent(event: UIEvent): boolean {
  return runtime.dispatch(event)
}

interface Analysis {
  readonly authoring: AuthoringSnapshot
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
  const authoring = buildAuthoringModel({ deploymentTarget: request.deploymentTarget, componentDescriptions: request.componentDescriptions, colors: request.colors, files: request.files, parsed: files, diagnostics: [...diagnostics, ...model.diagnostics], projectId: request.projectId ?? '', revision: request.revision })
  const checkMs = performance.now() - checkStart

  return {
    authoring,
    files,
    model,
    diagnostics: [...diagnostics, ...model.diagnostics, ...strict],
    parseMs,
    checkMs,
  }
}

function rootEnvironment(request: CompileRequest): LayoutEnvironment {
  return {
    displayScale: request.displayScale ?? 3,
    font: bodyFont(request.dynamicTypeSize ?? request.typeScale ?? 1),
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
function render(request: CompileRequest, evaluation: EvaluationResult, accumulate = false, drawingRuntime = runtime): RenderTree {
  setAssetColors(request.colors)
  // The gallery lays out several trees in one pass, and every one of them has text
  // to measure. Only the first clears the pending set: clearing it per tree would
  // hand back the last page's requests and leave every other tree's strings on the
  // built-in estimates for as long as nothing else asked.
  if (!accumulate) metrics.beginLayout()
  const engine = new LayoutEngine(metrics)
  // `withAnimation { … }` animates every change in its transaction, so the hint goes
  // on the root environment and every node below inherits it for exactly one frame.
  const env = withAnimation(rootEnvironment(request), evaluation)
  const scheme = request.colorScheme
  const canvas = request.canvas
  const safeArea = request.safeArea ?? { top: 0, leading: 0, bottom: 0, trailing: 0 }

  const ui = evaluation.ui
  // The layout pass runs `.alignmentGuide` closures, which needs the interpreter -
  // handed in as a function so `swiftui-layout` stays free of any knowledge of one.
  const callGuide = drawingRuntime.guideRunner()
  const screen = ui
    ? screenToLayout(ui, {
        colorScheme: scheme,
        images: request.images,
        previewTarget: request.previewTarget,
        typeScale: request.typeScale ?? 1,
        dynamicTypeSize: request.dynamicTypeSize,
        displayScale: request.displayScale,
        safeArea,
        viewportWidth: canvas.width,
        callGuide,
      })
    : {
        content: viewsToLayout(evaluation.views, {
          colorScheme: scheme,
        images: request.images,
        previewTarget: request.previewTarget,
          typeScale: request.typeScale ?? 1,
        dynamicTypeSize: request.dynamicTypeSize,
        displayScale: request.displayScale,
          callGuide,
        }).element,
        background: systemBackground(scheme),
        navigationBar: null,
        tabBar: null,
        overlay: null,
        hitTargets: new Map<string, string>(),
      }

  return { ...composeScreen(engine, screen, canvas, safeArea, env), colorScheme: scheme, calibration: APPEARANCE_CALIBRATION.status }
}

function composeScreen(engine: LayoutEngine, screen: ScreenLayout, canvas: { width: number; height: number }, safeArea: { top: number; leading: number; bottom: number; trailing: number }, env: LayoutEnvironment): RenderTree {
  const barHeight = screen.navigationBar?.height ?? 0
  const tabHeight = screen.tabBar ? TAB_BAR_HEIGHT : 0
  const regular = canvas.width >= 600
  const topTabs = regular ? tabHeight : 0
  const bottomTabs = regular ? 0 : tabHeight
  const bottomSearch = screen.search?.placement === 'bottom' ? screen.search.height : 0
  const topSearch = screen.search?.placement === 'top' ? screen.search.height : 0
  // The bars at the bottom stop short of the screen's edge, over the home indicator.
  const bottomBarsEnd = canvas.height - Math.max(0, safeArea.bottom - SURFACES.tab.safeAreaOverlap)
  const scroll = primaryScroll(screen.content)
  const collapseDistance = scroll && screen.navigationBar?.large ? Math.max(0, barHeight - NAV_BAR_HEIGHT) : 0
  const content = scroll ? scrollInsets(screen.content, { top: collapseDistance, leading: 0, bottom: bottomTabs + bottomSearch + safeArea.bottom, trailing: 0 }) : screen.content
  const contentBounds: Rect = {
    x: safeArea.leading, y: safeArea.top + topTabs + topSearch + barHeight - collapseDistance,
    width: canvas.width - safeArea.leading - safeArea.trailing,
    height: Math.max(0, canvas.height - safeArea.top - topTabs - topSearch - barHeight + collapseDistance - (scroll ? 0 : safeArea.bottom + bottomTabs + bottomSearch)),
  }
  // A view reaches out of the safe area on its own, where it touches an edge, and
  // `.ignoresSafeArea()` on one view no longer makes the whole screen full-bleed.
  const screenRect: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height }
  const placed = engine.layout(content, contentBounds, { ...env, safeArea: { inner: contentBounds, outer: screenRect } }, CENTER)
  let tree = placedToRenderTree(placed, canvas, ++revision, screen.background)
  // At rest the bar has no colour of its own in iOS 27, so what reaches under it shows
  // through. Where nothing does, it keeps the screen's colour, which looks the same.
  // A collapsing title keeps its surface for when the content scrolls beneath it, in
  // the colour of what is under it.
  const underBar = tree.nodes
    .filter((node) => !node.parent && node.id !== 'screen' && node.frame.y < contentBounds.y - 0.5)
    .sort((a, b) => b.z - a.z)
  const beneath = underBar.find((node) => node.background?.kind === 'solid')?.background
  if (screen.navigationBar) {
    const laidOut = engine.layout(screen.navigationBar.element, { x: 0, y: topTabs, width: canvas.width, height: safeArea.top + barHeight }, env, CENTER)
    const bar = !underBar.length ? laidOut
      : collapseDistance && beneath ? laidOut.map((node) => node.id === 'navbar-bgf' && node.paint.kind === 'fill' ? { ...node, paint: { ...node.paint, fill: beneath } } : node)
      : laidOut.filter((node) => node.id !== 'navbar-bgf')
    tree = appendPlaced(tree, bar, BAR_Z)
    tree = { ...tree, nodes: tree.nodes.map(node => {
      if (node.id === 'navbar-title') return { ...node, ...(collapseDistance ? { chromeRole: 'inlineTitle' as const } : {}), opacity: screen.navigationBar!.large ? 0 : node.opacity }
      if (collapseDistance && node.id === 'navbar-large-title') return { ...node, chromeRole: 'largeTitle' as const }
      if (collapseDistance && node.id === 'navbar-bgf') return { ...node, chromeRole: 'navigationSurface' as const }
      return node
    }) }
  }
  if (screen.tabBar) {
    const bar = engine.layout(screen.tabBar, { x: 0, y: regular ? safeArea.top : bottomBarsEnd - tabHeight, width: canvas.width, height: tabHeight }, env, CENTER)
    tree = appendPlaced(tree, bar, BAR_Z + 1000)
  }
  if (screen.search) {
    // At the bottom it sits where a tab bar would.
    const search = engine.layout(screen.search.element, { x: 0, y: bottomSearch ? bottomBarsEnd - bottomTabs - bottomSearch : safeArea.top + topTabs + barHeight, width: canvas.width, height: screen.search.height }, env, CENTER)
    tree = appendPlaced(tree, search, BAR_Z + 2000)
  }
  if (screen.overlay) tree = { ...tree, nodes: [...tree.nodes.map(n => n.parent || allowsBackgroundInteraction(screen.overlay!, canvas, safeArea) ? n : { ...n, inert: true }), ...presentOverlay(engine, screen.overlay, canvas, safeArea, env).map(n => ({ ...n, z: n.z + OVERLAY_Z }))] }
  return { ...tree, ...(scroll && collapseDistance ? { chrome: { scrollId: scroll.id, collapseDistance } } : {}) }
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
): RenderNode[] {
  const nodes: PlacedNode[] = []
  const interactiveBackground = allowsBackgroundInteraction(overlay, canvas, safeArea)

  // Everything behind a presentation dims, and tapping the dimmed area dismisses it
  // - which is the only affordance a preview can offer in place of a swipe.
  if (!interactiveBackground) nodes.push({
    id: 'overlay-dim',
    frame: { x: 0, y: 0, width: canvas.width, height: canvas.height },
    z: 0,
    opacity: 1,
    cornerRadius: 0,
    paint: { kind: 'fill', fill: { kind: 'solid', color: rgba(0, 0, 0, overlay.kind === 'dialog' || overlay.kind === 'menu' ? 0 : 0.2) } },
    ...(overlay.dismissId
      ? {
          hitTarget: {
            handlerId: overlay.dismissId,
            label: dismissLabel(overlay.kind),
            role: 'button' as const,
            enabled: true,
          },
        }
      : {}),
  })

  const rect = overlayRect(overlay, canvas, safeArea)
  const dimNodes = placedToRenderTree(nodes, canvas, 0).nodes.slice(1).map(n => ({ ...n, blocksPointer: true }))
  if (overlay.screen) {
    const sheet = overlay.kind === 'sheet' || overlay.kind === 'popover'
    const top = sheet ? (overlay.showsDragIndicator !== false ? 10 : 12) : safeArea.top
    const bottom = overlay.kind === 'cover' ? safeArea.bottom : Math.max(12, safeArea.bottom - SURFACES.sheet.margin)
    const nested = composeScreen(engine, overlay.screen, { width: rect.width, height: rect.height }, { top, leading: 0, trailing: 0, bottom }, env)
    const prefix = 'overlay/'
    const radius = sheet ? overlay.cornerRadius ?? SURFACES.sheet.radius : 0
    const surface: RenderNode = { id: 'overlay-surface', kind: 'layer', frame: rect, z: 1, opacity: 1, blocksPointer: true, ...(overlay.background ? { background: overlay.background } : overlay.material ? { material: overlay.material } : sheet ? { material: { opacity: 0.5, blur: 28, light: overlay.light } } : {}), clip: true, border: { width: 0.5, color: { ...env.foregroundColor, a: 0.2 }, cornerRadius: radius }, cornerRadius: radius, cornerStyle: 'continuous',
      ...(nested.chrome ? { chrome: { ...nested.chrome, scrollId: prefix + nested.chrome.scrollId } } : {}) }
    const content = nested.nodes.map(n => ({ ...n, id: prefix + n.id, parent: n.parent ? prefix + n.parent : surface.id, z: n.z + 2 }))
    const grabber: RenderNode[] = sheet && overlay.showsDragIndicator !== false ? [{ id: 'overlay-grabber', kind: 'shape', frame: { x: (rect.width - SURFACES.sheet.grabberWidth) / 2, y: 6, width: SURFACES.sheet.grabberWidth, height: SURFACES.sheet.grabberHeight }, z: OVERLAY_Z - 1, opacity: 0.4, parent: surface.id, shape: { shape: 'capsule', fill: { kind: 'solid', color: env.foregroundColor } } }] : []
    return [...dimNodes, surface, ...content, ...grabber]
  }
  const surface = engine.layout(
    overlay.element,
    rect,
    { ...env, cornerRadius: overlay.kind === 'sheet' ? overlay.cornerRadius ?? SURFACES.sheet.radius : overlay.kind === 'cover' ? 0 : SURFACES.alert.radius },
    overlay.kind === 'alert'
      ? CENTER
      : overlay.kind === 'dialog' ? { horizontal: 'center', vertical: 'top' } : overlay.kind === 'menu'
        ? { horizontal: 'center', vertical: 'bottom' }
        : { horizontal: 'leading', vertical: 'top' },
  )

  // The dim layer is z 0 here; the surface must sit above it.
  for (const node of surface) nodes.push({ ...node, z: node.z + 1 })

  const painted = placedToRenderTree(nodes, canvas, 0).nodes.slice(interactiveBackground ? 1 : 2)
  if (overlay.kind === 'menu' || overlay.kind === 'dialog') {
    // A single local panel can be anchored after browser scroll offsets are known.
    const roots = painted.filter(n => !n.parent)
    const x = Math.min(...roots.map(n => n.frame.x)), y = Math.min(...roots.map(n => n.frame.y))
    const width = Math.max(...roots.map(n => n.frame.x + n.frame.width)) - x
    const height = Math.max(...roots.map(n => n.frame.y + n.frame.height)) - y
    const panel: RenderNode = { id: 'overlay-menu', kind: 'layer', frame: { x, y, width, height }, z: 1, opacity: 1, anchorId: overlay.anchorId }
    const arrow: RenderNode[] = overlay.kind === 'dialog' ? [{ id: 'overlay-dialog-arrow', kind: 'path',
      parent: panel.id, frame: { x: width / 2 - 14, y: height - 0.5, width: 28, height: 14 }, z: 2, opacity: 1,
      path: { d: 'M 0 0 L 11 11 Q 14 14 17 11 L 28 0', fill: { kind: 'solid', color: overlay.light ? rgba(250, 250, 252) : rgba(38, 38, 40) }, fillRule: 'nonzero' },
    }] : []
    return [...dimNodes, panel, ...painted.map(n => n.parent ? n : { ...n, parent: panel.id, frame: { ...n.frame, x: n.frame.x - x, y: n.frame.y - y } }), ...arrow]
  }
  return [...dimNodes, ...painted]
}

/**
 * What the dimmed backdrop is called.
 *
 * Named for *what it closes* rather than "Dismiss", which is the word a user's own
 * button most often carries - `.sheet { Button("Dismiss") { … } }` is in this repo's
 * own end-to-end fixture. Two controls answering to one name is ambiguous for anyone
 * driving the preview by name, whether that is a screen reader or a test, and the
 * backdrop is the one of the two that can be named unilaterally.
 *
 * iOS does not expose this backdrop to VoiceOver at all - it has a swipe instead, and
 * the preview does not. So it stays reachable and says which thing it puts away.
 */
function dismissLabel(kind: OverlayKind): string {
  switch (kind) {
    case 'sheet':
      return 'Close sheet'
    case 'cover':
      return 'Close screen'
    case 'alert':
      return 'Close alert'
    case 'dialog':
      return 'Close options'
    case 'menu':
      return 'Close menu'
    default:
      return 'Close popover'
  }
}

function allowsBackgroundInteraction(
  overlay: NonNullable<ReturnType<typeof screenToLayout>['overlay']>,
  canvas: { width: number; height: number },
  safeArea: { top: number; leading: number; bottom: number; trailing: number },
): boolean {
  if (!['sheet', 'popover'].includes(overlay.kind) || overlay.backgroundInteraction === undefined) return false
  if (overlay.backgroundInteraction === Infinity) return true
  const threshold = overlayRect({ ...overlay, detent: overlay.backgroundInteraction, detents: undefined }, canvas, safeArea)
  return overlayRect(overlay, canvas, safeArea).height <= threshold.height + 0.5
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
    const width = Math.min(SURFACES.alert.width, canvas.width - SURFACES.alert.margin * 2)
    return { x: (canvas.width - width) / 2, y: safeArea.top, width, height: canvas.height - safeArea.top - safeArea.bottom }
  }

  if (overlay.kind === 'menu') {
    const width = Math.min(SURFACES.menu.width, canvas.width - SURFACES.menu.margin * 2)
    return { x: canvas.width - width - SURFACES.menu.margin, y: safeArea.top, width, height: canvas.height - safeArea.top - safeArea.bottom - SURFACES.menu.margin }
  }

  if (overlay.kind === 'dialog') {
    const width = Math.min(240, canvas.width - 32)
    return { x: (canvas.width - width) / 2, y: safeArea.top, width, height: canvas.height - safeArea.top - safeArea.bottom - 8 }
  }

  const margin = SURFACES.sheet.margin
  const available = Math.max(0, canvas.height - safeArea.top - SURFACES.sheet.top - margin)
  const detentHeight = (value: number) => Math.min(available, value < 0 ? -value + Math.max(0, safeArea.bottom - margin) : (canvas.height - safeArea.bottom) * value + safeArea.bottom)
  const height = Math.min(...(overlay.detents?.length ? overlay.detents : [overlay.detent]).map(detentHeight))
  const width = Math.min(SURFACES.sheet.maxWidth, canvas.width - margin * 2)
  return { x: (canvas.width - width) / 2, y: canvas.width >= 600 ? (canvas.height - height) / 2 : canvas.height - height - margin, width, height }

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

/**
 * A warning for what the preview left out around a screen's containers, pointing at
 * where it is written. A floating button in a `ZStack` beside a NavigationStack
 * would otherwise vanish with nothing to say why.
 */
function notDrawnWarning(item: NotDrawn): Diagnostic {
  return item.modifier
    ? {
        span: item.span,
        severity: 'warning',
        code: 'unsupported_swiftui_modifier',
        feature: `.${item.modifier} on ${item.container}`,
        message: `The preview doesn't draw .${item.modifier} written on the ${item.container}. It still appears in the app.`,
      }
    : {
        span: item.span,
        severity: 'warning',
        code: 'unsupported_swiftui_view',
        feature: `views beside ${item.container}`,
        message: `The preview doesn't show views beside the ${item.container}, only what is inside it. This one still appears in the app.`,
      }
}

function toResult(
  request: CompileRequest,
  analysis: Analysis,
  evaluation: EvaluationResult | null,
  renderTree: RenderTree | null,
  startedAt: number,
  evaluateMs: number,
  layoutMs: number,
  pages?: readonly PagePreview[],
): CompileResult {
  const total = performance.now() - startedAt

  const logs: LogEntry[] = (evaluation?.logs ?? []).map((entry) => ({
    level: entry.level,
    message: entry.message,
    origin: entry.span,
    at: total,
  }))

  // A sheet can be resolved more than once in a pass, so each place is said once.
  const notDrawn = [...new Map((evaluation?.ui?.notDrawn ?? []).map((item) => [`${item.span.file}:${item.span.start}:${item.span.end}`, item])).values()]
  const diagnostics = [...analysis.diagnostics, ...notDrawn.map(notDrawnWarning)]
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

  const authoring = bindAuthoringRuntime(analysis.authoring, evaluation?.failure ? [] : [
    ...(evaluation?.ui?.viewHierarchy ?? []),
    ...(pages ?? []).flatMap(page => page.viewHierarchy ?? []),
  ], request.revision)
  return {
    revision: request.revision,
    authoring: { ...authoring, nodes: authoring.nodes.map(node => ({ ...node, runtimeIds: [...new Set(node.runtimeIds)] })) },
    diagnostics,
    renderTree,
    viewHierarchy: evaluation?.failure ? [] : evaluation?.ui?.viewHierarchy ?? [],
    ...(pages ? { pages } : {}),
    logs,
    textMeasurement: renderTree && !evaluation?.failure ? { ...metrics.measurementState, generation: fontGeneration } : undefined,
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
  setAssetColors(request.colors)
  if (lastAnalysis?.request.projectId !== request.projectId || JSON.stringify(lastAnalysis?.request.scenario) !== JSON.stringify(request.scenario)) {
    runtime.reset(false)
    lastEvaluation = null
  }
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
  let evaluationFiles = analysis.files
  try { evaluationFiles = scenarioFiles({ files: request.files, ast: analysis.files, nodes: analysis.authoring.nodes }, analysis.authoring, request.scenario) }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid preview scenario.'
    const diagnostic: Diagnostic = { severity: 'error', code: 'invalid_preview_scenario', message, span: { file: request.files[0]?.id ?? '', start: 0, end: 0 } }
    const failed = { ...analysis, diagnostics: [...analysis.diagnostics, diagnostic] }
    lastAnalysis = { request, analysis: failed }; lastEvaluation = null; runtime.reset(false)
    return toResult(request, failed, null, noticeTree(request, 'Preview scenario needs updating', message), startedAt, 0, 0)
  }
  runtime.load(evaluationFiles, analysis.model, programKeyOf(request), request.previewScreen)
  runtime.setEnvironment(environmentFor(request))
  runtime.setDefaultGeometry(contentSizeOf(request))

  let evaluation = runtime.evaluate()

  // `.onAppear` usually sets the state the view is about to draw from, so the pass
  // that *discovered* the callback is not the pass worth showing. One more is enough:
  // a second appearance of the same path is not an appearance.
  if (evaluation.ui && runtime.runLifecycle(evaluation.ui.lifecycle)) {
    evaluation = runtime.evaluate()
  }

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
  let evaluation = runtime.evaluate()

  if (evaluation.ui && runtime.runLifecycle(evaluation.ui.lifecycle)) {
    evaluation = runtime.evaluate()
  }

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

  lastEvaluation = evaluation
  const layoutStart = performance.now()
  let renderTree = render(request, evaluation)

  // A `GeometryReader` has to report a size before layout has decided one, so the
  // first pass uses the size it had last time. If that was wrong, the sizes are now
  // known and one more pass fixes it. Bounded at one retry: a reader is greedy, so
  // its size does not depend on what its closure produced and the second pass is
  // always right.
  if (runtime.updateGeometry(geometryFrom(renderTree))) {
    const corrected = runtime.evaluate()
    if (corrected.failure) return finish(request, analysis, corrected, startedAt, evaluateMs)
    if (!corrected.failure) {
      evaluation = corrected
      renderTree = render(request, corrected)
    }
  }

  const layoutMs = performance.now() - layoutStart
  const invalid = renderTree.nodes.find((node) => !Object.values(node.frame).every(Number.isFinite) || node.frame.width < 0 || node.frame.height < 0)
  if (invalid) {
    lastEvaluation = null
    const message = 'The preview produced an invalid layout size. Check frame, font, spacing, and geometry values.'
    return toResult(request, analysis, { ...evaluation, failure: { kind: 'trap', message, span: invalid.origin ?? { file: request.files[0]?.id ?? '', start: 0, end: 0 }, frames: [] } }, noticeTree(request, 'Layout stopped', message), startedAt, evaluateMs, layoutMs)
  }
  lastEvaluation = evaluation

  // After the geometry retry, so a reader in a page the device is not showing
  // cannot report a size back into the live one.
  const pages = request.allPages ? renderPages(request, evaluation, renderTree) : undefined

  return toResult(request, analysis, evaluation, renderTree, startedAt, evaluateMs, performance.now() - layoutStart, pages)
}

/**
 * How many pages the gallery will draw.
 *
 * A `TabView` over a `ForEach` can have as many tabs as the collection has elements,
 * and each one here is a full composition and layout. Twelve is past any tab bar a
 * phone would draw and still cheap; beyond it the caller is told the count it asked
 * about, so the studio can say what it is not showing rather than quietly dropping it.
 */
const GALLERY_LIMIT = 12

/**
 * Every page, drawn on its own.
 *
 * The live root tree is reused when it is still on its main screen. A pushed or
 * presented live screen keeps running separately while the design gallery shows
 * its main page and related screens as independent phones.
 */
function renderPages(
  request: CompileRequest,
  evaluation: EvaluationResult,
  active: RenderTree,
): readonly PagePreview[] | undefined {
  const pages = (evaluation.ui?.viewHierarchy ?? []).filter((layer) => layer.type === 'Page')
  if (!pages.length) return undefined

  const out: PagePreview[] = []
  const limit = Number.isFinite(request.galleryLimit) ? Math.max(1, Math.min(128, Math.floor(request.galleryLimit!))) : GALLERY_LIMIT
  const preview = runtime.previewRuntime()
  let remainingChildren = limit
  for (const [index, page] of pages.slice(0, limit).entries()) {
    const isActive = page.page?.active === true
    const ui = preview?.runtime.resolvePage(preview.evaluation.views, index, true)
      ?? (isActive ? evaluation.ui : runtime.resolvePage(evaluation.views, index))
    if (!ui) continue
    const isLiveRoot = isActive && !evaluation.ui?.navigationBar?.canGoBack && !evaluation.ui?.overlay
    const tree = isLiveRoot ? active : render(request, { ...evaluation, ui }, true, preview?.runtime)
    out.push({
      id: page.id,
      rootId: page.id,
      kind: 'root',
      name: page.name,
      active: isActive,
      ...(page.source ? { source: page.source } : {}),
      ...(page.page?.handlerId ? { handlerId: page.page.handlerId } : {}),
      ...(page.page?.icon ? { icon: page.page.icon } : {}),
      viewHierarchy: ui.viewHierarchy?.filter(layer => layer.id === page.id) ?? [page],
      tree,
    })
    if (!preview || !remainingChildren) continue
    const nested = preview.runtime.resolveNestedPages(preview.evaluation.views, index, page.id, remainingChildren)
    for (const child of nested) {
      if (!out.some(parent => parent.id === child.parentId)) continue
      let childTree: RenderTree
      try {
        childTree = render(request, { ...preview.evaluation, ui: child.ui }, true, preview.runtime)
        if (childTree.nodes.some(node => !Object.values(node.frame).every(Number.isFinite) || node.frame.width < 0 || node.frame.height < 0)) continue
      } catch { continue }
      out.push({
        id: child.id, parentId: child.parentId, rootId: child.rootId,
        kind: child.kind, name: child.name, source: child.source, active: false,
        viewHierarchy: child.ui.viewHierarchy?.map(layer => ({ ...layer, id: child.id })),
        tree: childTree,
      })
    }
    remainingChildren -= nested.length
  }
  const renamedIds = new Map<string, string>()
  for (const screen of (request.designScreens ?? []).slice(0, limit)) {
    const definition = lastAnalysis?.analysis.authoring.nodes.find(n => n.kind === 'definition' && n.name === screen.view)
    if (!definition) continue
    const existingIndex = out.findIndex(page => page.viewHierarchy?.[0]?.children[0]?.componentSources?.at(-1)?.name === screen.view)
    if (existingIndex >= 0) {
      const page = out[existingIndex]!, id = 'screen:' + screen.view
      renamedIds.set(page.id, id)
      out[existingIndex] = { ...page, id, name: screen.name, viewHierarchy: page.viewHierarchy?.map(layer => ({ ...layer, id, name: screen.name })) }
      continue
    }
    const detached = runtime.previewRuntime(screen.view)
    if (!detached?.evaluation.ui) continue
    const id = 'screen:' + screen.view
    try {
      const tree = render(request, detached.evaluation, true, detached.runtime)
      if (tree.nodes.some(n => !Object.values(n.frame).every(Number.isFinite))) continue
      out.push({ id, rootId: id, kind: 'root', standalone: true, name: screen.name, active: false, source: definition.source,
        viewHierarchy: detached.evaluation.ui.viewHierarchy?.map(layer => ({ ...layer, id })), tree })
    } catch { /* A failed standalone screen does not invalidate the running app. */ }
  }
  return out.map(page => ({ ...page, rootId: renamedIds.get(page.rootId ?? '') ?? page.rootId, parentId: renamedIds.get(page.parentId ?? '') ?? page.parentId }))
}

/** The measured size of every geometry reader in a tree, keyed as it reported. */
function geometryFrom(tree: RenderTree): Map<string, GeometryPayload> {
  const measured = new Map<string, GeometryPayload>()
  const readers = tree.nodes.filter((node) => node.id.startsWith('geo:'))
  if (readers.length === 0) return measured
  const byId = new Map(tree.nodes.map((node) => [node.id, node]))
  for (const node of readers) {
    // Where it is on the screen: its frame is in its parent's space, and so on up.
    let { x, y } = node.frame
    for (let up = node.parent ? byId.get(node.parent) : undefined; up; up = up.parent ? byId.get(up.parent) : undefined) {
      x += up.frame.x
      y += up.frame.y
    }
    measured.set(node.id.slice(4), { width: node.frame.width, height: node.frame.height, x, y, insets: node.geometryInsets ?? NO_INSETS })
  }
  return measured
}

const NO_INSETS = { top: 0, leading: 0, bottom: 0, trailing: 0 }

/**
 * What `@Environment` reports, from what the preview controls are set to.
 *
 * Read on every compile rather than at load, because appearance and Dynamic Type
 * change without the program changing - and reloading would discard every `@State`.
 */
/** The rect a root view is proposed - what a geometry reader reports before layout. */
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
    dynamicTypeSize: request.dynamicTypeSize,
    displayScale: request.displayScale,
    locale: 'en_US',
    layoutDirection: 'leftToRight',
    // A phone is compact across and regular down; a landscape phone and an iPad are
    // not, but the device model does not report that yet.
    horizontalSizeClass: request.canvas.width >= 700 ? 'regular' : 'compact',
    verticalSizeClass: request.canvas.height >= 700 ? 'regular' : 'compact',
  }
}

function programKeyOf(request: CompileRequest): string {
  return request.files.map((f) => `${f.id} ${f.text}`).join('') + JSON.stringify([request.scenario ?? null, request.previewScreen ?? null])
}

export type { LayoutElement }
