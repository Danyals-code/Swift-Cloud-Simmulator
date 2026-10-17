import { beforeEach, describe, expect, it } from 'vitest'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { DESIGN_NEEDS_SYSTEM, FAMILY_DROPS_DESIGN, type PreviewFontAsset } from '@studio/shared'
import { XCODE, bodyOf, draw, layerOf, planLayer, project, screen, setLayer, typecheckInXcode } from './helpers/layer-project'

/**
 * Wave 6f, the Family in Typography: a font file of the project's own or a family iOS
 * ships, written as `.custom(name, size:relativeTo:)` so it keeps the text style and
 * scales with Dynamic Type, and read back as the same style, size and family.
 */
beforeEach(resetPipelineState)

const MEMBERS = '    var family = "Brand"\n    var computed: CGFloat { 12 }\n    var style = Font.TextStyle.body\n'
const files = (body: string, members = '') => project(screen(`        ${body}`).replace('struct ContentView: View {\n', `struct ContentView: View {\n${members}`))
const font = (body: string, target?: string, members = '') => layerOf(files(body, members), 'Text', 0, target).text!.font
const set = (body: string, change: Record<string, unknown>, target?: string, members = '') =>
  bodyOf(setLayer(files(body, members), 'Text', [{ section: 'text', font: change }], 0, target))

describe('reading a family', () => {
  it.each([
    ['a project face in a text style', 'Text("A").font(.custom("Brand-Bold", size: 28, relativeTo: .title))', { style: 'title', face: 'Brand-Bold' }],
    ['an iOS family in a text style', 'Text("A").font(.custom("Avenir Next", size: 22, relativeTo: .title2))', { style: 'title2', face: 'Avenir Next' }],
    ['a size that follows a style', 'Text("A").font(.custom("Brand", size: 19, relativeTo: .body))', { style: null, size: 19, relativeTo: 'body', face: 'Brand' }],
    ['a size, which follows Body from iOS 14', 'Text("A").font(.custom("Brand", size: 20))', { style: null, size: 20, relativeTo: 'body', face: 'Brand' }],
    ['Body’s own size', 'Text("A").font(Font.custom("Brand", size: 17))', { style: 'body', face: 'Brand' }],
    ['a fixed size', 'Text("A").font(.custom("Menlo", fixedSize: 13))', { style: null, size: 13, relativeTo: null, face: 'Menlo' }],
    ['a weight and italic on it', 'Text("A").font(.custom("Brand", size: 17).bold()).italic()', { style: 'body', face: 'Brand', weight: 'bold', italic: true }],
    ['a weight beside it', 'Text("A").font(.custom("Brand", size: 34, relativeTo: .largeTitle)).fontWeight(.heavy)', { style: 'largeTitle', face: 'Brand', weight: 'heavy' }],
  ])('reads %s', (_, body, value) => {
    expect(font(body)).toMatchObject({ value, state: 'literal' })
  })

  it('reads a size as fixed below iOS 14, where a custom font does not scale, and a style’s own size as the style', () => {
    expect(font('Text("A").font(.custom("Brand", size: 19))', '13.0').value).toMatchObject({ style: null, size: 19, relativeTo: null, face: 'Brand' })
    expect(font('Text("A").font(.custom("Brand", size: 28))', '13.0').value).toMatchObject({ style: 'title', face: 'Brand' })
    expect(font('Text("A").font(.custom("Brand", size: 17))', '13.0').value).toMatchObject({ style: 'body', face: 'Brand' })
  })

  it.each([
    ['a family from a property', 'Text("A").font(.custom(family, size: 17))', 'This text’s font family is worked out in Swift. Change it in Code.'],
    ['a family from a property, made bold', 'Text("A").font(.custom(family, size: 17).bold())', 'This text’s font family is worked out in Swift. Change it in Code.'],
    ['a family put together in a string', 'Text("A").font(.custom("Brand\\(family)", size: 17))', 'This text’s font family is worked out in Swift. Change it in Code.'],
    ['a size worked out in Swift', 'Text("A").font(.custom("Brand", size: computed))', 'This text’s font is worked out in Swift. Change it in Code.'],
    ['a size worked out in Swift, in a family with a quote in its name', 'Text("A").font(.custom("Br\\"and", size: computed))', 'This text’s font is worked out in Swift. Change it in Code.'],
    ['a style from a property', 'Text("A").font(.custom("Brand", size: 17, relativeTo: style))', 'This text’s font is worked out in Swift. Change it in Code.'],
  ])('leaves %s to Code, with the reason', (_, body, reason) => {
    const read = font(body, undefined, MEMBERS)
    expect(read.state).toBe('code')
    expect(read.disabledReason).toBe(reason)
  })

  it.each([
    ['a design on the face', 'Text("A").font(.custom("Brand", size: 20).monospaced())'],
    ['a design beside the face', 'Text("A").font(.custom("Brand", size: 17)).fontDesign(.rounded)'],
    ['the default design beside the face', 'Text("A").font(.custom("Brand", size: 17)).fontDesign(.default)'],
  ])('leaves %s to Code, so no edit can take the design away', (_, body) => {
    const read = font(body)
    expect(read.state).toBe('code')
    expect(read.disabledReason).toBe('This text sets a design beside its font family, which the panel doesn’t show. Change it in Code.')
    expect(planLayer(files(body), 'Text', [{ section: 'text', font: { weight: 'bold' } }])).toMatchObject({ ok: false })
  })

  it('keeps a font token whose value is a family read only, and says why', () => {
    const tokened = project(screen('        Text("A").font(.brand)', 'extension Font {\n    static let brand = Font.custom("Brand", size: 28, relativeTo: .title)\n}\n'))
    const read = layerOf(tokened, 'Text').text!.font
    expect(read).toMatchObject({ state: 'code', value: { face: 'Brand', token: '.brand' } })
    expect(read.disabledReason).toBe('This text’s font, .brand, is in the Brand family, which a text style token doesn’t set. Change it in Code.')
  })
})

