'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { clampNumber, formatNumber, parseNumber, scrubbedValue, steppedValue, type NumberLimits } from '../../lib/numberScrub'
import styles from './NumberField.module.css'

export interface NumberFieldProps extends NumberLimits {
  /** Names the field for assistive tech. */
  readonly label: string
  /** What sits before the value and scrubs it when dragged: a short word such as W, or an icon. */
  readonly caption: ReactNode
  /** The value, or null for none, which shows the placeholder. */
  readonly value: number | null
  /**
   * Called once for each change: on Enter, on leaving the field, and when a scrub is let go,
   * so a scrub is one undo step. Resolve to false when the change was not made, and the
   * field shows the value it had.
   */
  readonly onCommit: (value: number) => unknown
  /** Given, an emptied field takes the value away, as a minimum or maximum can be, and calls this. */
  readonly onClear?: () => unknown
  readonly unit?: 'pt' | '%'
  /** How much a pixel of scrubbing or an arrow press adds: 1 unless said otherwise. */
  readonly step?: number
  readonly disabled?: boolean
  readonly placeholder?: string
  /** Shown over an empty field until it takes focus, such as the chip of a linked token. */
  readonly overlay?: ReactNode
  readonly title?: string
}

/**
 * A number, as Figma's panel takes one: drag the caption to scrub, one step a pixel and
 * ten with Shift; ArrowUp and ArrowDown nudge, Shift by ten; Enter or leaving the field
 * applies, and Escape puts the value back. Only numbers are typed here: a section shows a
 * token as a chip over the field, and typing a number replaces it.
 */
export function NumberField({ label, caption, value, onCommit, onClear, unit, step, min, max, integer, disabled = false, placeholder, overlay, title }: NumberFieldProps) {
  /** What is typed or scrubbed and not yet applied; null shows the value. */
  const [draft, setDraft] = useState<string | null>(null)
  /** The value on its way, shown until the code comes back with it. */
  const [applying, setApplying] = useState<number | null>(null)
  const [shown, setShown] = useState(value)
  // A new value from the code takes the place of whatever was typed for the old one.
  if (value !== shown) { setShown(value); setDraft(null); setApplying(null) }
  /** The drag under way: where it started, and the value it shows now, if it has moved. */
  const scrub = useRef<{ readonly x: number; readonly start: number; readonly pointer: number; value?: number } | null>(null)
  const stopEscape = useRef<(() => void) | null>(null)
  useEffect(() => () => stopEscape.current?.(), [])
  const limits = { min, max, integer, step }
  const current = applying ?? value
  const text = draft ?? (current === null ? '' : formatNumber(current))

  async function commit(typed: string | null) {
    if (typed === null) return
    if (onClear && !typed.trim() && current !== null) {
      setDraft(null)
      await onClear()
      return
    }
    const parsed = parseNumber(typed)
    if (parsed === null) { setDraft(null); return }
    const next = clampNumber(parsed, limits)
    setDraft(null)
    if (next === current) return
    setApplying(next)
    if (await onCommit(next) === false) setApplying(null)
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit(draft)
    } else if (event.key === 'Escape') {
      // The canvas would take Escape as letting go of the selection.
      event.preventDefault()
      event.stopPropagation()
      setDraft(null)
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const from = parseNumber(text) ?? current ?? 0
      setDraft(formatNumber(steppedValue(from, event.key === 'ArrowUp' ? 1 : -1, { ...limits, fast: event.shiftKey })))
    }
  }

  function endScrub(apply: boolean) {
    const gesture = scrub.current
    scrub.current = null
    stopEscape.current?.()
    stopEscape.current = null
    if (!gesture) return
    if (apply && gesture.value !== undefined) void commit(formatNumber(gesture.value))
    else setDraft(null)
  }

  function pointerDown(event: PointerEvent<HTMLSpanElement>) {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    scrub.current = { x: event.clientX, start: parseNumber(text) ?? current ?? 0, pointer: event.pointerId }
    const escape = (key: globalThis.KeyboardEvent) => {
      if (key.key !== 'Escape') return
      key.preventDefault()
      key.stopImmediatePropagation()
      endScrub(false)
    }
    document.addEventListener('keydown', escape, true)
    stopEscape.current = () => document.removeEventListener('keydown', escape, true)
  }

  function pointerMove(event: PointerEvent<HTMLSpanElement>) {
    const gesture = scrub.current
    if (!gesture || gesture.pointer !== event.pointerId) return
    gesture.value = scrubbedValue(gesture.start, event.clientX - gesture.x, { ...limits, fast: event.shiftKey })
    setDraft(formatNumber(gesture.value))
  }

  return <span className={styles.field} data-disabled={disabled || undefined} title={title}>
    <span className={styles.caption} aria-hidden="true" title={disabled ? undefined : `Drag to change ${label.toLowerCase()}`}
      onPointerDown={pointerDown} onPointerMove={pointerMove}
      onPointerUp={() => endScrub(true)} onPointerCancel={() => endScrub(false)} onLostPointerCapture={() => { if (scrub.current) endScrub(true) }}>{caption}</span>
    <input type="text" inputMode="decimal" aria-label={label} value={text} placeholder={placeholder} disabled={disabled}
      onChange={event => setDraft(event.target.value)} onKeyDown={keyDown} onBlur={() => void commit(draft)} />
    {overlay && draft === null && current === null && <span className={styles.overlay}>{overlay}</span>}
    {unit && <span className={styles.unit} aria-hidden="true">{unit}</span>}
  </span>
}
