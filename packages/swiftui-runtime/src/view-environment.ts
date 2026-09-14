import { bool, int, opaque, str, type SwiftValue } from '@studio/swift-runtime'
import { TOKEN_TYPE } from './view-value'

/**
 * The SwiftUI environment.
 *
 * Two different things share the name, and keeping them apart matters:
 *
 * - **Environment values** - `\.colorScheme`, `\.dynamicTypeSize`, `\.locale`. Keyed
 *   by key-path name, supplied by the device and the preview controls.
 * - **Environment objects** - `@EnvironmentObject var store: Store`. Keyed by the
 *   *type* of the object, injected by an ancestor's `.environmentObject(store)`.
 *
 * **A known limitation, stated rather than hidden.** SwiftUI's environment flows to
 * every descendant. Ours flows to views expanded *while the modifier is in scope*,
 * which covers the idiom `Root().environmentObject(store)` - where the modifier is
 * applied to the view whose body has not run yet - and not the case where the
 * modifier sits above children that were already built. Views expand eagerly here,
 * and making them lazy is a larger change than this phase takes on. The coverage
 * matrix records it as 🟡 for exactly this reason.
 */

export const DISMISS_TYPE = 'DismissAction'

export interface EnvironmentFrame {
  readonly values: ReadonlyMap<string, SwiftValue>
  readonly objects: ReadonlyMap<string, SwiftValue>
}

/** Device and preview state the environment exposes to user code. */
export interface EnvironmentInputs {
  readonly colorScheme: 'light' | 'dark'
  readonly typeScale: number
  readonly locale: string
  readonly layoutDirection: 'leftToRight' | 'rightToLeft'
  readonly horizontalSizeClass: 'compact' | 'regular'
  readonly verticalSizeClass: 'compact' | 'regular'
}

export const DEFAULT_ENVIRONMENT: EnvironmentInputs = {
  colorScheme: 'light',
  typeScale: 1,
  locale: 'en_US',
  layoutDirection: 'leftToRight',
  horizontalSizeClass: 'compact',
  verticalSizeClass: 'regular',
}

/**
 * Dynamic Type sizes, as `\.dynamicTypeSize` reports them.
 *
 * The scale is a multiplier everywhere else in the pipeline because that is what
 * layout needs; user code sees the named size, because that is what it compares
 * against.
 */
function dynamicTypeSize(scale: number): string {
  if (scale <= 0.85) return 'xSmall'
  if (scale <= 0.95) return 'small'
  if (scale < 1.05) return 'large'
  if (scale < 1.25) return 'xLarge'
  if (scale < 1.5) return 'xxLarge'
  return 'accessibility1'
}

/** The environment values a fresh root starts with. */
export function rootEnvironmentValues(inputs: EnvironmentInputs): Map<string, SwiftValue> {
  return new Map<string, SwiftValue>([
    ['colorScheme', opaque(TOKEN_TYPE, { name: inputs.colorScheme })],
    ['dynamicTypeSize', opaque(TOKEN_TYPE, { name: dynamicTypeSize(inputs.typeScale) })],
    ['locale', str(inputs.locale)],
    ['layoutDirection', opaque(TOKEN_TYPE, { name: inputs.layoutDirection })],
    ['horizontalSizeClass', opaque(TOKEN_TYPE, { name: inputs.horizontalSizeClass })],
    ['verticalSizeClass', opaque(TOKEN_TYPE, { name: inputs.verticalSizeClass })],
    ['isEnabled', bool(true)],
    ['pixelLength', int(1)],
    // Callable, and resolved by the host rather than by the interpreter: see
    // `callValue` in `host.ts`.
    ['dismiss', opaque(DISMISS_TYPE, { kind: 'dismiss' })],
  ])
}

/**
 * A stack of environment frames, pushed as views expand.
 *
 * Lexical rather than structural, deliberately: `.environmentObject(store)` is in
 * scope for whatever expands while it is applied, which is the same rule a dynamic
 * scope follows and the closest honest approximation of SwiftUI's downward flow given
 * eager expansion.
 */
export class EnvironmentStack {
  private values: Map<string, SwiftValue>
  private objects = new Map<string, SwiftValue>()
  private readonly saved: { values: Map<string, SwiftValue>; objects: Map<string, SwiftValue> }[] = []

  constructor(inputs: EnvironmentInputs = DEFAULT_ENVIRONMENT) {
    this.values = rootEnvironmentValues(inputs)
  }

  reset(inputs: EnvironmentInputs): void {
    this.values = rootEnvironmentValues(inputs)
    this.objects = new Map()
    this.saved.length = 0
  }

  value(key: string): SwiftValue | undefined {
    return this.values.get(key)
  }

  /** The injected object of a given type, for `@EnvironmentObject var s: Store`. */
  object(typeName: string): SwiftValue | undefined {
    return this.objects.get(typeName)
  }

  /** The only object injected, when the property's type could not be determined. */
  soleObject(): SwiftValue | undefined {
    return this.objects.size === 1 ? [...this.objects.values()][0] : undefined
  }

  /** Runs `fn` with additional values and objects in scope. */
  scoped<T>(
    values: readonly [string, SwiftValue][],
    objects: readonly [string, SwiftValue][],
    fn: () => T,
  ): T {
    this.saved.push({ values: this.values, objects: this.objects })
    this.values = new Map(this.values)
    this.objects = new Map(this.objects)
    for (const [key, value] of values) this.values.set(key, value)
    for (const [key, value] of objects) this.objects.set(key, value)

    try {
      return fn()
    } finally {
      const previous = this.saved.pop()
      if (previous) {
        this.values = previous.values
        this.objects = previous.objects
      }
    }
  }
}
