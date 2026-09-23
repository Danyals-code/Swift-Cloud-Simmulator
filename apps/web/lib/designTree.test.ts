import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@studio/shared'
import { emptyScreensNote } from './designTree'

/**
 * What the Screens list says when it has none to list.
 *
 * Screens are found by drawing them, so while a file doesn't parse there are none,
 * and after a reload nothing is kept from before. "No screens yet" then sent a
 * designer looking for screens that were there all along.
 */
describe('the note an empty Screens list shows', () => {
  const syntaxError: Diagnostic = { severity: 'error', code: 'expected_token', message: "Expected ')'", span: { file: 'Sources/HomeScreen.swift', start: 42, end: 43 } }

  it('says it is drawing while a compile is under way', () => {
    expect(emptyScreensNote(true, [syntaxError])).toEqual({ text: 'Drawing screens…' })
  })

  it('names the file whose error keeps the screens from being drawn, and where', () => {
    expect(emptyScreensNote(false, [syntaxError])).toEqual({
      text: 'Fix the error in HomeScreen.swift to see the screens.',
      at: { file: 'Sources/HomeScreen.swift', offset: 42 },
    })
  })

  it('says there are none when nothing is wrong', () => {
    expect(emptyScreensNote(false, [{ ...syntaxError, severity: 'warning' }])).toEqual({ text: 'No screens yet.' })
  })
})
