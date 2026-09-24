import { describe, expect, it } from 'vitest'
import type { UIEvent } from '@studio/shared'
import { PreviewEvents } from './previewEvents'

/** A worker that answers only when told to, recording what it was sent. */
function worker() {
  const sent: UIEvent[] = []
  const answers: (() => void)[] = []
  const send = (event: UIEvent) => new Promise<void>((resolve) => { sent.push(event); answers.push(resolve) })
  /** Answers the oldest unanswered event, then lets the queue move on. */
  const answer = async () => { answers.shift()!(); await new Promise((resolve) => setTimeout(resolve, 0)) }
  return { sent, send, answer }
}

const tap = (handlerId: string): UIEvent => ({ kind: 'tap', handlerId, location: { x: 0, y: 0 } })

describe('preview events', () => {
  it('sends one event at a time, in the order they happened', async () => {
    const { sent, send, answer } = worker()
    const events = new PreviewEvents(send)
    void events.push(tap('a'))
    void events.push(tap('b'))
    expect(sent.map((e) => e.handlerId)).toEqual(['a'])
    await answer()
    expect(sent.map((e) => e.handlerId)).toEqual(['a', 'b'])
  })

  it("keeps only a control's latest value while an earlier event is being answered", async () => {
    const { sent, send, answer } = worker()
    const events = new PreviewEvents(send)
    const slide = (value: number): UIEvent => ({ kind: 'slide', handlerId: 'level', value })
    const answered: number[] = []
    for (const value of [1, 2, 3, 4]) void events.push(slide(value)).then(() => answered.push(value))
    await answer()
    expect(sent).toEqual([slide(1), slide(4)])
    expect(answered).toEqual([1])
    await answer()
    // The values it replaced are answered with it.
    expect(answered.sort()).toEqual([1, 2, 3, 4])
  })

  it("never merges a tap, a gesture's start or end, or moves on either side of another control's event", async () => {
    const { sent, send, answer } = worker()
    const events = new PreviewEvents(send)
    const drag = (phase: 'began' | 'changed' | 'ended', x: number): UIEvent =>
      ({ kind: 'drag', handlerId: 'card', phase, location: { x, y: 0 }, startLocation: { x: 0, y: 0 }, translation: { x, y: 0 } })
    const pinch = (scale: number): UIEvent => ({ kind: 'magnify', handlerId: 'photo', phase: 'changed', scale })
    for (const event of [tap('first'), drag('began', 0), drag('changed', 1), drag('changed', 2), tap('other'), drag('changed', 3), drag('changed', 4), drag('ended', 4), pinch(1.1), pinch(1.2)]) {
      void events.push(event)
    }
    for (let i = 0; i < 7; i++) await answer()
    expect(sent).toEqual([tap('first'), drag('began', 0), drag('changed', 2), tap('other'), drag('changed', 4), drag('ended', 4), pinch(1.2)])
  })

  it('settles an event the worker failed to answer, and goes on to the next', async () => {
    const sent: string[] = []
    const events = new PreviewEvents(async (event) => {
      sent.push(event.handlerId)
      if (event.handlerId === 'broken') throw new Error('The compiler worker was closed.')
    })
    await expect(events.push(tap('broken'))).resolves.toBeUndefined()
    await events.push(tap('next'))
    expect(sent).toEqual(['broken', 'next'])
  })
})
