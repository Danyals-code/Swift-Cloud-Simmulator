/**
 * Name resolution and coverage checking.
 *
 * Governed by Phase 1 gate 4: a false positive is worse than a missed error. See
 * the `Checker` class comment for exactly what is and is not checked, and why.
 */

export * from './model'
export * from './builtins'
export { Checker, checkSourceFiles } from './checker'
export { lintStrictness } from './strictness'
export * from './symbols'
