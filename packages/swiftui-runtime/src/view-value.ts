import type { ComponentSource, SourceSpan } from '@studio/shared'
import { describe, type ClosureValue, type FunctionValue, type SwiftValue } from '@studio/swift-runtime'

/** What a control runs: a closure, or a function named as a value - `Button("Save", action: save)`. */
export type ActionValue = ClosureValue | FunctionValue

/**
 * An evaluated view.
 *
 * The product of actually running the user's `body`, so every value here is real:
 * interpolations resolved, ternaries taken, numbers computed.
 *
 * Phase 6 adds two things to it, and both exist for the same reason - the framework
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
  /** A `Button`'s action - its `action:` argument or its trailing closure - kept to be run on tap. */
  readonly action: ActionValue | null
  readonly span: SourceSpan
  /** Source call sites survive component expansion without adding runtime nodes. */
  readonly componentSources?: readonly ComponentSource[]
  /**
   * Stable tree address, stamped by the presentation resolver.
   *
   * Everything downstream keys off this: element ids, handler ids, and DOM reuse.
   * Having exactly one traversal assign it is what stops a button's tap arriving at
   * a different view than the one that was drawn.
   */
  readonly path?: string
  /** Nearest context-menu owner; inherited so child controls retain both actions. */
  readonly contextMenuPath?: string
  /** Framework behaviour, for controls the user did not write an action for. */
  readonly intent?: ViewIntent
  /**
   * Per-child identity keys, set by `ForEach`.
   *
   * With `id:` or `Identifiable`, state follows the *element* rather than its
   * position - so reordering a list carries each row's `@State` with it, which is
   * the observable difference between keying by identity and keying by index.
   */
  readonly childKeys?: readonly string[]
  /**
   * The tag `ForEach` gives each of its rows: the row's id, a value of its own type.
   *
   * SwiftUI tags every row with its `id:` key path's value, or its `Identifiable.id`,
   * and a `Picker` or a `TabView` selects a row by it when it has the selection's type.
   */
  readonly implicitTag?: SwiftValue
  /**
   * The key a `GeometryReader` reports its resolved size under.
   *
   * Assigned by the host at the moment the reader's content is built, and used again
   * by the layout pass - so the size the proxy reported and the size the box actually
   * got are provably about the same reader.
   */
  readonly geometryKey?: string
  /**
   * How far this list row is swiped open, and the path its actions are keyed by.
   *
   * Set by the resolver for rows in a `ForEach` that has `.onDelete`, because the
   * row is what gets swiped while the modifier is written on its parent.
   */
  readonly swipe?: { readonly offset: number; readonly path: string }
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
  /** A `Stepper` press. `bounds` is its `in:` range, which the press may not leave. */
  | {
      readonly kind: 'adjust'
      readonly binding: SwiftValue
      readonly by: number
      readonly bounds?: { readonly min: number; readonly max: number }
    }
  | { readonly kind: 'run'; readonly action: ActionValue; readonly dismiss?: ViewIntent }
  /** A gesture attached with `.gesture(…)`; the event decides which handlers run. */
  | { readonly kind: 'gesture'; readonly gesture: SwiftValue }
  /** Dragging a list row sideways to reveal its actions. */
  | { readonly kind: 'swipe'; readonly row: string }
  /** Opening or closing a `DisclosureGroup`, which nothing in the user's code holds. */
  | { readonly kind: 'expand'; readonly group: string }
  /** Paging a `DatePicker`'s calendar, which changes what is shown and not the value. */
  | { readonly kind: 'stepMonth'; readonly control: string; readonly by: number }
  /** Showing a `Picker`'s or `Menu`'s options. Null closes whatever is open. */
  | { readonly kind: 'openMenu'; readonly menu: string | null }
  /** Choosing one of them: writes the selection and closes in one press. */
  | { readonly kind: 'choose'; readonly binding: SwiftValue; readonly value: SwiftValue }
  /** `.onDelete` - remove the row at this offset from the collection. */
  | { readonly kind: 'delete'; readonly action: ActionValue; readonly offset: number; readonly row: string }

export interface ViewArg {
  readonly label: string | null
  readonly value: SwiftValue
}

/**
 * A captured environment: the values and objects in scope at one point.
 *
 * Lives here rather than in `view-environment.ts` because a `ModifierValue` carries
 * one, and a modifier is the thing that outlives the scope it was written in.
 */
export interface EnvironmentFrame {
  readonly values: ReadonlyMap<string, SwiftValue>
  readonly objects: ReadonlyMap<string, SwiftValue>
}

export interface ModifierValue {
  readonly name: string
  readonly args: readonly ViewArg[]
  readonly span: SourceSpan
  /**
   * The modifier's trailing closure, unevaluated.
   *
   * `.sheet(isPresented:) { Detail(item: selected!) }` must not run its content while
   * the sheet is down - SwiftUI does not, and evaluating it eagerly would trap on
   * the force-unwrap for a screen nobody asked to see. So the closure travels here
   * and the resolver runs it only if and when the sheet is actually presented.
   */
  readonly closure: ClosureValue | null
  /**
   * What an event modifier runs - `.onAppear`, `.task`, `.onChange`, `.onDelete`,
   * `.onTapGesture`, `.onSubmit`: its trailing closure, or the closure or function its
   * `perform:`, `action:` or unlabelled argument names. Xcode's own template writes
   * `.onDelete(perform: deleteItems)`.
   */
  readonly action?: ActionValue
  /**
   * The environment in scope where the modifier was *written*.
   *
   * A deferred closure runs long after the expansion that declared it has unwound, so
   * without this a pushed `navigationDestination` or a presented `.sheet` saw an empty
   * environment - and `@EnvironmentObject var store: Store` on a detail screen trapped
   * with "Value of type 'Optional' has no member …". SwiftUI hands a destination the
   * environment of the place it was declared, and so does this.
   *
   * Held by reference rather than copied: `EnvironmentStack.scoped` replaces its maps
   * instead of mutating them, so the frame captured here cannot be written through.
   */
  readonly environment?: EnvironmentFrame
}

