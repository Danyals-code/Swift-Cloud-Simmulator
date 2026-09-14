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

/** Appends a second layout pass — an overlay, a bar — above everything already there. */
export function appendPlaced(
  tree: RenderTree,
  placed: readonly PlacedNode[],
  zOffset: number,
): RenderTree {
  const nodes = [...tree.nodes]
  for (const node of placed) {
    const converted = toRenderNode(node)
    if (converted) nodes.push({ ...converted, z: converted.z + zOffset })
  }
  return { ...tree, nodes }
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
    ...(node.parent ? { parent: node.parent } : {}),
    ...(node.clip ? { clip: true } : {}),
    ...(node.border ? { border: node.border } : {}),
    ...(node.shadow ? { shadow: node.shadow } : {}),
    ...(node.transform ? { transform: node.transform } : {}),
    ...(node.animation ? { animation: node.animation } : {}),
    ...(node.debugName
      ? {
          inspect: {
            name: node.debugName,
            ...(node.debugModifiers?.length ? { modifiers: node.debugModifiers } : {}),
          },
        }
      : {}),
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

    case 'image': {
      const paint = node.paint
      return {
        ...base,
        kind: 'image',
        image: {
          glyph: paint.glyph,
          font: paint.font,
          color: paint.color,
          approximated: paint.approximated,
          ...(node.debugName && node.debugName !== 'Image' ? { symbol: node.debugName } : {}),
        },
        a11y: { role: 'img', label: node.debugName ?? 'Image' },
      }
    }

    case 'scroll':
      return {
        ...base,
        kind: 'layer',
        clip: true,
        scroll: {
          axis: node.paint.axis,
          content: node.paint.content,
          showsIndicators: node.paint.showsIndicators,
        },
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
      // and it sits above its content so a label cannot swallow the press. The same
      // node kind also carries borders, shadows, clips and transforms, all of which
      // are boxes with no paint of their own.
      return {
        ...base,
        kind: 'layer',
        ...(node.hitTarget
          ? {
              hitTarget: {
                handlerId: node.hitTarget.handlerId,
                role: node.hitTarget.role,
                enabled: node.hitTarget.enabled,
                ...(node.hitTarget.value !== undefined ? { value: node.hitTarget.value } : {}),
                ...(node.hitTarget.placeholder !== undefined
                  ? { placeholder: node.hitTarget.placeholder }
                  : {}),
                ...(node.hitTarget.min !== undefined ? { min: node.hitTarget.min } : {}),
                ...(node.hitTarget.max !== undefined ? { max: node.hitTarget.max } : {}),
                ...(node.hitTarget.font ? { font: node.hitTarget.font } : {}),
                ...(node.hitTarget.color ? { color: node.hitTarget.color } : {}),
              },
              a11y: { role: a11yRole(node.hitTarget.role), label: node.hitTarget.label },
            }
          : {}),
      }
  }
}

function a11yRole(role: string): string {
  switch (role) {
    case 'toggle':
      return 'switch'
    case 'textField':
      return 'textbox'
    case 'slider':
      return 'slider'
    default:
      return 'button'
  }
}
