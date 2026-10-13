'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

const ROW_HEIGHT = 26

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
  highlight = true,
  testId,
  onChoose,
  onDismiss,
}: {
  items: readonly MenuItem[]
  selected?: string
  anchor: Anchor
  matchTriggerWidth?: boolean
  /**
   * Whether a row starts highlighted. A menu opened from the keyboard needs one for
   * the arrow keys to move from; one opened with the pointer starts with none, as on
   * macOS, until the pointer or a key picks a row.
   */
  highlight?: boolean
  testId?: string
  onChoose: (value: string) => void
  onDismiss: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const id = useId()
  const enabled = items.filter((item) => !item.disabled)
  const [active, setActive] = useState(() => {
    const index = items.findIndex((item) => item.value === selected && !item.disabled)
    if (index >= 0) return index
    return highlight ? items.findIndex((item) => !item.disabled) : -1
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

      if (event.key === 'Tab') { onDismiss(); return }

      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      if (step !== 0) {
        event.preventDefault()
        event.stopPropagation()
        setActive((current) => {
          // Nothing highlighted yet: the first arrow lands on the first or last row.
          if (current < 0) current = step > 0 ? items.length - 1 : 0
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
        event.stopPropagation()
        const target = event.key === 'Home' ? enabled[0] : enabled[enabled.length - 1]
        if (target) setActive(items.indexOf(target))
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
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

  useEffect(() => {
    panelRef.current?.querySelector(`[data-menu-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  useEffect(() => {
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      onDismiss()
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => { window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true) }
  }, [onDismiss])

  // Portals keep panel-specific button rules and clipping out of the menu.
  // React events still bubble through the trigger's tree, so stop them here.
  return createPortal(
    <>
      {/*
        The dismissal surface. A transparent fixed layer rather than a document
        listener, so the click that closes the menu does not also land on whatever
        was behind it - closing a menu and activating a button in one press is a
        misfire every time.
      */}
      <div className="fixed inset-0 z-[900]" onPointerDown={event => { event.stopPropagation(); onDismiss() }} onClick={event => event.stopPropagation()} />

      <div
        ref={panelRef}
        role="listbox"
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        onClick={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
        onPointerLeave={() => setActive(-1)}
        tabIndex={-1}
        data-testid={testId}
        style={{ left: placement.left, top: placement.top, minWidth: placement.width }}
        // A macOS menu: translucent material, 8px corners, rows inset by 5px, and a
        // short drop-in so it reads as coming from its trigger rather than blinking on.
        className="fixed z-[901] max-h-[60vh] min-w-[200px] max-w-[calc(100vw-16px)] origin-top animate-[xc-pop-in_140ms_cubic-bezier(0.2,0.8,0.2,1)] overflow-auto rounded-lg bg-[color-mix(in_srgb,var(--color-xc-panel)_90%,transparent)] p-[5px] shadow-[var(--shadow-popover)] backdrop-blur-xl backdrop-saturate-150"
      >
        {items.map((item, index) => {
          const isSelected = item.value === selected
          const isActive = index === active

          return (
            <div key={item.value}>
              {item.separated && index > 0 ? (
                <div className="mx-2 my-[5px] h-px bg-xc-line" role="separator" />
              ) : null}

              <button
                type="button"
                role="option"
                id={`${id}-${index}`}
                data-menu-index={index}
                tabIndex={-1}
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
                // Highlighted rows are filled with the accent and drawn in white,
                // as every macOS menu is.
                className={`flex w-full items-center gap-2 rounded-[var(--radius-thumb)] pl-1.5 pr-2.5 text-left text-body disabled:opacity-40 ${
                  isActive && !item.disabled ? 'bg-xc-accent-fill text-white' : 'text-xc-text'
                }`}
                style={{ height: ROW_HEIGHT }}
              >
                <span className="grid w-3.5 shrink-0 place-items-center">
                  {isSelected ? <Icon name="check" size={12} weight={2} /> : null}
                </span>
                {item.icon ? <Icon name={item.icon} size={14} /> : null}
                <span className="truncate">{item.label}</span>
                {item.detail ? (
                  <span
                    className={`ml-auto shrink-0 pl-6 ${
                      isActive && !item.disabled ? 'text-white/75' : 'text-xc-text-3'
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
    </>, document.body
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
  /** What the button shows in place of the chosen item's label: Fit's actual percentage. */
  display?: string
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
  display,
}: PopupButtonProps) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const current = items.find((item) => item.value === value)

  const close = useCallback(() => {
    setAnchor(null)
    ref.current?.focus({ preventScroll: true })
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
        onKeyDown={(event) => {
          if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          // Pointer-down opens mouse menus; prevent the keyboard's synthetic click
          // from toggling the menu again after opening it here.
          setAnchor(anchorOf(ref.current))
        }}
        className={
          className ??
          'flex h-7 min-w-0 shrink-0 items-center gap-1 rounded-md bg-xc-fill pl-2.5 pr-1.5 text-body text-xc-text transition-colors duration-[120ms] hover:bg-xc-fill-strong aria-expanded:bg-xc-fill-strong'
        }
      >
        <span className="truncate">{display ?? current?.label ?? placeholder ?? value}</span>
        <Icon name="chevron-up-down" size={13} className="shrink-0 text-xc-text-2" />
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
  const [byKeyboard, setByKeyboard] = useState(false)

  const close = useCallback(() => {
    setAnchor(null)
    ref.current?.focus({ preventScroll: true })
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
          setByKeyboard(false)
          setAnchor((open) => (open ? null : anchorOf(ref.current)))
        }}
        onKeyDown={(event) => {
          if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          event.stopPropagation()
          // Pointer-down opens mouse menus; prevent the keyboard's synthetic click
          // from toggling the menu again after opening it here.
          setByKeyboard(true)
          setAnchor(anchorOf(ref.current))
        }}
        className={className}
      >
        {children}
      </button>

      {anchor ? (
        <MenuPanel
          items={items}
          anchor={anchor}
          highlight={byKeyboard}
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
      highlight={false}
      testId={testId}
      onChoose={(value) => {
        onDismiss()
        onSelect(value)
      }}
      onDismiss={onDismiss}
    />
  )
}
