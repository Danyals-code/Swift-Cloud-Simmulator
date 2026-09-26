import { createContext, useContext, useId, useState, useRef, useLayoutEffect, useEffect, useCallback, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type UIEvent as ReactUIEvent } from 'react'
import { ScrollIndicator } from './ScrollIndicator'
import { ShapeView, VectorPathView } from './ShapeView'
import { SliderView, ControlStyles } from './SliderView'
import { placeholderWords, symbolMetrics, shapePath } from '@studio/shared'
import { memo, useMemo, type CSSProperties, type ReactNode } from 'react'
import {
  cssTransform,
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
import { editDraft, shownValue, NO_DRAFT, type ControlDraft, type ControlEdit } from './control-draft'

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
  /**
   * Workspace layer selection, without intercepting preview interactions: the nodes of
   * each selected view, outlined as one box, so a card is outlined as a card rather than
   * as the words in it (D1).
   */
  selectedGroups?: readonly (readonly string[])[]
  /**
   * Temporary canvas outlines: each group is one view, under the Layers pointer or where a
   * click would select it, outlined as one box.
   */
  hoveredGroups?: readonly (readonly string[])[]
  /** Optional workspace-owned offsets shared across live and design phone mounts. */
  scrollPositions?: Map<string, { left: number; top: number }>
  /** Raised when an interactive node is activated. */
  onEvent?: EventSink
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
    /** What is drawn under the pointer, topmost first, as a click would find it, or null once it leaves. */
    onHover(under: readonly RenderNode[] | null): void
    /**
     * A click: everything drawn under the pointer, topmost first, and the keys held. A
     * Button's tap target is drawn over its label, so the views under it are the ones a
     * deeper selection reaches (D1).
     */
    onSelect(under: readonly RenderNode[], keys: InspectKeys): void
    /** A double-click, with where the topmost node is drawn, for an editor to sit over it. */
    onDoubleClick?(under: readonly RenderNode[], rect: { x: number; y: number; width: number; height: number }): void
  }
}

/** The keys held with a click while inspecting; what they mean is the workspace's to say. */
export interface InspectKeys {
  /** ⌘ on a Mac, Ctrl elsewhere. */
  readonly command: boolean
  readonly shift: boolean
}

