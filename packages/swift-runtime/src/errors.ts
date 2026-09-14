import type { SourceSpan } from '@studio/shared'

export interface StackFrame {
  /** `ContentView.body`, `increment(by:)`, `closure #1` */
  readonly name: string
  readonly span: SourceSpan
}

/**
 * A Swift runtime failure: force-unwrapping nil, index out of range, arithmetic
 * overflow, division by zero.
 *
 * Carries the source span and a Swift-shaped call stack so the red overlay can name
 * the exact line (FR-6.4). Extends Error only so that stack unwinding is free —
 * the JS stack itself is never shown to the user, since it describes the
 * interpreter's code rather than theirs.
 */
export class SwiftTrap extends Error {
  constructor(
    readonly reason: string,
    readonly span: SourceSpan,
    readonly frames: readonly StackFrame[] = [],
  ) {
    super(reason)
    this.name = 'SwiftTrap'
  }

  /** Swift-style trace, innermost frame first. */
  get trace(): string[] {
    return this.frames.map((f) => `  at ${f.name}`)
  }
}

/**
 * Raised when execution exceeds its step budget.
 *
 * Distinct from `SwiftTrap` because it is not the user's program failing — it is us
 * refusing to keep running it. The message says so, and names the last source
 * position reached so an infinite loop is findable (FR-6.5).
 */
export class ExecutionBudgetExceeded extends Error {
  constructor(
    readonly span: SourceSpan,
    readonly steps: number,
    readonly frames: readonly StackFrame[] = [],
    /** Which limit was hit. Recursion and iteration need different advice. */
    readonly limit: 'steps' | 'depth' = 'steps',
  ) {
    super(
      limit === 'depth'
        ? 'Call depth exceeded. This usually means recursion that never ends.'
        : `Execution took too long (${steps.toLocaleString()} steps). ` +
          'This usually means a loop or recursion that never ends.',
    )
    this.name = 'ExecutionBudgetExceeded'
  }
}

/**
 * Raised when the interpreter meets something it does not implement.
 *
 * Kept separate from `SwiftTrap` so the console can say "the preview cannot do this
 * yet" rather than implying the user's code is broken — the same distinction Phase 1
 * draws between unsupported and unresolved.
 */
export class UnsupportedAtRuntime extends Error {
  constructor(
    readonly feature: string,
    readonly span: SourceSpan,
  ) {
    super(`'${feature}' is not supported by the preview runtime yet.`)
    this.name = 'UnsupportedAtRuntime'
  }
}

/** Non-error control flow, thrown to unwind out of a function body. */
export class ReturnSignal {
  constructor(readonly value: unknown) {}
}

/**
 * A Swift `throw`, travelling as a JS throw.
 *
 * The same mechanism as `ReturnSignal`, and for the same reason: a thrown error has
 * to unwind through however many calls stand between the `throw` and the `catch`, and
 * a return code would need checking at every one of them.
 *
 * It carries the thrown *value* — usually an enum case conforming to `Error` — rather
 * than a message, because that value is what a `catch` pattern matches against and
 * what `catch { error }` binds.
 */
export class SwiftThrow {
  constructor(
    readonly value: unknown,
    readonly span: SourceSpan,
  ) {}
}

/**
 * Loop control, carried as a throw.
 *
 * Same mechanism as `ReturnSignal` and for the same reason: `break` has to unwind
 * through however many nested blocks and `if`s stand between it and the loop, and a
 * return code would have to be checked and propagated at every one of them — which
 * is exactly the kind of bookkeeping that gets missed in one branch.
 */
export class BreakSignal {}

export class ContinueSignal {}

export const TRAP_MESSAGES = {
  forceUnwrapNil: 'Unexpectedly found nil while unwrapping an Optional value',
  indexOutOfRange: 'Index out of range',
  divisionByZero: 'Division by zero',
  moduloByZero: 'Division by zero in remainder operation',
  overflow: 'Arithmetic operation overflowed',
  negativeArrayCount: "Can't construct Array with count < 0",
} as const
