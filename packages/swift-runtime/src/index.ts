/**
 * The Swift interpreter.
 *
 * Tree-walking over the parsed AST, with an explicit frame stack so traps print a
 * Swift-shaped trace, and a step budget so runaway user code is terminated rather
 * than left to hang the worker (FR-6.5).
 *
 * The value model is the part most JS-hosted Swift emulators get wrong: structs and
 * enums copy on assignment, arrays and dictionaries copy on assignment, and closures
 * are shared. Getting this wrong makes `@State` behave subtly incorrectly, which is
 * very hard to debug later. See `values.ts`.
 *
 * The package knows nothing about SwiftUI - views arrive through the `InterpreterHost`
 * seam in `host.ts`, which is what keeps the language implementation testable on its
 * own and the ESLint boundary rule satisfied.
 */

export * from './values'
export * from './errors'
export * from './limits'
export * from './environment'
export * from './host'
export { DEFAULT_STEP_BUDGET, Interpreter, pickOverload, type InterpreterOptions } from './interpreter'
export { getBuiltinProperty, callBuiltinMember } from './stdlib'
