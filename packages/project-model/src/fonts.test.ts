import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fontAsset, fontFileName, readFont, validateFonts, type FontAsset } from './fonts'
import { projectFromFiles } from './open'
import { MemoryProjectStore } from './stores'
import { encodeProject } from './share'
import { projectBackup } from './backup'
import { applyProjectTransaction, DocumentHistory } from './transactions'
import { normalizeProject } from './types'

/**
 * The name-table parser and the font asset (Wave 6f).
 *
 * Geist Regular is SIL OFL 1.1, copied unchanged from next's `@vercel/og`. Its expected
 * names and metrics are what macOS CoreText reports for the same file: PostScript name
 * `Geist-Regular`, family `Geist`, 1000 units per em, ascent 1005 and descent 295 units
 * (17.085 and 5.015 at 17 pt), no leading, regular weight, upright.
 */
const GEIST = new Uint8Array(readFileSync(new URL('../../../e2e/fixtures/Geist-Regular.ttf', import.meta.url)))
/** Byte equality without a deep comparison of 126,000 numbers. */
const isGeist = (bytes: Uint8Array | undefined) => !!bytes && Buffer.from(bytes).equals(Buffer.from(GEIST))

/** UTF-16BE, as platform 0 and 3 names are stored. */
const utf16 = (text: string) => { const out = new Uint8Array(text.length * 2); for (let i = 0; i < text.length; i++) { out[i * 2] = text.charCodeAt(i) >> 8; out[i * 2 + 1] = text.charCodeAt(i) & 255 } return out }
const ascii = (text: string) => Uint8Array.from(text, c => c.charCodeAt(0))
/** A name record; `bytes`, when given, is stored as it is in place of the text. */
interface NameRecord { platform: number; encoding: number; language: number; id: number; text: string; bytes?: Uint8Array }
function nameTable(records: readonly NameRecord[]): Uint8Array {
  const strings = records.map(r => r.bytes ?? (r.platform === 1 ? ascii(r.text) : utf16(r.text)))
  const head = 6 + records.length * 12, total = head + strings.reduce((n, s) => n + s.length, 0)
  const out = new Uint8Array(total), view = new DataView(out.buffer)
  view.setUint16(2, records.length); view.setUint16(4, head)
  let offset = 0
  records.forEach((r, i) => {
    const at = 6 + i * 12
    view.setUint16(at, r.platform); view.setUint16(at + 2, r.encoding); view.setUint16(at + 4, r.language); view.setUint16(at + 6, r.id)
    view.setUint16(at + 8, strings[i]!.length); view.setUint16(at + 10, offset)
    out.set(strings[i]!, head + offset); offset += strings[i]!.length
  })
  return out
}
function headTable(unitsPerEm = 2048, macStyle = 0): Uint8Array {
  const out = new Uint8Array(54), view = new DataView(out.buffer)
  view.setUint32(0, 0x00010000); view.setUint32(12, 0x5f0f3cf5); view.setUint16(18, unitsPerEm); view.setUint16(44, macStyle)
  return out
}
function hheaTable(ascender = 1900, descender = -500, lineGap = 67): Uint8Array {
  const out = new Uint8Array(36), view = new DataView(out.buffer)
  view.setUint32(0, 0x00010000); view.setInt16(4, ascender); view.setInt16(6, descender); view.setInt16(8, lineGap)
  return out
}
function os2Table(weight: number, fsSelection: number): Uint8Array {
  const out = new Uint8Array(78), view = new DataView(out.buffer)
  view.setUint16(4, weight); view.setUint16(62, fsSelection)
  return out
}
/** A font file holding only the tables given: enough for the parser, which reads nothing else. */
function sfnt(tables: Record<string, Uint8Array>, version = 0x00010000): Uint8Array {
  const tags = Object.keys(tables).sort(), header = 12 + tags.length * 16
  const total = tags.reduce((n, tag) => n + Math.ceil(tables[tag]!.length / 4) * 4, header)
  const out = new Uint8Array(total), view = new DataView(out.buffer)
  view.setUint32(0, version); view.setUint16(4, tags.length)
  let offset = header
  tags.forEach((tag, i) => {
    const at = 12 + i * 16
    for (let c = 0; c < 4; c++) out[at + c] = tag.charCodeAt(c)
    view.setUint32(at + 8, offset); view.setUint32(at + 12, tables[tag]!.length)
    out.set(tables[tag]!, offset); offset += Math.ceil(tables[tag]!.length / 4) * 4
  })
  return out
}
const windows = (id: number, text: string, language = 0x409): NameRecord => ({ platform: 3, encoding: 1, language, id, text })
const brand = (extra: Record<string, Uint8Array> = {}, names: readonly NameRecord[] = [windows(1, 'Brand Medium'), windows(16, 'Brand'), windows(6, 'Brand-Medium')]) =>
  sfnt({ head: headTable(), hhea: hheaTable(), name: nameTable(names), 'OS/2': os2Table(500, 0), ...extra })

