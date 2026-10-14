'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './Popover.module.css'

export interface PopoverProps {
  /** Names the dialog for assistive tech. */
  readonly label: string
  readonly testId: string
  /** What it opened from, in the viewport. */
  readonly anchor: DOMRect
  /** Where focus goes as it opens: the first element each selector finds, in order. */
  readonly focus: readonly string[]
  readonly onClose: () => void
  readonly children: ReactNode
}

/**
 * What a field opens over the panel, the colours or a linked token's actions: under what it
 * opened from, or above it where there is no room below. It floats in a portal, as the menus
 * do, because every pane clips what grows past it, and a press outside, a scroll of the pane
 * under it, a resize or Escape closes it.
 */
export function Popover({ label, testId, anchor, focus, onClose, children }: PopoverProps) {
  const panel = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState({ left: anchor.left, top: anchor.bottom + 4 })

  useLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    const below = window.innerHeight - anchor.bottom - 8
    const top = element.offsetHeight <= below ? anchor.bottom + 4 : Math.max(8, anchor.top - element.offsetHeight - 4)
    setPlacement({ left: Math.min(Math.max(8, anchor.left), window.innerWidth - element.offsetWidth - 8), top })
  }, [anchor])

  // The field's close handler is new each time it draws; the listeners below are added once.
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  const first = useRef(focus)
  useEffect(() => {
    for (const selector of first.current) {
      const element = panel.current?.querySelector<HTMLElement>(selector)
      if (element) { element.focus(); break }
    }
    // The pane under it scrolling would leave it pointing at nothing.
    const dismiss = (event: Event) => { if (!(event.target instanceof Node && panel.current?.contains(event.target))) close.current() }
    // Escape closes it before the canvas hears it, which would let the view go.
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current() } }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); window.removeEventListener('keydown', escape, true) }
  }, [])

  return createPortal(<>
    <div className={styles.scrim} onPointerDown={event => { event.stopPropagation(); onClose() }} />
    <div ref={panel} role="dialog" aria-label={label} className={styles.popover} style={placement} data-testid={testId}>{children}</div>
  </>, document.body)
}
