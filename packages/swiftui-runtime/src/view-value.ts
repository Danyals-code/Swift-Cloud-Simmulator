import type { SourceSpan } from '@studio/shared'
import { describe, type ClosureValue, type SwiftValue } from '@studio/swift-runtime'

/**
 * An evaluated view.
 *
 * The product of actually running the user's `body`, so every value here is real:
 * interpolations resolved, ternaries taken, numbers computed.
 *
 * Phase 6 adds two things to it, and both exist for the same reason — the framework
 * has behaviour of its own that is not in the user's code. `path` is the identity
 * every downstream stage addresses a view by, stamped once by the resolver so the
 * layout pass and the event table cannot disagree about which view is which.
 * `intent` is what a framework-owned control does when tapped: a back button pops,
 * a tab bar item selects. Neither can be a Swift closure, because the user never
 * wrote one.
 */
export interface ViewValue {
  readonly name: string
  readonly args: readonly ViewArg[]
  readonly children: readonly ViewValue[]
  readonly modifiers: readonly ModifierValue[]
  /** A `Button`'s trailing closure, kept to be run on tap. */
  readonly action: ClosureValue | null
  readonly span: SourceSpan
  /**
   * Stable tree address, stamped by the presentation resolver.
   *
   * Everything downstream keys off this: element ids, handler ids, and DOM reuse.
   * Having exactly one traversal assign it is what stops a button's tap arriving at
   * a different view than the one that was drawn.
   */
  readonly path?: string
  /** Framework behaviour, for controls the user did not write an action for. */
  readonly intent?: ViewIntent
  /**
   * Per-child identity keys, set by `ForEach`.
   *
   * With `id:` or `Identifiable`, state follows the *element* rather than its
   * position — so reordering a list carries each row's `@State` with it, which is
   * the observable difference between keying by identity and keying by index.
   */
  readonly childKeys?: readonly string[]
  /**
   * The key a `GeometryReader` reports its resolved size under.
   *
   * Assigned by the host at the moment the reader's content is built, and used again
   * by the layout pass — so the size the proxy reported and the size the box actually
   * got are provably about the same reader.
   */
  readonly geometryKey?: string
}

/**
 * What a framework-owned control does.
 *
 * Deliberately a small closed set rather than an arbitrary callback: these are
 * recorded in the view tree, which the inspector displays and the tests read.
 */
export type ViewIntent =
  | { readonly kind: 'push'; readonly link: string }
  | { readonly kind: 'pop' }
  | { readonly kind: 'selectTab'; readonly tab: string; readonly index: number }
  | { readonly kind: 'write'; readonly binding: SwiftValue; readonly value: SwiftValue }
  | { readonly kind: 'toggle'; readonly binding: SwiftValue }
  | { readonly kind: 'adjust'; readonly binding: SwiftValue; readonly by: number }
  | { readonly kind: 'run'; readonly closure: ClosureValue }

export interface ViewArg {
  readonly label: string | null
  readonly value: SwiftValue
}

export interface ModifierValue {
  readonly name: string
  readonly args: readonly ViewArg[]
  readonly span: SourceSpan
  /**
   * The modifier's trailing closure, unevaluated.
   *
   * `.sheet(isPresented:) { Detail(item: selected!) }` must not run its content while
   * the sheet is down — SwiftUI does not, and evaluating it eagerly would trap on
   * the force-unwrap for a screen nobody asked to see. So the closure travels here
   * and the resolver runs it only if and when the sheet is actually presented.
   */
  readonly closure: ClosureValue | null
}

export const VIEW_TYPE = 'View'

/** A contextual member with no base: `.largeTitle`, `.primary`, `.infinity`. */
export const TOKEN_TYPE = 'Token'

export interface TokenPayload {
  readonly name: string
}

export const COLOR_TYPE = 'Color'

export interface ColorPayload {
  /** A named colour (`red`, `primary`), or null when built from components. */
  readonly name: string | null
  readonly white?: number
  readonly red?: number
  readonly green?: number
  readonly blue?: number
  readonly opacity?: number
}