describe('writing a family', () => {
  it('writes the face in the text style, so Dynamic Type still scales it', () => {
    expect(set('Text("A")', { face: 'Brand-Bold' })).toBe('        Text("A").font(.custom("Brand-Bold", size: 17, relativeTo: .body))')
    expect(set('Text("A").font(.title).padding()', { face: 'Avenir Next' })).toBe('        Text("A").font(.custom("Avenir Next", size: 28, relativeTo: .title)).padding()')
  })

  it('keeps the weight and italic beside it, and writes a Headline’s face at its own size without its bold', () => {
    expect(set('Text("A").font(.title).fontWeight(.bold).italic()', { face: 'Brand' })).toBe('        Text("A").font(.custom("Brand", size: 28, relativeTo: .title)).fontWeight(.bold).italic()')
    expect(set('Text("A").font(.headline)', { face: 'Brand' })).toBe('        Text("A").font(.custom("Brand", size: 17, relativeTo: .headline))')
  })

  it('writes a size that follows Dynamic Type relative to its style, in place of its @ScaledMetric', () => {
    expect(set('Text("A").font(.system(size: textSize))', { face: 'Brand' }, undefined, '    @ScaledMetric(relativeTo: .title2) private var textSize: CGFloat = 22\n'))
      .toBe('        Text("A").font(.custom("Brand", size: 22, relativeTo: .title2))')
  })

  it('writes a fixed size as a fixed size', () => {
    expect(set('Text("A").font(.system(size: 22))', { face: 'Brand' })).toBe('        Text("A").font(.custom("Brand", fixedSize: 22))')
  })

  it('keeps the face as the style, size and weight change', () => {
    expect(set('Text("A").font(.custom("Brand", size: 28, relativeTo: .title))', { style: 'body' })).toBe('        Text("A").font(.custom("Brand", size: 17, relativeTo: .body))')
    expect(set('Text("A").font(.custom("Brand", size: 19, relativeTo: .body))', { size: 30 })).toBe('        Text("A").font(.custom("Brand", size: 30, relativeTo: .body))')
    expect(set('Text("A").font(.custom("Brand", size: 17))', { weight: 'semibold' })).toBe('        Text("A").font(.custom("Brand", size: 17, relativeTo: .body)).fontWeight(.semibold)')
  })

  it('takes the face away for System, back to the style or size it had', () => {
    expect(set('Text("A").font(.custom("Brand", size: 28, relativeTo: .title))', { face: null })).toBe('        Text("A").font(.title)')
    expect(set('Text("A").font(.custom("Brand", size: 17, relativeTo: .body)).bold()', { face: null })).toBe('        Text("A").fontWeight(.bold)')
    expect(set('Text("A").font(.custom("Brand", fixedSize: 22))', { face: null })).toBe('        Text("A").font(.system(size: 22))')
  })

  it('drops a design for a face, which has its own, and refuses one beside a face', () => {
    expect(set('Text("A").font(.title).fontDesign(.serif)', { face: 'Brand' })).toBe('        Text("A").font(.custom("Brand", size: 28, relativeTo: .title))')
    expect(() => set('Text("A").font(.custom("Brand", size: 17))', { design: 'rounded' })).toThrow('Design applies to the system font. Choose System in Family to use it.')
  })

  it('gives back the style or size and weight on System, but not the design a family dropped, as the Family note says', () => {
    const branded = set('Text("A").font(.title2).fontDesign(.serif)', { face: 'Brand' })
    expect(branded).toBe('        Text("A").font(.custom("Brand", size: 22, relativeTo: .title2))')
    expect(bodyOf(setLayer(files(branded.trim()), 'Text', [{ section: 'text', font: { face: null } }]))).toBe('        Text("A").font(.title2)')
    const sized = set('Text("A").font(.system(size: 28, weight: .bold, design: .rounded))', { face: 'Brand' })
    expect(sized).toBe('        Text("A").font(.custom("Brand", fixedSize: 28)).fontWeight(.bold)')
    expect(bodyOf(setLayer(files(sized.trim()), 'Text', [{ section: 'text', font: { face: null } }]))).toBe('        Text("A").font(.system(size: 28, weight: .bold))')
    expect(FAMILY_DROPS_DESIGN).toBe('A family has its own design, so choosing one drops this text’s design, and System doesn’t bring it back.')
    expect(DESIGN_NEEDS_SYSTEM).toBe('Design applies to the system font. Choose System in Family to use it.')
  })

  it('writes a family’s name as Swift spells it, quotes, backslashes and control characters escaped, and reads it back', () => {
    const written = set('Text("A")', { face: 'Br"and\\\u0001' })
    expect(written).toBe('        Text("A").font(.custom("Br\\"and\\\\\\u{1}", size: 17, relativeTo: .body))')
    expect(font(written.trim()).value).toMatchObject({ style: 'body', face: 'Br"and\\\u0001' })
  })

  it('refuses a style to follow that is not a text style, with a family or without', () => {
    expect(() => set('Text("A").font(.custom("Brand", size: 19, relativeTo: .body))', { relativeTo: 'huge' })).toThrow('Choose the text style the size follows.')
    expect(() => set('Text("A")', { face: 'Brand', style: null, size: 20, relativeTo: 'huge' })).toThrow('Choose the text style the size follows.')
    expect(() => set('Text("A").font(.system(size: 20))', { relativeTo: 'huge' })).toThrow('Choose the text style the size follows.')
  })

  it('writes nothing for the face it already has, and refuses an empty name', () => {
    const same = planLayer(files('Text("A").font(.custom("Brand", size: 28, relativeTo: .title))'), 'Text', [{ section: 'text', font: { face: 'Brand' } }])
    expect(same.ok && same.changes).toEqual([])
    expect(() => set('Text("A")', { face: ' ' })).toThrow(/Choose a font family/)
  })

  it('writes the older spelling below iOS 14 and folds the weight into the font below iOS 16', () => {
    expect(set('Text("A").font(.title)', { face: 'Brand' }, '13.0')).toBe('        Text("A").font(.custom("Brand", size: 28))')
    expect(set('Text("A").font(.system(size: 22))', { face: 'Brand' }, '13.0')).toBe('        Text("A").font(.custom("Brand", size: 22))')
    expect(set('Text("A").font(.title.bold())', { face: 'Brand', italic: true }, '15.0')).toBe('        Text("A").font(.custom("Brand", size: 28, relativeTo: .title).weight(.bold).italic())')
    expect(set('Text("A").font(.system(size: 22))', { face: 'Brand' }, '14.0')).toBe('        Text("A").font(.custom("Brand", fixedSize: 22))')
  })
})

