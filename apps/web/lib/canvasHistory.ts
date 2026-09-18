import type { Project } from '@studio/project-model'

export interface CanvasChange {
  readonly projectId: string
  readonly file: string
  readonly before: string
  readonly after: string
  readonly offset: number | null
}

/** Full-file edits are valid only against the exact source version they recorded. */
export class CanvasHistory {
  private past: CanvasChange[] = []
  private future: CanvasChange[] = []

  record(change: CanvasChange): void {
    if (this.past.at(-1)?.projectId !== change.projectId) this.past = []
    this.past.push(change)
    this.future = []
  }

  take(direction: 'undo' | 'redo', project: Project): CanvasChange | null {
    const from = direction === 'undo' ? this.past : this.future
    const change = from.at(-1)
    if (!change) return null
    const expected = direction === 'undo' ? change.after : change.before
    if (change.projectId !== project.id || project.files.find(f => f.id === change.file)?.text !== expected) {
      this.past = []
      this.future = []
      return null
    }
    from.pop()
    ;(direction === 'undo' ? this.future : this.past).push(change)
    return change
  }
}
