import type { Fill, Rect, ResolvedFont, RGBA, ShapeKind, Size, SourceSpan } from '@studio/shared'
import {
  childEnvironment,
  type Alignment,
  type AnimationHint,
  type GridElement,
  type GridTrack,
  type HitRole,
  type LayoutElement,
  type LayoutEnvironment,
  type LayoutModifier,
  type ModifiedElement,
  type ScrollElement,
  type StackElement,
} from './elements'
import { FontMetricsTable, measureText, type TextLineBox } from './metrics'
import type { ProposedDimension, ProposedSize } from './proposal'

export type PaintSpec =
  | {
      readonly kind: 'text'
      readonly text: string
      readonly lines: readonly TextLineBox[]
      readonly font: ResolvedFont
      readonly color: RGBA
    }
  | { readonly kind: 'fill'; readonly fill: Fill }
  | { readonly kind: 'shape'; readonly shape: ShapeKind; readonly fill: Fill }
  | {
      readonly kind: 'image'
      readonly glyph: string
      readonly font: ResolvedFont
      readonly color: RGBA
      readonly approximated: boolean
    }
  | {
      readonly kind: 'scroll'
      readonly axis: 'vertical' | 'horizontal'
      readonly content: Size
      readonly showsIndicators: boolean
    }
  | { readonly kind: 'placeholder'; readonly feature: string; readonly reason: string }
  | { readonly kind: 'hit' }

export interface PlacedNode {
  readonly id: string
  readonly frame: Rect
  readonly z: number
  readonly opacity: number
  readonly cornerRadius: number
  readonly paint: PaintSpec
  readonly origin?: SourceSpan
  readonly hitTarget?: {
    readonly handlerId: string
    readonly label: string
    readonly role: HitRole
    readonly enabled: boolean
    readonly value?: string
    readonly placeholder?: string
    readonly min?: number
    readonly max?: number
    /** Resolved from the environment, so a DOM control matches the text around it. */
    readonly font?: ResolvedFont
    readonly color?: RGBA
  }
  readonly debugName?: string
  readonly debugModifiers?: readonly string[]
  /**
   * The scroll container this node lives inside, if any.
   *
   * The single exception to the flat, absolutely-positioned output: nodes inside a
   * scroll view are positioned in *its* coordinate space, so the browser can scroll
   * them with native physics instead of us reimplementing momentum in the worker.
   */
  readonly parent?: string
  readonly clip?: boolean
  readonly border?: { readonly color: RGBA; readonly width: number; readonly cornerRadius: number }
  readonly shadow?: {
    readonly color: RGBA
    readonly radius: number
    readonly x: number
    readonly y: number
  }
  readonly transform?: { readonly scaleX: number; readonly scaleY: number; readonly rotate: number }
  readonly animation?: AnimationHint
}

/**
 * A finite stand-in for an unbounded proposal.
 *
 * Using `Infinity` directly would make `remaining / childrenLeft` produce `NaN` the
 * moment a greedy child consumed it, and a single `NaN` silently poisons every frame
 * downstream. Large-but-finite keeps the arithmetic total.
 */
const UNBOUNDED = 100_000

/** Default root alignment: content sits where the caller put the bounds. */
const TOP_LEADING: Alignment = { horizontal: 'leading', vertical: 'top' }

/**
 * The SwiftUI layout engine.
 *
 * Two passes, exactly as SwiftUI describes them:
 *
 *   1. **Measure.** A parent *proposes* a size; each child *responds* with the size
 *      it wants. A proposal is not an instruction — `Spacer` responds greedily,
 *      `Text` responds with its ideal size unless squeezed, and
 *      `.frame(maxWidth: .infinity)` changes the proposal passed down rather than the
 *      response passed up.
 *   2. **Place.** The parent assigns each child an absolute rect.
 *
 * This is why the engine exists at all instead of mapping onto flexbox. CSS resolves
 * a different algorithm, and it diverges on exactly the cases people hit first — see
 * decision D2 in docs/02-ARCHITECTURE.md.
 */
export class LayoutEngine {
  /** Memoised `(element, proposal, font) -> size`, cleared per layout run. */
  private cache = new Map<LayoutElement, Map<string, Size>>()

  constructor(private readonly metrics: FontMetricsTable = new FontMetricsTable()) {}

