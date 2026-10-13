import { validatePromptHistory, type PromptMessage } from '@studio/project-model'
import type { DraftStamp } from '../promptAttempts'
import { forgetKept, keep, readKept, tabStorage } from '../tabStorage'
import { parseGeneratedApp, type GeneratedApp } from './schema'

/**
 * A Create with AI draft, kept for the tab until it is opened or thrown away (G13).
 *
 * A draft takes minutes to make and is paid for, and it used to last only as long as
 * the panel showing it: closing the gallery, or a click beside it, threw it away.
 */
export interface KeptDraft {
  readonly app: GeneratedApp
  /** What the preview check found in it. */
  readonly issues: readonly string[]
  /** The prompt and answer, which go into the project's conversation when it opens. */
  readonly history: readonly PromptMessage[]
  /** The attempt that made it, so opening or throwing it away is logged against that attempt, after a reload too. */
  readonly stamp?: DraftStamp
}

const DRAFT_KEY = 'studio.aiDraft'

/** The draft this tab kept, or null when there is none or it no longer reads as one. */
export function loadDraft(storage: Storage | null = tabStorage()): KeptDraft | null {
  const kept = readKept(storage, DRAFT_KEY)
  if (typeof kept !== 'object' || kept === null) return null
  const { app, issues, history, stamp } = kept as Record<string, unknown>
  try {
    if (!Array.isArray(issues) || !issues.every(issue => typeof issue === 'string') || !Array.isArray(history)) return null
    validatePromptHistory(history as PromptMessage[])
    return { app: parseGeneratedApp(app), issues: issues as string[], history: history as PromptMessage[], ...(isStamp(stamp) ? { stamp } : {}) }
  } catch {
    return null
  }
}

/** Keeps the draft until the tab closes. A storage that refuses it keeps what it had. */
export function saveDraft(draft: KeptDraft, storage: Storage | null = tabStorage()): void {
  keep(storage, DRAFT_KEY, draft)
}

/** Forgets the draft: it was opened, or thrown away. */
export function clearDraft(storage: Storage | null = tabStorage()): void {
  forgetKept(storage, DRAFT_KEY)
}

function isStamp(value: unknown): value is DraftStamp {
  if (typeof value !== 'object' || value === null) return false
  const { attempt, sentAt, project } = value as Record<string, unknown>
  return Number.isInteger(attempt) && Number.isFinite(sentAt) && (project === null || typeof project === 'string')
}
