import { normalizeFileName } from '@studio/project-model'

/**
 * How a second request tells the AI what was wrong with its first answer (G2): the
 * problems the preview found, never the answer itself, which would not fit in a request.
 * The studio sends it, both AI routes read it, and both prompts explain it.
 */

/** Something the preview found wrong with an AI answer, as the AI is told it. */
export interface PreviewProblem {
  readonly message: string
  /** Where it is, when the preview says: the file, its line from 1, and that line's code. */
  readonly file?: string
  readonly line?: number
  readonly source?: string
  /**
   * `xcode` for what Xcode would reject and the preview runs, as the warnings list has
   * it: the AI is told, so a second answer can fix it, and a change is never refused for
   * it. The routes do not read it.
   */
  readonly kind?: 'xcode'
}

/** Whether a problem refuses a change: any but what only Xcode would reject. */
export const blocksChange = (problem: PreviewProblem): boolean => problem.kind !== 'xcode'

/** What a second request carries about the answer before it. */
export interface PreviousAttempt {
  readonly problems: readonly PreviewProblem[]
}

/** The most problems a second request carries: enough to fix, and bounded like the rest of a request. */
export const MAX_PROBLEMS = 8
/** The longest message of one problem. */
export const MAX_PROBLEM_MESSAGE = 400
/** The longest line of code one problem quotes. */
export const MAX_PROBLEM_SOURCE = 200

/** What both prompts tell the AI a second request means. */
export const PREVIOUS_ATTEMPT_RULE = "When the request has previousAttempt, your earlier answer to this same request failed the studio's preview with those problems. Answer the request again, without them."

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
/** A Swift file of the project, named as the project names its files. */
const swiftFile = (value: unknown): value is string => text(value, 180) && value.endsWith('.swift') && normalizeFileName(value) === value

/** A request's `previousAttempt`, when it is a second request. Throws for anything that is not one. */
export function parsePreviousAttempt(value: unknown): PreviousAttempt | undefined {
  if (value === undefined || value === null) return undefined
  const invalid = () => new Error('The note about the first answer is not valid.')
  const problems = (value as { problems?: unknown }).problems
  if (!Array.isArray(problems) || !problems.length || problems.length > MAX_PROBLEMS) throw invalid()
  return {
    problems: problems.map((problem: Partial<Record<keyof PreviewProblem, unknown>>) => {
      const { message, file, line, source } = problem ?? {}
      if (!text(message, MAX_PROBLEM_MESSAGE)) throw invalid()
      if (file !== undefined && !swiftFile(file)) throw invalid()
      if (line !== undefined && !(Number.isInteger(line) && (line as number) >= 1 && (line as number) <= 1_000_000)) throw invalid()
      if (source !== undefined && !(typeof source === 'string' && source.length <= MAX_PROBLEM_SOURCE)) throw invalid()
      return { message, ...(file === undefined ? {} : { file }), ...(line === undefined ? {} : { line: line as number }), ...(source === undefined ? {} : { source }) }
    }),
  }
}
