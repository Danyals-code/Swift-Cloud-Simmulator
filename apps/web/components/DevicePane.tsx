'use client'

import { DYNAMIC_TYPE_SIZES, dynamicTypeForScale, type DynamicTypeSize } from '@studio/shared'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { EMPTY_RENDER_TREE, type PagePreview, type RenderNode, type RenderTree, type UIEvent } from '@studio/shared'
import { DEVICE_LIST, type DeviceKey, type DeviceSpec } from '@studio/sim-shell'
import styles from './Workspace.module.css'
import type { PreviewSettings } from '../lib/store'
import { PopupButton, type MenuItem } from './ui/Menu'
import { SegmentedControl } from './ui/Control'
import { Icon } from './ui/Icon'
import { Splitter } from './ui/Splitter'
import { PANE_LIMITS, type InspectorTab } from '../lib/layout'
import type { CanvasTool } from './Toolbar'
import type { AuthoringNode, SourceSpan } from '@studio/shared'
import { AuthoringInspector } from './AuthoringInspector'

export interface DevicePaneProps {
  onChangeAuthoring?: (control: string, value: string) => Promise<string | null>
  authoringNode?: AuthoringNode
  onRevealAuthoring?: (span: SourceSpan) => void
  expanded?: boolean
  projectId: string
  panelLayout: string
  /** Design's right-hand rail. Its width is a workspace preference, so it is passed in. */
  showSettings?: boolean
  settingsWidth?: number
  onSettingsResize?: (width: number) => void
  onToggleSettings?: () => void
  onDeviceChange: (key: DeviceKey) => void
  tools?: React.ReactNode
  device: DeviceSpec
  tree: RenderTree | null
  selectedRenderIds?: ReadonlySet<string>
  stale: boolean
  onEvent: (event: UIEvent) => void
  inspecting: boolean
  /** Reveal a view's source. Null origin means the node has no source position. */
  onRevealSource: (node: RenderNode) => void
  /** What the pointer is over while inspecting, so the workspace can follow it. */
  onHoverNode?: (node: RenderNode | null) => void
  /**
   * Every page, drawn side by side, when the gallery is open.
   *
   * `pageCount` is how many the app actually has, which is the same number except
   * on an app with more pages than the pipeline draws - and then the difference is
   * said out loud rather than left as a shorter row.
   */
  pages?: readonly PagePreview[]
  pageCount?: number
  /** Makes a page the live one. The gallery's only interaction with a page it is not showing. */
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
  onReorderNodes?: (source: RenderNode | 'selection', target: RenderNode, position: 'before' | 'after') => void
  /** The page to bring into view, when Layers picks one. */
  centerOn?: { readonly id: string; readonly nonce: number } | null
  /** What the preview is doing, drawn at the head of the canvas. */
  status?: React.ReactNode
  /** The right-hand rail's two halves. */
  inspectorTab?: InspectorTab
  onInspectorTab?: (tab: InspectorTab) => void
  preview: PreviewSettings
  onPreviewChange: (settings: Partial<PreviewSettings>) => void
}

/** Chrome around the screen: bezel thickness plus breathing room in the pane. */
const BEZEL = 10
const PANE_PADDING = 28

/** Space between phones in the gallery, and the room a page's name needs under one. */
const GALLERY_GAP = 24
const CAPTION_HEIGHT = 26

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

/** Dynamic Type steps, matching the iOS accessibility slider's usable range. */
const TYPE_SCALES: readonly MenuItem[] = DYNAMIC_TYPE_SIZES.map((value) => ({
  value,
  label: ({ xSmall: 'Text XS', small: 'Text S', medium: 'Text M', large: 'Text L',
    xLarge: 'Text XL', xxLarge: 'Text XXL', xxxLarge: 'Text XXXL',
    accessibility1: 'Text AX1', accessibility2: 'Text AX2', accessibility3: 'Text AX3',
    accessibility4: 'Text AX4', accessibility5: 'Text AX5' })[value],
  ...(value === 'large' ? { detail: 'Default' } : {}),
}))