  /**
   * Lays out `root` within `bounds`.
   *
   * `alignment` positions content that does not fill the bounds. It is a parameter
   * rather than a fixed rule because it is a *window* policy, not a layout one:
   * SwiftUI centres a root view in its window, but a nested layout pass (a test, or
   * the inspector measuring a subtree) wants the origin it asked for.
   */
  layout(
    root: LayoutElement,
    bounds: Rect,
    env: LayoutEnvironment,
    alignment: Alignment = TOP_LEADING,
  ): PlacedNode[] {
    this.cache = new Map()

    const nodes: PlacedNode[] = []
    const size = this.measure(root, { width: bounds.width, height: bounds.height }, env)

    this.place(root, alignedRect(bounds, size, alignment), env, nodes, 0, null)
    return nodes
  }

  /** Exposed for tests and the inspector: what size would this element report? */
  measureElement(element: LayoutElement, proposal: ProposedSize, env: LayoutEnvironment): Size {
    this.cache = new Map()
    return this.measure(element, proposal, env)
  }

  // ----------------------------------------------------------------- measure

  private measure(element: LayoutElement, proposal: ProposedSize, env: LayoutEnvironment): Size {
    const key = `${describeDimension(proposal.width)}x${describeDimension(proposal.height)}|${env.font.size}|${env.font.weight}`
    let perElement = this.cache.get(element)
    if (!perElement) {
      perElement = new Map()
      this.cache.set(element, perElement)
    }
    const hit = perElement.get(key)
    if (hit) return hit

    const size = this.computeSize(element, proposal, env)
    perElement.set(key, size)
    return size
  }

  private computeSize(element: LayoutElement, proposal: ProposedSize, env: LayoutEnvironment): Size {
    switch (element.kind) {
      case 'empty':
        return { width: 0, height: 0 }

      case 'text': {
        const maxWidth = resolve(proposal.width, Number.POSITIVE_INFINITY, UNBOUNDED)
        const measured = measureText(element.text, env.font, maxWidth, this.metrics)
        return { width: measured.width, height: measured.height }
      }

      case 'spacer': {
        // Greedy along its stack's axis, zero across it.
        const along = element.axis === 'vertical' ? proposal.height : proposal.width
        const length = Math.max(element.minLength, resolve(along, element.minLength, UNBOUNDED))
        return element.axis === 'vertical'
          ? { width: 0, height: length }
          : { width: length, height: 0 }
      }

      // Shapes and colours fill whatever they are offered.
      case 'shape':
      case 'fill':
        return {
          width: resolve(proposal.width, 10, UNBOUNDED),
          height: resolve(proposal.height, 10, UNBOUNDED),
        }

      case 'image': {
        // A symbol is a glyph: its box comes from the font, exactly as in SwiftUI,
        // until `.resizable()` makes it fill what it is offered instead.
        if (element.resizable) {
          return {
            width: resolve(proposal.width, 24, UNBOUNDED),
            height: resolve(proposal.height, 24, UNBOUNDED),
          }
        }
        return { width: env.font.size * 1.18, height: env.font.lineHeight }
      }

      case 'scroll': {
        const vertical = element.axis === 'vertical'
        const content = this.measure(element.content, scrollProposal(element, proposal), env)
        // A scroll view takes all the space offered along its axis and hugs its
        // content across it — the opposite of what its content just reported.
        const along = vertical ? proposal.height : proposal.width
        const extent = along === null ? (vertical ? content.height : content.width) : resolve(along, 0, UNBOUNDED)
        const cross = vertical
          ? resolve(proposal.width, content.width, content.width)
          : resolve(proposal.height, content.height, content.height)
        return vertical ? { width: cross, height: extent } : { width: extent, height: cross }
      }

      case 'grid':
        return this.measureGrid(element, proposal, env).size

      case 'placeholder':
        return { width: resolve(proposal.width, 200, UNBOUNDED), height: 64 }

      case 'stack':
        return this.measureStack(element, proposal, env)

      case 'zstack': {
        let width = 0
        let height = 0
        for (const child of element.children) {
          const size = this.measure(child, proposal, env)
          width = Math.max(width, size.width)
          height = Math.max(height, size.height)
        }
        return { width, height }
      }

      case 'modified':
        return this.measureModified(element, proposal, env)
    }
  }

