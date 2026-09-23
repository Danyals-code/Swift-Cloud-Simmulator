'use client'

import type { StorageProblem } from '../lib/storageProblem'
import { useRecoveryActions } from './Recovery'
import { Icon } from './ui/Icon'
import styles from './Recovery.module.css'

/**
 * Says so, and stays, while the studio cannot keep the participant's work (B2, B3).
 *
 * A small "Could not save" beside the project name used to be the only sign, and the
 * reason behind it was thrown away. This names what went wrong, hands the work over as
 * a file, and offers the one thing that can help: trying again, or a reload.
 */
export function StorageBanner({ problem, onRetry }: { problem: StorageProblem | null; onRetry: () => void }) {
  const { status, busy, download, go } = useRecoveryActions()
  if (!problem) return null
  const { title, detail } = describe(problem)
  // The participant chose to reload here, so the browser need not ask them again.
  const reload = <button type="button" data-primary={problem.kind === 'unreadable' || undefined} disabled={busy} onClick={() => go('reload', true)}>Reload</button>
  return (
    <div role="alert" data-testid="save-banner" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-xc-line bg-xc-warn/15 px-3 py-1.5 text-[12px] leading-snug text-xc-text">
      <Icon name="warning" size={14} className="shrink-0 text-xc-warn" />
      <p className="min-w-[240px] flex-1"><strong>{title}</strong> {detail}</p>
      {status && <p role="status" className="text-xc-text-2">{status}</p>}
      <span className={styles.actions}>
        {problem.kind !== 'unreadable' && <button type="button" data-primary disabled={busy} onClick={download}>Download my project</button>}
        {problem.kind === 'failing' && <button type="button" onClick={onRetry}>Try again</button>}
        {(problem.kind === 'outdated' || problem.kind === 'unreadable') && reload}
      </span>
    </div>
  )
}

function describe(problem: StorageProblem): { title: string; detail: string } {
  switch (problem.kind) {
    case 'outdated': return { title: 'This project was changed in another tab.', detail: 'This tab’s copy is older, so it was not saved. Download it if you need anything from here, then reload to open the newer version.' }
    case 'failing': return { title: 'Your latest changes are not saved.', detail: `${problem.detail} Download a copy to keep them, and keep this tab open.` }
    case 'memory': return { title: 'This browser is not saving your work.', detail: 'It will be gone when this tab closes. Download your project before you close it, and use a normal browser window rather than a private one.' }
    case 'unreadable': return { title: 'Your saved projects could not be opened.', detail: `${problem.detail} Reload to try again.` }
  }
}
