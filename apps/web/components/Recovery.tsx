'use client'

import { useEffect, useState } from 'react'
import { BUILD_DETAILS } from '../lib/build'
import { downloadLatestWork, leave, noteRecovery, type Destination, type DownloadOutcome } from '../lib/recovery'
import styles from './Recovery.module.css'

const DOWNLOADED: Record<DownloadOutcome, string> = {
  archive: 'Downloaded. Keep the .swiftstudio.zip file: it opens here again later.',
  backup: 'Downloaded a backup copy (.json) with your project’s files and settings. It keeps your work, but the studio cannot open it.',
  nothing: 'No saved project was found in this browser.',
}

/**
 * What every recovery surface offers: a copy of the work, and a way out that saves
 * first. When that save fails, leaving waits until the participant chooses - download
 * a copy first, or continue without the latest changes.
 *
 * The screen for a crashed studio lives here, with the page. The panel fallback and
 * the banner live with the studio and share these: anything else here would be
 * copied into every one of the page's error entries.
 */
export function useRecoveryActions() {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Where the participant was going when their latest changes could not be saved. */
  const [held, setHeld] = useState<Destination | null>(null)
  const download = () => {
    setBusy(true)
    void downloadLatestWork()
      .then(outcome => setStatus(DOWNLOADED[outcome]))
      .catch(() => setStatus('The download could not be made. Try again, or reload.'))
      .finally(() => setBusy(false))
  }
  const go = (to: Destination, force = false) => {
    setBusy(true)
    void leave(to, force).then(outcome => {
      if (outcome === 'unsaved') { setHeld(to); setStatus('Your latest changes could not be saved. Download a copy first, or continue without them.') }
    }).finally(() => setBusy(false))
  }
  return { status, busy, held, download, go }
}

type RecoveryActions = ReturnType<typeof useRecoveryActions>

/** Download, Reload and Open another project - and, once a save has failed, going on without it. */
export function RecoveryButtons({ actions, lead }: { actions: RecoveryActions; lead?: 'download' | 'reload' }) {
  const { busy, held, download, go } = actions
  return (
    <>
      <button type="button" data-primary={lead === 'download' || undefined} disabled={busy} onClick={download}>Download my project</button>
      <button type="button" data-primary={lead === 'reload' || undefined} disabled={busy} onClick={() => go('reload')}>Reload</button>
      <button type="button" disabled={busy} onClick={() => go('another')}>Open another project</button>
      {held && <button type="button" disabled={busy} onClick={() => go(held, true)}>Continue without them</button>}
    </>
  )
}

/** The part of the studio failed to arrive, rather than failing while it ran. */
function failedToLoad(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /ChunkLoadError|Failed to load chunk|dynamically imported module|Importing a module script failed/i.test(text)
}

/**
 * The whole-studio screen, for when the studio itself crashed.
 *
 * Downloading comes first: whatever happens next, the participant leaves with their
 * work. When the studio's code failed to arrive, Reload is the likely fix, so it
 * leads instead.
 */
export function RecoveryScreen({ error, scope = 'studio' }: { error: unknown; scope?: 'studio' | 'page' }) {
  const actions = useRecoveryActions()
  const loading = failedToLoad(error)
  useEffect(() => noteRecovery({ action: 'crashed', area: scope }), [scope])
  return (
    <main className={styles.screen} data-testid="recovery-screen" data-scope={scope}>
      <div className={styles.card} role="alert">
        <h1>{loading ? 'Swift Web Studio did not finish loading' : 'Something went wrong'}</h1>
        <p>{loading
          ? 'Part of the studio did not arrive. Reloading usually fixes this, and your work is kept in this browser.'
          : 'The studio stopped while drawing your project. Download a copy of your work first, then reload.'}</p>
        <div className={styles.actions}>
          <RecoveryButtons actions={actions} lead={loading ? 'reload' : 'download'} />
        </div>
        {actions.status && <p className={styles.status} role="status">{actions.status}</p>}
        <details className={styles.details}>
          <summary>Details for a report</summary>
          <code>{error instanceof Error ? error.message : String(error)}</code>
          <code>{BUILD_DETAILS}</code>
        </details>
      </div>
    </main>
  )
}
