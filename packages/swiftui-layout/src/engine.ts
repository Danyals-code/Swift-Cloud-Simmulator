import type { Fill, Rect, ResolvedFont, RGBA, ShapeKind, Size, SourceSpan } from '@studio/shared'
import {
  childEnvironment,
  type Alignment,
  type LayoutElement,
  type LayoutEnvironment,
  type LayoutModifier,
  type ModifiedElement,
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
  readonly hitTarget?: { readonly handlerId: string; readonly label: string }
  readonly debugName?: string
  readonly debugModifiers?: readonly string[]
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

    this.place(root, alignedRect(bounds, size, alignment), env, nodes, 0)
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

      // A background never changes the size of what it sits behind.
      case 'background':
        return this.measure(element.child, proposal, inner)

      default:
        return this.measure(element.child, proposal, inner)
    }
  }

  // ------------------------------------------------------------------- place

  private place(
    element: LayoutElement,
    bounds: Rect,
    env: LayoutEnvironment,
    out: PlacedNode[],
    z: number,
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
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return z + 1
      }

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
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return z + 1

      case 'stack':
        return this.placeStack(element, bounds, env, out, z)

      case 'zstack': {
        let next = z
        for (const child of element.children) {
          const size = this.measure(child, { width: bounds.width, height: bounds.height }, env)
          next = this.place(child, alignedRect(bounds, size, element.alignment), env, out, next)
        }
        return next
      }

      case 'modified':
        return this.placeModified(element, bounds, env, out, z)
    }
  }

  private placeStack(
    element: StackElement,
    bounds: Rect,
    env: LayoutEnvironment,
    out: PlacedNode[],
    z: number,
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

      next = this.place(child, childBounds, env, out, next)
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
        )
      }

      case 'frame': {
        const childProposal: ProposedSize = {
          width: modifier.width ?? clampProposal(bounds.width, modifier.minWidth, modifier.maxWidth),
          height:
            modifier.height ?? clampProposal(bounds.height, modifier.minHeight, modifier.maxHeight),
        }
        const size = this.measure(element.child, childProposal, inner)
        return this.place(element.child, alignedRect(bounds, size, modifier.alignment), inner, out, z)
      }

      case 'background': {
        // The background paints *behind*, so it is emitted first and therefore lower
        // in z-order. It occupies exactly the frame of what it backs, which is what
        // makes `.padding().background()` cover the padding and
        // `.background().padding()` not.
        const next = this.place(modifier.content, bounds, inner, out, z)
        return this.place(element.child, bounds, inner, out, next)
      }

      case 'hitTarget': {
        const next = this.place(element.child, bounds, inner, out, z)
        out.push({
          id: `${element.id}-hit`,
          frame: bounds,
          z: next,
          opacity: 1,
          cornerRadius: 0,
          paint: { kind: 'hit' },
          hitTarget: { handlerId: modifier.handlerId, label: modifier.label },
          ...(element.origin ? { origin: element.origin } : {}),
        })
        return next + 1
      }

      default:
        return this.place(element.child, bounds, inner, out, z)
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