export const VIEW_TYPE = 'View'

/** A contextual member with no base: `.largeTitle`, `.primary`, `.infinity`. */
export const TOKEN_TYPE = 'Token'

export interface TokenPayload {
  /** Alpha for a material ShapeStyle, preserving its backdrop. */
  readonly opacity?: number
  readonly name: string
  /**
   * The arguments the contextual call was written with, where it had any.
   *
   * `.done("hi")` passed to a parameter of an enum type is a case *with a payload*,
   * and the token is all the interpreter has until the expected type says which enum
   * it belongs to. Dropping them here meant `case .done(let s)` matched and bound
   * nothing - the branch ran, `s` did not exist, and the failure named a variable
   * rather than the thing that lost it.
   *
   * Absent for every token the host makes for its own contextual members, which are
   * names rather than constructors.
   */
  readonly args?: readonly SwiftValue[]
}

/**
 * `ButtonStyleConfiguration`, as handed to a custom `ButtonStyle`.
 *
 * Opaque rather than a synthesised struct: it has exactly two members a preview can
 * supply, and declaring a type nothing else refers to would be more machinery than
 * the thing it models.
 */
export const BUTTON_CONFIGURATION_TYPE = 'ButtonStyleConfiguration'

export interface ButtonConfigurationPayload {
  /** Whatever the button was going to draw, as a view value. */
  readonly label: SwiftValue
  /** Always false here: the tree is built between interactions, never during one. */
  readonly isPressed: boolean
}

export const COLOR_TYPE = 'Color'

export interface ColorPayload {
  /** A named colour (`red`, `primary`), or null when built from components. */
  readonly name: string | null
  /** The name is a colour set in the project's asset catalog, as `Color("name")` reads. */
  readonly asset?: boolean
  readonly white?: number
  readonly red?: number
  readonly green?: number
  readonly blue?: number
  readonly opacity?: number
  /**
   * A brightness multiplier applied after the colour resolves.
   *
   * `Color.red.gradient` needs a darker red, and the name `red` does not become an
   * RGB triple until the style layer resolves it against the colour scheme - so the
   * shade travels with the colour rather than being computed where the name is still
   * a name.
   */
  readonly shade?: number
}

/** A gradient or material, carried as a value so it can be used as a style. */
export const STYLE_TYPE = 'ShapeStyle'

export interface GradientPayload {
  readonly opacity?: number
  readonly kind: 'linear' | 'radial' | 'angular'
  readonly center?: string | { x: number; y: number } | null
  readonly startRadius?: number
  readonly endRadius?: number
  readonly startAngle?: number
  readonly endAngle?: number
  readonly colors: readonly SwiftValue[]
  readonly stops?: readonly { color: SwiftValue; location: number }[]
  readonly startPoint: string | { x: number; y: number } | null
  readonly endPoint: string | { x: number; y: number } | null
}

/** A `GeometryProxy`, as `GeometryReader`'s closure receives it. */
export const GEOMETRY_TYPE = 'GeometryProxy'

/**
 * `ViewDimensions` - what an `.alignmentGuide` closure is handed.
 *
 * The view's own measured size, plus the default guides reachable by subscript. It
 * exists only for the length of that closure: the size is not known until the view
 * has been measured, and it is meaningless afterwards.
 */
export const DIMENSIONS_TYPE = 'ViewDimensions'

export interface GeometryPayload {
  readonly width: number
  readonly height: number
  /** Where the reader is on the screen, as `frame(in: .global)` reports it. */
  readonly x: number
  readonly y: number
  /** What `safeAreaInsets` reports. */
  readonly insets: EdgeInsetsPayload
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
  /**
   * What `.combined(with:)` added.
   *
   * Recorded rather than merged: `TransitionSpec` in the render tree carries one
   * kind, and giving it a list means the renderer animating several properties at
   * once - which belongs with the rest of the animation work, not with making the
   * value constructible. The preview draws `kind` and the coverage matrix says so.
   */
  readonly combinedWith?: readonly string[]
}

/** `EdgeInsets(top:leading:bottom:trailing:)`, as `.padding` takes it. */
export const EDGE_INSETS_TYPE = 'EdgeInsets'

export interface EdgeInsetsPayload {
  readonly top: number
  readonly leading: number
  readonly bottom: number
  readonly trailing: number
}

/** `StrokeStyle(lineWidth:lineCap:dash:)`, as `.stroke(style:)` takes it. */
export const STROKE_STYLE_TYPE = 'StrokeStyle'

export interface StrokeStylePayload {
  readonly lineWidth: number
  readonly lineCap: 'butt' | 'round' | 'square'
  readonly lineJoin: 'miter' | 'round' | 'bevel'
  readonly miterLimit: number
  readonly dashPhase: number
  readonly dash: readonly number[]
}

/** Wraps an evaluated view as a Swift value, so it can be passed to user code. */
export function asSwiftValue(v: ViewValue): SwiftValue {
  return { kind: 'opaque', typeName: VIEW_TYPE, payload: v }
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
 * Strings keep their quotes so `Text("5")` is visibly distinct from `Text(5)` -
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
 * its button's handler id cannot drift apart - which they would if each computed
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
