/**
 * Source positions.
 *
 * Spans carry raw character offsets, not line/column pairs. The parser produces
 * millions of these and converting to line/column eagerly is wasted work — only
 * diagnostics that actually reach the editor need it. `LineIndex` does the
 * conversion lazily, in O(log n).
 *
 * Offsets are UTF-16 code unit offsets so they line up with CodeMirror and with
 * JavaScript string indexing without translation.
 */

/** Workspace-relative path, e.g. `Sources/ContentView.swift`. */
export type FileId = string

export interface SourceSpan {
  readonly file: FileId
  /** inclusive, UTF-16 code unit offset */
  readonly start: number
  /** exclusive */
  readonly end: number
}

/** 1-based line and column, for display only. */
export interface LineColumn {
  readonly line: number
  readonly column: number
}

export function span(file: FileId, start: number, end: number): SourceSpan {
  return { file, start, end }
}

export function spanLength(s: SourceSpan): number {
  return s.end - s.start
}

export function spanContains(s: SourceSpan, offset: number): boolean {
  return offset >= s.start && offset < s.end
}

/** Smallest span covering both. Assumes the same file. */
export function mergeSpans(a: SourceSpan, b: SourceSpan): SourceSpan {
  return { file: a.file, start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) }
}

/**
 * Offset <-> line/column conversion for one file.
 *
 * Built once per file version and reused; binary search per query.
 */
export class LineIndex {
  /** offset at which each line starts; lineStarts[0] === 0 */
  private readonly lineStarts: number[]

  constructor(private readonly text: string) {
    const starts = [0]
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1)
    }
    this.lineStarts = starts
  }

  get lineCount(): number {
    return this.lineStarts.length
  }

  /** 1-based line and column for a character offset. */
  locate(offset: number): LineColumn {
    const clamped = Math.max(0, Math.min(offset, this.text.length))
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid]! <= clamped) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: clamped - this.lineStarts[lo]! + 1 }
  }

  /** Character offset for a 1-based line and column. */
  offsetAt(line: number, column: number): number {
    const idx = Math.max(0, Math.min(line - 1, this.lineStarts.length - 1))
    const lineStart = this.lineStarts[idx]!
    const lineEnd = idx + 1 < this.lineStarts.length ? this.lineStarts[idx + 1]! - 1 : this.text.length
    return Math.min(lineStart + Math.max(0, column - 1), lineEnd)
  }

  /** Text of a 1-based line, without its trailing newline. */
  lineText(line: number): string {
    const idx = line - 1
    if (idx < 0 || idx >= this.lineStarts.length) return ''
    const start = this.lineStarts[idx]!
    const end = idx + 1 < this.lineStarts.length ? this.lineStarts[idx + 1]! - 1 : this.text.length
    return this.text.slice(start, end)
  }
}
