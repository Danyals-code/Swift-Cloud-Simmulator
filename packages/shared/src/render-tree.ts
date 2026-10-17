import type { SourceSpan } from './source'
import { symbolMetrics } from './symbol-map'
import type { SymbolPaint } from './symbol-table'
import type { MeshFill } from './mesh'

export type { MeshFill } from './mesh'

/**
 * The worker -> main-thread contract.
 *
 * A RenderTree is fully laid out: every node already has an absolute frame in
 * device points. The renderer does no layout at all, it only paints. That is the
 * whole point of the two-pass layout engine (docs/02-ARCHITECTURE.md §7) - CSS
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

/** A shadow cast inward from the edges of what a fill paints, as `.blue.shadow(.inner(radius: 4))` asks. */
export interface InnerShadow {
  readonly color: RGBA
  readonly radius: number
  readonly x: number
  readonly y: number
}

export type Fill = (
  | MeshFill
  | { readonly kind: 'radialGradient'; readonly stops: readonly GradientStop[]; readonly center: Point; readonly startRadius: number; readonly endRadius: number }
  | { readonly kind: 'angularGradient'; readonly stops: readonly GradientStop[]; readonly center: Point; readonly startAngle: number; readonly endAngle: number }
  | { readonly kind: 'solid'; readonly color: RGBA }
  | {
      readonly kind: 'linearGradient'
      readonly stops: readonly GradientStop[]
      /** unit space: (0,0) top-leading, (1,1) bottom-trailing */
      readonly start: Point
      readonly end: Point
    }
) & { readonly innerShadow?: InnerShadow }

/** A gradient fill's stops, or null for a solid colour or a mesh, which have none (Wave 6d). */
export function stopsOf(fill: Fill): readonly GradientStop[] | null {
  return fill.kind === 'solid' || fill.kind === 'mesh' ? null : fill.stops
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
  /** `.smallCaps()`: lowercase letters drawn as small capitals. */
  readonly smallCaps?: boolean
}

export type TextAlignment = 'leading' | 'center' | 'trailing'

/**
 * One attributed span of a `Text`.
 *
 * Plain text is a single run. A run per span is what `Text + Text` needs - the two
 * halves keep their own font and colour - and it is also what the attributes below
 * are attached to, because SwiftUI lets each half of a concatenation carry its own.
 */
export interface TextRun {
  readonly foregroundFill?: Fill
  readonly text: string
  readonly font: ResolvedFont
  readonly color: RGBA
  /** `.underline()` */
  readonly underline?: boolean
  readonly underlineColor?: RGBA | null
  /** `.strikethrough()` */
  readonly strikethrough?: boolean
  readonly strikethroughColor?: RGBA | null
  /** `.kerning` / `.tracking`: extra points between characters. Changes measured width. */
  readonly tracking?: number
  /** `.baselineOffset`: points above the baseline, negative for below. */
  readonly baselineOffset?: number
  /**
   * `.monospacedDigit`: every digit takes the width of the widest.
   *
   * A measurement property as much as a paint one - a counter that does not jitter is
   * the whole point - so the metrics use one advance for all ten digits and the
   * painter asks for the same thing from the font.
   */
  readonly tabularNumbers?: boolean
  /**
   * An SF Symbol drawn in the text in place of `text`, `Text("\(Image(systemName: "star"))")`
   * (Wave 6a): in the box `inlineSymbolBox` gives it at the run's font, in the run's colour.
   */
  readonly symbol?: string
  /** A project image drawn in the text in place of `text` (Wave 6a): at its own size, its bottom on the baseline. */
  readonly bitmap?: { readonly url: string; readonly name: string; readonly width: number; readonly height: number }
  /**
   * The box `foregroundFill` spans, relative to the text's frame, when it isn't the frame:
   * a gradient masked by text is spread across the gradient's view (Wave 6a).
   */
  readonly fillFrame?: Rect
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
  /** `.lineSpacing`: extra points between lines, on top of the font's own leading. */
  readonly lineSpacing?: number
}

/**
 * One run's contribution to one line.
 *
 * A line is sliced rather than re-measured because the line breaker already decided
 * where every cluster went: re-deriving which run a character belongs to from the
 * line's text would get a repeated substring wrong.
 */
