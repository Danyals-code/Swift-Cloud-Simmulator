import { memo, type CSSProperties } from 'react'
import {
  cssColor,
  cssFill,
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
  /** Outline every node. Precursor to the Phase 4 view inspector. */
  debugOutlines?: boolean
}

/**
 * Paints a laid-out RenderTree.
 *
 * This component does **no layout**. Every node already carries an absolute frame
 * computed by the layout engine, so each becomes an absolutely positioned div and
 * CSS never gets a chance to disagree with SwiftUI about sizing. That is the point
 * of decision D2 (docs/02-ARCHITECTURE.md §12) and the reason this file is as dull
 * as it is — all the difficulty lives upstream.
 */
export const RenderTreeView = memo(function RenderTreeView({
  tree,
  onEvent,
  stale = false,
  debugOutlines = false,
}: RenderTreeViewProps) {
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
      {tree.nodes.map((node) => (
        <RenderNodeView
          key={node.id}
          node={node}
          onEvent={onEvent}
          debugOutlines={debugOutlines}
        />
      ))}
    </div>
  )
})

function RenderNodeView({
  node,
  onEvent,
  debugOutlines,
}: {
  node: RenderNode
  onEvent?: (event: UIEvent) => void
  debugOutlines: boolean
}) {
  const interactive = node.hitTarget?.enabled === true

  const style: CSSProperties = {
    position: 'absolute',
    left: node.frame.x,
    top: node.frame.y,
    width: node.frame.width,
    height: node.frame.height,
    zIndex: node.z,
    opacity: node.opacity,
    // Only hit targets receive pointer events, so a text label painted on top of a
    // button does not swallow the tap meant for the button underneath it.
    pointerEvents: interactive ? 'auto' : 'none',
    cursor: interactive ? 'pointer' : 'default',
    ...(node.background ? { background: cssFill(node.background) } : {}),
    ...(node.cornerRadius ? { borderRadius: node.cornerRadius } : {}),
    ...(node.clip ? { overflow: 'hidden' } : {}),
    ...(debugOutlines ? { outline: '1px solid rgb(0 122 255 / 0.35)', outlineOffset: -1 } : {}),
  }

  const handlerId = node.hitTarget?.handlerId

  return (
    <div
      data-node-id={node.id}
      data-kind={node.kind}
      style={style}
      role={node.a11y?.role}
      aria-label={node.a11y?.label}
      aria-hidden={node.a11y?.hidden}
      onPointerDown={
        interactive && handlerId && onEvent
          ? (e) => {
              e.preventDefault()
              const bounds = e.currentTarget.getBoundingClientRect()
              const scale = bounds.width / node.frame.width || 1
              onEvent({
                kind: 'tap',
                handlerId,
                location: {
                  x: (e.clientX - bounds.left) / scale,
                  y: (e.clientY - bounds.top) / scale,
                },
              })
            }
          : undefined
      }
    >
      {node.kind === 'text' && node.text ? <TextContent node={node} /> : null}
      {node.kind === 'shape' && node.shape ? <ShapeContent node={node} /> : null}
      {node.kind === 'placeholder' && node.placeholder ? <PlaceholderContent node={node} /> : null}
    </div>
  )
}

function TextContent({ node }: { node: RenderNode }) {
  const payload = node.text!
  const first = payload.runs[0]

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        alignItems: 'center',
        justifyContent:
          payload.alignment === 'center'
            ? 'center'
            : payload.alignment === 'trailing'
              ? 'flex-end'
              : 'flex-start',
        // Phase 3 fills in resolved line boxes; until then the browser wraps and
        // whiteSpace:pre keeps the runs from collapsing their spacing.
        whiteSpace: 'pre',
        fontFamily: first?.font.family,
        fontSize: first?.font.size,
        fontWeight: first?.font.weight,
        lineHeight: `${first?.font.lineHeight ?? 0}px`,
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
