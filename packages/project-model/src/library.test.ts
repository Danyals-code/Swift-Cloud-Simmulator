import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { assetName, readImage } from './assets'
import { LIBRARY_IMAGES, LIBRARY_PATH, libraryImage, libraryImageURL, libraryThumbURL } from './library'

/**
 * The built-in image library (Wave 7b). The names are the plan's (WAVE7-PLAN §2.9), the pixel
 * sizes are what `sips` measured on the files the user sent, and the fingerprints are the first
 * 16 hex digits of each original's SHA-256: the files ship exactly as sent, watermarks included.
 */
const PUBLIC = new URL('../../../apps/web/public', import.meta.url)
const served = (path: string) => new Uint8Array(readFileSync(new URL(`.${path}`, `${PUBLIC.href}/`)))
const EXPECTED: readonly [name: string, width: number, height: number, sha256: string][] = [
  ['blue-mosaic', 1200, 1834, '92551e028720e54e'],
  ['terracotta-figures', 532, 800, '076805f56cc78740'],
  ['stone-circle-moon', 736, 1105, '91d7f679370693b8'],
  ['giant-redwoods', 735, 918, '5a17b879fa2f469f'],
  ['arch-view', 600, 900, 'c7f86ed465c2f458'],
  ['portrait-card-table', 303, 348, '34da76b9f6ffcf9f'],
  ['portrait-sword', 1200, 1801, 'aac06eff8f81b4c2'],
  ['portrait-village', 895, 1114, '86bec542e64a04b2'],
  ['red-roof-house', 680, 1002, '214ce26bddcd6486'],
  ['sea-tram', 736, 736, '4b7f15814939a0eb'],
  ['red-bus-bridge', 1200, 1500, 'e8cfaa227223a44f'],
  ['portrait-press', 402, 612, '18d6b8cd22d2e8fd'],
  ['basketball-player', 564, 1002, '2a8ffdb9e7dc9ebf'],
  ['portrait-pipe', 1200, 1797, 'e03608f1865934fa'],
  ['snowy-peak', 681, 1024, '65f90875e7bb7784'],
]

describe('the image library manifest', () => {
  it('lists the 15 images by name and pixel size, all at 3x', () => {
    expect(LIBRARY_IMAGES.map(i => [i.name, i.width, i.height, i.scale])).toEqual(EXPECTED.map(([name, w, h]) => [name, w, h, 3]))
  })

  it('uses names that are valid asset names, lowercase kebab-case, and unique', () => {
    for (const { name } of LIBRARY_IMAGES) {
      expect(assetName(name)).toBe(name)
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
    expect(new Set(LIBRARY_IMAGES.map(i => i.name)).size).toBe(15)
  })

  it('gives every image alt text that ends its description with the aspect ratio', () => {
    for (const { alt } of LIBRARY_IMAGES) {
      expect(alt).toMatch(/\b\d+:\d+\b/)
      expect(alt).not.toMatch(/[\u2013\u2014]/)
    }
    expect(libraryImage('sea-tram')?.alt).toContain('1:1')
    expect(libraryImage('basketball-player')?.alt).toContain('9:16')
  })

  it('matches names exactly, as the preview does', () => {
    expect(libraryImage('snowy-peak')?.width).toBe(681)
    expect(libraryImage('Snowy-Peak')).toBeUndefined()
    expect(libraryImage('snowy-peak.jpg')).toBeUndefined()
  })

  it('serves full images and thumbnails from the immutable v1 folder', () => {
    expect(LIBRARY_PATH).toBe('/library/v1/')
    expect(libraryImageURL('snowy-peak')).toBe('/library/v1/snowy-peak.jpg')
    expect(libraryThumbURL('snowy-peak')).toBe('/library/v1/thumbs/snowy-peak.jpg')
  })
})

describe('the served library files', () => {
  it('holds exactly the manifest, each file unmodified, matching its size, and readable as a JPEG', () => {
    const files = readdirSync(new URL('./library/v1', `${PUBLIC.href}/`)).filter(f => f !== 'thumbs').sort()
    expect(files).toEqual(EXPECTED.map(([name]) => `${name}.jpg`).sort())
    for (const [name, width, height, sha256] of EXPECTED) {
      const bytes = served(libraryImageURL(name))
      expect(createHash('sha256').update(bytes).digest('hex').slice(0, 16), name).toBe(sha256)
      expect(readImage(bytes), name).toMatchObject({ mime: 'image/jpeg', width, height })
    }
  })

  it('has a JPEG thumbnail of each image, 160 px on its long edge, in the same aspect', () => {
    const thumbs = readdirSync(new URL('./library/v1/thumbs', `${PUBLIC.href}/`)).sort()
    expect(thumbs).toEqual(EXPECTED.map(([name]) => `${name}.jpg`).sort())
    for (const { name, width, height } of LIBRARY_IMAGES) {
      const thumb = readImage(served(libraryThumbURL(name)))
      expect(Math.max(thumb.width, thumb.height), name).toBe(160)
      expect(Math.abs(thumb.width / thumb.height - width / height), name).toBeLessThan(0.01)
    }
  })
})
