'use client'

import { Icon, type IconName } from './Icon'

/**
 * The control vocabulary.
 *
 * Four shapes, which between them cover everything in the chrome: a square icon
 * button, a push button, a segmented control, and the pane toggles. Keeping them
 * here rather than as class strings repeated per call site is what makes the
 * toolbar read as one row of controls instead of eight separately-invented ones.
 *
 * Every one is 28px tall with 6px corners and 13px SF, so a popup, a segmented control
 * and a button side by side line up exactly. Filled controls share one translucent
 * fill; a segment inside one is 24px with the inner corner (`--radius-thumb`).
 */

const BASE =
  'inline-flex h-7 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-body transition-[background-color,color,box-shadow] duration-[120ms] disabled:pointer-events-none disabled:opacity-40'

const PLAIN = 'text-xc-text-2 hover:bg-xc-fill hover:text-xc-text active:bg-xc-fill-strong'

const VARIANTS = {
  /** A filled grey button: AppKit's default push button. */
  secondary: 'bg-xc-fill px-3 text-xc-text hover:bg-xc-fill-strong active:bg-xc-fill-strong',
  /** The one action a sheet or toolbar ends on. */
  primary: 'bg-xc-accent-fill px-3 font-medium text-white hover:bg-xc-accent-hover active:brightness-95',
  /** No fill until the pointer is on it, as a toolbar item. */
  plain: `px-2.5 ${PLAIN}`,
  /** The confirm button of a dialog that deletes or discards something for good. */
  danger: 'bg-xc-danger-fill px-3 font-medium text-white hover:brightness-110 active:brightness-95',
} as const

export type ButtonVariant = keyof typeof VARIANTS

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
      className={`${BASE} w-7 ${
        active ? 'bg-xc-fill text-xc-accent' : tone ? `${tone} hover:bg-xc-fill` : PLAIN
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
  /** A toggle that is on: drawn selected, and reported as pressed. */
  active?: boolean
  disabled?: boolean
  testId?: string
  icon?: IconName
  variant?: ButtonVariant
}

/** A push button - the studio's only text button. */
export function PushButton({
  children,
  onClick,
  title,
  label,
  active = false,
  disabled = false,
  testId,
  icon,
  variant = 'secondary',
}: PushButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      // Always stated, both ways. A toggle that drops the attribute when it is off
      // is announced as an ordinary button, and "Inspect" then says nothing about
      // whether inspecting is on - which is the only thing it is there to say.
      aria-pressed={active}
      data-testid={testId}
      className={`${BASE} ${active ? 'bg-xc-select px-3 text-xc-accent' : VARIANTS[variant]}`}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {/* Its own element, so a cramped toolbar can drop the words and keep the icon. */}
      <span data-label>{children}</span>
    </button>
  )
}

/** The track every segmented control and toggle group sits in. */
const TRACK = 'inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-xc-fill p-0.5'
const SEGMENT = 'inline-flex h-6 items-center justify-center gap-1.5 rounded-[var(--radius-thumb)] text-body transition-[background-color,color,box-shadow] duration-[120ms]'
const SEGMENT_ON = 'bg-xc-thumb text-xc-text shadow-[var(--shadow-thumb)]'
const SEGMENT_OFF = 'text-xc-text-2 hover:text-xc-text'

export interface SegmentedControlProps {
  /** `iconOnly` draws the icon alone; the label still names the segment for assistive tech. */
  options: readonly { value: string; label: string; icon?: IconName; title?: string; iconOnly?: boolean }[]
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
 * not three states of one setting. `PaneToggles` below is that case; this one is
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
    <div role="group" aria-label={label} data-testid={testId} className={TRACK}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            aria-label={option.iconOnly ? option.label : undefined}
            title={option.title ?? option.label}
            className={`${SEGMENT} ${option.iconOnly ? 'w-8' : 'px-2.5'} ${selected ? SEGMENT_ON : SEGMENT_OFF}`}
          >
            {option.icon ? <Icon name={option.icon} size={option.iconOnly ? 15 : 13} /> : null}
            {option.iconOnly ? null : option.label}
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
 * Xcode's pane toggles: independent switches drawn as one group.
 *
 * Distinct from `SegmentedControl` because any combination can be on at once -
 * modelling it as an exclusive choice would make hiding the navigator also show
 * the debug area.
 */
export function PaneToggles({ options, shown, suppressed, onToggle }: PaneTogglesProps) {
  return (
    <div role="group" aria-label="Panes" data-testid="pane-toggles" className="inline-flex items-center gap-0.5">
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
            // On is accent-tinted, as selected is everywhere else in the studio -
            // a chosen tab, a chosen layer, an armed tool. Suppressed keeps the grey,
            // because it is on without being in effect.
            className={`${BASE} w-7 ${
              cramped
                ? 'bg-xc-fill text-xc-text-3'
                : on
                  ? 'bg-xc-fill text-xc-accent'
                  : PLAIN
            }`}
          >
            <Icon name={option.icon} size={15} />
          </button>
        )
      })}
    </div>
  )
}
