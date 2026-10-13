'use client'

import { RecoveryScreen } from '../components/Recovery'
import { crashIfTesting } from '../lib/recovery'

/**
 * The studio crashed while rendering, or its code failed to load.
 *
 * Next's `retry` is deliberately unused: a failed code chunk stays failed until the
 * page reloads, and a crash caused by the project would only repeat.
 */
export default function StudioError({ error }: { error: Error & { digest?: string } }) {
  crashIfTesting('document')
  return <RecoveryScreen error={error} />
}
