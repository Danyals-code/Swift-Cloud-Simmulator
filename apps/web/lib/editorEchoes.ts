/**
 * What the code editor has typed that the store has not handed back yet.
 *
 * Every change the editor makes goes to the store, and the store's text comes back
 * as a prop. Under load that echo can arrive a keystroke late, after newer typing:
 * written back, it would undo the newest character and wipe CodeMirror's record of
 * the closing brackets it inserted, so the next `}` typed adds a second one.
 */
export class EditorEchoes {
  private readonly pending: string[] = []

  /** Echoes come back within a keystroke or two, so a short memory is plenty. */
  constructor(private readonly limit = 32) {}

  /** The editor reported this text to the store. */
  sent(text: string): void {
    this.pending.push(text)
    if (this.pending.length > this.limit) this.pending.shift()
  }

  /**
   * Whether text handed back to an editor showing `current` should replace it.
   *
   * An echo is consumed with every older report: the store has caught up that far,
   * so the same text arriving again later is a real change, such as an Undo.
   */
  isNews(incoming: string, current: string): boolean {
    const echo = this.pending.lastIndexOf(incoming)
    if (echo !== -1) {
      this.pending.splice(0, echo + 1)
      return false
    }
    return incoming !== current
  }
}