describe('readFont reads a real font as CoreText does', () => {
  it('reads Geist Regular: names, weight, slant and metrics', () => {
    expect(readFont(GEIST)).toEqual({
      format: 'ttf', postScriptName: 'Geist-Regular', family: 'Geist', weight: 400, italic: false,
      metrics: { unitsPerEm: 1000, ascender: 1005, descender: -295, lineGap: 0 },
    })
  })
  it('names the file after its PostScript name', () => {
    expect(fontFileName(readFont(GEIST))).toBe('Geist-Regular.ttf')
  })
})

describe('readFont reads the name table by the spec', () => {
  it('prefers the typographic family (ID 16) to the legacy one (ID 1)', () => {
    expect(readFont(brand())).toMatchObject({ family: 'Brand', postScriptName: 'Brand-Medium', weight: 500, metrics: { unitsPerEm: 2048, ascender: 1900, descender: -500, lineGap: 67 } })
  })
  it('uses the legacy family when there is no typographic one', () => {
    expect(readFont(brand({}, [windows(1, 'Brand'), windows(6, 'Brand-Bold')])).family).toBe('Brand')
  })
  it('prefers US English Windows names, then other Windows names, then Unicode, then Mac Roman', () => {
    const names = [
      { platform: 1, encoding: 0, language: 0, id: 1, text: 'Mac' },
      { platform: 0, encoding: 3, language: 0, id: 1, text: 'Unicode' },
      windows(1, 'Marque', 0x40c),
      windows(1, 'Brand'),
      windows(6, 'Brand-Regular'),
    ]
    expect(readFont(brand({}, names)).family).toBe('Brand')
    expect(readFont(brand({}, names.filter(n => n.text !== 'Brand'))).family).toBe('Marque')
    expect(readFont(brand({}, names.filter(n => n.platform !== 3 || n.id === 6))).family).toBe('Unicode')
    expect(readFont(brand({}, [names[0]!, { platform: 1, encoding: 0, language: 0, id: 6, text: 'Mac-Regular' }]))).toMatchObject({ family: 'Mac', postScriptName: 'Mac-Regular' })
  })
  it('decodes Mac Roman names by the Mac Roman table, not as Latin-1', () => {
    const mac = (id: number, bytes: Uint8Array): NameRecord => ({ platform: 1, encoding: 0, language: 0, id, text: '', bytes })
    // "Café" in Mac Roman: é is 0x8E there, where Latin-1 has a control character.
    expect(readFont(brand({}, [mac(1, Uint8Array.of(0x43, 0x61, 0x66, 0x8e)), mac(6, ascii('Cafe-Regular'))])).family).toBe('Café')
    // Every byte above ASCII decodes as the platform's own Mac Roman decoder reads it.
    const upper = Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i)
    expect(readFont(brand({}, [mac(1, upper), mac(6, ascii('Mac-Regular'))])).family).toBe(new TextDecoder('macintosh').decode(upper))
  })
  it('reads Windows Symbol (3, 0) names as UTF-16BE', () => {
    const symbol = (id: number, text: string): NameRecord => ({ platform: 3, encoding: 0, language: 0x409, id, text })
    expect(readFont(brand({}, [symbol(1, 'Brand Dingbats'), symbol(6, 'BrandDingbats')]))).toMatchObject({ family: 'Brand Dingbats', postScriptName: 'BrandDingbats' })
  })
  it('reads OpenType CFF fonts as otf', () => {
    expect(readFont(sfnt({ head: headTable(), hhea: hheaTable(), name: nameTable([windows(1, 'Brand'), windows(6, 'Brand-Regular')]) }, 0x4f54544f))).toMatchObject({ format: 'otf', weight: 400, italic: false })
  })
  it('reads italic from OS/2 fsSelection, or from head.macStyle without OS/2', () => {
    expect(readFont(brand({ 'OS/2': os2Table(400, 1) })).italic).toBe(true)
    expect(readFont(brand({ 'OS/2': os2Table(400, 0x200) })).italic).toBe(true)
    expect(readFont(sfnt({ head: headTable(1000, 2), hhea: hheaTable(), name: nameTable([windows(1, 'Brand'), windows(6, 'Brand-Italic')]) }))).toMatchObject({ italic: true, weight: 400 })
  })
})

