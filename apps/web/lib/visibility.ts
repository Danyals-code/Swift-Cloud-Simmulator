import type { ViewVisibility, VisibilityWhen } from '@studio/shared'

/** A Shown when choice's value (Wave 5a): what it asks of one value, or `''` for Always. */
export const shownWhenValue = (when: VisibilityWhen | undefined) => when ? JSON.stringify([when.input, when.is]) : ''
/** The value of a condition the code writes that Shown when can't offer as a choice. */
const WRITTEN = '__written'

/** One option of the Shown when select. A disabled one is the condition read from the code, which only Code changes. */
export interface ShownWhenChoice { readonly value: string; readonly label: string; readonly disabled?: true }

/**
 * The Shown when select (Wave 5a): Always, then each value with its other side, and the one the
 * code says, `current`. A condition the choices don't list, read only from an `if` around the
 * view or written in a way Design can't say, is kept as a disabled choice in its words, or as
 * the code writes it, so the select never falls back to Always.
 */
export function shownWhenChoices(visibility: ViewVisibility): { readonly current: string; readonly choices: readonly ShownWhenChoice[] } {
  const choices: ShownWhenChoice[] = [{ value: '', label: 'Always' }, ...visibility.options.map(option => ({ value: shownWhenValue(option.when), label: option.label }))]
  const current = shownWhenValue(visibility.when) || (visibility.condition ? WRITTEN : '')
  if (!choices.some(choice => choice.value === current)) choices.splice(1, 0, { value: current, label: visibility.label ? `When ${visibility.label}` : visibility.condition ?? current, disabled: true })
  return { current, choices }
}
