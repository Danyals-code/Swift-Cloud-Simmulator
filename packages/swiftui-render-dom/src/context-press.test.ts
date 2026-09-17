import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginContextPress } from './context-press'

function pointer(target: EventTarget, type: string, fields = {}) {
  target.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX: 20, clientY: 20, ...fields }))
}
afterEach(() => vi.useRealTimers())
describe('context-menu gesture arbitration', () => {
  function start() {
    vi.useFakeTimers()
    const target = new EventTarget(), tap = vi.fn(), hold = vi.fn()
    const cancel = beginContextPress({ clientX: 20, clientY: 20, pointerId: 1 }, tap, hold, target)
    return { target, tap, hold, cancel }
  }
  it('fires only the ordinary action on a short tap', () => {
    const { target, tap, hold } = start()
    vi.advanceTimersByTime(200)
    pointer(target, 'pointerup')
    vi.runAllTimers()
    expect(tap).toHaveBeenCalledOnce()
    expect(hold).not.toHaveBeenCalled()
  })
  it('opens on hold without firing the ordinary action on release', () => {
    const { target, tap, hold } = start()
    vi.advanceTimersByTime(500)
    pointer(target, 'pointerup')
    expect(tap).not.toHaveBeenCalled()
    expect(hold).toHaveBeenCalledOnce()
  })
  it.each(['pointermove', 'pointercancel'])('cancels on %s so scrolling never selects an action', type => {
    const { target, tap, hold } = start()
    pointer(target, type, { clientY: 40 })
    vi.runAllTimers()
    pointer(target, 'pointerup')
    expect(tap).not.toHaveBeenCalled()
    expect(hold).not.toHaveBeenCalled()
  })
  it('ignores a second pointer and disposes pending work on unmount', () => {
    const { target, tap, hold, cancel } = start()
    pointer(target, 'pointerup', { pointerId: 2 })
    expect(tap).not.toHaveBeenCalled()
    cancel()
    vi.runAllTimers()
    pointer(target, 'pointerup')
    expect(tap).not.toHaveBeenCalled()
    expect(hold).not.toHaveBeenCalled()
  })
})
