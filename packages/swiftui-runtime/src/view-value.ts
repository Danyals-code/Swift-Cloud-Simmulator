import type { SourceSpan } from '@studio/shared'
import { describe, type ClosureValue, type SwiftValue } from '@studio/swift-runtime'

/**
 * An evaluated view.
 *
 * The product of actually running the user's `body`, so every value here is real:
 * interpolations resolved, ternaries taken, numbers computed. This is the direct
 * ancestor of the Phase 3 view graph — what that adds is identity, state boxes and
 * layout, not a different shape.
 */
export interface ViewValue {
  readonly name: string
  readonly args: readonly ViewArg[]
  readonly children: readonly ViewValue[]
  readonly modifiers: readonly ModifierValue[]
  /** A `Button`'s trailing closure, kept to be run on tap. */
  readonly action: ClosureValue | null
  readonly span: SourceSpan
}

export interface ViewArg {
  readonly label: string | null
  readonly value: SwiftValue
}

export interface ModifierValue {
  readonly name: string
  readonly args: readonly ViewArg[]
  readonly span: SourceSpan
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
  readonly opacity?: number
}

export function isView(value: SwiftValue): value is SwiftValue & { payload: ViewValue } {
  return value.kind === 'opaque' && value.typeName === VIEW_TYPE
}

export function asView(value: SwiftValue): ViewValue | null {
  return isView(value) ? (value.payload as ViewValue) : null
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
    const path = `${prefix}-${index}`
    out.push({ view, depth, path })
    out.push(...flattenViews(view.children, depth + 1, path))
  })
  return out
}
