import type { CornerStyle, ShapeStroke, SliderPayload, FilterSpec, Fill, ResolvedFont, RGBA, ShapeKind, Size, SourceSpan } from '@studio/shared'

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
export type VerticalAlignment = 'top' | 'center' | 'bottom' | 'firstTextBaseline' | 'lastTextBaseline'

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
  | SliderElement
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
  readonly preferredSpacing?: EdgeInsets
  readonly pixelAligned?: boolean
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
  /** null asks for pair-specific automatic spacing. */
  readonly spacing: number | null
  readonly alignment: Alignment
  readonly children: readonly LayoutElement[]
}

export interface ZStackElement extends ElementBase {
  readonly kind: 'zstack'
  readonly alignment: Alignment
  readonly children: readonly LayoutElement[]
}

/**
 * One span of a `Text`, with whatever that span set for itself.
 *
 * Every field is an *override* on the inherited environment, so a run that sets
 * nothing renders identically to the plain text it replaced. That is what lets
 * `Text("a").bold() + Text("b")` bold only its first half while both halves keep the
 * size and colour their surroundings gave them.
 */
export interface TextRunSpec {
  readonly text: string
  /** Absent fields inherit; `size` recomputes the line height from the metrics. */
  readonly font?: {
    readonly family?: string
    readonly size?: number
    readonly lineHeight?: number
    readonly weight?: number
    readonly italic?: boolean
  }
  readonly color?: RGBA
  readonly underline?: boolean
  readonly strikethrough?: boolean
  readonly tracking?: number
  readonly baselineOffset?: number
}

export interface TextElement extends ElementBase {
  readonly kind: 'text'
  /** The whole string: what `.textCase` transforms, and the accessible label. */
  readonly text: string
  /**
   * The attributed spans, when there is more than one.
   *
   * Absent for the overwhelmingly common single-run `Text`, which then measures and
   * paints from `text` and the environment alone - no per-run allocation on the path
   * every label in every app goes down.
   */
  readonly runs?: readonly TextRunSpec[]
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
  readonly cornerStyle?: CornerStyle
  readonly kind: 'shape'
  readonly shape: ShapeKind
  readonly cornerRadius?: number
  /** `.fill(…)`; without one the shape takes the inherited foreground colour. */
  readonly fill?: Fill
  readonly stroke?: ShapeStroke
}

export interface SliderElement extends ElementBase {
  readonly kind: 'slider'
  readonly height: number
  readonly style: SliderPayload
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
  /**
   * The SF Symbol name, when there is one.
   *
   * Carried rather than parsed back out of `debugName`, which is a display string
   * (`Image(systemName: "star.fill")`) and would have to be unquoted by whoever
   * needed the name. The renderer needs it to pick a drawn shape, and the
   * framework's own chevrons have no `debugName` at all.
   */
  readonly symbol?: string
  readonly symbolScale?: number
}

/**
 * A scrolling container.
 *
 * The one element whose children are *not* siblings in the output: they are placed
 * inside it, in its coordinate space, so the browser can scroll them natively with
 * its own physics. Everything else in the render tree stays flat and absolute.
 */
