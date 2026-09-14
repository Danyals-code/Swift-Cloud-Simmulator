import type { FilterSpec, Fill, ResolvedFont, RGBA, ShapeKind, SourceSpan } from '@studio/shared'

/**
 * The layout engine's input.
 *
 * Deliberately *not* the SwiftUI view tree: this package must stay free of any
 * SwiftUI knowledge (it may not even import `swiftui-runtime` - the dependency
 * points the other way). It describes only what layout needs - how a thing sizes
 * itself and what it paints - so the engine can be tested with hand-built trees and
 * reused for anything with the same layout model.
 */

export interface EdgeInsets {
  readonly top: number
  readonly leading: number
  readonly bottom: number
  readonly trailing: number
}

export const ZERO_INSETS: EdgeInsets = { top: 0, leading: 0, bottom: 0, trailing: 0 }

export type Axis = 'vertical' | 'horizontal'

export type HorizontalAlignment = 'leading' | 'center' | 'trailing'
export type VerticalAlignment = 'top' | 'center' | 'bottom'

export interface Alignment {
  readonly horizontal: HorizontalAlignment
  readonly vertical: VerticalAlignment
}

export const CENTER: Alignment = { horizontal: 'center', vertical: 'center' }

export type LayoutElement =
  | StackElement
  | ZStackElement
  | TextElement
  | SpacerElement
  | ShapeElement
  | FillElement
  | ImageElement
  | ScrollElement
  | GridElement
  | TableElement
  | FirstFitElement
  | PathElement
  | PlaceholderElement
  | ModifiedElement
  | EmptyElement

interface ElementBase {
  /** Stable across re-renders; becomes the RenderNode id and drives DOM reuse. */
  readonly id: string
  readonly origin?: SourceSpan
  /**
   * What to call this in the inspector: `Text`, `VStack`, `Button`.
   *
   * Carried on the element rather than derived from `kind` because the layout kinds
   * are coarser than the views that produced them - a Button and a Text are both
   * `text` elements once styling is stripped away.
   */
  readonly debugName?: string
  /** Modifier names in source order, for the inspector readout. */
  readonly debugModifiers?: readonly string[]
}

export interface StackElement extends ElementBase {
  readonly kind: 'stack'
  readonly axis: Axis
  readonly spacing: number
  readonly alignment: Alignment
  readonly children: readonly LayoutElement[]
}

export interface ZStackElement extends ElementBase {
  readonly kind: 'zstack'
  readonly alignment: Alignment
  readonly children: readonly LayoutElement[]
}

export interface TextElement extends ElementBase {
  readonly kind: 'text'
  readonly text: string
}

/**
 * A `Spacer`.
 *
 * Greedy along the axis of its containing stack and zero across it. The axis is
 * stamped on by the stack that contains it, because a Spacer's behaviour genuinely
 * depends on its parent - the same view expands vertically in a `VStack` and
 * horizontally in an `HStack`.
 */
export interface SpacerElement extends ElementBase {
  readonly kind: 'spacer'
  readonly axis: Axis
  readonly minLength: number
}

/** `Rectangle`, `Circle`, and friends: greedy in both axes. */
export interface ShapeElement extends ElementBase {
  readonly kind: 'shape'
  readonly shape: ShapeKind
  readonly cornerRadius?: number
  /** `.fill(…)`; without one the shape takes the inherited foreground colour. */
  readonly fill?: Fill
  readonly stroke?: { readonly color: RGBA; readonly width: number }
}

/** A bare `Color` used as a view. Greedy in both axes, like a shape. */
export interface FillElement extends ElementBase {
  readonly kind: 'fill'
  readonly fill: Fill
}

/**
 * A symbol or asset image.
 *
 * Sized from the environment font unless `.resizable()` made it greedy, which is
 * exactly SwiftUI's rule: an `Image(systemName:)` is laid out as a glyph, and the
 * same image with `.resizable()` fills whatever it is offered.
 */
export interface ImageElement extends ElementBase {
  readonly kind: 'image'
  readonly glyph: string
  readonly resizable: boolean
  /** True when the glyph is a substitute for an SF Symbol we cannot ship (R2). */
  readonly approximated: boolean
}

/**
 * A scrolling container.
 *
 * The one element whose children are *not* siblings in the output: they are placed
 * inside it, in its coordinate space, so the browser can scroll them natively with
 * its own physics. Everything else in the render tree stays flat and absolute.
 */
export interface ScrollElement extends ElementBase {
  readonly kind: 'scroll'
  readonly axis: Axis
  readonly showsIndicators: boolean
  readonly content: LayoutElement
}

