import { useId, useState, useRef, useLayoutEffect, useEffect, useCallback, useSyncExternalStore, type UIEvent as ReactUIEvent } from 'react'
import { ShapeView } from './ShapeView'
import { SliderView, ControlStyles } from './SliderView'
import { symbolMetrics, shapePath } from '@studio/shared'
import { memo, useMemo, type CSSProperties, type ReactNode } from 'react'
import {
  cssColor,
  cssFill,
  cssFilter,
  cssTransition,
  type RenderNode,
  type RenderTree,
  type RGBA,
  type TextRun,
  type UIEvent,
} from '@studio/shared'
import { symbolAsset, symbolStrokeScale } from './symbols'
import { beginContextPress } from './context-press'
import { finishExit, reconcilePresence, type PresentNode, type RenderGroups } from './transition-presence'

const EMPTY_NODES: readonly RenderNode[] = []
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
function subscribeMotion(notify: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const serverMotion = () => true
const ignorePreviewEvent = () => undefined

export interface RenderTreeViewProps {
  tree: RenderTree
  /** Workspace layer selection, without intercepting preview interactions. */
  selectedIds?: ReadonlySet<string>
  /** Temporary canvas outlines for the source view under the Layers pointer. */
  hoveredIds?: ReadonlySet<string>
  /** Optional workspace-owned offsets shared across live and design phone mounts. */
  scrollPositions?: Map<string, { left: number; top: number }>
  /** Raised when an interactive node is activated. */
  onEvent?: (event: UIEvent) => void
  /**
   * Dim the tree when it is stale - a parse error means we keep painting the last
   * good render rather than blanking the preview (requirement FR-6.3), and the user
   * needs to be able to tell the difference at a glance.
   */
  stale?: boolean
  /** Outline every node. */
  debugOutlines?: boolean
  /**
   * Inspector mode (FR-5.8).
   *
   * While active, every node accepts pointer events, so hovering reports the
   * innermost view under the cursor - which is what the DOM's own hit testing
   * already gives us, since children paint above their parents.
   */
  inspect?: {
    readonly hovered: string | null
    onHover(node: RenderNode | null): void
    onSelect(node: RenderNode): void
    onEditText?(node: RenderNode, rect: { x: number; y: number; width: number; height: number }): void
  }
}

/**
 * Paints a laid-out RenderTree.
 *
 * This component does **no layout**. Every node already carries an absolute frame
 * computed by the layout engine, so each becomes an absolutely positioned div and
 * CSS never gets a chance to disagree with SwiftUI about sizing. That is the point
 * of decision D2 (docs/02-ARCHITECTURE.md §12) and the reason this file is as dull
 * as it is - all the difficulty lives upstream.
 *
 * Phase 6 adds the two things that genuinely cannot be flat:
 *
 * - **Containers.** A node naming another as its `parent` is rendered *inside* it, in
 *   its coordinate space. That is what makes scrolling native - the browser's own
 *   momentum and rubber-banding rather than an approximation of them in the worker -
 *   and what makes `.clipShape` and `.scaleEffect` affect a whole subtree.
 * - **Real controls.** A text field is an `<input>` and a slider is a range input.
 *   A caret, an IME and keyboard control cannot be faked by catching clicks on a
 *   picture of one.
 */
export const RenderTreeView = memo(function RenderTreeView({
  tree,
  onEvent,
  stale = false,
  debugOutlines = false,
  selectedIds,
  hoveredIds,
  scrollPositions,
  inspect,
}: RenderTreeViewProps) {
  const reduceMotion = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion)
  const surfaceRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    if (scrollPositions) {
      for (const node of tree.nodes) {
        const saved = node.scroll && scrollPositions.get(node.id)
        if (!saved) continue
        const scroller = surface.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`)
        if (scroller) { scroller.scrollLeft = saved.left; scroller.scrollTop = saved.top }
      }
    }
    // Restore before collapsing navigation chrome, including a sheet's own bar.
    for (const node of tree.nodes) {
      if (!node.chrome) continue
      const panel = surface.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`)
      const scroller = panel?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.chrome.scrollId)}"]`)
      if (panel) updateChrome(panel, scroller?.scrollTop ?? 0, node.chrome.collapseDistance)
    }
    const scroller = tree.chrome && surface.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(tree.chrome.scrollId)}"]`)
    updateChrome(surface, scroller?.scrollTop ?? 0, tree.chrome?.collapseDistance ?? 0)
  }, [tree, scrollPositions])
  const hoveredNodes = stale ? [] : tree.nodes.filter(node => node.id === inspect?.hovered || hoveredIds?.has(node.id))

  // Nodes grouped by the container they live in. Built once per tree rather than
  // searched per node, so a thousand-row list stays linear.
  const byParent = useMemo(() => {
    const groups = new Map<string, RenderNode[]>()
    for (const node of tree.nodes) {
      const key = node.parent ?? ''
      const bucket = groups.get(key)
      if (bucket) bucket.push(node)
      else groups.set(key, [node])
    }
    return groups
  }, [tree])

  return (
    <div
      ref={surfaceRef}
      data-testid="render-tree"
      aria-busy={stale}
      inert={stale || undefined}
      data-studio-preview=""
      data-calibration={tree.calibration ?? 'provisional'}
      onScrollCapture={event => {
        const target = event.target as HTMLElement
        if (scrollPositions && target.dataset.nodeId) scrollPositions.set(target.dataset.nodeId, { left: target.scrollLeft, top: target.scrollTop })
        captureChrome(event, tree.chrome)
      }}
      data-revision={tree.revision}
      style={{
        position: 'relative',
        colorScheme: tree.colorScheme ?? 'light',
        width: tree.canvas.width,
        height: tree.canvas.height,
        overflow: 'hidden',
        opacity: stale ? 0.55 : 1,
        transition: 'opacity 120ms ease-out',
        // Keep text crisp under the scale transform the device frame applies.
        textRendering: 'optimizeLegibility',
      }}
    >
      <TransitionKeyframes />
      <ControlStyles />

      <RenderNodeGroup nodes={byParent.get('') ?? EMPTY_NODES} byParent={byParent} animate={!reduceMotion && !inspect && !stale} onEvent={onEvent} selectedIds={selectedIds} debugOutlines={debugOutlines} inspect={inspect} />

      {hoveredNodes.map(node => <InspectHighlight key={node.id} node={node} tree={tree} />)}
    </div>
  )
})

