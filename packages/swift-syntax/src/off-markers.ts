/**
 * A switched-off modifier, kept in the source as a block comment:
 * `/*studio-off:1 ".background(Color.blue)"*\/`.
 *
 * JSON keeps the modifier's text exact, and every asterisk is written as `\u002a`, so
 * nothing inside can open or close a Swift block comment - which nest, so a stray
 * opener in a string literal would otherwise swallow the rest of the file. The version
 * is in the marker so a later format can still read this one.
 *
 * The modifier writer in swift-sema reads and writes these, but the format lives here
 * because the edits need it too. A marker after a view's last live modifier is a
 * comment the parser skips, yet it is that view's text: a view moved without it hands
 * the switched-off modifier to whichever view ends up in front of it.
 */

import { Lexer } from './lexer'

const HEAD = '/*studio-off:1 '
/** One marker, the head escaped for a pattern. Its JSON string is group 1. */
const MARKER = HEAD.replace(/[/*]/g, '\\$&') + String.raw`("(?:[^"\\]|\\.)*")\*\/`
const ONE = new RegExp(`^${MARKER}$`)
const TRAILING = new RegExp(String.raw`^(?:\s*${MARKER})+`)

/** The marker that switches off a modifier written as `modifier`. */
export function offMarker(modifier: string): string {
  return `${HEAD}${JSON.stringify(modifier).replace(/\*/g, '\\u002a')}*/`
}

/** The modifier a marker switched off, or undefined for text that is not a marker. */
export function offMarkerText(marker: string): string | undefined {
  const match = ONE.exec(marker)
  if (!match) return undefined
  try { const value: unknown = JSON.parse(match[1]!); return typeof value === 'string' ? value : undefined } catch { return undefined }
}

/** Every marker in `text`, in order. */
export function offMarkersIn(text: string): IterableIterator<RegExpMatchArray> {
  return text.matchAll(new RegExp(MARKER, 'g'))
}

/** `text` with its markers taken out, so what is left can be searched for a person's comments. */
export function withoutOffMarkers(text: string): string {
  return text.replace(new RegExp(MARKER, 'g'), '')
}

/** Where the switched-off modifiers written straight after `end` finish - whitespace and markers only - or `end` when there are none. */
export function afterOffMarkers(text: string, end: number): number {
  const trailing = TRAILING.exec(text.slice(end))
  return trailing ? end + trailing[0].length : end
}

/**
 * Whether a person's comment sits in this stretch of source.
 *
 * Read from the gaps between tokens, so comment-like characters inside a string are
 * text, not a comment, and the studio's own off markers never count.
 */
export function hasHumanComment(text: string, file: string): boolean {
  const tokens = Lexer.tokenize(text, file).tokens
  let at = 0
  for (const token of tokens) {
    if (/\/\/|\/\*/.test(withoutOffMarkers(text.slice(at, token.span.start)))) return true
    at = token.span.end
  }
  return /\/\/|\/\*/.test(withoutOffMarkers(text.slice(at)))
}