export interface TextLineSlice {
  readonly baseline?: number
  /** index into `TextPayload.runs` */
  readonly run: number
  readonly text: string
  readonly width: number
}

export interface TextLine {
  readonly text: string
  /** relative to the node's frame origin */
  readonly origin: Point
  readonly width: number
  readonly baseline: number
  readonly fontBaseline?: number
  readonly height?: number
  /**
   * The runs this line is made of, in order.
   *
   * Absent for single-run text, which is almost all of it - the renderer then paints
   * `text` with the first run's attributes and allocates nothing per line.
   */
  readonly slices?: readonly TextLineSlice[]
}

/**
 * `spinner` is the odd one: not a shape a user can name, but the one iOS draws for an
 * indeterminate `ProgressView`. It lives here rather than as its own node kind because
 * it behaves like every other shape - a frame, a foreground colour, a place in the
 * paint order - and differs only in what the renderer puts inside the box.
 */
export type ShapeKind =
  | 'rectangle'
  | 'roundedRectangle'
  | 'circle'
  | 'ellipse'
  | 'capsule'
  | 'spinner'

export type CornerStyle = 'circular' | 'continuous'

/**
 * A radius per corner, as `UnevenRoundedRectangle` and `RectangleCornerRadii` name them.
 * The preview lays out left to right, so leading is the left side and trailing the right.
 */
export interface CornerRadii {
  readonly topLeading: number
  readonly bottomLeading: number
  readonly bottomTrailing: number
  readonly topTrailing: number
}
export interface StrokeOptions { readonly lineCap?: 'butt' | 'round' | 'square'; readonly lineJoin?: 'miter' | 'round' | 'bevel'; readonly miterLimit?: number; readonly dash?: readonly number[]; readonly dashPhase?: number }
export interface ShapeStroke extends StrokeOptions {
  readonly color: RGBA
  /** A gradient the stroke is painted with, as `.stroke(LinearGradient(…))` asks; `color` is then its first stop. */
  readonly fill?: Fill
  readonly width: number
  readonly placement?: 'center' | 'inside'
  readonly usesForeground?: boolean
}

export interface SliderPayload {
  readonly fraction: number
  readonly trackHeight: number
  readonly thumbDiameter: number
  readonly thumbHeight?: number
  readonly tint: RGBA
  readonly trackColor: RGBA
  readonly thumbColor: RGBA
  readonly ticks?: readonly number[]
}

export interface ClipShape {
  readonly kind: ShapeKind
  readonly cornerStyle?: CornerStyle
  readonly cornerRadii?: CornerRadii
}

export interface ShapePayload {
  readonly cornerStyle?: CornerStyle
  readonly shape: ShapeKind
  readonly cornerRadius?: number
  /** A rounded rectangle's own radius at each corner, in place of `cornerRadius`. */
  readonly cornerRadii?: CornerRadii
  readonly fill?: Fill
  readonly stroke?: ShapeStroke
  readonly trim?: ShapeTrim
}

/**
 * `.trim(from:to:)` on a shape: the part of its outline to draw, as fractions of the
 * outline's length from where SwiftUI's path starts. Applied when the shape is drawn,
 * because its outline isn't known until its size is.
 */
export interface ShapeTrim {
  readonly from: number
  readonly to: number
}

/**
 * A colour-manipulation filter, applied to a node and everything inside it.
 *
 * Mapped to CSS filters, which is exact for blur, saturation, brightness, contrast
 * and grayscale - these are the same operations with the same definitions, not
 * approximations of them.
 */
export interface FilterSpec {
  readonly blur?: number
  readonly saturation?: number
  readonly brightness?: number
  readonly contrast?: number
  readonly grayscale?: number
  /** `.hueRotation` - degrees around the colour wheel. */
  readonly hueRotate?: number
  /**
   * `.colorMultiply` - every channel multiplied by this colour.
   *
   * Not a CSS filter: drawn as an overlay in multiply blend mode, which is the same
   * operation. Carried here rather than as a background because it applies to the
   * subtree, exactly as the filters do.
   */
  readonly multiply?: RGBA
}

/**
 * Rendered when a view or modifier is outside the coverage matrix.
 *
 * Requirement FR-4.11: never fail silently. The user sees a labelled box saying
 * exactly which construct is missing, and the same feature name goes to telemetry
 * so the coverage backlog is driven by real usage.
 */
