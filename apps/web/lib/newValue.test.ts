import { describe, expect, it } from 'vitest'
import { newValueDefaults } from './newValue'

/**
 * What "Saves to › Save to a new value" offers first (D13): the name the planner gives a
 * new value, and the value the control shows now. It used to offer "value" and an empty
 * field every time, which a second control, a slider or a stepper refused.
 */
describe('a new value for a control to save to', () => {
  it('starts as the value the control shows, typed as the control keeps it', () => {
    expect(newValueDefaults({ label: 'value', type: 'Double', current: '.constant(0.5)', newName: 'value' })).toEqual({ name: 'value', value: '0.5' })
    expect(newValueDefaults({ label: 'value', type: 'Int', current: '.constant(1)', newName: 'count' })).toEqual({ name: 'count', value: '1' })
    expect(newValueDefaults({ label: 'text', type: 'String', current: '.constant("Ada")', newName: 'text' })).toEqual({ name: 'text', value: 'Ada' })
    expect(newValueDefaults({ label: 'isOn', type: 'Bool', current: '.constant(true)', newName: 'isOn2' })).toEqual({ name: 'isOn2', value: 'true' })
  })

  it('starts a number at zero when the control is bound in Swift, not to a constant', () => {
    expect(newValueDefaults({ label: 'value', type: 'Double', current: '$volume', newName: 'value' })).toEqual({ name: 'value', value: '0' })
  })

  it('starts a date empty, which is today', () => {
    expect(newValueDefaults({ label: 'selection', type: 'Date', current: '.constant(Date())', newName: 'date' })).toEqual({ name: 'date', value: '' })
  })
})
