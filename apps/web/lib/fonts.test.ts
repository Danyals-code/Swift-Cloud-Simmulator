import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readImage, type FontAsset } from '@studio/project-model'
import { familyOptions, fontFiles, fontLabel, importAssetFiles, importFontFiles, previewFonts } from './fonts'

/** Geist Regular, SIL Open Font License 1.1: PostScript name Geist-Regular, family Geist. */
const geist = readFileSync(fileURLToPath(new URL('../../../e2e/fixtures/Geist-Regular.ttf', import.meta.url)))
const file = (bytes: Uint8Array, name: string, type = '') => new File([bytes.slice()], name, { type })
const face = (postScriptName: string, family: string, weight = 400, italic = false) => ({ postScriptName, family, weight, italic })
/** Fonts a project already has: `count` faces, `bytes` long between them. */
const kept = (count: number, bytes = count) => Array.from({ length: count }, (_, i) => ({ postScriptName: `Kept-${i}`, bytes: new Uint8Array(i ? 1 : bytes - count + 1) }))

describe('adding font files to Assets', () => {
  it('reads a .ttf for its PostScript and family names, keeping its bytes', async () => {
    const { added, problems } = await importFontFiles([file(geist, 'Geist-Regular.ttf', 'font/ttf')], [])
    expect(problems).toEqual([])
    expect(added.map(font => [font.postScriptName, font.family, font.weight, font.italic, font.format])).toEqual([['Geist-Regular', 'Geist', 400, false, 'ttf']])
    expect(added[0]!.bytes.length).toBe(geist.length)
    expect(added[0]!.id).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('refuses a file that is not a font, with the reason, and still adds the rest', async () => {
    const { added, problems } = await importFontFiles([file(new TextEncoder().encode('not a font at all'), 'Brand.otf'), file(geist, 'Geist.ttf')], [])
    expect(added.map(font => font.postScriptName)).toEqual(['Geist-Regular'])
    expect(problems).toEqual(['Brand.otf: That file isn’t a TrueType or OpenType font. Use a .ttf or .otf file.'])
  })

  it('refuses a face the project already has, or one twice in the same drop', async () => {
    const existing = [{ ...face('Geist-Regular', 'Geist'), bytes: new Uint8Array(1) }]
    expect((await importFontFiles([file(geist, 'Geist.ttf')], existing)).problems).toEqual(['Geist.ttf: Geist-Regular is already in Assets.'])
    const twice = await importFontFiles([file(geist, 'a.ttf'), file(geist, 'b.ttf')], [])
    expect([twice.added.length, twice.problems]).toEqual([1, ['b.ttf: Geist-Regular is already in Assets.']])
  })

  it('refuses a file over 8 MB without reading it', async () => {
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'Huge.ttf')
    expect((await importFontFiles([big], [])).problems).toEqual(['Huge.ttf is larger than 8 MB.'])
  })

  it('refuses a font over the 32 a project can hold, or past its 16 MB of fonts, without reading it', async () => {
    expect(await importFontFiles([file(geist, 'Geist.ttf')], kept(32))).toEqual({ added: [], problems: ['Geist.ttf: A project can contain up to 32 fonts.'] })
    expect((await importFontFiles([file(geist, 'Geist.ttf')], kept(31))).added.map(font => font.postScriptName)).toEqual(['Geist-Regular'])
    const full = 16 * 1024 * 1024 - geist.length + 1
    expect(await importFontFiles([file(geist, 'Geist.ttf')], kept(2, full))).toEqual({ added: [], problems: ['Geist.ttf: Project fonts must total no more than 16 MB.'] })
    expect((await importFontFiles([file(geist, 'Geist.ttf')], kept(2, full - 1))).problems).toEqual([])
  })

  it('tells font files from images in a drop by their extension or type', () => {
    const picked = [file(geist, 'Geist.TTF'), file(geist, 'Brand.otf'), file(geist, 'served', 'font/otf'), file(geist, 'Hero.png', 'image/png'), file(geist, 'Web.woff2')]
    const { fonts, others } = fontFiles(picked)
    expect(fonts.map(f => f.name)).toEqual(['Geist.TTF', 'Brand.otf', 'served'])
    expect(others.map(f => f.name)).toEqual(['Hero.png', 'Web.woff2'])
  })
})

describe('a drop of fonts and images into Assets', () => {
  const png = readFileSync(fileURLToPath(new URL('../../../tests/fixtures/authoring-photo.png', import.meta.url)))
  // The browser decodes to check orientation; here the decoder reports what the header says.
  afterEach(() => vi.unstubAllGlobals())
  const decodesUpright = () => vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    const { width, height } = readImage(new Uint8Array(await blob.arrayBuffer()))
    return { width, height, close() {} }
  })

  it('reads each kind for Assets: fonts for their names, images as images', async () => {
    decodesUpright()
    const { fonts, images, problems } = await importAssetFiles([file(geist, 'Geist.ttf'), file(png, 'Hero.png', 'image/png')], { assets: [], fonts: [] })
    expect([fonts.map(font => font.postScriptName), images.map(image => image.name), problems]).toEqual([['Geist-Regular'], ['Hero'], []])
  })

  it('refuses only the fonts over the limits, with the reason, and still takes the images in it', async () => {
    decodesUpright()
    const drop = [file(geist, 'Geist.ttf'), file(png, 'Hero.png', 'image/png')]
    const many = await importAssetFiles(drop, { assets: [], fonts: kept(32) })
    expect([many.fonts, many.images.map(image => image.name), many.problems]).toEqual([[], ['Hero'], ['Geist.ttf: A project can contain up to 32 fonts.']])
    const large = await importAssetFiles(drop, { assets: [{ name: 'Hero' }], fonts: kept(1, 16 * 1024 * 1024) })
    expect([large.fonts, large.images.map(image => image.name), large.problems]).toEqual([[], ['Hero 2'], ['Geist.ttf: Project fonts must total no more than 16 MB.']])
  })

  it('says there was nothing to add for an empty drop', async () => {
    expect(await importAssetFiles([], { assets: [], fonts: [] })).toEqual({ fonts: [], images: [], problems: [] })
  })
})

