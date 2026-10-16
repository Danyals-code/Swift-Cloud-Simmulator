import { describe, expect, it } from 'vitest'
import type { ViewVisibility } from '@studio/shared'
import { shownWhenChoices } from './visibility'

/** Shown when's choices for a view in `if showDetails`, with Show details as the screen's one switch. */
const options = [
  { when: { input: 'showDetails', is: true }, label: 'When Show details is on' },
  { when: { input: 'showDetails', is: false }, label: 'When Show details is off' },
]
const shown = (choices: ReturnType<typeof shownWhenChoices>) => choices.choices.find(choice => choice.value === choices.current)

describe('the Shown when select (Wave 5a)', () => {
  it('offers Always first, then each value with its other side, and picks Always for a view always shown', () => {
    const choices = shownWhenChoices({ options, editable: true, newName: 'isShown' })
    expect(choices.choices.map(choice => choice.label)).toEqual(['Always', 'When Show details is on', 'When Show details is off'])
    expect(shown(choices)?.label).toBe('Always')
  })

  it('picks the choice the if around the view says', () => {
    const choices = shownWhenChoices({ options, editable: true, newName: 'isShown', when: { input: 'showDetails', is: false }, condition: '!showDetails', label: 'Show details is off' })
    expect(shown(choices)?.label).toBe('When Show details is off')
  })

  it('shows a condition read only from an if around the view, in its words, never Always', () => {
    const nested: ViewVisibility = { options, editable: false, newName: 'isShown', condition: 'showDetails', label: 'Show details is on', problem: 'The if is around the view that holds this one. Change it there.' }
    const choices = shownWhenChoices(nested)
    expect(choices.current).not.toBe('')
    expect(shown(choices)).toMatchObject({ label: 'When Show details is on', disabled: true })
  })

  it('shows a condition with no words as the code writes it', () => {
    const written: ViewVisibility = { options, editable: true, newName: 'isShown', condition: 'items.count > 3' }
    expect(shown(shownWhenChoices(written))).toMatchObject({ label: 'items.count > 3', disabled: true })
  })

  it('keeps a read-back value the choices do not list, rather than falling back to Always', () => {
    const choices = shownWhenChoices({ options: [], editable: false, newName: 'isShown', when: { input: 'phase', is: 'loading' }, condition: 'phase == .loading', label: 'Phase is Loading' })
    expect(shown(choices)).toMatchObject({ label: 'When Phase is Loading', disabled: true })
    expect(choices.choices.map(choice => choice.label)).toEqual(['Always', 'When Phase is Loading'])
  })
})
