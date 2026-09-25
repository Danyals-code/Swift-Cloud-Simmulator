import { describe, expect, it } from 'vitest'
import { saveNote } from './storageProblem'

/** What ⌘S says once it has saved (D5): it used to open the browser's Save Page instead. */
describe('what ⌘S says', () => {
  it('says the work is saved, and that it saves as it goes', () => {
    expect(saveNote(null)).toBe('Saved. Your work also saves as you go.')
    expect(saveNote({ kind: 'unreadable', detail: 'The database is locked.' })).toBe('Saved. Your work also saves as you go.')
  })

  it('says when the browser keeps nothing', () => {
    expect(saveNote({ kind: 'memory' })).toBe('Not saved: this browser keeps nothing once the tab closes. Download your project to keep it.')
  })

  it('points at the banner when saving fails', () => {
    expect(saveNote({ kind: 'failing', detail: 'The disk is full.' })).toBe('Not saved. The note at the top of the page says why.')
    expect(saveNote({ kind: 'outdated' })).toBe('Not saved. The note at the top of the page says why.')
  })
})
