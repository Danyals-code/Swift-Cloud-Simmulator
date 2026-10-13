import type { PreviousAttempt } from './previousAttempt'
import { UnusableAnswer } from './retry'

/** A Vercel Firewall rate limit answers 429 with a page of its own, not the studio's answer (G4). */
const RATE_LIMITED = 'Too many AI requests came from this network. Wait a few minutes, then try again.'

/**
 * Asks one of the studio's AI routes, with the tab's key, and reads its answer.
 *
 * `read` turns the route's answer into what the panel needs. An answer it cannot read,
 * like one the route calls `retryable`, throws `UnusableAnswer`: asking again may give
 * one it can. Anything else throws an Error whose message is for the participant: the
 * route's own, or `defaultError` when it gave none. `responded` hears each HTTP status,
 * for the event log.
 */
export async function askAiRoute<A>(path: '/api/generate' | '/api/edit', request: {
  readonly key: string
  readonly body: object
  readonly previousAttempt: PreviousAttempt | null
  readonly signal: AbortSignal
  readonly responded: (status: number) => void
  readonly defaultError: string
  readonly read: (answer: Record<string, unknown>) => A
}): Promise<A> {
  const body = request.previousAttempt ? { ...request.body, previousAttempt: request.previousAttempt } : request.body
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.key.trim()}` }, body: JSON.stringify(body), signal: request.signal })
  request.responded(response.status)
  const parsed: unknown = await response.json().catch(() => null)
  request.signal.throwIfAborted()
  const answer = parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  if (!response.ok || !answer) {
    const error = typeof answer?.error === 'string' ? answer.error : null
    if (!error) throw new Error(response.status === 429 ? RATE_LIMITED : request.defaultError)
    throw answer!.retryable === true ? new UnusableAnswer(error) : new Error(error)
  }
  try {
    return request.read(answer)
  } catch (error) {
    throw new UnusableAnswer(error instanceof Error ? error.message : request.defaultError)
  }
}