function updateChrome(surface: HTMLElement, offset: number, distance: number) {
  const collapse = Math.min(Math.max(0, offset), distance)
  const progress = distance > 0 ? collapse / distance : 0
  surface.style.setProperty('--chrome-collapse', `${collapse}px`)
  surface.style.setProperty('--chrome-progress', `${progress}`)
  surface.style.setProperty('--chrome-large', `${Math.max(0, 1 - progress * 1.5)}`)
  surface.style.setProperty('--chrome-inline', `${Math.max(0, (progress - 0.5) * 2)}`)
}
function captureChrome(event: ReactUIEvent<HTMLDivElement>, chrome: RenderTree['chrome']) {
  const target = event.target as HTMLElement
  if (chrome && target.dataset.nodeId === chrome.scrollId) updateChrome(event.currentTarget, target.scrollTop, chrome.collapseDistance)
}

/** Entry and exit use separate names so reversing a finished entry restarts it. */
function TransitionKeyframes() {
  return (
    <style>{`
      @media (prefers-reduced-motion: reduce) {
        [data-studio-preview], [data-studio-preview] * { animation: none !important; transition: none !important; }
      }
      @keyframes studio-opacity { from { opacity: 0 } }
      @keyframes studio-scale { from { opacity: 0; transform: scale(0.85) } }
      @keyframes studio-move-top { from { opacity: 0; transform: translateY(-24px) } }
      @keyframes studio-move-bottom { from { opacity: 0; transform: translateY(24px) } }
      @keyframes studio-move-leading { from { opacity: 0; transform: translateX(-24px) } }
      @keyframes studio-move-trailing { from { opacity: 0; transform: translateX(24px) } }
      @keyframes studio-opacity-exit { to { opacity: 0 } }
      @keyframes studio-scale-exit { to { opacity: 0; transform: scale(0.85) } }
      @keyframes studio-move-top-exit { to { opacity: 0; transform: translateY(-24px) } }
      @keyframes studio-move-bottom-exit { to { opacity: 0; transform: translateY(24px) } }
      @keyframes studio-move-leading-exit { to { opacity: 0; transform: translateX(-24px) } }
      @keyframes studio-move-trailing-exit { to { opacity: 0; transform: translateX(24px) } }
      @keyframes studio-spin { to { transform: rotate(360deg) } }
    `}</style>
  )
}

/** The keyframe name for a transition spec. */
function transitionAnimation(node: RenderNode, exiting = false): string | undefined {
  const transition = node.transition
  if (!transition) return undefined

  const name =
    transition.kind === 'scale'
      ? 'studio-scale'
      : transition.kind === 'opacity'
        ? 'studio-opacity'
        : // `.slide` is a move from the leading edge unless an edge was named.
          `studio-move-${transition.edge ?? (transition.kind === 'slide' ? 'leading' : 'bottom')}`

  return `${name}${exiting ? '-exit' : ''} ${Math.round(transition.duration * 1000)}ms cubic-bezier(0.42, 0, 0.58, 1) both`
}

interface NodePresentation {
  onEvent?: (event: UIEvent) => void
  debugOutlines: boolean
  selectedIds?: ReadonlySet<string>
  inspect?: RenderTreeViewProps['inspect']
  animate: boolean
}

function RenderNodeGroup({ nodes, byParent, ...presentation }: NodePresentation & { nodes: readonly RenderNode[]; byParent: RenderGroups }) {
  const [state, setState] = useState(() => ({ nodes, byParent, animate: presentation.animate, entries: reconcilePresence([], nodes, byParent, false) }))
  // This conditional adjustment finishes before React commits, keeping a removed
  // node mounted for its exit instead of removing and reinserting its DOM.
  if (state.nodes !== nodes || state.byParent !== byParent || state.animate !== presentation.animate) {
    setState({ nodes, byParent, animate: presentation.animate, entries: reconcilePresence(state.entries, nodes, byParent, state.animate && presentation.animate) })
  }
  const complete = useCallback((id: string, token: object) => setState(current => ({ ...current, entries: finishExit(current.entries, id, token) })), [])
  return state.entries.map(entry => <PresentRenderNode key={entry.node.id} entry={entry} complete={complete} {...presentation} />)
}

