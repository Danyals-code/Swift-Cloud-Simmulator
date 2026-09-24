/**
 * What each key does, by where the focus is (D5): one table for both workspaces, so a
 * key cannot mean one thing to one handler and another to the next.
 *
 * - A field keeps its own keys. Nothing typed there reaches the view or the panels, and
 *   ⌘D, ⌘G and ⇧⌘H are only held back, so the browser does not bookmark the page, find
 *   text, or leave for its home page while somebody types.
 * - A dropdown, slider or tick box keeps the plain keys it answers to; a chord it has
 *   no use for still acts on the view.
 * - Backspace outside a field deletes the selected view or nothing: WebKit would go back
 *   a page with it, and leave the studio.
 * - Design follows Figma: ⌘D duplicates, ⇧⌘H hides, ⌘G groups. Tab moves the focus, and
 *   ⌘B and ⌘I do nothing, where they used to hide the settings or start Preview.
 * - Code keeps its Xcode chords, in the code editor too.
 */

import type { WorkspaceMode } from './layout'

/**
 * Where a key was pressed: the page itself, a button or row, a control that takes plain
 * keys (a dropdown, a slider, a tick box), a field with a caret, or the code editor.
 */
export type KeyFocus = 'page' | 'control' | 'choice' | 'text' | 'code'

/** A key as the shortcuts read it. `mod` is ⌘, or Ctrl. */
export interface KeyPress { readonly key: string; readonly mod: boolean; readonly shift: boolean; readonly alt: boolean }

export interface KeyPlace {
  readonly workspace: WorkspaceMode
  /** Design's Edit, or Code's Inspect, rather than using the app. */
  readonly editing: boolean
  readonly focus: KeyFocus
  /** A view is selected, on the canvas or in Layers. */
  readonly selected: boolean
}

export type Shortcut =
  | 'undo' | 'redo' | 'copy' | 'paste' | 'duplicate' | 'hide' | 'group' | 'delete' | 'move-up' | 'move-down'
  | 'add' | 'select-tool' | 'escape' | 'all-screens'
  | 'save' | 'restart-preview' | 'open-file' | 'shortcuts'
  | 'left-panel' | 'right-panel' | 'problems' | 'inspect' | 'preview' | 'workspace'
  /** Keeps the browser's own action from running, and does nothing else. */
  | 'hold'

/** The keys the view's menus show beside what they do. */
export const SHORTCUT_KEYS = { copy: '⌘C', paste: '⌘V', duplicate: '⌘D', hide: '⇧⌘H', group: '⌘G' } as const

const CHOICE_TYPES = new Set(['range', 'checkbox', 'radio', 'color', 'file', 'button', 'submit', 'reset', 'image'])

/** Where the focus is, from the element a key was pressed in. */
export function keyFocus(target: EventTarget | null): KeyFocus {
  const element = target as (Partial<HTMLElement> & { readonly type?: string }) | null
  if (!element?.tagName || element.tagName === 'BODY' || element.tagName === 'HTML') return 'page'
  if (element.closest?.('.cm-editor')) return 'code'
  if (element.isContentEditable || element.tagName === 'TEXTAREA') return 'text'
  if (element.tagName === 'INPUT') return CHOICE_TYPES.has(element.type ?? 'text') ? 'choice' : 'text'
  if (element.tagName === 'SELECT') return 'choice'
  return 'control'
}

/** The shortcut a key is in this place, or null to leave it to the page and the browser. */
export function shortcutFor(press: KeyPress, place: KeyPlace): Shortcut | null {
  const { focus, workspace } = place
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key
  const design = workspace === 'design'
  const typing = focus === 'text' || focus === 'code'

  if (press.mod) {
    // Anywhere: none of these means anything to a field, and each keeps the browser from
    // printing, reloading or saving the page itself.
    if (key === '/') return 'shortcuts'
    if (key === 'p' || key === 'o' && press.shift) return 'open-file'
    if (key === 'r') return 'restart-preview'
    if (key === 's') return focus === 'code' ? null : 'save'

    if (design) {
      const edit = place.editing && focus !== 'text' && place.selected
      // Bold and italic to a designer; the browser's own would bookmark or mail the page.
      if (key === 'b' || key === 'i') return 'hold'
      if (key === 'd') return edit ? 'duplicate' : 'hold'
      if (key === 'g') return edit ? 'group' : 'hold'
      if (key === 'h') return press.shift ? edit ? 'hide' : 'hold' : null
    }

    if (focus === 'text') return null
    if (key === '0') return 'left-panel'
    if (key === 'y' && press.shift) return 'problems'
    if (key === 'Enter') return press.alt ? 'right-panel' : null
    if (!design) return key === 'b' ? 'right-panel' : key === 'i' ? 'inspect' : null

    if (!place.editing) return null
    if (key === 'a' && press.shift) return 'all-screens'
    if (key === 'z') return press.shift ? 'redo' : 'undo'
    if (key === 'y') return 'redo'
    if (key === 'c') return place.selected ? 'copy' : null
    if (key === 'v') return 'paste'
    return null
  }

  if (typing) return null
  // WebKit still goes back a page on Backspace, which leaves the studio: never outside a field.
  if (key === 'Backspace' || key === 'Delete') return design && place.editing && place.selected && focus !== 'choice' ? 'delete' : 'hold'
  if (focus === 'choice') return null
  if (key === '`' && !press.alt) return 'workspace'
  if (key === 'Tab') return !design && focus === 'page' && !press.shift && !press.alt ? 'preview' : null
  // Heard in Preview too, to close what is open over the canvas.
  if (key === 'Escape') return design ? 'escape' : null
  if (!design || !place.editing) return null

  if (press.alt) return key === 'ArrowUp' ? 'move-up' : key === 'ArrowDown' ? 'move-down' : null
  if (key === 'v') return 'select-tool'
  if (key === 'a') return 'add'
  return null
}
