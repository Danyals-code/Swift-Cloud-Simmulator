import { describe, expect, it } from 'vitest'
import { MemoryEventStore } from '@studio/project-model'
import { createEventLog, type LoggedEvent } from './eventLog'
import { promptAttempts } from './promptAttempts'

/**
 * Requests to the AI, as the event log tells them (G5): what was asked of which model,
 * and how each attempt ended, timed from sending. Failed, cancelled and discarded
 * attempts are kept, as are the ones Create with AI makes before any project exists.
 */

function setUp() {
  let now = 0
  const log = createEventLog(new MemoryEventStore<LoggedEvent>(), { session: 's1', build: { commit: 'abc1234', builtAt: '' }, now: () => now })
  const logged = async (project: string) => (await log.jsonl(project)).trimEnd().split('\n').slice(1).map(line => {
    const { t: _t, session: _session, seq: _seq, ...event } = JSON.parse(line)
    return event
  })
  return { log, logged, clock: () => now, wait: (ms: number) => { now += ms } }
}

describe('AI attempts in the event log', () => {
  it('records an edit: the prompt, the provider and model, and how it ended', async () => {
    const { log, logged, clock, wait } = setUp()
    const attempts = promptAttempts(log, 'edit', clock)

    attempts.sent('p1', { prompt: 'Make the title bigger', provider: 'openai', model: 'gpt-test', selection: true })
    wait(4200)
    attempts.ended({ action: 'applied', files: 2 })
    attempts.sent('p1', { prompt: 'Now make it blue', provider: 'openai', model: 'gpt-test' })
    wait(1000)
    attempts.ended({ action: 'failed', stage: 'request', status: 502 })

    expect(await logged('p1')).toEqual([
      { type: 'ai', flow: 'edit', attempt: 1, action: 'sent', prompt: 'Make the title bigger', provider: 'openai', model: 'gpt-test', selection: true },
      { type: 'ai', flow: 'edit', attempt: 1, action: 'applied', files: 2, ms: 4200 },
      { type: 'ai', flow: 'edit', attempt: 2, action: 'sent', prompt: 'Now make it blue', provider: 'openai', model: 'gpt-test' },
      { type: 'ai', flow: 'edit', attempt: 2, action: 'failed', stage: 'request', status: 502, ms: 1000 },
    ])
  })

  it('gives every attempt Create with AI made, retries included, to the project its draft became', async () => {
    const { log, logged, clock, wait } = setUp()
    const attempts = promptAttempts(log, 'create', clock)
    const settings = { pageCount: 4, navigation: 'tabs', sampleData: true }

    attempts.sent('p1', { prompt: 'A travel planner', provider: 'anthropic', model: 'model-test', settings })
    wait(30_000)
    attempts.ended({ action: 'failed', stage: 'answer' })
    attempts.sent('p1', { prompt: 'A travel planner', provider: 'anthropic', model: 'model-test', settings })
    wait(60_000)
    attempts.ended({ action: 'answered', files: 5, issues: 1 })
    wait(5000)
    // Opening the draft switches the studio to it, and closes the panel.
    attempts.close('p2')

    expect(await logged('p1')).toEqual([])
    expect((await logged('p2')).map(event => [event.attempt, event.action, event.ms])).toEqual([
      [1, 'sent', undefined], [1, 'failed', 30_000], [2, 'sent', undefined], [2, 'answered', 60_000], [2, 'opened', 65_000],
    ])
  })

  it('leaves the attempts with the project Create with AI was opened over when no draft opens', async () => {
    const { log, logged, clock, wait } = setUp()
    const attempts = promptAttempts(log, 'create', clock)

    attempts.sent('p1', { prompt: 'A recipe box', provider: 'openai', model: 'gpt-test' })
    wait(20_000)
    attempts.ended({ action: 'answered', files: 3, issues: 0 })
    wait(2000)
    attempts.ended({ action: 'discarded' })
    attempts.sent('p1', { prompt: 'A recipe box with photos', provider: 'openai', model: 'gpt-test' })
    wait(3000)
    attempts.ended({ action: 'cancelled' })
    attempts.close('p1')

    expect((await logged('p1')).map(event => [event.attempt, event.action, event.ms])).toEqual([
      [1, 'sent', undefined], [1, 'answered', 20_000], [1, 'discarded', 22_000], [2, 'sent', undefined], [2, 'cancelled', 3000],
    ])
  })

  it('counts a draft still waiting when Create with AI closes as discarded', async () => {
    const { log, logged, clock, wait } = setUp()
    const attempts = promptAttempts(log, 'create', clock)

    attempts.sent('p1', { prompt: 'A habit tracker', provider: 'openai', model: 'gpt-test' })
    wait(20_000)
    attempts.ended({ action: 'answered', files: 4, issues: 0 })
    wait(1000)
    attempts.close('p1')
    attempts.ended({ action: 'cancelled' })

    expect((await logged('p1')).map(event => [event.attempt, event.action, event.ms])).toEqual([
      [1, 'sent', undefined], [1, 'answered', 20_000], [1, 'discarded', 21_000], [1, 'cancelled', 21_000],
    ])
  })
})