/** What a node reports while inspecting; the tree adds what else is under the pointer. */
interface NodeInspect {
  onHover(node: RenderNode | null, event?: ReactMouseEvent<HTMLElement>): void
  onSelect(node: RenderNode, event: ReactMouseEvent<HTMLElement>): void
  onDoubleClick?(node: RenderNode, event: ReactMouseEvent<HTMLElement>): void
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
  selectedGroups,
  hoveredGroups,
  scrollPositions,
  inspect,
}: RenderTreeViewProps) {
  const reduceMotion = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [handoffs] = useState(() => new Map<string, Handoff>())
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
  // Each outline is the nodes of one view, as this tree paints them; a hover moving on
  // leaves the selection's outlines as they are.
  const nodesById = useMemo(() => new Map(tree.nodes.map(node => [node.id, node])), [tree])
  const selectedIds = useMemo(() => new Set(selectedGroups?.flat()), [selectedGroups])
  const selectedOutlines = useMemo(() => painted(nodesById, selectedGroups ?? []), [nodesById, selectedGroups])
  const inspected = inspect?.hovered ?? null
  const hoveredOutlines = useMemo(() => stale ? [] : painted(nodesById, [...(inspected ? [[inspected]] : []), ...hoveredGroups ?? []]), [nodesById, hoveredGroups, inspected, stale])

  // Nodes grouped by the container they live in. Built once per tree rather than
  // searched per node, so a thousand-row list stays linear.
  const byParent = useMemo(() => {
    const groups = new Map<string, RenderNode[]>()
    const opacities = new Map(tree.nodes.map(node => [node.id, node.opacity]))
    for (const original of tree.nodes) {
      // Render nodes carry cumulative opacity; nested CSS carries it implicitly.
      const parentOpacity = original.parent ? opacities.get(original.parent) ?? 1 : 1
      const node = { ...original, opacity: parentOpacity > 0 ? Math.min(1, Math.max(0, original.opacity / parentOpacity)) : 1 }
      const key = node.parent ?? ''
      const bucket = groups.get(key)
      if (bucket) bucket.push(node)
      else groups.set(key, [node])
    }
    return groups
  }, [tree])

  /**
   * A gesture while inspecting, with everything drawn where it happened, topmost first:
   * the browser's own list, in this tree, starting with the node that heard it.
   */
  const lastHover = useRef('')
  const nodeInspect = useMemo((): NodeInspect | undefined => {
    if (!inspect) return undefined
    const under = (node: RenderNode, event: ReactMouseEvent<HTMLElement>): RenderNode[] => {
      const surface = surfaceRef.current
      const nodes = new Map(tree.nodes.map(node => [node.id, node]))
      const found = (surface?.ownerDocument.elementsFromPoint?.(event.clientX, event.clientY) ?? []).flatMap(element => {
        const id = element instanceof HTMLElement && surface!.contains(element) ? element.dataset.nodeId : undefined
        const hit = id ? nodes.get(id) : undefined
        return hit ? [hit] : []
      })
      return [node, ...found.filter(item => item.id !== node.id)]
    }
    return {
      // Said again only when what is under the pointer changes, however often it moves.
      onHover: (node, event) => {
        const found = node && event ? under(node, event) : null
        const key = found?.map(item => item.id).join(' ') ?? ''
        if (key === lastHover.current) return
        lastHover.current = key
        inspect.onHover(found)
      },
      onSelect: (node, event) => inspect.onSelect(under(node, event), { command: event.metaKey || event.ctrlKey, shift: event.shiftKey }),
      ...(inspect.onDoubleClick ? { onDoubleClick: (node, event) => inspect.onDoubleClick!(under(node, event), event.currentTarget.getBoundingClientRect()) } : {}),
    }
  }, [inspect, tree])

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

      <ControlHandoffs.Provider value={handoffs}>
        <RenderNodeGroup nodes={byParent.get('') ?? EMPTY_NODES} byParent={byParent} animate={!reduceMotion && !inspect && !stale} onEvent={onEvent} selectedIds={selectedIds} debugOutlines={debugOutlines} inspect={nodeInspect} />
      </ControlHandoffs.Provider>

      {selectedOutlines.map((group, index) => <Outline key={`selected:${index}:${group[0]!.id}`} nodes={group} tree={tree} byId={nodesById} kind="selected" />)}
      {hoveredOutlines.map((group, index) => <Outline key={`hovered:${index}:${group[0]!.id}`} nodes={group} tree={tree} byId={nodesById} kind="hovered" />)}
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
  onEvent?: EventSink
  debugOutlines: boolean
  selectedIds?: ReadonlySet<string>
  inspect?: NodeInspect
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
 * One box around everything a view paints: what is selected, or hovered. Drawn above
 * everything and never itself hit-testable, and a card is outlined as one card (D1).
 *
 * A node inside a scroll view is positioned in the scroller's space, so the box has to
 * walk back up to the screen to find where it actually appears - otherwise hovering row
 * 40 of a list outlines something near the top of the screen.
 */
/** Each group's nodes as the tree paints them, leaving out groups it paints none of. */
function painted(byId: ReadonlyMap<string, RenderNode>, groups: readonly (readonly string[])[]): RenderNode[][] {
  return groups.map(ids => ids.flatMap(id => byId.get(id) ?? [])).filter(group => group.length > 0)
}

function Outline({ nodes, tree, byId, kind }: { nodes: readonly RenderNode[]; tree: RenderTree; byId: ReadonlyMap<string, RenderNode>; kind: 'selected' | 'hovered' }) {
  const outline = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = outline.current
    const surface = element?.parentElement
    const targets = nodes.flatMap(node => surface?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`) ?? [])
    if (!element || !surface || !targets.length) return
    // Read painted bounds so scrolling, padding and transforms use the same geometry
    // in both hover directions. Clip to scrollports, just like the painted content.
    const update = () => {
      const root = surface.getBoundingClientRect()
      const scaleX = root.width / tree.canvas.width, scaleY = root.height / tree.canvas.height
      if (!scaleX || !scaleY) return
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
      for (const target of targets) {
        const box = target.getBoundingClientRect()
        let l = box.left, t = box.top, r = box.right, b = box.bottom
        for (let parent = target.parentElement; parent && parent !== surface; parent = parent.parentElement) {
          const style = getComputedStyle(parent), rect = parent.getBoundingClientRect()
          if (/auto|scroll|hidden|clip/.test(style.overflowX)) { l = Math.max(l, rect.left); r = Math.min(r, rect.right) }
          if (/auto|scroll|hidden|clip/.test(style.overflowY)) { t = Math.max(t, rect.top); b = Math.min(b, rect.bottom) }
        }
        if (r <= l || b <= t) continue
        left = Math.min(left, l); top = Math.min(top, t); right = Math.max(right, r); bottom = Math.max(bottom, b)
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
    observer.observe(surface)
    targets.forEach(target => observer.observe(target))
    return () => { surface.removeEventListener('scroll', update, true); observer.disconnect() }
  }, [nodes, tree])

  // Where the nodes are laid out, until the painted bounds are read.
  const frames = nodes.map(node => {
    let x = node.frame.x, y = node.frame.y, current = node
    for (let depth = 0; current.parent && depth < 32; depth++) {
      const parent = byId.get(current.parent)
      if (!parent) break
      x += parent.frame.x
      y += parent.frame.y
      current = parent
    }
    return { x, y, right: x + node.frame.width, bottom: y + node.frame.height }
  })
  const x = Math.min(...frames.map(frame => frame.x)), y = Math.min(...frames.map(frame => frame.y))

  return (
    <div
      ref={outline}
      data-testid={kind === 'hovered' ? 'inspect-highlight' : 'selection-outline'}
      data-hovered-node-id={kind === 'hovered' ? nodes[0]!.id : undefined}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: Math.max(...frames.map(frame => frame.right)) - x,
        height: Math.max(...frames.map(frame => frame.bottom)) - y,
        ...(kind === 'hovered' ? { outline: '1.5px solid rgb(0 122 255)', background: 'rgb(0 122 255 / 0.12)' } : { outline: '2px solid rgb(0 122 255)', outlineOffset: -2 }),
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
  onEvent?: EventSink
  debugOutlines: boolean
  selectedIds?: ReadonlySet<string>
  inspect?: NodeInspect
  animate: boolean
  exiting?: boolean
}) {
  const multiplyId = `multiply-${useId().replace(/:/g, '')}`
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
    ...(node.background && node.cornerStyle !== 'continuous' ? { background: cssFill(node.background, node.frame) } : {}),
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
          filter: `drop-shadow(${node.shadow.x}px ${node.shadow.y}px ${node.shadow.radius}px ${cssColor(node.shadow.color)})`,
        }
      : {}),
    ...(node.transform
      ? {
          transform: cssTransform(node.transform, node.frame),
          transformOrigin: node.transform.rotation3D ? '0 0' : `${(node.transform.anchor?.x ?? 0.5) * 100}% ${(node.transform.anchor?.y ?? 0.5) * 100}%`,
        }
      : {}),
    ...(node.filter ? { filter: [cssFilter(node.filter), node.filter.multiply ? `url(#${multiplyId})` : ''].filter(Boolean).join(' ') || undefined } : {}),
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
  }

  const handlerId = node.hitTarget?.handlerId
  const role = node.hitTarget?.role

  // A control the browser owns. Its frame was still decided by the layout engine;
  // what the DOM supplies is the interaction the engine has no way to model.
  const nativeControl =
    handlerId && (role === 'textField' || onEvent && role === 'slider')
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
      {node.filter?.multiply ? <ColorMultiply color={node.filter.multiply} id={multiplyId} /> : null}
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
      onPointerEnter={inspecting ? event => inspect.onHover(node, event) : undefined}
      // A tap target is drawn over its label: moving over it moves over the label's views.
      onPointerMove={inspecting && node.hitTarget ? event => inspect.onHover(node, event) : undefined}
      onPointerLeave={() => { setPressed(false); if (inspecting) inspect.onHover(null) }}
      onDoubleClick={inspecting && inspect.onDoubleClick ? event => { event.preventDefault(); event.stopPropagation(); inspect.onDoubleClick?.(node, event) } : undefined}
      onClick={
        inspecting
          ? (e) => {
              e.stopPropagation()
              inspect.onSelect(node, e)
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
                beginDrag(e, handlerId, at, onEvent, e.currentTarget)
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
      {scroll?.showsIndicators && <ScrollIndicator node={node} />}
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
 *
 * A press that never travels is a tap, and iOS gives a tap to the control under the
 * finger rather than to the drag: a button in a row that swipes to delete, or a link
 * in a card that drags. The drag's target is drawn over its content, so the tap is
 * passed to the target beneath it.
 */
function beginDrag(
  down: { clientX: number; clientY: number },
  handlerId: string,
  at: (event: { clientX: number; clientY: number }) => { x: number; y: number },
  onEvent: (event: UIEvent) => void,
  layer: HTMLElement,
): void {
  const start = at(down)
  let moved = false
  let farthest = 0

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
    farthest = Math.max(farthest, Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY))
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
    if (event.type === 'pointerup' && farthest < TAP_SLOP) tapBeneath(layer, event)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

/** How far a press may wander, in page pixels, and still be a tap. */
const TAP_SLOP = 8

/**
 * Taps the first target under the point below `layer`, the way the browser would have
 * without it: a field takes focus, anything else is pressed and let go. Only targets
 * below it are looked at, so a tap never comes back up to a drag it already passed.
 */
function tapBeneath(layer: HTMLElement, at: { clientX: number; clientY: number }): void {
  const stack = document.elementsFromPoint(at.clientX, at.clientY)
  const beneath = stack.slice(stack.indexOf(layer) + 1).find((element): element is HTMLElement => element instanceof HTMLElement && element.dataset.handlerId !== undefined)
  if (!beneath) return
  const field = beneath.querySelector<HTMLElement>('input, textarea')
  if (field) { field.focus(); return }
  const press = { bubbles: true, cancelable: true, clientX: at.clientX, clientY: at.clientY, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }
  beneath.dispatchEvent(new PointerEvent('pointerdown', { ...press, buttons: 1 }))
  beneath.dispatchEvent(new PointerEvent('pointerup', { ...press, buttons: 0 }))
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

/**
 * Where the preview's events go. The promise, when there is one, settles once the app
 * has answered the event, which is when a control can show the app's value again.
 */
export type EventSink = (event: UIEvent) => void | Promise<void>

/** A control the browser owns, drawn at a node the layout engine placed. */
interface ControlProps {
  readonly node: RenderNode
  readonly handlerId: string
  readonly onEvent: EventSink | undefined
}

function renderControl(node: RenderNode, handlerId: string, onEvent: EventSink | undefined): ReactNode {
  return node.hitTarget!.role === 'textField'
    ? <PreviewField node={node} handlerId={handlerId} onEvent={onEvent} />
    : <PreviewSlider node={node} handlerId={handlerId} onEvent={onEvent} />
}

/**
 * What a control that is replaced leaves for the one that replaces it.
 *
 * A view appearing above a field, `if !name.isEmpty { Text(...) }`, moves the field
 * in the tree, so a new one is mounted where SwiftUI keeps the same field. What was
 * typed, the caret and the focus move to it, matched by where the control is written.
 */
interface Handoff {
  readonly draft: ControlDraft
  readonly focused: boolean
  readonly selection: readonly [number, number] | null
  readonly at: number
}

const ControlHandoffs = createContext<Map<string, Handoff> | null>(null)

/** A handoff older than this is for a control that went away, not one being replaced. */
const HANDOFF_MS = 1000

/**
 * What a field or slider shows while its changes are on their way: its own draft
 * until the app has answered them (see `control-draft`), then the app's value.
 */
function useControlDraft(node: RenderNode, send: (value: string) => void | Promise<void>) {
  const appValue = node.hitTarget?.value ?? (node.hitTarget?.role === 'slider' ? '0' : '')
  const [draft, setDraft] = useState<ControlDraft>(NO_DRAFT)
  const latest = useRef<ControlDraft>(NO_DRAFT)
  const sender = useRef(send)
  useLayoutEffect(() => { sender.current = send })
  const element = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const focused = useRef(false)
  const apply = useCallback((change: ControlEdit): string | undefined => {
    const next = editDraft(latest.current, change)
    latest.current = next.draft
    setDraft(next.draft)
    return next.send
  }, [])
  const edit = useCallback((change: ControlEdit) => {
    const value = apply(change)
    if (value === undefined) return
    const answered = () => { apply({ kind: 'answered' }) }
    void Promise.resolve(sender.current(value)).then(answered, answered)
  }, [apply])

  const handoffs = useContext(ControlHandoffs)
  const key = node.origin && `${node.origin.file}:${node.origin.start}:${node.origin.end}`
  useLayoutEffect(() => {
    const handoff = key ? handoffs?.get(key) : undefined
    if (!key || !handoff) return
    handoffs!.delete(key)
    if (performance.now() - handoff.at > HANDOFF_MS) return
    // The changes the old control sent went to a handler that is gone: send the text again.
    if (handoff.draft.value !== null) edit({ kind: 'input', value: handoff.draft.value })
    if (!handoff.focused) return
    element.current?.focus({ preventScroll: true })
    try {
      if (handoff.selection) element.current?.setSelectionRange(...handoff.selection)
    } catch {
      // A range or a time field has no caret to put back.
    }
  }, [key, handoffs, edit])
  useLayoutEffect(() => () => {
    if (!key || !handoffs || (latest.current.value === null && !focused.current)) return
    const target = element.current
    let selection: Handoff['selection'] = null
    try {
      selection = target && target.selectionStart !== null && target.selectionEnd !== null ? [target.selectionStart, target.selectionEnd] : null
    } catch {
      // As above: no caret.
    }
    handoffs.set(key, { draft: latest.current, focused: focused.current, selection, at: performance.now() })
  }, [key, handoffs])

  const tracking = {
    ref: element,
    onFocus: () => { focused.current = true },
    onBlur: () => { focused.current = false },
  }
  return { value: shownValue(draft, appValue), edit, tracking }
}

function PreviewField({ node, handlerId, onEvent }: ControlProps) {
  const hit = node.hitTarget!
  const font = hit.font
  const { value, edit, tracking } = useControlDraft(node, (text) => onEvent?.({ kind: 'textChange', handlerId, value: text }))
  const Field = hit.multiline ? 'textarea' : 'input'
  return (
    <Field
      {...tracking}
      className="swiftui-field"
      type={hit.multiline ? undefined : hit.inputType ?? (hit.secure ? 'password' : 'text')}
      step={hit.inputType === 'time' ? 60 : undefined}
      disabled={!hit.enabled}
      readOnly={!onEvent}
      tabIndex={onEvent ? undefined : -1}
      value={value}
      placeholder={hit.placeholder ?? ''}
      inputMode={hit.inputMode}
      enterKeyHint={hit.enterKeyHint}
      autoCapitalize={hit.autocapitalization}
      autoCorrect={hit.autocorrection === undefined ? undefined : hit.autocorrection ? 'on' : 'off'}
      spellCheck={hit.autocorrection}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.shiftKey || hit.multiline || !hit.submitHandlerId) return
        event.preventDefault()
        onEvent?.({ kind: 'tap', handlerId: hit.submitHandlerId, location: { x: 0, y: 0 } })
      }}
      aria-label={node.a11y?.label}
      onChange={(e) => edit({ kind: 'input', value: e.target.value })}
      onCompositionStart={() => edit({ kind: 'compositionStart' })}
      onCompositionEnd={(e) => edit({ kind: 'compositionEnd', value: e.currentTarget.value })}
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
        textAlign: hit.textAlign === 'center' ? 'center' : hit.textAlign === 'trailing' ? 'end' : 'start',
        '--field-placeholder': hit.placeholderColor ? cssColor(hit.placeholderColor) : 'GrayText',
        boxSizing: 'border-box',
        ...(font
          ? {
              fontFamily: font.family,
              fontSize: font.size,
              fontWeight: font.weight,
              fontStyle: font.italic ? 'italic' : 'normal',
              lineHeight: `${font.lineHeight}px`,
            }
          : {}),
        ...(hit.color ? { color: cssColor(hit.color) } : {}),
      } as CSSProperties}
    />
  )
}

function PreviewSlider({ node, handlerId, onEvent }: ControlProps) {
  const hit = node.hitTarget!
  const { value, edit, tracking } = useControlDraft(node, (position) => onEvent?.({ kind: 'slide', handlerId, value: Number(position) }))
  return (
    <input
      {...tracking}
      className="swiftui-range"
      disabled={!hit.enabled}
      type="range"
      value={value}
      min={hit.min ?? 0}
      max={hit.max ?? 1}
      step={hit.step && hit.step > 0 ? hit.step : 'any'}
      aria-label={node.a11y?.label}
      onChange={(e) => edit({ kind: 'input', value: e.target.value })}
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

/** Multiplication preserves the subtree alpha and transparent corners. */
function ColorMultiply({ color, id }: { color: RGBA; id: string }) {
  return <svg width="0" height="0" aria-hidden style={{ position: 'absolute', pointerEvents: 'none' }}><defs>
    <filter id={id} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={`${color.r/255} 0 0 0 0 0 ${color.g/255} 0 0 0 0 0 ${color.b/255} 0 0 0 0 0 ${color.a} 0`} />
    </filter>
  </defs></svg>
}

/**
 * The CSS for a paint-time transform.
 *
 * One property rather than several, because CSS applies them in order about a single
 * origin and SwiftUI applies its own about the view's centre - so splitting them
 * across nodes would rotate about a point the user did not write.
 */

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
  const typography: CSSProperties = { ...runStyle(first, node.frame), ...(payload.runs.length > 1 ? { textDecoration: undefined, textDecorationColor: undefined, backgroundImage: undefined, backgroundClip: undefined, WebkitBackgroundClip: undefined } : {}), whiteSpace: 'pre' }

  if (payload.lines && payload.lines.length > 0) {
    return (
      <>
        {payload.lines.map((line, i) => {
          const height = line.height ?? first.font.lineHeight
          // A line of one run is drawn in a box as tall as the line, so the text's box is
          // its frame: a first or last line gives up half its leading, and a box as tall as
          // the leading would reach into the view beside it. CSS centres the glyphs in the
          // box, so the baseline moves by half of what the box gave up.
          const fontBaseline = (line.fontBaseline ?? line.baseline) - (first.font.lineHeight - height) / 2
          return (
            <div
              key={i}
              style={{
                ...typography,
                ...(line.slices ? {} : { lineHeight: `${height}px` }),
                position: 'absolute',
                left: 0,
                top: line.origin.y,
                width: '100%',
                height,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: justify,
              }}
            >
              {line.slices
                ? line.slices.map((slice, j) => {
                    const run = payload.runs[slice.run] ?? first
                    return <span key={j} dir="auto" style={{ ...runStyle(run, node.frame), position: 'relative',
                      top: line.baseline - (slice.baseline ?? line.baseline) - (run.baselineOffset ?? 0), bottom: 'auto' }}>{decoratedText(run, slice.text)}</span>
                  })
                : <span dir="auto" style={{ position: 'relative', top: line.baseline - fontBaseline - (first.baselineOffset ?? 0) }}>{decoratedText(first, line.text)}</span>}
            </div>
          )
        })}
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
        : decoratedText(first, first.text)}
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
  return <span style={runStyle(run)}>{decoratedText(run, text)}</span>
}

function decoratedText(run: TextRun, text: string): ReactNode {
  if (!run.underline || !run.strikethrough || cssColor(run.underlineColor ?? run.color) === cssColor(run.strikethroughColor ?? run.color)) return text
  return <span style={{ textDecoration: 'underline', textDecorationColor: cssColor(run.underlineColor ?? run.color) }}><span style={{ textDecoration: 'line-through', textDecorationColor: cssColor(run.strikethroughColor ?? run.color) }}>{text}</span></span>
}

/** Everything one run says about how its characters are drawn. */
function runStyle(run: TextRun, size?: {width:number;height:number}): CSSProperties {
  // CSS has one property for both, and a run may carry either or both.
  const separate = run.underline && run.strikethrough && cssColor(run.underlineColor ?? run.color) !== cssColor(run.strikethroughColor ?? run.color)
  const decoration = separate ? '' : [
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
    ...(run.foregroundFill ? { backgroundImage: cssFill(run.foregroundFill, size), backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent' } : {}),
    ...(decoration ? { textDecoration: decoration, textDecorationColor: cssColor((run.underline ? run.underlineColor : run.strikethroughColor) ?? run.color) } : {}),
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
  const title = image.symbol ? `${image.symbol} (${asset?.source === 'ionicons' ? 'Ionicons approximation' : asset ? 'vector approximation' : 'unsupported symbol'})` : undefined
  if (image.foregroundFill && asset) {
    const viewWidth = node.frame.width, viewHeight = node.frame.height
    return <svg width="100%" height="100%" viewBox={`0 0 ${viewWidth} ${viewHeight}`} aria-hidden>
      <defs><mask id={`${maskId}-foreground`} maskUnits="userSpaceOnUse" x="0" y="0" width={viewWidth} height={viewHeight}>
        <svg width={viewWidth} height={viewHeight} viewBox={asset.viewBox} fill="white" color="white" style={{ '--symbol-weight': symbolStrokeScale(image.font.weight) } as CSSProperties} dangerouslySetInnerHTML={{ __html: asset.body }} />
      </mask></defs>
      <foreignObject width={viewWidth} height={viewHeight} mask={`url(#${maskId}-foreground)`}>
        <div title={title} style={{ width: '100%', height: '100%', background: cssFill(image.foregroundFill, node.frame) }} />
      </foreignObject>
    </svg>
  }
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
  return <VectorPathView path={node.path!} width={node.frame.width} height={node.frame.height} />
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
  const { title, detail } = placeholderWords(node.placeholder!)

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
      <span style={{ fontSize: 11, fontWeight: 700, color: 'rgb(180 95 0)' }}>{title}</span>
      <span style={{ fontSize: 10, lineHeight: '13px', color: 'rgb(120 70 10)' }} title={detail}>{detail}</span>
    </div>
  )
}
