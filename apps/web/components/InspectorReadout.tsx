'use client'

import type { RenderNode } from '@studio/shared'

export interface InspectorReadoutProps {
  node: RenderNode | null
  active: boolean
}

/**
 * The inspector's readout (FR-5.8).
 *
 * Shows what the hovered view is, the frame the layout engine computed for it, and
 * the modifiers applied to it. The computed frame is the useful part: "why is this
 * 353 wide" is the question a layout preview exists to answer, and it is exactly what
 * a screenshot cannot tell you.
 */
export function InspectorReadout({ node, active }: InspectorReadoutProps) {
  if (!active) return null

  return (
    <div
      data-testid="inspector-readout"
      className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#101014]/95 px-3 py-2 font-mono text-[11px] backdrop-blur"
    >
      {node ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-semibold text-sky-300">{node.inspect?.name ?? node.kind}</span>

          <span className="text-zinc-500" data-testid="inspector-frame">
            {round(node.frame.x)}, {round(node.frame.y)} · {round(node.frame.width)} ×{' '}
            {round(node.frame.height)}
          </span>

          {node.inspect?.modifiers?.length ? (
            <span className="text-zinc-600">{node.inspect.modifiers.join(' ')}</span>
          ) : null}

          {node.origin ? (
            <span className="ml-auto text-zinc-500">click to reveal</span>
          ) : (
            <span className="ml-auto text-zinc-700">no source</span>
          )}
        </div>
      ) : (
        <span className="text-zinc-600">Hover a view to inspect it.</span>
      )}
    </div>
  )
}

/** Frames are fractional; whole points are what the user reasons about. */
function round(value: number): number {
  return Math.round(value * 10) / 10
}
