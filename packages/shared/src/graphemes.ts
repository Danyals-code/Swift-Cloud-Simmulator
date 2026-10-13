/**
 * Splits a string the way Swift's `String` does - by grapheme cluster.
 *
 * Spreading a string (`[...text]`) splits by *code point*, which gets "👋🏽" wrong: the
 * emoji and its skin-tone modifier are two code points but one character. Swift's
 * `count` is 1; naive JS says 2, and `.first` returns half an emoji.
 *
 * Firefox 115 to 124 has no `Intl.Segmenter`; there a code point stands in for a
 * grapheme, which is right for everything but combined characters.
 */
const GRAPHEMES =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

export function graphemes(text: string): string[] {
  if (!GRAPHEMES) return [...text]
  return Array.from(GRAPHEMES.segment(text), (s) => s.segment)
}