  /**
   * The stack algorithm, and the reason `Spacer` works.
   *
   * Children are measured in order of *flexibility*, least flexible first, each
   * offered an equal share of what remains. A `Text` claims its ideal height while
   * the whole stack height is still on the table; a `Spacer`, measured last, is
   * offered exactly what nothing else wanted. Measuring in source order instead would
   * let the first `Spacer` swallow everything.
   */
  private measureStack(element: StackElement, proposal: ProposedSize, env: LayoutEnvironment): Size {
    const children = element.children
    if (children.length === 0) return { width: 0, height: 0 }

    const vertical = element.axis === 'vertical'
    const spacingTotal = element.spacing * (children.length - 1)
    const cross = vertical ? proposal.width : proposal.height
    const main = vertical ? proposal.height : proposal.width

    const sizes = new Array<Size>(children.length)

    if (main === null) {
      // Ideal sizing: nothing to divide, so every child gets an ideal proposal.
      for (let i = 0; i < children.length; i++) {
        sizes[i] = this.measure(children[i]!, axisProposal(vertical, cross, null), env)
      }
    } else {
      let remaining = resolve(main, 0, UNBOUNDED) - spacingTotal
      let left = children.length

      for (const index of this.flexibilityOrder(children, vertical, cross, env)) {
        const share = left > 0 ? Math.max(0, remaining / left) : 0
        const size = this.measure(children[index]!, axisProposal(vertical, cross, share), env)
        sizes[index] = size
        remaining -= vertical ? size.height : size.width
        left--
      }
    }

    let crossExtent = 0
    let mainExtent = spacingTotal
    for (const size of sizes) {
      crossExtent = Math.max(crossExtent, vertical ? size.width : size.height)
      mainExtent += vertical ? size.height : size.width
    }

    return vertical
      ? { width: crossExtent, height: mainExtent }
      : { width: mainExtent, height: crossExtent }
  }

  /**
   * Orders children least-flexible first.
   *
   * Flexibility is the span between what a child reports when offered nothing and
   * when offered everything: zero for `Text`, enormous for `Spacer`.
   */
  private flexibilityOrder(
    children: readonly LayoutElement[],
    vertical: boolean,
    cross: ProposedDimension,
    env: LayoutEnvironment,
  ): number[] {
    const ranked = children.map((child, index) => {
      const tight = this.measure(child, axisProposal(vertical, cross, 0), env)
      const loose = this.measure(child, axisProposal(vertical, cross, UNBOUNDED), env)
      const flexibility = vertical ? loose.height - tight.height : loose.width - tight.width
      return { index, flexibility }
    })

    // Stable within equal flexibility, so source order still decides ties.
    return ranked
      .sort((a, b) => a.flexibility - b.flexibility || a.index - b.index)
      .map((entry) => entry.index)
  }

  private measureModified(
    element: ModifiedElement,
    proposal: ProposedSize,
    env: LayoutEnvironment,
  ): Size {
    const modifier = element.modifier
    const inner = childEnvironment(env, modifier)

    switch (modifier.kind) {
      case 'padding': {
        const { top, leading, bottom, trailing } = modifier.insets
        const size = this.measure(
          element.child,
          {
            width: shrink(proposal.width, leading + trailing),
            height: shrink(proposal.height, top + bottom),
          },
          inner,
        )
        return {
          width: size.width + leading + trailing,
          height: size.height + top + bottom,
        }
      }

      case 'frame': {
        const childProposal: ProposedSize = {
          width: modifier.width ?? clampProposal(proposal.width, modifier.minWidth, modifier.maxWidth),
          height:
            modifier.height ?? clampProposal(proposal.height, modifier.minHeight, modifier.maxHeight),
        }
        const size = this.measure(element.child, childProposal, inner)

        return {
          width:
            modifier.width ??
            resolveFrameAxis(size.width, modifier.minWidth, modifier.maxWidth, proposal.width),
          height:
            modifier.height ??
            resolveFrameAxis(size.height, modifier.minHeight, modifier.maxHeight, proposal.height),
        }
      }

      // A background never changes the size of what it sits behind — and neither
      // does an overlay, which is the whole reason both are modifiers rather than
      // stacks.
      case 'background':
      case 'overlay':
        return this.measure(element.child, proposal, inner)

      case 'fixedSize': {
        // Proposing nil asks for the ideal size, which is exactly what `.fixedSize()`
        // means: stop compressing me, I would rather overflow than wrap.
        const ideal: ProposedSize = {
          width: modifier.horizontal ? null : proposal.width,
          height: modifier.vertical ? null : proposal.height,
        }
        return this.measure(element.child, ideal, inner)
      }

      case 'scale': {
        const size = this.measure(element.child, proposal, inner)
        // `.scaleEffect` is a paint-time transform: layout still reserves the
        // untransformed size, which is why a scaled view overlaps its neighbours.
        return size
      }

      default:
        return this.measure(element.child, proposal, inner)
    }
  }

