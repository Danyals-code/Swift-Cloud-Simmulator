import { beforeEach, describe, expect, it } from 'vitest'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { iosFont } from '@studio/shared'
import { buildAuthoringModel } from '@studio/swift-sema'
import { TEMPLATES } from '@studio/project-model/templates'
import { XCODE, bodyOf, draw, project, screen, setLayer, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 6a, text and trust: real Swift the checker used to block or call a typo now reads
 * as what it is. `AttributedString` no longer blanks the screen, Apple's own names are
 * never said to stop Xcode building, and only a font iOS doesn't ship says it isn't there.
 */
beforeEach(resetPipelineState)

/** The checker's word on a one-screen project, as the Problems pane lists it. */
const said = (body: string, declarations = '') => draw(project(screen(body, declarations))).diagnostics
  .filter(d => d.code !== 'runtime_trap')
  .map(d => `${d.severity}: ${d.message}`)

/** Real Swift the preview used to refuse, each type-checked in Xcode 27 below. */
const WORDS = [`        VStack {
            Text(greeting)
            Text(try! AttributedString(markdown: "**Hi**"))
        }`, `
var greeting: AttributedString {
    var words = AttributedString("Hello")
    words.font = .title
    words.foregroundColor = .red
    words.backgroundColor = .yellow
    words.underlineStyle = .single
    words.strikethroughStyle = .single
    words.kern = 2
    words.link = URL(string: "https://example.com")
    var rest = AttributedString(" world")
    rest += AttributedString("!")
    if let range = words.range(of: "Hell") { words[range].font = .body.bold() }
    _ = words.characters.count
    return words + rest
}
`] as const
const ITEMS = '\nlet items: [Item] = []\nstruct Item: Identifiable { let id = 1; let day = "Mon"; let steps = 3.0 }\n'
const APPLE_NAMES = [
  ['GlassEffectContainer', `        GlassEffectContainer(spacing: 20) {
            Text("A").glassEffect()
        }`],
  ['ToolbarSpacer and DefaultToolbarItem', `        NavigationStack {
            Text("A")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { Button("A") {} }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    ToolbarSpacer(.flexible)
                    DefaultToolbarItem(kind: .search, placement: .bottomBar)
                }
        }`],
  ['the Charts marks, plots and axes', `        Chart {
            SectorMark(angle: .value("A", 3), innerRadius: .ratio(0.6), angularInset: 1)
            RectangleMark(x: .value("Day", "Mon"), y: .value("Steps", 3))
            BarPlot(items, x: .value("Day", \\.day), y: .value("Steps", \\.steps))
            LinePlot(x: "x", y: "y") { x in x * x }
            Plot {
                PointMark(x: .value("Day", "Mon"), y: .value("Steps", 3))
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { _ in
                AxisGridLine()
                AxisTick()
                AxisValueLabel()
            }
        }`],
] as const
const CHART_MODIFIERS = `        Chart {
            BarMark(x: .value("Day", "Mon"), y: .value("Steps", 3))
                .annotation(position: .top) { Text("3") }
            LineMark(x: .value("Day", "Mon"), y: .value("Steps", 3))
                .interpolationMethod(.catmullRom)
                .symbol(.circle)
                .symbolSize(30)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .symbol(by: .value("Kind", "a"))
                .alignsMarkStylesWithPlotArea()
        }
        .chartXAxis(.hidden)
        .chartYScale(domain: 0...10)
        .chartXScale(domain: 0...10)
        .chartLegend(.hidden)
        .chartLegend(position: .bottom)
        .chartForegroundStyleScale(["a": Color.red])
        .chartSymbolScale(["a": Circle()])
        .chartLineStyleScale(["a": StrokeStyle(lineWidth: 1)])
        .chartPlotStyle { plot in plot.background(.gray) }
        .chartBackground { _ in Color.clear }
        .chartOverlay { _ in Color.clear }
        .chartXAxisLabel("Day")
        .chartYAxisLabel("Steps")
        .chartScrollableAxes(.horizontal)
        .chartXVisibleDomain(length: 5)
        .chartXSelection(value: .constant(Optional<String>.none))
        .chartAngleSelection(value: .constant(Optional<Int>.none))`
const POSITIONED = `        Chart(items) { item in
            BarMark(x: .value("Day", item.day), y: .value("Steps", item.steps))
                .position(by: .value("Kind", item.day))
        }`
const SEARCH_BEHAVIOR = `        NavigationStack {
            Text("A")
                .searchable(text: .constant(""))
                .searchToolbarBehavior(.minimize)
        }`
const BUILT_IN_FONTS = `        VStack {
            Text("A").font(.custom("Avenir Next", size: 22))
            Text("B").font(.custom("Georgia", size: 17, relativeTo: .body))
            Text("C").font(.custom("Menlo", fixedSize: 13))
            Text("D").font(Font.custom("AvenirNext-DemiBold", size: 13))
        }`

/** Masks the preview draws as iOS 27 does (Wave 6a). */
const MASKS_DRAWN = [
  'Color.blue.frame(width: 100, height: 100).mask(Circle())',
  'Color.green.frame(width: 100, height: 100).mask(alignment: .topLeading) { Circle().frame(width: 50, height: 50) }',
  'Color.orange.frame(width: 100, height: 60).mask(RoundedRectangle(cornerRadius: 12))',
  'LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing).frame(width: 240, height: 60).mask(Text("Gradient").font(.largeTitle.bold()))',
  'Text("Overlay").font(.largeTitle).overlay(LinearGradient(colors: [.pink, .purple], startPoint: .leading, endPoint: .trailing)).mask(Text("Overlay").font(.largeTitle))',
  'Color.orange.frame(width: 100, height: 100).mask { Image(systemName: "star.fill").font(.system(size: 80)) }',
  'Image("photo").mask(LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom))',
  'Image("photo").mask { Capsule().fill(.black) }',
  'Text("Hi").mask(UnevenRoundedRectangle(topLeadingRadius: 8).frame(width: 40, height: 20))',
  'RadialGradient(colors: [.red, .blue], center: .center, startRadius: 0, endRadius: 80).padding(4).mask(Text("Hot").bold())',
  'Text("Sale").font(.title).overlay(Color.red).mask(Text("Sale").font(.title))',
  'Text("Sale").font(.title).overlay { AngularGradient(colors: [.red, .blue], center: .center) }.mask { Text("Sale").font(.title) }',
  'Color.red.opacity(0.5).mask { Image(systemName: "star.fill") }',
  'Color.red.opacity(0.5).mask(Text("Hi"))',
  'Color.blue.frame(width: 100, height: 100).mask(Circle().fill(.black.opacity(0.3)))',
  'Color.blue.frame(width: 100, height: 100).mask { Circle().foregroundStyle(Color.clear) }',
] as const
/** Shape masks painted with a gradient, which build and which the preview leaves unmasked (Wave 6a). */
const GRADIENT_SHAPES = [
  'Color.blue.mask(Circle().fill(LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)))',
  'Color.blue.mask { Circle().fill(.linearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)) }',
  'Color.blue.mask(Capsule().foregroundStyle(Gradient(colors: [.black, .clear])))',
] as const
const BACKGROUND_NOT_DRAWN = "warning: An AttributedString's backgroundColor is not drawn in the preview. The app draws it as written."

/** More of AttributedString, each a form Xcode 27 builds (below), and each but `backgroundColor` drawn. */
const MORE_WORDS = [`        VStack {
            Text(styled)
            Image(systemName: "star").environment(\\.symbolVariants, variant)
            Label("Inbox", systemImage: "tray").environment(\\.symbolVariants, .fill.circle)
        }`, `
var styled: AttributedString {
    var words = AttributedString(localized: "Hello")
    words.swiftUI.foregroundColor = .red
    words.inlinePresentationIntent = .stronglyEmphasized
    var container = AttributeContainer()
    container.foregroundColor = .blue
    container.font = .title
    var rest = AttributedString(" world", attributes: container)
    rest.mergeAttributes(container)
    rest.setAttributes(container)
    return words + rest
}
let variant: SymbolVariants = .fill
`] as const

describe('AttributedString', () => {
  it('is a type the preview knows, with its everyday members', () => {
    expect(said(...WORDS)).toEqual([BACKGROUND_NOT_DRAWN])
  })

  it('knows AttributeContainer, localized words, the SwiftUI scope, presentation intents, SymbolVariants and the symbolVariants environment value', () => {
    expect(said(...MORE_WORDS)).toEqual([])
  })

  it('says a background colour set on a container is not drawn either', () => {
    expect(said('        Text(words)', `
var words: AttributedString {
    var container = AttributeContainer()
    container.backgroundColor = .yellow
    return AttributedString("Hi", attributes: container)
}
`)).toEqual([BACKGROUND_NOT_DRAWN])
  })

  /** Two screens that set a `backgroundColor` of their own, each type-checked in Xcode 27 below. */
  const OWN_BACKGROUNDS = [
    ['a Color held in state', screen('        Button("Blue") { self.backgroundColor = .blue }').replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var backgroundColor = Color.red\n')],
    ['a property of a struct of the project', screen('        Button("Blue") { var theme = Theme(); theme.backgroundColor = .blue; _ = theme }', '\nstruct Theme { var backgroundColor = Color.red }\n')],
  ] as const

  it.each(OWN_BACKGROUNDS)('says nothing of backgroundColor on %s, which is no AttributedString', (_, source) => {
    expect(draw(project(source)).diagnostics.map(d => d.message)).toEqual([])
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds the further forms and the screens with their own backgroundColor', () => {
      typecheckInXcode([screen(...MORE_WORDS), ...OWN_BACKGROUNDS.map(([, source]) => source)])
    }, 300_000)
  })

  it('says a background colour on its words is not drawn, on the whole string or a range of it', () => {
    expect(said('        Text(greeting)', `
var greeting: AttributedString {
    var words = AttributedString("Hello")
    if let range = words.range(of: "Hell") { words[range].backgroundColor = .yellow }
    return words
}
`)).toEqual([BACKGROUND_NOT_DRAWN])
  })
})

