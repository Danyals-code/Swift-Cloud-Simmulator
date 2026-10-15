import { SURFACES } from './appearance/surfaces'
import { primaryScroll, scrollInsets } from './containers/screen'
import { attachedSheet, sheetContentTop } from './containers/sheet'
import type { ScreenLayout } from './to-layout'
import {
  APPEARANCE_CALIBRATION,
  bindAuthoringRuntime,
  pageViews,
  rgba,
  sameStart,
  screenOrigin,
  viewsDrawing,
  type CompileRequest,
  type AuthoringSnapshot,
  type CompileResult,
  type Diagnostic,
  type LayerDraft,
  type LogEntry,
  type MeasuredTextData,
  type PagePreview,
  type Rect,
  type RenderNode,
  type RenderTree,
  type SourceFile,
  type SourceSpan,
  type UIEvent,
  type ViewGeometry,
  type ViewInstance,
  type ViewLayer,
} from '@studio/shared'
import { DEFAULT_STEP_BUDGET } from '@studio/swift-runtime'
import { Parser, type MacroDecl, type SourceFileNode, type Token } from '@studio/swift-syntax'
import { buildAuthoringModel, layerDraftSites, scenarioFiles, Checker, lintStrictness, type LayerDraftSites, type SemanticModel } from '@studio/swift-sema'
import {
  applyLayoutDraft,
  CENTER,
  FontMetricsTable,
  LayoutEngine,
  ZERO_INSETS,
  type LayoutDraftEdit,
  type LayoutElement,
  type LayoutEnvironment,
  type MeasuredFont,
  type RunMeasurer,
  type PlaceObserver,
  type PlacedNode,
} from '@studio/swiftui-layout'
import { AppRuntime, type EvaluationResult } from './app-runtime'
import type { EnvironmentInputs } from './view-environment'
import { bodyFont, colorForName, labelColor, setAssetColors, systemBackground } from './style'
import { appendPlaced, placedToRenderTree } from './to-render'
import { screenToLayout, NAV_BAR_HEIGHT, TAB_BAR_HEIGHT, viewsToLayout } from './to-layout'
import { reveals, shownView, stoppedFailures, type NestedPage, type NotDrawn, type OverlayKind, type ResolvedUI, type Revealable } from './presentation'
import { runnableProgram, setAsideRan, type Runnable } from './set-aside'
import { exhausts, toFailure } from './failures'
import type { GeometryPayload, RuntimeFailure, ViewValue } from './view-value'
import { draftEdits, findViews, instancesIn, Placements, watchedIds, type ConvertedView, type PassRoot } from './canvas-geometry'

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

/**
 * The view the canvas has selected, whose geometry every result carries (Wave 2b). A
 * setting rather than part of a request, so a tap or a font refinement that redraws the
 * page brings the handles along.
 */
let measureTarget: SourceSpan | null = null
/**
 * The swipe-action and context-menu modifiers the canvas's last drawing met, each once for
 * where it is written, and the selection it was drawn for (Wave 4a): a new selection that
 * reveals another, or none, draws the pages again from the program rather than only laying
 * them out.
 */
let galleryReveal: { readonly target: SourceSpan | null; readonly modifiers: Map<SourceSpan, Revealable> } | null = null
/** Where its drag's values go in its chain, worked out once for each analysis. */
let sitesFor: { readonly analysis: Analysis; readonly target: SourceSpan; readonly sites: LayerDraftSites | null } | null = null
/**
 * The drag in progress, drawn into every layout until it ends or the source changes. Its
 * engine keeps what the last frame measured, so a frame measures only what the drag moved.
 */
let draft: { values: LayerDraft | null; engine: LayoutEngine | null } | null = null

/** A tree of a result, with what it was laid out from, so a draft lays it out again and nothing more. */
interface Drawn {
  readonly tree: RenderTree
  readonly input: ScreenInput
  readonly instances: readonly ViewInstance[]
}
/** The trees the pass in progress drew. */
let drawing: Drawn[] = []
/** The last full result, and its trees. */
let drawn: { readonly result: CompileResult; readonly trees: readonly Drawn[] } | null = null
/**
 * The last result Design's canvas drew, with the files it was drawn from: what Design keeps,
 * dimmed, while the code has errors that stop it running (FR-6.3), for the same project and
 * state. Only a drawing of every page counts, so one of the phone alone, drawn while Code is
 * open, never takes the place of the pages Design showed.
 */
let lastGood: { readonly key: string; readonly files: readonly SourceFile[]; readonly result: CompileResult } | null = null
/**
 * What a kept drawing belongs to: the project, scenario and screen, as the studio keys its worker.
 * The pipeline is driven directly too, by tests and export, where nothing else keeps one project's
 * drawing from another's. One drawn in another colour scheme, device or text size is still the
 * drawing kept, which the canvas shows as the last drawing, never as the code as it is.
 */
const drawingKey = (request: CompileRequest) => JSON.stringify([request.projectId ?? '', request.scenario ?? null, request.previewScreen ?? null])

/** z ranges, so bars always paint over content and presentations over everything. */
const BAR_Z = 100_000
const OVERLAY_Z = 200_000

export function setFontMetrics(fonts: readonly MeasuredFont[], measurer?: RunMeasurer, collectRequests = false): void {
  fontGeneration++
  metrics = new FontMetricsTable(fonts, measurer, collectRequests)
  if (draft) draft.engine = null
}

/** Font-only refinement reuses the evaluated view and preserves live state. */
export function relayout(revision: number): CompileResult {
  if (!lastAnalysis || !lastEvaluation) return rerender(revision)
  const { analysis, request } = lastAnalysis
  const next = { ...request, revision }
  lastAnalysis = { analysis, request: next }
  if (!analysis.runnable) return withLastDrawing(next, analysis, performance.now())
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
  if (draft) draft.engine = null
  return relayout(revision)
}

/**
 * The view the canvas has selected, by its authoring node's source; null for none. Every
 * result then carries where it is drawn; `endLayerDraft` returns that for the page as it
 * is, without running anything again.
 */
export function setMeasureTarget(target: SourceSpan | null): void {
  measureTarget = target
}

/**
 * A drag starts on `target`, which becomes the selected view: where each of its values
 * goes in the view's chain is worked out now, once, so each frame of the drag only lays
 * the page out again.
 *
 * `revision` is accepted as every draft call takes one, and is not needed: the places are
 * worked out for the program the worker has, and nothing is drawn until the first update.
 */