export type PlaceholderPayload =
  /**
   * Real SwiftUI the preview has no drawing for yet, a view name it does not know, or an
   * image the project does not have, named by `feature` as the code names it. Telemetry
   * counts the views by it.
   */
  | { readonly kind: 'unsupported' | 'unknown' | 'missing'; readonly feature: string }
  /**
   * A view of the project's own whose code stopped, with the failure the AI is told about,
   * or a notice in place of the whole screen, with its detail.
   */
  | { readonly kind: 'stopped' | 'notice'; readonly feature: string; readonly reason: string }

/** Why a placeholder is drawn. */
export type PlaceholderKind = PlaceholderPayload['kind']

/** A name written in camel case, in words: `EditButton` is "Edit button", `buttonTitle` is "button title". */
export function nameInWords(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').map((word, index) => index ? word.toLowerCase() : word).join(' ')
}

/** What a placeholder says on the canvas, in a designer's words rather than Swift's (D12). */
export function placeholderWords(placeholder: PlaceholderPayload): { readonly title: string; readonly detail: string } {
  switch (placeholder.kind) {
    case 'unsupported': return { title: nameInWords(placeholder.feature), detail: 'Not drawn in the preview yet. Xcode draws it as written.' }
    case 'unknown': return { title: placeholder.feature, detail: 'The preview doesn’t know this view. Xcode builds it only if an Apple framework or the project declares it.' }
    case 'stopped': return { title: nameInWords(placeholder.feature), detail: `Its code stopped: ${placeholder.reason.replace(/^(Swift runtime failure|Fatal error): /, '').replace(/\.?$/, '.')}` }
    case 'missing': return { title: `Image “${placeholder.feature}”`, detail: 'This image is missing. Add it in Project resources.' }
    case 'notice': return { title: placeholder.feature, detail: placeholder.reason }
  }
}

export interface HitTarget {
  readonly textAlign?: 'leading' | 'center' | 'trailing'
  readonly step?: number
  readonly secure?: boolean
  readonly multiline?: boolean
  readonly inputInset?: number
  readonly submitHandlerId?: string
  readonly contextMenuHandlerId?: string
  readonly inputType?: 'time'
  readonly inputMode?: 'text' | 'email' | 'tel' | 'url' | 'numeric' | 'decimal' | 'search'
  readonly enterKeyHint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send'
  readonly autocapitalization?: string
  readonly autocorrection?: boolean
  readonly thumbDiameter?: number
  readonly cornerRadius?: number
  readonly placeholderColor?: RGBA
  /** identifies which interactive element was hit when dispatching back to the worker */
  readonly handlerId: string
  readonly role: 'button' | 'toggle' | 'textField' | 'slider' | 'tapGesture' | 'drag' | 'contextMenu'
  readonly enabled: boolean
  /**
   * Control parameters, for the interactive elements the renderer builds for real.
   *
   * A text field is an `<input>` and a slider is a range input, because a caret, an
   * IME and keyboard control cannot be faked by catching clicks on a picture.
   */
  readonly value?: string
  readonly placeholder?: string
  readonly min?: number
  readonly max?: number
  readonly font?: ResolvedFont
  readonly color?: RGBA
}

/**
 * How the renderer should animate this node into its new frame.
 *
 * The engine produces one static frame per state; interpolating between consecutive
 * frames is the browser's job. Keeping the description here - rather than having the
 * renderer guess from what changed - is what makes `.animation(_:value:)` scope
 * correctly: only nodes under that modifier carry a hint, so only they animate.
 */
export interface AnimationSpec {
  readonly curve: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring'
  /** seconds */
  readonly duration: number
  readonly delay?: number
  readonly bounce?: number
}

/**
 * One transition, as iOS 27 plays it (measured in docs/parity/native/iphone18pro-motion):
 * `move` by the view's own size towards `edge`; `push` the same, from `edge` and out the
 * other way, fading; `slide` in from the leading edge and out to the trailing one; `scale`
 * from `scale` (0 when not given) about its centre; `blur` from a 0.9 scale, blurred and
 * faded. None of them fades unless it says so.
 */
