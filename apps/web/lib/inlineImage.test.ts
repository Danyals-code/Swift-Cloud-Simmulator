import { describe, expect, it } from 'vitest'
import { inlineImageOf, textPartsSummary, textValueName } from './inlineImage'

/**
 * An image among a Text's words (Wave 6a), `Text("Rated \(Image(systemName: "star.fill")) 4.8")`:
 * the value part of a `content:parts` control holds the Swift between `\(` and `)` as written.
 */
describe('an image among a text’s words', () => {
  it('reads a symbol or an asset written with a literal name', () => {
    expect(inlineImageOf('Image(systemName: "star.fill")')).toEqual({ symbol: 'star.fill' })
    expect(inlineImageOf('Image("Badge")')).toEqual({ image: 'Badge' })
  })

  it('reads nothing from a value that is not one image named by a literal', () => {
    expect(inlineImageOf('count')).toBeNull()
    expect(inlineImageOf('Image(systemName: name)')).toBeNull()
    expect(inlineImageOf('Image(systemName: "star.fill").foregroundStyle(.yellow)')).toBeNull()
    expect(inlineImageOf('Image(systemName: "a") + Image(systemName: "b")')).toBeNull()
    expect(inlineImageOf('Image(systemName: "star\\(n)")')).toBeNull()
  })

  it('names a value as the panel reads it: an image by its name, anything else as its Swift', () => {
    expect(textValueName('Image(systemName: "star.fill")')).toBe('star.fill')
    expect(textValueName('Image("Badge")')).toBe('Badge')
    expect(textValueName('place.rating')).toBe('place.rating')
  })

  it('sums the words up with each image by its name and each other value as its Swift', () => {
    expect(textPartsSummary(['Rated ', 'Image(systemName: "star.fill")', ' 4.8'])).toBe('Rated {star.fill} 4.8')
    expect(textPartsSummary(['Total: ', 'count', ''])).toBe('Total: {count}')
    expect(textPartsSummary(['', 'Image("Badge")', ''])).toBe('{Badge}')
  })
})
