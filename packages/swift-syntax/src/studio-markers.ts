import { Lexer } from './lexer'
import { offMarkersIn } from './off-markers'

/**
 * The marker that lets a hidden view be found again.
 *
 * Hiding comments the view out, which is the only way a view can stop taking part in
 * the layout as well as in the drawing - `.hidden()` leaves its space behind. The
 * cost of commenting is that the parser stops seeing it, so the studio would have
 * nowhere to draw the switch that brings it back. This line is how it keeps it: an
 * ordinary comment that survives Xcode, a diff and a merge, and that reads as what
 * it is if the studio never opens the file again.
 */
export const HIDDEN_MARKER = '// hidden by Swift Web Studio'
/** The line that closes a hidden view's block. Blocks from before it existed have none. */
export const HIDDEN_END = '// end hidden view'

/**
 * `text` without the studio's own markers: hidden views and switched-off modifiers.
 *
 * What goes to Xcode. The studio keeps both as comments so it can bring them back, but
 * in the Swift a developer reads they are clutter. Only the gaps between tokens are
 * searched, so the same characters inside a string stay. A line the markers leave
 * blank goes with them. A hidden view's block from before blocks had an end line loses
 * only its marker line, since where its view ends can't be known without parsing it.
 * Text with no markers comes back unchanged.
 */
export function withoutStudioMarkers(text: string): string {
  if (!text.includes(HIDDEN_MARKER) && offMarkersIn(text).next().done) return text
  const cuts: [number, number][] = []
  let at = 0
  for (const token of Lexer.tokenize(text, 'markers').tokens) {
    cutMarkers(text, at, token.span.start, cuts)
    at = Math.max(at, token.span.end)
  }
  cutMarkers(text, at, text.length, cuts)
  return withoutCuts(text, cuts)
}

/** Adds the markers in the gap from `from` to `to`, which holds only whitespace and comments. */
function cutMarkers(text: string, from: number, to: number, cuts: [number, number][]): void {
  const gap = text.slice(from, to)
  for (const match of offMarkersIn(gap)) cuts.push([from + match.index!, from + match.index! + match[0].length])
  for (let found = gap.indexOf(HIDDEN_MARKER); found >= 0; found = gap.indexOf(HIDDEN_MARKER, found + 1)) {
    const line = lineAt(text, from + found)
    if (line.start < from || text.slice(line.start, line.end).trim() !== HIDDEN_MARKER) continue
    // The commented view follows, one comment line after another, up to the end line.
    let end = line.end
    for (let at = line.next; at < to;) {
      const next = lineAt(text, at), content = text.slice(next.start, next.end)
      // Another block starting means this one never closed.
      if (next.end > to || !/^[ \t]*\/\//.test(content) || content.trim() === HIDDEN_MARKER) break
      if (content.trim() === HIDDEN_END) { end = next.end; break }
      at = next.next
    }
    cuts.push([line.start, end])
  }
}

/** The line holding `offset`: where it starts, where its text ends, and where the next begins. */
function lineAt(text: string, offset: number): { start: number; end: number; next: number } {
  const start = text.lastIndexOf('\n', offset - 1) + 1
  const newline = text.indexOf('\n', offset)
  const end = newline < 0 ? text.length : newline > start && text[newline - 1] === '\r' ? newline - 1 : newline
  return { start, end, next: newline < 0 ? text.length : newline + 1 }
}

/** `text` with the cuts taken out, dropping each line they leave blank and the spaces they leave at a line's end. */
function withoutCuts(text: string, cuts: readonly [number, number][]): string {
  if (!cuts.length) return text
  const cut = new Uint8Array(text.length)
  for (const [start, end] of cuts) cut.fill(1, start, end)
  let out = ''
  for (let start = 0; start < text.length;) {
    const line = lineAt(text, start)
    let kept = '', touched = false
    for (let i = line.start; i < line.end; i++) {
      if (cut[i]) touched = true
      else kept += text[i]
    }
    if (!touched) out += text.slice(line.start, line.next)
    else if (kept.trim()) out += kept.replace(/[ \t]+$/, '') + text.slice(line.end, line.next)
    start = line.next
  }
  return out
}
