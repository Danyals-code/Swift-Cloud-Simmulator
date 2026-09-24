import type { UIEvent } from '@studio/shared'

/**
 * The preview's events on their way to the worker, one at a time.
 *
 * `send` delivers an event and resolves once its answer is drawn.
 */
export class PreviewEvents {
  private readonly waiting: { event: UIEvent; settled: (() => void)[] }[] = []
  private busy = false

  constructor(private readonly send: (event: UIEvent) => Promise<void>) {}

  /**
   * Queues an event; resolves once it has been answered.
   *
   * A value that moves continuously - a slider, a drag, a field's text - replaces the
   * same control's value still waiting behind the event in flight, and is answered
   * for both: only the latest one means anything by the time the worker is free.
   */
  push(event: UIEvent): Promise<void> {
    return new Promise((resolve) => {
      const last = this.waiting.at(-1)
      if (last && continuous(event) && continuous(last.event) && last.event.kind === event.kind && last.event.handlerId === event.handlerId) {
        last.event = event
        last.settled.push(resolve)
        return
      }
      this.waiting.push({ event, settled: [resolve] })
      void this.next()
    })
  }

  private async next(): Promise<void> {
    if (this.busy) return
    const job = this.waiting.shift()
    if (!job) return
    this.busy = true
    try {
      await this.send(job.event)
    } catch {
      // The sender reports the worker's failure itself; the event is settled either way.
    } finally {
      this.busy = false
      for (const settled of job.settled) settled()
      void this.next()
    }
  }
}

/** Whether only an event's latest value matters: a slide, a field's text, a scroll, a gesture's move. */
function continuous(event: UIEvent): boolean {
  switch (event.kind) {
    case 'slide':
    case 'textChange':
    case 'scroll':
      return true
    case 'drag':
    case 'magnify':
    case 'rotate':
      return event.phase === 'changed'
    default:
      return false
  }
}
