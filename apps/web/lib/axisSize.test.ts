import { describe, expect, it } from 'vitest'
import { withMode } from './axisSize'

/** Switching an axis between Hug, Fill and Fixed, as the Layout section and a double-clicked handle do. */
describe('switching how an axis is sized', () => {
  it('leaves a Fixed size behind, with nothing kept', () => {
    expect(withMode({ mode: 'fixed', size: 120 }, 'hug', true)).toEqual({ mode: 'hug' })
    expect(withMode({ mode: 'fixed', size: 120 }, 'fill', false)).toEqual({ mode: 'fill' })
  })

  it('keeps a minimum and a maximum between Hug and Fill, a Hug’s maximum only where a fill can hug up to it', () => {
    expect(withMode({ mode: 'fill', min: 80, max: 300 }, 'hug', false)).toEqual({ mode: 'hug', min: 80 })
    expect(withMode({ mode: 'fill', min: 80, max: 300 }, 'hug', true)).toEqual({ mode: 'hug', min: 80, max: 300 })
    expect(withMode({ mode: 'hug', min: 40, max: { token: 'Layout.wide' } }, 'fill', false)).toEqual({ mode: 'fill', min: 40, max: { token: 'Layout.wide' } })
  })

  it('takes no minimum or maximum to Fixed', () => {
    expect(withMode({ mode: 'hug', min: 40, max: 300 }, 'fixed', true)).toEqual({ mode: 'fixed' })
  })
})
