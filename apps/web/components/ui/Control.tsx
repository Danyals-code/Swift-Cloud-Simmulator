'use client'

import { Icon, type IconName } from './Icon'

/**
 * The control vocabulary.
 *
 * Three shapes, which between them cover everything in the chrome: a square icon
 * button, a bordered push button, and a segmented control. Keeping them here
 * rather than as class strings repeated per call site is what makes the toolbar
 * read as one row of controls instead of eight separately-invented ones - the
 * specific failure the old toolbar had, where a bordered button, a raw `<select>`
 * and a saturated blue split button sat side by side.
 *
 * Heights are 22px throughout, which is AppKit's small control size and what a
 * 38px toolbar is built around.
 */

const BASE =
  'inline-flex h-[22px] items-center justify-center gap-1.5 rounded-[5px] text-[14px] leading-none transition-colors disabled:pointer-events-none disabled:opacity-40'

const QUIET = 'text-xc-text-2 hover:bg-xc-line-soft hover:text-xc-text active:bg-xc-line-soft'

const BORDERED =
  'border border-xc-line bg-xc-line-soft px-2.5 text-xc-text hover:bg-xc-line-soft active:bg-xc-line-soft'

export interface ToolButtonProps {
  icon: IconName
  label: string
  title?: string
  onClick?: () => void
  /** Renders the pressed state and reports it to assistive tech. */
  active?: boolean
  disabled?: boolean
  testId?: string
  /** Overrides the icon colour - the Run button is green, Stop is red. */
  tone?: string
  size?: number
}

/** A square icon button, as the toolbar and pane headers use. */
export function ToolButton({
  icon,
  label,
  title,
  onClick,
  active = false,
  disabled = false,
  testId,
  tone,
  size = 15,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      data-testid={testId}
      className={`${BASE} w-[26px] ${
        active ? 'bg-xc-line-soft text-xc-text' : tone ? `${tone} hover:bg-xc-line-soft` : QUIET
      }`}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

export interface PushButtonProps {
  children: React.ReactNode
  onClick?: () => void
  title?: string
  label?: string
  active?: boolean
  disabled?: boolean
  testId?: string
  icon?: IconName
}

/** A bordered push button - AppKit's default, and the studio's only text button. */
export function PushButton({
  children,
  onClick,
  title,
  label,
  active = false,
  disabled = false,
  testId,
  icon,
}: PushButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={active ? true : undefined}
      data-testid={testId}
      className={`${BASE} ${
        active
          ? 'border border-xc-accent/70 bg-xc-accent/25 px-2.5 text-xc-text'
          : BORDERED
      }`}
    >
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </button>
  )
}

export interface SegmentedControlProps {
  options: readonly { value: string; label: string; icon?: IconName; title?: string }[]
  value: string
  onChange: (value: string) => void
  label: string
  testId?: string
}

/**
 * A segmented control.
 *
 * One `aria-pressed` button per segment rather than a radio group, because that is
 * how the pane toggles behave: they are three independent switches drawn adjacent,
 * not three states of one setting. `MultiSegmented` below is that case; this one is
 * the exclusive choice.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  label,
  testId,
}: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className="inline-flex h-[22px] items-center gap-px rounded-[5px] border border-xc-line bg-xc-line-soft p-px"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            title={option.title ?? option.label}
            className={`inline-flex h-[18px] items-center gap-1 rounded-[4px] px-2 text-[13px] leading-none transition-colors ${
              selected
                ? 'bg-xc-panel text-xc-text shadow-[0_1px_3px_rgb(0_0_0/0.08)]'
                : 'text-xc-text-2 hover:text-xc-text'
            }`}
          >
            {option.icon ? <Icon name={option.icon} size={12} /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export interface PaneTogglesProps {
  options: readonly { key: string; icon: IconName; label: string; title: string }[]
  /** The keys switched on. */
  shown: ReadonlySet<string>
  /** Switched on, but with no room in the current window. */
  suppressed?: ReadonlySet<string>
  onToggle: (key: string) => void
}

/**
 * Xcode's pane toggles: three independent switches drawn as one segmented block.
 *
 * Distinct from `SegmentedControl` because any combination can be on at once -
 * modelling it as an exclusive choice would make hiding the navigator also show
 * the debug area.
 */
export function PaneToggles({ options, shown, suppressed, onToggle }: PaneTogglesProps) {
  return (
    <div
      role="group"
      aria-label="Panes"
      data-testid="pane-toggles"
      className="inline-flex h-[22px] items-center gap-px rounded-[5px] border border-xc-line bg-xc-line-soft p-px"
    >
      {options.map((option) => {
        const on = shown.has(option.key)
        // On but with nowhere to go. Drawn as a pressed-and-dimmed switch rather
        // than as off, because "off" would be a lie about a setting the user made.
        const cramped = on && suppressed?.has(option.key) === true

        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onToggle(option.key)}
            aria-pressed={on}
            aria-label={option.label}
            aria-disabled={cramped}
            title={cramped ? `${option.title} - no room in this window` : option.title}
            data-testid={`pane-toggle-${option.key}`}
            className={`inline-flex h-[18px] w-[26px] items-center justify-center rounded-[4px] transition-colors ${
              cramped
                ? 'bg-xc-line-soft text-xc-text-3'
                : on
                  ? 'bg-xc-line-soft text-xc-text'
                  : 'text-xc-text-3 hover:text-xc-text-2'
            }`}
          >
            <Icon name={option.icon} size={14} />
          </button>
        )
      })}
    </div>
  )
}
