import { describe, expect, it } from 'vitest'
import { keyFocus, shortcutFor, type KeyFocus, type KeyPlace, type KeyPress } from './shortcuts'

/**
 * What each key does, by where the focus is (D5). Keys used to fire from wherever the
 * focus was: ⌘B in a field threw away what was typed there, Backspace on a dropdown
 * deleted the view, Tab on a button flipped the canvas to Preview, and ⌘D, ⌘S and ⇧⌘H
 * were left to the browser, which bookmarked the page, saved it, or left for the home page.
 */

const key = (combo: string): KeyPress => {
  const parts = combo.split('+')
  const name = parts.at(-1)!
  return { key: name, mod: parts.includes('Mod'), shift: parts.includes('Shift'), alt: parts.includes('Alt') }
}
const editing = (focus: KeyFocus = 'page', selected = true): KeyPlace => ({ workspace: 'design', editing: true, focus, selected })
const does = (combo: string, place: KeyPlace) => shortcutFor(key(combo), place)

describe('Design, with a view selected', () => {
  it('duplicates, hides and groups it with Figma\'s keys', () => {
    expect(does('Mod+d', editing())).toBe('duplicate')
    expect(does('Mod+Shift+H', editing())).toBe('hide')
    expect(does('Mod+g', editing())).toBe('group')
  })

  it('leaves plain ⌘H to the system, which hides the browser', () => {
    expect(does('Mod+h', editing())).toBeNull()
  })

  it('edits it from the canvas, a layer row or a button', () => {
    for (const focus of ['page', 'control'] as const) {
      expect(does('Backspace', editing(focus))).toBe('delete')
      expect(does('Delete', editing(focus))).toBe('delete')
      expect(does('Alt+ArrowUp', editing(focus))).toBe('move-up')
      expect(does('Alt+ArrowDown', editing(focus))).toBe('move-down')
      expect(does('Mod+z', editing(focus))).toBe('undo')
      expect(does('Mod+Shift+Z', editing(focus))).toBe('redo')
      expect(does('Mod+y', editing(focus))).toBe('redo')
      expect(does('Mod+c', editing(focus))).toBe('copy')
      expect(does('Mod+v', editing(focus))).toBe('paste')
    }
  })

  it('keeps the tools on single keys, but no longer arms Delete with D', () => {
    expect(does('v', editing())).toBe('select-tool')
    expect(does('a', editing())).toBe('add')
    expect(does('Escape', editing())).toBe('escape')
    expect(does('d', editing())).toBeNull()
  })

  it('leaves Tab to move the focus, and holds back ⌘B and ⌘I, which only hid the settings and started Preview', () => {
    for (const focus of ['page', 'control', 'choice', 'text'] as const) {
      expect(does('Tab', editing(focus))).toBeNull()
      expect(does('Mod+b', editing(focus))).toBe('hold')
      expect(does('Mod+i', editing(focus))).toBe('hold')
    }
  })

  it('shows all screens and opens the panels as before', () => {
    expect(does('Mod+Shift+A', editing())).toBe('all-screens')
    expect(does('Mod+0', editing())).toBe('left-panel')
    expect(does('Mod+Alt+Enter', editing())).toBe('right-panel')
    expect(does('Mod+Shift+Y', editing())).toBe('problems')
    expect(does('`', editing())).toBe('workspace')
  })
})

describe('Design, while typing in a field', () => {
  const typing = editing('text')

  it('leaves the field its own keys: nothing reaches the view or the panels', () => {
    for (const combo of ['Backspace', 'Delete', 'Alt+ArrowUp', 'v', 'a', 'd', '`', 'Tab', 'Escape', 'Mod+z', 'Mod+Shift+Z', 'Mod+c', 'Mod+v', 'Mod+0', 'Mod+Alt+Enter', 'Mod+Shift+Y', 'Mod+Shift+A']) {
      expect(does(combo, typing), combo).toBeNull()
    }
  })

  it('holds back the browser\'s ⌘D, ⌘G and ⇧⌘H, without acting on the view', () => {
    expect(does('Mod+d', typing)).toBe('hold')
    expect(does('Mod+g', typing)).toBe('hold')
    expect(does('Mod+Shift+H', typing)).toBe('hold')
  })

  it('still saves, restarts the preview, opens a file and lists the shortcuts', () => {
    expect(does('Mod+s', typing)).toBe('save')
    expect(does('Mod+r', typing)).toBe('restart-preview')
    expect(does('Mod+p', typing)).toBe('open-file')
    expect(does('Mod+/', typing)).toBe('shortcuts')
  })
})

describe('Design, on a dropdown', () => {
  const choosing = editing('choice')

  it('leaves it the keys it answers to', () => {
    for (const combo of ['ArrowUp', 'ArrowDown', 'Alt+ArrowUp', 'v', 'a', ' ', 'Enter', 'Escape', '`']) {
      expect(does(combo, choosing), combo).toBeNull()
    }
  })

  it('holds back Backspace, which took Safari back a page, and deletes nothing', () => {
    expect(does('Backspace', choosing)).toBe('hold')
    expect(does('Delete', choosing)).toBe('hold')
  })

  it('acts on the view for chords a dropdown has no use for', () => {
    expect(does('Mod+d', choosing)).toBe('duplicate')
    expect(does('Mod+z', choosing)).toBe('undo')
    expect(does('Mod+c', choosing)).toBe('copy')
    expect(does('Mod+Shift+H', choosing)).toBe('hide')
  })
})

