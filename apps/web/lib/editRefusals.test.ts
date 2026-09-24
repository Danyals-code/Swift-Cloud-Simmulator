import { describe, expect, it } from 'vitest'
import { busyEditProblem } from './editRefusals'

/**
 * An edit asked for while the studio cannot plan one is refused, and says why (C7). It
 * used to return quietly, so a key pressed while the preview redrew did nothing at all.
 */
describe('why an edit cannot be made just now', () => {
  it('says the source is updating while the preview catches up with it', () => {
    expect(busyEditProblem({ current: false, stale: false, applying: false })).toBe('The source is updating. Try again when the preview is ready.')
    expect(busyEditProblem({ current: true, stale: true, applying: false })).toBe('The source is updating. Try again when the preview is ready.')
  })

  it('says the last change is still being applied', () => {
    expect(busyEditProblem({ current: true, stale: false, applying: true })).toBe('Still applying the last change. Try again in a moment.')
  })

  it('lets an edit through otherwise', () => {
    expect(busyEditProblem({ current: true, stale: false, applying: false })).toBeNull()
  })
})