export function beginLayerDraft(target: SourceSpan, revision: number): void {
  void revision
  measureTarget = target
  draft = { values: null, engine: null }
  currentSites()
}

/**
 * The page laid out with a drag's values, from the last evaluation: nothing is parsed,
 * checked, planned or run. Only the trees the view is drawn in are laid out again, and in
 * them only what the drag changed is measured again. The draft is drawn into every redraw
 * until it ends or the source changes; after that, this draws the page as it is.
 *
 * The result has no `authoring`: a draft changes no source, the last result's model still
 * holds, and copying it to the page each frame would cost more than the layout does.
 */
export function updateLayerDraft(values: LayerDraft, revision: number): CompileResult {
  if (draft) draft.values = values
  const { authoring: _unchanged, ...drawing } = redraw(revision)
  void _unchanged
  return drawing
}

/**
 * Ends the drag: the page as it is, after an Escape or until the written edit's compile
 * arrives. With no drag it is the page as it is with the selected view's geometry, laid
 * out again from what the last result was converted from: how a newly selected view's
 * handles appear without compiling or running anything.
 */
export function endLayerDraft(revision: number): CompileResult {
  draft = null
  return redraw(revision)
}

export function resetPipelineState(): void {
  runtime.reset()
  lastEvaluation = null
  galleryReveal = null
  lastGood = null
  keptAsFound = null
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
  /** What runs while the code has errors that only some lines depend on; null when it cannot run at all. */
  readonly runnable: Runnable | null
  readonly parseMs: number
  readonly checkMs: number
}

function analyse(request: CompileRequest): Analysis {
  const parseStart = performance.now()
  const files: SourceFileNode[] = []
  const diagnostics: Diagnostic[] = []
  const tokens = new Map<string, readonly Token[]>()

  for (const file of request.files) {
    const result = Parser.parse(file.text, file.id)
    files.push(result.sourceFile)
    diagnostics.push(...result.diagnostics)
    tokens.set(file.id, result.tokens)
  }
  const parseMs = performance.now() - parseStart

  const checkStart = performance.now()
  const model = Checker.check(files)

  // The strictness pass runs only on code that parsed cleanly. On a half-typed file
  // its inference would be working from a broken tree, and a warning derived from
  // that is exactly the false positive the pass exists to avoid.
  const strict = diagnostics.some((d) => d.severity === 'error') ? [] : lintStrictness(files, model)
  const authoring = buildAuthoringModel({ deploymentTarget: request.deploymentTarget, componentDescriptions: request.componentDescriptions, colors: request.colors, files: request.files, parsed: files, tokens, diagnostics: [...diagnostics, ...model.diagnostics], projectId: request.projectId ?? '', revision: request.revision })
  const checkMs = performance.now() - checkStart

  return {
    authoring,
    files,
    model,
    diagnostics: [...diagnostics, ...model.diagnostics, ...strict],
    runnable: runnableProgram(files, [...diagnostics, ...model.diagnostics]),
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

/** A screen converted for layout, and what it is laid out against. */
interface ScreenInput {
  readonly screen: ScreenLayout
  readonly canvas: { readonly width: number; readonly height: number }
  readonly safeArea: { readonly top: number; readonly leading: number; readonly bottom: number; readonly trailing: number }
  readonly env: LayoutEnvironment
  readonly scheme: 'light' | 'dark'
  /** Every view the conversion met, by path: where the selected view's elements are found. */
  readonly views: ReadonlyMap<string, ConvertedView>
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
  const laidOut = layoutScreen(convertScreen(request, evaluation, drawingRuntime), new LayoutEngine(metrics), draft?.values ?? null, false)
  drawing.push(laidOut)
  return laidOut.tree
}

function convertScreen(request: CompileRequest, evaluation: EvaluationResult, drawingRuntime: AppRuntime): ScreenInput {
  // `withAnimation { … }` animates every change in its transaction, so the hint goes
  // on the root environment and every node below inherits it for exactly one frame.
  const env = withAnimation(rootEnvironment(request), evaluation)
  const scheme = request.colorScheme
  const canvas = request.canvas
  const safeArea = request.safeArea ?? { top: 0, leading: 0, bottom: 0, trailing: 0 }
  const views = new Map<string, ConvertedView>()
  const onView = (view: ViewValue, path: string, element: LayoutElement) => { views.set(path, { view, element }) }

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
        onView,
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
          onView,
        }).element,
        background: systemBackground(scheme),
        navigationBar: null,
        tabBar: null,
        overlay: null,
        hitTargets: new Map<string, string>(),
      }

  return { screen, canvas, safeArea, env, scheme, views }
}

/**
 * Lays out a converted screen, with a drag's values when there is one, and finds where
 * the selected view is drawn in it. `reuse` keeps what the engine measured last time, for
 * a draft's frames, which change only the dragged view. With `onlyWithView`, a screen the
 * view is not drawn in is not laid out at all.
 */
function layoutScreen(input: ScreenInput, engine: LayoutEngine, values: LayerDraft | null, reuse: boolean, onlyWithView: true): Drawn | undefined
function layoutScreen(input: ScreenInput, engine: LayoutEngine, values: LayerDraft | null, reuse: boolean): Drawn
function layoutScreen(input: ScreenInput, engine: LayoutEngine, values: LayerDraft | null, reuse: boolean, onlyWithView = false): Drawn | undefined {
  const sites = currentSites()
  let found = sites ? findViews(passRoots(input.screen), input.views, sites) : []
  if (onlyWithView && !found.length) return undefined
  let screen = input.screen
  if (sites && values && found.length) {
    const drafted = draftEdits(found, sites, values)
    if (drafted.edits.length) {
      screen = draftScreen(screen, drafted.edits)
      found = drafted.found
    }
  }
  const placements = found.length ? new Placements(watchedIds(found)) : undefined
  const tree: RenderTree = { ...composeScreen(engine, screen, input.canvas, input.safeArea, input.env, { placements, prefix: '', root: null, reuse }), colorScheme: input.scheme, calibration: APPEARANCE_CALIBRATION.status }
  return { tree, input, instances: placements ? instancesIn(found, placements, tree) : [] }
}

/** How one layout pass names its nodes, who is told where its elements go, and whether it reuses measurements. */
interface LayoutPass extends Pick<PassRoot, 'prefix' | 'root'> {
  readonly placements?: Placements
  readonly reuse?: boolean
}

const PLAIN: LayoutPass = { prefix: '', root: null }

const passOptions = (pass: LayoutPass) => ({ ...(pass.placements ? { observer: pass.placements.observer(pass) } : {}), ...(pass.reuse ? { reuseMeasurements: true } : {}) })