describe('readFont refuses what it cannot read, with a reason', () => {
  const refuses = (bytes: Uint8Array, reason: RegExp) => expect(() => readFont(bytes)).toThrow(reason)
  it('refuses web fonts and collections by name', () => {
    refuses(Uint8Array.of(0x77, 0x4f, 0x46, 0x46, 0, 1, 0, 0, 0, 0, 0, 0), /web font.*\.ttf or \.otf/)
    refuses(Uint8Array.of(0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 0, 0, 0, 0), /web font/)
    refuses(Uint8Array.of(0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 0), /collection/)
  })
  it('refuses a file that is not a font', () => {
    refuses(new TextEncoder().encode('not a font at all'), /isn’t a TrueType or OpenType font/)
    refuses(new Uint8Array(), /isn’t a TrueType or OpenType font/)
  })
  it('refuses a huge table count or name-record count as damaged, without reading past the file', () => {
    const tables = brand()
    new DataView(tables.buffer).setUint16(4, 0xffff)
    refuses(tables, /damaged/)
    refuses(brand({ name: Uint8Array.of(0, 0, 0xff, 0xff, 0, 6) }), /damaged/)
  })
  it('refuses damaged tables', () => {
    const bytes = brand()
    new DataView(bytes.buffer).setUint32(12 + 8, bytes.length) // the first table now starts past the end
    refuses(bytes, /damaged/)
    refuses(GEIST.subarray(0, 40), /damaged/)
    refuses(brand({ name: Uint8Array.of(0, 0, 0, 9, 0, 6) }), /damaged/)
  })
  it('refuses a font without the tables iOS needs', () => {
    refuses(sfnt({ head: headTable(), name: nameTable([windows(1, 'Brand'), windows(6, 'Brand-Regular')]) }), /damaged/)
  })
  it('refuses a font without a PostScript name, or one a file name can’t hold', () => {
    refuses(brand({}, [windows(1, 'Brand')]), /no PostScript name/)
    refuses(brand({}, [windows(1, 'Brand'), windows(6, 'Brand Bold')]), /PostScript name/)
    refuses(brand({}, [windows(1, 'Brand'), windows(6, 'Brand:Bold')]), /PostScript name/)
    refuses(brand({}, [windows(1, 'Brand'), windows(6, 'Brand/Bold')]), /“Brand\/Bold”, has characters iOS or a file name can’t take/)
    refuses(brand({}, [windows(1, 'Brand'), windows(6, '../Brand')]), /“\.\.\/Brand”/)
    refuses(brand({}, [windows(1, 'Brand'), windows(6, '<Brand>')]), /“<Brand>”, has characters iOS or a file name can’t take/)
  })
  it('refuses a PostScript name beginning with a dot, which would make a hidden file and which iOS keeps for its own', () => {
    refuses(brand({}, [windows(1, 'Brand'), windows(6, '.Hidden')]), /“\.Hidden” begins with a dot/)
    refuses(brand({}, [windows(1, 'Brand'), windows(6, '..')]), /“\.\.” begins with a dot/)
  })
  it('refuses a font without a family name', () => {
    refuses(brand({}, [windows(6, 'Brand-Regular')]), /no family name/)
  })
  it('refuses a file over 8 MB', () => {
    refuses(new Uint8Array(8 * 1024 * 1024 + 1), /8 MB/)
  })
})

