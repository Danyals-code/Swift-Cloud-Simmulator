import type { CornerRadii } from './render-tree'
import type { SourceSpan } from './source'

/**
 * A view's layer, as Figma's right panel describes one: its layout, fill, corners,
 * stroke, text and effects, each one value however the modifiers that make it are
 * written.
 *
 * The modifier stack is still the code. The layer is a reading of it: a padding run
 * `.padding(.horizontal, 16).padding(.vertical, 8)` is one inset value, a frame before
 * the background is the layer's size and one after it the room around it. A change to
 * a layer value is written back as the plainest Swift that says it, in the place a
 * SwiftUI developer would put it, and every modifier the reading did not claim stays
 * exactly where and as it was.
 */

/** A length in points, or a token's expression kept as written: `Layout.padding`, `.space16`. */
export type Length = number | { readonly token: string }

/**
 * How a value is written: not at all, as a literal the panel rewrites, through a token
 * the panel keeps linked, or in code the panel shows but leaves to Code.
 */
export type LayerState = 'absent' | 'literal' | 'token' | 'code'

export interface LayerValue<T> {
  readonly value: T
  readonly state: LayerState
  /** The modifiers it was read from, by `AuthoringModifier.id`, in chain order. */
  readonly from?: readonly string[]
  /** Set when the value is shown but cannot be changed here, in the words the panel shows. */
  readonly disabledReason?: string
}

export type Alignment9 = 'topLeading' | 'top' | 'topTrailing' | 'leading' | 'center' | 'trailing' | 'bottomLeading' | 'bottom' | 'bottomTrailing'

export type VerticalSide = 'top' | 'center' | 'bottom'
export type HorizontalSide = 'leading' | 'center' | 'trailing'

/** An alignment's two sides: `.bottomTrailing` is bottom and trailing. */
export function alignmentSides(alignment: Alignment9): readonly [VerticalSide, HorizontalSide] {
  const vertical: VerticalSide = alignment.startsWith('top') ? 'top' : alignment.startsWith('bottom') ? 'bottom' : 'center'
  const horizontal: HorizontalSide = /leading/i.test(alignment) ? 'leading' : /trailing/i.test(alignment) ? 'trailing' : 'center'
  return [vertical, horizontal]
}

/** The alignment with these two sides. */
export function alignmentOf(vertical: VerticalSide, horizontal: HorizontalSide): Alignment9 {
  if (vertical === 'center') return horizontal
  return horizontal === 'center' ? vertical : `${vertical}${horizontal === 'leading' ? 'Leading' : 'Trailing'}`
}

export interface Insets {
  readonly top: Length
  readonly leading: Length
  readonly bottom: Length
  readonly trailing: Length
}

/** How far a layer is drawn from where it is laid out, in points: `.offset(x:y:)`. */
export interface Offset {
  readonly x: Length
  readonly y: Length
}

/** One axis of a layer's size, as Figma names it: Hug its content, Fill the room, or a Fixed size. */
export interface AxisSize {
  readonly mode: 'hug' | 'fill' | 'fixed'
  /** Fixed only. */
  readonly size?: Length
  /** Hug and Fill only. */
  readonly min?: Length
  /** Hug and Fill only. On Hug, a cap: the content's size up to this much. */
  readonly max?: Length
}

export interface LayerLayout {
  readonly width: LayerValue<AxisSize>
  readonly height: LayerValue<AxisSize>
  /** Where the content sits inside a size larger than it: the frame's alignment. */
  readonly alignment: LayerValue<Alignment9 | null>
  /** Space inside the fill, between it and the content. */
  readonly padding: LayerValue<Insets | null>
  /** Space outside the fill, between it and the views around. Only a layer with a fill has one. */
  readonly margin: LayerValue<Insets | null>
  /** Where it is drawn, moved from where it is laid out, without moving the views around it. */
  readonly offset: LayerValue<Offset | null>
  /** In an Overlap with a size: the corner or edge the layer is pinned to. */
  readonly pin: LayerValue<Alignment9 | null>
  readonly context: {
    readonly parent: 'column' | 'row' | 'overlap' | 'other'
    /** The layer is a Button's label, or a Button whose label it sizes. */
    readonly inButton: boolean
    /** Something paints the layer's surface (a fill, clip, stroke, glass or shadow), so it has a margin outside it. */
    readonly surface: boolean
  }
}

/**
 * A colour as the panel takes it: a system name (`red`, `systemGray6`, `tertiary`), a hex
 * (`#RRGGBB`, or `#RRGGBBAA` with its alpha), or a token's expression as written
 * (`Theme.accent`, `.brand`, `Color("Brand")`), with its opacity from 0 to 1.
 */
export type ColorValue = ({ readonly name: string } | { readonly hex: string } | { readonly token: string }) & { readonly opacity?: number }

export interface UnitPoint { readonly x: number; readonly y: number }

export type FillValue =
  | { readonly kind: 'color'; readonly color: ColorValue }
  | {
      readonly kind: 'gradient'
      readonly type: 'linear' | 'radial' | 'angular'
      readonly stops: readonly { readonly color: ColorValue; readonly location: number }[]
      /** Linear: degrees clockwise from the top, as Figma measures it. */
      readonly angle?: number
      readonly center?: UnitPoint
      readonly startRadius?: number
      readonly endRadius?: number
      /** A colour's own gradient, `.red.gradient` (iOS 16): one stop, which SwiftUI shades itself. */
      readonly automatic?: boolean
    }
  | { readonly kind: 'material'; readonly thickness: 'ultraThin' | 'thin' | 'regular' | 'thick' | 'ultraThick' }
  | { readonly kind: 'glass'; readonly variant: 'regular' | 'clear'; readonly tint?: ColorValue; readonly interactive?: boolean }

