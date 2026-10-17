import { describe, expect, it } from 'vitest'
import { LIBRARY_IMAGES, libraryImageURL } from '@studio/project-model'
import { libraryImagePath } from './designExport'

/**
 * Which images a PNG capture may embed from the page (Wave 7b). A library image is drawn from
 * its same-origin `/library/v1/` path, so the capture inlines it as a data URL; anything else
 * that isn't already a data URL is still refused.
 */
describe('the library images a capture embeds', () => {
  const origin = 'https://studio.example'

  it('takes a library image served by the studio itself', () => {
    expect(libraryImagePath('https://studio.example/library/v1/snowy-peak.jpg', origin)).toBe('/library/v1/snowy-peak.jpg')
    expect(libraryImagePath('/library/v1/sea-tram.jpg', origin)).toBe('/library/v1/sea-tram.jpg')
  })

  it('takes every image the library serves, wherever the manifest serves them from', () => {
    for (const { name } of LIBRARY_IMAGES) expect(libraryImagePath(`${origin}${libraryImageURL(name)}`, origin)).toBe(libraryImageURL(name))
  })

  it.each([
    'https://elsewhere.example/library/v1/snowy-peak.jpg',
    'https://studio.example/library/v1/thumbs/snowy-peak.jpg',
    'https://studio.example/library/v2/snowy-peak.jpg',
    'https://studio.example/library/v1/not-in-the-library.jpg',
    'https://studio.example/library/v1/snowy-peak.jpg?v=2',
    'https://studio.example/photo.jpg',
    'data:image/png;base64,AAAA',
  ])('refuses %s', src => {
    expect(libraryImagePath(src, origin)).toBeNull()
  })
})