/**
 * Each tree of a screen that a view the canvas selects can be in: its content, its bars and
 * search field, and a sheet's screen, whose nodes are named under `overlay/` and placed in
 * its surface. `change` may return a new tree, and the screen is rebuilt around it.
 * `composeScreen` lays each of them out against a rect of its own.
 */
function eachTree(screen: ScreenLayout, change: (root: PassRoot) => LayoutElement, prefix = '', root: string | null = null): ScreenLayout {
  const at = (element: LayoutElement) => change({ element, prefix, root })
  return {
    ...screen,
    content: at(screen.content),
    navigationBar: screen.navigationBar && { ...screen.navigationBar, element: at(screen.navigationBar.element) },
    tabBar: screen.tabBar && at(screen.tabBar),
    ...(screen.search ? { search: { ...screen.search, element: at(screen.search.element) } } : {}),
    overlay: screen.overlay && { ...screen.overlay, ...(screen.overlay.screen ? { screen: eachTree(screen.overlay.screen, change, `${prefix}overlay/`, `${prefix}overlay-surface`) } : {}) },
  }
}

function passRoots(screen: ScreenLayout): PassRoot[] {
  const roots: PassRoot[] = []
  eachTree(screen, root => { roots.push(root); return root.element })
  return roots
}

/** The screen with a draft's edits made in each of its trees. */
const draftScreen = (screen: ScreenLayout, edits: readonly LayoutDraftEdit[]) => eachTree(screen, ({ element }) => applyLayoutDraft(element, edits))

function composeScreen(engine: LayoutEngine, screen: ScreenLayout, canvas: { width: number; height: number }, safeArea: { top: number; leading: number; bottom: number; trailing: number }, env: LayoutEnvironment, pass: LayoutPass = PLAIN): RenderTree {
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
  const options = passOptions(pass)
  // A context menu goes beside the view it is open on (Wave 4a), so where that is placed is watched.
  const owner = screen.overlay?.contextMenu
  const pressed: Pressed = {}
  const placed = engine.layout(content, contentBounds, { ...env, safeArea: { inner: contentBounds, outer: screenRect } }, CENTER, owner === undefined ? options : { ...options, observer: watchPressed(owner, pressed, options.observer) })
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
    const laidOut = engine.layout(screen.navigationBar.element, { x: 0, y: topTabs, width: canvas.width, height: safeArea.top + barHeight }, env, CENTER, passOptions(pass))
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
    const bar = engine.layout(screen.tabBar, { x: 0, y: regular ? safeArea.top : bottomBarsEnd - tabHeight, width: canvas.width, height: tabHeight }, env, CENTER, passOptions(pass))
    tree = appendPlaced(tree, bar, BAR_Z + 1000)
  }
  if (screen.search) {
    // At the bottom it sits where a tab bar would.
    const search = engine.layout(screen.search.element, { x: 0, y: bottomSearch ? bottomBarsEnd - bottomTabs - bottomSearch : safeArea.top + topTabs + barHeight, width: canvas.width, height: screen.search.height }, env, CENTER, passOptions(pass))
    tree = appendPlaced(tree, search, BAR_Z + 2000)
  }
  if (screen.overlay) {
    const view = pressed.at && onScreen(pressed.at, tree)
    tree = { ...tree, nodes: [...tree.nodes.map(n => n.parent || allowsBackgroundInteraction(screen.overlay!, canvas, safeArea) ? n : { ...n, inert: true }), ...presentOverlay(engine, screen.overlay, canvas, safeArea, env, pass, view).map(n => ({ ...n, z: n.z + OVERLAY_Z }))] }
  }
  return { ...tree, ...(scroll && collapseDistance ? { chrome: { scrollId: scroll.id, collapseDistance } } : {}) }
}

function withAnimation(
  env: LayoutEnvironment,
  evaluation: EvaluationResult,
): LayoutEnvironment {
  const animation = evaluation.ui?.animation
  return animation ? { ...env, animation } : env
}

/** Where the view a context menu is open on was placed, and in which node's space (Wave 4a). */
interface Pressed { at?: { readonly rect: Rect; readonly space: string | null } }

/**
 * Notes in `pressed` where the view a context menu is open on is placed (Wave 4a), as iOS
 * lifts it: a list's row as a whole, by the frame the list gives it, or else the view's tap
 * target. `inner` is told of every element, as it was before.
 */
function watchPressed(owner: string, pressed: Pressed, inner: PlaceObserver | undefined): PlaceObserver {
  const row = `${owner}rowsize`, target = `${owner}hit`
  return (element, rect, space) => {
    inner?.(element, rect, space)
    if (element.id === row || !pressed.at && element.id === target) pressed.at = { rect, space }
  }
}

/** Where an element was placed, in a tree's own space, as the screen has it before anything scrolls. */
function onScreen(placed: NonNullable<Pressed['at']>, tree: RenderTree): Rect {
  const space = placed.space === null ? undefined : tree.nodes.find(node => node.id === placed.space)
  const origin = space ? screenOrigin(space, new Map(tree.nodes.map(node => [node.id, node]))) : { x: 0, y: 0 }
  return { x: placed.rect.x + origin.x, y: placed.rect.y + origin.y, width: placed.rect.width, height: placed.rect.height }
}

/**
 * Places a presentation: a dimming layer, then the presented surface over it. A context
 * menu's panel goes beside `pressed`, the view it is open on (Wave 4a).
 */
