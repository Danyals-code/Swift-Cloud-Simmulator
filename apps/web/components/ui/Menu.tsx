'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

/**
 * Menus, and the popup buttons built on them.
 *
 * A native `<select>` draws its list with the operating system, which is the right
 * answer on macOS - where it *is* the menu Xcode uses - and the wrong one
 * everywhere else: on Windows the same markup renders a Win32 combobox, grey
 * chrome and all, in the middle of a dark toolbar. Since the studio has to look
 * the same on every machine, the list is drawn here.
 *
 * What that costs is everything the platform was doing for free, so it is all
 * reimplemented rather than skipped: roving focus with the arrow keys, Home/End,
 * Escape to dismiss, Enter to choose, click-outside, and a panel that flips above
 * its trigger when there is no room below.
 *
 * The panel is `position: fixed` against the viewport rather than absolute inside
 * the trigger. Every pane in the studio clips its overflow, so an absolutely
 * positioned menu would be cut off by the first one it grew past.
 */

export interface MenuItem {
  readonly value: string
  readonly label: string
  /** Trailing dimmed text - a shortcut, a file name. Kept short: it never wraps. */
  readonly detail?: string
  /** The longer sentence, on hover, for a row whose detail is a word. */
  readonly title?: string
  readonly icon?: IconName
  readonly disabled?: boolean
  /** Draws a separator above this item. */
  readonly separated?: boolean
}

interface Anchor {
  readonly x: number
  readonly y: number
  readonly width: number
  /** Where the trigger's bottom edge is, so the panel can flip above it. */
  readonly bottom: number
  readonly top: number
}

const ROW_HEIGHT = 22

/**
 * The floating list.
 *
 * Exported because the navigator's right-click menu needs the same panel anchored
 * to a point rather than to a trigger, and two implementations of a menu would
 * drift apart within a week.
 */
export function MenuPanel({
  items,
  selected,
  anchor,
  matchTriggerWidth = false,
  testId,
  onChoose,
  onDismiss,
}: {
  items: readonly MenuItem[]
  selected?: string
  anchor: Anchor
  matchTriggerWidth?: boolean
  testId?: string
  onChoose: (value: string) => void
  onDismiss: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const enabled = items.filter((item) => !item.disabled)
  const [active, setActive] = useState(() => {
    const index = items.findIndex((item) => item.value === selected && !item.disabled)
    return index >= 0 ? index : items.findIndex((item) => !item.disabled)
  })
  const [placement, setPlacement] = useState<{ left: number; top: number; width?: number }>({
    left: anchor.x,
    top: anchor.bottom + 4,
  })

  // Measured after mount rather than estimated from the item count: a row with a
  // long detail string wraps, and a guessed height flips the panel above the
  // trigger when it would have fitted below.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const height = panel.offsetHeight
    const width = panel.offsetWidth
    const roomBelow = window.innerHeight - anchor.bottom - 8

    const top = height <= roomBelow ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4)
    const left = Math.min(Math.max(8, anchor.x), window.innerWidth - width - 8)

    setPlacement({ left, top, ...(matchTriggerWidth ? { width: anchor.width } : {}) })
  }, [anchor, matchTriggerWidth])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
        return
      }

      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      if (step !== 0) {
        event.preventDefault()
        setActive((current) => {
          // Walks past disabled rows rather than stopping on them, so holding an
          // arrow key never appears to jam.
          for (let i = 1; i <= items.length; i++) {
            const next = (current + step * i + items.length * i) % items.length
            if (!items[next]?.disabled) return next
          }
          return current
        })
        return
      }

      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        const target = event.key === 'Home' ? enabled[0] : enabled[enabled.length - 1]
        if (target) setActive(items.indexOf(target))
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const item = items[active]
        if (item && !item.disabled) onChoose(item.value)
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [items, enabled, active, onChoose, onDismiss])

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return (
    <>
      {/*
        The dismissal surface. A transparent fixed layer rather than a document
        listener, so the click that closes the menu does not also land on whatever
        was behind it - closing a menu and activating a button in one press is a
        misfire every time.
      */}
      <div className="fixed inset-0 z-[900]" onPointerDown={onDismiss} />

      <div
        ref={panelRef}
        role="listbox"
        tabIndex={-1}
        data-testid={testId}
        style={{ left: placement.left, top: placement.top, minWidth: placement.width }}
        className="fixed z-[901] max-h-[60vh] min-w-[160px] overflow-auto rounded-md border border-xc-line bg-xc-panel py-[5px] shadow-[0_8px_30px_rgb(0_0_0/0.12)]"
      >
        {items.map((item, index) => {
          const isSelected = item.value === selected
          const isActive = index === active

          return (
            <div key={item.value}>
              {item.separated && index > 0 ? (
                <div className="my-[5px] h-px bg-xc-line-soft" role="separator" />
              ) : null}

              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={item.disabled}
                data-testid={testId ? `${testId}-${item.value}` : undefined}
                // Pointer-down rather than click: the dismissal layer above sees
                // pointer-down first, and a click handler would never run.
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!item.disabled) onChoose(item.value)
                }}
                onPointerEnter={() => !item.disabled && setActive(index)}
                title={item.title}
                className={`flex w-full items-center gap-2 px-2 text-left text-[14px] leading-none disabled:opacity-40 ${
                  isActive && !item.disabled ? 'bg-xc-accent text-xc-text' : 'text-xc-text'
                }`}
                style={{ height: ROW_HEIGHT, borderRadius: 4 }}
              >
                <span className="w-3 shrink-0">
                  {isSelected ? <Icon name="check" size={11} weight={2} /> : null}
                </span>
                {item.icon ? <Icon name={item.icon} size={13} /> : null}
                <span className="truncate">{item.label}</span>
                {item.detail ? (
                  <span
                    className={`ml-auto shrink-0 pl-4 text-[13px] ${
                      isActive && !item.disabled ? 'text-xc-text/70' : 'text-xc-text-3'
                    }`}
                  >
                    {item.detail}
                  </span>
                ) : null}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** Reads a trigger element's position for the panel to hang off. */
function anchorOf(element: HTMLElement | null): Anchor | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.top, width: rect.width, bottom: rect.bottom, top: rect.top }
}

