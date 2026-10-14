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

/**
 * A constant a value is read through, where it is declared (Wave 3b): what Edit at
 * declaration changes for every place that reads it.
 */
export interface TokenDeclaration {
  /** Its initialiser, which Edit at declaration rewrites; a shared style's `source` when the constant is one. */
  readonly span: SourceSpan
  /** Its name from anywhere, as `style-edit` takes it: `ContentView.rowSpacing`, `Layout.pad`, `CGFloat.space16`. */
  readonly name: string
  /** How many places in the project read it, this one among them. */
  readonly uses: number
}

/** A token's expression kept as written: `Layout.padding`, `.space16`, `rowSpacing`. */
export interface TokenLength {
  readonly token: string
}

/**
 * What a token a layer reads is declared as, when it is a constant the panel can read
 * (Wave 3b): its number, for a length, and where it is declared.
 */
export interface TokenValue {
  readonly value?: number
  /**
   * A length's initialiser as written where it is worked out in Swift, `8 * 2`, rather than a
   * number: shown with the token, with no value to change where it is declared.
   */
  readonly expression?: string
  readonly declaration: TokenDeclaration
}

/**
 * A value one condition chooses, `selected ? 16 : 8` (Wave 3b): the one when it is true,
 * and the other otherwise. Each is changed on its own, and the condition stays as written.
 */
export interface Conditional<T> {
  /** The condition, as written. */
  readonly condition: string
  readonly then: T
  readonly otherwise: T
}

/** A length in points, a token, or one of two a condition chooses between. */
export type Length = number | TokenLength | Conditional<number | TokenLength>

/** Whether a value is one a condition chooses (`Conditional`). */
export function isConditional<T>(value: T | Conditional<T> | null | undefined): value is Conditional<T> {
  return typeof value === 'object' && value !== null && 'condition' in value
}

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
  /** `when`: a colour one condition chooses (Wave 3b), `color` when it is true and `when.otherwise` when not. */
  | { readonly kind: 'color'; readonly color: ColorValue; readonly when?: { readonly condition: string; readonly otherwise: ColorValue } }
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
  /**
   * Null for a stroke with no colour written, `.stroke(lineWidth: 2)`, which SwiftUI draws
   * in the foreground style (Wave 3b): a change keeps it so until a colour is chosen.
   */
  readonly color: ColorValue | null
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
  /**
   * Set on a font read through a constant, `.font(.heading)` (Wave 3b): its name as written,
   * which the layer's `tokens` says more about. The rest is what it is declared as.
   */
  readonly token?: string
  /**
   * A custom face a font token is declared with, `Font.custom("Avenir", size: 20)` (Wave 3b):
   * shown with the token, read only, as the panel offers no custom faces.
   */
  readonly face?: string
}

/**
 * A drop shadow, as `.shadow(color:radius:x:y:)` draws one, in points; `color` is null for
 * SwiftUI's own, a translucent black. A shadow token, `.shadow(.card)`, stays linked.
 */
export type ShadowValue =
  | { readonly color: ColorValue | null; readonly radius: number; readonly x: number; readonly y: number }
  | { readonly token: string }

/**
 * A text's look. Each part is its own value, because one written in a way the panel
 * cannot rewrite, such as a custom font, leaves the others free to change.
 */
export interface LayerText {
  readonly font: LayerValue<FontValue>
  readonly color: LayerValue<ColorValue | Conditional<ColorValue> | null>
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
    readonly opacity: LayerValue<number | Conditional<number>>
    readonly blur: LayerValue<number | null>
    /** Always read; optional for layers made by hand, as tests make them. */
    readonly shadow?: LayerValue<ShadowValue | null>
  }
  /** Which section shows each modifier it read, by `AuthoringModifier.id`. The stack tags these. */
  readonly claimed: Readonly<Record<string, LayerSectionId>>
  /**
   * The constants its values read that the panel can say more about (Wave 3b), by each token
   * as written: what each is declared as and where, for its chip, Edit at declaration and Detach.
   */
  readonly tokens?: Readonly<Record<string, TokenValue>>
  /**
   * Why nothing new can be added to the chain, when something in it is not known well
   * enough to place a modifier around: existing values stay editable.
   */
  readonly locked?: string
  /** The chain's span, for the structural check of a layer change. */
  readonly chain?: SourceSpan
  /**
   * A run of texts joined with `+` (Wave 3a): only its Text section applies, as only the
   * modifiers that keep a Text a Text can be written on it.
   */
  readonly textRun?: true
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
      readonly color?: ColorValue | Conditional<ColorValue> | null
      readonly alignment?: 'leading' | 'center' | 'trailing' | null
      readonly tracking?: number | null
      readonly lineSpacing?: number | null
      readonly textCase?: 'uppercase' | 'lowercase' | null
    }
  | { readonly section: 'effects'; readonly opacity?: number | Conditional<number>; readonly blur?: number | null; readonly shadow?: ShadowValue | null }

export interface LayerSetOperation {
  readonly kind: 'layer-set'
  readonly changes: readonly LayerChange[]
}

/** The same insets on every side. */
export function evenInsets(length: Length): Insets {
  return { top: length, leading: length, bottom: length, trailing: length }
}

/** Two lengths are the same when both are the same number, the same token, or the same condition choosing between the same two. */
export function sameLength(a: Length, b: Length): boolean {
  if (typeof a === 'number' || typeof b === 'number') return a === b
  if (isConditional(a) || isConditional(b)) return isConditional(a) && isConditional(b) && a.condition === b.condition && sameLength(a.then, b.then) && sameLength(a.otherwise, b.otherwise)
  return a.token === b.token
}
