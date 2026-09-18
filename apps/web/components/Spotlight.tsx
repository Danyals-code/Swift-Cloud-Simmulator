'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './AddView.module.css'

/** Shared focus management and motion for the studio's quick-open dialogs. */
export function Spotlight({ label, testId, onClose, children }: {
  label: string
  testId: string
  onClose: () => void
  children: (close: (after?: () => void) => void) => ReactNode
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [closing, setClosing] = useState(false)
  const close = useCallback((after?: () => void) => {
    if (timer.current !== null) return
    setClosing(true)
    const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140
    timer.current = setTimeout(() => { onClose(); after?.() }, delay)
  }, [onClose])
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
      requestAnimationFrame(() => { if (previous?.isConnected && !previous.closest('[inert]')) previous.focus() })
    }
  }, [])
  // The render prop attaches this callback to event handlers; it never invokes it here.
  // eslint-disable-next-line react-hooks/refs
  const content = children(close)
  return <div className={styles.backdrop} data-testid={testId} data-closing={closing || undefined}
    onPointerDown={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={dialog} className={styles.palette} role="dialog" aria-label={label} aria-modal="true"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
        if (event.key !== 'Tab') return
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled), [tabindex="0"]') ?? [])
        const first = items[0], last = items.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
      {content}
    </div>
  </div>
}
