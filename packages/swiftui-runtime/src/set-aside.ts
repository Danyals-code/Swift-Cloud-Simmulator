import type { Diagnostic, SourceSpan } from '@studio/shared'
import { isSyntaxError, type Expr, type SourceFileNode, type Stmt } from '@studio/swift-syntax'
import type { EvaluationResult } from './app-runtime'
import { stoppedFailures } from './presentation'

/**
 * The program the preview runs while the code has errors, and the places in it that
 * stop when run.
 *
 * An error sits in one statement or one property's initial value nearly always - a
 * name typed wrong, an argument missing - and only code that runs that line depends on
 * it. So each such line is set aside: it stops with its error when it runs, and a
 * screen that never runs it draws as it will in the app. A typo in a service no screen
 * calls used to draw nothing for the whole app.
 */
export interface Runnable {
  readonly files: readonly SourceFileNode[]
  /** Each line set aside, with the error that put it there. */
  readonly setAside: readonly { readonly span: SourceSpan; readonly error: Diagnostic }[]
}

/**
 * The files to run, or null when an error cannot be set aside: a syntax error leaves
 * part of a file unread, and an error in a declaration itself - a view with no body, a
 * type declared twice - is not a line that some code runs and some does not.
 */
export function runnableProgram(files: readonly SourceFileNode[], diagnostics: readonly Diagnostic[]): Runnable | null {
  const errors = diagnostics.filter(d => d.severity === 'error')
  if (!errors.length) return { files, setAside: [] }
  if (errors.some(isSyntaxError)) return null

  const placed = new Set<Diagnostic>()
  const setAside: { span: SourceSpan; error: Diagnostic }[] = []
  const pending = (span: SourceSpan) => errors.filter(d => !placed.has(d) && d.span.file === span.file && d.span.start >= span.start && d.span.end <= span.end)
  const isSpan = (value: unknown): value is SourceSpan => !!value && typeof value === 'object' && 'file' in value && 'start' in value && 'end' in value

  /** The node with every error inside it set aside at the innermost line that holds it. */
  function visit<T>(value: T): T {
    if (Array.isArray(value)) {
      const next = value.map(item => visit(item))
      return (next.some((item, i) => item !== value[i]) ? next : value) as T
    }
    if (!value || typeof value !== 'object' || isSpan(value)) return value
    const node = value as Record<string, unknown>
    if (isSpan(node.span) && !pending(node.span).length) return value
    let changed = false
    const copy: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) {
      const next = node.kind === 'block' && key === 'statements' ? (child as Stmt[]).map(statement => aside(statement, stopping => ({ kind: 'exprStmt', span: statement.span, expression: stopping })))
        : node.kind === 'varDecl' && key === 'initializer' && child ? aside(child as Expr, stopping => stopping)
          : visit(child)
      if (next !== child) changed = true
      copy[key] = next
    }
    return (changed ? copy : value) as T
  }

  /** `line`, or in its place one that stops with the error, when nothing inside it took the error. */
  function aside<T extends Stmt | Expr>(line: T, replace: (stopping: Expr) => unknown): T {
    if (!pending(line.span).length) return line
    const inner = visit(line)
    const left = pending(line.span)
    if (!left.length) return inner
    for (const error of left) placed.add(error)
    setAside.push({ span: line.span, error: left[0]! })
    return replace({ kind: 'errorExpr', span: line.span, message: left[0]!.message }) as T
  }

  const result = files.map(file => visit(file))
  return errors.every(error => placed.has(error)) ? { files: result, setAside } : null
}

/**
 * The error a line set aside stopped with, when the screen ran one: in a body, which
 * leaves nothing true to draw, or in an `.onAppear` or `.task`, which sets what is
 * drawn. A tap that runs one stops as any failing action does, with its error logged.
 */
export function setAsideRan(runnable: Runnable, evaluation: EvaluationResult, appeared: boolean): Diagnostic | undefined {
  if (!runnable.setAside.length) return undefined
  const failures = [...(evaluation.failure ? [evaluation.failure] : []), ...stoppedFailures(evaluation.ui)]
  const same = (a: SourceSpan, b: SourceSpan) => a.file === b.file && a.start === b.start && a.end === b.end
  const stopped = runnable.setAside.find(line => failures.some(failure => same(failure.span, line.span)))
  if (stopped || !appeared) return stopped?.error
  return runnable.setAside.find(line => evaluation.logs.some(log => log.level === 'error' && log.message.includes(line.error.message)))?.error
}
