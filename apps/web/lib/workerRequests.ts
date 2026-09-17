/** Settles all pending RPCs when a worker hangs, crashes, or is disposed. */
export class WorkerRequests {
  private readonly pending = new Set<(error: Error) => void>()
  private stopped: Error | null = null

  constructor(private readonly onFailure: (error: Error) => void, private readonly timeoutMs = 12_000) {}

  run<T>(operation: () => PromiseLike<T>): Promise<T> {
    if (this.stopped) return Promise.reject(this.stopped)
    return new Promise<T>((resolve, reject) => {
      const fail = (error: Error) => { cleanup(); reject(error) }
      const timer = setTimeout(() => this.stop(new Error('The preview took too long and was stopped. Reduce large collections or complex code, then run again.')), this.timeoutMs)
      const cleanup = () => { clearTimeout(timer); this.pending.delete(fail) }
      this.pending.add(fail)
      try {
        Promise.resolve(operation()).then((value) => { cleanup(); resolve(value) }, fail)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  stop(error = new Error('The compiler worker was closed.'), notify = true): void {
    if (this.stopped) return
    this.stopped = error
    for (const reject of [...this.pending]) reject(error)
    if (notify) this.onFailure(error)
  }
}