describe('Design, with nothing selected', () => {
  const nothing = editing('page', false)

  it('holds back the browser\'s ⌘D, ⌘G and ⇧⌘H rather than leave the studio', () => {
    expect(does('Mod+d', nothing)).toBe('hold')
    expect(does('Mod+g', nothing)).toBe('hold')
    expect(does('Mod+Shift+H', nothing)).toBe('hold')
  })

  it('has nothing to delete or copy, and does not go back a page either', () => {
    expect(does('Backspace', nothing)).toBe('hold')
    expect(does('Mod+c', nothing)).toBeNull()
  })

  it('still pastes, undoes and adds', () => {
    expect(does('Mod+v', nothing)).toBe('paste')
    expect(does('Mod+z', nothing)).toBe('undo')
    expect(does('a', nothing)).toBe('add')
  })
})

describe('Design, in Preview', () => {
  const previewing: KeyPlace = { workspace: 'design', editing: false, focus: 'page', selected: true }

  it('leaves the app its keys, and edits nothing', () => {
    for (const combo of ['v', 'a', 'Alt+ArrowUp', 'Mod+z', 'Mod+c', 'Mod+v', 'Mod+Shift+A', 'Tab']) {
      expect(does(combo, previewing), combo).toBeNull()
    }
    expect(does('Backspace', previewing)).toBe('hold')
  })

  it('still hears Escape, to close what is open over the canvas', () => {
    expect(does('Escape', previewing)).toBe('escape')
  })

  it('still holds back the browser\'s ⌘D, ⌘G and ⇧⌘H, and saves', () => {
    expect(does('Mod+d', previewing)).toBe('hold')
    expect(does('Mod+Shift+H', previewing)).toBe('hold')
    expect(does('Mod+g', previewing)).toBe('hold')
    expect(does('Mod+s', previewing)).toBe('save')
  })
})

describe('Code', () => {
  const code = (focus: KeyFocus, editingCode = true): KeyPlace => ({ workspace: 'develop', editing: editingCode, focus, selected: false })

  it('switches Inspect and Preview with Tab only when nothing has the focus', () => {
    expect(does('Tab', code('page'))).toBe('preview')
    expect(does('Tab', code('page', false))).toBe('preview')
    for (const focus of ['control', 'choice', 'text', 'code'] as const) expect(does('Tab', code(focus)), focus).toBeNull()
  })

  it('keeps its Xcode chords, in the code editor too', () => {
    for (const focus of ['page', 'control', 'code'] as const) {
      expect(does('Mod+b', code(focus))).toBe('right-panel')
      expect(does('Mod+i', code(focus))).toBe('inspect')
      expect(does('Mod+0', code(focus))).toBe('left-panel')
    }
  })

  it('keeps them out of a field', () => {
    expect(does('Mod+b', code('text'))).toBeNull()
    expect(does('Mod+i', code('text'))).toBeNull()
    expect(does('Mod+0', code('text'))).toBeNull()
  })

  it('leaves ⌘S to the code editor, which saves the source, and saves anywhere else', () => {
    expect(does('Mod+s', code('code'))).toBeNull()
    expect(does('Mod+s', code('page'))).toBe('save')
  })

  it('has no view to edit', () => {
    for (const combo of ['Mod+d', 'Mod+g', 'Mod+Shift+H', 'v', 'a', 'Mod+Shift+A']) expect(does(combo, code('page')), combo).toBeNull()
    expect(does('Backspace', code('page'))).toBe('hold')
    expect(does('Backspace', code('code'))).toBeNull()
  })
})

describe('where the focus is', () => {
  /** An element as the key handler sees it, without a page to put it in. */
  const element = (tagName: string, extra: { type?: string; contentEditable?: boolean; inCode?: boolean } = {}) => ({
    tagName,
    type: extra.type,
    isContentEditable: extra.contentEditable ?? false,
    closest: (selector: string) => extra.inCode && selector.includes('.cm-editor') ? {} : null,
  }) as unknown as EventTarget

  it('is a field for anything with a caret', () => {
    expect(keyFocus(element('INPUT', { type: 'text' }))).toBe('text')
    expect(keyFocus(element('INPUT', { type: 'search' }))).toBe('text')
    expect(keyFocus(element('INPUT', { type: 'number' }))).toBe('text')
    expect(keyFocus(element('TEXTAREA'))).toBe('text')
    expect(keyFocus(element('DIV', { contentEditable: true }))).toBe('text')
  })

  it('is the code editor inside it', () => {
    expect(keyFocus(element('DIV', { contentEditable: true, inCode: true }))).toBe('code')
  })

  it('is a choice for a dropdown, a slider or a box to tick', () => {
    expect(keyFocus(element('SELECT'))).toBe('choice')
    expect(keyFocus(element('INPUT', { type: 'range' }))).toBe('choice')
    expect(keyFocus(element('INPUT', { type: 'checkbox' }))).toBe('choice')
    expect(keyFocus(element('INPUT', { type: 'color' }))).toBe('choice')
  })

  it('is a control for a button, a link or a layer row, and the page for the rest', () => {
    expect(keyFocus(element('BUTTON'))).toBe('control')
    expect(keyFocus(element('A'))).toBe('control')
    expect(keyFocus(element('DIV'))).toBe('control')
    expect(keyFocus(element('BODY'))).toBe('page')
    expect(keyFocus(null)).toBe('page')
  })
})
