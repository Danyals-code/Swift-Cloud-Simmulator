/**
 * The fonts iOS ships, as `UIFont.familyNames` and `UIFont.fontNames(forFamilyName:)` list
 * them in the iOS 27 simulator: what `.font(.custom(name, size:))` draws with no font file
 * in the project (Wave 6a). Each family, then each face's PostScript name: the family's name
 * without spaces and what follows it, or after `=` the whole name where it starts otherwise.
 * One string, in a module of its own, as the studio page and the worker both load it and a
 * larger `fonts.ts` split the chunk they share into two copies.
 */
const IOS_FONTS = ('Academy Engraved LET:=AcademyEngravedLetPlain|Al Nile:,-Bold|' +
  'American Typewriter:,-Light,-Semibold,-Bold,-Condensed,-CondensedLight,-CondensedBold|Apple Color Emoji:|' +
  'Apple SD Gothic Neo:-Regular,-Thin,-UltraLight,-Light,-Medium,-SemiBold,-Bold|Apple Symbols:|' +
  'Arial:MT,-ItalicMT,-BoldMT,-BoldItalicMT|Arial Hebrew:,-Light,-Bold|Arial Rounded MT Bold:|' +
  'Avenir:-Book,-Roman,-BookOblique,-Oblique,-Light,-LightOblique,-Medium,-MediumOblique,-Heavy,-HeavyOblique,-Black,-BlackOblique|' +
  'Avenir Next:-Regular,-Italic,-UltraLight,-UltraLightItalic,-Medium,-MediumItalic,-DemiBold,-DemiBoldItalic,-Bold,-BoldItalic,-Heavy,-HeavyItalic|' +
  'Avenir Next Condensed:-Regular,-Italic,-UltraLight,-UltraLightItalic,-Medium,-MediumItalic,-DemiBold,-DemiBoldItalic,-Bold,-BoldItalic,-Heavy,-HeavyItalic|' +
  'Baskerville:,-Italic,-SemiBold,-SemiBoldItalic,-Bold,-BoldItalic|' +
  'Bodoni 72:=BodoniSvtyTwoITCTT-Book,=BodoniSvtyTwoITCTT-BookIta,=BodoniSvtyTwoITCTT-Bold|' +
  'Bodoni 72 Oldstyle:=BodoniSvtyTwoOSITCTT-Bold,=BodoniSvtyTwoOSITCTT-Book,=BodoniSvtyTwoOSITCTT-BookIt|' +
  'Bodoni 72 Smallcaps:=BodoniSvtyTwoSCITCTT-Book|Bodoni Ornaments:ITCTT|Bradley Hand:ITCTT-Bold|' +
  'Chalkboard SE:-Regular,-Light,-Bold|Chalkduster:|Charter:-Roman,-Italic,-Bold,-BoldItalic,-Black,-BlackItalic|' +
  'Cochin:,-Italic,-Bold,-BoldItalic|Copperplate:,-Light,-Bold|' +
  'Courier New:PSMT,PS-ItalicMT,PS-BoldMT,PS-BoldItalicMT|DIN Alternate:-Bold|DIN Condensed:-Bold|' +
  'Damascus:,Light,Medium,SemiBold,Bold|Devanagari Sangam MN:,-Bold|Didot:,-Italic,-Bold|' +
  'Euphemia UCAS:,-Italic,-Bold|Farah:|Futura:-Medium,-MediumItalic,-Bold,-CondensedMedium,-CondensedExtraBold|' +
  'Galvji:,-Bold|Geeza Pro:,-Bold|Georgia:,-Italic,-Bold,-BoldItalic|' +
  'Gill Sans:,-Italic,-Light,-LightItalic,-SemiBold,-SemiBoldItalic,-Bold,-BoldItalic,-UltraBold|' +
  'Grantha Sangam MN:-Regular,-Bold|Helvetica:,-Oblique,-Light,-LightOblique,-Bold,-BoldOblique|' +
  'Helvetica Neue:,-Italic,-UltraLight,-UltraLightItalic,-Thin,-ThinItalic,-Light,-LightItalic,-Medium,-MediumItalic,-Bold,-BoldItalic,-CondensedBold,-CondensedBlack|' +
  'Hiragino Maru Gothic ProN:=HiraMaruProN-W4|Hiragino Mincho ProN:=HiraMinProN-W3,=HiraMinProN-W6|' +
  'Hiragino Sans:-W3,-W4,-W5,-W6,-W7,-W8|Hoefler Text:-Regular,-Italic,-Black,-BlackItalic|Impact:|Kailasa:,-Bold|' +
  'Kefa III:-Regular,-Light,-Bold,-ExtraBold|Khmer Sangam MN:|Kohinoor Bangla:-Regular,-Light,-Semibold|' +
  'Kohinoor Devanagari:-Regular,-Light,-Semibold|Kohinoor Gujarati:-Regular,-Light,-Bold|' +
  'Kohinoor Telugu:-Regular,-Light,-Medium|Lao Sangam MN:|Malayalam Sangam MN:,-Bold|Marker Felt:-Thin,-Wide|' +
  'Menlo:-Regular,-Italic,-Bold,-BoldItalic|Mishafi:=DiwanMishafi|Mukta Mahee:-Regular,-Light,-Bold|' +
  'Myanmar Sangam MN:,-Bold|Noteworthy:-Light,-Bold|Noto Nastaliq Urdu:,-Bold|' +
  'Noto Sans Kannada:-Regular,-Light,-Bold|Noto Sans Oriya:,-Bold|Noto Sans Sunuwar:-Regular|' +
  'Noto Sans Syriac:-Regular,-Regular_Thin,-Regular_ExtraLight,-Regular_Light,-Regular_Medium,-Regular_SemiBold,-Regular_Bold,-Regular_ExtraBold,-Regular_Black|' +
  'Noto Serif Myanmar:-Regular,-Light,-Bold|Optima:-Regular,-Italic,-Bold,-BoldItalic,-ExtraBlack|' +
  'Palatino:-Roman,-Italic,-Bold,-BoldItalic|Papyrus:,-Condensed|Party LET:=PartyLetPlain|' +
  'PingFang HK:-Regular,-Ultralight,-Thin,-Light,-Medium,-Semibold|' +
  'PingFang MO:-Regular,-Ultralight,-Thin,-Light,-Medium,-Semibold|' +
  'PingFang SC:-Regular,-Ultralight,-Thin,-Light,-Medium,-Semibold|' +
  'PingFang TC:-Regular,-Ultralight,-Thin,-Light,-Medium,-Semibold|Rockwell:-Regular,-Italic,-Bold,-BoldItalic|' +
  'STIX Two Math:-Regular|' +
  'STIX Two Text:,-Italic,_Medium,-Italic_Medium-Italic,_SemiBold,-Italic_SemiBold-Italic,_Bold,-Italic_Bold-Italic|' +
  'Savoye LET:=SavoyeLetPlain|Sinhala Sangam MN:,-Bold|Snell Roundhand:,-Bold,-Black|Symbol:|' +
  'Tamil Sangam MN:,-Bold|Thonburi:,-Light,-Bold|Times New Roman:PSMT,PS-ItalicMT,PS-BoldMT,PS-BoldItalicMT|' +
  'Trebuchet MS:,-Italic,-Bold,=Trebuchet-BoldItalic|Verdana:,-Italic,-Bold,-BoldItalic|Zapf Dingbats:ITC|Zapfino:').split('|')

