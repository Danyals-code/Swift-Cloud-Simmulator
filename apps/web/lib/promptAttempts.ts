import { eventLog, type AiEvent, type AttemptStep, type EventLog, type FailedStage, type PromptOutcome, type SentPrompt } from './eventLog'

/**
 * What a Create with AI draft carries from the attempt that made it: opening the draft
 * or throwing it away is logged against that attempt, however much later, and after a
 * reload too.
 */
export interface DraftStamp {
  readonly attempt: number
  /** When the prompt went, as the clock reads. */
  readonly sentAt: number
  /** The project open when it went, whose log has the attempt. */
  readonly project: string | null
}

/** One request to the AI, followed from sending to its end. */
export interface Attempt {
  /** The server answered: its status, and how long it took. */
  responded(status: number): void
  /** The answer's change is being checked in a preview. */
  checking(): void
  /** The answer was broken, and a second request goes with its `problems` (G2). */
  retried(problems: number): void
  ended(outcome: PromptOutcome): void
  /** The request stopped early: cancelled when its signal was aborted, and otherwise failed, with how far it got. */
  stopped(signal: AbortSignal): void
  /** For a draft this attempt makes. */
  readonly stamp: DraftStamp
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
  const record = (to: string | null, attempt: number, step: AttemptStep) => { if (to) log.record(to, { type: 'ai', flow, attempt, ...step }) }

  return {
    /** Records a prompt going out from `project`, and returns the attempt, which follows it to its end. */
    sent(project: string | null, prompt: SentPrompt): Attempt {
      const attempt = ++count, sentAt = now()
      const since = () => now() - sentAt
      let stage: FailedStage = 'request'
      record(project, attempt, { action: 'sent', ...prompt })
      return {
        responded(status) {
          // An error status is the request failing; only an answer can be unusable.
          if (status >= 200 && status < 300) stage = 'answer'
          record(project, attempt, { action: 'responded', status, ms: since() })
        },
        checking() { stage = 'preview' },
        retried(problems) {
          // How far the second request gets starts over.
          stage = 'request'
          record(project, attempt, { action: 'retried', problems, ms: since() })
        },
        ended(outcome) { record(project, attempt, { ...outcome, ms: since() }) },
        stopped(signal) {
          record(project, attempt, signal.aborted ? { action: 'cancelled', ms: since() } : { action: 'failed', stage, ms: since() })
        },
        stamp: { attempt, sentAt, project },
      }
    },

    /** A kept draft opened as `project`, whose log notes it. */
    draftOpened(stamp: DraftStamp, project: string): void {
      record(project, stamp.attempt, { action: 'opened', ms: now() - stamp.sentAt })
    },

    /** A kept draft was thrown away: noted with the attempts that made it. */
    draftDiscarded(stamp: DraftStamp): void {
      record(stamp.project, stamp.attempt, { action: 'discarded', ms: now() - stamp.sentAt })
    },
  }
}

/** The page's attempts, one count for each panel, which goes on when a panel opens again. */
export const editAttempts = promptAttempts(eventLog, 'edit')
export const createAttempts = promptAttempts(eventLog, 'create')
