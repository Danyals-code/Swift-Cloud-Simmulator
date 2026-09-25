'use client'

import { scenarioKey } from '../lib/screens'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RenderTreeView, symbolAsset, type EventSink, type InspectKeys } from '@studio/swiftui-render-dom'
import { stateProblem } from '../lib/stateProblem'
import { EMPTY_RENDER_TREE, type PagePreview, type PreviewScenario, type RenderNode, type RenderTree } from '@studio/shared'
import type { DeviceKey, DeviceSpec } from '@studio/sim-shell'
import styles from './Workspace.module.css'
import type { PreviewSettings } from '../lib/store'
import { Icon } from './ui/Icon'
import { Splitter } from './ui/Splitter'
import { PANE_LIMITS } from '../lib/layout'
import { AppearancePicker, DevicePicker, TextSizePicker, ZoomPicker } from './PreviewEnvironment'
import type { CanvasTool } from './Toolbar'
import type { AuthoringNode, NavigationDestination, DropPosition } from '@studio/shared'
import { CANVAS, canvasLayout, type CanvasArrow, type CanvasLayout } from '../lib/pageLayout'
import { useCompiler, type CompilerOptions } from '../lib/useCompiler'
import type { FeatureProps } from './AuthoringFeatures'
import { InlineTextEditor } from './InlineTextEditor'
import { PaneBoundary } from './PaneBoundary'

export interface DevicePaneProps {
  authoringFeatures?: Omit<FeatureProps, 'node'>
  /**
   * Design's right-hand panel: the settings for whatever is selected - the App, a
   * screen, or a view. Built by the workspace, which is what knows the selection.
   */
  settingsPanel?: React.ReactNode
  /** What the panel is showing, for its header: "App", a screen's name, a view's. */
  settingsTitle?: React.ReactNode
  /** A click on empty canvas, which in Design selects the App. */
  onSelectBackground?: () => void
  expanded?: boolean
  projectId: string
  previewIdentity?: string
  panelLayout: string
  /** Design's right-hand rail. Its width is a workspace preference, so it is passed in. */
  showSettings?: boolean
  settingsWidth?: number
  onSettingsResize?: (width: number) => void
  onToggleSettings?: () => void
  onDeviceChange: (key: DeviceKey) => void
  /** Design's preview environment pickers that the toolbar has no room for, drawn in the canvas heading (D15). */
  environment?: React.ReactNode
  tools?: React.ReactNode
  device: DeviceSpec
  tree: RenderTree | null
  /** Why the phone is dimmed: the code has errors or stopped, and `tree` is the last screen that ran. */
  notice?: NonNullable<RenderTree['notice']>
  /** Set while the preview has stopped: a tap anywhere on the phone starts it again, and presses nothing in it. */
  onRestart?: () => void
  /** Why each screen the gallery couldn't draw isn't drawn, as its warning says. */
  pagesNotDrawn?: readonly string[]
  /** The compile the canvas draws; a canvas that crashed tries again when it changes. */
  revision?: number
  /** What is selected, as it is drawn: the nodes of each view, outlined as one box (D1). */
  selectedRenderGroups?: readonly (readonly string[])[]
  /** What is outlined under the pointer: one box around each group, one view each. */
  hoveredRenderGroups?: readonly (readonly string[])[]
  stale: boolean
  /** Sends a preview event; resolves once the app has answered it, so a field can show the app's value again. */
  onEvent: EventSink
  inspecting: boolean
  /**
   * A click on the canvas while inspecting: everything drawn under the pointer, topmost
   * first, and the keys held. The workspace decides what that selects (D1).
   */
  onInspectSelect: (under: readonly RenderNode[], keys: InspectKeys, pageId?: string) => void
  /**
   * A double-click (D1): the text it edits, when the view under the pointer is text; the
   * workspace otherwise goes one level in, and answers null.
   */
  onInspectDoubleClick?: (under: readonly RenderNode[], pageId?: string) => InlineTextTarget | null
  /** What the pointer is over while inspecting, so the workspace can follow it. */
  onHoverNode?: (under: readonly RenderNode[] | null, pageId?: string) => void
  /**
   * Tab columns with each tab's related screens underneath.
   *
   * `pageCount` is how many the app actually has, which is the same number except
   * on an app with more pages than the pipeline draws - and then the difference is
   * said out loud rather than left as a shorter row.
   */
  pages?: readonly PagePreview[]
  /**
   * What the design canvas needs beyond the pages: the lanes' names, the states
   * saved under each screen, and what to compile to draw one.
   *
   * Passed in because the workspace is what knows the app's shape - the canvas only
   * places what it is given, and every position comes from the navigation.
   */
  canvas?: CanvasInputs
  navigationPicker?: {
    targets: Readonly<Record<string, { destination?: NavigationDestination; reason?: string }>>
    onPick: (page: PagePreview) => void
    onCancel: () => void
  }
  selectedPageId?: string
  pageCount?: number
  /** Focuses this phone for Layers and Settings. */
  onSelectPage?: (page: PagePreview) => void
  /** The gallery's own switch, in the canvas rather than the dock it draws into. */
  allPages?: boolean
  onToggleAllPages?: (on: boolean) => void
  /**
   * The debug area, when this canvas is the one it belongs under.
   *
   * Passed in rather than placed beside this pane, so that Problems runs the width
   * of the canvas and stops where the canvas stops: the settings rail is the other
   * side of the workspace and goes to the bottom of the window.
   */
  belowCanvas?: React.ReactNode
  /** What a click on the canvas means while designing. */
  tool?: CanvasTool
  /** The view that is selected, and what can be done to it from here. */
  selection?: {
    readonly name: string
    readonly type: string
    readonly canMoveUp: boolean
    readonly canMoveDown: boolean
    readonly canDelete: boolean
    /** Everything it paints, so a drag can start from anywhere inside it. */
    readonly renderIds?: readonly string[]
  } | null
  /**
   * A view dragged onto another one, which is a move in the file.
   *
   * The source is `'selection'` when the drag began inside what is selected: a
   * container paints through its children, so the node under the pointer is never
   * the container itself, and dragging a stack has to mean the stack.
   */
  onReorderNodes?: (source: readonly RenderNode[] | 'selection', over: readonly RenderNode[], position: DropPosition) => void
  /**
   * Where a drop onto this node would put what is dragged, or null where it cannot go
   * (D1): beside the view there at the dragged view's depth, drawn by `renderIds` and
   * laid along `axis`, or `inside` a stack whose own empty space - usually its
   * background - is under the pointer, which means "put it in here, at the end".
   */
  dropTargetAt?: (over: readonly RenderNode[], source: readonly RenderNode[] | 'selection') => CanvasDropTarget | null
  /** The page to bring into view, when Layers picks one. */
  centerOn?: { readonly id: string; readonly nonce: number } | null
  /** What the preview is doing, drawn at the head of the canvas. */
  status?: React.ReactNode
  preview: PreviewSettings
  onPreviewChange: (settings: Partial<PreviewSettings>) => void
}

/** Where a drop would go, as the canvas shows it while dragging. */
export interface CanvasDropTarget {
  readonly name: string
  readonly inside: boolean
  readonly axis: 'horizontal' | 'vertical'
  readonly renderIds: readonly string[]
}

