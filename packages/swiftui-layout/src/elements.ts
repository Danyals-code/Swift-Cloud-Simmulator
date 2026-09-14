import type { Fill, ResolvedFont, RGBA, ShapeKind, SourceSpan } from '@studio/shared'

/**
 * The layout engine's input.
 *
 * Deliberately *not* the SwiftUI view tree: this package must stay free of any
 * SwiftUI knowledge (it may not even import `swiftui-runtime` — the dependency
 * points the other way). It describes only what layout needs — how a thing sizes
 * itself and what it paints — so the engine can be tested with hand-built trees and
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
   * are coarser than the views that produced them — a Button and a Text are both
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
 * depends on its parent — the same view expands vertically in a `VStack` and
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
 * background covers the padded area — while `.background(c).padding()` becomes
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
  | { readonly kind: 'fontTrait'; readonly weight?: number; readonly italic?: boolean }
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
  /** `.fixedSize()` — take the ideal size and ignore the proposal on that axis. */
  | { readonly kind: 'fixedSize'; readonly horizontal: boolean; readonly vertical: boolean }
  | { readonly kind: 'clip'; readonly shape: ShapeKind; readonly cornerRadius: number }
  | { readonly kind: 'scale'; readonly x: number; readonly y: number }
  | { readonly kind: 'rotate'; readonly degrees: number }
  | { readonly kind: 'zIndex'; readonly value: number }
  /** Carried through to the renderer, which animates the change with CSS. */
  | { readonly kind: 'animate'; readonly hint: AnimationHint }
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

export type HitRole = 'button' | 'toggle' | 'textField' | 'slider' | 'tapGesture'

/**
 * What the renderer should animate, and how.
 *
 * Produced by `.animation(_:value:)` and by `withAnimation`. The engine does not
 * animate anything itself — it computes one static frame per state — so this travels
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

/**
 * Values inherited down the tree.
 *
 * `.font()` and `.foregroundStyle()` are not layout operations — they set an
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
   * background, so it has to travel inward to reach the fill it rounds — the same
   * direction as font and colour, and for the same reason.
   */
  readonly cornerRadius: number
  /**
   * The animation in force for this subtree.
   *
   * Inherited like font and colour, because `.animation(_:value:)` applies to
   * everything below the view it is written on — including views the modifier's own
   * frame does not contain, such as a background's fill.
   */
  readonly animation?: AnimationHint
  /**
   * A weight or slant set independently of the face.
   *
   * Remembered apart from `font` so it survives a later `.font()`, which replaces the
   * face wholesale. These are the only two font properties SwiftUI lets you set on
   * their own, which is why there are two fields rather than a general mechanism.
   */
  readonly fontWeight?: number
  readonly fontItalic?: boolean
}

export function childEnvironment(
  env: LayoutEnvironment,
  modifier: LayoutModifier,
): LayoutEnvironment {
  switch (modifier.kind) {
    // `.font` replaces the face; `.fontWeight` and `.italic` adjust whichever face
    // is in force. Because modifiers are applied outward-in, the two can arrive in
    // either order — so the adjustment is remembered separately and re-applied when
    // a new face is set. Without that, `.font(.title).fontWeight(.semibold)` would
    // silently lose the weight, which is the order most SwiftUI is written in.
    case 'font':
      return {
        ...env,
        font: {
          ...modifier.font,
          ...(env.fontWeight !== undefined ? { weight: env.fontWeight } : {}),
          ...(env.fontItalic !== undefined ? { italic: env.fontItalic } : {}),
        },
      }
    case 'fontTrait':
      return {
        ...env,
        ...(modifier.weight !== undefined ? { fontWeight: modifier.weight } : {}),
        ...(modifier.italic !== undefined ? { fontItalic: modifier.italic } : {}),
        font: {
          ...env.font,
          ...(modifier.weight !== undefined ? { weight: modifier.weight } : {}),
          ...(modifier.italic !== undefined ? { italic: modifier.italic } : {}),
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
