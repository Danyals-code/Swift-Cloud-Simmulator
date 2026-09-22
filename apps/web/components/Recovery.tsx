'use client'

import { useEffect, useState } from 'react'
import { BUILD_NAME } from '../lib/build'
import { downloadLatestWork, isReportable, leave, type DownloadOutcome } from '../lib/recovery'
import styles from './Recovery.module.css'

const DOWNLOADED: Record<DownloadOutcome, string> = {
  archive: 'Downloaded. Keep the .swiftstudio.zip file: it opens here again later.',
  backup: 'Downloaded a backup copy (.json). It holds your project’s files and settings.',
  nothing: 'No saved project was found in this browser.',
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
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** A reload that waits for a yes, because the latest changes could not be saved. */
  const [unsaved, setUnsaved] = useState<'reload' | 'another' | null>(null)
  const loading = failedToLoad(error)
  const download = () => {
    setBusy(true)
    void downloadLatestWork()
      .then(outcome => setStatus(DOWNLOADED[outcome]))
      .catch(() => setStatus('The download could not be made. Try again, or reload.'))
      .finally(() => setBusy(false))
  }
  const go = (to: 'reload' | 'another', force = false) => {
    setBusy(true)
    void leave(to, force).then(outcome => {
      if (outcome === 'unsaved') { setUnsaved(to); setStatus('Your latest changes could not be saved. Download a copy first, or continue without them.') }
    }).finally(() => setBusy(false))
  }
  return (
    <main className={styles.screen} data-testid="recovery-screen" data-scope={scope}>
      <div className={styles.card} role="alert">
        <h1>{loading ? 'Swift Web Studio did not finish loading' : 'Something went wrong'}</h1>
        <p>{loading
          ? 'Part of the studio did not arrive. Reloading usually fixes this, and your work is kept in this browser.'
          : 'The studio stopped while drawing your project. Download a copy of your work first, then reload.'}</p>
        <div className={styles.actions}>
          <button type="button" data-primary={loading ? undefined : true} disabled={busy} onClick={download}>Download my project</button>
          <button type="button" data-primary={loading ? true : undefined} disabled={busy} onClick={() => go('reload')}>Reload</button>
          <button type="button" disabled={busy} onClick={() => go('another')}>Open another project</button>
          {unsaved && <button type="button" disabled={busy} onClick={() => go(unsaved, true)}>Continue without them</button>}
        </div>
        {status && <p className={styles.status} role="status">{status}</p>}
        <details className={styles.details}>
          <summary>Details for a report</summary>
          <code>{error instanceof Error ? error.message : String(error)}</code>
          <code>{BUILD_NAME}</code>
        </details>
      </div>
    </main>
  )
}

/**
 * Says so when something failed outside any panel - a click handler, a timer, a
 * promise - without stopping anybody: the studio is usually still fine, so this asks
 * for nothing and offers a copy of the work.
 */
export function ErrorBanner() {
  const [failures, setFailures] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => {
    const report = (event: ErrorEvent | PromiseRejectionEvent) => { if (isReportable(event)) setFailures(count => count + 1) }
    window.addEventListener('error', report)
    window.addEventListener('unhandledrejection', report)
    return () => {
      window.removeEventListener('error', report)
      window.removeEventListener('unhandledrejection', report)
    }
  }, [])
  if (failures === 0) return null
  const download = () => void downloadLatestWork()
    .then(outcome => setStatus(DOWNLOADED[outcome]))
    .catch(() => setStatus('The download could not be made.'))
  return (
    <div className={styles.banner} role="status" data-testid="recovery-banner">
      <p><strong>Something did not finish.</strong> Your project is still open and you can keep working{failures > 1 ? ` (${failures} times)` : ''}. To be safe, download a copy.</p>
      {status && <p className={styles.status}>{status}</p>}
      <div className={styles.actions}>
        <button type="button" data-primary onClick={download}>Download my project</button>
        <button type="button" onClick={() => { setFailures(0); setStatus(null) }}>Dismiss</button>
      </div>
    </div>
  )
}