  /**
   * Resolves a grid's tracks and the position of every child within them.
   *
   * Tracks are sized against the cross-axis extent first, then children flow into
   * them in order. Adaptive tracks decide their own count from the available width,
   * which is the one grid behaviour that cannot be expressed as nested stacks and
   * therefore the reason this is a layout element at all.
   */
  private measureGrid(
    element: GridElement,
    proposal: ProposedSize,
    env: LayoutEnvironment,
  ): { size: Size; cells: Rect[] } {
    const vertical = element.axis === 'vertical'
    const crossAvailable = resolve(vertical ? proposal.width : proposal.height, 320, 320)

    const lanes = resolveTracks(element.tracks, crossAvailable, element.trackSpacing)
    const columns = Math.max(1, lanes.length)

    const laneOffsets: number[] = []
    let running = 0
    for (const lane of lanes) {
      laneOffsets.push(running)
      running += lane + element.trackSpacing
    }

    // Measure every child first, then size each row to its tallest member — a grid
    // row is uniform, so a cell cannot be laid out until its siblings are known.
    const sizes = element.children.map((child, index) => {
      const laneSize = lanes[index % columns] ?? crossAvailable
      return this.measure(
        child,
        vertical ? { width: laneSize, height: null } : { width: null, height: laneSize },
        env,
      )
    })

    const rows = Math.ceil(sizes.length / columns)
    const rowExtents: number[] = []
    for (let row = 0; row < rows; row++) {
      let extent = 0
      for (let column = 0; column < columns; column++) {
        const size = sizes[row * columns + column]
        if (size) extent = Math.max(extent, vertical ? size.height : size.width)
      }
      rowExtents.push(extent)
    }

    const rowOffsets: number[] = []
    let mainRunning = 0
    for (const extent of rowExtents) {
      rowOffsets.push(mainRunning)
      mainRunning += extent + element.spacing
    }
    const mainExtent = Math.max(0, mainRunning - element.spacing)

    const cells: Rect[] = sizes.map((_, index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const lane = lanes[column] ?? crossAvailable
      const extent = rowExtents[row] ?? 0
      return vertical
        ? { x: laneOffsets[column] ?? 0, y: rowOffsets[row] ?? 0, width: lane, height: extent }
        : { x: rowOffsets[row] ?? 0, y: laneOffsets[column] ?? 0, width: extent, height: lane }
    })

    const crossExtent = lanes.reduce((a, b) => a + b, 0) + element.trackSpacing * (columns - 1)
    return {
      size: vertical
        ? { width: Math.max(0, crossExtent), height: mainExtent }
        : { width: mainExtent, height: Math.max(0, crossExtent) },
      cells,
    }
  }

  // ------------------------------------------------------------------- place