export interface PopupButtonProps {
  items: readonly MenuItem[]
  value: string
  onChange: (value: string) => void
  /** Accessible name. The button itself shows only the current value. */
  label: string
  title?: string
  testId?: string
  className?: string
  /** Shown instead of the value's label when nothing matches - an action menu's verb. */
  placeholder?: string
}

/**
 * A popup button: the current value, a chevron, and the menu behind it.
 *
 * The direct replacement for a `<select>`, and it keeps the two things about one
 * that matter to a test - a stable `data-testid` on the trigger, and one per
 * option - so choosing an item stays a two-line affair from Playwright.
 */
export function PopupButton({
  items,
  value,
  onChange,
  label,
  title,
  testId,
  className,
  placeholder,
}: PopupButtonProps) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const current = items.find((item) => item.value === value)

  const close = useCallback(() => {
    setAnchor(null)
    ref.current?.focus()
  }, [])

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        aria-label={label}
        title={title ?? label}
        data-testid={testId}
        onPointerDown={(event) => {
          event.preventDefault()
          setAnchor((open) => (open ? null : anchorOf(ref.current)))
        }}
        className={
          className ??
          'flex h-[22px] items-center gap-1.5 rounded-[5px] border border-xc-line bg-xc-line-soft px-2 text-[14px] text-xc-text transition-colors hover:bg-xc-line-soft active:bg-xc-line-soft'
        }
      >
        <span className="truncate">{current?.label ?? placeholder ?? value}</span>
        <Icon name="chevron-up-down" size={11} className="text-xc-text-2" />
      </button>

      {anchor ? (
        <MenuPanel
          items={items}
          selected={value}
          anchor={anchor}
          testId={testId ? `${testId}-menu` : undefined}
          onChoose={(next) => {
            close()
            onChange(next)
          }}
          onDismiss={close}
        />
      ) : null}
    </>
  )
}

export interface MenuButtonProps {
  items: readonly MenuItem[]
  onSelect: (value: string) => void
  children: React.ReactNode
  label: string
  title?: string
  testId?: string
  className?: string
}

/**
 * A menu with no current value - a list of actions rather than a choice.
 *
 * Separate from `PopupButton` because the two differ in more than styling: there
 * is nothing to show a checkmark against, and the trigger's label is fixed rather
 * than reflecting the last thing picked.
 */
export function MenuButton({
  items,
  onSelect,
  children,
  label,
  title,
  testId,
  className,
}: MenuButtonProps) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  const close = useCallback(() => {
    setAnchor(null)
    ref.current?.focus()
  }, [])

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={label}
        title={title ?? label}
        data-testid={testId}
        onPointerDown={(event) => {
          event.preventDefault()
          setAnchor((open) => (open ? null : anchorOf(ref.current)))
        }}
        className={className}
      >
        {children}
      </button>

      {anchor ? (
        <MenuPanel
          items={items}
          anchor={anchor}
          testId={testId ? `${testId}-menu` : undefined}
          onChoose={(next) => {
            close()
            onSelect(next)
          }}
          onDismiss={close}
        />
      ) : null}
    </>
  )
}

/**
 * A right-click menu at a point.
 *
 * Anchored to the pointer rather than to an element, which is the one thing a
 * context menu does differently - everything else, including the keyboard
 * handling, is the same panel.
 */
export function ContextMenu({
  items,
  at,
  onSelect,
  onDismiss,
  testId,
}: {
  items: readonly MenuItem[]
  at: { x: number; y: number }
  onSelect: (value: string) => void
  onDismiss: () => void
  testId?: string
}) {
  return (
    <MenuPanel
      items={items}
      anchor={{ x: at.x, y: at.y, width: 0, top: at.y, bottom: at.y }}
      testId={testId}
      onChoose={(value) => {
        onDismiss()
        onSelect(value)
      }}
      onDismiss={onDismiss}
    />
  )
}