function PresentRenderNode({ entry, complete, ...presentation }: NodePresentation & { entry: PresentNode; complete: (id: string, token: object) => void }) {
  const { node, exiting, exitToken } = entry
  const duration = node.transition?.duration ?? 0
  useEffect(() => {
    if (!exiting || !exitToken) return
    // Bounded cleanup works even when CSS animation events are absent. A token
    // prevents an interrupted exit's delayed completion removing a later exit.
    const timer = setTimeout(() => complete(node.id, exitToken), duration * 1000 + 50)
    return () => clearTimeout(timer)
  }, [exiting, exitToken, duration, node.id, complete])
  return <RenderNodeView node={node} byParent={entry.groups} {...presentation} exiting={exiting} onEvent={exiting ? ignorePreviewEvent : presentation.onEvent} inspect={exiting ? undefined : presentation.inspect} />
}

/**
 * The highlight rect. Drawn above everything and never itself hit-testable.
 *
 * A node inside a scroll view is positioned in the scroller's space, so the highlight
 * has to walk back up to the screen to find where it actually appears - otherwise
 * hovering row 40 of a list outlines something near the top of the screen.
 */
function InspectHighlight({ node, tree }: { node: RenderNode; tree: RenderTree }) {
  const outline = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = outline.current
    const surface = element?.parentElement
    const target = surface?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`)
    if (!element || !surface || !target) return
    // Read painted bounds so scrolling, padding and transforms use the same geometry
    // in both hover directions. Clip to scrollports, just like the painted content.
    const update = () => {
      const root = surface.getBoundingClientRect(), box = target.getBoundingClientRect()
      const scaleX = root.width / tree.canvas.width, scaleY = root.height / tree.canvas.height
      if (!scaleX || !scaleY) return
      let left = box.left, top = box.top, right = box.right, bottom = box.bottom
      for (let parent = target.parentElement; parent && parent !== surface; parent = parent.parentElement) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right) }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom) }
      }
      Object.assign(element.style, {
        left: `${(left - root.left) / scaleX}px`, top: `${(top - root.top) / scaleY}px`,
        width: `${Math.max(0, right - left) / scaleX}px`, height: `${Math.max(0, bottom - top) / scaleY}px`,
        visibility: right > left && bottom > top ? 'visible' : 'hidden',
      })
    }
    update()
    surface.addEventListener('scroll', update, true)
    const observer = new ResizeObserver(update)
    observer.observe(surface); observer.observe(target)
    return () => { surface.removeEventListener('scroll', update, true); observer.disconnect() }
  }, [node, tree])
  let x = node.frame.x
  let y = node.frame.y
  let current = node

  for (let depth = 0; current.parent && depth < 32; depth++) {
    const parent = tree.nodes.find((n) => n.id === current.parent)
    if (!parent) break
    x += parent.frame.x
    y += parent.frame.y
    current = parent
  }

  return (
    <div
      ref={outline}
      data-testid="inspect-highlight"
      data-hovered-node-id={node.id}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: node.frame.width,
        height: node.frame.height,
        outline: '1.5px solid rgb(0 122 255)',
        background: 'rgb(0 122 255 / 0.12)',
        pointerEvents: 'none',
        zIndex: 2_000_000,
      }}
    />
  )
}

function RenderNodeView({
  node,
  byParent,
  onEvent,
  debugOutlines,
  selectedIds,
  inspect,
  animate,
  exiting = false,
}: {
  node: RenderNode
  byParent: ReadonlyMap<string, RenderNode[]>
  onEvent?: (event: UIEvent) => void
  debugOutlines: boolean
  selectedIds?: ReadonlySet<string>
  inspect?: RenderTreeViewProps['inspect']
  animate: boolean
  exiting?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelContextPress = useRef<(() => void) | null>(null)
  useLayoutEffect(() => () => cancelContextPress.current?.(), [])
  useLayoutEffect(() => { if (exiting) cancelContextPress.current?.() }, [exiting])
  useLayoutEffect(() => {
    if (panelRef.current && node.chrome) {
      const scroller = panelRef.current.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.chrome.scrollId)}"]`)
      updateChrome(panelRef.current, scroller?.scrollTop ?? 0, node.chrome.collapseDistance)
    }
  }, [node.chrome])
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || !node.anchorId) return
    const root = panel.closest<HTMLElement>('[data-testid="render-tree"]')
    const anchor = root?.querySelector<HTMLElement>(`[data-handler-id="${CSS.escape(node.anchorId)}"]`)
    if (!root || !anchor) return
    const place = () => {
      const a = anchor.getBoundingClientRect(), r = root.getBoundingClientRect()
      const scale = r.width / root.offsetWidth || 1
      const margin = 12, gap = 8
      const x = Math.max(margin, Math.min(root.offsetWidth - node.frame.width - margin, (a.right - r.left) / scale - node.frame.width))
      const below = (a.bottom - r.top) / scale + gap
      const above = (a.top - r.top) / scale - gap - node.frame.height
      const y = Math.max(margin, Math.min(root.offsetHeight - node.frame.height - margin, below + node.frame.height <= root.offsetHeight - margin ? below : above))
      const container = (panel.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? r
      panel.style.left = `${x - (container.left - r.left) / scale}px`
      panel.style.top = `${y - (container.top - r.top) / scale}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [node.anchorId, node.frame.width, node.frame.height])
  const [pressed, setPressed] = useState(false)
  const interactive = node.hitTarget?.enabled === true
  const inspecting = inspect !== undefined && node.id !== 'screen'
  const children = byParent.get(node.id)
  const scroll = node.scroll

  const style: CSSProperties = {
    position: 'absolute',
    left: node.frame.x,
    top: node.frame.y,
    width: node.frame.width,
    height: node.frame.height,
    zIndex: node.z,
    opacity: node.opacity,
    ...(node.chromeRole === 'inlineTitle' ? { opacity: 'var(--chrome-inline, 0)' as unknown as number } : {}),
    ...(node.chromeRole === 'largeTitle' ? { top: `calc(${node.frame.y}px - var(--chrome-collapse, 0px))`, opacity: 'var(--chrome-large, 1)' as unknown as number } : {}),
    ...(node.chromeRole === 'navigationSurface' ? { height: `calc(${node.frame.height}px - var(--chrome-collapse, 0px))` } : {}),
    // Only hit targets receive pointer events, so a text label painted on top of a
    // button does not swallow the tap meant for the button underneath it. A scroller
    // needs them too, or the wheel does nothing. In inspector mode every node is
    // hittable, which is the whole point.
    pointerEvents: inspecting || interactive || scroll || node.blocksPointer ? 'auto' : 'none',
    cursor: inspecting ? 'crosshair' : interactive ? 'pointer' : 'default',
    ...(node.background && node.cornerStyle !== 'continuous' ? { background: cssFill(node.background) } : {}),
    ...(node.chromeRole === 'navigationSurface' && node.background?.kind === 'solid' ? {
      background: `rgb(${node.background.color.r} ${node.background.color.g} ${node.background.color.b} / calc(1 - 0.28 * var(--chrome-progress, 0)))`,
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    } : {}),
    ...(node.clipShape ? { clipPath: `path("${shapePath(node.clipShape.kind, node.frame.width, node.frame.height, node.cornerRadius, node.clipShape.cornerStyle)}")` } : {}),
    ...(pressed && interactive ? { backgroundColor: 'rgb(128 128 128 / 0.16)', borderRadius: node.hitTarget?.cornerRadius ?? 8 } : {}),
    ...(node.cornerRadius && !node.clipShape ? { borderRadius: node.cornerRadius } : {}),
    ...(node.clip ? { overflow: scroll ? 'auto' : 'hidden' } : {}),
    ...(scroll
      ? {
          overflowX: scroll.axis === 'horizontal' ? 'auto' : 'hidden',
          overflowY: scroll.axis === 'vertical' ? 'auto' : 'hidden',
          /**
           * Never a bar, whatever `showsIndicators` says.
           *
           * iOS draws a scroll indicator while a finger is moving and nothing at
           * all when it stops; a desktop scrollbar is a permanent grey rail down
           * the side of the phone, which is furniture the device does not have.
           * The flag is still read and still carried - it is what the source says -
           * and what it selects between is an indicator that fades and one that
           * never appears, neither of which is a rail.
           */
          scrollbarWidth: 'none',
          // iOS scrollers do not capture a page scroll once they hit their end.
          overscrollBehavior: 'contain',
        }
      : {}),
    ...(node.border
      ? {
          boxSizing: 'border-box',
          border: `${node.border.width}px solid ${cssColor(node.border.color)}`,
          borderRadius: node.border.cornerRadius || undefined,
        }
      : {}),
    ...(node.shadow
      ? {
          boxShadow: `${node.shadow.x}px ${node.shadow.y}px ${node.shadow.radius * 2}px ${cssColor(node.shadow.color)}`,
        }
      : {}),
    ...(node.transform
      ? {
          transform: cssTransform(node.transform),
          // A rotation about x or y is a projection, and without a perspective the
          // browser draws it as a flat squash - which is not what SwiftUI shows.
          ...(node.transform.rotateX || node.transform.rotateY
            ? { transformStyle: 'preserve-3d' as const, perspective: '640px' }
            : {}),
        }
      : {}),
    ...(node.filter ? { filter: cssFilter(node.filter) } : {}),
    ...(node.blendMode ? { mixBlendMode: node.blendMode as CSSProperties['mixBlendMode'] } : {}),
    ...(node.transition && animate ? { animation: transitionAnimation(node, exiting) } : {}),
    ...(node.material
      ? {
          // A material is a translucent panel over a blurred backdrop, which is
          // exactly what `backdrop-filter` does - the one Apple effect CSS has a
          // direct equivalent for.
          backdropFilter: `blur(${node.material.blur}px) saturate(1.8)`,
          WebkitBackdropFilter: `blur(${node.material.blur}px) saturate(1.8)`,
          background: node.material.light
            ? `rgb(255 255 255 / ${node.material.opacity})`
            : `rgb(30 30 32 / ${node.material.opacity})`,
        }
      : {}),
    ...(node.animation
      ? {
          transition: cssTransition(
            node.animation,
            'left, top, width, height, opacity, transform, background-color, border-radius',
          ),
        }
      : {}),
    ...(debugOutlines ? { outline: '1px solid rgb(0 122 255 / 0.35)', outlineOffset: -1 } : {}),
    ...(selectedIds?.has(node.id) ? { outline: '2px solid rgb(0 122 255)', outlineOffset: -2 } : {}),
  }

  const handlerId = node.hitTarget?.handlerId
  const role = node.hitTarget?.role

  // A control the browser owns. Its frame was still decided by the layout engine;
  // what the DOM supplies is the interaction the engine has no way to model.
  const nativeControl =
    handlerId && onEvent && (role === 'textField' || role === 'slider')
      ? renderControl(node, handlerId, onEvent)
      : null

  // `.redacted(reason: .placeholder)`: the content's *shape* without the content. The
  // engine already decided the frame, and that frame is exactly what the bar occupies -
  // which is why this is a paint-time swap rather than a different subtree.
  const redacted = node.redacted && (node.kind === 'text' || node.kind === 'image')

  const content: ReactNode = (
    <>
      {node.background && node.cornerStyle === 'continuous' ? <ShapeView shape={{ shape: 'roundedRectangle', cornerRadius: node.cornerRadius, cornerStyle: node.cornerStyle, fill: node.background }} width={node.frame.width} height={node.frame.height} /> : null}
      {node.slider ? <SliderView slider={node.slider} width={node.frame.width} height={node.frame.height} /> : null}
      {redacted ? <RedactedBar /> : null}
      {!redacted && node.kind === 'text' && node.text ? <TextContent node={node} /> : null}
      {!redacted && node.kind === 'image' && node.image ? <ImageContent node={node} /> : null}
      {node.kind === 'shape' && node.shape ? <ShapeContent node={node} /> : null}
      {node.kind === 'path' && node.path ? <PathContent node={node} /> : null}
      {node.kind === 'placeholder' && node.placeholder ? <PlaceholderContent node={node} /> : null}
      {node.filter?.multiply ? <ColorMultiply color={node.filter.multiply} /> : null}
      {nativeControl}
      <ScrollContent node={node}>
        <RenderNodeGroup nodes={children ?? EMPTY_NODES} byParent={byParent} animate={animate && !exiting} onEvent={onEvent} selectedIds={selectedIds} debugOutlines={debugOutlines} inspect={inspect} />
      </ScrollContent>
    </>
  )

  return (
    <div
      ref={panelRef}
      data-node-id={node.id}
      data-layer-selected={selectedIds?.has(node.id) || undefined}
      data-handler-id={node.hitTarget?.handlerId}
      inert={exiting || node.inert || undefined}
      data-transition-exit={exiting || undefined}
      data-chrome-role={node.chromeRole}
      onScrollCapture={node.chrome ? event => captureChrome(event, node.chrome) : undefined}
      data-kind={node.kind}
      style={style}
      role={nativeControl ? undefined : node.a11y?.role}
      tabIndex={!nativeControl && interactive && (role === 'button' || role === 'toggle' || role === 'contextMenu') ? 0 : undefined}
      aria-checked={role === 'toggle' ? node.hitTarget?.value === 'on' : undefined}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onKeyUp={() => setPressed(false)}
      onBlur={() => setPressed(false)}
      onContextMenu={!inspecting && interactive && node.hitTarget?.contextMenuHandlerId && onEvent ? event => {
        event.preventDefault()
        event.stopPropagation()
        cancelContextPress.current?.()
        setPressed(false)
        onEvent({ kind: 'tap', handlerId: node.hitTarget!.contextMenuHandlerId!, location: { x: 0, y: 0 } })
      } : undefined}
      aria-haspopup={node.hitTarget?.contextMenuHandlerId ? 'menu' : undefined}
      onKeyDown={!inspecting && interactive && handlerId && onEvent ? (event) => {
        if (node.hitTarget?.contextMenuHandlerId && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
          event.preventDefault()
          onEvent({ kind: 'tap', handlerId: node.hitTarget.contextMenuHandlerId, location: { x: 0, y: 0 } })
          return
        }
        if (nativeControl) return
        if ((event.key === 'Enter' || event.key === ' ') && (role === 'button' || role === 'toggle')) {
          event.preventDefault()
          if (event.repeat) return
          setPressed(true)
          onEvent(role === 'toggle' ? { kind: 'toggle', handlerId, value: node.hitTarget?.value !== 'on' } : { kind: 'tap', handlerId, location: { x: node.frame.width / 2, y: node.frame.height / 2 } })
        }
      } : undefined}
      aria-label={node.a11y?.label}
      aria-disabled={node.hitTarget && !node.hitTarget.enabled ? true : undefined}
      aria-valuetext={node.a11y?.value}
      aria-description={node.a11y?.hint}
      aria-hidden={exiting || node.a11y?.hidden}
      onPointerEnter={inspecting ? () => inspect.onHover(node) : undefined}
      onPointerLeave={() => { setPressed(false); if (inspecting) inspect.onHover(null) }}
      onDoubleClick={inspecting && inspect.onEditText ? event => { event.preventDefault(); event.stopPropagation(); inspect.onEditText?.(node, event.currentTarget.getBoundingClientRect()) } : undefined}
      onClick={
        inspecting
          ? (e) => {
              e.stopPropagation()
              inspect.onSelect(node)
            }
          : undefined
      }
      onPointerDown={
        !inspecting && interactive && handlerId && onEvent && !nativeControl
          ? (e) => {
              if (e.button !== 0) return
              e.preventDefault()
              setPressed(true)
              e.currentTarget.focus()
              const bounds = e.currentTarget.getBoundingClientRect()
              const scale = bounds.width / node.frame.width || 1
              const at = (event: { clientX: number; clientY: number }) => ({
                x: (event.clientX - bounds.left) / scale,
                y: (event.clientY - bounds.top) / scale,
              })

              const location = at(e)
              const activate = () => {
                if (role === 'contextMenu') return
                onEvent(role === 'toggle'
                  ? { kind: 'toggle', handlerId, value: node.hitTarget?.value !== 'on' }
                  : { kind: 'tap', handlerId, location })
              }
              if (role === 'drag') {
                beginDrag(e, handlerId, at, onEvent)
                return
              }
              if (node.hitTarget?.contextMenuHandlerId) {
                cancelContextPress.current?.()
                cancelContextPress.current = beginContextPress(e, activate, () => {
                  setPressed(false)
                  onEvent({ kind: 'tap', handlerId: node.hitTarget!.contextMenuHandlerId!, location })
                })
              } else activate()
            }
          : undefined
      }
    >
      {content}
    </div>
  )
}

/**
 * Tracks a drag from pointer-down to pointer-up.
 *
 * Listeners go on the *window*, not the element: a drag that leaves the view it
 * started in must keep reporting, which is what makes dragging something to the edge
 * of the screen work rather than stopping at its original bounds. Pointer capture
 * would do the same job, but only for the element that still exists - and a
 * re-render during the drag replaces it.
 *
 * `translation` is cumulative from the start, as SwiftUI reports it.
 */
function beginDrag(
  down: { clientX: number; clientY: number },
  handlerId: string,
  at: (event: { clientX: number; clientY: number }) => { x: number; y: number },
  onEvent: (event: UIEvent) => void,
): void {
  const start = at(down)
  let moved = false

  const send = (
    phase: 'began' | 'changed' | 'ended',
    event: { clientX: number; clientY: number },
  ) => {
    const location = at(event)
    onEvent({
      kind: 'drag',
      handlerId,
      phase,
      location,
      startLocation: start,
      translation: { x: location.x - start.x, y: location.y - start.y },
    })
  }

  const move = (event: PointerEvent) => {
    if (!moved) {
      moved = true
      send('began', event)
    }
    send('changed', event)
  }

  const up = (event: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    send('ended', event)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

/**
 * The sized content box inside a scroller.
 *
 * A scroll view's children are laid out at the content's full extent, which is what
 * gives the browser something to scroll. Anything else just wraps its children
 * without adding a box.
 */
function ScrollContent({ node, children }: { node: RenderNode; children: ReactNode }) {
  if (!node.scroll) return <>{children}</>
  return (
    <div
      style={{
        position: 'relative',
        width: node.scroll.content.width,
        height: node.scroll.content.height,
      }}
    >
      {children}
    </div>
  )
}

function renderControl(
  node: RenderNode,
  handlerId: string,
  onEvent: (event: UIEvent) => void,
): ReactNode {
  const hit = node.hitTarget!
  const font = hit.font

  if (hit.role === 'textField') {
    const Field = hit.multiline ? 'textarea' : 'input'
    return (
      <Field
        className="swiftui-field"
        type={hit.multiline ? undefined : hit.secure ? 'password' : 'text'}
        disabled={!hit.enabled}
        value={hit.value ?? ''}
        placeholder={hit.placeholder ?? ''}
        inputMode={hit.inputMode}
        enterKeyHint={hit.enterKeyHint}
        autoCapitalize={hit.autocapitalization}
        autoCorrect={hit.autocorrection === undefined ? undefined : hit.autocorrection ? 'on' : 'off'}
        spellCheck={hit.autocorrection}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.shiftKey || hit.multiline || !hit.submitHandlerId) return
          event.preventDefault()
          onEvent({ kind: 'tap', handlerId: hit.submitHandlerId, location: { x: 0, y: 0 } })
        }}
        aria-label={node.a11y?.label}
        onChange={(e) => onEvent({ kind: 'textChange', handlerId, value: e.target.value })}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          padding: `${hit.multiline ? 8 : 0}px ${hit.multiline ? 5 : hit.inputInset ?? 0}px`,
          resize: 'none',
          '--field-placeholder': hit.placeholderColor ? cssColor(hit.placeholderColor) : 'GrayText',
          boxSizing: 'border-box',
          ...(font
            ? {
                fontFamily: font.family,
                fontSize: font.size,
                fontWeight: font.weight,
                lineHeight: `${font.lineHeight}px`,
              }
            : {}),
          ...(hit.color ? { color: cssColor(hit.color) } : {}),
        } as CSSProperties}
      />
    )
  }

  return (
    <input
      className="swiftui-range"
      disabled={!hit.enabled}
      type="range"
      value={hit.value ?? '0'}
      min={hit.min ?? 0}
      max={hit.max ?? 1}
      step={hit.step && hit.step > 0 ? hit.step : 'any'}
      aria-label={node.a11y?.label}
      onChange={(e) => onEvent({ kind: 'slide', handlerId, value: Number(e.target.value) })}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        margin: 0,
        cursor: hit.enabled ? 'pointer' : 'default',
        '--range-thumb': `${hit.thumbDiameter ?? 28}px`,
      } as CSSProperties}
    />
  )
}

/**
 * `.redacted(reason: .placeholder)` - a bar the size of what it hides.
 *
 * The rounded grey bar iOS draws, inset a little vertically so a redacted line of
 * text does not fill its whole line box - which is how the real one looks beside an
 * unredacted neighbour.
 */
function RedactedBar() {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        margin: '2px 0',
        borderRadius: 4,
        background: 'currentColor',
        opacity: 0.18,
      }}
    />
  )
}

/**
 * `.colorMultiply` - every channel of the subtree multiplied by a colour.
 *
 * Drawn as an overlay in multiply blend mode, which is that operation exactly rather
 * than an approximation of it. It cannot be a CSS filter because there is no filter
 * function that multiplies by an arbitrary colour.
 */
function ColorMultiply({ color }: { color: RGBA }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: cssColor(color),
        mixBlendMode: 'multiply',
        pointerEvents: 'none',
      }}
    />
  )
}

/**
 * The CSS for a paint-time transform.
 *
 * One property rather than several, because CSS applies them in order about a single
 * origin and SwiftUI applies its own about the view's centre - so splitting them
 * across nodes would rotate about a point the user did not write.
 */
function cssTransform(t: NonNullable<RenderNode['transform']>): string {
  const parts = [`scale(${t.scaleX}, ${t.scaleY})`, `rotate(${t.rotate}deg)`]
  if (t.rotateX) parts.push(`rotateX(${t.rotateX}deg)`)
  if (t.rotateY) parts.push(`rotateY(${t.rotateY}deg)`)
  return parts.join(' ')
}

/**
 * Paints text.
 *
 * When the layout engine resolved line boxes, each line is positioned absolutely at
 * the offset the engine computed. Letting CSS re-wrap instead would mean two
 * different algorithms deciding where the breaks go - and the frame the engine
 * reported would no longer match the text actually drawn in it.
 *
 * A line is drawn from its *slices* when it has them, so a line that crosses a run
 * boundary keeps each half's own face. Without that, `Text("a").bold() + Text("b")`
 * drew both halves bold: the first run won and the rest were dropped.
 */
function TextContent({ node }: { node: RenderNode }) {
  const payload = node.text!
  const first = payload.runs[0]
  if (!first) return null

  const justify =
    payload.alignment === 'center'
      ? 'center'
      : payload.alignment === 'trailing'
        ? 'flex-end'
        : 'flex-start'

  // The line box carries the first run's typography, and a span appears only where a
  // line is made of more than one. Single-run text is almost all text, so this is the
  // path that has to stay cheap - and it keeps the colour on the element the line *is*
  // rather than on a child, which is what anything reading the painted colour expects.
  const typography: CSSProperties = { ...runStyle(first), whiteSpace: 'pre' }

  if (payload.lines && payload.lines.length > 0) {
    return (
      <>
        {payload.lines.map((line, i) => (
          <div
            key={i}
            style={{
              ...typography,
              position: 'absolute',
              left: 0,
              top: line.origin.y,
              width: '100%',
              height: line.height ?? first.font.lineHeight,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: justify,
            }}
          >
            {line.slices
              ? line.slices.map((slice, j) => {
                  const run = payload.runs[slice.run] ?? first
                  return <span key={j} dir="auto" style={{ ...runStyle(run), position: 'relative',
                    top: line.baseline - (slice.baseline ?? line.baseline) - (run.baselineOffset ?? 0), bottom: 'auto' }}>{slice.text}</span>
                })
              : <span dir="auto" style={{ position: 'relative', top: line.baseline - (line.fontBaseline ?? line.baseline) - (first.baselineOffset ?? 0) }}>{line.text}</span>}
          </div>
        ))}
      </>
    )
  }

  return (
    <div
      style={{
        ...typography,
        display: 'flex',
        height: '100%',
        alignItems: 'center',
        justifyContent: justify,
      }}
    >
      {payload.runs.length > 1
        ? payload.runs.map((run, i) => <RunSpan key={i} run={run} text={run.text} />)
        : first.text}
    </div>
  )
}

/**
 * One attributed span.
 *
 * `letterSpacing` is the paint half of tracking; the measurement half already
 * happened in the worker, so the two agree by construction rather than by both
 * guessing. `textDecoration` carries underline and strikethrough together because
 * CSS has one property for both and a span may have either or both.
 */
function RunSpan({ run, text }: { run: TextRun; text: string }) {
  return <span style={runStyle(run)}>{text}</span>
}

/** Everything one run says about how its characters are drawn. */
function runStyle(run: TextRun): CSSProperties {
  // CSS has one property for both, and a run may carry either or both.
  const decoration = [
    run.underline ? 'underline' : null,
    run.strikethrough ? 'line-through' : null,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    fontFamily: run.font.family,
    fontSize: run.font.size,
    fontWeight: run.font.weight,
    fontStyle: run.font.italic ? 'italic' : 'normal',
    fontKerning: 'normal',
    lineHeight: `${run.font.lineHeight}px`,
    color: cssColor(run.color),
    ...(decoration ? { textDecoration: decoration } : {}),
    // The paint half of tracking; the measurement half already happened in the worker,
    // so the two agree by construction rather than by both guessing.
    ...(run.tracking ? { letterSpacing: run.tracking } : {}),
    ...(run.baselineOffset ? { position: 'relative', bottom: run.baselineOffset } : {}),
    ...(run.tabularNumbers ? { fontVariantNumeric: 'tabular-nums' } : {}),
  }
}

/** Paint a bundled Ionicon or explicit vector fallback using the worker's metrics. */
function ImageContent({ node }: { node: RenderNode }) {
  const image = node.image!
  const maskId = useId().replaceAll(':', '')
  const asset = image.symbol ? symbolAsset(image.symbol, maskId) : null
  if (image.bitmap) return <img src={image.bitmap.url} alt={image.bitmap.name} draggable={false} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'fill', userSelect: 'none' }} />
  const metrics = symbolMetrics(image.symbol)
  const title = image.symbol ? `${image.symbol} — ${asset?.source === 'ionicons' ? 'Ionicons approximation' : asset ? 'vector approximation' : 'unsupported symbol'}` : undefined
  const height = image.resizable ? node.frame.height : image.font.size * metrics.heightEm * (image.symbolScale ?? 1)
  const width = image.resizable ? node.frame.width : image.font.size * metrics.widthEm * (image.symbolScale ?? 1)
  return (
    <div title={title} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: cssColor(image.color), userSelect: 'none' }}>
      {asset ? (
        <svg width={width} height={height} viewBox={asset.viewBox} fill="currentColor"
          preserveAspectRatio="xMidYMid meet" aria-hidden
          style={{ display: 'block', '--symbol-weight': symbolStrokeScale(image.font.weight) } as CSSProperties}
          dangerouslySetInnerHTML={{ __html: asset.body }} />
      ) : (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 16v1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )}
    </div>
  )
}

/**
 * Paints a vector path.
 *
 * One `<svg>` with one `<path>`. The geometry was resolved in the worker and
 * serialised to path data, so there is nothing to compute here - and `overflow:
 * visible` matters: a `Path`'s coordinates are absolute within its frame, and one
 * that strays outside should be visible rather than quietly clipped.
 */
function PathContent({ node }: { node: RenderNode }) {
  const path = node.path!

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${node.frame.width} ${node.frame.height}`}
      style={{ overflow: 'visible', display: 'block' }}
      aria-hidden
    >
      <path
        d={path.d}
        fill={path.fill ? cssFill(path.fill) : 'none'}
        fillRule={path.fillRule ?? 'nonzero'}
        stroke={path.stroke ? cssColor(path.stroke.color) : 'none'}
        strokeWidth={path.stroke?.width ?? 0}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The activity indicator, as iOS draws it: eight tapered spokes fading round the
 * circle, the whole thing turning once a second in eight discrete steps.
 *
 * `steps(8)` rather than a smooth rotation because a real one *is* stepped - the lit
 * spoke moves from one to the next - and a continuously sweeping ring is the Android
 * indicator, not this one.
 *
 * This used to be a filled grey circle. The comment above it claimed a dotted ring
 * that the renderer spun, and neither half was true of what appeared.
 */
function SpinnerContent() {
  const spokes = Array.from({ length: 8 }, (_, i) => i)

  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <g style={{ transformOrigin: '12px 12px', animation: 'studio-spin 0.8s steps(8) infinite' }}>
        {spokes.map((i) => (
          <rect
            key={i}
            x={11}
            y={2.2}
            width={2}
            height={6}
            rx={1}
            fill="currentColor"
            opacity={0.25 + (i / spokes.length) * 0.75}
            transform={`rotate(${i * 45} 12 12)`}
          />
        ))}
      </g>
    </svg>
  )
}

function ShapeContent({ node }: { node: RenderNode }) {
  const shape = node.shape!
  if (shape.shape === 'spinner') return <SpinnerContent />

  return <ShapeView shape={shape} width={node.frame.width} height={node.frame.height} />
}

/**
 * Requirement FR-4.11: anything outside the coverage matrix renders as a visible,
 * labelled box naming the missing feature. Never a blank space, never a silent
 * wrong result - a preview that quietly lies is worse than one that admits a gap.
 */
function PlaceholderContent({ node }: { node: RenderNode }) {
  const { feature, reason } = node.placeholder!

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        border: '1.5px dashed rgb(255 149 0 / 0.7)',
        borderRadius: 8,
        background: 'rgb(255 149 0 / 0.08)',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflow: 'hidden',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, color: 'rgb(180 95 0)' }}>{feature}</span>
      <span style={{ fontSize: 10, lineHeight: '13px', color: 'rgb(120 70 10)' }}>{reason}</span>
    </div>
  )
}
