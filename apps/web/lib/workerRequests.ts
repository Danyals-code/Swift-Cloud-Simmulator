/**
 * Settles all pending RPCs when a worker hangs, crashes, or is disposed.
 *
 * The worker answers one call at a time, in the order they were sent, so a call's
 * deadline starts when the calls ahead of it are answered, not when it was queued:
 * a long drag queues many calls, and timing each from the queue would stop a
 * worker that is busy rather than hung.
 */
export class WorkerRequests {
  /** Unanswered calls, oldest first; only the first has a deadline running. */
  private readonly queue: { fail: (error: Error) => void; start: () => void }[] = []
  private stopped: Error | null = null

  constructor(private readonly onFailure: (error: Error) => void, private readonly timeoutMs = 12_000) {}

  run<T>(operation: () => PromiseLike<T>): Promise<T> {
    if (this.stopped) return Promise.reject(this.stopped)
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const entry = {
        fail: (error: Error) => { settle(); reject(error) },
        start: () => { timer ??= setTimeout(() => this.stop(new Error('The preview took too long and was stopped. Reduce large collections or complex code, then run again.')), this.timeoutMs) },
      }
      const settle = () => {
        clearTimeout(timer)
        const index = this.queue.indexOf(entry)
        if (index >= 0) this.queue.splice(index, 1)
        if (index === 0) this.queue[0]?.start()
      }
      this.queue.push(entry)
      if (this.queue[0] === entry) entry.start()
      try {
        Promise.resolve(operation()).then((value) => { settle(); resolve(value) }, entry.fail)
      } catch (error) {
        entry.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  stop(error = new Error('The compiler worker was closed.'), notify = true): void {
    if (this.stopped) return
    this.stopped = error
    for (const { fail } of [...this.queue]) fail(error)
    if (notify) this.onFailure(error)
  }
}
