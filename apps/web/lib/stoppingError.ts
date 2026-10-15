import type { CompileResult, FileId, SourceFile } from '@studio/shared'

/** The error that stops the code running, where it is written. */
export interface StoppingError {
  readonly file: FileId
  readonly offset: number
  /** From 1, as Code numbers its lines. */
  readonly line: number
  readonly message: string
}

/** What the preview says when the program ran and stopped, or could not be run as it stands: not an error in the code. */
const NOT_THE_CODE = new Set(['runtime_trap', 'execution_budget_exceeded', 'invalid_preview_scenario'])

/**
 * The error the phone names over the last screen that ran, while the code's errors stop it running
 * (FR-6.3); null while it runs, or stopped running for a reason of its own. The canvas keeps the last
 * drawing meanwhile, and says where to fix it.
 */
export function stoppingError(result: Pick<CompileResult, 'renderTree' | 'diagnostics'> | null | undefined, files: readonly SourceFile[]): StoppingError | null {
  const span = result?.renderTree?.notice?.span
  const error = span && result.diagnostics.find(d => d.severity === 'error' && !NOT_THE_CODE.has(d.code) && d.span.file === span.file && d.span.start === span.start && d.span.end === span.end)
  if (!error) return null
  const text = files.find(file => file.id === error.span.file)?.text ?? ''
  return { file: error.span.file, offset: error.span.start, line: text.slice(0, error.span.start).split('\n').length, message: error.message }
}

/** A file's name as Code's tabs show it, without its folders. */
export const fileName = (file: FileId) => file.slice(file.lastIndexOf('/') + 1)

/** Where the error is, as Design says it: the file by its name, and the line. */
export const errorLine = (error: StoppingError) => `${fileName(error.file)} has an error on line ${error.line}`

/**
 * Why a design edit waits while an error stops the code: the canvas shows the last drawing, which
 * no edit can change until the code runs again. An edit to the file with the error is the
 * planner's to refuse, in the words it uses.
 */
export function stoppedEditProblem(error: StoppingError | null, target: FileId): string | null {
  return error && error.file !== target ? `${errorLine(error)}, so the design can’t be changed until it’s fixed in Code.` : null
}