/**
 * `LazyVGrid` / `LazyHGrid`.
 *
 * Tracks are resolved against the available cross-axis extent, then children flow
 * into them in order. Adaptive tracks decide their own count from the width, which
 * is why this is a layout element rather than sugar over nested stacks.
 */
export interface GridElement extends ElementBase {
  readonly kind: 'grid'
  readonly axis: Axis
  readonly tracks: readonly GridTrack[]
  readonly spacing: number
  readonly trackSpacing: number
  readonly alignment: Alignment
  readonly children: readonly LayoutElement[]
}

export interface GridTrack {
  readonly kind: 'fixed' | 'flexible' | 'adaptive'
  /** Fixed size, or the minimum for flexible and adaptive tracks. */
  readonly size: number | null
}

/**
 * `Grid` - the two-dimensional form, where columns line up across rows.
 *
 * Distinct from `LazyVGrid`, which flows children into tracks in order. Here the
 * structure is declared: each row states its cells, and a column is as wide as its
 * widest cell in any row. That alignment across rows is the whole reason `Grid`
 * exists and the reason it cannot be expressed as nested stacks.
 */
export interface TableElement extends ElementBase {
  readonly kind: 'table'
  readonly rows: readonly (readonly LayoutElement[])[]
  readonly spacing: number
  readonly rowSpacing: number
  readonly alignment: Alignment
}

/**
 * `ViewThatFits` - the first child that fits the proposal, else the last.
 *
 * A genuine layout decision rather than sugar: which child is chosen depends on the
 * space offered, which is only known during the measure pass.
 */
export interface FirstFitElement extends ElementBase {
  readonly kind: 'firstFit'
  readonly axes: readonly Axis[]
  readonly children: readonly LayoutElement[]
}

/**
 * A vector path.
 *
 * Greedy like a shape, because a `Path`'s own coordinates are absolute within
 * whatever frame it is given - it does not scale to fit, and a path drawn outside its
 * frame is simply outside it, which is SwiftUI's behaviour too.
 */
export interface PathElement extends ElementBase {
  readonly kind: 'path'
  /** SVG path data, in the element's own coordinate space. */
  readonly d: string
  readonly fill: Fill | null
  readonly stroke: { readonly color: RGBA; readonly width: number } | null
  readonly fillRule: 'nonzero' | 'evenodd'
}

export interface PlaceholderElement extends ElementBase {
  readonly kind: 'placeholder'
  readonly feature: string
  readonly reason: string
}

export interface EmptyElement extends ElementBase {
  readonly kind: 'empty'
}

export interface ModifiedElement extends ElementBase {
  readonly kind: 'modified'
  readonly modifier: LayoutModifier
  readonly child: LayoutElement
}

/**
 * Modifiers wrap outward in source order.
 *
 * `Text(…).padding().background(c)` becomes `background(padding(Text))`, so the
 * background covers the padded area - while `.background(c).padding()` becomes
 * `padding(background(Text))` and the background covers only the text. Getting
 * Phase 3 gate 3 right falls out of this structure rather than needing a special
 * case, which is exactly why modifiers are nesting rather than a flat list.
 */
