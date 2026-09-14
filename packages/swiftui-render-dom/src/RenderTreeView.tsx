import { memo, useMemo, type CSSProperties, type ReactNode } from 'react'
import {
  cssColor,
  cssFill,
  cssFilter,
  cssTransition,
  type RenderNode,
  type RenderTree,
  type UIEvent,
} from '@studio/shared'

export interface RenderTreeViewProps {
  tree: RenderTree
  /** Raised when an interactive node is activated. */
  onEvent?: (event: UIEvent) => void
  /**
   * Dim the tree when it is stale — a parse error means we keep painting the last
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
   * innermost view under the cursor — which is what the DOM's own hit testing
   * already gives us, since children paint above their parents.
   */
  inspect?: {
    readonly hovered: string | null
    onHover(node: RenderNode | null): void
    onSelect(node: RenderNode): void
  }
}

/**
 * Paints a laid-out RenderTree.
 *
 * This component does **no layout**. Every node already carries an absolute frame
 * computed by the layout engine, so each becomes an absolutely positioned div and
 * CSS never gets a chance to disagree with SwiftUI about sizing. That is the point
 * of decision D2 (docs/02-ARCHITECTURE.md §12) and the reason this file is as dull
 * as it is — all the difficulty lives upstream.
 *
 * Phase 6 adds the two things that genuinely cannot be flat:
 *
 * - **Containers.** A node naming another as its `parent` is rendered *inside* it, in
 *   its coordinate space. That is what makes scrolling native — the browser's own
 *   momentum and rubber-banding rather than an approximation of them in the worker —
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
  inspect,
}: RenderTreeViewProps) {
  const hoveredNode = inspect?.hovered
    ? tree.nodes.find((n) => n.id === inspect.hovered)
    : undefined

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
      data-testid="render-tree"
      data-revision={tree.revision}
      style={{
        position: 'relative',
        width: tree.canvas.width,
        height: tree.canvas.height,
        overflow: 'hidden',
        opacity: stale ? 0.55 : 1,
        transition: 'opacity 120ms ease-out',
        // Keep text crisp under the scale transform the device frame applies.
        textRendering: 'optimizeLegibility',
      }}
    >
      {(byParent.get('') ?? []).map((node) => (
        <RenderNodeView
          key={node.id}
          node={node}
          byParent={byParent}
          onEvent={onEvent}
          debugOutlines={debugOutlines}
          inspect={inspect}
        />
      ))}

      {hoveredNode ? <InspectHighlight node={hoveredNode} tree={tree} /> : null}
    </div>
  )
})

/**
 * The highlight rect. Drawn above everything and never itself hit-testable.
 *
 * A node inside a scroll view is positioned in the scroller's space, so the highlight
 * has to walk back up to the screen to find where it actually appears — otherwise
 * hovering row 40 of a list outlines something near the top of the screen.
 */
function InspectHighlight({ node, tree }: { node: RenderNode; tree: RenderTree }) {
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
      data-testid="inspect-highlight"
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
  inspect,
}: {
  node: RenderNode
  byParent: ReadonlyMap<string, RenderNode[]>
  onEvent?: (event: UIEvent) => void
  debugOutlines: boolean
  inspect?: RenderTreeViewProps['inspect']
}) {
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
    // Only hit targets receive pointer events, so a text label painted on top of a
    // button does not swallow the tap meant for the button underneath it. A scroller
    // needs them too, or the wheel does nothing. In inspector mode every node is
    // hittable, which is the whole point.
    pointerEvents: inspecting || interactive || scroll ? 'auto' : 'none',
    cursor: inspecting ? 'crosshair' : interactive ? 'pointer' : 'default',
    ...(node.background ? { background: cssFill(node.background) } : {}),
    ...(node.cornerRadius ? { borderRadius: node.cornerRadius } : {}),
    ...(node.clip ? { overflow: scroll ? 'auto' : 'hidden' } : {}),
    ...(scroll
      ? {
          overflowX: scroll.axis === 'horizontal' ? 'auto' : 'hidden',
          overflowY: scroll.axis === 'vertical' ? 'auto' : 'hidden',
          scrollbarWidth: scroll.showsIndicators ? 'thin' : 'none',
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
          transform: `scale(${node.transform.scaleX}, ${node.transform.scaleY}) rotate(${node.transform.rotate}deg)`,
        }
      : {}),
    ...(node.filter ? { filter: cssFilter(node.filter) } : {}),
    ...(node.material
      ? {
          // A material is a translucent panel over a blurred backdrop, which is
          // exactly what `backdrop-filter` does — the one Apple effect CSS has a
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
    interactive && handlerId && onEvent && (role === 'textField' || role === 'slider')
      ? renderControl(node, handlerId, onEvent)
      : null

  const content: ReactNode = (
    <>
      {node.kind === 'text' && node.text ? <TextContent node={node} /> : null}
      {node.kind === 'image' && node.image ? <ImageContent node={node} /> : null}
      {node.kind === 'shape' && node.shape ? <ShapeContent node={node} /> : null}
      {node.kind === 'path' && node.path ? <PathContent node={node} /> : null}
      {node.kind === 'placeholder' && node.placeholder ? <PlaceholderContent node={node} /> : null}
      {nativeControl}
      {children?.length ? (
        <ScrollContent node={node}>
          {children.map((child) => (
            <RenderNodeView
              key={child.id}
              node={child}
              byParent={byParent}
              onEvent={onEvent}
              debugOutlines={debugOutlines}
              inspect={inspect}
            />
          ))}
        </ScrollContent>
      ) : null}
    </>
  )

  return (
    <div
      data-node-id={node.id}
      data-kind={node.kind}
      style={style}
      role={node.a11y?.role}
      aria-label={node.a11y?.label}
      aria-valuetext={node.a11y?.value}
      aria-description={node.a11y?.hint}
      aria-hidden={node.a11y?.hidden}
      onPointerEnter={inspecting ? () => inspect.onHover(node) : undefined}
      onPointerLeave={inspecting ? () => inspect.onHover(null) : undefined}
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
              e.preventDefault()
              const bounds = e.currentTarget.getBoundingClientRect()
              const scale = bounds.width / node.frame.width || 1
              const at = (event: { clientX: number; clientY: number }) => ({
                x: (event.clientX - bounds.left) / scale,
                y: (event.clientY - bounds.top) / scale,
              })

              // A toggle reports the value it is moving *to*, so the worker never has
              // to guess from a stale copy of the binding.
              if (role === 'toggle') {
                onEvent({ kind: 'toggle', handlerId, value: node.hitTarget?.value !== 'on' })
                return
              }

              if (role === 'drag') {
                beginDrag(e, handlerId, at, onEvent)
                return
              }

              onEvent({ kind: 'tap', handlerId, location: at(e) })
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
 * would do the same job, but only for the element that still exists — and a
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
    return (
      <input
        value={hit.value ?? ''}
        placeholder={hit.placeholder ?? ''}
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
          padding: '0 8px',
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
        }}
      />
    )
  }

  return (
    <input
      type="range"
      value={hit.value ?? '0'}
      min={hit.min ?? 0}
      max={hit.max ?? 1}
      step={(((hit.max ?? 1) - (hit.min ?? 0)) / 100).toString()}
      aria-label={node.a11y?.label}
      onChange={(e) => onEvent({ kind: 'slide', handlerId, value: Number(e.target.value) })}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        margin: 0,
        accentColor: 'rgb(0 122 255)',
      }}
    />
  )
}

