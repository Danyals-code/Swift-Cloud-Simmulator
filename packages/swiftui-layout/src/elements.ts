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
  | PlaceholderElement
  | ModifiedElement
  | EmptyElement

interface ElementBase {
  /** Stable across re-renders; becomes the RenderNode id and drives DOM reuse. */
  readonly id: string
  readonly origin?: SourceSpan
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
  | { readonly kind: 'foregroundStyle'; readonly color: RGBA }
  | { readonly kind: 'opacity'; readonly value: number }
  | { readonly kind: 'cornerRadius'; readonly radius: number }
  | { readonly kind: 'hitTarget'; readonly handlerId: string; readonly label: string }
  /** A modifier outside the coverage matrix: recorded, ignored for layout. */
  | { readonly kind: 'unsupported'; readonly name: string }

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
}

export function childEnvironment(
  env: LayoutEnvironment,
  modifier: LayoutModifier,
): LayoutEnvironment {
  switch (modifier.kind) {
    case 'font':
      return { ...env, font: modifier.font }
    case 'foregroundStyle':
      return { ...env, foregroundColor: modifier.color }
    case 'opacity':
      return { ...env, opacity: env.opacity * modifier.value }
    case 'cornerRadius':
      return { ...env, cornerRadius: modifier.radius }
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
