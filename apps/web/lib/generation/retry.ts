import { blocksChange, MAX_PROBLEMS, type PreviewProblem, type PreviousAttempt } from './previousAttempt'

/**
 * An answer that came back but could not be used, such as one with the wrong number
 * of pages. Asking again may give a usable one, which a failed request would not.
 */
export class UnusableAnswer extends Error {}

/** How an AI answer came out: the answer, and what is still wrong with it. */
export interface RetriedAnswer<A> {
  readonly answer: A
  readonly problems: readonly PreviewProblem[]
  /**
   * Why the second request brought nothing, when it failed or came back unusable: the
   * answer is then the first one, which was paid for, with its problems.
   */
  readonly secondTryFailed?: Error
}

const cancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

/**
 * Asks the AI, checks its answer, and asks once more when the check finds problems (G2).
 *
 * `ask` gets null the first time, and the first answer's problems the second. It
 * throws `UnusableAnswer` for an answer that came back unusable, which is asked for
 * again, and anything else for a request that failed or was cancelled, which is not.
 * `check` says what the preview finds wrong with an answer that the project did not
 * have already. `retrying` hears the problems as the second request goes.
 */
export async function answerWithOneRetry<A>(steps: {
  readonly ask: (previous: PreviousAttempt | null) => Promise<A>
  readonly check: (answer: A) => Promise<readonly PreviewProblem[]>
  readonly retrying: (problems: readonly PreviewProblem[]) => void
}): Promise<RetriedAnswer<A>> {
  let first: { readonly answer: A } | null = null
  let found: readonly PreviewProblem[]
  try {
    first = { answer: await steps.ask(null) }
    found = await steps.check(first.answer)
    if (!found.length) return { answer: first.answer, problems: found }
  } catch (error) {
    if (!(error instanceof UnusableAnswer)) throw error
    found = [{ message: error.message }]
  }
  steps.retrying(found)
  let answer: A
  try {
    answer = await steps.ask({ problems: found.slice(0, MAX_PROBLEMS) })
  } catch (error) {
    if (!first || cancelled(error) || !(error instanceof Error)) throw error
    return { answer: first.answer, problems: found, secondTryFailed: error }
  }
  const problems = await steps.check(answer)
  // A first answer that only Xcode would refuse still applies, so it is kept over a
  // second one with an error.
  if (first && !found.some(blocksChange) && problems.some(blocksChange)) return { answer: first.answer, problems: found }
  return { answer, problems }
}