/** The text a double-click edits in place, and the control it is written with. */
export interface InlineTextTarget { readonly node: AuthoringNode; readonly control: string; readonly value: string }

/** What the canvas draws besides the screens themselves. */
export interface CanvasInputs {
  /** One lane per tab, in tab order; the last lane holds screens nothing links to. */
  readonly laneNames: readonly string[]
  /** Which lane header shows which SF Symbol, by lane. */
  readonly laneIcons?: readonly (string | undefined)[]
  /** The screen a page draws, so a sheet opened from several screens is drawn once. */
  readonly sameScreen: (page: PagePreview) => string
  /** Narrows the canvas to one lane; undefined shows the whole app. */
  readonly visibleRootId?: string
  /** The states saved under a screen, drawn below it inside its frame. */
  readonly statesOf: (page: PagePreview) => readonly PreviewScenario[]
  /** The state the panel is editing, which is also the one the app is running. */
  readonly activeState?: string
  readonly onSelectState?: (page: PagePreview, state: PreviewScenario | null) => void
  /** Everything a state phone needs to compile, minus what the pane already knows. */
  readonly compile: Omit<CompilerOptions, 'device' | 'colorScheme' | 'typeScale' | 'dynamicTypeSize' | 'scenario' | 'allPages' | 'previewScreen'>
}

/** Chrome around the screen: bezel thickness plus breathing room in the pane. */
const BEZEL = 10
const PANE_PADDING = 28

/** How many state phones may be drawn at once, each being its own compile. */
const STATE_BUDGET = 8

/** How each arrow is drawn and labeled: the wording designers read on the canvas. */
const ARROWS: Readonly<Record<CanvasArrow['kind'], string>> = { root: 'Start', push: 'Push', sheet: 'Sheet', cover: 'Full screen', popover: 'Popover' }

/**
 * The device's own chrome sits above everything the app can draw.
 *
 * The app's layers run up to 200,000 - a navigation bar is placed at 100,000 and a
 * sheet at 200,000, so that bars paint over content and presentations over bars.
 * The status bar and the Dynamic Island are not layers in the app at all; they are
 * the hardware, and they were previously at 10,000 - underneath every navigation
 * bar, which is why a screen with one showed no clock and no island.
 */
const DEVICE_Z = 1_000_000

/**
 * The simulated device.
 *
 * The bezel, Dynamic Island, status bar and home indicator are all drawn in CSS.
 * Apple's device artwork is not licensed for redistribution (risk R2), and a CSS
 * frame has the side benefit of scaling cleanly to any zoom level.
 *
 * Appearance, Dynamic Type and zoom live on this pane's own bar rather than in the
 * toolbar. They describe how you are looking at the simulated app, so they belong
 * beside it - and a toolbar holding both "which device" and "how big is the text"
 * gives equal weight to a project setting and a viewing preference.
 */
