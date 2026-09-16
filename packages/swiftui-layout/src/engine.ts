import type {
  FilterSpec,
  Fill,
  Rect,
  ResolvedFont,
  RGBA,
  ShapeKind,
  Size,
  SourceSpan,
} from '@studio/shared'
import {
  childEnvironment,
  type Alignment,
  type Axis,
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
  type TableElement,
  type TextAlign,
  type TextElement,
  type TextRunSpec,
  type TransitionHint,
} from './elements'
import {
  FontMetricsTable,
  measureRuns,
  type MeasuredRun,
  type TextLineBox,
} from './metrics'
import type { ProposedDimension, ProposedSize } from './proposal'

/** One attributed span of painted text, with every attribute already resolved. */
export interface PaintedRun {
  readonly text: string
  readonly font: ResolvedFont
  readonly color: RGBA
  readonly underline?: boolean
  readonly strikethrough?: boolean
  readonly tracking?: number
  readonly baselineOffset?: number
}

export type PaintSpec =
  | {
      readonly kind: 'text'
      readonly text: string
      readonly lines: readonly TextLineBox[]
      readonly font: ResolvedFont
      readonly color: RGBA
      readonly align?: TextAlign
      /**
       * The attributed spans, resolved against the environment.
       *
       * Always at least one, so the renderer has a single rule rather than a special
       * case for plain text. `lines` carries slices into this list wherever a line
       * crosses a run boundary.
       */
      readonly runs: readonly PaintedRun[]
      readonly lineSpacing?: number
    }
  | { readonly kind: 'fill'; readonly fill: Fill }
  | {
      readonly kind: 'shape'
      readonly shape: ShapeKind
      readonly fill?: Fill
      readonly stroke?: { readonly color: RGBA; readonly width: number }
    }
  | {
      readonly kind: 'path'
      readonly d: string
      readonly fill?: Fill
      readonly stroke?: { readonly color: RGBA; readonly width: number }
      readonly fillRule: 'nonzero' | 'evenodd'
    }
  | {
      readonly kind: 'image'
      readonly glyph: string
      readonly font: ResolvedFont
      readonly color: RGBA
      readonly approximated: boolean
      readonly resizable: boolean
      readonly symbol?: string
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
  readonly transform?: {
    readonly scaleX: number
    readonly scaleY: number
    readonly rotate: number
    readonly rotateX?: number
    readonly rotateY?: number
  }
  readonly animation?: AnimationHint
  readonly transition?: TransitionHint
  readonly filter?: FilterSpec
  readonly blendMode?: string
  readonly redacted?: boolean
  readonly material?: { readonly opacity: number; readonly blur: number; readonly light: boolean }
  readonly a11y?: {
    readonly label?: string
    readonly value?: string
    readonly hint?: string
    readonly hidden?: boolean
  }
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
 *      it wants. A proposal is not an instruction - `Spacer` responds greedily,
 *      `Text` responds with its ideal size unless squeezed, and
 *      `.frame(maxWidth: .infinity)` changes the proposal passed down rather than the
 *      response passed up.
 *   2. **Place.** The parent assigns each child an absolute rect.
 *
 * This is why the engine exists at all instead of mapping onto flexbox. CSS resolves
 * a different algorithm, and it diverges on exactly the cases people hit first - see
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
        const runs = paintedRuns(element, env)
        const measured = measureRuns(
          measuredRuns(runs),
          env.font,
          maxWidth,
          this.metrics,
          env.lineLimit,
          env.lineSpacing ?? 0,
        )
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

      // Shapes, colours and paths fill whatever they are offered. A path's own
      // coordinates are absolute within its frame - it does not scale to fit, which
      // is SwiftUI's behaviour too.
      case 'path':
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
        // content across it - the opposite of what its content just reported.
        const along = vertical ? proposal.height : proposal.width
        const extent = along === null ? (vertical ? content.height : content.width) : resolve(along, 0, UNBOUNDED)
        const cross = vertical
          ? resolve(proposal.width, content.width, content.width)
          : resolve(proposal.height, content.height, content.height)
        return vertical ? { width: cross, height: extent } : { width: extent, height: cross }
      }

      case 'grid':
        return this.measureGrid(element, proposal, env).size

      case 'table':
        return this.measureTable(element, proposal, env).size

      case 'firstFit': {
        const chosen = this.firstThatFits(element, proposal, env)
        return this.measure(chosen, proposal, env)
      }

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
      const order = this.flexibilityOrder(children, vertical, cross, env)

      for (const [position, index] of order.entries()) {
        const share = this.shareFor(children, order, position, remaining)
        const size = this.measure(children[index]!, axisProposal(vertical, cross, share), env)
        sizes[index] = size
        remaining -= vertical ? size.height : size.width
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
      return { index, flexibility, priority: layoutPriorityOf(child) }
    })

    // Higher layout priority is served first, whatever its flexibility - that is what
    // `.layoutPriority` means: take your ideal size before the others are considered.
    // Within equal priority the flexibility rule applies, and ties keep source order.
    return ranked
      .sort(
        (a, b) =>
          b.priority - a.priority || a.flexibility - b.flexibility || a.index - b.index,
      )
      .map((entry) => entry.index)
  }

  /**
   * The space offered to the next child in a stack's measure order.
   *
   * Divided among the children *of the same layout priority* that are still
   * unmeasured - not among all of them. That is what `.layoutPriority` means: the
   * highest-priority group gets first claim on everything, and the rest divide what
   * survives. Dividing equally regardless would make the modifier almost invisible,
   * changing only the order in which two children took the same half each.
   */
  private shareFor(
    children: readonly LayoutElement[],
    order: readonly number[],
    position: number,
    remaining: number,
  ): number {
    const priority = layoutPriorityOf(children[order[position]!]!)

    let peers = 0
    for (let i = position; i < order.length; i++) {
      if (layoutPriorityOf(children[order[i]!]!) === priority) peers++
    }

    return peers > 0 ? Math.max(0, remaining / peers) : 0
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

      // A background never changes the size of what it sits behind - and neither
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

      case 'containerRelativeFrame': {
        // The container's own size along the named axis, divided into `count` parts.
        // The proposal *is* that size: a scroll view proposes its visible width, and
        // a stack proposes what is left, which is what the modifier asks for.
        const inner_ = this.measure(element.child, proposal, inner)
        const across = resolve(proposal.width, inner_.width, inner_.width)
        const down = resolve(proposal.height, inner_.height, inner_.height)
        return {
          width: modifier.horizontal
            ? (across - modifier.spacing * (modifier.count - 1)) / modifier.count
            : inner_.width,
          height: modifier.vertical
            ? (down - modifier.spacing * (modifier.count - 1)) / modifier.count
            : inner_.height,
        }
      }

      case 'safeAreaInset': {
        // The inset content takes its ideal size across the axis it is pinned to, and
        // the child is offered what is left - which is the difference from an overlay.
        const vertical_ = modifier.edge === 'top' || modifier.edge === 'bottom'
        const bar = this.measure(modifier.content, proposal, inner)
        const taken = (vertical_ ? bar.height : bar.width) + modifier.spacing
        const reduced: ProposedSize = vertical_
          ? { width: proposal.width, height: shrink(proposal.height, taken) }
          : { width: shrink(proposal.width, taken), height: proposal.height }
        const body = this.measure(element.child, reduced, inner)
        return vertical_
          ? { width: Math.max(body.width, bar.width), height: body.height + taken }
          : { width: body.width + taken, height: Math.max(body.height, bar.height) }
      }

      case 'alignmentGuide':
      case 'scale':
      case 'rotate3D':
      case 'blendMode':
      case 'redacted':
      case 'unredacted':
        // Paint-time: layout still reserves the untransformed size, which is why a
        // scaled view overlaps its neighbours and a redacted one keeps its shape.
        return this.measure(element.child, proposal, inner)

      case 'position':
        // `.position` takes the whole space offered and puts the child at a point
        // inside it - which is why it collapses whatever was around it.
        return {
          width: resolve(proposal.width, 0, UNBOUNDED),
          height: resolve(proposal.height, 0, UNBOUNDED),
        }

      case 'aspectRatio': {
        const size = this.measure(element.child, { width: null, height: null }, inner)
        const ratio = modifier.ratio ?? (size.height === 0 ? 1 : size.width / size.height)
        return fitToRatio(ratio, modifier.mode, proposal)
      }

      case 'geometry':
        // A geometry reader is greedy: it reports the whole proposal, which is also
        // the size it hands to its content.
        return {
          width: resolve(proposal.width, 0, UNBOUNDED),
          height: resolve(proposal.height, 0, UNBOUNDED),
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

    // Measure every child first, then size each row to its tallest member - a grid
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
        const runs = paintedRuns(element, env)
        const measured = measureRuns(
          measuredRuns(runs),
          env.font,
          bounds.width,
          this.metrics,
          env.lineLimit,
          env.lineSpacing ?? 0,
        )
        out.push({
          id: element.id,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: 0,
          paint: {
            kind: 'text',
            text: runs.map((run) => run.text).join(''),
            lines: measured.lines,
            font: env.font,
            color: env.foregroundColor,
            runs,
            ...(env.textAlign ? { align: env.textAlign } : {}),
            ...(env.lineSpacing ? { lineSpacing: env.lineSpacing } : {}),
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
            resizable: element.resizable,
            ...(element.symbol ? { symbol: element.symbol } : {}),
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

      case 'table':
        return this.placeTable(element, bounds, env, out, z, parent)

      case 'firstFit':
        return this.place(
          this.firstThatFits(element, { width: bounds.width, height: bounds.height }, env),
          bounds,
          env,
          out,
          z,
          parent,
        )

      case 'path':
        out.push({
          id: element.id,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: 0,
          paint: {
            kind: 'path',
            d: element.d,
            fillRule: element.fillRule,
            // An unfilled, unstroked path takes the inherited foreground colour,
            // which is what `Path { … }` with no styling draws as.
            ...(element.fill
              ? { fill: element.fill }
              : element.stroke
                ? {}
                : { fill: { kind: 'solid' as const, color: env.foregroundColor } }),
            ...(element.stroke ? { stroke: element.stroke } : {}),
          },
          ...debugInfo(element),
          ...decorations(env, parent),
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return z + 1

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
            // A stroked shape with no fill is an outline, which is what
            // `.stroke(…)` alone means.
            ...(element.fill
              ? { fill: element.fill }
              : element.stroke
                ? {}
                : { fill: { kind: 'solid' as const, color: env.foregroundColor } }),
            ...(element.stroke ? { stroke: element.stroke } : {}),
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
   * thing to the browser and get native scrolling - momentum, rubber-banding,
   * scrollbar - instead of us approximating all of it in the worker.
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

  /**
   * Sizes a `Grid`'s columns and rows.
   *
   * A column is as wide as its widest cell in any row - that cross-row alignment is
   * the whole reason `Grid` exists, and the reason every cell has to be measured
   * before any of them can be placed.
   */
  private measureTable(
    element: TableElement,
    proposal: ProposedSize,
    env: LayoutEnvironment,
  ): { size: Size; columns: number[]; rows: number[] } {
    const columnCount = element.rows.reduce((max, row) => Math.max(max, row.length), 0)
    const columns = new Array<number>(columnCount).fill(0)
    const rows: number[] = []

    for (const row of element.rows) {
      let height = 0
      row.forEach((cell, index) => {
        const size = this.measure(cell, { width: null, height: null }, env)
        columns[index] = Math.max(columns[index] ?? 0, size.width)
        height = Math.max(height, size.height)
      })
      rows.push(height)
    }

    void proposal
    const width = columns.reduce((a, b) => a + b, 0) + element.spacing * Math.max(0, columnCount - 1)
    const height =
      rows.reduce((a, b) => a + b, 0) + element.rowSpacing * Math.max(0, rows.length - 1)

    return { size: { width, height }, columns, rows }
  }

  private placeTable(
    element: TableElement,
    bounds: Rect,
    env: LayoutEnvironment,
    out: PlacedNode[],
    z: number,
    parent: string | null,
  ): number {
    const { columns, rows } = this.measureTable(
      element,
      { width: bounds.width, height: bounds.height },
      env,
    )

    let next = z
    let y = bounds.y

    element.rows.forEach((row, rowIndex) => {
      let x = bounds.x
      row.forEach((cell, columnIndex) => {
        const width = columns[columnIndex] ?? 0
        const height = rows[rowIndex] ?? 0
        const size = this.measure(cell, { width, height }, env)
        next = this.place(
          cell,
          alignedRect({ x, y, width, height }, size, element.alignment),
          env,
          out,
          next,
          parent,
        )
        x += width + element.spacing
      })
      y += (rows[rowIndex] ?? 0) + element.rowSpacing
    })

    return next
  }

  /**
   * The first child of a `ViewThatFits` that fits, or the last as a fallback.
   *
   * Matching SwiftUI: when nothing fits, the *last* child is used, on the grounds
   * that it is the one the author wrote as the compact form.
   */
  private firstThatFits(
    element: { axes: readonly Axis[]; children: readonly LayoutElement[] },
    proposal: ProposedSize,
    env: LayoutEnvironment,
  ): LayoutElement {
    const children = element.children
    if (children.length === 0) return { kind: 'empty', id: 'fit-empty' }

    const checkWidth = element.axes.includes('horizontal')
    const checkHeight = element.axes.includes('vertical')

    for (const child of children) {
      const ideal = this.measure(child, { width: null, height: null }, env)
      const availableWidth = resolve(proposal.width, Number.POSITIVE_INFINITY, UNBOUNDED)
      const availableHeight = resolve(proposal.height, Number.POSITIVE_INFINITY, UNBOUNDED)

      const fitsWidth = !checkWidth || ideal.width <= availableWidth + 0.5
      const fitsHeight = !checkHeight || ideal.height <= availableHeight + 0.5
      if (fitsWidth && fitsHeight) return child
    }

    return children[children.length - 1]!
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

    const crossAlignment = vertical ? element.alignment.horizontal : element.alignment.vertical
    const guides = element.children.map((child, i) => {
      const size = sizes[i]!
      const across = vertical ? size.width : size.height
      const override = alignmentGuideOf(child, crossAlignment)
      return override ? override(size) : defaultGuide(crossAlignment, across)
    })
    const maxGuide = guides.reduce((max, g) => Math.max(max, g), 0)
    const widest = sizes.reduce((max, s) => Math.max(max, vertical ? s.width : s.height), 0)

    let offset = 0
    let next = z

    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i]!
      const size = sizes[i]!

      const crossAvailable = vertical ? bounds.width : bounds.height
      // Align the *guides*, not the edges. With the default guides this is identical
      // to offsetting by the alignment - a `.trailing` stack still puts every right
      // edge together - and it is what makes `.alignmentGuide` mean anything at all.
      const crossOffset =
        alignOffset(crossAlignment, crossAvailable, widest) + (maxGuide - guides[i]!)

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
    const order = this.flexibilityOrder(element.children, vertical, cross, env)

    for (const [position, index] of order.entries()) {
      const share = this.shareFor(element.children, order, position, remaining)
      const size = this.measure(element.children[index]!, axisProposal(vertical, cross, share), env)
      sizes[index] = size
      remaining -= vertical ? size.height : size.width
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

      case 'position':
        // The child is centred on the point, in the parent's coordinate space.
        return this.place(
          element.child,
          centredRect(
            { x: bounds.x + modifier.x, y: bounds.y + modifier.y },
            this.measure(element.child, { width: null, height: null }, inner),
          ),
          inner,
          out,
          z,
          parent,
        )

      case 'aspectRatio': {
        const natural = this.measure(element.child, { width: null, height: null }, inner)
        const ratio = modifier.ratio ?? (natural.height === 0 ? 1 : natural.width / natural.height)
        const size = fitToRatio(ratio, modifier.mode, {
          width: bounds.width,
          height: bounds.height,
        })
        return this.place(element.child, alignedRect(bounds, size, CENTRE), inner, out, z, parent)
      }

      case 'geometry': {
        // A real box, so the pipeline can read its size back and hand it to the next
        // evaluation - and so its children are positioned in *its* space, which is
        // the coordinate space `GeometryReader` promises.
        const id = `geo:${modifier.key}`
        out.push({
          id,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: 0,
          paint: { kind: 'hit' },
          ...(parent ? { parent } : {}),
        })
        return this.place(
          element.child,
          { x: 0, y: 0, width: bounds.width, height: bounds.height },
          inner,
          out,
          z + 1,
          id,
        )
      }

      case 'filter':
      case 'material':
      case 'a11y': {
        // Each decorates a *box* around the subtree, so the subtree goes inside it -
        // a filter applies to everything below, and an accessibility label replaces
        // what is read for the whole group.
        const id = `${element.id}-${modifier.kind}`
        out.push({
          id,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: env.cornerRadius,
          paint: { kind: 'hit' },
          ...(modifier.kind === 'filter' ? { filter: modifier.filter } : {}),
          ...(modifier.kind === 'material'
            ? {
                material: {
                  opacity: modifier.opacity,
                  blur: modifier.blur,
                  light: modifier.light,
                },
              }
            : {}),
          ...(modifier.kind === 'a11y'
            ? {
                a11y: {
                  ...(modifier.label !== undefined ? { label: modifier.label } : {}),
                  ...(modifier.value !== undefined ? { value: modifier.value } : {}),
                  ...(modifier.hint !== undefined ? { hint: modifier.hint } : {}),
                  ...(modifier.hidden !== undefined ? { hidden: modifier.hidden } : {}),
                },
              }
            : {}),
          ...(parent ? { parent } : {}),
        })
        return this.place(
          element.child,
          { x: 0, y: 0, width: bounds.width, height: bounds.height },
          inner,
          out,
          z + 1,
          id,
        )
      }

      case 'hitTestable':
        return modifier.enabled
          ? this.place(element.child, bounds, inner, out, z, parent)
          : // Disabled subtrees are still painted; they just stop receiving events,
            // which is what dropping the hit targets achieves.
            this.place(element.child, bounds, stripHitTargets(inner), out, z, parent)

      case 'scale':
      case 'rotate':
      case 'rotate3D': {
        const transformId = `${element.id}-xform`
        out.push({
          id: transformId,
          frame: bounds,
          z,
          opacity: env.opacity,
          cornerRadius: 0,
          paint: { kind: 'hit' },
          transform: transformFor(modifier),
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

      case 'containerRelativeFrame': {
        // The container is the bounds this was offered, so the fraction is taken from
        // them here rather than from whatever the parent chose to hand down: a view
        // asking for a third of the container must get a third even when its parent
        // placed it across the whole width.
        const width = modifier.horizontal
          ? (bounds.width - modifier.spacing * (modifier.count - 1)) / modifier.count
          : bounds.width
        const height = modifier.vertical
          ? (bounds.height - modifier.spacing * (modifier.count - 1)) / modifier.count
          : bounds.height

        const inner_ = this.measure(element.child, { width, height }, inner)
        return this.place(
          element.child,
          {
            x: bounds.x,
            y: bounds.y,
            width: modifier.horizontal ? width : inner_.width,
            height: modifier.vertical ? height : inner_.height,
          },
          inner,
          out,
          z,
          parent,
        )
      }

      case 'safeAreaInset': {
        const vertical_ = modifier.edge === 'top' || modifier.edge === 'bottom'
        const bar = this.measure(
          modifier.content,
          { width: bounds.width, height: bounds.height },
          inner,
        )
        const taken = (vertical_ ? bar.height : bar.width) + modifier.spacing

        const barBounds: Rect = vertical_
          ? {
              x: bounds.x,
              y: modifier.edge === 'top' ? bounds.y : bounds.y + bounds.height - bar.height,
              width: bounds.width,
              height: bar.height,
            }
          : {
              x: modifier.edge === 'leading' ? bounds.x : bounds.x + bounds.width - bar.width,
              y: bounds.y,
              width: bar.width,
              height: bounds.height,
            }

        const bodyBounds: Rect = vertical_
          ? {
              x: bounds.x,
              y: modifier.edge === 'top' ? bounds.y + taken : bounds.y,
              width: bounds.width,
              height: Math.max(0, bounds.height - taken),
            }
          : {
              x: modifier.edge === 'leading' ? bounds.x + taken : bounds.x,
              y: bounds.y,
              width: Math.max(0, bounds.width - taken),
              height: bounds.height,
            }

        const next = this.place(element.child, bodyBounds, inner, out, z, parent)
        return this.place(modifier.content, barBounds, inner, out, next, parent)
      }

      case 'alignmentGuide':
      case 'blendMode':
      case 'redacted':
      case 'unredacted':
        // These are inherited paint facts rather than boxes of their own, so they
        // travel in the environment and every node below carries them out.
        return this.place(element.child, bounds, inner, out, z, parent)

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
            enabled: modifier.enabled && !inner.hitTestingDisabled,
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
/**
 * The paint-time transform a modifier describes.
 *
 * The three share one node because they share one CSS property, and emitting one node
 * per axis would stack transform origins that SwiftUI applies about a single centre.
 */
function transformFor(
  modifier:
    | { readonly kind: 'scale'; readonly x: number; readonly y: number }
    | { readonly kind: 'rotate'; readonly degrees: number }
    | { readonly kind: 'rotate3D'; readonly degrees: number; readonly x: number; readonly y: number; readonly z: number },
): { scaleX: number; scaleY: number; rotate: number; rotateX?: number; rotateY?: number } {
  if (modifier.kind === 'scale') return { scaleX: modifier.x, scaleY: modifier.y, rotate: 0 }
  if (modifier.kind === 'rotate') return { scaleX: 1, scaleY: 1, rotate: modifier.degrees }

  // The axis is a vector, so a rotation about (1, 1, 0) is half about each. Splitting
  // it by component is what SwiftUI's own projection does.
  const { degrees, x, y, z } = modifier
  const length = Math.sqrt(x * x + y * y + z * z) || 1
  return {
    scaleX: 1,
    scaleY: 1,
    rotate: (degrees * z) / length,
    rotateX: (degrees * x) / length,
    rotateY: (degrees * y) / length,
  }
}

function decorations(
  env: LayoutEnvironment,
  parent: string | null,
): {
  parent?: string
  animation?: AnimationHint
  transition?: TransitionHint
  blendMode?: string
  redacted?: boolean
} {
  return {
    ...(parent ? { parent } : {}),
    ...(env.animation ? { animation: env.animation } : {}),
    ...(env.transition ? { transition: env.transition } : {}),
    ...(env.blendMode ? { blendMode: env.blendMode } : {}),
    ...(env.redacted ? { redacted: true } : {}),
  }
}

/**
 * What a scroll view proposes to its content.
 *
 * Unbounded along the scroll axis - that is what scrolling *is*, and proposing the
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
 * as will go, then shares the remainder between them - so the same grid shows two
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

/**
 * Where a view's alignment guide sits by default, measured from its own edge.
 *
 * This is SwiftUI's actual model: a stack lines up its children's *guides*, and the
 * familiar behaviour of `.leading` and `.center` falls out of where the default
 * guides are. Writing it this way is what lets `.alignmentGuide` replace one.
 */
function defaultGuide(
  alignment: 'leading' | 'center' | 'trailing' | 'top' | 'bottom',
  size: number,
): number {
  if (alignment === 'center') return size / 2
  if (alignment === 'trailing' || alignment === 'bottom') return size
  return 0
}

/**
 * The guide this element overrides, if it overrides the one being aligned on.
 *
 * Looks through the modifier wrappers, because `.padding().alignmentGuide(…)` and
 * `.alignmentGuide(…).padding()` are the same view with the wrappers in a different
 * order, and a guide that only worked in one of them would be a puzzle rather than a
 * feature. The outermost matching guide wins, as the last modifier written does.
 */
function alignmentGuideOf(
  element: LayoutElement,
  alignment: string,
): ((size: Size) => number) | null {
  let current: LayoutElement = element
  while (current.kind === 'modified') {
    if (current.modifier.kind === 'alignmentGuide' && current.modifier.guide === alignment) {
      return current.modifier.compute
    }
    current = current.child
  }
  return null
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

/** Alignment for things that centre on a point rather than within a box. */
const CENTRE: Alignment = { horizontal: 'center', vertical: 'center' }

/**
 * Applies `.textCase`, which is the one text policy that changes the string itself
 * rather than how it is laid out.
 */
/**
 * Resolves a text element's spans against the environment it is drawn in.
 *
 * Every field of a run is an override, so a `Text` that set nothing produces exactly
 * the run the environment describes - which is why the single-run path costs one
 * array of one object rather than a branch through the whole painter.
 */
function paintedRuns(element: TextElement, env: LayoutEnvironment): readonly PaintedRun[] {
  const inherited = (text: string): PaintedRun => ({
    text: displayText(text, env),
    font: env.font,
    color: env.foregroundColor,
    ...(env.underline ? { underline: true } : {}),
    ...(env.strikethrough ? { strikethrough: true } : {}),
    ...(env.tracking ? { tracking: env.tracking } : {}),
    ...(env.baselineOffset ? { baselineOffset: env.baselineOffset } : {}),
  })

  if (!element.runs || element.runs.length === 0) return [inherited(element.text)]

  return element.runs.map((run) => {
    const base = inherited(run.text)
    if (!run.font && run.color === undefined) {
      return applyRunAttributes(base, run)
    }
    // A run that names a size is a different face, so its line height comes from the
    // metrics rather than from whatever the inherited face happened to have.
    const font: ResolvedFont = {
      ...base.font,
      ...(run.font?.family !== undefined ? { family: run.font.family } : {}),
      ...(run.font?.size !== undefined
        ? { size: run.font.size, lineHeight: run.font.size * LINE_HEIGHT_RATIO }
        : {}),
      ...(run.font?.weight !== undefined ? { weight: run.font.weight } : {}),
      ...(run.font?.italic !== undefined ? { italic: run.font.italic } : {}),
    }
    return applyRunAttributes(
      { ...base, font, ...(run.color ? { color: run.color } : {}) },
      run,
    )
  })
}

/** The paint-only half of a run: attributes that override what the environment set. */
function applyRunAttributes(base: PaintedRun, run: TextRunSpec): PaintedRun {
  return {
    ...base,
    ...(run.underline !== undefined ? { underline: run.underline } : {}),
    ...(run.strikethrough !== undefined ? { strikethrough: run.strikethrough } : {}),
    ...(run.tracking !== undefined ? { tracking: run.tracking } : {}),
    ...(run.baselineOffset !== undefined ? { baselineOffset: run.baselineOffset } : {}),
  }
}

/**
 * SwiftUI's line height for a face, as a multiple of its size.
 *
 * Only needed where a run sets its own size and there is no resolved font to copy a
 * line height from. The same ratio the font resolver uses, kept here rather than
 * imported so `swiftui-layout` keeps owning every number layout depends on.
 */
const LINE_HEIGHT_RATIO = 1.21

function measuredRuns(runs: readonly PaintedRun[]): readonly MeasuredRun[] {
  return runs.map((run) => ({
    text: run.text,
    font: run.font,
    ...(run.tracking !== undefined ? { tracking: run.tracking } : {}),
  }))
}

function displayText(text: string, env: LayoutEnvironment): string {
  if (env.textCase === 'upper') return text.toUpperCase()
  if (env.textCase === 'lower') return text.toLowerCase()
  return text
}

/** A rect of `size` centred on `point`. */
function centredRect(point: { x: number; y: number }, size: Size): Rect {
  return {
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
    width: size.width,
    height: size.height,
  }
}

/**
 * The largest box of a given aspect ratio that fits the proposal - or the smallest
 * that covers it, for `.fill`.
 *
 * `.scaledToFit` and `.scaledToFill` are the two named forms of exactly this, which
 * is why they are one modifier rather than three.
 */
function fitToRatio(
  ratio: number,
  mode: 'fit' | 'fill',
  proposal: ProposedSize,
): Size {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  const width = resolve(proposal.width, 0, UNBOUNDED)
  const height = resolve(proposal.height, 0, UNBOUNDED)

  if (width === 0 || height === 0) {
    return width === 0 ? { width: height * safeRatio, height } : { width, height: width / safeRatio }
  }

  const fromWidth: Size = { width, height: width / safeRatio }
  const fromHeight: Size = { width: height * safeRatio, height }

  if (mode === 'fit') return fromWidth.height <= height ? fromWidth : fromHeight
  return fromWidth.height >= height ? fromWidth : fromHeight
}

/**
 * A child's `.layoutPriority`, read through whatever modifiers wrap it.
 *
 * The priority is declared on the child but consumed by its *parent* stack, so the
 * stack has to look inward past the modifier chain to find it.
 */
function layoutPriorityOf(element: LayoutElement): number {
  let current = element
  for (let depth = 0; current.kind === 'modified' && depth < 32; depth++) {
    if (current.modifier.kind === 'layoutPriority') return current.modifier.value
    current = current.child
  }
  return 0
}

/**
 * The environment with interactivity switched off.
 *
 * `.allowsHitTesting(false)` keeps a subtree visible but inert. Expressing it as an
 * environment flag rather than by pruning the tree means the subtree still paints -
 * a pruned one would vanish, which is emphatically not what the modifier means.
 */
function stripHitTargets(env: LayoutEnvironment): LayoutEnvironment {
  return { ...env, hitTestingDisabled: true }
}
