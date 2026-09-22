'use client'

import { RecoveryScreen } from '../components/Recovery'

/**
 * The last resort, for when the page around the studio failed - including the
 * studio's own error screen. It replaces the root layout, so it brings its own
 * document; the screen's styles fall back to plain colours without the app's.
 */
export default function PageError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <title>Swift Web Studio</title>
        <RecoveryScreen error={error} scope="page" />
      </body>
    </html>
  )
}