export interface TransitionPart {
  /** `identity` plays nothing: one side of an asymmetric transition, or a part combined with others. */
  readonly kind: 'opacity' | 'slide' | 'scale' | 'move' | 'push' | 'blur' | 'identity'
  readonly edge?: 'top' | 'bottom' | 'leading' | 'trailing'
  /** `.scale(0.5)`: the size it comes from and goes to. */
  readonly scale?: number
  /** `.combined(with:)`: what plays at the same time, as "Fades too" adds `.opacity`. */
  readonly also?: readonly TransitionPart[]
}

/**
 * How a node enters and leaves. It plays only when the change that adds or removes the
 * node is animated, with that animation's timing, as on iOS (Wave 5a). The renderer
 * retains a bounded, inert snapshot for an exit and cancels it on reentry, reduced
 * motion or a preview boundary.
 */
export interface TransitionSpec extends TransitionPart {
  /** `.asymmetric(insertion:removal:)`: how it leaves, when that isn't how it comes. */
  readonly removal?: TransitionPart
}

/**
 * What animates the change to a tree (Wave 5a): `withAnimation`'s animation, which every
 * view takes, and each `.animation(_:value:)` whose value changed, by the key of the view
 * it is written on, which the views under it take. A view that leaves plays its exit
 * only when one of these covers it; one that comes in carries its own `animation`.
 */
export interface TreeAnimation {
  readonly all?: AnimationSpec
  readonly under?: readonly { readonly key: string; readonly animation: AnimationSpec }[]
}

/**
 * `.contentTransition`: how a Text's words change in an animated frame (Wave 5a). A number
 * rolls each digit that changed, up as it grows, as `numericText(value:)` says by its
 * value, or down for `countsDown`; `opacity` cross-fades the old words with the new.
 */
export type ContentTransitionSpec =
  | { readonly kind: 'numeric'; readonly countsDown?: boolean; readonly value?: number }
  | { readonly kind: 'opacity' }
  | { readonly kind: 'identity' }

/**
 * `.matchedGeometryEffect(id:in:)` (Wave 5a): views with one `id`, which is the namespace's
 * and the id's together, are one view across a change. One coming in moves from where the
 * one that went was, as the frame (or only its `position` or `size`) did on iOS.
 */
export interface MatchedGeometry {
  readonly id: string
  readonly properties?: 'position' | 'size'
  /** `isSource: false`: it takes the others' frame without lending its own. */
  readonly isSource?: false
}

/**
 * Whether the node or view `id` is the one at `path` or under it, as ids and keys nest
 * (Wave 5a): it starts with `path` and doesn't go on with a digit, so `v-0-1-2` is under
 * `v-0-1` and `v-0-10` isn't.
 */
export function isWithin(id: string, path: string): boolean {
  if (!id.startsWith(path)) return false
  const next = id.charCodeAt(path.length)
  return !(next >= 48 && next <= 57)
}

/** A paint-time transform. Does not affect layout, exactly as in SwiftUI. */
export interface TransformSpec {
  readonly scaleX: number
  readonly scaleY: number
  /** degrees, clockwise */
  readonly rotate: number
  readonly anchor?: Point
  readonly rotation3D?: { readonly degrees: number; readonly x: number; readonly y: number; readonly z: number; readonly anchorZ: number; readonly perspective: number }

}

export interface ImagePayload {
  readonly foregroundFill?: Fill
  readonly bitmap?: { readonly url: string; readonly name: string }
  /**
   * The Unicode substitute.
   *
   * Drawn only when `symbol` names nothing the renderer has a shape for - it is the
   * floor, not the plan. See `symbols.ts` in `swiftui-render-dom`.
   */
  readonly glyph: string
  readonly font: ResolvedFont
  readonly color: RGBA
  /** Always true for SF Symbols: what is drawn is not Apple's artwork (R2). */
  readonly approximated: boolean
  /** The symbol name, for drawing it, for the inspector and for telemetry. */
  readonly symbol?: string
  readonly symbolScale?: number
  /** How the symbol's layers are painted, left out for monochrome at full value (Wave 6b). */
  readonly symbolPaint?: SymbolPaint
  /** `.resizable()` - the image fills its frame rather than being sized by the font. */
  readonly resizable?: boolean
}

