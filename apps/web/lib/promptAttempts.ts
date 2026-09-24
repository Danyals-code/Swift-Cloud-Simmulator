import type { AiEvent, AttemptStep, EventLog, PromptOutcome, SentPrompt } from './eventLog'

/**
 * The requests one panel makes to the AI, as the event log tells them (G5).
 *
 * Each attempt is numbered and timed from sending. An edit's attempts belong to the
 * project it was sent from. Create with AI works before its project exists, so its
 * attempts wait under a key of their own until the panel closes, then join the
 * project open at that moment.
 */
export function promptAttempts(log: Pick<EventLog, 'record' | 'handOn'>, flow: AiEvent['flow'], now: () => number = Date.now) {
  let attempt = 0
  let sentAt = 0
  /** The project open when the last prompt went. */
  let from: string | null = null
  /** Where Create with AI's attempts went when it closed, and where anything after goes. */
  let home: string | null = null
  /** A draft is ready, and nobody has opened it or thrown it away yet. */
  let waiting = false
  const draft = flow === 'create' ? `draft:${Math.random().toString(36).slice(2, 10)}` : null

  const record = (step: AttemptStep) => {
    const to = home ?? draft ?? from
    if (to) log.record(to, { type: 'ai', flow, attempt, ...step })
  }
  const since = () => now() - sentAt

  return {
    sent(project: string, prompt: SentPrompt): void {
      attempt++
      sentAt = now()
      from = project
      waiting = false
      record({ action: 'sent', ...prompt })
    },

    ended(outcome: PromptOutcome): void {
      waiting = outcome.action === 'answered'
      record({ ...outcome, ms: since() })
    },

    /**
     * Create with AI closed, with `current` the project open now.
     *
     * While the panel is open, only opening its draft moves the studio to another
     * project. So a draft still waiting has become `current` when that differs from the
     * project the prompt went from, and was thrown away when it does not.
     */
    close(current: string | null): void {
      if (!draft || home || !from) return
      if (waiting) record(current && current !== from ? { action: 'opened', ms: since() } : { action: 'discarded', ms: since() })
      waiting = false
      home = current ?? from
      log.handOn(draft, home)
    },
  }
}