/** A layer's fill, and the kinds of fill it cannot take here, each with the reason the panel shows. */
export interface LayerFill extends LayerValue<FillValue | null> {
  readonly unavailable?: Readonly<Partial<Record<FillValue['kind'], string>>>
}

export interface CornersValue {
  readonly shape: 'rect' | 'rounded' | 'uneven' | 'capsule' | 'circle'
  readonly radius?: Length
  /** Uneven: each corner's radius, named as the preview's `CornerRadii` names them. */
  readonly radii?: { readonly [Corner in keyof CornerRadii]: Length }
  /**
   * The squircle Apple's own corners use, `style: .continuous`: SwiftUI's default in the
   * Xcode 27 SDK, so only `false` is written, as `style: .circular`.
   */
  readonly continuous?: boolean
}

export interface StrokeValue {
  readonly color: ColorValue
  /** A token only on a shape's own stroke; a border's width is a number of points. */
  readonly width: Length
  /** Inside the edge, as a border is, centred on it, as a shape's stroke is, or outside it. */
  readonly position: 'inside' | 'center' | 'outside'
  /** Lengths of dash and gap, in points, as `StrokeStyle(dash:)` takes them. */
  readonly dash?: readonly number[]
}

/** A text's font, as Figma's type controls set it. */
export interface FontValue {
  /** A text style, or null for a size in points. */
  readonly style: string | null
  /** Points, where `style` is null. */
  readonly size?: number
  /**
   * With a size in points: the text style whose Dynamic Type curve it follows, written as
   * an `@ScaledMetric(relativeTo:)` property, or null for a size that stays fixed.
   */
  readonly relativeTo?: string | null
  readonly weight?: string
  readonly design?: string
  readonly italic?: boolean
}

/**
 * A text's look. Each part is its own value, because one written in a way the panel
 * cannot rewrite, such as a custom font, leaves the others free to change.
 */
export interface LayerText {
  readonly font: LayerValue<FontValue>
  readonly color: LayerValue<ColorValue | null>
  readonly alignment: LayerValue<'leading' | 'center' | 'trailing' | null>
  /** Points between letters. */
  readonly tracking: LayerValue<number | null>
  /** Points between lines. */
  readonly lineSpacing: LayerValue<number | null>
  readonly textCase: LayerValue<'uppercase' | 'lowercase' | null>
  /** Why a size in points can't scale with the reader's text size here, such as below iOS 14, for the panel to say before a change. */
  readonly scalingUnavailable?: string
}

export type LayerSectionId = 'layout' | 'fill' | 'corners' | 'stroke' | 'text' | 'effects'

export interface LayerProperties {
  readonly layout: LayerLayout
  readonly fill?: LayerFill
  readonly corners?: LayerValue<CornersValue>
  readonly stroke?: LayerValue<StrokeValue | null>
  /** Text-bearing views only. */
  readonly text?: LayerText
  readonly effects: {
    readonly opacity: LayerValue<number>
    readonly blur: LayerValue<number | null>
  }
  /** Which section shows each modifier it read, by `AuthoringModifier.id`. The stack tags these. */
  readonly claimed: Readonly<Record<string, LayerSectionId>>
  /**
   * Why nothing new can be added to the chain, when something in it is not known well
   * enough to place a modifier around: existing values stay editable.
   */
  readonly locked?: string
  /** The chain's span, for the structural check of a layer change. */
  readonly chain?: SourceSpan
}

/**
 * One change from the panel. Only the fields given change; `null` takes a value away.
 * A `layer-set` operation carries several, written as one edit and one undo step.
 */
export type LayerChange =
  | {
      readonly section: 'layout'
      readonly width?: AxisSize
      readonly height?: AxisSize
      readonly alignment?: Alignment9 | null
      readonly padding?: Insets | null
      readonly margin?: Insets | null
      readonly offset?: Offset | null
      readonly pin?: Alignment9 | null
      /** The size the preview measured, which a switch to Fixed starts from. */
      readonly measured?: { readonly width: number; readonly height: number }
    }
  | { readonly section: 'fill'; readonly fill: FillValue | null }
  | { readonly section: 'corners'; readonly corners: CornersValue }
  | { readonly section: 'stroke'; readonly stroke: StrokeValue | null }
  | {
      readonly section: 'text'
      /** The font's parts that change; the rest stay as they are. */
      readonly font?: Partial<FontValue>
      readonly color?: ColorValue | null
      readonly alignment?: 'leading' | 'center' | 'trailing' | null
      readonly tracking?: number | null
      readonly lineSpacing?: number | null
      readonly textCase?: 'uppercase' | 'lowercase' | null
    }
  | { readonly section: 'effects'; readonly opacity?: number; readonly blur?: number | null }

export interface LayerSetOperation {
  readonly kind: 'layer-set'
  readonly changes: readonly LayerChange[]
}

/** The same insets on every side. */
export function evenInsets(length: Length): Insets {
  return { top: length, leading: length, bottom: length, trailing: length }
}

/** Two lengths are the same when both are the same number or the same token. */
export function sameLength(a: Length, b: Length): boolean {
  return typeof a === 'number' ? a === b : typeof b !== 'number' && a.token === b.token
}
