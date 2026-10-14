import type { CompileResult, LayerDraft, SourceSpan } from '@studio/shared'
import type { LayerDrafts } from '../../lib/useCompiler'

/** A draft laid out slower than a frame: the canvas then shows a ghost box that follows the pointer (plan decision 12). */
const SLOW_LAYOUT_MS = 16

/**
 * One drag's drafts on their way to the worker, at most one a frame: the latest replaces
 * one not yet sent, and the next is sent only once the layout before it has come back, so
 * a heavy screen shows the newest values rather than falling behind the pointer.
 *
 * Each layout is timed as a `layer-draft` performance measure, which is how the canvas
 * test reads how quickly a draft comes back.
 */
export class DraftQueue {
  private latest: LayerDraft | null = null
  private sent: LayerDraft | null = null
  private frame = 0
  private busy = false
  private done = false
  private begun: Promise<boolean> | null = null
  /** The worker took longer than a frame to lay out the last draft. */
  slow = false

  constructor(private readonly drafts: LayerDrafts, private readonly target: SourceSpan, private readonly show: (result: CompileResult) => void) {}

  /** Starts the worker's draft, where a drag is all but certain, before the first value. */
  prepare(): Promise<boolean> {
    this.begun ??= this.drafts.begin(this.target)
    return this.begun
  }

  /** Lays the page out with `draft` at the next frame; a newer draft replaces one not yet sent. */
  update(draft: LayerDraft): void {
    void this.prepare()
    this.latest = draft
    this.schedule()
  }

  /** Stops drafting and ends the worker's draft. What was shown stays, for the caller to clear. */
  async end(): Promise<void> {
    if (this.done) return
    this.done = true
    cancelAnimationFrame(this.frame)
    if (this.begun && await this.begun) await this.drafts.end()
  }

  private schedule(): void {
    if (this.frame || this.busy || this.done) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; void this.send() })
  }

  private async send(): Promise<void> {
    const draft = this.latest
    if (!draft || draft === this.sent || this.done) return
    this.busy = true
    this.sent = draft
    try {
      if (!await this.prepare()) return
      const startedAt = performance.now()
      const result = await this.drafts.update(draft)
      try { performance.measure('layer-draft', { start: startedAt, end: performance.now() }) } catch { /* timing is a courtesy */ }
      if (result) this.slow = result.timings.layout > SLOW_LAYOUT_MS
      if (result && !this.done) this.show(result)
    } finally {
      this.busy = false
      if (this.latest !== this.sent) this.schedule()
    }
  }
}
