import type { SourceSpan } from '@studio/shared'
import type { ClosureValue, SwiftValue } from './values'

export interface CallArgument {
  readonly label: string | null
  readonly value: SwiftValue
  readonly span: SourceSpan
}

export interface HostCall {
  readonly args: readonly CallArgument[]
  readonly trailingClosure: ClosureValue | null
  readonly span: SourceSpan
  /** Runs a closure and returns its single result - an action, or a mapping function. */
  invoke(closure: ClosureValue, args?: readonly SwiftValue[]): SwiftValue
  /**
   * Runs a closure as a result builder, returning every value it contributes.
   *
   * `VStack { Text("a"); Text("b") }` yields two views, not one, and an `if` inside
   * contributes only the taken branch. This is what `@ViewBuilder` means.
   */
  invokeBuilder(closure: ClosureValue, args?: readonly SwiftValue[]): readonly SwiftValue[]
  /** Reads `value.name` as Swift would: a stored or computed property, `rawValue`, or a built-in one. */
  member?(value: SwiftValue, name: string): SwiftValue | undefined
}

/**
 * The seam between Swift semantics and everything built on top of them.
 *
 * `swift-runtime` implements the language and nothing else - it has no idea what a
 * `VStack` is, and the ESLint boundary rule would reject the import if it tried. So
 * when evaluation meets a name it did not declare, it asks the host.
 *
 * `swiftui-runtime` supplies the host that turns `VStack { … }` into a view value,
 * `Color.red` into a colour, and `.padding()` into a modifier. Swapping that host
 * would let the same interpreter drive something else entirely, which is also what
 * makes the interpreter testable without dragging SwiftUI into the fixtures.
 *
 * Every method returns `undefined` to mean "not mine" - the interpreter then falls
 * through to its own error reporting rather than the host having to guess.
 */
export interface InterpreterHost {
  /** Preserve structural branch identity while building and expanding its values. */
  withBuilderScope?(slot: string, branch: string, build: () => SwiftValue[]): readonly SwiftValue[]
  /** Install a builder environment before evaluating a receiver's children. */
  withMemberScope?(member: string, args: readonly CallArgument[], evaluate: () => SwiftValue): SwiftValue

  /** A bare name in value position: `Color`, `Font`, `EmptyView`. */
  resolveGlobal?(name: string): SwiftValue | undefined

  /** A call to a global that is not a user declaration: `VStack(spacing: 8) { … }`. */
  callGlobal?(name: string, call: HostCall): SwiftValue | undefined

  /** `target.member(args)` where the interpreter does not own `target`. */
  callMember?(target: SwiftValue, member: string, call: HostCall): SwiftValue | undefined

  /** `target.member` with no call: `Color.red`, `.largeTitle`. */
  getMember?(target: SwiftValue, member: string, span: SourceSpan): SwiftValue | undefined

  /** Implicit member syntax with no base: `.primary`, `.infinity`, `.largeTitle`. */
  resolveImplicitMember?(member: string, span: SourceSpan): SwiftValue | undefined

  /**
   * Implicit member syntax *called*: `.easeInOut(duration: 0.3)`, `.adaptive(minimum: 80)`.
   *
   * Separate from `resolveImplicitMember` because that hook never sees the argument
   * list. Without this one every such call silently discards its arguments, which is
   * the worst kind of wrong: the code looks honoured and is not.
   */
  callImplicitMember?(member: string, call: HostCall): SwiftValue | undefined

  /**
   * Calling a value the interpreter cannot call itself.
   *
   * `@Environment(\.dismiss) var dismiss` puts something callable in a variable, and
   * `dismiss()` is then a call on a value that is neither a closure nor a function.
   * Rather than invent a native-function value kind - which every `switch` over
   * `SwiftValue` would have to learn - the host is asked.
   */
  callValue?(target: SwiftValue, call: HostCall): SwiftValue | undefined

  /**
   * Resolves a contextual member against a type the host owns.
   *
   * `.blue` has no base, so it arrives as an opaque token carrying only a name. When a
   * declaration says the expected type - `func card(_ tint: Color)`, `var tint: Color`
   * - the token can become the thing it obviously meant. The interpreter does this
   * itself for enums it declared; a `Color` belongs to the host, so it has to ask.
   *
   * Without it, `.blue` reaches a `Color` property as a token and the first modifier
   * called on it fails three layers from where the mistake actually is.
   */
  coerceToType?(value: SwiftValue, typeName: string): SwiftValue | undefined

  /**
   * Several values produced by one `@ViewBuilder` body, as a single value.
   *
   * Swift's builder wraps them in a `TupleView`; what that is here is the host's
   * business, because the interpreter does not know what a view is. Returning
   * undefined leaves the first value, which is what happened before this existed.
   */
  groupValues?(values: readonly SwiftValue[], span: SourceSpan): SwiftValue | undefined

  /**
   * A binary operator applied to a value the interpreter does not own.
   *
   * `Text("a") + Text("b")` is the whole reason this exists: both operands are
   * opaque, so every arithmetic path below rejects them and the trap takes the
   * entire preview down with it. Asked only when a built-in rule has not already
   * matched, so nothing here can change what `1 + 1` means.
   */
  applyOperator?(
    operator: string,
    left: SwiftValue,
    right: SwiftValue,
    span: SourceSpan,
  ): SwiftValue | undefined

  /**
   * `target[index]` where the interpreter does not own `target`.
   *
   * `d[.leading]` inside an `.alignmentGuide` closure is the case: `d` is a
   * `ViewDimensions`, which belongs to the host, and subscripting it is how every
   * guide but `d.width` is written.
   */
  subscript?(target: SwiftValue, index: SwiftValue, span: SourceSpan): SwiftValue | undefined

  /** `print(...)` and anything else that writes to the console. */
  log?(message: string, span: SourceSpan): void
}
