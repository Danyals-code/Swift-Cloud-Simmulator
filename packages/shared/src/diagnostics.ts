import type { SourceSpan } from './source'

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

/**
 * Stable diagnostic identifiers. Used for telemetry grouping and for tests that
 * assert on a code rather than on message wording, so we can improve wording
 * without breaking the suite.
 */
export type DiagnosticCode =
  | 'invalid_preview_scenario'
  // syntax
  | 'expected_token'
  | 'unexpected_token'
  | 'unterminated_string'
  | 'unterminated_block'
  // semantic
  | 'unresolved_identifier'
  | 'unresolved_member'
  | 'type_mismatch'
  | 'missing_argument'
  | 'extra_argument'
  | 'not_conformant'
  | 'immutable_assignment'
  // project level
  | 'no_entry_point'
  | 'duplicate_entry_point'
  // runtime
  | 'runtime_trap'
  | 'execution_budget_exceeded'
  // coverage
  | 'unsupported_language_feature'
  | 'unsupported_swiftui_view'
  | 'unsupported_swiftui_modifier'
  // strictness lint (phase 6): accepted here, may fail in Xcode
  | 'may_not_compile_in_xcode'

export interface TextEdit {
  readonly span: SourceSpan
  readonly newText: string
}

export interface FixIt {
  readonly title: string
  readonly edits: readonly TextEdit[]
}

export interface Diagnostic {
  readonly span: SourceSpan
  readonly severity: DiagnosticSeverity
  readonly code: DiagnosticCode
  /**
   * User-facing text. Mirrors real swiftc wording where an equivalent exists, so
   * that what someone learns here transfers to Xcode (requirement G5).
   */
  readonly message: string
  readonly fixIts?: readonly FixIt[]
  /**
   * For the three `unsupported_*` codes: the exact feature name, e.g. `NavigationStack`
   * or `.matchedGeometryEffect` or `actor`. This is the field the coverage telemetry
   * aggregates, and those counts are what decide the build order in Phase 6.
   */
  readonly feature?: string
}

export function isError(d: Diagnostic): boolean {
  return d.severity === 'error'
}

/** Errors block evaluation; warnings and info do not. */
export function hasBlockingError(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(isError)
}

export function unsupported(
  span: SourceSpan,
  code: Extract<DiagnosticCode, `unsupported_${string}`>,
  feature: string,
  hint?: string,
): Diagnostic {
  const what =
    code === 'unsupported_language_feature'
      ? `'${feature}' is not supported in the preview yet`
      : `'${feature}' is not implemented in the preview yet`
  return {
    span,
    severity: 'warning',
    code,
    feature,
    message: hint ? `${what}. ${hint}` : `${what}. It will still be exported to Xcode unchanged.`,
  }
}
