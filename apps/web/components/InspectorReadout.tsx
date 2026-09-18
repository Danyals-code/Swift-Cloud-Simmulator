'use client'

import type { RenderNode } from '@studio/shared'
import styles from './Workspace.module.css'

export interface InspectorReadoutProps {
  node: RenderNode | null
  active: boolean
  /** What a click will do here: select the view in Layers, or open its source. */
  action?: 'select' | 'reveal'
}

/**
 * The inspector's readout (FR-5.8).
 *
 * Shows what the hovered view is, the frame the layout engine computed for it, and
 * the modifiers applied to it. The computed frame is the useful part: "why is this
 * 353 wide" is the question a layout preview exists to answer, and it is exactly what
 * a screenshot cannot tell you.
 *
 * One line at the foot of the canvas, in the flow rather than floating over it. It
 * used to hover inside the scrolling device area, which left a strip of canvas
 * between it and whatever came next; a status line belongs against the edge it
 * reports from.
 */
export function InspectorReadout({ node, active, action = 'reveal' }: InspectorReadoutProps) {
  if (!active) return null

  return (
    <div data-testid="inspector-readout" className={styles.readoutInfo}>
      {node ? (
        <div className="flex min-w-0 items-baseline gap-x-3 whitespace-nowrap">
          <span className="font-semibold text-xc-accent">{node.inspect?.name ?? node.kind}</span>

          <span className="text-xc-text-2" data-testid="inspector-frame">
            {round(node.frame.x)}, {round(node.frame.y)} · {round(node.frame.width)} ×{' '}
            {round(node.frame.height)}
          </span>

          {node.inspect?.modifiers?.length ? (
            <span className="min-w-0 overflow-hidden text-ellipsis text-xc-text-3">{node.inspect.modifiers.join(' ')}</span>
          ) : null}

          {action === 'select' ? (
            <span className="ml-auto text-xc-text-2">click to select</span>
          ) : node.origin ? (
            <span className="ml-auto text-xc-text-2">click to reveal</span>
          ) : (
            <span className="ml-auto text-xc-text-3">no source</span>
          )}
        </div>
      ) : (
        <span className="text-xc-text-3">Hover a view to inspect it.</span>
      )}
    </div>
  )
}

/** Frames are fractional; whole points are what the user reasons about. */
function round(value: number): number {
  return Math.round(value * 10) / 10
}