  private place(
    element: LayoutElement,
    bounds: Rect,
    env: LayoutEnvironment,
    out: PlacedNode[],
    z: number,
    parent: string | null,
  ): number {
    switch (element.kind) {
      // A spacer occupies space but paints nothing; an empty view does neither.
      case 'empty':
      case 'spacer':
        return z

      case 'text': {
        const measured = measureText(element.text, env.font, bounds.width, this.metrics)
        out.push({
          id: element.id,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: 0,
          paint: {
            kind: 'text',
            text: element.text,
            lines: measured.lines,
            font: env.font,
            color: env.foregroundColor,
          },
          ...debugInfo(element),
          ...decorations(env, parent),
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return z + 1
      }

      case 'image': {
        out.push({
          id: element.id,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: 0,
          paint: {
            kind: 'image',
            glyph: element.glyph,
            font: env.font,
            color: env.foregroundColor,
            approximated: element.approximated,
          },
          ...debugInfo(element),
          ...decorations(env, parent),
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return z + 1
      }

      case 'scroll':
        return this.placeScroll(element, bounds, env, out, z, parent)

      case 'grid':
        return this.placeGrid(element, bounds, env, out, z, parent)

      case 'shape':
        out.push({
          id: element.id,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: element.cornerRadius ?? env.cornerRadius,
          paint: {
            kind: 'shape',
            shape: element.shape,
            fill: { kind: 'solid', color: env.foregroundColor },
          },
          ...debugInfo(element),
          ...decorations(env, parent),
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return z + 1

      case 'fill':
        out.push({
          id: element.id,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: env.cornerRadius,
          paint: { kind: 'fill', fill: element.fill },
          ...debugInfo(element),
          ...decorations(env, parent),
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return z + 1

      case 'placeholder':
        out.push({
          id: element.id,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: 8,
          paint: { kind: 'placeholder', feature: element.feature, reason: element.reason },
          ...debugInfo(element),
          ...decorations(env, parent),
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return z + 1

      case 'stack':
        return this.placeStack(element, bounds, env, out, z, parent)

      case 'zstack': {
        let next = z
        for (const child of element.children) {
          const size = this.measure(child, { width: bounds.width, height: bounds.height }, env)
          next = this.place(child, alignedRect(bounds, size, element.alignment), env, out, next, parent)
        }
        return next
      }

      case 'modified':
        return this.placeModified(element, bounds, env, out, z, parent)
    }
  }

  /**
   * Places a scroll view: a clipping container plus its content, in its coordinates.
   *
   * The content is laid out at its full natural extent and positioned from the
   * container's origin rather than the screen's, so the renderer can hand the whole
   * thing to the browser and get native scrolling — momentum, rubber-banding,
   * scrollbar — instead of us approximating all of it in the worker.
   */
  private placeScroll(
    element: ScrollElement,
    bounds: Rect,
    env: LayoutEnvironment,
    out: PlacedNode[],
    z: number,
    parent: string | null,
  ): number {
    const vertical = element.axis === 'vertical'
    const proposal: ProposedSize = { width: bounds.width, height: bounds.height }
    const content = this.measure(element.content, scrollProposal(element, proposal), env)

    const contentSize: Size = vertical
      ? { width: bounds.width, height: Math.max(content.height, bounds.height) }
      : { width: Math.max(content.width, bounds.width), height: bounds.height }

    out.push({
      id: element.id,
      frame: bounds,
      z,
      opacity: env.opacity,
      cornerRadius: env.cornerRadius,
      clip: true,
      paint: {
        kind: 'scroll',
        axis: element.axis,
        content: contentSize,
        showsIndicators: element.showsIndicators,
      },
      ...debugInfo(element),
      ...decorations(env, parent),
      ...(element.origin ? { origin: element.origin } : {}),
    })

    return this.place(
      element.content,
      { x: 0, y: 0, width: contentSize.width, height: contentSize.height },
      env,
      out,
      z + 1,
      element.id,
    )
  }

  private placeGrid(
    element: GridElement,
    bounds: Rect,
    env: LayoutEnvironment,
    out: PlacedNode[],
    z: number,
    parent: string | null,
  ): number {
    const { cells } = this.measureGrid(element, { width: bounds.width, height: bounds.height }, env)

    let next = z
    element.children.forEach((child, index) => {
      const cell = cells[index]
      if (!cell) return

      const size = this.measure(child, { width: cell.width, height: cell.height }, env)
      const rect = alignedRect(
        { x: bounds.x + cell.x, y: bounds.y + cell.y, width: cell.width, height: cell.height },
        size,
        element.alignment,
      )
      next = this.place(child, rect, env, out, next, parent)
    })
    return next
  }

  private placeStack(
    element: StackElement,
    bounds: Rect,
    env: LayoutEnvironment,
    out: PlacedNode[],
    z: number,
    parent: string | null,
  ): number {
    const vertical = element.axis === 'vertical'
    const proposal: ProposedSize = { width: bounds.width, height: bounds.height }

    // Re-run the measure pass so children are placed at exactly the sizes they
    // reported; the cache makes this free.
    const sizes = this.stackChildSizes(element, proposal, env)

    let offset = 0
    let next = z

    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i]!
      const size = sizes[i]!

      const crossAvailable = vertical ? bounds.width : bounds.height
      const crossSize = vertical ? size.width : size.height
      const crossOffset = alignOffset(
        vertical ? element.alignment.horizontal : element.alignment.vertical,
        crossAvailable,
        crossSize,
      )

      const childBounds: Rect = vertical
        ? { x: bounds.x + crossOffset, y: bounds.y + offset, width: size.width, height: size.height }
        : { x: bounds.x + offset, y: bounds.y + crossOffset, width: size.width, height: size.height }

      next = this.place(child, childBounds, env, out, next, parent)
      offset += (vertical ? size.height : size.width) + element.spacing
    }

    return next
  }

  /** The per-child sizes a stack settled on. Shared by measure and place. */
  private stackChildSizes(
    element: StackElement,
    proposal: ProposedSize,
    env: LayoutEnvironment,
  ): Size[] {
    const vertical = element.axis === 'vertical'
    const cross = vertical ? proposal.width : proposal.height
    const main = vertical ? proposal.height : proposal.width
    const sizes = new Array<Size>(element.children.length)

    if (main === null) {
      for (let i = 0; i < element.children.length; i++) {
        sizes[i] = this.measure(element.children[i]!, axisProposal(vertical, cross, null), env)
      }
      return sizes
    }

    let remaining = resolve(main, 0, UNBOUNDED) - element.spacing * (element.children.length - 1)
    let left = element.children.length

    for (const index of this.flexibilityOrder(element.children, vertical, cross, env)) {
      const share = left > 0 ? Math.max(0, remaining / left) : 0
      const size = this.measure(element.children[index]!, axisProposal(vertical, cross, share), env)
      sizes[index] = size
      remaining -= vertical ? size.height : size.width
      left--
    }

    return sizes
  }

  private placeModified(
    element: ModifiedElement,
    bounds: Rect,
    env: LayoutEnvironment,
    out: PlacedNode[],
    z: number,
    parent: string | null,
  ): number {
    const modifier = element.modifier
    const inner = childEnvironment(env, modifier)

    switch (modifier.kind) {
      case 'padding': {
        const { top, leading, bottom, trailing } = modifier.insets
        return this.place(
          element.child,
          {
            x: bounds.x + leading,
            y: bounds.y + top,
            width: Math.max(0, bounds.width - leading - trailing),
            height: Math.max(0, bounds.height - top - bottom),
          },
          inner,
          out,
          z,
          parent,
        )
      }

      case 'frame': {
        const childProposal: ProposedSize = {
          width: modifier.width ?? clampProposal(bounds.width, modifier.minWidth, modifier.maxWidth),
          height:
            modifier.height ?? clampProposal(bounds.height, modifier.minHeight, modifier.maxHeight),
        }
        const size = this.measure(element.child, childProposal, inner)
        return this.place(
          element.child,
          alignedRect(bounds, size, modifier.alignment),
          inner,
          out,
          z,
          parent,
        )
      }

      case 'background': {
        // The background paints *behind*, so it is emitted first and therefore lower
        // in z-order. It occupies exactly the frame of what it backs, which is what
        // makes `.padding().background()` cover the padding and
        // `.background().padding()` not.
        const next = this.place(modifier.content, bounds, inner, out, z, parent)
        return this.place(element.child, bounds, inner, out, next, parent)
      }

      case 'overlay': {
        // The mirror image of a background: the same frame, painted afterwards.
        const next = this.place(element.child, bounds, inner, out, z, parent)
        const size = this.measure(
          modifier.content,
          { width: bounds.width, height: bounds.height },
          inner,
        )
        return this.place(
          modifier.content,
          alignedRect(bounds, size, modifier.alignment),
          inner,
          out,
          next,
          parent,
        )
      }

      case 'offset':
        // Paint-time only: layout still reserves the original position, which is what
        // makes an offset view overlap its neighbours instead of pushing them aside.
        return this.place(
          element.child,
          { ...bounds, x: bounds.x + modifier.x, y: bounds.y + modifier.y },
          inner,
          out,
          z,
          parent,
        )

      case 'fixedSize': {
        const size = this.measure(
          element.child,
          {
            width: modifier.horizontal ? null : bounds.width,
            height: modifier.vertical ? null : bounds.height,
          },
          inner,
        )
        return this.place(
          element.child,
          { x: bounds.x, y: bounds.y, width: size.width, height: size.height },
          inner,
          out,
          z,
          parent,
        )
      }

      case 'border': {
        const next = this.place(element.child, bounds, inner, out, z, parent)
        out.push({
          id: `${element.id}-border`,
          frame: bounds,
          z: next,
          opacity: env.opacity,
          cornerRadius: modifier.cornerRadius ?? env.cornerRadius,
          paint: { kind: 'hit' },
          border: {
            color: modifier.color,
            width: modifier.width,
            cornerRadius: modifier.cornerRadius ?? env.cornerRadius,
          },
          ...(parent ? { parent } : {}),
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return next + 1
      }

      case 'shadow': {
        // Emitted before the child so it sits underneath. A transparent box still
        // casts a CSS box-shadow, which is what lets this be one flat node instead of
        // a duplicate of the whole subtree beneath it.
        out.push({
          id: `${element.id}-shadow`,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: env.cornerRadius,
          paint: { kind: 'hit' },
          shadow: modifier,
          ...(parent ? { parent } : {}),
        })
        return this.place(element.child, bounds, inner, out, z + 1, parent)
      }

      case 'clip': {
        // Real clipping needs a container, for the same reason scrolling does.
        const clipId = `${element.id}-clip`
        out.push({
          id: clipId,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius:
            modifier.shape === 'circle' || modifier.shape === 'capsule'
              ? Math.min(bounds.width, bounds.height) / 2
              : modifier.cornerRadius,
          clip: true,
          paint: { kind: 'hit' },
          ...(parent ? { parent } : {}),
        })
        return this.place(
          element.child,
          { x: 0, y: 0, width: bounds.width, height: bounds.height },
          inner,
          out,
          z + 1,
          clipId,
        )
      }

      case 'scale':
      case 'rotate': {
        const transformId = `${element.id}-xform`
        out.push({
          id: transformId,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: 0,
          paint: { kind: 'hit' },
          transform:
            modifier.kind === 'scale'
              ? { scaleX: modifier.x, scaleY: modifier.y, rotate: 0 }
              : { scaleX: 1, scaleY: 1, rotate: modifier.degrees },
          ...(parent ? { parent } : {}),
          ...(env.animation ? { animation: env.animation } : {}),
        })
        return this.place(
          element.child,
          { x: 0, y: 0, width: bounds.width, height: bounds.height },
          inner,
          out,
          z + 1,
          transformId,
        )
      }

      case 'hitTarget': {
        const next = this.place(element.child, bounds, inner, out, z, parent)
        out.push({
          id: `${element.id}-hit`,
          frame: bounds,
          z: next,
          opacity: 1,
          cornerRadius: 0,
          paint: { kind: 'hit' },
          hitTarget: {
            handlerId: modifier.handlerId,
            label: modifier.label,
            role: modifier.role,
            enabled: modifier.enabled,
            font: inner.font,
            color: inner.foregroundColor,
            ...(modifier.value !== undefined ? { value: modifier.value } : {}),
            ...(modifier.placeholder !== undefined ? { placeholder: modifier.placeholder } : {}),
            ...(modifier.min !== undefined ? { min: modifier.min } : {}),
            ...(modifier.max !== undefined ? { max: modifier.max } : {}),
          },
          ...(parent ? { parent } : {}),
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return next + 1
      }

      default:
        return this.place(element.child, bounds, inner, out, z, parent)
    }
  }
}

// -------------------------------------------------------------------- helpers

/** Inspector metadata, omitted entirely when an element carries none. */
function debugInfo(element: LayoutElement): {
  debugName?: string
  debugModifiers?: readonly string[]
} {
  return {
    ...(element.debugName ? { debugName: element.debugName } : {}),
    ...(element.debugModifiers?.length ? { debugModifiers: element.debugModifiers } : {}),
  }
}

/** Fields every painted node inherits from where it sits, rather than from itself. */
function decorations(
  env: LayoutEnvironment,
  parent: string | null,
): { parent?: string; animation?: AnimationHint } {
  return {
    ...(parent ? { parent } : {}),
    ...(env.animation ? { animation: env.animation } : {}),
  }
}

/**
 * What a scroll view proposes to its content.
 *
 * Unbounded along the scroll axis — that is what scrolling *is*, and proposing the
 * visible height instead is the mistake that makes a long list silently truncate
 * rather than scroll.
 */
function scrollProposal(element: ScrollElement, proposal: ProposedSize): ProposedSize {
  return element.axis === 'vertical'
    ? { width: proposal.width, height: null }
    : { width: null, height: proposal.height }
}

/**
 * Resolves grid tracks against the space available across the axis.
 *
 * `.adaptive` is the interesting one: it fits as many columns of at least its minimum
 * as will go, then shares the remainder between them — so the same grid shows two
 * columns on a phone and four on a tablet without the code changing.
 */
function resolveTracks(
  tracks: readonly GridTrack[],
  available: number,
  spacing: number,
): number[] {
  if (tracks.length === 0) return [available]

  const adaptive = tracks.find((t) => t.kind === 'adaptive')
  if (adaptive && tracks.length === 1) {
    const minimum = Math.max(1, adaptive.size ?? 80)
    const count = Math.max(1, Math.floor((available + spacing) / (minimum + spacing)))
    const each = (available - spacing * (count - 1)) / count
    return new Array(count).fill(Math.max(0, each))
  }

  const fixed = tracks.filter((t) => t.kind === 'fixed')
  const fixedTotal = fixed.reduce((sum, t) => sum + (t.size ?? 0), 0)
  const flexibleCount = tracks.length - fixed.length
  const remaining = available - fixedTotal - spacing * (tracks.length - 1)
  const share = flexibleCount > 0 ? Math.max(0, remaining / flexibleCount) : 0

  return tracks.map((track) => (track.kind === 'fixed' ? (track.size ?? 0) : share))
}

function describeDimension(d: ProposedDimension): string {
  return d === null ? 'i' : d === 'infinity' ? 'inf' : d.toFixed(2)
}

/** Turns a proposal into a number: `ideal` when null, `unbounded` when infinite. */
function resolve(d: ProposedDimension, ideal: number, unbounded: number): number {
  if (d === null) return ideal
  if (d === 'infinity') return unbounded
  return d
}

function shrink(d: ProposedDimension, amount: number): ProposedDimension {
  if (d === null || d === 'infinity') return d
  return Math.max(0, d - amount)
}

function axisProposal(
  vertical: boolean,
  cross: ProposedDimension,
  main: ProposedDimension,
): ProposedSize {
  return vertical ? { width: cross, height: main } : { width: main, height: cross }
}

/** What a `.frame` offers its child. */
function clampProposal(
  d: ProposedDimension,
  min: number | undefined,
  max: number | undefined,
): ProposedDimension {
  if (d === null) return max !== undefined && Number.isFinite(max) ? max : null
  let value = resolve(d, 0, UNBOUNDED)
  if (max !== undefined) value = Math.min(value, max)
  if (min !== undefined) value = Math.max(value, min)
  return value
}

/**
 * The size a `.frame` itself reports.
 *
 * With `maxWidth: .infinity` this becomes the full proposal, which is what makes
 * `.frame(maxWidth: .infinity)` fill its container rather than hug its content.
 */
function resolveFrameAxis(
  childSize: number,
  min: number | undefined,
  max: number | undefined,
  proposal: ProposedDimension,
): number {
  let size = childSize
  if (max !== undefined) size = Math.min(max, resolve(proposal, childSize, UNBOUNDED))
  if (min !== undefined) size = Math.max(min, size)
  return size
}

function alignOffset(
  alignment: 'leading' | 'center' | 'trailing' | 'top' | 'bottom',
  available: number,
  size: number,
): number {
  if (alignment === 'center') return (available - size) / 2
  if (alignment === 'trailing' || alignment === 'bottom') return available - size
  return 0
}

function alignedRect(bounds: Rect, size: Size, alignment: Alignment): Rect {
  return {
    x: bounds.x + alignOffset(alignment.horizontal, bounds.width, size.width),
    y: bounds.y + alignOffset(alignment.vertical, bounds.height, size.height),
    width: size.width,
    height: size.height,
  }
}

export type { LayoutModifier }
