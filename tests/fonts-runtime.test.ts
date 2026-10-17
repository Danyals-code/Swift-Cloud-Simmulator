import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { UI_FONT_FAMILY, projectFont, projectFontFamily, replaceProjectFonts, type CompileRequest, type CompileResult, type PreviewFontAsset, type ProjectFontFile, type RenderNode } from '@studio/shared'
import { workerTextMeasurer } from '../apps/web/lib/workerFontMetrics'
import { XCODE, typecheckInXcode } from './helpers/layer-project'

// The project's own font files (Wave 6f), read from the render tree `compile` emits.
//
// The test faces are made up: 2048 units to the em, an ascender of 1900, a descender of
// -500 and a line gap of 200. A line is the ascender to the descender, without the gap, on
// the 1/3 pt grid, as the iOS 27 simulator draws the ten families 6a measured
// (docs/parity/native/iphone18pro-text): at 20 pt, 2400 / 2048 * 20 = 23.44, so 23.67.

const metrics = { unitsPerEm: 2048, ascender: 1900, descender: -500, lineGap: 200 }
const BOLD: PreviewFontAsset = { postScriptName: 'Brand-Bold', family: 'Brand', weight: 700, italic: false, metrics }
const ITALIC: PreviewFontAsset = { postScriptName: 'Brand-Italic', family: 'Brand', weight: 400, italic: true, metrics }
const REGULAR: PreviewFontAsset = { postScriptName: 'Brand-Regular', family: 'Brand', weight: 400, italic: false, metrics }
/** The bold and italic faces come first, so the family's regular face has to be picked. */
const BRAND = [BOLD, ITALIC, REGULAR]

let revision = 1
beforeEach(() => { resetPipelineState(); revision = 1 })
/** Every source drawn here, type-checked in Xcode 27 at the end. */
const sources: string[] = []