/** What the checker says of Apple's names: never that Xcode won't build them, never that it can't find them. */
const falseAlarms = (lines: readonly string[]) => lines.filter(line => /Xcode won't build|Cannot find|does not recognise/.test(line))

describe("Apple's own names", () => {
  it.each(APPLE_NAMES)('knows %s, and says whether the preview draws it', (name, body) => {
    const lines = said(body, ITEMS)
    expect(falseAlarms(lines)).toEqual([])
    // A chart's plots, RectangleMark and axis marks aren't drawn: the chart leaves them out or keeps its
    // default axis (Wave 6e). The glass container and the toolbar's own items are drawn since Wave 6c.
    if (name.startsWith('the Charts')) expect(lines.join('\n')).toMatch(/: the preview leaves it out of the chart\.[^]*: the preview keeps the chart’s default axis\./)
    else expect(lines.join('\n')).not.toMatch(/isn't drawn in the preview yet|: the preview (?:leaves|keeps)/)
  })
})

describe('searchToolbarBehavior', () => {
  it("is Apple's, recognized and not drawn, never a modifier Xcode won't build", () => {
    expect(said(SEARCH_BEHAVIOR)).toEqual(["warning: '.searchToolbarBehavior' is recognized but not applied by the preview. It is exported to Xcode unchanged."])
  })
})

describe("Charts' modifiers", () => {
  it('names each it does not draw as recognized but not applied, on the chart and on its marks', () => {
    const lines = said(CHART_MODIFIERS)
    expect(falseAlarms(lines)).toEqual([])
    for (const name of ['interpolationMethod', 'symbol', 'symbolSize', 'lineStyle', 'alignsMarkStylesWithPlotArea', 'chartLegend', 'chartForegroundStyleScale', 'chartPlotStyle', 'chartXSelection', 'chartAngleSelection']) {
      expect(lines.join('\n')).toContain(`'.${name}' is recognized but not applied by the preview`)
    }
    // Drawn since Wave 6e: a top annotation, a hidden axis and a y domain.
    for (const name of ['annotation', 'chartXAxis', 'chartYScale']) expect(lines.join('\n')).not.toContain(`'.${name}'`)
  })

  it.each([
    ['.chartLegend(position: .bottom)', 'appearance'],
    ['.chartXSelection(value: .constant(Optional<String>.none))', 'behavior'],
  ])('lists %s in Design as not drawn, in its own category', (modifier, category) => {
    const chart = viewWritten(screen(`        Chart {\n            BarMark(x: .value("Day", "Mon"), y: .value("Steps", 3))\n        }\n        ${modifier}`), `Chart {\n            BarMark(x: .value("Day", "Mon"), y: .value("Steps", 3))\n        }\n        ${modifier}`)
    expect(chart.modifiers?.[0]).toMatchObject({ category, summary: 'Not drawn in the preview' })
  })

  it("takes a mark's position(by:) as the mark's, never as a view's position Xcode won't build", () => {
    const lines = said(POSITIONED, ITEMS)
    expect(lines.filter(line => /will not compile|Xcode won't build|does not recognise/.test(line))).toEqual([])
  })

  it("still says a mark's modifier on a view is unknown, as Xcode refuses it there", () => {
    expect(said('        Text("A").annotation(position: .top) { Text("B") }').join('\n')).toContain("does not recognise the modifier '.annotation'")
  })
})

/**
 * What `UIFont.familyNames` and `UIFont.fontNames(forFamilyName:)` return in the iOS 27.0
 * simulator on iPhone 18 Pro: each family iOS ships, then the PostScript name of each face.
 */
const IOS_27_FONTS = `
Academy Engraved LET: AcademyEngravedLetPlain
Al Nile: AlNile, AlNile-Bold
American Typewriter: AmericanTypewriter, AmericanTypewriter-Light, AmericanTypewriter-Semibold, AmericanTypewriter-Bold, AmericanTypewriter-Condensed, AmericanTypewriter-CondensedLight, AmericanTypewriter-CondensedBold
Apple Color Emoji: AppleColorEmoji
Apple SD Gothic Neo: AppleSDGothicNeo-Regular, AppleSDGothicNeo-Thin, AppleSDGothicNeo-UltraLight, AppleSDGothicNeo-Light, AppleSDGothicNeo-Medium, AppleSDGothicNeo-SemiBold, AppleSDGothicNeo-Bold
Apple Symbols: AppleSymbols
Arial: ArialMT, Arial-ItalicMT, Arial-BoldMT, Arial-BoldItalicMT
Arial Hebrew: ArialHebrew, ArialHebrew-Light, ArialHebrew-Bold
Arial Rounded MT Bold: ArialRoundedMTBold
Avenir: Avenir-Book, Avenir-Roman, Avenir-BookOblique, Avenir-Oblique, Avenir-Light, Avenir-LightOblique, Avenir-Medium, Avenir-MediumOblique, Avenir-Heavy, Avenir-HeavyOblique, Avenir-Black, Avenir-BlackOblique
Avenir Next: AvenirNext-Regular, AvenirNext-Italic, AvenirNext-UltraLight, AvenirNext-UltraLightItalic, AvenirNext-Medium, AvenirNext-MediumItalic, AvenirNext-DemiBold, AvenirNext-DemiBoldItalic, AvenirNext-Bold, AvenirNext-BoldItalic, AvenirNext-Heavy, AvenirNext-HeavyItalic
Avenir Next Condensed: AvenirNextCondensed-Regular, AvenirNextCondensed-Italic, AvenirNextCondensed-UltraLight, AvenirNextCondensed-UltraLightItalic, AvenirNextCondensed-Medium, AvenirNextCondensed-MediumItalic, AvenirNextCondensed-DemiBold, AvenirNextCondensed-DemiBoldItalic, AvenirNextCondensed-Bold, AvenirNextCondensed-BoldItalic, AvenirNextCondensed-Heavy, AvenirNextCondensed-HeavyItalic
Baskerville: Baskerville, Baskerville-Italic, Baskerville-SemiBold, Baskerville-SemiBoldItalic, Baskerville-Bold, Baskerville-BoldItalic
Bodoni 72: BodoniSvtyTwoITCTT-Book, BodoniSvtyTwoITCTT-BookIta, BodoniSvtyTwoITCTT-Bold
Bodoni 72 Oldstyle: BodoniSvtyTwoOSITCTT-Bold, BodoniSvtyTwoOSITCTT-Book, BodoniSvtyTwoOSITCTT-BookIt
Bodoni 72 Smallcaps: BodoniSvtyTwoSCITCTT-Book
Bodoni Ornaments: BodoniOrnamentsITCTT
Bradley Hand: BradleyHandITCTT-Bold
Chalkboard SE: ChalkboardSE-Regular, ChalkboardSE-Light, ChalkboardSE-Bold
Chalkduster: Chalkduster
Charter: Charter-Roman, Charter-Italic, Charter-Bold, Charter-BoldItalic, Charter-Black, Charter-BlackItalic
Cochin: Cochin, Cochin-Italic, Cochin-Bold, Cochin-BoldItalic
Copperplate: Copperplate, Copperplate-Light, Copperplate-Bold
Courier New: CourierNewPSMT, CourierNewPS-ItalicMT, CourierNewPS-BoldMT, CourierNewPS-BoldItalicMT
DIN Alternate: DINAlternate-Bold
DIN Condensed: DINCondensed-Bold
Damascus: Damascus, DamascusLight, DamascusMedium, DamascusSemiBold, DamascusBold
Devanagari Sangam MN: DevanagariSangamMN, DevanagariSangamMN-Bold
Didot: Didot, Didot-Italic, Didot-Bold
Euphemia UCAS: EuphemiaUCAS, EuphemiaUCAS-Italic, EuphemiaUCAS-Bold
Farah: Farah
Futura: Futura-Medium, Futura-MediumItalic, Futura-Bold, Futura-CondensedMedium, Futura-CondensedExtraBold
Galvji: Galvji, Galvji-Bold
Geeza Pro: GeezaPro, GeezaPro-Bold
Georgia: Georgia, Georgia-Italic, Georgia-Bold, Georgia-BoldItalic
Gill Sans: GillSans, GillSans-Italic, GillSans-Light, GillSans-LightItalic, GillSans-SemiBold, GillSans-SemiBoldItalic, GillSans-Bold, GillSans-BoldItalic, GillSans-UltraBold
Grantha Sangam MN: GranthaSangamMN-Regular, GranthaSangamMN-Bold
Helvetica: Helvetica, Helvetica-Oblique, Helvetica-Light, Helvetica-LightOblique, Helvetica-Bold, Helvetica-BoldOblique
Helvetica Neue: HelveticaNeue, HelveticaNeue-Italic, HelveticaNeue-UltraLight, HelveticaNeue-UltraLightItalic, HelveticaNeue-Thin, HelveticaNeue-ThinItalic, HelveticaNeue-Light, HelveticaNeue-LightItalic, HelveticaNeue-Medium, HelveticaNeue-MediumItalic, HelveticaNeue-Bold, HelveticaNeue-BoldItalic, HelveticaNeue-CondensedBold, HelveticaNeue-CondensedBlack
Hiragino Maru Gothic ProN: HiraMaruProN-W4
Hiragino Mincho ProN: HiraMinProN-W3, HiraMinProN-W6
Hiragino Sans: HiraginoSans-W3, HiraginoSans-W4, HiraginoSans-W5, HiraginoSans-W6, HiraginoSans-W7, HiraginoSans-W8
Hoefler Text: HoeflerText-Regular, HoeflerText-Italic, HoeflerText-Black, HoeflerText-BlackItalic
Impact: Impact
Kailasa: Kailasa, Kailasa-Bold
Kefa III: KefaIII-Regular, KefaIII-Light, KefaIII-Bold, KefaIII-ExtraBold
Khmer Sangam MN: KhmerSangamMN
Kohinoor Bangla: KohinoorBangla-Regular, KohinoorBangla-Light, KohinoorBangla-Semibold
Kohinoor Devanagari: KohinoorDevanagari-Regular, KohinoorDevanagari-Light, KohinoorDevanagari-Semibold
Kohinoor Gujarati: KohinoorGujarati-Regular, KohinoorGujarati-Light, KohinoorGujarati-Bold
Kohinoor Telugu: KohinoorTelugu-Regular, KohinoorTelugu-Light, KohinoorTelugu-Medium
Lao Sangam MN: LaoSangamMN
Malayalam Sangam MN: MalayalamSangamMN, MalayalamSangamMN-Bold
Marker Felt: MarkerFelt-Thin, MarkerFelt-Wide
Menlo: Menlo-Regular, Menlo-Italic, Menlo-Bold, Menlo-BoldItalic
Mishafi: DiwanMishafi
Mukta Mahee: MuktaMahee-Regular, MuktaMahee-Light, MuktaMahee-Bold
Myanmar Sangam MN: MyanmarSangamMN, MyanmarSangamMN-Bold
Noteworthy: Noteworthy-Light, Noteworthy-Bold
Noto Nastaliq Urdu: NotoNastaliqUrdu, NotoNastaliqUrdu-Bold
Noto Sans Kannada: NotoSansKannada-Regular, NotoSansKannada-Light, NotoSansKannada-Bold
Noto Sans Oriya: NotoSansOriya, NotoSansOriya-Bold
Noto Sans Sunuwar: NotoSansSunuwar-Regular
Noto Sans Syriac: NotoSansSyriac-Regular, NotoSansSyriac-Regular_Thin, NotoSansSyriac-Regular_ExtraLight, NotoSansSyriac-Regular_Light, NotoSansSyriac-Regular_Medium, NotoSansSyriac-Regular_SemiBold, NotoSansSyriac-Regular_Bold, NotoSansSyriac-Regular_ExtraBold, NotoSansSyriac-Regular_Black
Noto Serif Myanmar: NotoSerifMyanmar-Regular, NotoSerifMyanmar-Light, NotoSerifMyanmar-Bold
Optima: Optima-Regular, Optima-Italic, Optima-Bold, Optima-BoldItalic, Optima-ExtraBlack
Palatino: Palatino-Roman, Palatino-Italic, Palatino-Bold, Palatino-BoldItalic
Papyrus: Papyrus, Papyrus-Condensed
Party LET: PartyLetPlain
PingFang HK: PingFangHK-Regular, PingFangHK-Ultralight, PingFangHK-Thin, PingFangHK-Light, PingFangHK-Medium, PingFangHK-Semibold
PingFang MO: PingFangMO-Regular, PingFangMO-Ultralight, PingFangMO-Thin, PingFangMO-Light, PingFangMO-Medium, PingFangMO-Semibold
PingFang SC: PingFangSC-Regular, PingFangSC-Ultralight, PingFangSC-Thin, PingFangSC-Light, PingFangSC-Medium, PingFangSC-Semibold
PingFang TC: PingFangTC-Regular, PingFangTC-Ultralight, PingFangTC-Thin, PingFangTC-Light, PingFangTC-Medium, PingFangTC-Semibold
Rockwell: Rockwell-Regular, Rockwell-Italic, Rockwell-Bold, Rockwell-BoldItalic
STIX Two Math: STIXTwoMath-Regular
STIX Two Text: STIXTwoText, STIXTwoText-Italic, STIXTwoText_Medium, STIXTwoText-Italic_Medium-Italic, STIXTwoText_SemiBold, STIXTwoText-Italic_SemiBold-Italic, STIXTwoText_Bold, STIXTwoText-Italic_Bold-Italic
Savoye LET: SavoyeLetPlain
Sinhala Sangam MN: SinhalaSangamMN, SinhalaSangamMN-Bold
Snell Roundhand: SnellRoundhand, SnellRoundhand-Bold, SnellRoundhand-Black
Symbol: Symbol
Tamil Sangam MN: TamilSangamMN, TamilSangamMN-Bold
Thonburi: Thonburi, Thonburi-Light, Thonburi-Bold
Times New Roman: TimesNewRomanPSMT, TimesNewRomanPS-ItalicMT, TimesNewRomanPS-BoldMT, TimesNewRomanPS-BoldItalicMT
Trebuchet MS: TrebuchetMS, TrebuchetMS-Italic, TrebuchetMS-Bold, Trebuchet-BoldItalic
Verdana: Verdana, Verdana-Italic, Verdana-Bold, Verdana-BoldItalic
Zapf Dingbats: ZapfDingbatsITC
Zapfino: Zapfino
`.trim().split('\n').map(line => line.split(': ') as [string, string]).map(([family, faces]) => [family, faces ? faces.split(', ') : []] as const)

describe("iOS's own fonts", () => {
  it('resolves every family iOS 27 ships, and every face by its PostScript name', () => {
    expect(IOS_27_FONTS).toHaveLength(87)
    const wrong = IOS_27_FONTS.flatMap(([family, faces]) => [family, ...faces].filter(name => iosFont(name)?.family !== family).map(name => `${name} (${family})`))
    expect(wrong).toEqual([])
  })

  it.each([
    ['Avenir Next', { family: 'Avenir Next', italic: false }],
    ['AvenirNext-DemiBold', { family: 'Avenir Next', weight: 600, italic: false }],
    ['AvenirNext-UltraLightItalic', { family: 'Avenir Next', weight: 200, italic: true }],
    ['HelveticaNeue-Thin', { family: 'Helvetica Neue', weight: 100, italic: false }],
    ['CourierNewPS-BoldItalicMT', { family: 'Courier New', weight: 700, italic: true }],
    ['Palatino-Roman', { family: 'Palatino', weight: 400, italic: false }],
    ['Futura-CondensedExtraBold', { family: 'Futura', weight: 800, italic: false }],
    ['Avenir-BlackOblique', { family: 'Avenir', weight: 900, italic: true }],
    ['HiraMinProN-W6', { family: 'Hiragino Mincho ProN', weight: 600, italic: false }],
    ['Menlo-Regular', { family: 'Menlo', weight: 400, italic: false }],
  ])('reads %s as its family, weight and slant', (name, face) => {
    expect(iosFont(name)).toEqual(face)
  })

  it.each(['BrandSans', 'Brand-Bold', 'Georgia Bold', 'Avenir Nextt', 'Inter', 'SF Pro', 'GeorgiaX', 'Georgia-Light', 'Menlo-Light', 'AvenirNext-Black', 'Palatino-Regular', 'georgia', 'HelveticaNeue-Heavy'])('knows %s is not one of them', name => {
    expect(iosFont(name)).toBeUndefined()
  })
})

describe('a custom font', () => {
  it("says nothing of a family iOS ships, which needs no file", () => {
    expect(said(BUILT_IN_FONTS)).toEqual([])
  })

  it("says a face iOS lacks is not in this project, though its family's name starts it", () => {
    expect(said('        Text("A").font(.custom("Georgia-Light", size: 17))')).toEqual([
      "warning: Custom font 'Georgia-Light' is not in this project; the preview draws the system font at the same size.",
    ])
  })

  it('still says a font iOS lacks is not in this project', () => {
    expect(said('        Text("A").font(.custom("BrandSans-Bold", size: 17))')).toEqual([
      "warning: Custom font 'BrandSans-Bold' is not in this project; the preview draws the system font at the same size.",
    ])
  })
})

describe('Design reading formatted words', () => {
  const source = screen(`        VStack {
            Text("**Bold** and *italic*")
            Text(verbatim: "**raw**")
            Text("Plain words")
            Text("Hi **\\(name)**")
            Text(name)
            Button("**Save** now") {}
            Label("*Hi*", systemImage: "star")
            Label("Plain", systemImage: "star")
            Text(greeting)
            Text(Image(systemName: "heart.fill")) + Text(" Favourites")
            Text("snake_case_name")
            Text("5 * 3 * 2")
            Text("Price [approx]")
            Text("Hi \\(name) snake_case")
            Toggle("**On**", isOn: .constant(true))
            Link("*Docs*", destination: URL(string: "https://apple.com")!)
            NavigationLink("**Next**") { Text("B") }
            Toggle("Plain_name", isOn: .constant(true))
            Text("x**\\(name)**y")
            Text("Mail support@apple.com")
        }`, '\nlet name = "**x**"\nvar greeting: AttributedString { AttributedString("Hello") }\n')
  const control = (view: string, id: string) => viewWritten(source, view).controls?.find(c => c.id === id)

  it.each([
    ['Text("**Bold** and *italic*")', 'content', '**Bold** and *italic*'],
    ['Text("Hi **\\(name)**")', 'content:parts', '["Hi **","name","**"]'],
    ['Button("**Save** now") {}', 'title', '**Save** now'],
    ['Label("*Hi*", systemImage: "star")', 'title', '*Hi*'],
    ['Toggle("**On**", isOn: .constant(true))', 'title', '**On**'],
    ['Link("*Docs*", destination: URL(string: "https://apple.com")!)', 'title', '*Docs*'],
    ['NavigationLink("**Next**") { Text("B") }', 'title', '**Next**'],
    ['Text("Mail support@apple.com")', 'content', 'Mail support@apple.com'],
  ])('marks %s as words iOS draws as Markdown, still editable as written', (view, id, value) => {
    expect(control(view, id)).toMatchObject({ value, markdown: true })
    expect(control(view, id)?.disabledReason).toBeUndefined()
  })

  it.each([
    ['Text(verbatim: "**raw**")', 'content'],
    ['Text("Plain words")', 'content'],
    ['Label("Plain", systemImage: "star")', 'title'],
    ['Text("snake_case_name")', 'content'],
    ['Text("5 * 3 * 2")', 'content'],
    ['Text("Price [approx]")', 'content'],
    ['Text("Hi \\(name) snake_case")', 'content:parts'],
    ['Toggle("Plain_name", isOn: .constant(true))', 'title'],
    ['Text("x**\\(name)**y")', 'content:parts'],
  ])('leaves %s plain: verbatim, or no marks iOS draws', (view, id) => {
    expect(control(view, id)).toBeDefined()
    expect(control(view, id)?.markdown).toBeUndefined()
  })

  it.each([
    ['Text(name)', 'name', 'These words are worked out in Swift. Change them in Code.'],
    ['Text(greeting)', 'greeting', 'These words are worked out in Swift. Change them in Code.'],
    ['Text(Image(systemName: "heart.fill"))', 'Image(systemName: "heart.fill")', 'This text is an image. Change it in Code.'],
  ])('shows %s as the code writes it, read only, and says why', (view, value, reason) => {
    expect(viewWritten(source, view).controls?.filter(c => c.id.startsWith('content'))).toEqual([expect.objectContaining({ id: 'content:data', value, disabledReason: reason })])
  })
})

describe("Design reading a Text's words", () => {
  /** Every Text of every template, by the template and how it is written, with its words' controls. */
  const texts = TEMPLATES.flatMap(template => {
    const files = template.files.map(file => ({ id: file.id, text: file.text }))
    return buildAuthoringModel({ projectId: template.id, revision: 1, files }).nodes
      .filter(node => node.name === 'Text' && node.kind !== 'definition')
      .map(node => ({ template: template.id, written: files.find(file => file.id === node.source.file)!.text.slice(node.source.start, node.source.end).split('\n')[0]!, ids: (node.controls ?? []).filter(c => c.id.startsWith('content')).map(c => c.id) }))
  })

  it.each(['motion', 'store', 'flow', 'dispatch', 'folio', 'kitchen', 'pulse'])('shows the cases of a choice in %s, and no read-only card beside them', template => {
    const choices = texts.filter(text => text.template === template && text.ids.some(id => id === 'content:then' || id === 'content:else'))
    expect(choices.length).toBeGreaterThan(0)
    expect(choices.filter(text => text.ids.includes('content:data'))).toEqual([])
  })

  it('shows a choice of two literals as its two cases', () => {
    const source = screen('        Text(on ? "On" : "Off")', '\nlet on = true\n')
    expect(viewWritten(source, 'Text(on ? "On" : "Off")').controls?.filter(c => c.id.startsWith('content')).map(c => c.id)).toEqual(['content:then', 'content:else'])
  })

  it.each([
    ['an input with a default', '    var label = ""\n'],
    ['an input with none', '    var label: String\n'],
  ])("says the words of a component's Text read from %s are set where each copy is used", (_, input) => {
    const source = screen('        Swatch(label: "A")', `\nstruct Swatch: View {\n${input}\n    var body: some View {\n        Text(label)\n    }\n}\n`)
    expect(viewWritten(source, 'Text(label)').controls?.filter(c => c.id.startsWith('content'))).toEqual([
      expect.objectContaining({ id: 'content:data', value: 'label', disabledReason: 'This text is set where this view is used. Change it there.' }),
    ])
  })

  it('still says words worked out from an input are worked out in Swift', () => {
    const source = screen('        Swatch(label: "A")', '\nstruct Swatch: View {\n    var label = ""\n\n    var body: some View {\n        Text(label.uppercased())\n    }\n}\n')
    expect(viewWritten(source, 'Text(label.uppercased())').controls?.find(c => c.id === 'content:data')?.disabledReason).toBe('These words are worked out in Swift. Change them in Code.')
  })
})

describe('a symbol variant', () => {
  it.each([
    'Image(systemName: "star").symbolVariant(.fill.circle)',
    'Image(systemName: "bell").symbolVariant(.slash.fill)',
    'Label("Saved", systemImage: "heart").symbolVariant(.circle.fill)',
  ])('says nothing of %s, which the preview draws', body => {
    expect(said(`        ${body}`)).toEqual([])
    expect(viewWritten(screen(`        ${body}`), body).modifiers?.[0]).toMatchObject({ name: 'symbolVariant', category: 'appearance' })
    expect(viewWritten(screen(`        ${body}`), body).modifiers?.[0]?.drawn).toBeUndefined()
  })

  it.each([
    ['Image(systemName: "house").symbolVariant(.slash)', 'house.slash', 'house'],
    ['Label("Files", systemImage: "folder").symbolVariant(.square)', 'folder.square', 'folder'],
    ['VStack { Image(systemName: "folder") }.symbolVariant(.square)', 'folder.square', 'folder'],
    ['HStack { Label("A", systemImage: "star"); Image(systemName: "folder").padding() }.symbolVariant(.square)', 'folder.square', 'folder'],
  ])('says %s draws the base symbol where the preview has no drawing for the composed name', (body, variant, written) => {
    expect(said(`        ${body}`)).toEqual([`warning: The preview has no drawing for the symbol '${variant}', so it draws '${written}'.`])
  })
})

describe('zIndex', () => {
  it('says nothing of it, which the preview draws, and lists it in Design as layout that is drawn', () => {
    const body = 'ZStack {\n            Circle().fill(.red).zIndex(1)\n            Circle().fill(.blue)\n        }'
    expect(said(`        ${body}`)).toEqual([])
    const card = viewWritten(screen(`        ${body}`), 'Circle().fill(.red).zIndex(1)').modifiers?.find(m => m.name === 'zIndex')
    expect(card).toMatchObject({ category: 'layout' })
    expect(card?.drawn).toBeUndefined()
  })
})

describe('a mask', () => {
  it.each(MASKS_DRAWN)('says nothing of %s, which the preview draws', body => {
    expect(said(`        ${body}`)).toEqual([])
  })

  it.each<readonly [string, string]>([
    ['a view of the project', 'Color.blue.mask(Badge())'],
    ['a stack', 'Color.blue.mask { VStack { Circle(); Circle() } }'],
    ['a stroked shape', 'Color.blue.mask(Circle().stroke(lineWidth: 4))'],
    ['text over a view that is not a colour or a gradient', 'Image("photo").mask(Text("Hi"))'],
    ['text over a stack', 'VStack { Color.red }.mask(Text("Hi"))'],
    ['text over a colour blurred before the mask', 'Color.red.blur(radius: 2).mask(Text("Hi"))'],
    ['a shape with padding', 'Color.blue.mask(Circle().padding(4))'],
    ['a shape moved by an offset', 'Color.blue.mask { Circle().offset(x: 4) }'],
    ...GRADIENT_SHAPES.map(mask => ['a shape in a gradient', mask] as const),
  ])('still says a mask of %s is drawn unmasked', (_, body) => {
    expect(said(`        ${body}`, '\nstruct Badge: View { var body: some View { Circle() } }\n').join('\n')).toContain("'.mask'")
  })
})

describe('a symbol variant or a mask', () => {
  const written = (body: string, name: string) => bodyOf(setLayer(project(screen(`        ${body}`)), name, [{ section: 'effects', opacity: 0.5 }]))
  /** Each view, what Design writes when its opacity is set to 50%, and the view it is read as. */
  const FADED = [
    ['Image(systemName: "star").symbolVariant(.fill.circle)', 'Image', 'Image(systemName: "star").opacity(0.5).symbolVariant(.fill.circle)'],
    ['Color.blue.mask(Circle())', 'Color', 'Color.blue.opacity(0.5).mask(Circle())'],
    ['Color.red.mask { Image(systemName: "star.fill") }', 'Color', 'Color.red.opacity(0.5).mask { Image(systemName: "star.fill") }'],
    ['LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing).mask(Text("Hi").font(.largeTitle))', 'LinearGradient',
      'LinearGradient(colors: [.red, .blue], startPoint: .leading, endPoint: .trailing).opacity(0.5).mask(Text("Hi").font(.largeTitle))'],
  ] as const

  it.each(FADED)('leaves Design open on %s, writing beside it and keeping it as written', (body, name, after) => {
    expect(written(body, name)).toBe(`        ${after}`)
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds each view Design writes', () => {
      typecheckInXcode(FADED.map(([, , after]) => screen(`        ${after}`)))
    }, 300_000)
  })
})

describe.skipIf(!XCODE)('what the checker now knows builds in Xcode 27', () => {
  it('for words, Apple names, Charts modifiers and iOS fonts', () => {
    const charts = (source: string) => source.replace('import SwiftUI\n', 'import SwiftUI\nimport Charts\n')
    typecheckInXcode([
      screen(...WORDS),
      ...APPLE_NAMES.map(([, body]) => charts(screen(body, ITEMS))),
      charts(screen(CHART_MODIFIERS)),
      charts(screen(POSITIONED, ITEMS)),
      screen(SEARCH_BEHAVIOR),
      screen(BUILT_IN_FONTS),
      screen([...MASKS_DRAWN, ...GRADIENT_SHAPES].map(mask => `        ${mask}`).join('\n').replace(/^/, '        VStack {\n').concat('\n        }')),
    ])
  }, 300_000)
})
