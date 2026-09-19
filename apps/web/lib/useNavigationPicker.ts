'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavigationDestination } from '@studio/shared'

/** An in-progress pick belongs to the source selection that requested it. */
export function useNavigationPicker(identity: object, enabled: boolean) {
  type Pick = { identity: object; destinations: readonly NavigationDestination[]; resolve: (expression: string | null) => void }
  const pending = useRef<Pick | null>(null)
  const [pick, setPick] = useState<Pick | null>(null)
  const finish = useCallback((expression: string | null) => {
    const previous = pending.current
    pending.current = null
    setPick(null)
    previous?.resolve(expression)
  }, [])
  const start = useCallback((destinations: readonly NavigationDestination[]): Promise<string | null> => {
    if (!enabled) return Promise.resolve(null)
    pending.current?.resolve(null)
    return new Promise(resolve => {
      const next = { identity, destinations, resolve }
      pending.current = next
      setPick(next)
    })
  }, [identity, enabled])
  useEffect(() => () => {
    if (pending.current?.identity === identity) {
      pending.current.resolve(null)
      pending.current = null
    }
  }, [identity])
  const active = enabled && pick?.identity === identity ? pick : null
  useEffect(() => {
    if (!active) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      finish(null)
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [active, finish])
  return { destinations: active?.destinations, start, finish }
}
