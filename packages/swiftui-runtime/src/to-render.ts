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

/** Appends a second layout pass - an overlay, a bar - above everything already there. */
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
    cornerStyle: node.cornerStyle,
    clipShape: node.clipShape,
    id: node.id,
    frame: node.frame,
    // +1 so nothing collides with the screen backdrop at z 0.
    z: node.z + 1,
    opacity: node.opacity,
    ...(node.cornerRadius > 0 ? { cornerRadius: node.cornerRadius } : {}),
    ...(node.blendMode ? { blendMode: node.blendMode } : {}),
    ...(node.redacted ? { redacted: true } : {}),
    ...(node.origin ? { origin: node.origin } : {}),
    ...(node.parent ? { parent: node.parent } : {}),
    ...(node.clip ? { clip: true } : {}),
    ...(node.border ? { border: node.border } : {}),
    ...(node.shadow ? { shadow: node.shadow } : {}),
    ...(node.transform ? { transform: node.transform } : {}),
    ...(node.animation ? { animation: node.animation } : {}),
    ...(node.transition ? { transition: node.transition } : {}),
    ...(node.filter ? { filter: node.filter } : {}),
    ...(node.material ? { material: node.material } : {}),
    ...(node.geometryInsets ? { geometryInsets: node.geometryInsets } : {}),
    ...(node.debugName
      ? {
          inspect: {
            name: node.debugName,
            ...(node.debugModifiers?.length ? { modifiers: node.debugModifiers } : {}),
          },
        }
      : {}),
    // Carried for every node rather than only for the invisible `hit` boxes. The
    // dimmed layer behind a sheet is a *fill* with a hit target on it, and this
    // conversion used to drop it - so "tap outside to dismiss", which the coverage
    // matrix offers as the way to close a sheet, silently did nothing at all.
    ...(node.hitTarget
      ? {
          hitTarget: {
            handlerId: node.hitTarget.handlerId,
            role: node.hitTarget.role,
            step: node.hitTarget.step,
            secure: node.hitTarget.secure,
            multiline: node.hitTarget.multiline,
            inputInset: node.hitTarget.inputInset,
            submitHandlerId: node.hitTarget.submitHandlerId,
            contextMenuHandlerId: node.hitTarget.contextMenuHandlerId,
            inputType: node.hitTarget.inputType,
            inputMode: node.hitTarget.inputMode,
            enterKeyHint: node.hitTarget.enterKeyHint,
            autocapitalization: node.hitTarget.autocapitalization,
            autocorrection: node.hitTarget.autocorrection,
            thumbDiameter: node.hitTarget.thumbDiameter,
            cornerRadius: node.hitTarget.cornerRadius,
            placeholderColor: node.hitTarget.placeholderColor,
            enabled: node.hitTarget.enabled,
            ...(node.hitTarget.value !== undefined ? { value: node.hitTarget.value } : {}),
            ...(node.hitTarget.placeholder !== undefined
              ? { placeholder: node.hitTarget.placeholder }
              : {}),
            ...(node.hitTarget.min !== undefined ? { min: node.hitTarget.min } : {}),
            ...(node.hitTarget.max !== undefined ? { max: node.hitTarget.max } : {}),
            ...(node.hitTarget.textAlign ? { textAlign: node.hitTarget.textAlign } : {}),
            ...(node.hitTarget.font ? { font: node.hitTarget.font } : {}),
            ...(node.hitTarget.color ? { color: node.hitTarget.color } : {}),
          },
          a11y: { role: a11yRole(node.hitTarget.role), label: node.hitTarget.label, ...node.a11y },
        }
      : {}),
  }

  switch (node.paint.kind) {
    case 'text': {
      const paint = node.paint
      let top = 0
      const lines: TextLine[] = paint.lines.map((line) => {
        const y = top
        top += line.height + (paint.lineSpacing ?? 0)
        return ({
        text: line.text,
        origin: { x: 0, y },
        width: line.width,
        baseline: line.baseline,
        fontBaseline: line.fontBaseline,
        height: line.height,
        ...(line.slices ? { slices: line.slices } : {}),
      })})

      return {
        ...base,
        kind: 'text',
        text: {
          runs: paint.runs.map((run) => ({
            text: run.text,
            font: run.font,
            color: run.color,
            ...(run.foregroundFill ? { foregroundFill: run.foregroundFill } : {}),
            ...(run.strikethroughColor !== undefined ? { strikethroughColor: run.strikethroughColor } : {}),
            ...(run.underlineColor !== undefined ? { underlineColor: run.underlineColor } : {}),
            ...(run.underline ? { underline: true } : {}),
            ...(run.strikethrough ? { strikethrough: true } : {}),
            ...(run.tracking ? { tracking: run.tracking } : {}),
            ...(run.baselineOffset ? { baselineOffset: run.baselineOffset } : {}),
            ...(run.tabularNumbers ? { tabularNumbers: true } : {}),
          })),
          alignment: paint.align ?? 'leading',
          lines,
          ...(paint.lineSpacing ? { lineSpacing: paint.lineSpacing } : {}),
        },
        a11y: { role: 'text', label: paint.text },
      }
    }

    case 'slider':
      return { ...base, kind: 'slider', slider: node.paint.style }

    case 'image': {
      const paint = node.paint
      return {
        ...base,
        kind: 'image',
        image: {
          glyph: paint.glyph,
          bitmap: paint.bitmap,
          font: paint.font,
          color: paint.color,
          ...(paint.foregroundFill ? { foregroundFill: paint.foregroundFill } : {}),
          approximated: paint.approximated,
          resizable: paint.resizable,
          symbolScale: paint.symbolScale,
          ...(paint.symbol ? { symbol: paint.symbol } : {}),
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
          contentInsets: node.paint.contentInsets,
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
          cornerStyle: node.paint.cornerStyle,
          ...(node.paint.fill ? { fill: node.paint.fill } : {}),
          ...(node.paint.stroke ? { stroke: node.paint.stroke } : {}),
          ...(node.paint.trim ? { trim: node.paint.trim } : {}),
          ...(node.cornerRadius > 0 ? { cornerRadius: node.cornerRadius } : {}),
        },
      }

    case 'path':
      return {
        ...base,
        kind: 'path',
        path: {
          d: node.paint.d,
          fillRule: node.paint.fillRule,
          ...(node.paint.fill ? { fill: node.paint.fill } : {}),
          ...(node.paint.stroke ? { stroke: node.paint.stroke } : {}),
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
        ...(!node.hitTarget && node.a11y ? { a11y: node.a11y } : {}),
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
