import type { AlertActionSpec, BehaviorAction, BehaviorSettings } from '@studio/shared'

/** What When tapped's Show alert and Show options hold while they are filled in. */
export interface AlertDraft {
  readonly title: string
  readonly message: string
  readonly buttons: readonly AlertActionSpec[]
  /** Why the alert shown is read only (Wave 4a): saved from these words, it would lose what the panel can't write back. */
  readonly readOnly?: string
}

/**
 * The alert a button already shows, to change in place, or the one most taps ask:
 * "Are you sure?" with a destructive Delete and a Cancel.
 */
export function alertDraft(shows: BehaviorSettings['shows']): AlertDraft {
  return shows ? { title: shows.title, message: shows.message ?? '', buttons: shows.actions, readOnly: shows.readOnly } : { title: 'Are you sure?', message: '', buttons: [{ title: 'Delete', role: 'destructive' }, { title: 'Cancel', role: 'cancel' }] }
}

/**
 * The tap action Show alert or Show options writes, or what is missing. iOS draws an
 * untitled alert or a blank button as an empty space, and uses only one Cancel, so
 * those are said before anything is written. With no buttons, iOS shows OK. A read-only
 * alert is never written over: its reason is what is said (Wave 4a).
 */
export function alertAction(type: 'alert' | 'dialog', draft: AlertDraft): { readonly action: BehaviorAction } | { readonly problem: string } {
  if (draft.readOnly) return { problem: draft.readOnly }
  const title = draft.title.trim(), message = draft.message.trim()
  if (!title) return { problem: `Give the ${type === 'alert' ? 'alert' : 'options'} a title.` }
  const actions = draft.buttons.map(button => button.role ? { title: button.title.trim(), role: button.role } : { title: button.title.trim() })
  if (actions.some(button => !button.title)) return { problem: 'Give each button a title.' }
  if (actions.filter(button => button.role === 'cancel').length > 1) return { problem: 'Only one button can be Cancel.' }
  return { action: message ? { type, title, message, actions } : { type, title, actions } }
}
