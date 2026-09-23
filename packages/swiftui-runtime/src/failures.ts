import type { SourceSpan } from '@studio/shared'
import {
  describe,
  ExecutionBudgetExceeded,
  PreviewLimitExceeded,
  SwiftThrow,
  SwiftTrap,
  UnsupportedAtRuntime,
  type SwiftValue,
} from '@studio/swift-runtime'
import type { RuntimeFailure } from './view-value'

/**
 * What went wrong, as the preview reports it.
 *
 * Total: nothing thrown while running the user's code may escape a pass, because an
 * error that escapes takes the worker with it - the studio says the compiler stopped,
 * every `@State` is gone, and the line that failed is never marked. What the
 * interpreter did not raise itself, it is reported at `at`, where execution last was.
 */
export function toFailure(error: unknown, at: SourceSpan): RuntimeFailure {
  if (error instanceof SwiftTrap) {
    return {
      message: `Swift runtime failure: ${error.reason}`,
      span: error.span,
      frames: error.frames.map((f) => f.name),
      kind: 'trap',
    }
  }
  if (error instanceof PreviewLimitExceeded) {
    return { message: error.message, span: error.span, frames: [], kind: 'budget' }
  }
  if (error instanceof ExecutionBudgetExceeded) {
    return {
      message: error.message,
      span: error.span,
      frames: error.frames.map((f) => f.name),
      kind: 'budget',
    }
  }
  if (error instanceof UnsupportedAtRuntime) {
    return { message: error.message, span: error.span, frames: [], kind: 'unsupported' }
  }
  if (error instanceof SwiftThrow) {
    // An error that reached the top of the tree was never caught. In a real app that
    // is a fatal error; here it becomes a diagnostic like any other failure.
    return {
      message: `An error was thrown and never caught: ${describe(error.value as SwiftValue, false)}`,
      span: error.span,
      frames: [],
      kind: 'trap',
    }
  }
  // Recursion runs out of JavaScript stack before it reaches the interpreter's own
  // depth limit when each call nests a few expressions, so it is the same failure.
  if (isStackOverflow(error)) {
    return { message: 'Call depth exceeded. This usually means recursion that never ends.', span: at, frames: [], kind: 'budget' }
  }
  const reason = error instanceof Error ? error.message : String(error)
  return { message: `The preview stopped on an internal error here: ${reason}. It may still run in Xcode.`, span: at, frames: [], kind: 'unsupported' }
}

/**
 * Whether a failure can stop one view and leave the rest of the pass running.
 *
 * Not the step budget or a preview limit: both count the whole pass, so once one is
 * spent every view after it would stop too. Nor the interpreter's own control-flow
 * signals, which are never errors.
 */
export function containable(error: unknown): boolean {
  if (error instanceof ExecutionBudgetExceeded) return error.limit === 'depth'
  if (error instanceof PreviewLimitExceeded) return false
  return error instanceof Error || error instanceof SwiftThrow
}

/** A JavaScript stack overflow: a RangeError in Chrome and Safari, "too much recursion" in Firefox. */
function isStackOverflow(error: unknown): boolean {
  return error instanceof Error && /call stack|too much recursion/i.test(error.message)
}
