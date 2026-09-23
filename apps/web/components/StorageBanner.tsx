'use client'

import { useRecoveryActions } from './Recovery'
import { Icon } from './ui/Icon'
import styles from './Recovery.module.css'

/**
 * Says so, and stays, while the studio cannot keep the participant's work (B2, B3).
 *
 * A small "Could not save" beside the project name used to be the only sign, and the
 * reason behind it was thrown away. This names what went wrong and hands the work over
 * as a file, until a save works again.
 */
export function StorageBanner({ saveError, loadError, durable, onRetry }: {
  saveError: string | null
  loadError: string | null
  /** False when the browser gave the studio nowhere to keep anything. */
  durable: boolean
  onRetry: () => void
}) {
  const { status, busy, download } = useRecoveryActions()
  const problem = saveError
    ? { title: 'Your latest changes are not saved.', detail: `${saveError} Download a copy to keep them, and keep this tab open.`, action: 'retry' as const }
    : !durable
      ? { title: 'This browser is not saving your work.', detail: 'It will be gone when this tab closes. Download your project before you close it, and use a normal browser window rather than a private one.', action: null }
      : loadError
        ? { title: 'Your saved projects could not be opened.', detail: `${loadError} Reload to try again.`, action: 'reload' as const }
        : null
  if (!problem) return null
  return (
    <div role="alert" data-testid="save-banner" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-xc-line bg-xc-warn/15 px-3 py-1.5 text-[12px] leading-snug text-xc-text">
      <Icon name="warning" size={14} className="shrink-0 text-xc-warn" />
      <p className="min-w-[240px] flex-1"><strong>{problem.title}</strong> {problem.detail}</p>
      {status && <p role="status" className="text-xc-text-2">{status}</p>}
      <span className={styles.actions}>
        {problem.action !== 'reload' && <button type="button" data-primary disabled={busy} onClick={download}>Download my project</button>}
        {problem.action === 'retry' && <button type="button" onClick={onRetry}>Try again</button>}
        {problem.action === 'reload' && <button type="button" data-primary onClick={() => location.reload()}>Reload</button>}
      </span>
    </div>
  )
}
