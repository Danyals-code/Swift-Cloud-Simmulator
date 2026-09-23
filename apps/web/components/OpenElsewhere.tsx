'use client'

import { useState } from 'react'
import { takeOverStudio } from '../lib/activeTab'
import styles from './Recovery.module.css'

/**
 * What a tab without the studio shows (B1): whose it is, and how to have it here.
 *
 * Over the whole page, whether this tab never had the studio or has just handed it
 * to another. Taking it back waits for the other tab to save first.
 */
export function OpenElsewhere() {
  const [taking, setTaking] = useState(false)
  return (
    <div className={`${styles.screen} ${styles.cover}`} data-testid="open-elsewhere">
      <div className={styles.card} role="alertdialog" aria-modal="true" aria-labelledby="open-elsewhere-title">
        <h1 id="open-elsewhere-title">Swift Web Studio is open in another tab</h1>
        <p>The studio works in one tab at a time, so that neither tab saves over the other’s work. Use it here, and the other tab saves and steps aside.</p>
        <div className={styles.actions}>
          <button type="button" data-primary disabled={taking} autoFocus onClick={() => { setTaking(true); void takeOverStudio() }}>Use it here</button>
        </div>
        {taking && <p className={styles.status} role="status">Waiting for the other tab to save…</p>}
      </div>
    </div>
  )
}