export type LayoutModifier =
  | { readonly kind: 'padding'; readonly insets: EdgeInsets }
  | {
      readonly kind: 'frame'
      readonly width?: number
      readonly height?: number
      readonly minWidth?: number
      readonly maxWidth?: number
      readonly minHeight?: number
      readonly maxHeight?: number
      readonly alignment: Alignment
    }
  | { readonly kind: 'background'; readonly content: LayoutElement }
  | { readonly kind: 'font'; readonly font: ResolvedFont }
  /** `.fontWeight` / `.bold` / `.italic`: adjust the inherited face, keep its size. */
  | {
      readonly kind: 'fontTrait'
      readonly weight?: number
      readonly italic?: boolean
      /** `.fontDesign(.rounded)` - the face changes, the metrics with it. */
      readonly family?: string
    }
  /** `.lineLimit`, `.multilineTextAlignment`, `.textCase` - inherited text policy. */
  | {
      readonly kind: 'textStyle'
      readonly lineLimit?: number | null
      readonly alignment?: TextAlign
      readonly textCase?: 'upper' | 'lower' | null
    }
  | { readonly kind: 'foregroundStyle'; readonly color: RGBA }
  | { readonly kind: 'opacity'; readonly value: number }
  | { readonly kind: 'cornerRadius'; readonly radius: number }
  | { readonly kind: 'overlay'; readonly content: LayoutElement; readonly alignment: Alignment }
  | {
      readonly kind: 'border'
      readonly color: RGBA
      readonly width: number
      readonly cornerRadius?: number
    }
  | {
      readonly kind: 'shadow'
      readonly color: RGBA
      readonly radius: number
      readonly x: number
      readonly y: number
    }
  | { readonly kind: 'offset'; readonly x: number; readonly y: number }
  /** `.position(x:y:)` - the child's *centre* goes here, in the parent's space. */
  | { readonly kind: 'position'; readonly x: number; readonly y: number }
  /**
   * `.aspectRatio(_:contentMode:)`, and `.scaledToFit` / `.scaledToFill` which are
   * its two named forms. `ratio` null means "keep the child's own ratio".
   */
  | {
      readonly kind: 'aspectRatio'
      readonly ratio: number | null
      readonly mode: 'fit' | 'fill'
    }
  /** `.layoutPriority` - read by the enclosing stack, not applied here. */
  | { readonly kind: 'layoutPriority'; readonly value: number }
  /**
   * A container that reports its resolved geometry.
   *
   * How `GeometryReader` works: the element emits a real box, its children are
   * positioned inside it - which is also `GeometryReader`'s coordinate space - and
   * the pipeline reads the box's size back out to feed the next evaluation.
   */
  | { readonly kind: 'geometry'; readonly key: string }
  /** `.fixedSize()` - take the ideal size and ignore the proposal on that axis. */
  | { readonly kind: 'fixedSize'; readonly horizontal: boolean; readonly vertical: boolean }
  | { readonly kind: 'clip'; readonly shape: ShapeKind; readonly cornerRadius: number }
  | { readonly kind: 'scale'; readonly x: number; readonly y: number }
  | { readonly kind: 'rotate'; readonly degrees: number }
  | { readonly kind: 'zIndex'; readonly value: number }
  /** `.blur`, `.saturation`, `.brightness`, `.contrast`, `.grayscale`. */
  | { readonly kind: 'filter'; readonly filter: FilterSpec }
  /** `.background(.regularMaterial)` - a translucent, blurred backdrop. */
  | {
      readonly kind: 'material'
      readonly opacity: number
      readonly blur: number
      readonly light: boolean
    }
  /** `.allowsHitTesting(false)` - the subtree stops receiving events. */
  | { readonly kind: 'hitTestable'; readonly enabled: boolean }
  /** `.accessibilityLabel` and friends, which change what assistive tech reads. */
  | {
      readonly kind: 'a11y'
      readonly label?: string
      readonly value?: string
      readonly hint?: string
      readonly hidden?: boolean
    }
  /** Carried through to the renderer, which animates the change with CSS. */
  | { readonly kind: 'animate'; readonly hint: AnimationHint }
  /** `.transition(…)` - how this subtree animates in when it first appears. */
  | { readonly kind: 'transition'; readonly spec: TransitionHint }
  | {
      readonly kind: 'hitTarget'
      readonly handlerId: string
      readonly label: string
      readonly role: HitRole
      readonly enabled: boolean
      /**
       * Control parameters the renderer needs to build a real DOM control.
       *
       * A text field has to be an `<input>` for a caret and an IME to work at all,
       * and a slider has to be a range input for drag and keyboard control. Painting
       * a picture of one and catching clicks would look right and behave wrong.
       */
      readonly value?: string
      readonly placeholder?: string
      readonly min?: number
      readonly max?: number
    }
  /** A modifier outside the coverage matrix: recorded, ignored for layout. */
  | { readonly kind: 'unsupported'; readonly name: string }

export type HitRole = 'button' | 'toggle' | 'textField' | 'slider' | 'tapGesture' | 'drag'

export type TextAlign = 'leading' | 'center' | 'trailing'

/**
 * What the renderer should animate, and how.
 *
 * Produced by `.animation(_:value:)` and by `withAnimation`. The engine does not
 * animate anything itself - it computes one static frame per state - so this travels
 * to the DOM, where a CSS transition interpolates between consecutive frames. That
 * is the honest division: we are exact about where things end up and approximate
 * about how they get there.
 */
export interface AnimationHint {
  readonly curve: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring'
  readonly duration: number
  readonly delay?: number
  readonly bounce?: number
}

export interface TransitionHint {
  readonly kind: 'opacity' | 'slide' | 'scale' | 'move'
  readonly edge?: 'top' | 'bottom' | 'leading' | 'trailing'
  readonly duration: number
}

/**
 * Values inherited down the tree.
 *
 * `.font()` and `.foregroundStyle()` are not layout operations - they set an
 * environment that `Text` reads when it measures and paints itself. Modelling them
 * as inherited state rather than as wrappers is what makes
 * `VStack { Text(…) }.font(.largeTitle)` size its text correctly.
 */
