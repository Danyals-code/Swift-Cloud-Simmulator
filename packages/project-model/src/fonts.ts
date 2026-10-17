import { IOS_FONT_FAMILIES, iosFont } from '@studio/shared'

/**
 * A project's own font files (Wave 6f): `.ttf` and `.otf`, kept whole, beside what their
 * tables say. The names are read once, when a file is added, so `.custom("Brand-Bold")`
 * and `.custom("Brand")` can find the face without anything parsing the file again; the
 * metrics are hhea's, the ones CoreText measures a line with.
 */
export interface FontMetrics {
  /** head.unitsPerEm: what the others are a fraction of. */
  readonly unitsPerEm: number
  /** hhea.ascender, above the baseline. */
  readonly ascender: number
  /** hhea.descender, negative as stored: below the baseline. */
  readonly descender: number
  /** hhea.lineGap. */
  readonly lineGap: number
}
/** What a font file says about itself. */
export interface FontInfo {
  readonly format: 'ttf' | 'otf'
  /** Name ID 6: what `UIFont(name:)` finds the face by. */
  readonly postScriptName: string
  /** Name ID 16, the typographic family, or else ID 1. */
  readonly family: string
  /** OS/2 usWeightClass, 400 without one. */
  readonly weight: number
  readonly italic: boolean
  readonly metrics: FontMetrics
}
/** A font file in the project, stored with the project's record as image bytes are. */
export interface FontAsset extends FontInfo {
  readonly id: string
  readonly bytes: Uint8Array
}
/** Within what an archive can hold beside 32 MB of images and 8 MB of Swift. */
export const FONT_LIMITS = { count: 32, fileBytes: 8 * 1024 * 1024, totalBytes: 16 * 1024 * 1024 } as const

const TAG = (text: string) => (text.charCodeAt(0) << 24 | text.charCodeAt(1) << 16 | text.charCodeAt(2) << 8 | text.charCodeAt(3)) >>> 0
/** Apple's PostScript name rule, less what a file name can't hold either. */
const POSTSCRIPT = /^[!#$&'+,\-.0-9;=@A-Z^_`a-z~]{1,63}$/
/** Mac OS Roman's upper half, 0x80 to 0xFF, as Apple's table maps it: the lower half is ASCII. */
const MAC_ROMAN = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»…\u00a0ÀÃÕŒœ\u2013\u2014“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uf8ffÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ'

/** Names, the format and the metrics of a TrueType or OpenType file, or an Error saying why it can't be used. */
export function readFont(bytes: Uint8Array): FontInfo {
  if (bytes.length > FONT_LIMITS.fileBytes) throw new Error('Each font file must be no larger than 8 MB.')
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = bytes.length >= 12 ? data.getUint32(0) : 0
  if (version === TAG('wOFF') || version === TAG('wOF2')) throw new Error('That is a web font (WOFF). Add the .ttf or .otf file it was made from.')
  if (version === TAG('ttcf')) throw new Error('That is a font collection (.ttc). Add each face as its own .ttf or .otf file.')
  const format = version === 0x00010000 || version === TAG('true') ? 'ttf' : version === TAG('OTTO') ? 'otf' : null
  if (!format) throw new Error('That file isn’t a TrueType or OpenType font. Use a .ttf or .otf file.')
  const damaged = (): never => { throw new Error('That font file is damaged: its tables are missing or run past the end of the file.') }
  const count = data.getUint16(4), tables = new Map<number, [number, number]>()
  if (12 + count * 16 > bytes.length) damaged()
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16, offset = data.getUint32(at + 8), length = data.getUint32(at + 12)
    if (offset + length > bytes.length) damaged()
    tables.set(data.getUint32(at), [offset, length])
  }
  const table = (tag: string, minimum: number): number => {
    const found = tables.get(TAG(tag))
    return found && found[1] >= minimum ? found[0] : damaged()
  }
  const head = table('head', 54), hhea = table('hhea', 36), name = table('name', 6)
  const unitsPerEm = data.getUint16(head + 18)
  if (unitsPerEm < 16 || unitsPerEm > 16384) damaged()
  const records = data.getUint16(name + 2), strings = name + data.getUint16(name + 4), nameEnd = name + tables.get(TAG('name'))![1]
  if (name + 6 + records * 12 > nameEnd) damaged()
  /** A name by ID: US English Windows first, then other Windows (Symbol too, also UTF-16BE), then Unicode, then Mac Roman. */
  const text = (id: number): string => {
    let best = 4, value = ''
    for (let i = 0; i < records; i++) {
      const at = name + 6 + i * 12, platform = data.getUint16(at), encoding = data.getUint16(at + 2)
      if (data.getUint16(at + 6) !== id) continue
      const rank = platform === 3 && (encoding <= 1 || encoding === 10) ? data.getUint16(at + 4) === 0x409 ? 0 : 1 : platform === 0 ? 2 : platform === 1 && encoding === 0 ? 3 : 4
      if (rank >= best) continue
      const start = strings + data.getUint16(at + 10), length = data.getUint16(at + 8)
      if (start + length > nameEnd) damaged()
      let out = ''
      if (rank === 3) for (let c = 0; c < length; c++) { const byte = bytes[start + c]!; out += byte < 0x80 ? String.fromCharCode(byte) : MAC_ROMAN[byte - 0x80] }
      else for (let c = 0; c + 1 < length; c += 2) out += String.fromCharCode(data.getUint16(start + c))
      best = rank; value = out.replace(/\0/g, '').trim()
    }
    return value
  }
  const postScriptName = text(6), family = text(16) || text(1)
  if (!postScriptName) throw new Error('That font has no PostScript name, so iOS couldn’t find it by name.')
  if (!POSTSCRIPT.test(postScriptName)) throw new Error(`That font’s PostScript name, “${postScriptName}”, has characters iOS or a file name can’t take.`)
  // A dot first would hide the exported file, which SwiftPM then skips, and iOS keeps such names for its own fonts.
  if (postScriptName[0] === '.') throw new Error(`That font’s PostScript name “${postScriptName}” begins with a dot, which iOS keeps for its own fonts and which would hide the exported file.`)
  if (!family) throw new Error('That font has no family name.')
  const os2 = tables.get(TAG('OS/2')), weightClass = os2 && os2[1] >= 6 ? data.getUint16(os2[0] + 4) : 0
  const italic = os2 && os2[1] >= 64 ? (data.getUint16(os2[0] + 62) & 0x201) !== 0 : (data.getUint16(head + 44) & 2) !== 0
  return {
    format, postScriptName, family, weight: weightClass ? Math.min(weightClass, 1000) : 400, italic,
    metrics: { unitsPerEm, ascender: data.getInt16(hhea + 4), descender: data.getInt16(hhea + 6), lineGap: data.getInt16(hhea + 8) },
  }
}

