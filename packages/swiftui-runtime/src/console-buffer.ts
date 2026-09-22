import type { LogLevel, SourceSpan } from '@studio/shared'
import { PREVIEW_LIMITS } from '@studio/swift-runtime'

export interface ConsoleLine {
  readonly message: string
  readonly span: SourceSpan
  readonly level: LogLevel
}

const NOWHERE: SourceSpan = { file: '', start: 0, end: 0 }

/**
 * Console lines waiting to go out with the next result.
 *
 * A `print` loop can write a million lines inside the step budget, and every one of
 * them used to be cloned to the page - several times per result - and drawn as its
 * own list item, which is how one loop could hang the tab. The first lines and the
 * last are the ones a person reads, so those are kept and the rest are counted -
 * except the first errors among them. "Action failed" is what explains a broken tap,
 * and the AI checks and exports read error lines too, so those errors stay where they
 * happened. Only the first hundred do: a failure repeated down a long list would
 * otherwise keep thousands of copies of itself.
 */
export class ConsoleBuffer {
  private readonly keep = PREVIEW_LIMITS.consoleLines / 2
  private readonly head: ConsoleLine[] = []
  /** The last lines written, as a ring: `start` is the oldest. */
  private tail: ConsoleLine[] = []
  private start = 0
  /** What left the tail: errors, and counts of the lines between them. */
  private middle: (ConsoleLine | number)[] = []
  private middleErrors = 0

  write(line: ConsoleLine): void {
    const extra = line.message.length - PREVIEW_LIMITS.consoleLineLength
    if (extra > 0) line = { ...line, message: `${line.message.slice(0, PREVIEW_LIMITS.consoleLineLength)} … ${extra.toLocaleString('en-US')} more characters` }
    if (this.head.length < this.keep) {
      this.head.push(line)
    } else if (this.tail.length < this.keep) {
      this.tail.push(line)
    } else {
      this.evict(this.tail[this.start]!)
      this.tail[this.start] = line
      this.start = (this.start + 1) % this.keep
    }
  }

  /** Moves the oldest line of the tail into the middle, where most lines are only counted. */
  private evict(line: ConsoleLine): void {
    const last = this.middle.length - 1
    if (line.level === 'error' && this.middleErrors < PREVIEW_LIMITS.consoleErrors) {
      this.middle.push(line)
      this.middleErrors++
    } else if (typeof this.middle[last] === 'number') {
      this.middle[last]++
    } else {
      this.middle.push(1)
    }
  }

  /** Everything written since the last drain, in order, and a fresh start. */
  drain(): ConsoleLine[] {
    const lines = [...this.head]
    for (const part of this.middle) {
      lines.push(typeof part === 'number' ? { message: `${part.toLocaleString('en-US')} lines not shown`, span: NOWHERE, level: 'log' } : part)
    }
    lines.push(...this.tail.slice(this.start), ...this.tail.slice(0, this.start))
    this.head.length = 0
    this.tail = []
    this.start = 0
    this.middle = []
    this.middleErrors = 0
    return lines
  }
}
