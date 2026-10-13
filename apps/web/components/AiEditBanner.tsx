'use client'

import { useStudio, type AiEditPhase } from '../lib/store'
import { Icon } from './ui/Icon'
import styles from './Recovery.module.css'

/** What the banner says the AI is doing, in each phase of its edit. */
const DOING = { editing: 'The AI is editing this project.', checking: 'The AI is checking its changes.', fixing: 'The AI is fixing an error in its change.' } satisfies Record<AiEditPhase, string>

/**
 * Says why editing has paused while the AI edits the project, and offers Stop (G12).
 *
 * The answer is planned against the project as it was sent, so a change made while
 * waiting would throw it away after the provider has billed for it. Nothing changes
 * the project until the answer lands; this says so wherever Prompt Editing is, even
 * with the panel collapsed.
 */
export function AiEditBanner() {
  const aiEdit = useStudio(state => state.aiEdit)
  if (!aiEdit) return null
  return (
    <div role="status" data-testid="ai-edit-banner" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-xc-line bg-xc-accent/10 px-3 py-1.5 text-[12px] leading-snug text-xc-text">
      <Icon name="refresh" size={14} className="shrink-0 animate-spin" />
      <p className="min-w-[240px] flex-1"><strong>{DOING[aiEdit.phase]}</strong> Editing is paused until it finishes, so its answer is not lost.</p>
      <span className={styles.actions}>
        <button type="button" onClick={() => useStudio.getState().stopAiEdit()}>Stop</button>
      </span>
    </div>
  )
}
