'use client'

import { Component, useState, type ReactNode } from 'react'
import { crashIfTesting, downloadLatestWork, leave } from '../lib/recovery'
import styles from './Recovery.module.css'

export type PaneArea = 'canvas' | 'preview' | 'settings' | 'navigator' | 'editor'

const NAMES: Record<PaneArea, string> = {
  canvas: 'The canvas',
  preview: 'The preview',
  settings: 'Settings',
  navigator: 'The left panel',
  editor: 'The code editor',
}

interface PaneBoundaryProps {
  area: PaneArea
  /**
   * What the panel is drawn from. A crash is usually caused by what it was drawing,
   * so once any of these changes - an Undo, another edit, a new compile - the panel
   * tries again by itself.
   */
  resetKeys: readonly unknown[]
  /** Stays usable inside the fallback - the preview keeps its Undo and Redo here. */
  keep?: ReactNode
  children: ReactNode
}

interface PaneBoundaryState {
  error: unknown
}

/**
 * Retries in a burst that mean a loop rather than a series of fixes: past this many
 * within a second, only Try again retries. Each retry already waits for a new
 * change, so this is a backstop, not the rule.
 */
const BURST = 5
const BURST_MS = 1_000

/**
 * Keeps a crash inside the panel it happened in.
 *
 * Without it one exception anywhere blanked the whole studio. Now the panel says it
 * stopped, the rest of the studio keeps working, and the next change to what the
 * panel draws brings it back. The panel is never remounted while it is healthy: keys
 * only matter once it has failed.
 */
export class PaneBoundary extends Component<PaneBoundaryProps, PaneBoundaryState> {
  override state: PaneBoundaryState = { error: null }
  /** The keys the panel failed with, or last retried with; a change from these is worth a try. */
  private failedWith: readonly unknown[] = []
  /** When the panel last retried by itself. */
  private retries: number[] = []

  static getDerivedStateFromError(error: unknown): PaneBoundaryState {
    return { error }
  }

  override componentDidMount(): void {
    if (this.state.error !== null) this.failedWith = this.props.resetKeys
  }

  override componentDidUpdate(_previous: PaneBoundaryProps, previousState: PaneBoundaryState): void {
    if (this.state.error === null) return
    const { resetKeys } = this.props
    // Just failed: remember what with. Comparing now would retry at once, and fail again.
    if (previousState.error === null) {
      this.failedWith = resetKeys
      return
    }
    const changed = resetKeys.length !== this.failedWith.length || resetKeys.some((key, index) => !Object.is(key, this.failedWith[index]))
    if (!changed) return
    // A retry that fails again inside the same render never reports a healthy panel in
    // between, so the keys it is tried with are recorded now: the next retry needs a
    // change after this one.
    this.failedWith = resetKeys
    const now = Date.now()
    this.retries = [...this.retries.filter(at => now - at < BURST_MS), now]
    if (this.retries.length > BURST) return
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { area, keep, children } = this.props
    if (this.state.error === null) return <><CrashProbe area={area} />{children}</>
    return <PaneFallback area={area} keep={keep} onRetry={() => { this.retries = []; this.setState({ error: null }) }} />
  }
}

/** Throws for the recovery tests, and does nothing for anybody else. */
function CrashProbe({ area }: { area: PaneArea }) {
  crashIfTesting(area)
  return null
}

function PaneFallback({ area, keep, onRetry }: { area: PaneArea; keep?: ReactNode; onRetry: () => void }) {
  const [status, setStatus] = useState<string | null>(null)
  const download = () => void downloadLatestWork()
    .then(outcome => setStatus(outcome === 'nothing' ? 'No saved project was found in this browser.' : 'Downloaded a copy of your project.'))
    .catch(() => setStatus('The download could not be made.'))
  const go = (to: 'reload' | 'another') => void leave(to).then(outcome => {
    if (outcome === 'unsaved') setStatus('Your latest changes could not be saved. Download a copy first.')
  })
  return (
    <section className={styles.panel} data-testid="recovery-panel" data-area={area} role="alert">
      <strong>{NAMES[area]} stopped working</strong>
      <p>The rest of the studio still works. Undo your last change, or try again.</p>
      <div className={styles.actions}>
        <button type="button" data-primary onClick={onRetry}>Try again</button>
        <button type="button" onClick={download}>Download my project</button>
        <button type="button" onClick={() => go('reload')}>Reload</button>
        <button type="button" onClick={() => go('another')}>Open another project</button>
      </div>
      {status && <p className={styles.status} role="status">{status}</p>}
      {keep && <div className={styles.keep}>{keep}</div>}
    </section>
  )
}
