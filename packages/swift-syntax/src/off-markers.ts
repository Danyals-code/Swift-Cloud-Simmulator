/**
 * A switched-off modifier, kept in the source as a block comment:
 * `/*studio-off:1 ".background(Color.blue)"*\/`.
 *
 * The modifier writer in swift-sema reads and writes these, but the format lives here
 * because the edits need it too. A marker after a view's last live modifier is a
 * comment the parser skips, yet it is that view's text: a view moved without it hands
 * the switched-off modifier to whichever view ends up in front of it.
 */

export const OFF_MARKER_HEAD = '/*studio-off:1 '

/** One marker. Its JSON string, the modifier's own text, is group 1. */
export const OFF_MARKER_SOURCE = String.raw`\/\*studio-off:1 ("(?:[^"\\]|\\.)*")\*\/`

const TRAILING = new RegExp(String.raw`^(?:\s*${OFF_MARKER_SOURCE})+`)

/** Where the switched-off modifiers written straight after `end` finish - whitespace and markers only - or `end` when there are none. */
export function afterOffMarkers(text: string, end: number): number {
  const trailing = TRAILING.exec(text.slice(end))
  return trailing ? end + trailing[0].length : end
}