const ZOOMS: readonly MenuItem[] = [
  { value: 'fit', label: 'Fit', detail: 'Auto' },
  { value: '1', label: '100%' },
  { value: '0.75', label: '75%' },
  { value: '0.5', label: '50%' },
  { value: '0.33', label: '33%' },
]

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
  onChangeAuthoring,
  authoringNode,
  onRevealAuthoring,
  expanded = false,
  projectId,
  panelLayout,
  showSettings = true,
  settingsWidth = PANE_LIMITS.settings.initial,
  onSettingsResize,
  onToggleSettings,
  onDeviceChange,
  tools,
  device,
  tree,
  selectedRenderIds,
  stale,
  onEvent,
  inspecting,
  onRevealSource,
  onHoverNode,
  pages,
  pageCount,
  onSelectPage,
  allPages = false,
  onToggleAllPages,
  belowCanvas,
  tool = 'select',
  selection,
  onReorderNodes,
  centerOn,
  status,
  inspectorTab = 'preview',
  onInspectorTab,
  preview,
  onPreviewChange,
}: DevicePaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [pane, setPane] = useState({ width: 0, height: 0, left: 0, top: 0, arrangeWidth: 0, arrangeHeight: 0, panelLayout, expanded, projectId })
  const gallery = expanded && !!pages?.length
  const [hoveredNode, setHoveredNode] = useState<RenderNode | null>(null)

  /** The hover as of now, for handlers that run outside React's render. */
  const hoverRef = useRef<RenderNode | null>(null)

  // One call site for the hover, so the pane and the workspace cannot disagree
  // about what the pointer is over.
  const setHovered = useCallback((node: RenderNode | null) => {
    hoverRef.current = node
    setHoveredNode(node)
    onHoverNode?.(node)
  }, [onHoverNode])

  // Derived rather than cleared in an effect: a stale highlight must not survive
  // leaving inspector mode, and "only meaningful while inspecting" is a property of
  // the value, not something to synchronise after the fact.
  const highlighted = inspecting ? hoveredNode : null

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

  /** How many phones across, and the size of the world they make. */
  const arrangement = useMemo(() => {
    const frameW = device.width + BEZEL * 2
    const frameH = device.height + BEZEL * 2
    const count = pages?.length ?? 0
    if (!gallery || !count) return { columns: 1, width: frameW, height: frameH }

    // Every column count is tried and the roomiest wins, rather than filling rows
    // until they overflow: six pages in a wide pane belong in one row, and in a
    // narrow one they belong in three columns of two.
    let best = { columns: 1, fit: 0 }
    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns)
      const width = columns * frameW + (columns - 1) * GALLERY_GAP
      const height = rows * (frameH + CAPTION_HEIGHT) + (rows - 1) * GALLERY_GAP
      const fit = Math.min((pane.arrangeWidth || 1) / width, (pane.arrangeHeight || 1) / height)
      if (fit > best.fit) best = { columns, fit }
    }
    const rows = Math.ceil(count / best.columns)
    return {
      columns: best.columns,
      width: best.columns * frameW + (best.columns - 1) * GALLERY_GAP,
      height: rows * (frameH + CAPTION_HEIGHT) + (rows - 1) * GALLERY_GAP,
    }
  }, [gallery, pages?.length, pane.arrangeWidth, pane.arrangeHeight, device.width, device.height])

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
  const lastFit = useRef({ zoom: '', width: 0, height: 0, left: 0, top: 0, panelLayout, expanded, projectId, device: device.key })
  const liveOffset = useRef({ x: 0, y: 0 })
  const wasGallery = useRef(gallery)

  useLayoutEffect(() => {
    if (pane.width <= 0 || pane.panelLayout !== panelLayout || pane.expanded !== expanded || pane.projectId !== projectId) return
    const was = lastFit.current
    const resized = was.width !== pane.width || was.height !== pane.height
    const chosen = was.zoom !== preview.zoom
    lastFit.current = { zoom: preview.zoom, width: pane.width, height: pane.height, left: pane.left, top: pane.top, panelLayout, expanded, projectId, device: device.key }

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

    if (wasGallery.current !== gallery) {
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
    // when the *content* does.
    if (preview.zoom === 'fit' && (chosen || resized)) { centreView(); return }

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
  }, [scale, preview.zoom, pane, gallery, centreView, applyView, onPreviewChange, panelLayout, expanded, projectId, device.key, arrangement.width, arrangement.height, fitScale])

  /**
   * The wheel zooms the canvas while designing, and scrolls the app while using it.
   *
   * The preview is a real scrolling app, so a wheel that always zoomed would take
   * scrolling away from every List on every screen. The switch under the canvas
   * already says which of the two you are doing, so it decides this too - and the
   * platform's own "zoom" chord works either way for anyone who expects it.
   *
   * Registered by hand rather than through `onWheel`, because React's wheel listener
   * is passive: `preventDefault` there is ignored, and the app underneath scrolled
   * *as well as* the canvas zooming.
   */
  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const onWheel = (event: WheelEvent) => {
      if (!expanded) return
      const zooming = event.ctrlKey || event.metaKey || (inspecting && !event.shiftKey)
      if (!zooming) return
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
      onPreviewChange({ zoom: String(Number(next.toFixed(4))) })
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [expanded, inspecting, onPreviewChange, applyView])

  /**
   * Dragging a view onto another one moves it in the file.
   *
   * What is dragged is the *selection* when the press lands inside it, and whatever
   * is under the pointer otherwise. That is the rule a layer editor follows: the
   * first click chooses the innermost thing, and the drag that follows moves the
   * thing you chose - so a whole list can be carried once it is selected, without
   * the pointer having to find its edge.
   */
  const viewDrag = useRef<{ node: RenderNode | 'selection'; x: number; y: number } | null>(null)
  const [dragTarget, setDragTarget] = useState<{ name: string; position: 'before' | 'after' } | null>(null)

  const onViewPointerDown = useCallback((event: React.PointerEvent) => {
    if (!expanded || stale || !inspecting || tool !== 'select' || !onReorderNodes || event.button !== 0) return
    const element = containerRef.current
    if (!element) return

    const within = (selection?.renderIds ?? []).some((id) => {
      const box = element.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
      return !!box
        && event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom
    })

    const node: RenderNode | 'selection' | null = within ? 'selection' : hoverRef.current
    if (!node) return
    viewDrag.current = { node, x: event.clientX, y: event.clientY }
  }, [expanded, stale, inspecting, tool, onReorderNodes, selection])

  useEffect(() => {
    /** What the drop would do, from where the pointer is over the target. */
    const dropAt = (event: PointerEvent, source: RenderNode | 'selection') => {
      const over = hoverRef.current
      if (!over || (source !== 'selection' && over.id === source.id)) return null
      const element = containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(over.id)}"]`)
      const box = element?.getBoundingClientRect()
      return {
        node: over,
        position: (box && event.clientY > box.top + box.height / 2 ? 'after' : 'before') as 'before' | 'after',
      }
    }

    const moved = (event: PointerEvent, drag: { x: number; y: number }) =>
      Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) >= 6

    const move = (event: PointerEvent) => {
      const drag = viewDrag.current
      if (!drag || !moved(event, drag)) return
      const drop = dropAt(event, drag.node)
      setDragTarget(drop ? { name: drop.node.inspect?.name ?? drop.node.kind, position: drop.position } : null)
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
  }, [onReorderNodes])

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

  const onPanStart = useCallback((event: React.PointerEvent) => {
    if (!expanded) return
    const background = event.target === event.currentTarget || (event.target as HTMLElement).dataset.world !== undefined
    // Middle-drag and space-drag work over the phones too, which is the way out of a
    // canvas zoomed in far enough that a phone covers the whole viewport.
    if (event.button === 1 || (event.button === 0 && (background || spaceRef.current))) {
      panning.current = { x: event.clientX, y: event.clientY, from: { x: viewRef.current.x, y: viewRef.current.y } }
      setGrabbing(true)
    }
  }, [expanded])

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

  const screenFor = (tree: RenderTree | null, live: boolean, at: number) => (
    <div style={{ colorScheme: preview.colorScheme, position: 'absolute', top: 0, left: 0, transform: `scale(${at})`, transformOrigin: 'top left' }}>
      <DeviceFrame device={device}>
        <RenderTreeView
          tree={tree ?? EMPTY_RENDER_TREE}
          selectedIds={live ? selectedRenderIds : undefined}
          {...(live ? { onEvent } : {})}
          stale={stale}
          {...(live && inspecting
            ? {
                inspect: {
                  hovered: highlighted?.id ?? null,
                  onHover: setHovered,
                  onSelect: onRevealSource,
                },
              }
            : {})}
        />
        <StatusBar device={device} colorScheme={preview.colorScheme} />
        {device.hasDynamicIsland ? <DynamicIsland device={device} /> : null}
        {device.homeIndicator ? <HomeIndicator device={device} colorScheme={preview.colorScheme} /> : null}
      </DeviceFrame>
    </div>
  )

  const devicePicker = <PopupButton items={DEVICE_LIST.map(d => ({ value: d.key, label: d.name, detail: `${d.width} × ${d.height}` }))} value={device.key} onChange={value => onDeviceChange(value as DeviceKey)} label="Destination" testId="device-select" />
  const schemePicker = <SegmentedControl label="Appearance" testId="scheme-toggle" options={[{value:'light',label:'Light'},{value:'dark',label:'Dark'}]} value={preview.colorScheme} onChange={value => onPreviewChange({colorScheme:value as 'light' | 'dark'})} />
  const typePicker = <PopupButton items={TYPE_SCALES} value={preview.dynamicTypeSize ?? dynamicTypeForScale(preview.typeScale)} onChange={value => onPreviewChange({dynamicTypeSize:value as DynamicTypeSize})} label="Dynamic Type size" testId="type-scale-select" />
  const zoomItems = ZOOMS.some(item => item.value === preview.zoom)
    ? ZOOMS
    : [...ZOOMS, { value: preview.zoom, label: `${Math.round(Number(preview.zoom) * 100)}%` }]
  const zoomPicker = <PopupButton items={zoomItems} value={preview.zoom} onChange={value => onPreviewChange({zoom:value})} label="Zoom" title={`Zoom — ${Math.round(scale * 100)}%`} testId="zoom-select" />

  const collapsePanel = <button type="button" className={styles.panelToggle} data-testid="pane-toggle-preview" aria-pressed="true" aria-label={expanded ? 'Collapse preview settings' : 'Collapse preview'} title={expanded ? 'Collapse preview settings' : 'Collapse preview'} onClick={onToggleSettings}><Icon name="sidebar-right" size={16} /></button>

  return (
    <section className={styles.preview} aria-label="Preview" data-expanded={expanded}>
      <div className={styles.stage}>
      {expanded ? <div className={styles.canvasHeading}>
        {status}
        <span>
          <span>{
            dragTarget
              ? `Drop ${dragTarget.position} ${dragTarget.name}`
              : gallery
              ? pageCount && pageCount > pages!.length
                ? `${pages!.length} of ${pageCount} pages · click a page to open it`
                : `${pages!.length} ${pages!.length === 1 ? 'page' : 'pages'} · click a page to open it`
              : inspecting ? 'Hover to find a view in Layers, click to select it' : 'Interactive preview'
          }</span>
          {/* Off in Live Preview, and said so rather than hidden: it is a thing the
              canvas can do, in the mode where a click means "open this page". */}
          <label className={styles.showAll} data-disabled={!inspecting || undefined} title={inspecting ? 'Draw every page side by side (⌘⇧A)' : 'Switch to Edit to show every page'}>
            <input type="checkbox" data-testid="show-all-pages" checked={allPages && inspecting} disabled={!inspecting} onChange={(event) => onToggleAllPages?.(event.target.checked)} />
            Show all
          </label>
        </span>
      </div> : <header className={styles.compactSettings}>{collapsePanel}{devicePicker}{schemePicker}{typePicker}{zoomPicker}</header>}
      <div
        ref={containerRef}
        className={`${styles.canvas} relative min-h-0 flex-1 overflow-hidden`}
        style={{ cursor: grabbing ? 'grabbing' : undefined }}
        data-testid="device-pane"
        data-fixed={!expanded}
        data-tool={inspecting ? tool : undefined}
        data-dragging={dragTarget ? true : undefined}
        onPointerDown={(event) => { onPanStart(event); onViewPointerDown(event) }}
        // The pointer can leave the device without crossing any node's boundary -
        // straight off the bezel - so the pane itself has to clear the highlight.
        onPointerLeave={() => setHovered(null)}
      >
        {/* The world. Everything in it is laid out at its natural size and this one
            transform decides where and how big it appears, which is what lets the
            canvas be panned anywhere and zoomed about the pointer. */}
        <div ref={worldRef} data-world className={styles.world}>
          {gallery ? (
            <div
              className={styles.gallery}
              data-testid="page-gallery"
              style={{ gridTemplateColumns: `repeat(${arrangement.columns}, ${device.width + BEZEL * 2}px)`, gap: GALLERY_GAP }}
            >
              {pages!.map((page) => (
                <figure key={page.id} className={styles.pageCard} data-active={page.active || undefined} data-page-id={page.id} data-testid="gallery-page">
                  <div style={{ position: 'relative', width: device.width + BEZEL * 2, height: device.height + BEZEL * 2 }}>
                    {/* A page that is not the live one is a picture of the app, so its
                        controls do not answer: pressing one would run the page that is
                        running, which is a different screen. The whole phone is one
                        button instead, and it opens the page. */}
                    <div style={page.active ? undefined : { pointerEvents: 'none' }}>
                      {screenFor(page.tree, page.active, 1)}
                    </div>
                    {page.active ? null : (
                      <button
                        type="button"
                        className={styles.pageCover}
                        onClick={() => onSelectPage?.(page)}
                        disabled={!page.handlerId || !onSelectPage}
                        aria-label={`Open ${page.name}`}
                        title={page.handlerId ? `Open ${page.name}` : 'This page has no tab to open it with'}
                      />
                    )}
                  </div>
                  <figcaption>{page.name}{page.active ? <span className={styles.liveTag}>Live</span> : null}</figcaption>
                </figure>
              ))}
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
      </div>

      <footer className={styles.canvasFooter}>{tools}</footer>
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
      {expanded && showSettings && <aside className={styles.properties} style={{ '--settings-width': `${settingsWidth}px` } as React.CSSProperties} aria-label="Preview settings">
        {/* Two halves: what you are making, and how you are looking at it. The
            switch under the canvas moves between them on its own, because the
            question you are asking changes with it - and either tab is still one
            press away whenever that guess is wrong. */}
        <header className={styles.propertyTabs} role="tablist" aria-label="Inspector">
          {(['settings', 'preview'] as const).map(tab => (
            <button key={tab} type="button" role="tab" aria-selected={inspectorTab === tab}
              data-testid={`inspector-tab-${tab}`} onClick={() => onInspectorTab?.(tab)}>
              {tab === 'settings' ? 'Settings' : 'Preview'}
            </button>
          ))}
          {collapsePanel}
        </header>

        {inspectorTab === 'settings' ? (
          <div className={styles.propertySection} data-testid="inspector-settings">
            <h3>{selection ? selection.name : 'Settings'}</h3>
            <AuthoringInspector onChange={onChangeAuthoring} node={authoringNode} stale={stale} onReveal={onRevealAuthoring} />
          </div>
        ) : (
          <>
            <div className={styles.propertySection}>
              <h3>Device</h3>
              <div className={styles.propertyRow}>{devicePicker}</div>
              <div className={styles.dimensions}><span><small>W</small>{device.width}</span><span><small>H</small>{device.height}</span></div>
            </div>
            <div className={styles.propertySection}>
              <h3>Display</h3>
              <div className={styles.propertyRow}><span>Appearance</span>{schemePicker}</div>
              <div className={styles.propertyRow}><span>Text size</span>{typePicker}</div>
              <div className={styles.propertyRow}><span>Canvas zoom</span>{zoomPicker}</div>
            </div>
            <div className={styles.propertySection}>
              <h3>iOS 27 preview</h3>
              <p>Tap, scroll, and try your app. Switch to Code to see the SwiftUI behind it.</p>
              <p>Scroll to zoom the canvas, and drag the background to move it.</p>
            </div>
          </>
        )}
      </aside>}
      {expanded && !showSettings && <div className={styles.panelRail}><button type="button" className={styles.panelToggle} data-testid="pane-toggle-preview" aria-pressed="false" aria-label="Show preview settings" title="Show preview settings" onClick={onToggleSettings}><Icon name="sidebar-right" size={16} /></button></div>}
    </section>
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