function presentOverlay(
  engine: LayoutEngine,
  overlay: NonNullable<ReturnType<typeof screenToLayout>['overlay']>,
  canvas: { width: number; height: number },
  safeArea: { top: number; leading: number; bottom: number; trailing: number },
  env: LayoutEnvironment,
  pass: LayoutPass = PLAIN,
  pressed?: Rect,
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
    paint: { kind: 'fill', fill: { kind: 'solid', color: rgba(0, 0, 0, overlay.contextMenu ? SURFACES.contextMenu.dim : overlay.kind === 'dialog' || overlay.kind === 'menu' ? 0 : 0.2) } },
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
    const attached = attachedSheet(overlay, canvas.width)
    const top = sheet ? sheetContentTop(overlay, attached, !!overlay.screen.navigationBar) : safeArea.top
    const bottom = overlay.kind === 'cover' || attached ? safeArea.bottom : Math.max(12, safeArea.bottom - SURFACES.sheet.margin)
    // Its nodes are named under `overlay/`, and its root ones placed in the sheet's surface.
    const nested = composeScreen(engine, overlay.screen, { width: rect.width, height: rect.height }, { top, leading: 0, trailing: 0, bottom }, env, { ...pass, prefix: `${pass.prefix}overlay/`, root: `${pass.prefix}overlay-surface` })
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
    pass.reuse ? { reuseMeasurements: true } : {},
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
    const at = overlay.contextMenu !== undefined && pressed ? contextMenuOrigin(pressed, { width, height }, canvas, safeArea) : { x, y }
    const panel: RenderNode = { id: 'overlay-menu', kind: 'layer', frame: { x: at.x, y: at.y, width, height }, z: 1, opacity: 1, anchorId: overlay.anchorId }
    const arrow: RenderNode[] = overlay.kind === 'dialog' ? [{ id: 'overlay-dialog-arrow', kind: 'path',
      parent: panel.id, frame: { x: width / 2 - 14, y: height - 0.5, width: 28, height: 14 }, z: 2, opacity: 1,
      path: { d: 'M 0 0 L 11 11 Q 14 14 17 11 L 28 0', fill: { kind: 'solid', color: overlay.light ? rgba(250, 250, 252) : rgba(38, 38, 40) }, fillRule: 'nonzero' },
    }] : []
    return [...dimNodes, panel, ...painted.map(n => n.parent ? n : { ...n, parent: panel.id, frame: { ...n.frame, x: n.frame.x - x, y: n.frame.y - y } }), ...arrow]
  }
  return [...dimNodes, ...painted]
}

/**
 * Where a context menu's panel goes (Wave 4a), as iOS 27 puts it (iphone18pro-system-ui):
 * centred `gap` under the view it is open on, or, where centred it would leave the screen,
 * lined up with the view's edge on the screen's nearer side; never nearer the screen's edges
 * than `margin`, and above the view when there is no room under it.
 */
function contextMenuOrigin(
  view: Rect,
  panel: { width: number; height: number },
  canvas: { width: number; height: number },
  safeArea: { top: number; bottom: number },
): { x: number; y: number } {
  const { gap, margin } = SURFACES.contextMenu
  const centred = view.x + (view.width - panel.width) / 2
  const lined = view.x + view.width / 2 <= canvas.width / 2 ? view.x : view.x + view.width - panel.width
  const fits = centred >= margin && centred + panel.width <= canvas.width - margin
  const x = Math.max(margin, Math.min(canvas.width - margin - panel.width, fits ? centred : lined))
  const below = view.y + view.height + gap
  const y = below + panel.height <= canvas.height - safeArea.bottom ? below : Math.max(safeArea.top, view.y - gap - panel.height)
  return { x, y }
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
    const width = Math.min(overlay.contextMenu ? SURFACES.contextMenu.width : SURFACES.menu.width, canvas.width - SURFACES.menu.margin * 2)
    return { x: canvas.width - width - SURFACES.menu.margin, y: safeArea.top, width, height: canvas.height - safeArea.top - safeArea.bottom - SURFACES.menu.margin }
  }

  if (overlay.kind === 'dialog') {
    const width = Math.min(240, canvas.width - 32)
    return { x: (canvas.width - width) / 2, y: safeArea.top, width, height: canvas.height - safeArea.top - safeArea.bottom - 8 }
  }

  if (attachedSheet(overlay, canvas.width)) return { x: 0, y: safeArea.top, width: canvas.width, height: canvas.height - safeArea.top }

  const margin = SURFACES.sheet.margin
  const available = Math.max(0, canvas.height - safeArea.top - SURFACES.sheet.top - margin)
  const detentHeight = (value: number) => Math.min(available, value < 0 ? -value + Math.max(0, safeArea.bottom - margin) : (canvas.height - safeArea.bottom) * value + safeArea.bottom)
  const height = Math.min(...(overlay.detents?.length ? overlay.detents : [overlay.detent]).map(detentHeight))
  const width = Math.min(SURFACES.sheet.maxWidth, canvas.width - margin * 2)
  return { x: (canvas.width - width) / 2, y: canvas.width >= 600 ? (canvas.height - height) / 2 : canvas.height - height - margin, width, height }

}

/** A tree carrying only a message, for states where there is nothing to draw. */
function noticeTree(request: CompileRequest, title: string, detail: string, span?: SourceSpan): RenderTree {
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
      placeholder: { kind: 'notice', feature: title, reason: detail },
    },
  ]
  return { canvas: request.canvas, nodes, revision: ++revision, notice: span ? { title, detail, span } : { title, detail } }
}

/**
 * What the phone shows while the code has errors: how many, and the first.
 *
 * The same on every redraw, a compile or not: switching Edit and Preview, Reset and a
 * font refinement redraw the program the worker already has, and a null tree there
 * was a blank phone.
 */
function errorsNotice(request: CompileRequest, analysis: Analysis, first?: Diagnostic): RenderTree {
  const errors = analysis.diagnostics.filter((d) => d.severity === 'error')
  const named = first ?? errors[0]
  return noticeTree(request, `${errors.length} error${errors.length === 1 ? '' : 's'}`, named?.message ?? 'Fix the errors to run.', named?.span)
}

/**
 * The result for code its errors stop from running: the error over the phone, which keeps its
 * last screen, and the last drawing of this project and state for Design to keep (FR-6.3).
 */
function withLastDrawing(request: CompileRequest, analysis: Analysis, startedAt: number, evaluateMs = 0, first?: Diagnostic): CompileResult {
  const notice = errorsNotice(request, analysis, first)
  const kept = lastGood?.key === drawingKey(request) ? lastGood : null
  if (!kept) return toResult(request, analysis, null, notice, startedAt, evaluateMs, 0)
  const found = foundIn(kept, request.files)
  const result = toResult(request, analysis, null, notice, startedAt, evaluateMs, 0, found.pages, [], [], found.hierarchy)
  return kept.result.pagesNotDrawn ? { ...result, pagesNotDrawn: kept.result.pagesNotDrawn } : result
}

/** The kept drawing's pages and layers as `foundIn` last found them, for the files then unchanged. */
let keptAsFound: { readonly drawing: object; readonly unchanged: string; readonly pages?: readonly PagePreview[]; readonly hierarchy?: readonly ViewLayer[] } | null = null

/**
 * The kept drawing's pages and layers as they are found in the code now. A view in it is found
 * only where its file is as it was drawn: one in a file changed since is never matched to
 * whatever is written at its place now. A page whose own views are in such a file keeps its
 * drawing and no layers, so Layers lists its code as it would with no drawing. Worked out again
 * only when the files unchanged since the drawing are others, not at each keystroke in the
 * file with the error.
 */