describe('the checker and the project’s fonts', () => {
  const BRAND: PreviewFontAsset = { postScriptName: 'Brand-Bold', family: 'Brand', weight: 700, italic: false, metrics: { unitsPerEm: 1000, ascender: 800, descender: -200, lineGap: 0 } }
  const said = (body: string, fonts?: readonly PreviewFontAsset[]) => draw(files(body), fonts ? { fonts } : {}).diagnostics
    .filter(d => d.code !== 'runtime_trap').map(d => d.message)

  it('says nothing of a project font, by its PostScript name or its family', () => {
    expect(said('VStack { Text("A").font(.custom("Brand-Bold", size: 17)); Text("B").font(.custom("Brand", size: 17)) }', [BRAND])).toEqual([])
  })

  it('still says a name that matches nothing is not in this project', () => {
    expect(said('Text("A").font(.custom("Brand-Light", size: 17))', [BRAND])).toEqual(["Custom font 'Brand-Light' is not in this project; the preview draws the system font at the same size."])
    expect(said('Text("A").font(.custom("Brand", size: 17))')).toEqual(["Custom font 'Brand' is not in this project; the preview draws the system font at the same size."])
  })
})

describe.skipIf(!XCODE)('what the Family writes builds in Xcode 27', () => {
  it('for every form, at the targets that write it differently', () => {
    const sources: string[] = []
    const write = (body: string, change: Record<string, unknown>, target = '27.0', members = '') => {
      const after = setLayer(files(body, members), 'Text', [{ section: 'text', font: change }], 0, target)[0]!.text
      sources.push(`// target: iOS ${target}\n${after}`)
    }
    write('Text("A").font(.title).fontWeight(.bold).italic()', { face: 'Brand-Bold' })
    write('Text("A").font(.system(size: textSize))', { face: 'Avenir Next' }, '27.0', '    @ScaledMetric(relativeTo: .title2) private var textSize: CGFloat = 22\n')
    write('Text("A").font(.system(size: 22))', { face: 'Menlo' })
    write('Text("A").font(.custom("Brand", fixedSize: 22))', { face: null })
    write('Text("A").font(.title.bold())', { face: 'Brand', italic: true }, '15.0')
    write('Text("A").font(.system(size: 22))', { face: 'Brand' }, '14.0')
    write('Text("A").font(.title)', { face: 'Brand' }, '14.0')
    write('Text("A").font(.title)', { face: 'Brand', weight: 'bold', italic: true }, '13.0')
    write('Text("A").font(.system(size: 22))', { face: 'Brand' }, '13.0')
    write('Text("A")', { face: 'Br"and\\\u0001' })
    write('Text("A").font(.custom("Brand", fixedSize: 28)).fontWeight(.bold)', { face: null })
    expect(sources[0]).toContain('.font(.custom("Brand-Bold", size: 28, relativeTo: .title)).fontWeight(.bold).italic()')
    expect(sources[7]).toContain('.font(.custom("Brand", size: 28).weight(.bold).italic())')
    expect(sources[9]).toContain('.font(.custom("Br\\"and\\\\\\u{1}", size: 17, relativeTo: .body))')
    expect(sources[10]).toContain('.font(.system(size: 28, weight: .bold))')
    typecheckInXcode(sources)
    expect(sources).toHaveLength(11)
  }, 300_000)
})