/**
 * Refuses a face or family iOS already has. A device looks its own fonts up first, so it
 * would draw its own face in place of the file, and the preview must not draw what a
 * device wouldn't.
 */
function checkNotIos(info: FontInfo): void {
  if (iosFont(info.postScriptName)) throw new Error(`iOS already has a font named ${info.postScriptName}, and would draw its own in place of this file.`)
  const family = info.family.toLowerCase(), ios = IOS_FONT_FAMILIES.find(name => name.toLowerCase() === family)
  if (ios) throw new Error(`iOS already has the ${ios} family, so a device would draw its own ${ios} in place of this file. Add a copy of the font with its family renamed.`)
}

/** A font file as it joins the project, refused when iOS already has its face or family. */
export function fontAsset(id: string, bytes: Uint8Array): FontAsset {
  const info = readFont(bytes)
  checkNotIos(info)
  return { id, ...info, bytes: bytes.slice() }
}

/** What the file is called in an export, and in `UIAppFonts`. */
export const fontFileName = (font: FontInfo): string => `${font.postScriptName}.${font.format}`

/** Every font's bytes still say what the record says, no name is iOS's, and the project stays within its limits. */
export function validateFonts(fonts: readonly FontAsset[]): void {
  if (!Array.isArray(fonts) || fonts.length > FONT_LIMITS.count) throw new Error(`A project can contain up to ${FONT_LIMITS.count} fonts.`)
  const ids = new Set<string>(), names = new Set<string>()
  let total = 0
  for (const font of fonts) {
    if (!font || typeof font.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(font.id) || ids.has(font.id) || !(font.bytes instanceof Uint8Array)) throw new Error('Font IDs must be valid and unique.')
    ids.add(font.id)
    const info = readFont(font.bytes), m = font.metrics, n = info.metrics
    if (font.format !== info.format || font.postScriptName !== info.postScriptName || font.family !== info.family || font.weight !== info.weight || font.italic !== info.italic
      || !m || m.unitsPerEm !== n.unitsPerEm || m.ascender !== n.ascender || m.descender !== n.descender || m.lineGap !== n.lineGap) throw new Error(`The record of the font ${info.postScriptName} does not match its file.`)
    checkNotIos(info)
    const key = info.postScriptName.toLowerCase()
    if (names.has(key)) throw new Error(`The project already has the font ${info.postScriptName}.`)
    names.add(key)
    total += font.bytes.length
    if (total > FONT_LIMITS.totalBytes) throw new Error('Project fonts must total no more than 16 MB.')
  }
}
