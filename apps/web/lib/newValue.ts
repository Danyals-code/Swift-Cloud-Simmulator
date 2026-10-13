import type { BehaviorSettings } from '@studio/shared'

/**
 * What "Saves to › Save to a new value" offers first (D13): the name the canvas gives a
 * control's new value, free on its screen, and the value the control shows now. A date
 * starts empty, which is today, written `Date()`.
 */
export function newValueDefaults(binding: NonNullable<BehaviorSettings['binding']>): { name: string; value: string } {
  const name = binding.newName
  const shown = /^\.constant\((.*)\)$/s.exec(binding.current.trim())?.[1]?.trim()
  if (binding.type === 'Date' || binding.type === 'Color') return { name, value: '' }
  if (shown !== undefined && shown !== '') return { name, value: shown.replace(/^"(.*)"$/s, '$1') }
  return { name, value: binding.type === 'Bool' ? 'false' : binding.type === 'Int' || binding.type === 'Double' ? '0' : '' }
}