function foundIn(kept: NonNullable<typeof lastGood>, files: readonly SourceFile[]): NonNullable<typeof keptAsFound> {
  const same = new Set(files.filter(file => kept.files.some(old => old.id === file.id && old.text === file.text)).map(file => file.id))
  const unchanged = [...same].join('\n')
  if (keptAsFound?.drawing === kept && keptAsFound.unchanged === unchanged) return keptAsFound
  const found = (layer: ViewLayer): ViewLayer => {
    const next: { -readonly [K in keyof ViewLayer]: ViewLayer[K] } = { id: layer.id, name: layer.name, type: layer.type, children: layer.children.map(found) }
    if (layer.source && same.has(layer.source.file)) next.source = layer.source
    const calls = layer.componentSources?.filter(call => same.has(call.source.file))
    if (calls?.length) next.componentSources = calls
    if (layer.page) next.page = layer.page
    return next
  }
  /** The layers of a page, while the views at its top are still found. */
  const layers = (hierarchy: readonly ViewLayer[] | undefined) => {
    const next = hierarchy?.map(found)
    return next?.some(page => page.children.some(view => view.source)) ? next : undefined
  }
  keptAsFound = { drawing: kept, unchanged, pages: kept.result.pages?.map(page => ({ ...page, viewHierarchy: layers(page.viewHierarchy) })), hierarchy: layers(kept.result.viewHierarchy) }
  return keptAsFound
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

/** Each item once for its place in the source, or once for each message said there when `perMessage`. */
function oncePerPlace<T extends { readonly span: SourceSpan; readonly message: string }>(items: readonly T[], perMessage: boolean): T[] {
  const key = (item: T) => `${item.span.file}:${item.span.start}:${item.span.end}${perMessage ? `:${item.message}` : ''}`
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

/** Where the selected view's chains are, and where a drag's values go in them, for the analysis in hand. */
function currentSites(): LayerDraftSites | null {
  if (!measureTarget || !lastAnalysis) return null
  const { analysis, request } = lastAnalysis
  if (sitesFor?.analysis === analysis && sameStart(sitesFor.target, measureTarget)) return sitesFor.sites
  const sites = layerDraftSites({ trees: analysis.files, files: request.files, nodes: analysis.authoring.nodes, target: measureTarget, deploymentTarget: request.deploymentTarget })
  sitesFor = { analysis, target: measureTarget, sites }
  return sites
}

/** Where the selected view is drawn in a result: on each page of a gallery, or on the one phone. */
function geometryOf(result: CompileResult, instancesOf: (tree: RenderTree) => readonly ViewInstance[] | undefined): ViewGeometry | undefined {
  if (!measureTarget || !result.renderTree) return undefined
  const sites = currentSites()
  const instances = !sites ? []
    : result.pages?.length ? result.pages.flatMap(page => (instancesOf(page.tree) ?? []).map(instance => ({ ...instance, page: page.id })))
    : [...instancesOf(result.renderTree) ?? []]
  return { view: sites?.view.view ?? measureTarget, instances }
}

/**
 * The last full result drawn again with the drag in progress, or as it is when there is
 * none: each tree the selected view is in is laid out again from the elements it was
 * converted to, and the rest are kept.
 */
function redraw(revision: number): CompileResult {
  if (!drawn || !lastAnalysis) return relayout(revision)
  if (!draft && galleryReveal && revealing(galleryReveal.target) !== revealing(measureTarget)) return rerender(revision)
  const startedAt = performance.now()
  // A draft is drawn at the revision on screen; a newer one the worker has seen stays its own.
  if (revision > lastAnalysis.request.revision) lastAnalysis = { ...lastAnalysis, request: { ...lastAnalysis.request, revision } }
  const values = draft?.values ?? null
  const engine = draft ? draft.engine ??= new LayoutEngine(metrics) : new LayoutEngine(metrics)
  // A tree the view is not drawn in is kept as it is, and so is one a draft could not lay out.
  const redrawn = new Map<RenderTree, Drawn>()
  for (const tree of drawn.trees) {
    const laidOut = layoutScreen(tree.input, engine, values, !!draft, true)
    if (laidOut) redrawn.set(tree.tree, valid(laidOut.tree) ? laidOut : tree)
  }
  const base = drawn.result
  const swap = (tree: RenderTree) => redrawn.get(tree)?.tree ?? tree
  const pages = base.pages?.map(page => swap(page.tree) === page.tree ? page : { ...page, tree: swap(page.tree) })
  const renderTree = base.renderTree && swap(base.renderTree)
  const instances = new Map([...redrawn.values()].map(laidOut => [laidOut.tree, laidOut.instances]))
  const result: CompileResult = {
    ...base,
    revision,
    ...(base.authoring ? { authoring: { ...base.authoring, revision } } : {}),
    renderTree,
    ...(pages ? { pages } : {}),
    textMeasurement: { ...metrics.measurementState, generation: fontGeneration },
    timings: { parse: 0, check: 0, evaluate: 0, layout: performance.now() - startedAt, total: performance.now() - startedAt },
  }
  const geometry = geometryOf(result, tree => instances.get(tree))
  return geometry ? { ...result, geometry } : result
}

/** Which of the drawing's swipe actions or context menus a selection reveals, if any. */
function revealing(target: SourceSpan | null): Revealable | null {
  if (!target || !galleryReveal) return null
  for (const modifier of galleryReveal.modifiers.values()) if (reveals(target, modifier)) return modifier
  return null
}

/** Whether every frame in a tree is a size the canvas can draw. */
const valid = (tree: RenderTree) => tree.nodes.every((node) => Object.values(node.frame).every(Number.isFinite) && node.frame.width >= 0 && node.frame.height >= 0)

function toResult(
  request: CompileRequest,
  analysis: Analysis,
  evaluation: EvaluationResult | null,
  renderTree: RenderTree | null,
  startedAt: number,
  evaluateMs: number,
  layoutMs: number,
  pages?: readonly PagePreview[],
  notDrawnPages: readonly Diagnostic[] = [],
  galleryWarnings: readonly Diagnostic[] = [],
  hierarchy: readonly ViewLayer[] = evaluation?.failure ? [] : evaluation?.ui?.viewHierarchy ?? [],
): CompileResult {
  const total = performance.now() - startedAt

  const logs: LogEntry[] = (evaluation?.logs ?? []).map((entry) => ({
    level: entry.level,
    message: entry.message,
    origin: entry.span,
    at: total,
  }))

  // A sheet can be resolved more than once in a pass, so each place is said once.
  const resolved = oncePerPlace([...(evaluation?.ui?.notDrawn ?? []).map(notDrawnWarning), ...(evaluation?.ui?.warnings ?? []), ...galleryWarnings], false)
  // Tabs a ForEach built share one source, so a screen not drawn is told apart by its name too.
  const notDrawn = oncePerPlace(notDrawnPages, true)
  const diagnostics = [...analysis.diagnostics, ...resolved, ...notDrawn]
  // A view that stopped is drawn as a placeholder, and said once however many times it stopped.
  const failures = oncePerPlace([...(evaluation?.failure ? [evaluation.failure] : []), ...stoppedFailures(evaluation?.ui)], true)
  for (const failure of failures) {
    diagnostics.push({
      span: failure.span,
      severity: 'error',
      code: failure.kind === 'budget' ? 'execution_budget_exceeded' : 'runtime_trap',
      message: failure.frames.length > 0 ? `${failure.message} (in ${failure.frames[0]})` : failure.message,
    })
  }

  const authoring = bindAuthoringRuntime(analysis.authoring, evaluation?.failure ? [] : [
    ...hierarchy,
    ...(pages ?? []).flatMap(page => page.viewHierarchy ?? []),
  ], request.revision)
  return {
    revision: request.revision,
    authoring: { ...authoring, nodes: authoring.nodes.map(node => ({ ...node, runtimeIds: [...new Set(node.runtimeIds)] })) },
    diagnostics,
    renderTree,
    viewHierarchy: hierarchy,
    ...(pages ? { pages } : {}),
    ...(notDrawn.length ? { pagesNotDrawn: notDrawn.map((warning) => warning.message) } : {}),
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
  // New source: a drag's places were in the old one, and so were the trees a draft redraws.
  draft = null
  drawn = null
  if (lastAnalysis?.request.projectId !== request.projectId || JSON.stringify(lastAnalysis?.request.scenario) !== JSON.stringify(request.scenario)) {
    runtime.reset(false)
    lastEvaluation = null
  }
  const startedAt = performance.now()
  const analysis = analyse(request)
  lastAnalysis = { request, analysis }

  // Evaluation needs a well-formed program. Running one with parse errors would
  // produce failures that describe the broken parse rather than the user's code; an
  // error that only some lines depend on is set aside in them instead.
  const program = analysis.runnable
  if (!program) return withLastDrawing(request, analysis, startedAt)

  const evaluateStart = performance.now()
  let scenario: ReturnType<typeof scenarioFiles> = { files: program.files, held: new Map() }
  try { scenario = scenarioFiles({ files: request.files, ast: program.files, nodes: analysis.authoring.nodes }, analysis.authoring, request.scenario) }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid preview scenario.'
    const diagnostic: Diagnostic = { severity: 'error', code: 'invalid_preview_scenario', message, span: { file: request.files[0]?.id ?? '', start: 0, end: 0 } }
    const failed = { ...analysis, diagnostics: [...analysis.diagnostics, diagnostic] }
    lastAnalysis = { request, analysis: failed }; lastEvaluation = null; runtime.reset(false)
    return toResult(request, failed, null, noticeTree(request, 'Preview scenario needs updating', message), startedAt, 0, 0)
  }
  runtime.load(scenario.files, analysis.model, programKeyOf(request), request.previewScreen, scenario.held)
  runtime.setEnvironment(environmentFor(request))
  runtime.setDefaultGeometry(contentSizeOf(request))

  let evaluation = runtime.evaluate()

  // `.onAppear` usually sets the state the view is about to draw from, so the pass
  // that *discovered* the callback is not the pass worth showing. One more is enough:
  // a second appearance of the same path is not an appearance.
  const appeared = !!evaluation.ui && runtime.runLifecycle(evaluation.ui.lifecycle)
  if (appeared) evaluation = runtime.evaluate()

  const evaluateMs = performance.now() - evaluateStart

  return finish(request, analysis, evaluation, startedAt, evaluateMs, appeared)
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
  if (!analysis.runnable) return withLastDrawing(next, analysis, startedAt)

  const evaluateStart = performance.now()
  let evaluation = runtime.evaluate()

  const appeared = !!evaluation.ui && runtime.runLifecycle(evaluation.ui.lifecycle)
  if (appeared) evaluation = runtime.evaluate()

  return finish(next, analysis, evaluation, startedAt, performance.now() - evaluateStart, appeared)
}

/**
 * Draws the evaluated program, and keeps the trees it drew for a draft to lay out again,
 * with the selected view's geometry in them.
 */
function finish(
  request: CompileRequest,
  analysis: Analysis,
  evaluation: EvaluationResult,
  startedAt: number,
  evaluateMs: number,
  appeared = false,
): CompileResult {
  drawing = []
  galleryReveal = null
  const result = draw(request, analysis, evaluation, startedAt, evaluateMs, appeared)
  const byTree = new Map(drawing.map(laidOut => [laidOut.tree, laidOut]))
  drawing = []
  if (draft) draft.engine = null
  const trees = [...new Set([result.renderTree, ...(result.pages ?? []).map(page => page.tree)].flatMap(tree => tree && byTree.get(tree) ? [byTree.get(tree)!] : []))]
  drawn = result.renderTree && trees.length ? { result, trees } : null
  if (request.allPages && result.renderTree && !result.renderTree.notice) lastGood = { key: drawingKey(request), files: request.files, result }
  const geometry = geometryOf(result, tree => byTree.get(tree)?.instances)
  return geometry ? { ...result, geometry } : result
}

function draw(
  request: CompileRequest,
  analysis: Analysis,
  evaluation: EvaluationResult,
  startedAt: number,
  evaluateMs: number,
  appeared = false,
): CompileResult {
  // The screen ran a line set aside for its error, so what it would draw is not what
  // the app draws: the error is said over the last drawing that ran, as with any error.
  const stoppedAt = analysis.runnable && setAsideRan(analysis.runnable, evaluation, appeared)
  if (stoppedAt) {
    lastEvaluation = null
    return withLastDrawing(request, analysis, startedAt, evaluateMs, stoppedAt)
  }

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
    if (corrected.failure) return draw(request, analysis, corrected, startedAt, evaluateMs)
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
  const gallery = request.allPages ? renderPages(request, evaluation, renderTree) : undefined
  // With no app the first `#Preview` is the screen, drawn without the traits it asks for too,
  // which Design, where the previews are, says.
  const { macros, running } = runtime.previews
  const traits = running && gallery ? previewTraits(macros[0]!, request) : []

  return toResult(request, analysis, evaluation, renderTree, startedAt, evaluateMs, performance.now() - layoutStart, gallery?.pages, gallery?.notDrawn, [...traits, ...gallery?.warnings ?? []])
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

/** The pages the gallery drew, and a warning at each screen it couldn't draw. */
interface Gallery {
  readonly pages?: readonly PagePreview[]
  readonly notDrawn: readonly Diagnostic[]
  /** What running each screen it draws found, as the live screen's own warnings are (D11). */
  readonly warnings?: readonly Diagnostic[]
}

/** Why a screen is missing once the gallery's one step budget is spent. */
const BUDGET_SPENT = 'drawing the screens took all the time the preview gives the canvas'

/**
 * Every page, drawn on its own.
 *
 * The live root tree is reused when it is still on its main screen. A pushed or
 * presented live screen keeps running separately while the design gallery shows
 * its main page and related screens as independent phones.
 *
 * Each page is drawn on its own guard: one that stops, or lays out at a size the
 * canvas can't draw, is left out with a warning at its source, and the others still
 * draw. Every page shares one step budget, standalone design screens included, as a
 * fresh one each would multiply the worst case toward the worker's deadline; once it
 * is spent the rest are reported rather than tried, since each would stop on its
 * first step.
 */
function renderPages(
  request: CompileRequest,
  evaluation: EvaluationResult,
  active: RenderTree,
): Gallery {
  const pages = (evaluation.ui?.viewHierarchy ?? []).filter((layer) => layer.type === 'Page')
  if (!pages.length) return { notDrawn: [] }

  const out: PagePreview[] = []
  const notDrawn: Diagnostic[] = []
  const warnings: Diagnostic[] = []
  let spent = false
  /** Says a screen, or the screens a page opens, isn't drawn, and why. */
  const skip = (missing: string, source: SourceSpan | undefined, cause: unknown): void => {
    if (exhausts(cause)) spent = true
    const span = source ?? { file: request.files[0]?.id ?? '', start: 0, end: 0 }
    const reason = spent ? BUDGET_SPENT : typeof cause === 'string' ? cause : cause instanceof InvalidLayout || isFailure(cause) ? cause.message : toFailure(cause, span).message
    notDrawn.push({ span, severity: 'warning', code: spent ? 'execution_budget_exceeded' : 'runtime_trap', message: `${missing} on the Design canvas: ${reason}.` })
  }
  const screen = (name: string) => `"${name}" isn't drawn`
  const limit = Number.isFinite(request.galleryLimit) ? Math.max(1, Math.min(128, Math.floor(request.galleryLimit!))) : GALLERY_LIMIT
  // What the selection reveals is drawn on the pages, by the runtimes that draw them.
  const reveal = galleryReveal = { target: measureTarget, modifiers: new Map<SourceSpan, Revealable>() }
  const met = (ui: ResolvedUI) => {
    for (const modifier of ui.reveal?.modifiers ?? []) reveal.modifiers.set(modifier.span, modifier)
    return ui
  }
  const drawing = runtime.previewRuntime(measureTarget)
  const preview = drawing && !drawing.evaluation.failure ? drawing : null
  let remainingChildren = limit
  for (const [index, page] of pages.slice(0, limit).entries()) {
    if (spent) { skip(screen(page.name), page.source, null); continue }
    const isActive = page.page?.active === true
    try {
      const ui = preview?.runtime.resolvePage(preview.evaluation.views, index, true)
        ?? (isActive ? evaluation.ui : runtime.resolvePage(evaluation.views, index))
      if (!ui) continue
      warnings.push(...met(ui).warnings ?? [])
      const isLiveRoot = isActive && !evaluation.ui?.navigationBar?.canGoBack && !evaluation.ui?.overlay && !ui.reveal?.drawn
      const tree = isLiveRoot ? active : drawable(render(request, { ...evaluation, ui }, true, preview?.runtime))
      const layers = ui.viewHierarchy?.filter(layer => layer.id === page.id)
      out.push({
        id: page.id,
        rootId: page.id,
        kind: 'root',
        // Named as it is drawn, by its first screen, whatever the running app has pushed over it.
        name: layers?.[0]?.name ?? page.name,
        active: isActive,
        ...(page.source ? { source: page.source } : {}),
        ...(page.page?.handlerId ? { handlerId: page.page.handlerId } : {}),
        ...(page.page?.icon ? { icon: page.page.icon } : {}),
        viewHierarchy: layers ?? [page],
        tree,
      })
    } catch (error) {
      skip(screen(page.name), page.source, error)
      continue
    }
    if (!preview || !remainingChildren) continue
    let nested: readonly NestedPage[]
    try {
      nested = preview.runtime.resolveNestedPages(preview.evaluation.views, index, page.id, remainingChildren)
    } catch (error) {
      skip(`The screens ${page.name} opens aren't drawn`, page.source, error)
      continue
    }
    for (const child of nested) {
      if (!out.some(parent => parent.id === child.parentId)) continue
      if (spent || 'notDrawn' in child) { skip(screen(child.name), child.source, 'notDrawn' in child ? child.notDrawn : null); continue }
      try {
        const childTree = drawable(render(request, { ...preview.evaluation, ui: met(child.ui) }, true, preview.runtime))
        warnings.push(...child.ui.warnings ?? [])
        out.push({
          id: child.id, parentId: child.parentId, rootId: child.rootId,
          kind: child.kind, name: child.name, source: child.source, active: false,
          viewHierarchy: child.ui.viewHierarchy?.map(layer => ({ ...layer, id: child.id })),
          tree: childTree,
        })
      } catch (error) {
        skip(screen(child.name), child.source, error)
      }
    }
    remainingChildren -= nested.length
  }
  // Design screens nothing links to yet run in a program of their own, on what the
  // pages above left of the budget, and so does each `#Preview` the app doesn't run.
  let budget = DEFAULT_STEP_BUDGET - (preview?.runtime.stepsUsed ?? 0)
  /** Draws a page in a program of its own, and says whether it did. */
  const drawStandalone = (name: string, source: SourceSpan, id: string, kind: Extract<PagePreview['kind'], 'root' | 'preview'>, run: (budget: number) => ReturnType<AppRuntime['previewRuntime']>): boolean => {
    if (spent || budget <= 0) { spent = true; skip(screen(name), source, null); return false }
    const detached = run(budget)
    if (!detached) return false
    try {
      const failure = detached.evaluation.failure
      if (failure) {
        if (detached.runtime.stepsUsed >= budget) spent = true
        skip(screen(name), source, failure)
        return false
      }
      if (!detached.evaluation.ui) return false
      const tree = drawable(render(request, { ...detached.evaluation, ui: met(detached.evaluation.ui) }, true, detached.runtime))
      warnings.push(...detached.evaluation.ui.warnings ?? [])
      out.push({ id, rootId: id, kind, standalone: true, name, active: false, source,
        viewHierarchy: detached.evaluation.ui.viewHierarchy?.map(layer => ({ ...layer, id })), tree })
      return true
    } catch (error) {
      // A failed standalone screen does not invalidate the running app.
      if (detached.runtime.stepsUsed >= budget) spent = true
      skip(screen(name), source, error)
      return false
    } finally {
      budget -= detached.runtime.stepsUsed
    }
  }
  const renamedIds = new Map<string, string>()
  const views = pageViews(out)
  for (const design of (request.designScreens ?? []).slice(0, limit)) {
    const definition = lastAnalysis?.analysis.authoring.nodes.find(n => n.kind === 'definition' && n.name === design.view)
    if (!definition) continue
    const own = out.filter(page => views.get(page.id) === design.view)
    if (own.length) {
      const page = own[0]!, id = 'screen:' + design.view
      // A view drawing several pages, one list as two tabs, leaves each its own title.
      const name = own.length === 1 ? design.name : page.name
      renamedIds.set(page.id, id)
      out[out.indexOf(page)] = { ...page, id, name, viewHierarchy: page.viewHierarchy?.map(layer => ({ ...layer, id, name })) }
      continue
    }
    // A view holding tabs or sheets written in place is on the canvas already, around them.
    if (out.some(page => viewsDrawing(page).some(view => view.name === design.view))) continue
    drawStandalone(design.name, definition.source, 'screen:' + design.view, 'root', left => runtime.previewRuntime(measureTarget, design.view, left))
  }
  // Each `#Preview` the app doesn't run, named by its title, or after the one view it shows
  // where no other is named the same, or by its place.
  const { macros, running } = runtime.previews
  const previews = macros.slice(0, limit).flatMap((macro, index) => {
    const title = previewTitle(macro)
    const shown = shownView(macro.body?.statements ?? [], name => runtime.declaresView(name))
    // `#Preview { HomeScreen() }`, or one that gives it only its environment, beside an app that
    // draws HomeScreen, is that screen, already drawn. A titled one is a picture of its own.
    const drawn = !title && shown?.asIs && out.some(page => page.id === 'screen:' + shown.name || viewsDrawing(page).some(view => view.name === shown.name))
    return running && !index || drawn ? [] : [{ macro, index, title, name: title ?? shown?.name }]
  })
  for (const { macro, index, title, name } of previews) {
    const named = title ?? (name && previews.filter(other => other.name === name).length === 1 ? name : `Preview ${index + 1}`)
    if (drawStandalone(named, macro.span, `preview:${index + 1}`, 'preview', left => runtime.previewRuntime(measureTarget, undefined, left, index))) warnings.push(...previewTraits(macro, request))
  }
  return {
    pages: out.map(page => {
      // A design screen's page, and a standalone one, is its view's by its id.
      const view = page.id.startsWith('screen:') ? page.id.slice(7) : views.get(page.id)
      return { ...page, ...(view ? { view } : {}), rootId: renamedIds.get(page.rootId ?? '') ?? page.rootId, parentId: renamedIds.get(page.parentId ?? '') ?? page.parentId }
    }),
    notDrawn,
    warnings,
  }
}

/** A `#Preview`'s title, "Dark mode" in `#Preview("Dark mode")`, when it is written as plain text. */
function previewTitle(macro: MacroDecl): string | undefined {
  const title = macro.args[0]?.label ? undefined : macro.args[0]?.value
  return title?.kind === 'stringLiteral' && title.segments.every(segment => segment.kind === 'text') ? title.segments.map(segment => segment.value).join('') : undefined
}

/** A warning at each argument of a `#Preview` besides its title, `traits: .landscapeLeft`, which the preview draws it without. */
function previewTraits(macro: MacroDecl, request: CompileRequest): Diagnostic[] {
  const text = request.files.find(file => file.id === macro.span.file)?.text ?? ''
  return macro.args.filter(arg => arg.label).map(({ span }) => {
    const written = text.slice(span.start, span.end)
    return { span, severity: 'warning', code: 'unsupported_language_feature', feature: written, message: `The preview doesn't apply ${written} to this #Preview. Xcode's canvas does.` }
  })
}

/** A page whose layout has a size the canvas can't draw. */
class InvalidLayout extends Error {}

/** The tree, once every frame in it is a size the canvas can draw: finite, and not negative. */
function drawable(tree: RenderTree): RenderTree {
  if (tree.nodes.some((node) => !Object.values(node.frame).every(Number.isFinite) || node.frame.width < 0 || node.frame.height < 0)) {
    throw new InvalidLayout("its layout has a size the canvas can't draw")
  }
  return tree
}

/** Whether what stopped a screen is already a failure the runtime described. */
function isFailure(cause: unknown): cause is RuntimeFailure {
  return typeof cause === 'object' && cause !== null && !(cause instanceof Error) && 'message' in cause && 'span' in cause && 'kind' in cause
}

/** What every geometry reader in a tree was measured at, its size, place on the screen and safe area, keyed as it reported. */
function geometryFrom(tree: RenderTree): Map<string, GeometryPayload> {
  const measured = new Map<string, GeometryPayload>()
  // A sheet's nodes are prefixed with `overlay/`, and its readers are measured too.
  const readers = tree.nodes.filter((node) => node.id.includes('geo:'))
  if (readers.length === 0) return measured
  const byId = new Map(tree.nodes.map((node) => [node.id, node]))
  for (const node of readers) {
    // Where it is on the screen: its frame is in its parent's space, and so on up.
    let { x, y } = node.frame
    for (let up = node.parent ? byId.get(node.parent) : undefined; up; up = up.parent ? byId.get(up.parent) : undefined) {
      x += up.frame.x
      y += up.frame.y
    }
    measured.set(node.id.slice(node.id.indexOf('geo:') + 4), { width: node.frame.width, height: node.frame.height, x, y, insets: node.geometryInsets ?? ZERO_INSETS })
  }
  return measured
}


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
