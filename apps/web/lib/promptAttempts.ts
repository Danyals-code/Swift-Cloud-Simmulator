import { eventLog, type AiEvent, type AttemptStep, type EventLog, type FailedStage, type PromptOutcome, type SentPrompt } from './eventLog'

/** One request to the AI, followed from sending to its end. */
export interface Attempt {
  /** The server answered: its status, and how long it took. */
  responded(status: number): void
  /** The answer's change is being checked in a preview. */
  checking(): void
  ended(outcome: PromptOutcome): void
  /** The request stopped early: cancelled when its signal was aborted, and otherwise failed, with how far it got. */
  stopped(signal: AbortSignal): void
}

/** An attempt as its panel keeps it: one whose draft can still be opened or thrown away. */
interface Tracked extends Attempt {
  /** Its draft was left, with `current` the project open now. */
  settle(current: string | null): void
}

/**
 * The requests one panel makes to the AI, as the event log tells them (G5).
 *
 * Each attempt is numbered, logged in the project open when its prompt went, and timed
 * from sending. Create with AI works before its app exists, so its attempts stay with
 * the project open behind it; a draft that opens as a new app is noted in that app's
 * log. When the new app replaces an untouched starter, the starter's events, these
 * attempts among them, go with it.
 */
export function promptAttempts(log: Pick<EventLog, 'record'>, flow: AiEvent['flow'], now: () => number = Date.now) {
  let count = 0
  /** The attempt whose draft is on screen, waiting to be opened or thrown away. */
  let waiting: Tracked | null = null

  /**
   * The draft on screen was left, with `current` the project open now.
   *
   * While Create with AI is open, only opening its draft moves the studio to another
   * project. So a waiting draft became `current` when that differs from the project its
   * prompt went from, and was thrown away when it does not.
   */
  const settleDraft = (current: string | null): void => {
    const draft = waiting
    waiting = null
    draft?.settle(current)
  }

  return {
    /** Records a prompt going out from `project`, and returns the attempt, which follows it to its end. */
    sent(project: string | null, prompt: SentPrompt): Attempt {
      // A new prompt leaves the draft on screen behind.
      settleDraft(project)
      const attempt = ++count, sentAt = now()
      const since = () => now() - sentAt
      const record = (step: AttemptStep, to = project) => { if (to) log.record(to, { type: 'ai', flow, attempt, ...step }) }
      let stage: FailedStage = 'request'
      record({ action: 'sent', ...prompt })
      const tracked: Tracked = {
        responded(status) {
          // An error status is the request failing; only an answer can be unusable.
          if (status >= 200 && status < 300) stage = 'answer'
          record({ action: 'responded', status, ms: since() })
        },
        checking() { stage = 'preview' },
        ended(outcome) {
          record({ ...outcome, ms: since() })
          if (outcome.action === 'answered') waiting = tracked
        },
        stopped(signal) {
          record(signal.aborted ? { action: 'cancelled', ms: since() } : { action: 'failed', stage, ms: since() })
        },
        settle(current) {
          if (current && current !== project) record({ action: 'opened', ms: since() }, current)
          else record({ action: 'discarded', ms: since() })
        },
      }
      return tracked
    },

    settleDraft,
  }
}

/** The page's attempts, one count for each panel, which goes on when a panel opens again. */
export const editAttempts = promptAttempts(eventLog, 'edit')
export const createAttempts = promptAttempts(eventLog, 'create')
