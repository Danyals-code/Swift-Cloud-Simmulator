'use client'

import { useCallback, useEffect, useRef } from 'react'

export interface SplitterProps {
  /** `col` drags left/right and resizes a column; `row` drags up/down. */
  orientation: 'col' | 'row'
  /** Current size of the pane being resized, in px. */
  size: number
  onResize: (size: number) => void
  min: number
  max: number
  /**
   * Which way a positive pointer delta moves the size.
   *
   * A handle on a pane's right edge grows it as the pointer moves right (`1`); one
   * on its left edge grows it as the pointer moves left (`-1`). Getting this wrong
   * makes the pane run away from the cursor, so it is stated rather than inferred.
   */
  direction: 1 | -1
  label: string
  /** Collapses or restores the pane. Double-clicking the handle, as AppKit does. */
  onToggle?: () => void
}

/**
 * A draggable pane divider.
 *
 * The visible rule is one pixel and the grab target is nine, centred on it and
 * overhanging both panes. A one-pixel hit area is the single most common way a
 * split view feels broken, and the overhang is invisible because the handle is
 * transparent until you are on it.
 *
 * The drag listens on the window rather than the handle: the pointer leaves a
 * nine-pixel strip immediately, and a handler bound to the element would stop
 * tracking the moment it did. `setPointerCapture` would also work, but not across
 * the re-render that resizing causes - the captured element is gone by the next
 * frame.
 */
export function Splitter({
  orientation,
  size,
  onResize,
  min,
  max,
  direction,
  label,
  onToggle,
}: SplitterProps) {
  const dragging = useRef<{ origin: number; start: number } | null>(null)
  const horizontal = orientation === 'col'

  /**
   * The drag's inputs, read at pointer-move time rather than captured.
   *
   * `onResize` is an inline closure in every caller, so it is a new function on
   * every render - and a window listener re-subscribed on every render takes its
   * cleanup with it. That cleanup used to end the drag, which made the first
   * resize cancel the gesture that caused it: the divider moved one pixel per
   * press and the panes looked fixed. Keeping the handler in a ref means the
   * listeners are attached once and the drag survives the re-render it triggers.
   */
  const latest = useRef({ onResize, direction, horizontal })
  useEffect(() => {
    latest.current = { onResize, direction, horizontal }
  })

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      dragging.current = {
        origin: horizontal ? event.clientX : event.clientY,
        start: size,
      }
      document.body.dataset.resizing = orientation
    },
    [horizontal, orientation, size],
  )

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragging.current
      if (!drag) return
      const { onResize: resize, direction: sign, horizontal: sideways } = latest.current
      const now = sideways ? event.clientX : event.clientY
      resize(drag.start + (now - drag.origin) * sign)
    }

    const up = () => {
      if (!dragging.current) return
      dragging.current = null
      delete document.body.dataset.resizing
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    // Only on unmount, and the drag is ended there because the handle it was
    // following has gone - a pane that is collapsed mid-drag leaves the body
    // marked as resizing otherwise.
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      up()
    }
  }, [])

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-testid={`splitter-${label.toLowerCase().replace(/\s+/g, '-')}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onToggle}
      // Arrow keys move it too. A split view that can only be adjusted with a
      // pointer is unusable to anyone driving the app from the keyboard, and the
      // handle is already focusable for the screen reader's sake.
      onKeyDown={(event) => {
        const back = horizontal ? 'ArrowLeft' : 'ArrowUp'
        const forward = horizontal ? 'ArrowRight' : 'ArrowDown'
        if (event.key !== back && event.key !== forward) return
        event.preventDefault()
        const step = (event.shiftKey ? 32 : 8) * (event.key === forward ? 1 : -1) * direction
        onResize(size + step)
      }}
      className={`group relative z-20 shrink-0 bg-xc-line ${
        horizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
      }`}
    >
      <span
        aria-hidden
        className={`absolute transition-colors group-hover:bg-xc-accent/50 group-focus-visible:bg-xc-accent ${
          horizontal ? '-inset-x-1 inset-y-0' : '-inset-y-1 inset-x-0'
        }`}
      />
    </div>
  )
}