/**
 * A scrolling container.
 *
 * The one place the render tree stops being flat: nodes naming this node as their
 * `parent` are positioned inside it, in its coordinate space, so the browser scrolls
 * them with its own physics rather than us reimplementing momentum in the worker.
 */
export interface ScrollPayload {
  readonly contentInsets?: { readonly top: number; readonly leading: number; readonly bottom: number; readonly trailing: number }
  readonly axis: 'vertical' | 'horizontal'
  readonly content: Size
  readonly showsIndicators: boolean
  /** `.scrollTargetBehavior(.paging)` (iOS 17): the browser snaps the scroll by the scroller's own size (Wave 4c). */
  readonly paging?: boolean
  /** `.scrollTargetBehavior(.viewAligned)` (iOS 17): the offsets a scroll comes to rest at, each view's start less the leading margin (Wave 6d). */
  readonly snaps?: readonly number[]
}

export interface A11y {
  readonly role?: string
  readonly label?: string
  readonly value?: string
  /** `.accessibilityHint` - the longer explanation, read after the label. */
  readonly hint?: string
  readonly hidden?: boolean
}

/**
 * A vector path, already resolved to the node's own coordinate space.
 *
 * Carried as an SVG path string rather than a command list: the worker is where the
 * geometry is known, and serialising there means the renderer is a single `<path>`
 * element with nothing to interpret. It also makes a path trivially comparable, which
 * is what lets the DOM diff skip an unchanged drawing.
 */
export interface PathPayload {
  /** SVG path data - `M`, `L`, `C`, `Q`, `A`, `Z`. */
  readonly d: string
  readonly fill?: Fill
  readonly stroke?: ShapeStroke
  /** `evenodd` for a path with holes, as `.fill(style:)` selects. */
  readonly fillRule?: 'nonzero' | 'evenodd'
}

export type RenderNodeKind = 'layer' | 'text' | 'shape' | 'image' | 'path' | 'slider' | 'placeholder'

export interface RenderNode {
  /** A modal presentation makes the underlying subtree unavailable to input. */
  readonly inert?: boolean
  readonly blocksPointer?: boolean
  /** Live DOM positioning keeps an open menu beside a scrolled control. */
  readonly anchorId?: string
  readonly slider?: SliderPayload
  readonly cornerStyle?: CornerStyle
  /** The outline children are clipped to; `cornerRadii` gives each corner its own radius. */
  readonly clipShape?: ClipShape
  /**
   * ViewIdentity - stable across re-renders for the same logical view. Drives DOM
   * reuse, `@State` box lookup, and FLIP animation. See docs/02-ARCHITECTURE.md §6.2.
   */
  readonly id: string
  /**
   * What the DOM keys this node by, when that isn't `id` (Wave 5a).
   *
   * `id` is a view's place in its list, which is what selection and Design address it by,
   * so a view after an `if` gets a new id when the `if` opens. Its key follows the branch
   * structure instead and stays the same, so the browser moves that view rather than
   * morphing whatever now has its id. Absent where it would equal `id`.
   */
  readonly key?: string
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
  readonly image?: ImagePayload
  readonly path?: PathPayload
  readonly chrome?: { readonly scrollId: string; readonly collapseDistance: number }
  readonly chromeRole?: 'navigationSurface' | 'largeTitle' | 'inlineTitle'
  readonly scroll?: ScrollPayload
  readonly placeholder?: PlaceholderPayload
  readonly hitTarget?: HitTarget
  readonly a11y?: A11y
  /**
   * The container this node is positioned inside.
   *
   * Absent for all but scroll views, clip shapes and transforms - the three cases
   * where the browser has to own a real box for the effect to work at all.
   */
  readonly parent?: string
  /** `fill` is a gradient the border is painted with, `color` its first stop. */
  readonly border?: { readonly color: RGBA; readonly fill?: Fill; readonly width: number; readonly cornerRadius: number }
  readonly shadow?: {
    readonly color: RGBA
    readonly radius: number
    readonly x: number
    readonly y: number
  }
  readonly transform?: TransformSpec
  readonly animation?: AnimationSpec
  readonly transition?: TransitionSpec
  /** How its words change, on a text (Wave 5a). */
  readonly contentTransition?: ContentTransitionSpec
  /** What it is matched with across a change (Wave 5a). */
  readonly matched?: MatchedGeometry
  readonly filter?: FilterSpec
  /** `.regularMaterial` and friends: a translucent, blurred backdrop. */
  readonly material?: { readonly opacity: number; readonly blur: number; readonly light: boolean }
  /** `.mask` with a gradient or a colour: the alpha everything inside this node is drawn through. */
  readonly mask?: Fill
  /** A `GeometryReader`'s safe-area insets, which its proxy reports. Only on a reader's own node. */
  readonly geometryInsets?: { readonly top: number; readonly leading: number; readonly bottom: number; readonly trailing: number }
  /**
   * `.blendMode` - how this node composites with what is already painted.
   *
   * The CSS name, because the two vocabularies agree on every mode SwiftUI has that a
   * browser also has. A mode with no CSS equivalent never reaches here.
   */
  readonly blendMode?: string
  /**
   * `.redacted(reason: .placeholder)` - the content replaced by a grey bar.
   *
   * A flag rather than a rewritten subtree: the redaction is a paint-time decision in
   * SwiftUI too, and rewriting the tree would lose the frames the engine computed for
   * the real content, which are exactly the frames the bars have to occupy.
   */
  readonly redacted?: boolean
  /** where in the Swift source this came from - powers hover-to-source in the inspector */
  readonly origin?: SourceSpan
  /** Inspector readout: what this view is called and what was applied to it (FR-5.8). */
  readonly inspect?: {
    readonly name: string
    readonly modifiers?: readonly string[]
  }
}

