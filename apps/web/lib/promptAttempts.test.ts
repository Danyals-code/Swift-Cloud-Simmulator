import { describe, expect, it } from 'vitest'
import { MemoryEventStore } from '@studio/project-model'
import { createEventLog, type LoggedEvent, type SentPrompt } from './eventLog'
import { promptAttempts } from './promptAttempts'

/**
 * Requests to the AI, as the event log tells them (G5): what was asked of which model,
 * when the answer came, and how each attempt ended, timed from sending. Failed,
 * cancelled and discarded attempts are kept, and so are the ones Create with AI makes
 * before its app exists.
 */

function setUp() {
  let now = 0
  const log = createEventLog(new MemoryEventStore<LoggedEvent>(), { session: 's1', build: { commit: 'abc1234', builtAt: '' }, now: () => now })
  const logged = async (project: string) => (await log.file(project)).text.trimEnd().split('\n').slice(1).map(line => {
    const { t: _t, session: _session, seq: _seq, ...event } = JSON.parse(line)
    return event
  })
  return { log, logged, clock: () => now, wait: (ms: number) => { now += ms } }
}

const PROMPT: SentPrompt = { prompt: 'A recipe box', provider: 'openai', model: 'gpt-test' }
/** A request still going when it stopped, and one somebody cancelled. */
const RUNNING = new AbortController().signal, CANCELLED = AbortSignal.abort()
const steps = (events: readonly { attempt: number; action: string; ms?: number }[]) => events.map(event => [event.attempt, event.action, event.ms])

describe('AI attempts in the event log', () => {
  it('records an edit: the prompt and model, when the answer came, and the change applied', async () => {
    const { log, logged, clock, wait } = setUp()
    const attempts = promptAttempts(log, 'edit', clock)

    const attempt = attempts.sent('p1', { prompt: 'Make the title bigger', provider: 'openai', model: 'gpt-test', selection: true })
    wait(4200)
    attempt.responded(200)
    attempt.checking()
    wait(800)
    attempt.ended({ action: 'applied', files: 2 })

    expect(await logged('p1')).toEqual([
      { type: 'ai', flow: 'edit', attempt: 1, action: 'sent', prompt: 'Make the title bigger', provider: 'openai', model: 'gpt-test', selection: true },
      { type: 'ai', flow: 'edit', attempt: 1, action: 'responded', status: 200, ms: 4200 },
      { type: 'ai', flow: 'edit', attempt: 1, action: 'applied', files: 2, ms: 5000 },
    ])
  })

  it('says how far a failed attempt got: no answer, an error answer, an answer it could not use, or a change that failed the preview', async () => {
    const { log, logged, clock, wait } = setUp()
    const attempts = promptAttempts(log, 'edit', clock)

    const unanswered = attempts.sent('p1', PROMPT)
    wait(30_000)
    unanswered.stopped(RUNNING)
    const refused = attempts.sent('p1', PROMPT)
    wait(1000)
    refused.responded(502)
    refused.stopped(RUNNING)
    const unusable = attempts.sent('p1', PROMPT)
    unusable.responded(200)
    unusable.stopped(RUNNING)
    const broken = attempts.sent('p1', PROMPT)
    broken.responded(200)
    broken.checking()
    wait(500)
    broken.stopped(RUNNING)
    const stopped = attempts.sent('p1', PROMPT)
    wait(700)
    stopped.stopped(CANCELLED)

    expect((await logged('p1')).filter(event => event.action !== 'sent' && event.action !== 'responded')).toEqual([
      { type: 'ai', flow: 'edit', attempt: 1, action: 'failed', stage: 'request', ms: 30_000 },
      { type: 'ai', flow: 'edit', attempt: 2, action: 'failed', stage: 'request', ms: 1000 },
      { type: 'ai', flow: 'edit', attempt: 3, action: 'failed', stage: 'answer', ms: 0 },
      { type: 'ai', flow: 'edit', attempt: 4, action: 'failed', stage: 'preview', ms: 500 },
      { type: 'ai', flow: 'edit', attempt: 5, action: 'cancelled', ms: 700 },
    ])
  })

  it('logs Create with AI in the project open behind it, and notes the draft that became a new app there', async () => {
    const { log, logged, clock, wait } = setUp()
    const attempts = promptAttempts(log, 'create', clock)
    const prompt = { ...PROMPT, settings: { pageCount: 4, navigation: 'tabs', sampleData: true } }

    const first = attempts.sent('p1', prompt)
    wait(30_000)
    first.responded(200)
    first.stopped(RUNNING)
    const second = attempts.sent('p1', prompt)
    wait(60_000)
    second.responded(200)
    second.checking()
    second.ended({ action: 'answered', files: 5, issues: 1 })
    wait(5000)
    // Opening the draft switches the studio to it, and closes the panel.
    attempts.settleDraft('p2')

    expect(steps(await logged('p1'))).toEqual([
      [1, 'sent', undefined], [1, 'responded', 30_000], [1, 'failed', 30_000], [2, 'sent', undefined], [2, 'responded', 60_000], [2, 'answered', 60_000],
    ])
    expect(await logged('p2')).toEqual([{ type: 'ai', flow: 'create', attempt: 2, action: 'opened', ms: 65_000 }])
  })

  it('counts a draft left behind as discarded, whether sent back to the prompt or waiting when the panel closes', async () => {
    const { log, logged, clock, wait } = setUp()
    const attempts = promptAttempts(log, 'create', clock)

    const first = attempts.sent('p1', PROMPT)
    wait(20_000)
    first.ended({ action: 'answered', files: 3, issues: 0 })
    wait(2000)
    attempts.settleDraft('p1')
    const second = attempts.sent('p1', PROMPT)
    wait(3000)
    second.ended({ action: 'answered', files: 3, issues: 0 })
    wait(1000)
    attempts.settleDraft('p1')
    const third = attempts.sent('p1', PROMPT)
    wait(1000)
    third.ended({ action: 'cancelled' })
    attempts.settleDraft('p1')

    expect(steps(await logged('p1'))).toEqual([
      [1, 'sent', undefined], [1, 'answered', 20_000], [1, 'discarded', 22_000],
      [2, 'sent', undefined], [2, 'answered', 3000], [2, 'discarded', 4000],
      [3, 'sent', undefined], [3, 'cancelled', 1000],
    ])
  })
})
