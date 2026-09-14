/**
 * The Swift interpreter.
 *
 * Phase 2. Tree-walking over the typed AST, with an explicit frame stack so traps
 * can print a Swift-shaped stack trace, and a step budget so runaway user code is
 * terminated rather than hanging the worker (requirement FR-6.5).
 *
 * The value model is the part most JS-based Swift emulators get wrong: structs and
 * enums copy on assignment, classes share, arrays and dictionaries are
 * copy-on-write, and `inout` is copy-in/copy-out rather than aliasing. Getting
 * this wrong makes `@State` behave subtly incorrectly, which is very hard to debug
 * later. See docs/02-ARCHITECTURE.md §5.1.
 */

export const PHASE = 2 as const

// TODO(phase 2): SwiftValue, Interpreter, stdlib shims, the async scheduler.
export {}