describe('font assets', () => {
  it('keeps the file unchanged beside what it says', () => {
    const font = fontAsset('geist', GEIST)
    expect(font).toMatchObject({ id: 'geist', postScriptName: 'Geist-Regular', family: 'Geist' })
    expect(isGeist(font.bytes)).toBe(true)
    expect(font.bytes).not.toBe(GEIST)
  })
  it('refuses a font iOS already has, which iOS would draw in place of the file', () => {
    expect(() => fontAsset('a', brand({}, [windows(1, 'Georgia'), windows(6, 'Georgia')]))).toThrow(/iOS already has a font named Georgia/)
  })
  it('refuses a font whose family iOS already has, in any case, and suggests a renamed copy', () => {
    const reason = /iOS already has the Avenir Next family, so a device would draw its own Avenir Next in place of this file\. Add a copy of the font with its family renamed\./
    expect(() => fontAsset('a', brand({}, [windows(16, 'Avenir Next'), windows(6, 'BrandAvenir-Regular')]))).toThrow(reason)
    expect(() => fontAsset('a', brand({}, [windows(1, 'avenir next'), windows(6, 'BrandAvenir-Regular')]))).toThrow(/iOS already has the Avenir Next family/)
  })
  it('refuses a record with an iOS name or family that skipped fontAsset, as a backup or archive could carry', () => {
    const record = (bytes: Uint8Array): FontAsset => ({ id: 'f', ...readFont(bytes), bytes })
    expect(() => validateFonts([record(brand({}, [windows(1, 'Georgia'), windows(6, 'Georgia')]))])).toThrow(/iOS already has a font named Georgia/)
    expect(() => validateFonts([record(brand({}, [windows(1, 'Georgia'), windows(6, 'Brand-Georgia')]))])).toThrow(/iOS already has the Georgia family/)
    expect(() => normalizeProject({ ...projectFromFiles([{ name: 'App.swift', text: 'import SwiftUI\n' }], 0)!, fonts: [record(brand({}, [windows(1, 'Georgia'), windows(6, 'Georgia')]))] })).toThrow(/iOS already has a font named Georgia/)
  })
  it('validates a project’s fonts: bytes match, PostScript names unique in any case, and limits', () => {
    const geist = fontAsset('geist', GEIST), medium = fontAsset('brand', brand())
    expect(() => validateFonts([geist, medium])).not.toThrow()
    expect(() => validateFonts([geist, { ...medium, id: 'geist' }])).toThrow(/unique/)
    expect(() => validateFonts([geist, { ...geist, id: 'other' }])).toThrow(/already has the font Geist-Regular/)
    expect(() => validateFonts([{ ...geist, family: 'Other' }])).toThrow(/does not match/)
    expect(() => validateFonts([{ ...geist, id: 'a/b' }])).toThrow(/unique/)
    expect(() => validateFonts(Array.from({ length: 33 }, (_, i) => ({ ...medium, id: `f${i}`, postScriptName: `F${i}` })) as FontAsset[])).toThrow(/up to 32 fonts/)
  })
})

describe('a project keeps its fonts', () => {
  const project = () => projectFromFiles([{ name: 'App.swift', text: 'import SwiftUI\n' }], 0)!
  const geist = () => fontAsset('geist', GEIST)

  it('adds and removes fonts in one transaction, refusing a stale or invalid one with the reason', () => {
    const before = project()
    const added = applyProjectTransaction(before, 0, { projectId: before.id, baseRevision: 0, changes: [], fonts: { before: before.fonts, after: [geist()] } })
    expect(added.ok && added.project.fonts?.map(f => f.postScriptName)).toEqual(['Geist-Regular'])
    if (!added.ok) return
    expect(applyProjectTransaction(added.project, 1, { projectId: before.id, baseRevision: 1, changes: [], fonts: { before: before.fonts, after: [] } })).toEqual({ ok: false, reason: 'Project fonts changed while this edit was being prepared.' })
    expect(applyProjectTransaction(added.project, 1, { projectId: before.id, baseRevision: 1, changes: [], fonts: { before: added.project.fonts, after: [geist(), { ...geist(), id: 'again' }] } })).toEqual({ ok: false, reason: 'The project already has the font Geist-Regular.' })
    const removed = applyProjectTransaction(added.project, 1, { projectId: before.id, baseRevision: 1, changes: [], fonts: { before: added.project.fonts, after: [] } })
    expect(removed.ok && removed.project.fonts).toEqual([])
  })

  it('undoes and redoes adding a font', () => {
    const before = project(), after = { ...before, fonts: [geist()] }, history = new DocumentHistory()
    history.record(before, after, null, null)
    expect(history.take('undo', after)?.project.fonts).toBeUndefined()
    expect(history.take('redo', before)?.project.fonts?.[0]?.postScriptName).toBe('Geist-Regular')
  })

  it('saves and loads the font bytes unchanged, and refuses a record its bytes contradict', async () => {
    const store = new MemoryProjectStore(), saved = { ...project(), fonts: [geist()] }
    await store.save(saved)
    const loaded = await store.load(saved.id)
    const { bytes, ...info } = loaded!.fonts![0]!, { bytes: _saved, ...expected } = saved.fonts[0]!
    expect(isGeist(bytes)).toBe(true)
    expect(info).toEqual(expected)
    expect(() => normalizeProject({ ...saved, fonts: [{ ...geist(), postScriptName: 'Other' }] })).toThrow(/does not match its file/)
  })

  it('makes no share link for a project with fonts, as for one with images: a URL can’t carry the files', () => {
    expect(encodeProject(project())).not.toBeNull()
    expect(encodeProject({ ...project(), fonts: [geist()] })).toBeNull()
  })

  it('backs up the font file as base64', () => {
    const backup = JSON.parse(projectBackup({ ...project(), fonts: [geist()] })) as { project: { fonts: { bytes: { base64: string }; postScriptName: string }[] } }
    expect(backup.project.fonts[0]!.postScriptName).toBe('Geist-Regular')
    expect(Buffer.from(backup.project.fonts[0]!.bytes.base64, 'base64')).toEqual(Buffer.from(GEIST))
  })
})