/**
 * Paints text.
 *
 * When the layout engine resolved line boxes, each line is positioned absolutely at
 * the offset the engine computed. Letting CSS re-wrap instead would mean two
 * different algorithms deciding where the breaks go — and the frame the engine
 * reported would no longer match the text actually drawn in it.
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

  const typography: CSSProperties = {
    fontFamily: first.font.family,
    fontSize: first.font.size,
    fontWeight: first.font.weight,
    fontStyle: first.font.italic ? 'italic' : 'normal',
    lineHeight: `${first.font.lineHeight}px`,
    color: cssColor(first.color),
    whiteSpace: 'pre',
  }

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
              height: first.font.lineHeight,
              display: 'flex',
              alignItems: 'center',
              justifyContent: justify,
            }}
          >
            {line.text}
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
      {payload.runs.map((run, i) => (
        <span
          key={i}
          style={{
            fontFamily: run.font.family,
            fontSize: run.font.size,
            fontWeight: run.font.weight,
            fontStyle: run.font.italic ? 'italic' : 'normal',
            lineHeight: `${run.font.lineHeight}px`,
            color: cssColor(run.color),
          }}
        >
          {run.text}
        </span>
      ))}
    </div>
  )
}

/**
 * Paints a symbol.
 *
 * The glyph is an open substitute, never Apple's — SF Symbols cannot be redistributed
 * to a browser (risk R2). `title` says so on hover, so the difference is discoverable
 * rather than a surprise when the project is first built in Xcode.
 */
function ImageContent({ node }: { node: RenderNode }) {
  const image = node.image!

  return (
    <div
      title={image.approximated && image.symbol ? `${image.symbol} — approximated` : undefined}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: image.font.size,
        lineHeight: `${image.font.lineHeight}px`,
        color: cssColor(image.color),
        userSelect: 'none',
      }}
    >
      {image.glyph}
    </div>
  )
}

/**
 * Paints a vector path.
 *
 * One `<svg>` with one `<path>`. The geometry was resolved in the worker and
 * serialised to path data, so there is nothing to compute here — and `overflow:
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

function ShapeContent({ node }: { node: RenderNode }) {
  const shape = node.shape!
  const radius =
    shape.shape === 'circle' || shape.shape === 'ellipse' || shape.shape === 'capsule'
      ? '50%'
      : (shape.cornerRadius ?? 0)

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        borderRadius: radius,
        background: shape.fill ? cssFill(shape.fill) : undefined,
        border: shape.stroke
          ? `${shape.stroke.width}px solid ${cssColor(shape.stroke.color)}`
          : undefined,
      }}
    />
  )
}

/**
 * Requirement FR-4.11: anything outside the coverage matrix renders as a visible,
 * labelled box naming the missing feature. Never a blank space, never a silent
 * wrong result — a preview that quietly lies is worse than one that admits a gap.
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