/** The font families iOS ships, by name. */
export const IOS_FONT_FAMILIES: readonly string[] = IOS_FONTS.map(entry => entry.slice(0, entry.indexOf(':')))

/** A PostScript name's weight word, the first it has: `DemiBold` in `AvenirNext-DemiBoldItalic`, `W6` in `HiraMinProN-W6`. */
const WEIGHT = /(?:Ultra|Extra)?[Ll]ight|Thin|(?:Demi|Semi)[Bb]old|(?:Extra|Ultra)Bold|Bold|Medium|Heavy|(?:Extra)?Black|W[3-8]/
/** CSS weights by that word, without Extra; Hiragino's W3 to W8 by their number. */
const WEIGHTS: Readonly<Record<string, number>> = { Light: 300, light: 300, Thin: 100, Bold: 700, Medium: 500, Heavy: 800, Black: 900 }
const weightOf = (word = ''): number => word[0] === 'W' ? Number(word[1]) * 100 : /^(?:Ultra|Extra)[Ll]/.test(word) ? 200
  : /^(?:Demi|Semi)/.test(word) ? 600 : /^(?:Extra|Ultra)B/.test(word) ? 800 : WEIGHTS[word.replace(/^Extra/, '')] ?? 400

export interface IosFont { readonly family: string; readonly weight?: number; readonly italic: boolean }
/** Each family and face iOS ships by its name, read from `IOS_FONTS` the first time one is asked for. */
let fonts: Map<string, IosFont> | undefined

/**
 * One of iOS's own fonts, by the family or PostScript name `.custom(…)` is given: its family,
 * and for a PostScript name its CSS weight and whether it is italic. Undefined for any other
 * name, which draws the system font there unless the project has the font: `Georgia-Light`
 * too, a face iOS doesn't have.
 */
export function iosFont(name: string): IosFont | undefined {
  if (!fonts) {
    fonts = new Map(IOS_FONT_FAMILIES.map(family => [family, { family, italic: false }]))
    for (const entry of IOS_FONTS) {
      const family = entry.slice(0, entry.indexOf(':')), start = family.replace(/ /g, '')
      for (const face of entry.slice(family.length + 1).split(',')) {
        // What follows the family's name, or the whole name, says the face's weight and slant.
        const own = face[0] === '=' ? face.slice(1) : face, full = face[0] === '=' ? own : start + own
        if (!fonts.has(full)) fonts.set(full, { family, weight: weightOf(WEIGHT.exec(own)?.[0]), italic: /It|Oblique/.test(own) })
      }
    }
  }
  return fonts.get(name)
}