function app(body: string, options: Partial<CompileRequest> = {}): CompileResult {
  const text = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        ${body}
    }
}`
  sources.push(text)
  const result = compile({
    projectId: 'fonts', revision: revision++, canvas: { width: 402, height: 874 }, colorScheme: 'light',
    files: [{ id: 'Sources/App.swift', text }], fonts: BRAND, ...options,
  })
  expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  return result
}

const words = (node: RenderNode) => node.text?.runs.map(run => run.text).join('') ?? ''
const textNode = (result: CompileResult, text: string) => result.renderTree!.nodes.find(node => words(node) === text)
const face = (result: CompileResult, text: string) => {
  const node = textNode(result, text)!, font = node.text!.runs[0]!.font
  return { family: font.family.split(',')[0], size: Math.round(font.size * 100) / 100, weight: font.weight, italic: font.italic, height: Math.round(node.frame.height * 100) / 100 }
}
const fontWarnings = (result: CompileResult) => result.diagnostics.filter(diagnostic => /Custom font/.test(diagnostic.message))

describe('a project font', () => {
  it('draws by its PostScript name, in its own face, at the line height of its own metrics', () => {
    const result = app(`VStack {
            Text("Bold").font(.custom("Brand-Bold", size: 20))
            Text("Typed").font(Font.custom("Brand-Bold", size: 20))
        }`)
    expect(face(result, 'Bold')).toEqual({ family: '"Studio Font Brand"', size: 20, weight: 700, italic: false, height: 23.67 })
    expect(face(result, 'Typed')).toEqual(face(result, 'Bold'))
  })

  it('is as tall as the iOS 27 simulator draws Geist, by its family name too', () => {
    // packages/exporter/src/fonts-xcode.test.ts: UIFont gives Geist-Regular a 22.1 pt line at
    // 17 pt, (1005 + 295) / 1000 * 17, and SwiftUI draws its Text 22.33 tall, by either name.
    const geist: PreviewFontAsset = { postScriptName: 'Geist-Regular', family: 'Geist', weight: 400, italic: false, metrics: { unitsPerEm: 1000, ascender: 1005, descender: -295, lineGap: 0 } }
    const result = app(`VStack {
            Text("Face").font(.custom("Geist-Regular", size: 17, relativeTo: .body))
            Text("Family").font(.custom("Geist", size: 17))
        }`, { fonts: [geist] })
    expect(face(result, 'Face')).toEqual({ family: '"Studio Font Geist"', size: 17, weight: 400, italic: false, height: 22.33 })
    expect(face(result, 'Family')).toEqual(face(result, 'Face'))
  })

  it('draws by its family name in the regular upright face', () => {
    expect(face(app('Text("Brand").font(.custom("Brand", size: 20))'), 'Brand')).toEqual({ family: '"Studio Font Brand"', size: 20, weight: 400, italic: false, height: 23.67 })
    expect(face(app('Text("Italic").font(.custom("Brand-Italic", size: 20))'), 'Italic')).toMatchObject({ weight: 400, italic: true })
  })

  it('takes the bold face of its family for .bold()', () => {
    expect(face(app('Text("Bolded").font(.custom("Brand", size: 20)).bold()'), 'Bolded')).toMatchObject({ family: '"Studio Font Brand"', weight: 700 })
  })

  it('spaces its lines one line height apart', () => {
    expect(face(app('Text("One\\nTwo").font(.custom("Brand", size: 20))'), 'One\nTwo').height).toBe(47.33)
  })

  it('grows with Dynamic Type as the text style relativeTo: names does, and a fixed size does not', () => {
    // 20 pt relative to .body is 26.33 at xxxLarge (typography.ts), and its line 2400 / 2048 * 26.33 = 30.86, so 31.
    const body = app('Text("Body").font(.custom("Brand", size: 20))', { dynamicTypeSize: 'xxxLarge' })
    expect(face(body, 'Body')).toMatchObject({ size: 26.33, height: 31 })
    // Relative to .title, whose spacing goes from 34 at Large to 46 at accessibility1: 20 * 46 / 34 = 27.06, so 27.
    expect(face(app('Text("Title").font(.custom("Brand-Bold", size: 20, relativeTo: .title))', { dynamicTypeSize: 'accessibility1' }), 'Title')).toMatchObject({ size: 27, weight: 700 })
    expect(face(app('Text("Fixed").font(.custom("Brand", fixedSize: 20))', { dynamicTypeSize: 'accessibility1' }), 'Fixed')).toMatchObject({ family: '"Studio Font Brand"', size: 20 })
  })

  it('is drawn before an iOS family of the same name', () => {
    const georgia: PreviewFontAsset = { postScriptName: 'Georgia-Custom', family: 'Georgia', weight: 400, italic: false, metrics }
    expect(face(app('Text("Mine").font(.custom("Georgia", size: 20))', { fonts: [georgia] }), 'Mine')).toMatchObject({ family: '"Studio Font Georgia"', height: 23.67 })
  })

  it('stops the unknown font warning, which a name the project lacks still gets', () => {
    expect(fontWarnings(app('Text("Brand").font(.custom("Brand-Bold", size: 20))'))).toEqual([])
    expect(fontWarnings(app('Text("Brand").font(.custom("Brand", size: 20))'))).toEqual([])
    const other = app('Text("Other").font(.custom("Other Sans", size: 20))')
    expect(fontWarnings(other)).toHaveLength(1)
    expect(face(other, 'Other').family).toBe('-apple-system')
  })

  it('is forgotten when the next compile has no fonts', () => {
    app('Text("Brand").font(.custom("Brand", size: 20))')
    const after = app('Text("Brand").font(.custom("Brand", size: 20))', { fonts: undefined })
    expect(face(after, 'Brand').family).toBe('-apple-system')
    expect(fontWarnings(after)).toHaveLength(1)
  })

  it('is drawn on the page in its family', () => {
    const result = app('Text("Bold").font(.custom("Brand-Bold", size: 20))')
    const page = renderToStaticMarkup(createElement(RenderTreeView, { tree: result.renderTree!, onEvent: () => {} }))
    expect(page).toMatch(/font-family:&quot;Studio Font Brand&quot;, -apple-system[^;]*;[^"]*font-weight:700/)
  })
})

describe('matching a name to a face', () => {
  it('takes a PostScript name exactly, else a family nearest regular and upright', () => {
    expect(projectFont('Brand-Italic', BRAND)).toBe(ITALIC)
    expect(projectFont('Brand', BRAND)).toBe(REGULAR)
    expect(projectFont('Brand', [BOLD, ITALIC])).toBe(BOLD)
    expect(projectFont('brand', BRAND)).toBeUndefined()
    expect(projectFont('Brand', undefined)).toBeUndefined()
  })

  it('names the CSS family after the font family, with nothing that would end its quotes', () => {
    expect(projectFontFamily('Brand')).toBe('Studio Font Brand')
    expect(projectFontFamily('A "B" \\C')).toBe('Studio Font A B C')
  })
})

describe('registering the files', () => {
  /** A face as `FontFace` holds it, loading unless its bytes are empty. */
  class Face {
    constructor(readonly family: string, readonly source: Uint8Array, readonly descriptors: FontFaceDescriptors) {}
    load() { return this.source.length ? Promise.resolve(this) : Promise.reject(new Error('bad font')) }
  }
  const file = (font: PreviewFontAsset, bytes = new Uint8Array([1])): ProjectFontFile => ({ ...font, bytes })
  beforeEach(() => { vi.stubGlobal('FontFace', Face) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('adds each file under its family with its weight and style, replaces what it added before, and says which loaded', async () => {
    const set = new Set<Face>()
    const kept = new Face('Other', new Uint8Array([1]), {})
    set.add(kept)
    await replaceProjectFonts(set, [file(BOLD), file(ITALIC)])
    expect([...set].map(face => [face.family, face.descriptors])).toEqual([
      ['Other', {}],
      ['Studio Font Brand', { weight: '700', style: 'normal' }],
      ['Studio Font Brand', { weight: '400', style: 'italic' }],
    ])
    const regular = file(REGULAR)
    expect(await replaceProjectFonts(set, [regular, file(BOLD, new Uint8Array())])).toEqual([regular])
    // The file that can't load is left out, and the face the page added itself stays.
    expect([...set].map(face => [face.family, face.descriptors.weight])).toEqual([['Other', undefined], ['Studio Font Brand', '400']])
  })
})

describe('measuring in the worker', () => {
  /**
   * A canvas whose text is 10 px per character in a project family, as the worker draws it,
   * with the font's box unless `boxless`. As a real canvas does, it ignores a font it can't
   * parse, such as one naming `var(--font-ui)`, and keeps the one it had.
   */
  const measured: string[] = []
  let boxless = false, font = '10px sans-serif'
  const context = {
    get font() { return font },
    set font(value: string) { if (!value.includes('var(')) font = value },
    fontKerning: '', letterSpacing: '0px',
    measureText(text: string) { measured.push(font); return { width: text.length * 10, ...boxless ? {} : { fontBoundingBoxAscent: 15, fontBoundingBoxDescent: 5 } } },
  }
  beforeEach(() => { measured.length = 0; boxless = false; font = '10px sans-serif'; vi.stubGlobal('OffscreenCanvas', class { getContext() { return context } }) })
  afterEach(() => { vi.unstubAllGlobals() })
  const fontIn = (family: string) => ({ family, size: 20, weight: 700, italic: false, lineHeight: 23.67 })

  it('measures text in a project family itself, with no reference face, and leaves other families, and one it has not loaded, to the page', () => {
    const measure = workerTextMeasurer([], BRAND)
    expect(measure({ text: 'Brand', font: fontIn('"Studio Font Brand", -apple-system, sans-serif') })).toEqual({ width: 50, ascent: 15, descent: 5 })
    expect(measured).toEqual(['700 20px "Studio Font Brand", -apple-system, sans-serif'])
    expect(measure({ text: 'Other', font: fontIn('"Avenir Next", -apple-system') })).toBeNull()
    expect(measure({ text: 'Other', font: fontIn('"Studio Font Other", -apple-system') })).toBeNull()
  })

  it('measures in the system stack behind the family as the page resolved it, since a canvas ignores a font naming var(--font-ui)', () => {
    // The stack every project family is drawn with, and the system face the page measured, with Inter for var(--font-ui).
    const stack = `"Studio Font Brand", ${UI_FONT_FAMILY}`
    const system = { family: UI_FONT_FAMILY, resolvedFamily: '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", system-ui, sans-serif', weight: 400, advances: {}, fallback: 0.5, ascent: 0.9, descent: 0.2 }
    const measure = workerTextMeasurer([system], BRAND)
    font = '400 100px Times'
    expect(measure({ text: 'Brand', font: fontIn(stack) })).toEqual({ width: 50, ascent: 15, descent: 5 })
    expect(measured).toEqual(['700 20px "Studio Font Brand", -apple-system, BlinkMacSystemFont, Inter, "Segoe UI", system-ui, sans-serif'])
    // Without the page's system face it leaves the text to the page, rather than measuring in the canvas's last font.
    expect(workerTextMeasurer([], BRAND)({ text: 'Brand', font: fontIn(stack) })).toBeNull()
  })

  it("takes a project family's ascent and descent from its own hhea metrics when the canvas gives no font box", () => {
    // The family's regular face: an ascender of 1900 and a descender of -500 in 2048 units, at 20 pt.
    boxless = true
    const measure = workerTextMeasurer([], [{ ...BOLD, metrics: { unitsPerEm: 1000, ascender: 800, descender: -200, lineGap: 0 } }, ITALIC, REGULAR])
    expect(measure({ text: 'Brand', font: fontIn('"Studio Font Brand", -apple-system') })).toEqual({ width: 50, ascent: 1900 / 2048 * 20, descent: 500 / 2048 * 20 })
  })
})

describe.skipIf(!XCODE)('in Xcode 27', () => {
  it('type-checks every source drawn above', () => {
    typecheckInXcode([...new Set(sources)])
  }, 300_000)
})
