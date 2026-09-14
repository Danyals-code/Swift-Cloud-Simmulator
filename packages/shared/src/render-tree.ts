import type { SourceSpan } from './source'

/**
 * The worker -> main-thread contract.
 *
 * A RenderTree is fully laid out: every node already has an absolute frame in
 * device points. The renderer does no layout at all, it only paints. That is the
 * whole point of the two-pass layout engine (docs/02-ARCHITECTURE.md §7) — CSS
 * never gets a chance to disagree with SwiftUI about sizing.
 *
 * Everything here must survive `structuredClone`: plain data only, no classes,
 * no functions, no Map/Set in hot paths.
 */

export interface Size {
  readonly width: number
  readonly height: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** sRGB, channels 0-255, alpha 0-1. */
export interface RGBA {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

export interface GradientStop {
  readonly color: RGBA
  /** 0-1 */
  readonly location: number
}

export type Fill =
  | { readonly kind: 'solid'; readonly color: RGBA }
  | {
      readonly kind: 'linearGradient'
      readonly stops: readonly GradientStop[]
      /** unit space: (0,0) top-leading, (1,1) bottom-trailing */
      readonly start: Point
      readonly end: Point
    }

export interface ResolvedFont {
  readonly family: string
  /** points */
  readonly size: number
  /** 100-900 */
  readonly weight: number
  readonly italic: boolean
  /** points */
  readonly lineHeight: number
}

export type TextAlignment = 'leading' | 'center' | 'trailing'

export interface TextRun {
  readonly text: string
  readonly font: ResolvedFont
  readonly color: RGBA
}

export interface TextPayload {
  readonly runs: readonly TextRun[]
  readonly alignment: TextAlignment
  /**
   * Resolved line boxes from the measurement pass. Phase 0 leaves this undefined
   * and lets the browser wrap; Phase 3 fills it in so wrapping is decided by our
   * text metrics service rather than by CSS.
   */
  readonly lines?: readonly TextLine[]
}

export interface TextLine {
  readonly text: string
  /** relative to the node's frame origin */
  readonly origin: Point
  readonly width: number
  readonly baseline: number
}

export type ShapeKind = 'rectangle' | 'roundedRectangle' | 'circle' | 'ellipse' | 'capsule'

export interface ShapePayload {
  readonly shape: ShapeKind
  readonly cornerRadius?: number
  readonly fill?: Fill
  readonly stroke?: { readonly color: RGBA; readonly width: number }
}

/**
 * Rendered when a view or modifier is outside the coverage matrix.
 *
 * Requirement FR-4.11: never fail silently. The user sees a labelled box saying
 * exactly which construct is missing, and the same feature name goes to telemetry
 * so the coverage backlog is driven by real usage.
 */
export interface PlaceholderPayload {
  readonly feature: string
  readonly reason: string
}

export interface HitTarget {
  /** identifies which interactive element was hit when dispatching back to the worker */
  readonly handlerId: string
  readonly role: 'button' | 'toggle' | 'textField' | 'slider' | 'tapGesture'
  readonly enabled: boolean
}

export interface A11y {
  readonly role?: string
  readonly label?: string
  readonly value?: string
  readonly hidden?: boolean
}

export type RenderNodeKind = 'layer' | 'text' | 'shape' | 'image' | 'placeholder'

export interface RenderNode {
  /**
   * ViewIdentity — stable across re-renders for the same logical view. Drives DOM
   * reuse, `@State` box lookup, and FLIP animation. See docs/02-ARCHITECTURE.md §6.2.
   */
  readonly id: string
  readonly kind: RenderNodeKind
  /** absolute, in device points, origin top-leading */
  readonly frame: Rect
  /** paint order; higher paints later */
  readonly z: number
  readonly opacity: number
  readonly background?: Fill
  readonly cornerRadius?: number
  /** clip children to this node's bounds */
  readonly clip?: boolean
  readonly text?: TextPayload
  readonly shape?: ShapePayload
  readonly placeholder?: PlaceholderPayload
  readonly hitTarget?: HitTarget
  readonly a11y?: A11y
  /** where in the Swift source this came from — powers hover-to-source in the inspector */
  readonly origin?: SourceSpan
  /** Inspector readout: what this view is called and what was applied to it (FR-5.8). */
  readonly inspect?: {
    readonly name: string
    readonly modifiers?: readonly string[]
  }
}

export interface RenderTree {
  /** the device's logical point size this tree was laid out for */
  readonly canvas: Size
  /** flat and pre-ordered (painter's algorithm): a parent always precedes its children */
  readonly nodes: readonly RenderNode[]
  /** monotonic; lets the renderer cheaply skip an unchanged tree */
  readonly revision: number
}

export const EMPTY_RENDER_TREE: RenderTree = {
  canvas: { width: 0, height: 0 },
  nodes: [],
  revision: 0,
}

export function rgba(r: number, g: number, b: number, a = 1): RGBA {
  return { r, g, b, a }
}

export function cssColor(c: RGBA): string {
  return c.a >= 1 ? `rgb(${c.r} ${c.g} ${c.b})` : `rgb(${c.r} ${c.g} ${c.b} / ${c.a})`
}

export function cssFill(f: Fill): string {
  if (f.kind === 'solid') return cssColor(f.color)
  const stops = f.stops.map((s) => `${cssColor(s.color)} ${(s.location * 100).toFixed(2)}%`).join(', ')
  // SwiftUI unit space has y pointing down, which matches CSS gradient angle maths here.
  const angle = (Math.atan2(f.end.x - f.start.x, f.start.y - f.end.y) * 180) / Math.PI
  return `linear-gradient(${angle.toFixed(2)}deg, ${stops})`
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
}