export interface RenderTree {
  readonly chrome?: { readonly scrollId: string; readonly collapseDistance: number }
  readonly calibration?: 'provisional' | 'verified'
  readonly colorScheme?: 'light' | 'dark'
  /** the device's logical point size this tree was laid out for */
  readonly canvas: Size
  /** flat and pre-ordered (painter's algorithm): a parent always precedes its children */
  readonly nodes: readonly RenderNode[]
  /** monotonic; lets the renderer cheaply skip an unchanged tree */
  readonly revision: number
  /**
   * Set on a tree that only carries a message, because the code has errors or stopped
   * running. The phone keeps showing the last tree that ran, dimmed, with this over it.
   * `span` is where the error it names is written, when an error in the code stops it.
   */
  readonly notice?: { readonly title: string; readonly detail: string; readonly span?: SourceSpan }
  /** What animates the change to this tree, if anything does (Wave 5a). */
  readonly animated?: TreeAnimation
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

export function cssFill(f: Fill, size?: Size): string {
  if (f.kind === 'solid') return cssColor(f.color)
  // A mesh is painted on a canvas over its view; where CSS is all there is, its middle colour.
  if (f.kind === 'mesh') return cssColor(f.colors[f.colors.length >> 1]!)
  const stops = f.stops.map((s) => `${cssColor(s.color)} ${(s.location * 100).toFixed(2)}%`).join(', ')
  if (f.kind === 'radialGradient') return `radial-gradient(circle ${f.endRadius}px at ${f.center.x * 100}% ${f.center.y * 100}%, ${f.stops.map(s => `${cssColor(s.color)} ${f.startRadius + s.location * (f.endRadius - f.startRadius)}px`).join(', ')})`
  if (f.kind === 'angularGradient') return `conic-gradient(from ${f.startAngle + 90}deg at ${f.center.x * 100}% ${f.center.y * 100}%, ${f.stops.map(s => `${cssColor(s.color)} ${s.location * (f.endAngle - f.startAngle)}deg`).join(', ')})`
  const width = size?.width ?? 1, height = size?.height ?? 1
  const dx = (f.end.x - f.start.x) * width, dy = (f.end.y - f.start.y) * height
  const length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length
  const extent = Math.abs(width * ux) + Math.abs(height * uy) || 1
  const start = (f.start.x - 0.5) * width * ux + (f.start.y - 0.5) * height * uy + extent / 2
  const angle = Math.atan2(dx, -dy) * 180 / Math.PI
  const positioned = size ? f.stops.map(s => `${cssColor(s.color)} ${((start + s.location * length) / extent * 100).toFixed(2)}%`).join(', ') : stops
  return `linear-gradient(${angle.toFixed(2)}deg, ${positioned})`
}

/** The CSS `filter` value for a node's filter spec, or undefined when it has none. */
export function cssFilter(filter: FilterSpec): string | undefined {
  const parts: string[] = []
  if (filter.blur) parts.push(`blur(${filter.blur}px)`)
  if (filter.saturation !== undefined) parts.push(`saturate(${filter.saturation})`)
  if (filter.brightness !== undefined) parts.push(`brightness(${1 + filter.brightness})`)
  if (filter.contrast !== undefined) parts.push(`contrast(${filter.contrast})`)
  if (filter.grayscale) parts.push(`grayscale(${filter.grayscale})`)
  if (filter.hueRotate) parts.push(`hue-rotate(${filter.hueRotate}deg)`)
  return parts.length > 0 ? parts.join(' ') : undefined
}

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
}