export interface ScrollElement extends ElementBase {
  readonly contentInsets?: EdgeInsets
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
  /**
   * `.lineLimit`, `.multilineTextAlignment`, `.textCase` and the text attributes -
   * inherited text policy.
   *
   * The attributes belong here rather than on `Text` because in SwiftUI they are
   * View modifiers: `VStack { Text(…) }.underline()` underlines the text inside it.
   * A wrapper around the stack would have nothing to draw on.
   */
  | {
      readonly kind: 'textStyle'
      readonly lineLimit?: number | null
      readonly alignment?: TextAlign
      readonly textCase?: 'upper' | 'lower' | null
      readonly underline?: boolean
      readonly strikethrough?: boolean
      readonly tracking?: number
      readonly baselineOffset?: number
      readonly lineSpacing?: number
      /** `.minimumScaleFactor` - the smallest fraction of the font size text may shrink to. */
      readonly minimumScale?: number
      /** `.truncationMode` - which end of an over-long line the ellipsis replaces. */
      readonly truncation?: 'head' | 'middle' | 'tail'
      /** `.allowsTightening` - letters may be drawn closer together to avoid a break. */
      readonly allowsTightening?: boolean
      /** `.lineLimit(2...4)` - the floor, reserved even when the text is shorter. */
      readonly minimumLines?: number
      /** `.monospacedDigit` - every digit takes the widest one's advance. */
      readonly tabularNumbers?: boolean
    }
  | { readonly kind: 'foregroundStyle'; readonly color: RGBA }
  | { readonly kind: 'opacity'; readonly value: number }
  | { readonly kind: 'cornerRadius'; readonly radius: number; readonly style?: CornerStyle }
  | { readonly kind: 'square' }
  | { readonly kind: 'inputFrame'; readonly minHeight: number; readonly paddingY: number }
  | { readonly kind: 'controlFont'; readonly font: ResolvedFont }
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
  | { readonly kind: 'clip'; readonly shape: ShapeKind; readonly cornerRadius: number; readonly style?: CornerStyle }
  | { readonly kind: 'scale'; readonly x: number; readonly y: number }
  | { readonly kind: 'rotate'; readonly degrees: number }
  /** `.rotation3DEffect(_:axis:)` - the same paint-time transform, about an axis. */
  | {
      readonly kind: 'rotate3D'
      readonly degrees: number
      readonly x: number
      readonly y: number
      readonly z: number
    }
  /**
   * `.alignmentGuide(_:computeValue:)` - where this view's guide actually sits.
   *
   * A *function* rather than a number, because the closure is the user's and takes
   * the view's own dimensions - which are not known until it has been measured. It
   * runs in the interpreter; the engine only calls it, which is why this is the one
   * place `swiftui-layout` holds something that is not plain data.
   */
  | {
      readonly kind: 'alignmentGuide'
      /** `leading`, `center`, `trailing`, `top`, `bottom`, `firstTextBaseline`, ... */
      readonly guide: string
      readonly compute: (size: Size) => number
    }
  /**
   * `.safeAreaInset(edge:)` - content pinned to an edge, insetting what it covers.
   *
   * Not an overlay: the child is offered the space that is left, which is the whole
   * difference and the reason a toolbar drawn this way does not cover the last row.
   */
  | {
      readonly kind: 'safeAreaInset'
      readonly edge: 'top' | 'bottom' | 'leading' | 'trailing'
      readonly content: LayoutElement
      readonly spacing: number
    }
  /**
   * A fraction of the width the parent offered.
   *
   * What a determinate `ProgressView` or `Gauge` fill is, and the one shape of frame
   * `.frame(width:)` cannot express: the bar has no width of its own until the row it
   * sits in has one. Drawn instead by scaling the fill horizontally, which put a 40%
   * bar in the middle of its track - CSS scales about the centre - and squashed the
   * rounded cap at its end while it was there.
   */
  | { readonly kind: 'relativeWidth'; readonly fraction: number }
  /** `.containerRelativeFrame(_:)` - take the container's full size along an axis. */
  | {
      readonly kind: 'containerRelativeFrame'
      readonly horizontal: boolean
      readonly vertical: boolean
      readonly count: number
      readonly spacing: number
    }
  /** `.blendMode` - how the subtree composites with what is under it. */
  | { readonly kind: 'blendMode'; readonly mode: string }
  /** `.redacted(reason:)` - draw the shape of the content, not the content. */
  | { readonly kind: 'redacted' }
  /** `.unredacted()` - the subtree is drawn for real inside a redacted one. */
  | { readonly kind: 'unredacted' }
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
      readonly step?: number
      readonly secure?: boolean
      readonly inputInset?: number
      readonly thumbDiameter?: number
      readonly cornerRadius?: number
      readonly placeholderColor?: RGBA
      readonly color?: RGBA
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
  readonly fontExplicit?: boolean
  readonly cornerStyle?: CornerStyle
  readonly displayScale?: number
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
  /**
   * Text attributes, inherited on the same rule as the font.
   *
   * `tracking` and `lineSpacing` are the two that change *measurement* - the first
   * widens every cluster, the second the line box - so both are read by the metrics
   * pass rather than only by the painter.
   */
  readonly underline?: boolean
  readonly strikethrough?: boolean
  readonly tracking?: number
  readonly baselineOffset?: number
  readonly lineSpacing?: number
  /**
   * `.minimumScaleFactor` and `.truncationMode` - the two that ask measurement to
   * answer back rather than to record something.
   *
   * Shrinking has to re-measure at a smaller size until the text fits, and truncating
   * has to know which end to cut. Neither is expressible as a paint attribute, which
   * is why they sat out the first text pass.
   */
  readonly minimumScale?: number
  readonly truncation?: 'head' | 'middle' | 'tail'
  readonly allowsTightening?: boolean
  readonly minimumLines?: number
  readonly tabularNumbers?: boolean
  /** Set by `.allowsHitTesting(false)`: the subtree paints but does not respond. */
  readonly hitTestingDisabled?: boolean
  /**
   * `.blendMode` and `.redacted` - paint facts that apply to everything below.
   *
   * Inherited rather than wrapped, because both describe how the *content* is drawn:
   * a box around the subtree would composite or redact the box, not what is in it.
   */
  readonly blendMode?: string
  readonly redacted?: boolean
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
    case 'controlFont':
      return env.fontExplicit ? env : { ...env, font: { ...modifier.font, weight: env.fontWeight ?? modifier.font.weight, italic: env.fontItalic ?? modifier.font.italic, family: env.fontFamily ?? modifier.font.family } }
    case 'font':
      return {
        ...env,
        fontExplicit: true,
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
      return { ...env, cornerRadius: modifier.radius, cornerStyle: modifier.style ?? env.cornerStyle }
    case 'clip':
      return { ...env, cornerRadius: modifier.cornerRadius }
    case 'animate':
      return { ...env, animation: modifier.hint }
    case 'transition':
      return { ...env, transition: modifier.spec }
    case 'blendMode':
      return { ...env, blendMode: modifier.mode }
    case 'redacted':
      return { ...env, redacted: true }
    case 'unredacted':
      return { ...env, redacted: false }
    case 'textStyle':
      return {
        ...env,
        ...(modifier.lineLimit !== undefined ? { lineLimit: modifier.lineLimit } : {}),
        ...(modifier.alignment !== undefined ? { textAlign: modifier.alignment } : {}),
        ...(modifier.textCase !== undefined ? { textCase: modifier.textCase } : {}),
        ...(modifier.underline !== undefined ? { underline: modifier.underline } : {}),
        ...(modifier.strikethrough !== undefined
          ? { strikethrough: modifier.strikethrough }
          : {}),
        ...(modifier.tracking !== undefined ? { tracking: modifier.tracking } : {}),
        ...(modifier.baselineOffset !== undefined
          ? { baselineOffset: modifier.baselineOffset }
          : {}),
        ...(modifier.lineSpacing !== undefined ? { lineSpacing: modifier.lineSpacing } : {}),
        ...(modifier.minimumScale !== undefined ? { minimumScale: modifier.minimumScale } : {}),
        ...(modifier.truncation !== undefined ? { truncation: modifier.truncation } : {}),
        ...(modifier.allowsTightening !== undefined
          ? { allowsTightening: modifier.allowsTightening }
          : {}),
        ...(modifier.minimumLines !== undefined ? { minimumLines: modifier.minimumLines } : {}),
        ...(modifier.tabularNumbers !== undefined
          ? { tabularNumbers: modifier.tabularNumbers }
          : {}),
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
