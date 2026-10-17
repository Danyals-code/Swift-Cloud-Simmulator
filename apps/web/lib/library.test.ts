import { describe, expect, it } from 'vitest'
import { LIBRARY_IMAGES, type ImageAsset } from '@studio/project-model'
import { libraryNameProblem, libraryRows, previewImages, removalOperation, replacesLibrary } from './library'
import { importedImageName } from './images'
import { usedLibraryNames } from './exportProject'

const pixels = (width: number, height: number) => ({ bytes: new Uint8Array([1]), mime: 'image/png' as const, width, height })
const own = (name: string, scale: 1 | 2 | 3 = 1): ImageAsset => ({ id: `id-${name}`, name, scale, light: pixels(300, 150) })

describe('previewImages: the project first, then the library (Wave 7b)', () => {
  it('lists every library image by its served path, at a third of its pixels, when the project has none of its own', () => {
    const images = previewImages({})
    expect(images).toHaveLength(15)
    expect(images.find(image => image.name === 'snowy-peak')).toEqual({ name: 'snowy-peak', width: 227, height: expect.closeTo(341.33, 2), light: '/library/v1/snowy-peak.jpg' })
    expect(images.find(image => image.name === 'sea-tram')).toEqual({ name: 'sea-tram', width: expect.closeTo(245.33, 2), height: expect.closeTo(245.33, 2), light: '/library/v1/sea-tram.jpg' })
  })
  it('keeps the project’s images as they were drawn, as data URLs in points, ahead of the library', () => {
    const images = previewImages({ assets: [own('Logo', 2)] })
    expect(images[0]).toEqual({ name: 'Logo', width: 150, height: 75, light: 'data:image/png;base64,AQ==', dark: undefined })
    expect(images).toHaveLength(16)
  })
  it('draws the project’s own image instead of the library image of exactly its name', () => {
    const images = previewImages({ assets: [own('snowy-peak')] })
    expect(images.filter(image => image.name === 'snowy-peak')).toEqual([{ name: 'snowy-peak', width: 300, height: 150, light: 'data:image/png;base64,AQ==', dark: undefined }])
    expect(images).toHaveLength(15)
  })
})

/**
 * One rule for an own image named like a library image (Wave 7b). The exact name shadows, as
 * `bitmapOf` and iOS look an image up. A name differing only in case, which only an older project
 * can hold, keeps the library image out of the export, since an asset catalog can't hold both;
 * so the preview, the panel and the pickers leave it out too, and the preview draws what iOS would.
 */
describe('an own image named like a library image, one rule everywhere', () => {
  const code = { files: [{ id: 'Sources/Home.swift', text: 'let a = "snowy-peak"' }] }
  const where = (name: string) => {
    const assets = [own(name)]
    return {
      previewed: previewImages({ assets }).some(image => image.light === '/library/v1/snowy-peak.jpg'),
      replaced: libraryRows(assets).find(row => row.name === 'snowy-peak')!.replaced,
      exported: usedLibraryNames({ ...code, assets } as never).includes('snowy-peak'),
    }
  }
  it('an own image of exactly its name shadows the library image everywhere', () => {
    expect(where('snowy-peak')).toEqual({ previewed: false, replaced: true, exported: false })
  })
  it('an older project’s own image differing only in case keeps it out of the export, and so out of the preview', () => {
    expect(where('Snowy-Peak')).toEqual({ previewed: false, replaced: true, exported: false })
  })
  it('any other name leaves the library image drawn and exported', () => {
    expect(where('snowy-peak 2')).toEqual({ previewed: true, replaced: false, exported: true })
  })
})

describe('libraryRows: what the Assets panel and the pickers list', () => {
  it('lists the 15 images in the library’s order, sized in points, with their thumbnails', () => {
    const rows = libraryRows([])
    expect(rows.map(row => row.name)).toEqual(LIBRARY_IMAGES.map(image => image.name))
    expect(rows[0]).toMatchObject({ name: 'blue-mosaic', width: 400, height: expect.closeTo(611.33, 2), thumb: '/library/v1/thumbs/blue-mosaic.jpg', url: '/library/v1/blue-mosaic.jpg', replaced: false })
  })
  it('marks a row the project replaces with its own image', () => {
    const rows = libraryRows([own('RED-BUS-BRIDGE')])
    expect(rows.find(row => row.name === 'red-bus-bridge')?.replaced).toBe(true)
    expect(rows.filter(row => row.replaced)).toHaveLength(1)
  })
})

describe('own images named like library images (§2.3)', () => {
  it('names an added image so that it never replaces a library image by accident', () => {
    expect(importedImageName('snowy-peak.jpg', [])).toBe('snowy-peak 2')
    expect(importedImageName('Sea-Tram.PNG', [])).toBe('Sea-Tram 2')
    expect(importedImageName('snowy-peak.jpg', [{ name: 'snowy-peak 2' }])).toBe('snowy-peak 3')
    expect(importedImageName('peak.jpg', [])).toBe('peak')
  })
  it('says a rename to a library name replaces that library image in this project', () => {
    expect(replacesLibrary('snowy-peak')).toBe(true)
    expect(replacesLibrary(' snowy-peak ')).toBe(true)
    expect(replacesLibrary('Snowy-Peak')).toBe(false)
    expect(replacesLibrary('snowy-peak 2')).toBe(false)
  })
  it('refuses a rename to a library name in other letter case, which an asset catalog can’t hold beside it', () => {
    expect(libraryNameProblem('Snowy-Peak')).toBe('The Library has an image named “snowy-peak”. Use exactly that name to replace it, or choose another name.')
    expect(libraryNameProblem(' SEA-TRAM ')).toBe('The Library has an image named “sea-tram”. Use exactly that name to replace it, or choose another name.')
    expect(libraryNameProblem('snowy-peak')).toBeUndefined()
    expect(libraryNameProblem('Snowy-Peak 2')).toBeUndefined()
  })
  it('deletes an image that replaces a library image without rewriting its uses, which go back to the library', () => {
    expect(removalOperation('snowy-peak', '')).toBeUndefined()
    // Only the exact name falls back: the preview, like iOS, matches an image's name exactly.
    expect(removalOperation('Snowy-Peak', '')).toEqual({ kind: 'asset-references', from: 'Snowy-Peak', to: null })
    expect(removalOperation('snowy-peak', 'Logo')).toEqual({ kind: 'asset-references', from: 'snowy-peak', to: 'Logo' })
    expect(removalOperation('Logo', '')).toEqual({ kind: 'asset-references', from: 'Logo', to: null })
  })
})