export interface LayoutEnvironment {
  readonly font: ResolvedFont
  readonly foregroundColor: RGBA
  readonly opacity: number
  /**
   * Inherited corner radius.
   *
   * `.background(Color.red).cornerRadius(8)` puts the radius *outside* the
   * background, so it has to travel inward to reach the fill it rounds - the same
   * direction as font and colour, and for the same reason.
   */
  readonly cornerRadius: number
  /**
   * The animation in force for this subtree.
   *
   * Inherited like font and colour, because `.animation(_:value:)` applies to
   * everything below the view it is written on - including views the modifier's own
   * frame does not contain, such as a background's fill.
   */
  readonly animation?: AnimationHint
  /** Inherited: `.transition` on a container applies to what appears inside it. */
  readonly transition?: TransitionHint
  /**
   * A weight or slant set independently of the face.
   *
   * Remembered apart from `font` so it survives a later `.font()`, which replaces the
   * face wholesale. These are the only two font properties SwiftUI lets you set on
   * their own, which is why there are two fields rather than a general mechanism.
   */
  readonly fontWeight?: number
  readonly fontItalic?: boolean
  /** An inherited `.fontDesign`, kept apart from the font so `.font` does not reset it. */
  readonly fontFamily?: string
  /**
   * Text policy, inherited like the font.
   *
   * `.lineLimit(2)` on a `VStack` applies to every `Text` inside it, which is only
   * expressible as environment - a wrapper would apply to the stack's own frame and
   * nothing would read it.
   */
  readonly lineLimit?: number | null
  readonly textAlign?: TextAlign
  readonly textCase?: 'upper' | 'lower' | null
  /** Set by `.allowsHitTesting(false)`: the subtree paints but does not respond. */
  readonly hitTestingDisabled?: boolean
}

export function childEnvironment(
  env: LayoutEnvironment,
  modifier: LayoutModifier,
): LayoutEnvironment {
  switch (modifier.kind) {
    // `.font` replaces the face; `.fontWeight` and `.italic` adjust whichever face
    // is in force. Because modifiers are applied outward-in, the two can arrive in
    // either order - so the adjustment is remembered separately and re-applied when
    // a new face is set. Without that, `.font(.title).fontWeight(.semibold)` would
    // silently lose the weight, which is the order most SwiftUI is written in.
    case 'font':
      return {
        ...env,
        font: {
          ...modifier.font,
          ...(env.fontWeight !== undefined ? { weight: env.fontWeight } : {}),
          ...(env.fontItalic !== undefined ? { italic: env.fontItalic } : {}),
          // A `.fontDesign` above this `.font` still applies: in SwiftUI the design is
          // inherited separately from the size, so setting one must not reset the other.
          ...(env.fontFamily !== undefined ? { family: env.fontFamily } : {}),
        },
      }
    case 'fontTrait':
      return {
        ...env,
        ...(modifier.weight !== undefined ? { fontWeight: modifier.weight } : {}),
        ...(modifier.italic !== undefined ? { fontItalic: modifier.italic } : {}),
        ...(modifier.family !== undefined ? { fontFamily: modifier.family } : {}),
        font: {
          ...env.font,
          ...(modifier.weight !== undefined ? { weight: modifier.weight } : {}),
          ...(modifier.italic !== undefined ? { italic: modifier.italic } : {}),
          ...(modifier.family !== undefined ? { family: modifier.family } : {}),
        },
      }
    case 'foregroundStyle':
      return { ...env, foregroundColor: modifier.color }
    case 'opacity':
      return { ...env, opacity: env.opacity * modifier.value }
    case 'cornerRadius':
      return { ...env, cornerRadius: modifier.radius }
    case 'clip':
      return { ...env, cornerRadius: modifier.cornerRadius }
    case 'animate':
      return { ...env, animation: modifier.hint }
    case 'transition':
      return { ...env, transition: modifier.spec }
    case 'textStyle':
      return {
        ...env,
        ...(modifier.lineLimit !== undefined ? { lineLimit: modifier.lineLimit } : {}),
        ...(modifier.alignment !== undefined ? { textAlign: modifier.alignment } : {}),
        ...(modifier.textCase !== undefined ? { textCase: modifier.textCase } : {}),
      }
    default:
      return env
  }
}

export function insets(
  top: number,
  leading: number,
  bottom: number,
  trailing: number,
): EdgeInsets {
  return { top, leading, bottom, trailing }
}

export function uniformInsets(length: number): EdgeInsets {
  return { top: length, leading: length, bottom: length, trailing: length }
}
