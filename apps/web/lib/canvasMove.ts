import type { RenderNode } from '@studio/shared'

/** Which way a container lays its children out, which is the way a drop between them is measured. */
export type MoveAxis = 'vertical' | 'horizontal' | 'depth'

/** What a drag on the canvas carries: one view, and where it is drawn. */
export interface MoveSource {
  /** The view's source layer: the same id its slot has in a container's `children`. */
  readonly id: string
  readonly label: string
  readonly renderIds: readonly string[]
}

/** A container a dragged view can be dropped into, with its children in the order the file has them. */
export interface MoveContainer {
  readonly id: string
  readonly label: string
  readonly axis: MoveAxis
  readonly renderIds: readonly string[]
  readonly children: readonly { readonly id: string; readonly renderIds: readonly string[] }[]
}

/**
 * How the canvas moves views, supplied by the workspace, which knows the source.
 *
 * `targets` answers innermost first, so the drop goes to the closest container that
 * can take the view - the one the pointer is visibly inside.
 */
export interface CanvasMove {
  pick(node: RenderNode | 'selection', pageId?: string): MoveSource | null
  targets(source: MoveSource, over: RenderNode, pageId?: string): readonly MoveContainer[]
  /** Why nothing under the pointer can take the view, said while the drag is over it. */
  blocked(source: MoveSource, over: RenderNode | null, pageId?: string): string
  drop(source: MoveSource, container: MoveContainer, index: number): void
}

export interface Box { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null
  return boxes.reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }))
}

export const AXES: Readonly<Record<string, MoveAxis>> = {
  VStack: 'vertical', LazyVStack: 'vertical', List: 'vertical', Form: 'vertical', Section: 'vertical', Group: 'vertical', ScrollView: 'vertical',
  HStack: 'horizontal', LazyHStack: 'horizontal',
  ZStack: 'depth',
}

/**
 * Where a drop at `point` lands among a container's children, and the line that shows it.
 *
 * `children` are the container's other views, without the one being dragged, in the
 * order the file has them; the answer is how many of them the dropped view goes
 * after. The line sits in the gap between two children, or along the first or last
 * one's outer edge, and spans the container across its axis - the insertion bar a
 * design tool draws. A ZStack has no order to show on screen, so a drop there goes
 * on top and draws no line.
 */
export function dropSlot(axis: MoveAxis, container: Box, children: readonly Box[], point: { readonly x: number; readonly y: number }, thickness = 2): { index: number; line: Box | null } {
  if (axis === 'depth') return { index: children.length, line: null }
  const vertical = axis === 'vertical'
  const along = (box: Box) => vertical ? [box.top, box.bottom] as const : [box.left, box.right] as const
  const at = vertical ? point.y : point.x
  const index = children.filter(child => { const [start, end] = along(child); return (start + end) / 2 < at }).length
  const before = children[index - 1], after = children[index]
  const [cStart, cEnd] = along(container)
  const position = before && after ? (along(before)[1] + along(after)[0]) / 2
    : after ? along(after)[0]
    : before ? along(before)[1]
    : (cStart + cEnd) / 2
  const half = thickness / 2
  const line = vertical
    ? { left: container.left, right: container.right, top: position - half, bottom: position + half }
    : { left: position - half, right: position + half, top: container.top, bottom: container.bottom }
  return { index, line }
}
