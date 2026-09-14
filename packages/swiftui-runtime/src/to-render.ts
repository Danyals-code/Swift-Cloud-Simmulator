import {
  rgba,
  type RenderNode,
  type RenderTree,
  type Size,
  type TextLine,
} from '@studio/shared'
import type { PlacedNode } from '@studio/swiftui-layout'

/**
 * Converts placed layout nodes into the render tree the main thread paints.
 *
 * Almost mechanical, and deliberately so: everything hard already happened in the
 * layout engine. The one judgement here is that resolved text line boxes are passed
 * through, so the renderer paints the lines the engine measured rather than letting
 * CSS re-wrap and disagree about height.
 */
export function placedToRenderTree(
  placed: readonly PlacedNode[],
  canvas: Size,
  revision: number,
  background = rgba(255, 255, 255),
): RenderTree {
  const nodes: RenderNode[] = [
    {
      id: 'screen',
      kind: 'layer',
      frame: { x: 0, y: 0, width: canvas.width, height: canvas.height },
      z: 0,
      opacity: 1,
      background: { kind: 'solid', color: background },
    },
  ]

  for (const node of placed) {
    const converted = toRenderNode(node)
    if (converted) nodes.push(converted)
  }

  return { canvas, nodes, revision }
}

function toRenderNode(node: PlacedNode): RenderNode | null {
  const base = {
    id: node.id,
    frame: node.frame,
    // +1 so nothing collides with the screen backdrop at z 0.
    z: node.z + 1,
    opacity: node.opacity,
    ...(node.cornerRadius > 0 ? { cornerRadius: node.cornerRadius } : {}),
    ...(node.origin ? { origin: node.origin } : {}),
  }

  switch (node.paint.kind) {
    case 'text': {
      const paint = node.paint
      const lineHeight = paint.font.lineHeight
      const lines: TextLine[] = paint.lines.map((line, index) => ({
        text: line.text,
        origin: { x: 0, y: index * lineHeight },
        width: line.width,
        baseline: lineHeight * 0.78,
      }))

      return {
        ...base,
        kind: 'text',
        text: {
          runs: [{ text: paint.text, font: paint.font, color: paint.color }],
          alignment: 'leading',
          lines,
        },
        a11y: { role: 'text', label: paint.text },
      }
    }

    case 'fill':
      return { ...base, kind: 'layer', background: node.paint.fill }

    case 'shape':
      return {
        ...base,
        kind: 'shape',
        shape: {
          shape: node.paint.shape,
          fill: node.paint.fill,
          ...(node.cornerRadius > 0 ? { cornerRadius: node.cornerRadius } : {}),
        },
      }

    case 'placeholder':
      return {
        ...base,
        kind: 'placeholder',
        placeholder: { feature: node.paint.feature, reason: node.paint.reason },
      }

    case 'hit':
      // Invisible, but it must still be in the tree: it is what receives the tap,
      // and it sits above its content so a label cannot swallow the press.
      return {
        ...base,
        kind: 'layer',
        ...(node.hitTarget
          ? {
              hitTarget: { handlerId: node.hitTarget.handlerId, role: 'button' as const, enabled: true },
              a11y: { role: 'button', label: node.hitTarget.label },
            }
          : {}),
      }
  }
}
