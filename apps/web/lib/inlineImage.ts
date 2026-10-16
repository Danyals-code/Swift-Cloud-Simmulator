/**
 * The image a value among a Text's words is (Wave 6a), as `\(Image(systemName: "star.fill"))`
 * draws one inline: a symbol or an asset named by a literal, and nothing else. A name that
 * is computed, or an image with modifiers, is left to show as its Swift.
 */
export function inlineImageOf(value: string): { symbol: string } | { image: string } | null {
  const named = /^Image\((systemName: )?"([^"\\]+)"\)$/.exec(value)
  return !named ? null : named[1] ? { symbol: named[2]! } : { image: named[2]! }
}

/** A value among the words as the panel names it: an image by its name, anything else as its Swift. */
export function textValueName(value: string): string {
  const image = inlineImageOf(value)
  return image ? 'symbol' in image ? image.symbol : image.image : value
}

/** Words and values as a card sums them up: each value in braces, by `textValueName`. */
export const textPartsSummary = (parts: readonly string[]): string => parts.map((part, index) => index % 2 ? `{${textValueName(part)}}` : part).join('')