/**
 * The CSS timing function for an animation curve.
 *
 * A spring is drawn where it is: CSS has no spring, but `linear()` takes the curve as
 * points, so a spring of SwiftUI's duration and bounce (damping 1 - bounce) is sampled
 * across `cssSeconds`, the time it takes to come to rest. That matches the frames the
 * simulator draws for `.smooth` and `.bouncy` (docs/parity/native/iphone18pro-motion).
 */
export function cssEasing(spec: AnimationSpec): string {
  switch (spec.curve) {
    case 'linear':
      return 'linear'
    case 'easeIn':
      return 'cubic-bezier(0.42, 0, 1, 1)'
    case 'easeOut':
      return 'cubic-bezier(0, 0, 0.58, 1)'
    case 'easeInOut':
      return 'cubic-bezier(0.42, 0, 0.58, 1)'
    case 'spring': {
      const seconds = cssSeconds(spec), stops: string[] = []
      for (let i = 0; i <= 40; i++) stops.push(String(Math.round(springAt(spec, seconds * i / 40) * 1000) / 1000))
      return `linear(${stops.join(', ')})`
    }
  }
}

/** How far a spring has gone, 0 to 1, `t` seconds in, as SwiftUI's `spring(duration:bounce:)` moves (Wave 5a). */
function springAt(spec: AnimationSpec, t: number): number {
  const w = 2 * Math.PI / spec.duration, damping = 1 - Math.min(Math.max(spec.bounce ?? 0, 0), 0.95)
  if (damping >= 1) return 1 - Math.exp(-w * t) * (1 + w * t)
  const ringing = w * Math.sqrt(1 - damping * damping)
  return 1 - Math.exp(-damping * w * t) * (Math.cos(ringing * t) + damping * w / ringing * Math.sin(ringing * t))
}

/**
 * How long an animation runs in the browser, in seconds (Wave 5a): its duration, or for a
 * spring the time until it is within 0.2% of where it goes, past the duration SwiftUI
 * names it by.
 */
export function cssSeconds(spec: AnimationSpec): number {
  if (spec.curve !== 'spring') return spec.duration
  const w = 2 * Math.PI / spec.duration, damping = 1 - Math.min(Math.max(spec.bounce ?? 0, 0), 0.95)
  const step = spec.duration / 40
  let t = step
  // What it can still be off by: the envelope of its swing.
  while (t < spec.duration * 10 && (damping >= 1 ? Math.exp(-w * t) * (1 + w * t) : Math.exp(-damping * w * t) / Math.sqrt(1 - damping * damping)) > 0.002) t += step
  return Math.round(t * 1000) / 1000
}

/** An animation as the browser times it (Wave 5a): `cssSeconds` and its delay in whole milliseconds, and `cssEasing`. */
export interface CssTiming {
  readonly duration: number
  readonly delay: number
  readonly easing: string
}

/**
 * The browser's timing of an animation (Wave 5a), worked out once for each: a spring's
 * easing is a `linear()` of 41 stops and its time to rest a search. Kept by what the
 * animation is, up to `CSS_TIMINGS_KEPT` of them, which is more than a screen writes; an
 * app making new ones as it runs, as a duration it computes, starts the cache over rather
 * than growing it.
 */
export function cssTiming(spec: AnimationSpec): CssTiming {
  const key = `${spec.curve} ${spec.duration} ${spec.bounce ?? 0} ${spec.delay ?? 0}`
  let timing = CSS_TIMINGS.get(key)
  if (!timing) {
    if (CSS_TIMINGS.size >= CSS_TIMINGS_KEPT) CSS_TIMINGS.clear()
    CSS_TIMINGS.set(key, timing = { duration: Math.round(cssSeconds(spec) * 1000), delay: Math.round((spec.delay ?? 0) * 1000), easing: cssEasing(spec) })
  }
  return timing
}