describe('naming a face', () => {
  it('says its family and its style, as a font menu does', () => {
    expect(fontLabel(face('Geist-Regular', 'Geist'))).toBe('Geist Regular')
    expect(fontLabel(face('Brand-SemiboldItalic', 'Brand', 600, true))).toBe('Brand Semibold Italic')
    expect(fontLabel(face('Brand-Italic', 'Brand', 400, true))).toBe('Brand Italic')
    expect(fontLabel(face('Brand-Black', 'Brand', 900))).toBe('Brand Black')
    expect(fontLabel(face('Odd', 'Odd', 350))).toBe('Odd Regular')
  })
})

describe("the Family select's choices", () => {
  it("lists the project's faces by family and weight, writing each face's PostScript name, then iOS's families", () => {
    const { project, ios } = familyOptions([face('Brand-Bold', 'Brand', 700), face('Alpha-Regular', 'Alpha'), face('Brand-Regular', 'Brand'), face('Brand-Italic', 'Brand', 400, true)], ['Avenir Next', 'Georgia'])
    expect(project).toEqual([
      { value: 'Alpha-Regular', label: 'Alpha Regular' },
      { value: 'Brand-Regular', label: 'Brand Regular' },
      { value: 'Brand-Italic', label: 'Brand Italic' },
      { value: 'Brand-Bold', label: 'Brand Bold' },
    ])
    expect(ios).toEqual([{ value: 'Avenir Next', label: 'Avenir Next' }, { value: 'Georgia', label: 'Georgia' }])
  })

  it('keeps a name written in code that is in neither list, so the select still shows it', () => {
    expect(familyOptions([face('Brand-Regular', 'Brand')], ['Georgia'], 'Brand').written).toEqual({ value: 'Brand', label: 'Brand' })
    expect(familyOptions([], ['Georgia'], 'Georgia').written).toBeUndefined()
    expect(familyOptions([face('Brand-Regular', 'Brand')], [], 'Brand-Regular').written).toBeUndefined()
    expect(familyOptions([], [], undefined).written).toBeUndefined()
  })
})

describe('what the compiler is told', () => {
  it("is each face's names, weight, slant and metrics, without its bytes", () => {
    const font = { id: 'a', format: 'ttf', bytes: new Uint8Array(4), ...face('Brand-Bold', 'Brand', 700), metrics: { unitsPerEm: 1000, ascender: 900, descender: -250, lineGap: 0 } } as const satisfies FontAsset
    expect(previewFonts([font])).toEqual([{ ...face('Brand-Bold', 'Brand', 700), metrics: font.metrics }])
    expect(previewFonts(undefined)).toBeUndefined()
    expect(previewFonts([])).toBeUndefined()
  })
})
