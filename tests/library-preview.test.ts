import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { LIBRARY_IMAGES, libraryImageURL, readImage } from '@studio/project-model'
import type { PreviewImageAsset } from '@studio/shared'
import { previewImages } from '../apps/web/lib/library'
import { libraryPreviewImages } from './helpers/library'

/**
 * The built-in image library in the preview (Wave 7b, WAVE7-PLAN §2.2). The page maps a library
 * image to its same-origin `/library/v1/<name>.jpg` path at a third of its pixel size; the
 * runtime draws that path and nothing else that isn't a bundled `data:` URL, so code can never
 * make the preview fetch a remote image.
 */
const app = (body: string) => [{ id: 'Sources/App.swift', text: `import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { VStack { ${body} } } }\n` }]
const draw = (body: string, images: readonly PreviewImageAsset[]) => compile({ projectId: 'p', files: app(body), revision: 1, canvas: { width: 402, height: 874 }, colorScheme: 'light', images })
const bitmaps = (result: ReturnType<typeof compile>) => result.renderTree?.nodes.filter(node => node.image?.bitmap) ?? []
const ownPhoto = (name: string) => ({ id: 'own', name, scale: 1 as const, light: readImage(new Uint8Array(readFileSync(new URL('./fixtures/authoring-photo.png', import.meta.url)))) })

beforeEach(resetPipelineState)
describe('a library image in the preview (Wave 7b)', () => {
  it('draws Image("snowy-peak") from its served file, at its 3x size in points, with nothing in the project', () => {
    const result = draw('Image("snowy-peak")', libraryPreviewImages())
    expect(result.diagnostics).toEqual([])
    const [peak] = bitmaps(result)
    expect(peak?.image?.bitmap?.url).toBe('/library/v1/snowy-peak.jpg')
    expect(peak?.frame.width).toBeCloseTo(227)
    expect(peak?.frame.height).toBeCloseTo(341.33, 1)
  })

  it('draws one inline in text too', () => {
    const result = draw('Text("A \\(Image("snowy-peak")) B")', libraryPreviewImages())
    const runs = result.renderTree!.nodes.find(node => node.text)!.text!.runs
    expect(runs.map(run => run.bitmap?.url ?? run.text)).toEqual(['A ', '/library/v1/snowy-peak.jpg', ' B'])
  })

  // The runtime can't import the manifest without pulling the project model into the worker,
  // so its path pattern is its own; this keeps the two in step.
  it('draws every image from wherever the manifest serves it', () => {
    const images = libraryPreviewImages()
    for (const { name } of LIBRARY_IMAGES) expect(bitmaps(draw(`Image("${name}")`, images))[0]?.image?.bitmap?.url, name).toBe(libraryImageURL(name))
  })

  it('draws the project’s own image of that exact name instead, which replaces it', () => {
    const result = draw('Image("snowy-peak")', previewImages({ assets: [ownPhoto('snowy-peak')] }))
    expect(bitmaps(result)[0]?.image?.bitmap?.url).toMatch(/^data:image\/png;base64,/)
  })

  it('draws neither for an older project’s own image named in other letter case, as the export bundles only that one', () => {
    const images = previewImages({ assets: [ownPhoto('Snowy-Peak')] })
    expect(bitmaps(draw('Image("snowy-peak")', images))).toEqual([])
    expect(bitmaps(draw('Image("Snowy-Peak")', images))[0]?.image?.bitmap?.url).toMatch(/^data:image\/png;base64,/)
  })

  it.each([
    'https://example.com/library/v1/snowy-peak.jpg',
    '//example.com/library/v1/snowy-peak.jpg',
    '/library/v1/../snowy-peak.jpg',
    '/library/v1/thumbs/snowy-peak.jpg',
    '/library/v2/snowy-peak.jpg',
    '/library/v1/Snowy-Peak.jpg',
    '/library/v1/snowy-peak.png',
    '/library/v1/snowy-peak.jpg?x=1',
    'javascript:alert(1)',
  ])('refuses %s even under a library image’s name, drawing the missing-image placeholder', light => {
    const result = draw('Image("snowy-peak")', [{ name: 'snowy-peak', width: 227, height: 341.33, light }])
    expect(bitmaps(result)).toEqual([])
    expect(result.renderTree!.nodes.some(node => node.text?.runs.some(run => run.text.includes('This image is missing')) || node.placeholder?.kind === 'missing')).toBe(true)
  })
})
