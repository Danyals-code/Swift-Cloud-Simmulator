import type { SourceSpan } from '@studio/shared'
import {
  double,
  opaque,
  type ClosureValue,
  type HostCall,
  type InterpreterHost,
  type SwiftValue,
} from '@studio/swift-runtime'
import { SUPPORTED_VIEWS, UNIMPLEMENTED_VIEWS } from '@studio/swift-sema'
import {
  asView,
  COLOR_TYPE,
  isView,
  TOKEN_TYPE,
  VIEW_TYPE,
  type ColorPayload,
  type ModifierValue,
  type ViewArg,
  type ViewValue,
} from './view-value'

/** Every name the host will build a view for — implemented or not. */
const VIEW_NAMES: ReadonlySet<string> = new Set([
  ...SUPPORTED_VIEWS,
  ...UNIMPLEMENTED_VIEWS.keys(),
  'Spacer',
  'Divider',
])

/**
 * Views whose trailing closure is an action rather than content.
 *
 * `Button("Save") { save() }` has the same shape as `VStack { Text(…) }`, so the
 * label argument is what distinguishes them: with one, the closure is behaviour;
 * without, it is the view's own label content.
 */
const ACTION_VIEWS: ReadonlySet<string> = new Set(['Button', 'Link', 'NavigationLink'])

/** Names that are types rather than views: `Color.red`, `Font.title`. */
const NAMESPACES: ReadonlySet<string> = new Set(['Color', 'Font', 'Alignment', 'Edge', 'Angle'])

function view(v: ViewValue): SwiftValue {
  return opaque(VIEW_TYPE, v)
}

function token(name: string): SwiftValue {
  return opaque(TOKEN_TYPE, { name })
}

function color(payload: ColorPayload): SwiftValue {
  return opaque(COLOR_TYPE, payload)
}

function toArgs(call: HostCall): ViewArg[] {
  return call.args.map((a) => ({ label: a.label, value: a.value }))
}

/**
 * Turns evaluated Swift into a view tree.
 *
 * This is the whole of `swift-runtime`'s SwiftUI knowledge — the interpreter itself
 * has none, and the ESLint boundary rule would reject the import if it tried. Every
 * view, colour and modifier the preview understands is defined here, which also
 * means the coverage matrix has exactly one place to be wrong.
 */
export class SwiftUIHost implements InterpreterHost {
  private readonly logs: { message: string; span: SourceSpan }[] = []

  /**
   * Expands a user-declared `View` struct into its evaluated body.
   *
   * Supplied by the pipeline, because expansion needs the interpreter and this class
   * must not hold one — it is the interpreter's *host*, not its owner. Without it,
   * `WindowGroup { ContentView() }` collects a struct the host cannot recognise and
   * silently drops the entire app.
   */
  expandStruct: ((value: SwiftValue) => readonly ViewValue[]) | null = null

  /** Collected builder results, with user views expanded and non-views dropped. */
  private toViews(values: readonly SwiftValue[]): ViewValue[] {
    return values.flatMap((value) => {
      const view = asView(value)
      if (view) return [view]
      if (value.kind === 'struct' && this.expandStruct) return [...this.expandStruct(value)]
      return []
    })
  }

  takeLogs(): { message: string; span: SourceSpan }[] {
    return this.logs.splice(0, this.logs.length)
  }

  log(message: string, span: SourceSpan): void {
    this.logs.push({ message, span })
  }

  resolveGlobal(name: string): SwiftValue | undefined {
    if (NAMESPACES.has(name)) return { kind: 'type', name }
    // A view referenced without a call, e.g. passed as a value.
    if (VIEW_NAMES.has(name)) return { kind: 'type', name }
    return undefined
  }

  callGlobal(name: string, call: HostCall): SwiftValue | undefined {
    if (name === 'Color') return this.makeColor(call)
    if (!VIEW_NAMES.has(name)) return undefined

    const args = toArgs(call)
    const isAction = ACTION_VIEWS.has(name) && call.args.some((a) => a.label === null)

    // Content closures are result builders: `VStack { a; b }` yields two children,
    // and an `if` inside contributes only the taken branch.
    const children =
      call.trailingClosure && !isAction ? this.toViews(call.invokeBuilder(call.trailingClosure)) : []

    return view({
      name,
      args,
      children,
      modifiers: [],
      action: isAction ? call.trailingClosure : null,
      span: call.span,
    })
  }

  callMember(target: SwiftValue, member: string, call: HostCall): SwiftValue | undefined {
    // A modifier on a view returns a *new* view with the modifier appended, so the
    // original is untouched — SwiftUI modifiers are value-semantic too.
    const base = asView(target)
    if (base) {
      const modifier: ModifierValue = { name: member, args: toArgs(call), span: call.span }
      return view({ ...base, modifiers: [...base.modifiers, modifier] })
    }

    if (target.kind === 'opaque' && target.typeName === COLOR_TYPE) {
      const payload = target.payload as ColorPayload
      if (member === 'opacity') {
        const amount = call.args[0]?.value
        return color({ ...payload, opacity: amount?.kind === 'double' || amount?.kind === 'int' ? amount.value : 1 })
      }
    }

    // `Color(white: 0.95)` reaching here as `Color.init(...)`.
    if (target.kind === 'type' && target.name === 'Color' && member === 'init') {
      return this.makeColor(call)
    }

    return undefined
  }

  getMember(target: SwiftValue, member: string, span: SourceSpan): SwiftValue | undefined {
    if (target.kind === 'type') {
      if (target.name === 'Color') return color({ name: member })
      if (NAMESPACES.has(target.name)) return token(member)
      // A view type referenced without arguments: `Spacer` used as `Spacer`.
      if (VIEW_NAMES.has(target.name)) {
        return view({ name: target.name, args: [], children: [], modifiers: [], action: null, span })
      }
    }
    return undefined
  }

  /**
   * Contextual member syntax, resolved without type information.
   *
   * `.largeTitle`, `.primary` and `.infinity` all resolve against an expected type
   * the interpreter does not track. Rather than guess, they become tokens carrying
   * only their name, and whoever consumes them decides what they mean — a font
   * token inside `.font()`, a colour inside `.foregroundStyle()`. `.infinity` is the
   * one exception: it is genuinely a number wherever it appears.
   */
  resolveImplicitMember(member: string): SwiftValue | undefined {
    if (member === 'infinity') return double(Number.POSITIVE_INFINITY)
    return token(member)
  }

  private makeColor(call: HostCall): SwiftValue {
    const white = call.args.find((a) => a.label === 'white')?.value
    if (white?.kind === 'double' || white?.kind === 'int') return color({ name: null, white: white.value })

    const first = call.args[0]?.value
    if (first?.kind === 'string') return color({ name: first.value })
    return color({ name: 'clear' })
  }
}

export { isView, asView }
export type { ClosureValue }