const CSS_TIMINGS = new Map<string, CssTiming>()
const CSS_TIMINGS_KEPT = 64

/** CSS `animation` playing the keyframes `name` with `timing`, `later` seconds after its own delay, held at both ends (Wave 5a). */
export function cssAnimation(name: string, timing: CssTiming, later = 0): string {
  return `${name} ${timing.duration}ms ${timing.easing} ${timing.delay + Math.round(later * 1000)}ms both`
}

/** SwiftUI's axis-angle projection. Verified against _Rotation3DEffect.effectValue(size:).
 * Perspective is relative to the larger dimension. anchorZ offsets the input plane;
 * SwiftUI restores the x/y anchor after projection, without restoring z.
 */
export function rotationProjection(t: TransformSpec, size: Size): readonly number[] {
  const r = t.rotation3D!
  const length = Math.hypot(r.x, r.y, r.z)
  if (!length) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const x = r.x / length, y = r.y / length, z = r.z / length
  const c = Math.cos(r.degrees * Math.PI / 180), s = Math.sin(r.degrees * Math.PI / 180), v = 1 - c
  const xx = x*x*v+c, xy = x*y*v-z*s, xz = x*z*v+y*s
  const yx = y*x*v+z*s, yy = y*y*v+c, yz = y*z*v-x*s
  const zx = z*x*v-y*s, zy = z*y*v+x*s, zz = z*z*v+c
  const ax = (t.anchor?.x ?? 0.5) * size.width, ay = (t.anchor?.y ?? 0.5) * size.height
  const p = r.perspective / (Math.max(size.width, size.height) || 1)
  const tx = -xx*ax-xy*ay-xz*r.anchorZ, ty = -yx*ax-yy*ay-yz*r.anchorZ
  const w = 1+p*(zx*ax+zy*ay+zz*r.anchorZ)
  return [xx-ax*p*zx, yx-ay*p*zx, -p*zx, xy-ax*p*zy, yy-ay*p*zy, -p*zy, tx+ax*w, ty+ay*w, w]
}
export function cssTransform(t: TransformSpec, size: Size): string {
  if (!t.rotation3D) return `scale(${t.scaleX}, ${t.scaleY}) rotate(${t.rotate}deg)`
  const [a,b,c,d,e,f,g,h,i] = rotationProjection(t, size)
  return `matrix3d(${[a,b,0,c,d,e,0,f,0,0,1,0,g,h,0,i].join(', ')})`
}

/**
 * Where a node is on its screen, nothing scrolled: a node's frame is in the space of the
 * node it is placed in, a scroll view's or a clip's, and that node's in its own parent's.
 * At most 65 parents are followed, so a tree that names itself as its own ancestor ends.
 */
export function screenOrigin(node: RenderNode, byId: ReadonlyMap<string, RenderNode>): Point {
  let x = node.frame.x, y = node.frame.y
  let parent = node.parent ? byId.get(node.parent) : undefined
  for (let depth = 0; parent && depth <= 64; depth++) {
    x += parent.frame.x
    y += parent.frame.y
    parent = parent.parent ? byId.get(parent.parent) : undefined
  }
  return { x, y }
}

/** How far a symbol in text advances, in ems of its font, as iOS 27 draws it between two H's. */
const INLINE_ADVANCE: Readonly<Record<string, number>> = { 'star.fill': 1.294, 'heart.fill': 1.22, person: 1.098 }

/**
 * Where a symbol in text is drawn (Wave 6a): how far it advances the line, and the box its
 * ink fills, from `bottom` below the baseline up, as the iOS 27 simulator draws star.fill at
 * body and at large title (docs/parity/native/iphone18pro-text, textImage). A symbol not
 * measured there advances as star.fill does for its width.
 */
export function inlineSymbolBox(symbol: string, size: number): { readonly advance: number; readonly height: number; readonly bottom: number } {
  return { advance: size * (INLINE_ADVANCE[symbol] ?? symbolMetrics(symbol).widthEm * 1.097), height: size * 1.025, bottom: size * 0.122 }
}
