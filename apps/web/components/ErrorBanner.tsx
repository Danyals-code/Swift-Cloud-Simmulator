'use client'

import { useEffect, useState } from 'react'
import { isReportable } from '../lib/recovery'
import { useRecoveryActions } from './Recovery'
import styles from './Recovery.module.css'

/**
 * Says so when something failed outside any panel - a click handler, a timer, a
 * promise - without stopping anybody: the studio is usually still fine, so this asks
 * for nothing and offers a copy of the work.
 */
export function ErrorBanner() {
  const [failures, setFailures] = useState(0)
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
  return <Banner failures={failures} onDismiss={() => setFailures(0)} />
}

/** A component of its own, so dismissing the banner also forgets what its download said. */
function Banner({ failures, onDismiss }: { failures: number; onDismiss: () => void }) {
  const { status, busy, download } = useRecoveryActions()
  return (
    <div className={styles.banner} role="status" data-testid="recovery-banner">
      <p><strong>Something did not finish.</strong> Your project is still open and you can keep working{failures > 1 ? ` (${failures} times)` : ''}. To be safe, download a copy.</p>
      {status && <p className={styles.status}>{status}</p>}
      <div className={styles.actions}>
        <button type="button" data-primary disabled={busy} onClick={download}>Download my project</button>
        <button type="button" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  )
}