/** A gradient or material, carried as a value so it can be used as a style. */
export const STYLE_TYPE = 'ShapeStyle'

export interface GradientPayload {
  readonly kind: 'linear' | 'radial' | 'angular'
  readonly colors: readonly SwiftValue[]
  readonly startPoint: string | null
  readonly endPoint: string | null
}

/** A `GeometryProxy`, as `GeometryReader`'s closure receives it. */
export const GEOMETRY_TYPE = 'GeometryProxy'

export interface GeometryPayload {
  readonly width: number
  readonly height: number
}

/** An animation curve, as `.animation()` and `withAnimation` take it. */
export const ANIMATION_TYPE = 'Animation'

export interface AnimationPayload {
  readonly curve: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'spring'
  readonly duration: number
  /** Spring only; feeds the CSS easing approximation. */
  readonly bounce?: number
  readonly delay?: number
}

/** A transition, as `.transition()` takes it. */
export const TRANSITION_TYPE = 'Transition'

export interface TransitionPayload {
  readonly kind: 'opacity' | 'slide' | 'scale' | 'move' | 'identity'
  readonly edge?: string
}

export function isView(value: SwiftValue): value is SwiftValue & { payload: ViewValue } {
  return value.kind === 'opaque' && value.typeName === VIEW_TYPE
}

export function asView(value: SwiftValue): ViewValue | null {
  return isView(value) ? (value.payload as ViewValue) : null
}

export function payloadOf<T>(value: SwiftValue | undefined, typeName: string): T | null {
  if (!value || value.kind !== 'opaque' || value.typeName !== typeName) return null
  return value.payload as T
}

export function viewArgs(args: readonly ViewArg[]): string {
  return args
    .map((a) => (a.label ? `${a.label}: ${renderArg(a.value)}` : renderArg(a.value)))
    .join(', ')
}

/**
 * Renders an argument for display.
 *
 * Strings keep their quotes so `Text("5")` is visibly distinct from `Text(5)` —
 * which is the kind of confusion a preview should remove rather than create.
 */
export function renderArg(value: SwiftValue): string {
  if (value.kind === 'string') return `"${value.value}"`
  if (value.kind === 'opaque' && value.typeName === TOKEN_TYPE) {
    return `.${(value.payload as TokenPayload).name}`
  }
  if (value.kind === 'opaque' && value.typeName === COLOR_TYPE) {
    return describeColor(value.payload as ColorPayload)
  }
  if (value.kind === 'opaque' && value.typeName === VIEW_TYPE) {
    return (value.payload as ViewValue).name
  }
  if (value.kind === 'closure' || value.kind === 'function') return '{ … }'
  return describe(value, true)
}

export function describeColor(color: ColorPayload): string {
  const base = color.name ? `Color.${color.name}` : `Color(white: ${color.white ?? 0})`
  return color.opacity !== undefined ? `${base}.opacity(${color.opacity})` : base
}

export interface FlatView {
  readonly view: ViewValue
  readonly depth: number
  /** Stable tree path, e.g. `v-0-2`. Doubles as the row and handler id. */
  readonly path: string
}

/**
 * Flattens the tree depth-first, carrying depth for indentation and a path for
 * identity.
 *
 * The renderer and the action index both use this one traversal, so a row's id and
 * its button's handler id cannot drift apart — which they would if each computed
 * paths its own way.
 */
export function flattenViews(views: readonly ViewValue[], depth = 0, prefix = 'v'): FlatView[] {
  const out: FlatView[] = []
  views.forEach((view, index) => {
    const path = view.path ?? `${prefix}-${index}`
    out.push({ view, depth, path })
    out.push(...flattenViews(view.children, depth + 1, path))
  })
  return out
}

/** Handler id for the view at a given tree path. */
export function handlerIdFor(path: string): string {
  return `action-${path}`
}
