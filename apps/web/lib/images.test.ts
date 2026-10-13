import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readImage } from '@studio/project-model'
import { draggingFiles, importImageFiles } from './images'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/${name}`, import.meta.url)))
const png = fixture('authoring-photo.png'), jpeg = fixture('authoring-photo.jpg')
const file = (bytes: Uint8Array, name: string, type: string) => new File([bytes.slice()], name, { type })

// The browser decodes to check orientation; here the decoder reports what the header says.
afterEach(() => vi.unstubAllGlobals())
const decodesUpright = () => vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
  const { width, height } = readImage(new Uint8Array(await blob.arrayBuffer()))
  return { width, height, close() {} }
})

describe('importing images into Assets', () => {
  it('adds every PNG and JPEG in a drop, named after its file and never colliding', async () => {
    decodesUpright()
    const { added, problems } = await importImageFiles([file(png, 'Sunset.png', 'image/png'), file(jpeg, 'Sunset.jpg', ''), file(png, 'Beach.PNG', '')], [{ name: 'Beach' }])
    expect(problems).toEqual([])
    expect(added.map(asset => asset.name)).toEqual(['Sunset', 'Sunset 2', 'Beach 2'])
    expect(added.every(asset => asset.scale === 1 && asset.light.width > 0)).toBe(true)
  })

  it('reports what it could not add by name, and still adds the rest', async () => {
    decodesUpright()
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'Huge.png', { type: 'image/png' })
    const { added, problems } = await importImageFiles([file(new TextEncoder().encode('{}'), 'notes.json', 'application/json'), big, file(png, 'Hero.png', 'image/png')], [])
    expect(added.map(asset => asset.name)).toEqual(['Hero'])
    expect(problems).toEqual(['notes.json is not a PNG or JPEG image.', 'Huge.png is larger than 4 MB.'])
  })

  it('tells a drag of files from outside apart from one within the studio', () => {
    expect(draggingFiles({ types: ['Files'] } as unknown as DataTransfer)).toBe(true)
    expect(draggingFiles({ types: ['application/x-studio-asset', 'text/plain'] } as unknown as DataTransfer)).toBe(false)
    expect(draggingFiles(null)).toBe(false)
  })
})