export function DevicePane({
  authoringFeatures, settingsPanel, settingsTitle, onSelectBackground,
  expanded = false,
  projectId,
  previewIdentity = projectId,
  panelLayout,
  showSettings = true,
  settingsWidth = PANE_LIMITS.settings.initial,
  onSettingsResize,
  onToggleSettings,
  onDeviceChange,
  environment,
  tools,
  device,
  tree,
  notice,
  onRestart,
  pagesNotDrawn,
  revision,
  selectedRenderGroups,
  hoveredRenderGroups,
  stale,
  onEvent,
  inspecting,
  onInspectSelect,
  onInspectDoubleClick,
  onHoverNode,
  pages,
  canvas,
  selectedPageId,
  navigationPicker,
  pageCount,
  onSelectPage,
  allPages = false,
  onToggleAllPages,
  belowCanvas,
  tool = 'select',
  selection,
  onReorderNodes,
  dropTargetAt,
  centerOn,
  status,
  preview,
  onPreviewChange,
}: DevicePaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [pane, setPane] = useState({ width: 0, height: 0, left: 0, top: 0, arrangeWidth: 0, arrangeHeight: 0, panelLayout, expanded, projectId })
  const gallery = expanded && !!pages?.length
  const scrollMemory = useMemo(() => ({ identity: previewIdentity, positions: new Map<string, { left: number; top: number }>() }), [previewIdentity])
  const [hoveredNode, setHoveredNode] = useState<RenderNode | null>(null)

  /** What is under the pointer as of now, topmost first, for handlers that run outside React's render. */
  const hoverRef = useRef<readonly RenderNode[] | null>(null)

  // One call site for the hover, so the pane and the workspace cannot disagree
  // about what the pointer is over.
  const setHovered = useCallback((under: readonly RenderNode[] | null, pageId?: string) => {
    hoverRef.current = under
    setHoveredNode(under?.[0] ?? null)
    onHoverNode?.(under, pageId)
  }, [onHoverNode])

  // Derived rather than cleared in an effect: a stale highlight must not survive
  // leaving inspector mode, and "only meaningful while inspecting" is a property of
  // the value, not something to synchronise after the fact.
  const highlighted = inspecting && !stale && hoveredNode
    ? [tree, ...(pages?.map(page => page.tree) ?? [])].flatMap(tree => tree?.nodes ?? []).find(node => node.id === hoveredNode.id && node.origin?.file === hoveredNode.origin?.file && node.origin?.start === hoveredNode.origin?.start && node.origin?.end === hoveredNode.origin?.end) ?? null
    : null
  useEffect(() => () => setHovered(null), [inspecting, previewIdentity, projectId, setHovered])

  /**
   * The canvas is a viewport onto a world, not a box with scrollbars in it.
   *
   * Everything inside is laid out at its natural size and one transform decides
   * where and how big it appears. That is what makes panning free: there is no
   * scrollable extent to run out of, nothing to clip against, and a drag works the
   * same whether the content is bigger than the viewport or smaller. The scrolling
   * version could only pan when it had overflow, and hit its own edges when it did.
   *
   * The transform is written straight to the element rather than held in state.
   * Panning and zooming are continuous gestures, and re-rendering a phone full of
   * views on every wheel tick is how a canvas starts to feel like it is catching.
   */
  const worldRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef({ x: 0, y: 0, scale: 1 })

  const applyView = useCallback(() => {
    const world = worldRef.current
    if (!world) return
    const { x, y, scale } = viewRef.current
    world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
  }, [])
  /** A world drawn again after a crash picks up the view where the old one left it. */
  const attachWorld = useCallback((world: HTMLDivElement | null) => {
    worldRef.current = world
    applyView()
  }, [applyView])

  /**
   * The canvas: lanes of screens with each screen's states inside its frame.
   *
   * States cost a compile each, so they are drawn only where they are asked for -
   * one screen opened, or "Show all states" for the lot.
   */
  const [openStates, setOpenStates] = useState<ReadonlySet<string>>(() => new Set())
  const [collapsedLanes, setCollapsedLanes] = useState<ReadonlySet<number>>(() => new Set())
  const [showAllStates, setShowAllStates] = useState(false)
  // What is open belongs to the project and to this set of tabs. Carrying it across
  // leaves a different lane collapsed, or a screen open that no longer exists.
  const [canvasFor, setCanvasFor] = useState(`${projectId}:${canvas?.laneNames.length ?? 0}`)
  if (canvasFor !== `${projectId}:${canvas?.laneNames.length ?? 0}`) {
    setCanvasFor(`${projectId}:${canvas?.laneNames.length ?? 0}`)
    setOpenStates(new Set()); setCollapsedLanes(new Set()); setShowAllStates(false)
  }
  const phoneFrame = useMemo(() => ({ width: device.width + BEZEL * 2, height: device.height + BEZEL * 2 }), [device.width, device.height])
  const statesOf = canvas?.statesOf, laneNames = canvas?.laneNames, visibleRootId = canvas?.visibleRootId, sameScreen = canvas?.sameScreen

  /**
   * How many states are drawn, and where.
   *
   * Every state phone is a second compile of the project, so there is a budget: the
   * screens a designer opened come first, in canvas order, and the rest keep their
   * badge. Without it, "Show all states" on a real app starts thirty compilers.
   */
  const states = useMemo(() => {
    const drawn = new Map<string, number>()
    let left = STATE_BUDGET, held = 0
    for (const page of pages ?? []) {
      const own = statesOf?.(page).length ?? 0
      if (!own) continue
      const open = showAllStates || openStates.has(page.id)
      if (!open) continue
      drawn.set(page.id, Math.min(own, left))
      held += own - Math.min(own, left)
      left -= Math.min(own, left)
    }
    return { drawn, held }
  }, [pages, statesOf, showAllStates, openStates])

  const layout: CanvasLayout | null = useMemo(() => !gallery || !pages?.length ? null : canvasLayout(pages, {
    frame: phoneFrame,
    statesOf: page => statesOf?.(page).map(state => state.name) ?? [],
    expanded: openStates,
    showAllStates,
    collapsedLanes,
    laneNames: laneNames ?? [],
    budget: states.drawn,
    ...(visibleRootId ? { visibleRootId } : {}),
    ...(sameScreen ? { sameScreen } : {}),
  }), [gallery, pages, phoneFrame, statesOf, openStates, showAllStates, collapsedLanes, laneNames, states, visibleRootId, sameScreen])

  // A screen chosen in the tree cannot be shown while its lane is collapsed, so the
  // lane opens with it. Done as the request arrives rather than in an effect, so the
  // canvas is drawn once, already open.
  const [centredNonce, setCentredNonce] = useState(centerOn?.nonce ?? 0)
  if (centerOn && centerOn.nonce !== centredNonce) {
    setCentredNonce(centerOn.nonce)
    const lane = layout?.slots.find(slot => slot.page.id === centerOn.id)?.lane
    if (lane !== undefined && collapsedLanes.has(lane)) setCollapsedLanes(previous => {
      const next = new Set(previous)
      next.delete(lane)
      return next
    })
  }

  /** Whether the app has a state anywhere, which is what the switch is for. */
  const hasStates = !!pages?.some(page => statesOf?.(page).length)
  /** What the canvas is actually drawing, which is what its heading should say. */
  const drawnScreens = layout?.phones.filter(phone => !phone.state).length ?? pages?.length ?? 0

  /** The size of the world the canvas makes, which is what the zoom fits. */
  const arrangement = useMemo(
    () => layout ? { width: layout.width, height: layout.height } : { width: phoneFrame.width, height: phoneFrame.height },
    [layout, phoneFrame],
  )

  /**
   * Each arrow as a curve between two screens, labeled with how it navigates.
   *
   * It leaves the right edge of one screen and arrives at the left edge of the
   * next, curving rather than turning corners so that several arrows out of the
   * same screen stay apart. Arrows to a screen in a collapsed lane are dropped
   * with it: a line to nothing is worse than no line.
   */
  const arrowId = useId().replaceAll(':', '')
  const arrows = useMemo(() => {
    if (!layout) return []
    const at = new Map(layout.phones.filter(phone => !phone.state).map(phone => [phone.page.id, phone]))
    return layout.arrows.flatMap(arrow => {
      const from = at.get(arrow.from), to = at.get(arrow.to)
      if (!from || !to) return []
      const id = `${arrow.from}->${arrow.to}`, kind = arrow.kind
      const x1 = from.x + phoneFrame.width, y1 = from.y + phoneFrame.height / 2
      const x2 = to.x, y2 = to.y + phoneFrame.height / 2
      if (x2 >= x1) {
        const bend = Math.max(56, (x2 - x1) / 2)
        return [{ id, kind, d: `M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, label: { x: (x1 + 3 * (x1 + bend) + 3 * (x2 - bend) + x2) / 8, y: (y1 + y2) / 2 - 8 } }]
      }
      // A shared sheet sits in its own row, which can be back to the left of the
      // screen that opens it. Those arrows run down the page instead of doubling
      // back across it, leaving from the edge nearest the screen they point at.
      const down = to.y > from.y
      const ax = from.x + phoneFrame.width * 0.72, ay = down ? from.y + phoneFrame.height : from.y
      const bx = to.x + phoneFrame.width * 0.72, by = down ? to.y : to.y + phoneFrame.height
      const bend = Math.max(48, Math.abs(by - ay) / 2)
      return [{
        id, kind,
        d: `M${ax} ${ay} C${ax} ${down ? ay + bend : ay - bend}, ${bx} ${down ? by - bend : by + bend}, ${bx} ${by}`,
        label: { x: (ax + bx) / 2 + 26, y: (ay + by) / 2 },
      }]
    })
  }, [layout, phoneFrame])

  /** The zoom that fits the world in the viewport, never magnifying past 1:1. */
  const fitScale = useMemo(() => {
    if (pane.width <= 0 || pane.height <= 0) return 1
    return Math.min(
      1,
      (pane.width - PANE_PADDING * 2) / arrangement.width,
      (pane.height - PANE_PADDING * 2) / arrangement.height,
    )
  }, [pane.width, pane.height, arrangement.width, arrangement.height])

  const scale = preview.zoom === 'fit' ? fitScale : Number(preview.zoom)

  /** Puts the world in the middle of the viewport at the current zoom. */
  const centreView = useCallback(() => {
    viewRef.current = {
      x: (pane.width - arrangement.width * scale) / 2,
      y: (pane.height - arrangement.height * scale) / 2,
      scale,
    }
    applyView()
  }, [pane.width, pane.height, arrangement.width, arrangement.height, scale, applyView])

  // The viewport's own size, watched rather than read once: the panel is resizable
  // and the workspace it lives in changes shape around it.
  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const measure = () => {
      const { left, top } = element.getBoundingClientRect()
      const width = element.clientWidth, height = element.clientHeight
      setPane(previous => {
        const sameWorkspace = previous.expanded === expanded && previous.projectId === projectId
        const panelChanged = previous.panelLayout !== panelLayout && sameWorkspace && previous.width > 0
        const resized = previous.width !== width || previous.height !== height
        return { width, height, left, top, panelLayout, expanded, projectId,
          arrangeWidth: !sameWorkspace || (resized && !panelChanged) ? width : previous.arrangeWidth,
          arrangeHeight: !sameWorkspace || (resized && !panelChanged) ? height : previous.arrangeHeight }
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [panelLayout, expanded, projectId])

  /**
   * Fit re-centres; a chosen zoom keeps the middle of the viewport where it was.
   *
   * Without the second half, picking 100% from the menu would zoom about the world's
   * origin and throw the phone off the top-left corner.
   */
  const lastFit = useRef({ zoom: '', width: 0, height: 0, left: 0, top: 0, panelLayout, expanded, projectId, device: device.key, allPages })
  const liveOffset = useRef({ x: 0, y: 0 })
  const wasGallery = useRef(gallery)
  const pickingDestination = !!navigationPicker
  const beforeDestinationPick = useRef<{ projectId: string; device: string; view: { x: number; y: number; scale: number } } | null>(null)

  useLayoutEffect(() => {
    if (pane.width <= 0 || pane.panelLayout !== panelLayout || pane.expanded !== expanded || pane.projectId !== projectId) return
    const was = lastFit.current
    const resized = was.width !== pane.width || was.height !== pane.height
    const chosen = was.zoom !== preview.zoom
    lastFit.current = { zoom: preview.zoom, width: pane.width, height: pane.height, left: pane.left, top: pane.top, panelLayout, expanded, projectId, device: device.key, allPages }

    /**
     * Showing all the pages, or stopping, never moves the phone you are looking at.
     *
     * In the gallery a page sits in its own cell; on its own it sits at the world's
     * origin, and fitting one phone is a different zoom from fitting six. Left
     * alone, the live page would slide across the canvas and change size at the
     * moment the others appeared or vanished. So the zoom is frozen where it is and
     * the world is shifted by exactly the distance that page would have travelled:
     * the others come and go, and the one you are working on does not move.
     */
    const element = containerRef.current
    const live = element?.querySelector<HTMLElement>('[data-page-id][data-active]')
      ?? element?.querySelector<HTMLElement>('[data-canvas-phone]')
    const now = live ? { x: live.offsetLeft, y: live.offsetTop } : { x: 0, y: 0 }
    const moved = liveOffset.current
    liveOffset.current = now

    // Picking needs an overview of every screen. Keep this temporary camera
    // separate from the user's zoom preference and return to it on completion.
    if (pickingDestination) {
      beforeDestinationPick.current ??= { projectId, device: device.key, view: { ...viewRef.current } }
      viewRef.current = { x: (pane.width - arrangement.width * fitScale) / 2, y: (pane.height - arrangement.height * fitScale) / 2, scale: fitScale }
      wasGallery.current = gallery
      applyView()
      return
    }
    if (beforeDestinationPick.current) {
      const previous = beforeDestinationPick.current
      beforeDestinationPick.current = null
      if (previous.projectId === projectId && previous.device === device.key && expanded) {
        viewRef.current = previous.view
        wasGallery.current = gallery
        applyView()
        return
      }
    }

    const newWorkspace = was.expanded !== expanded || was.projectId !== projectId || !was.width
    if (!expanded || newWorkspace || was.device !== device.key) {
      wasGallery.current = gallery
      // Every Code preview and new project starts fitted and centered.
      if (newWorkspace && preview.zoom !== 'fit') onPreviewChange({ zoom: 'fit' })
      if (newWorkspace) {
        viewRef.current = { x: (pane.width - arrangement.width * fitScale) / 2, y: (pane.height - arrangement.height * fitScale) / 2, scale: fitScale }
        applyView()
      } else centreView()
      return
    }
    if (was.panelLayout !== panelLayout) {
      const current = viewRef.current
      viewRef.current = { ...current, x: current.x + was.left - pane.left, y: current.y + was.top - pane.top }
      applyView()
      if (preview.zoom === 'fit') onPreviewChange({ zoom: String(current.scale) })
      return
    }

    if (wasGallery.current !== gallery || was.allPages !== allPages) {
      wasGallery.current = gallery
      const current = viewRef.current
      viewRef.current = {
        ...current,
        x: current.x + (moved.x - now.x) * current.scale,
        y: current.y + (moved.y - now.y) * current.scale,
      }
      applyView()
      // Frozen at the scale it is being looked at, so fitting the new content cannot
      // resize it. Fit is one press away when it is wanted.
      if (preview.zoom === 'fit') onPreviewChange({ zoom: String(Number(current.scale.toFixed(4))) })
      return
    }

    // Fit re-centres when it is chosen and when the viewport changes shape - but not
    // when the *content* does: opening a screen's states makes the world taller, and
    // re-fitting it there would shrink and slide the screen under the pointer.
    if (preview.zoom === 'fit') { if (chosen || resized) centreView(); else applyView(); return }

    const current = viewRef.current
    if (current.scale === scale) { applyView(); return }
    // A chosen zoom keeps the middle of the viewport where it was; without this,
    // picking 100% would zoom about the world's origin and throw the phone off the
    // top-left corner.
    const ratio = scale / current.scale
    viewRef.current = {
      x: pane.width / 2 - (pane.width / 2 - current.x) * ratio,
      y: pane.height / 2 - (pane.height / 2 - current.y) * ratio,
      scale,
    }
    applyView()
  }, [pickingDestination, scale, preview.zoom, pane, gallery, allPages, selectedPageId, centreView, applyView, onPreviewChange, panelLayout, expanded, projectId, device.key, arrangement.width, arrangement.height, fitScale])

  /**
   * Scroll explores design phones; Ctrl/Meta-scroll zooms about the pointer.
   * Live Preview keeps native app scrolling. The non-passive listener prevents
   * the phone and canvas from scrolling together in Arrange.
   */
  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const onWheel = (event: WheelEvent) => {
      if (!expanded) return
      const zooming = event.ctrlKey || event.metaKey
      if (!zooming && inspecting && gallery) {
        event.preventDefault()
        const current = viewRef.current
        viewRef.current = { ...current, x: current.x - (event.shiftKey ? event.deltaY : event.deltaX), y: current.y - (event.shiftKey ? 0 : event.deltaY) }
        applyView()
        return
      }
      if (!zooming && !(inspecting && !gallery && !event.shiftKey)) return
      event.preventDefault()

      const current = viewRef.current
      // A gentle exponent, so a mouse's notch is a nudge rather than a jump:
      // zooming should feel like turning a dial, not changing gear.
      const next = Math.min(3, Math.max(0.1, current.scale * Math.exp(-event.deltaY / 900)))
      if (Math.abs(next - current.scale) < 0.0002) return

      // The point under the pointer stays under the pointer.
      const box = element.getBoundingClientRect()
      const x = event.clientX - box.left
      const y = event.clientY - box.top
      const ratio = next / current.scale
      viewRef.current = { x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio, scale: next }
      applyView()
      if (!pickingDestination) onPreviewChange({ zoom: String(Number(next.toFixed(4))) })
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [pickingDestination, expanded, inspecting, gallery, onPreviewChange, applyView])

  /**
   * Dragging a view onto another one moves it in the file.
   *
   * What is dragged is the *selection* when the press lands inside it, and otherwise
   * what a click there would select (D1): a whole card, or at the depth gone into. So a
   * whole list can be carried once it is selected, without the pointer having to find
   * its edge. The workspace works out both ends from what is under the pointer.
   */
  const viewDrag = useRef<{ node: readonly RenderNode[] | 'selection'; x: number; y: number } | null>(null)
  const [dragTarget, setDragTarget] = useState<{ name: string; position: DropPosition } | null>(null)

  const onViewPointerDown = useCallback((event: React.PointerEvent) => {
    if (navigationPicker || !expanded || stale || !inspecting || tool !== 'select' || !onReorderNodes || event.button !== 0) return
    const element = containerRef.current
    if (!element) return

    const within = (selection?.renderIds ?? []).some((id) => {
      const box = element.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
      return !!box
        && event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom
    })

    const node = within ? 'selection' : hoverRef.current
    if (!node?.length) return
    viewDrag.current = { node, x: event.clientX, y: event.clientY }
  }, [navigationPicker, expanded, stale, inspecting, tool, onReorderNodes, selection])

  useEffect(() => {
    // Worked out again only when what is under the pointer changes, not at every move.
    let cached: { over: readonly RenderNode[]; source: readonly RenderNode[] | 'selection'; target: CanvasDropTarget | null } | null = null
    /** What the drop would do, from where the pointer is over the view it would go beside. */
    const dropAt = (event: PointerEvent, source: readonly RenderNode[] | 'selection') => {
      const over = hoverRef.current
      if (!over?.length) return null
      if (cached?.over !== over || cached.source !== source) cached = { over, source, target: dropTargetAt?.(over, source) ?? null }
      const target = cached.target
      if (!target) return null
      if (target.inside) return { node: over, name: target.name, position: 'inside' as const }
      const boxes = target.renderIds.flatMap(id => containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? [])
      const across = target.axis === 'horizontal'
      const start = Math.min(...boxes.map(box => across ? box.left : box.top)), end = Math.max(...boxes.map(box => across ? box.right : box.bottom))
      return {
        node: over,
        name: target.name,
        position: (boxes.length && (across ? event.clientX : event.clientY) > (start + end) / 2 ? 'after' : 'before') as 'before' | 'after',
      }
    }

    const moved = (event: PointerEvent, drag: { x: number; y: number }) =>
      Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) >= 6

    const move = (event: PointerEvent) => {
      const drag = viewDrag.current
      if (!drag || !moved(event, drag)) return
      const drop = dropAt(event, drag.node)
      setDragTarget(drop ? { name: drop.name, position: drop.position } : null)
    }

    const up = (event: PointerEvent) => {
      const drag = viewDrag.current
      viewDrag.current = null
      setDragTarget(null)
      if (!drag || !moved(event, drag)) return
      const drop = dropAt(event, drag.node)
      if (drop) onReorderNodes?.(drag.node, drop.node, drop.position)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [onReorderNodes, dropTargetAt])

  /**
   * Dragging the canvas moves it, from anywhere that is not a phone.
   *
   * The middle button and space-drag work over the phones too, which is the escape
   * hatch for a canvas zoomed in far enough that the phone covers the viewport.
   */
  const panning = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null)
  const [grabbing, setGrabbing] = useState(false)
  /** Space, held: the canvas becomes grabbable from anywhere, as it does everywhere else. */
  const spaceRef = useRef(false)
  const skipNavigationPickClick = useRef(false)

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"], .cm-editor')) return
      spaceRef.current = true
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') spaceRef.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    const blur = () => { spaceRef.current = false }
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  /** Where a press on empty canvas began, so a click can be told from a pan. */
  const backgroundPress = useRef<{ x: number; y: number } | null>(null)
  const onPanStart = useCallback((event: React.PointerEvent) => {
    if (!expanded) return
    const background = event.target === event.currentTarget || (event.target as HTMLElement).dataset.world !== undefined || (event.target as HTMLElement).dataset.canvasBackground !== undefined
    backgroundPress.current = background && event.button === 0 && !spaceRef.current ? { x: event.clientX, y: event.clientY } : null
    // Middle-drag and space-drag work over the phones too, which is the way out of a
    // canvas zoomed in far enough that a phone covers the whole viewport.
    if (event.button === 1 || (event.button === 0 && (background || spaceRef.current))) {
      panning.current = { x: event.clientX, y: event.clientY, from: { x: viewRef.current.x, y: viewRef.current.y } }
      setGrabbing(true)
    }
  }, [expanded])
  const onBackgroundUp = useCallback((event: React.PointerEvent) => {
    const press = backgroundPress.current
    backgroundPress.current = null
    if (!press || !inspecting || navigationPicker || Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) > 4) return
    onSelectBackground?.()
  }, [inspecting, navigationPicker, onSelectBackground])

  useEffect(() => {
    if (!grabbing) return
    const move = (event: PointerEvent) => {
      const drag = panning.current
      if (!drag) return
      viewRef.current = {
        ...viewRef.current,
        x: drag.from.x + (event.clientX - drag.x),
        y: drag.from.y + (event.clientY - drag.y),
      }
      applyView()
    }
    const up = () => { panning.current = null; setGrabbing(false) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [grabbing, applyView])

  /**
   * Bringing a page into view when Layers picks one.
   *
   * By nonce rather than by id, so choosing the same page twice re-centres it: the
   * second press means "show me that one" just as much as the first did.
   */
  useEffect(() => {
    if (!expanded || !centerOn) return
    const element = containerRef.current
    const card = element?.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(centerOn.id)}"]`)
      ?? element?.querySelector<HTMLElement>('[data-canvas-phone]')
    if (!element || !card) return
    // Offsets are in the world's own coordinates, which is the space the transform
    // is expressed in - so this does not depend on where the canvas is right now.
    const { scale: at } = viewRef.current
    viewRef.current = {
      x: element.clientWidth / 2 - (card.offsetLeft + card.offsetWidth / 2) * at,
      y: element.clientHeight / 2 - (card.offsetTop + card.offsetHeight / 2) * at,
      scale: at,
    }
    applyView()
  }, [centerOn, expanded, applyView])

  const [inlineText, setInlineText] = useState<{ node: AuthoringNode; control: string; value: string; x: number; y: number; width: number } | null>(null)
  const inlineEditor = inlineText && inspecting && authoringFeatures?.onNodeChange ? <InlineTextEditor key={`${inlineText.node.id}:${inlineText.control}`} {...inlineText} onClose={() => setInlineText(null)} onSave={value => authoringFeatures.onNodeChange!(inlineText.node, inlineText.control, value)} /> : null
  const screenFor = (tree: RenderTree | null, live: boolean, at: number, page?: PagePreview) => (
    <div style={{ colorScheme: preview.colorScheme, position: 'absolute', top: 0, left: 0, transform: `scale(${at})`, transformOrigin: 'top left' }}>
      <DeviceFrame device={device}>
        <RenderTreeView
          key={scrollMemory.identity}
          scrollPositions={scrollMemory.positions}
          tree={tree ?? EMPTY_RENDER_TREE}
          {...(selectedRenderGroups ? { selectedGroups: selectedRenderGroups } : {})}
          {...(inspecting && !stale && hoveredRenderGroups ? { hoveredGroups: hoveredRenderGroups } : {})}
          {...(live ? { onEvent } : {})}
          stale={stale}
          {...(inspecting && !navigationPicker
            ? {
                inspect: {
                  // Design outlines what a click would select, which the workspace works out (D1).
                  hovered: expanded ? null : highlighted?.id ?? null,
                  onHover: under => setHovered(under, page?.id),
                  onSelect: (under, keys) => onInspectSelect(under, keys, page?.id),
                  onDoubleClick: (under, rect) => {
                    if (stale || tool !== 'select') return
                    const text = onInspectDoubleClick?.(under, page?.id)
                    if (text) setInlineText({ ...text, x: rect.x, y: rect.y, width: rect.width })
                  },
                },
              }
            : {})}
        />
        {live && notice ? <p className={styles.stateProblem} role="status">{notice.title}: {notice.detail}</p> : null}
        {live && onRestart ? <button type="button" className={styles.restartPhone} aria-label="Start the preview again" onClick={onRestart} /> : null}
        <StatusBar device={device} colorScheme={preview.colorScheme} />
        {device.hasDynamicIsland ? <DynamicIsland device={device} /> : null}
        {device.homeIndicator ? <HomeIndicator device={device} colorScheme={preview.colorScheme} /> : null}
      </DeviceFrame>
    </div>
  )

  const devicePicker = <DevicePicker device={device} onChange={onDeviceChange} />
  const schemePicker = <AppearancePicker preview={preview} onChange={onPreviewChange} />
  const typePicker = <TextSizePicker preview={preview} onChange={onPreviewChange} />
  const zoomPicker = <ZoomPicker preview={preview} scale={scale} onChange={onPreviewChange} />

  const collapsePanel = <button type="button" className={styles.panelToggle} data-testid="pane-toggle-preview" aria-pressed="true" aria-label={expanded ? 'Collapse preview settings' : 'Collapse preview'} title={expanded ? 'Collapse preview settings' : 'Collapse preview'} onClick={onToggleSettings}><Icon name="sidebar-right" size={16} /></button>

  return (<>
    {inlineEditor}
    <section className={styles.preview} aria-label="Preview" data-expanded={expanded}>
      <div className={styles.stage}>
      {expanded ? <div className={styles.canvasHeading}>
        {status}
        <span>
          {/* A hint while nothing is under way: the first thing a narrow window does without. */}
          <span className={styles.headingHint} data-idle={!navigationPicker && !dragTarget || undefined}>{
            navigationPicker
              ? 'Pick a highlighted screen · Escape to cancel'
              : dragTarget
              ? `Drop ${dragTarget.position} ${dragTarget.name}`
              : gallery
              ? pagesNotDrawn?.length
                // The reasons are here, a hover away, and in the warnings list beside the status (D11).
                ? <>{drawnScreens} {drawnScreens === 1 ? 'screen' : 'screens'} · <span className={styles.notDrawn} tabIndex={0} title={pagesNotDrawn.join('\n')} data-testid="pages-not-drawn">{pagesNotDrawn.length} not drawn</span></>
                : drawnScreens < (pageCount ?? pages!.length)
                ? `${drawnScreens} of ${pageCount ?? pages!.length} screens · scroll to explore`
                : `${drawnScreens} ${drawnScreens === 1 ? 'screen' : 'screens'} · scroll to explore · ⌘/Ctrl-scroll to zoom`
              : inspecting ? 'Click to select · double-click to go in · ⌘-click for the innermost' : 'Interactive preview'
          }</span>
          {navigationPicker && <button type="button" className={styles.cancelPick} onClick={navigationPicker.onCancel}>Cancel pick</button>}
          {/* Off in Live Preview, and said so rather than hidden: it is a thing the
              canvas can do, in the mode where a click means "open this page". */}
          <label className={styles.showAll} data-disabled={!inspecting || undefined} title={inspecting ? 'Show all screens and their connected destinations (⌘⇧A)' : 'Switch to Edit to explore screens'}>
            <input type="checkbox" data-testid="show-all-pages" checked={allPages && inspecting} disabled={!inspecting || !!navigationPicker} onChange={(event) => onToggleAllPages?.(event.target.checked)} />
            Show all screens
          </label>
          {/* Every state at once, for a walk through the whole app. Each state is
              its own compile, so it is a switch rather than the default. */}
          {canvas && <label className={styles.showAll} data-disabled={!hasStates || undefined} title={hasStates ? 'Draw every saved state under its screen' : 'Add a state to a screen in its settings first'}>
            <input type="checkbox" data-testid="show-all-states" checked={showAllStates && hasStates} disabled={!hasStates} onChange={event => setShowAllStates(event.target.checked)} />
            Show all states
          </label>}
          {!!states.held && <span title="Each state is drawn by compiling the project again, so the canvas draws a few at a time.">{states.held} more {states.held === 1 ? 'state' : 'states'} not drawn</span>}
          {environment && <span className={styles.headingEnvironment} role="group" aria-label="Preview environment">{environment}</span>}
          {zoomPicker}
        </span>
      </div> : <header className={styles.compactSettings}>{collapsePanel}{devicePicker}{schemePicker}{typePicker}{zoomPicker}</header>}
      <div className={styles.canvasArea}>
      <div
        ref={containerRef}
        className={`${styles.canvas} relative min-h-0 flex-1 overflow-hidden`}
        style={{ cursor: grabbing ? 'grabbing' : navigationPicker ? 'crosshair' : undefined }}
        data-testid="device-pane"
        data-fixed={!expanded}
        data-tool={inspecting ? tool : undefined}
        data-dragging={dragTarget ? true : undefined}
        onPointerDown={(event) => { skipNavigationPickClick.current = event.button === 1 || spaceRef.current; onPanStart(event); onViewPointerDown(event) }}
        onPointerUp={onBackgroundUp}
        // The pointer can leave the device without crossing any node's boundary -
        // straight off the bezel - so the pane itself has to clear the highlight.
        onPointerLeave={() => setHovered(null)}
      >
        {/* The world. Everything in it is laid out at its natural size and this one
            transform decides where and how big it appears, which is what lets the
            canvas be panned anywhere and zoomed about the pointer. */}
        <PaneBoundary area="canvas" resetKeys={[revision, inspecting]}>
        <div ref={attachWorld} data-world className={styles.world}>
          {gallery && layout ? (
            <div
              className={styles.flow}
              data-canvas-background
              data-testid="page-gallery"
              style={{ width: layout.width, height: layout.height }}
            >
              {/* A lane per tab, in tab order. Collapsing one leaves its header, so an
                  app with six tabs can be read one tab at a time. */}
              {layout.lanes.map(lane => {
                const icon = canvas?.laneIcons?.[lane.index]
                const asset = icon ? symbolAsset(icon, `lane-${lane.index}`) : null
                return <div key={lane.index} className={styles.lane} data-canvas-background data-collapsed={lane.collapsed || undefined} style={{ top: lane.y, height: lane.height, width: layout.width }}>
                  <button
                    type="button"
                    className={styles.laneHeader}
                    data-testid="canvas-lane"
                    aria-expanded={!lane.collapsed}
                    title={lane.collapsed ? `Show ${lane.name}` : `Collapse ${lane.name}`}
                    onClick={() => setCollapsedLanes(previous => {
                      const next = new Set(previous)
                      if (!next.delete(lane.index)) next.add(lane.index)
                      return next
                    })}
                  >
                    <Icon name="chevron-down" size={11} />
                    {asset && <svg viewBox={asset.viewBox} width="13" height="13" aria-hidden="true" dangerouslySetInnerHTML={{ __html: asset.body }} />}
                    <span>{lane.name}</span>
                    <small>{lane.screens} {lane.screens === 1 ? 'screen' : 'screens'}</small>
                  </button>
                </div>
              })}
              {/* Navigation, drawn: solid for a push, dashed for anything presented
                  over the screen, and labeled so the line needs no legend. */}
              <svg className={styles.flowArrows} width={layout.width} height={layout.height} aria-hidden="true">
                <defs><marker id={`${arrowId}-head`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="currentColor" stroke="none" /></marker></defs>
                {arrows.map(arrow => <g key={arrow.id}>
                  <path d={arrow.d} data-kind={arrow.kind} markerEnd={`url(#${arrowId}-head)`} />
                  <text x={arrow.label.x} y={arrow.label.y} textAnchor="middle">{ARROWS[arrow.kind]}</text>
                </g>)}
              </svg>
              {/* The screen frame: everything inside it is a state of that screen. */}
              {layout.frames.filter(frame => frame.states.length).map(frame => (
                <div key={`frame:${frame.page.id}`} className={styles.screenFrame} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}>
                  <button
                    type="button"
                    className={styles.statesBadge}
                    data-testid="states-badge"
                    aria-expanded={frame.expanded}
                    disabled={showAllStates}
                    title={showAllStates ? 'Every state is shown · turn off “Show all states” to close them' : frame.expanded ? `Hide the states of ${frame.page.name}` : `Show the states of ${frame.page.name}`}
                    onClick={() => setOpenStates(previous => {
                      const next = new Set(previous)
                      if (!next.delete(frame.page.id)) next.add(frame.page.id)
                      return next
                    })}
                  >{frame.expanded && showAllStates ? `${frame.states.length} ${frame.states.length === 1 ? 'state' : 'states'}` : frame.expanded ? 'Hide states' : `+${frame.states.length} ${frame.states.length === 1 ? 'state' : 'states'}`}</button>
                </div>
              ))}
              {layout.phones.map(({ page, state, x, y }) => {
                const scenario = state ? statesOf?.(page).find(saved => saved.name === state) : undefined
                return scenario && canvas
                ? <div key={`${page.id}:${scenario.name}`} className={styles.statePhone} style={{ left: x, top: y, width: phoneFrame.width, height: phoneFrame.height + CANVAS.caption }} data-page-id={page.id} data-state={scenario.name}>
                    <StatePhone
                      page={page}
                      scenario={scenario}
                      options={canvas.compile}
                      device={device}
                      preview={preview}
                      active={canvas.activeState === scenarioKey(scenario)}
                      {...(canvas.onSelectState ? { onSelect: () => canvas.onSelectState!(page, scenario) } : {})}
                      draw={tree => screenFor(tree, false, 1, page)}
                    />
                  </div>
                : state ? null
                : <figure key={page.id} className={styles.pageCard} style={{ left: x, top: y, width: phoneFrame.width, height: phoneFrame.height + CANVAS.caption }} data-active={page.id === selectedPageId || undefined} data-page-id={page.id} data-parent-page={page.parentId} data-page-kind={page.kind ?? 'root'} data-testid="gallery-page">
                  <div style={{ position: 'relative', width: device.width + BEZEL * 2, height: device.height + BEZEL * 2 }}>
                    {screenFor(page.tree, false, 1, page)}
                    {navigationPicker && <button
                      type="button"
                      className={styles.navigationPickTarget}
                      data-testid="navigation-pick-target"
                      data-available={!!navigationPicker.targets[page.id]?.destination}
                      aria-label={`Navigate to ${page.name}`}
                      aria-disabled={!navigationPicker.targets[page.id]?.destination}
                      title={navigationPicker.targets[page.id]?.destination ? `Choose ${page.name}` : navigationPicker.targets[page.id]?.reason}
                      onClick={event => { if (event.detail && skipNavigationPickClick.current) return; if (navigationPicker.targets[page.id]?.destination) navigationPicker.onPick(page) }}
                    ><span style={{ fontSize: 12 / Math.max(fitScale, 0.1), padding: `${6 / Math.max(fitScale, 0.1)}px ${8 / Math.max(fitScale, 0.1)}px` }}>{navigationPicker.targets[page.id]?.destination ? `Choose ${page.name}` : navigationPicker.targets[page.id]?.reason}</span></button>}

                  </div>
                  <figcaption><button type="button" onClick={event => {
                    if (navigationPicker) { if (event.detail && skipNavigationPickClick.current) return; if (navigationPicker.targets[page.id]?.destination) navigationPicker.onPick(page); return }
                    onSelectPage?.(page)
                    // This phone is the screen with the app's own data, so choosing it
                    // also steps out of whichever state was being shown.
                    if (canvas?.activeState && statesOf?.(page).some(state => scenarioKey(state) === canvas.activeState)) canvas.onSelectState?.(page, null)
                  }} aria-label={`Edit ${page.name}`} title={page.parentId ? `Reached from ${pages!.find(parent => parent.id === page.parentId)?.name ?? 'another screen'}` : 'Screen'}>{page.name}</button>{page.id === selectedPageId ? <span className={styles.liveTag}>Editing</span> : null}</figcaption>
                </figure>
              })}
            </div>
          ) : (
            <div
              data-canvas-phone
              style={{ position: 'relative', width: device.width + BEZEL * 2, height: device.height + BEZEL * 2 }}
            >
              {screenFor(tree, true, 1)}
            </div>
          )}
        </div>
        </PaneBoundary>
      </div>

      <footer className={styles.canvasFooter}>{tools}</footer>
      </div>
      {belowCanvas}
      </div>
      {expanded && showSettings && <div className={styles.settingsSplit}><Splitter
        orientation="col"
        size={settingsWidth}
        onResize={(size) => onSettingsResize?.(size)}
        min={PANE_LIMITS.settings.min}
        max={PANE_LIMITS.settings.max}
        direction={-1}
        label="Preview settings width"
        onToggle={onToggleSettings}
      /></div>}
      {/* The width is a variable rather than a style so the narrow-window rule,
          which stacks the rail above the canvas at full width, can still win. */}
      {expanded && showSettings && <aside className={styles.properties} style={{ '--settings-width': `${settingsWidth}px` } as React.CSSProperties} aria-label="Settings">
        {/* One panel, for whatever is selected: the App, a screen or a view. What
            the preview is showing - device, appearance, text size - is the top
            bar's, because it applies to every screen at once. */}
        <header className={styles.settingsHeader}>
          <span data-testid="settings-title">{settingsTitle ?? 'Settings'}</span>
          {collapsePanel}
        </header>
        <div className={styles.designerSettings} data-testid="inspector-settings">
          {settingsPanel}
        </div>
      </aside>}
      {expanded && !showSettings && <div className={styles.panelRail}><button type="button" className={styles.panelToggle} data-testid="pane-toggle-preview" aria-pressed="false" aria-label="Show preview settings" title="Show preview settings" onClick={onToggleSettings}><Icon name="sidebar-right" size={16} /></button></div>}
    </section>
  </>)
}

/**
 * One saved state, drawn as its own phone under its screen.
 *
 * A state is a set of preview inputs rather than a copy of the screen, so it is
 * drawn by compiling the project again with those values: whatever the code does
 * with an empty list is what the Empty state shows, and editing the screen's
 * layout changes every state at once because there is only one screen.
 */
function StatePhone({ page, scenario, options, device, preview, active, onSelect, draw }: {
  page: PagePreview
  scenario: PreviewScenario
  options: CanvasInputs['compile']
  device: DeviceSpec
  preview: PreviewSettings
  active: boolean
  onSelect?: () => void
  draw: (tree: RenderTree | null) => React.ReactNode
}) {
  const { result, stale, workerError } = useCompiler({
    ...options,
    device,
    colorScheme: preview.colorScheme,
    typeScale: preview.typeScale,
    ...(preview.dynamicTypeSize ? { dynamicTypeSize: preview.dynamicTypeSize } : {}),
    scenario,
    allPages: true,
  })
  const tree = result?.pages?.find(item => item.id === page.id)?.tree ?? null
  const problem = stateProblem({ page: page.name, compiled: !!result, diagnostics: result?.diagnostics ?? [], drawn: !!tree, stale, workerError })
  return (
    <figure className={styles.pageCard} data-testid="canvas-state" data-state={scenario.name} data-active={active || undefined}>
      <div style={{ position: 'relative', width: device.width + BEZEL * 2, height: device.height + BEZEL * 2 }} data-busy={!tree || stale || undefined}>
        {draw(tree)}
        {problem ? <p className={styles.stateProblem} role="status">{problem}</p> : null}
      </div>
      <figcaption>
        <button type="button" onClick={onSelect} disabled={!onSelect} title={`Show the ${scenario.name} state in the app and its settings`}>{scenario.name}</button>
        {active ? <span className={styles.liveTag}>Editing</span> : null}
      </figcaption>
    </figure>
  )
}

/**
 * The bezel.
 *
 * Titanium rather than the silver gradient this used to draw: a real iPhone's
 * frame is near-black and reads as a thin dark rim, and a bright bevel around a
 * simulated screen pulls the eye to the chrome instead of to the app. The band of
 * lighter grey along the top edge is the one specular cue worth keeping - without
 * it the device reads as a flat rectangle with rounded corners.
 */
function DeviceFrame({ device, children }: { device: DeviceSpec; children: React.ReactNode }) {
  return (
    <div
      data-testid="device-frame"
      style={{
        position: 'relative',
        width: device.width + BEZEL * 2,
        height: device.height + BEZEL * 2,
        padding: BEZEL,
        boxSizing: 'border-box',
        borderRadius: device.cornerRadius + BEZEL,
        background: 'linear-gradient(150deg, #55555c 0%, #26262a 12%, #1c1c1f 50%, #303036 100%)',
        boxShadow: [
          '0 18px 40px rgb(25 25 35 / 0.12)',
          '0 2px 8px rgb(25 25 35 / 0.1)',
          '0 0 0 1px rgb(255 255 255 / 0.07)',
          'inset 0 1px 1px rgb(255 255 255 / 0.14)',
        ].join(', '),
      }}
    >
      <div
        style={{
          position: 'relative',
          width: device.width,
          height: device.height,
          borderRadius: device.cornerRadius,
          overflow: 'hidden',
          background: '#ffffff',
          // A hairline where the glass meets the frame, which is what stops the
          // screen from looking painted onto the bezel.
          boxShadow: 'inset 0 0 0 0.5px rgb(0 0 0 / 0.5)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * The status bar.
 *
 * 9:41 rather than the wall clock. It is what every Apple screenshot and every
 * Xcode preview shows, so a simulator reading 14:07 looks wrong to anybody who has
 * seen one - and a clock that ticks makes two screenshots of the same state differ.
 */
function StatusBar({ device, colorScheme }: { device: DeviceSpec; colorScheme: 'light' | 'dark' }) {
  const tint = colorScheme === 'dark' ? '#ffffff' : '#000000'
  const island = device.hasDynamicIsland

  return (
    <div
      data-testid="status-bar"
      style={{
        position: 'absolute',
        inset: '0 0 auto 0',
        height: device.statusBarHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        // The island splits the bar; the time sits in the left gap and the
        // indicators in the right one.
        padding: island ? '0 20px 0 30px' : '0 8px',
        paddingTop: island ? 14 : 0,
        fontSize: island ? 16 : 14,
        fontWeight: 600,
        letterSpacing: '-0.2px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
        color: tint,
        pointerEvents: 'none',
        zIndex: DEVICE_Z,
      }}
    >
      <span>9:41</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <SignalBars />
        <WifiGlyph />
        <BatteryGlyph />
      </span>
    </div>
  )
}

function SignalBars() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={i * 4.6}
          y={11 - (i + 1) * 2.55}
          width="3.2"
          height={(i + 1) * 2.55}
          rx="1.1"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

function WifiGlyph() {
  return (
    <svg width="17" height="12" viewBox="0 0 17 12" aria-hidden>
      <path
        d="M8.5 10.9 6.05 8.2a3.55 3.55 0 0 1 4.9 0L8.5 10.9Zm0-5.35a6.2 6.2 0 0 0-4.4 1.83L2.55 5.75a8.4 8.4 0 0 1 11.9 0l-1.55 1.63A6.2 6.2 0 0 0 8.5 5.55Z"
        fill="currentColor"
      />
    </svg>
  )
}

function BatteryGlyph() {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden>
      <rect
        x="0.6"
        y="0.6"
        width="22.8"
        height="11.8"
        rx="3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.38"
      />
      <rect x="2.2" y="2.2" width="19.6" height="8.6" rx="2.2" fill="currentColor" />
      <path
        d="M24.9 4.4c1 .3 1.4 1.1 1.4 2.1s-.4 1.8-1.4 2.1V4.4Z"
        fill="currentColor"
        opacity="0.38"
      />
    </svg>
  )
}

/** iPhone 15's island: 125 x 36.7 pt, 11 pt below the top edge. */
function DynamicIsland({ device }: { device: DeviceSpec }) {
  const width = 125
  const height = 37
  return (
    <div
      data-testid="dynamic-island"
      style={{
        position: 'absolute',
        top: 11,
        left: Math.round(device.width / 2 - width / 2),
        width,
        height,
        borderRadius: height / 2,
        background: '#000',
        pointerEvents: 'none',
        zIndex: DEVICE_Z + 2,
      }}
    />
  )
}

/**
 * The home indicator.
 *
 * Tinted against the appearance rather than always black: on a dark screen a black
 * bar is invisible, and iOS inverts it for exactly that reason.
 */
function HomeIndicator({
  device,
  colorScheme,
}: {
  device: DeviceSpec
  colorScheme: 'light' | 'dark'
}) {
  const width = 140
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        left: Math.round(device.width / 2 - width / 2),
        width,
        height: 5,
        borderRadius: 2.5,
        background: colorScheme === 'dark' ? 'rgb(255 255 255 / 0.65)' : 'rgb(0 0 0 / 0.75)',
        pointerEvents: 'none',
        zIndex: DEVICE_Z + 1,
      }}
    />
  )
}
