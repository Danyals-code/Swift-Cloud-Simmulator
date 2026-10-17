import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { fontAsset, normalizeProject, readImage, type FontAsset, type Project } from '@studio/project-model'
import { createDefaultProject } from '@studio/project-model/templates'
import { bundleFor, EXPORT_FORMATS, exportArchive, exportEditableZip, exportProjectZip, parsePlist, readProjectArchive, resolveImport, reviewImport, type ExportFormat, type PlistDict } from './index'

/**
 * Font files in every export (Wave 6f). The Xcode formats bundle each file and list it
 * in `UIAppFonts`, in an Info.plist Xcode merges with the one it generates; the package
 * formats carry the files as resources; and every archive opens again with its fonts.
 */
const GEIST = new Uint8Array(readFileSync(new URL('../../../e2e/fixtures/Geist-Regular.ttf', import.meta.url)))
const PNG = new Uint8Array(readFileSync(new URL('../../../tests/fixtures/authoring-photo.png', import.meta.url)))
const decoder = new TextDecoder()
/** Fonts with their bytes as base64, which compares quickly. */
const fontsOf = (fonts: readonly FontAsset[] | undefined) => fonts?.map(({ bytes, ...font }) => ({ ...font, bytes: Buffer.from(bytes).toString('base64') }))
/** Byte equality without a deep comparison of 126,000 numbers. */
const isGeist = (bytes: Uint8Array | undefined) => !!bytes && Buffer.from(bytes).equals(Buffer.from(GEIST))
/** Geist with every name record of one ID rewritten in place, to a name of the same length. */
function geistNamed(id: number, text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(GEIST), view = new DataView(bytes.buffer)
  const entry = Array.from({ length: view.getUint16(4) }, (_, i) => 12 + i * 16).find(at => decoder.decode(bytes.subarray(at, at + 4)) === 'name')!
  const table = view.getUint32(entry + 8), strings = table + view.getUint16(table + 4)
  for (let i = 0; i < view.getUint16(table + 2); i++) {
    const at = table + 6 + i * 12
    if (view.getUint16(at + 6) !== id) continue
    expect(view.getUint16(at + 8)).toBe(text.length * 2)
    for (let c = 0; c < text.length; c++) view.setUint16(strings + view.getUint16(at + 10) + c * 2, text.charCodeAt(c))
  }
  return bytes
}
const base = createDefaultProject(0)
const project: Project = { ...base, manifest: { ...base.manifest, name: 'Café & Co' }, fonts: [fontAsset('geist', GEIST)] }
const FORMATS: readonly ExportFormat[] = EXPORT_FORMATS.map(format => format.id)
const UIAPPFONTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>UIAppFonts</key>
\t<array>
\t\t<string>Geist-Regular.ttf</string>
\t</array>
</dict>
</plist>
`

/** The pbxproj's objects, and the one object of each isa asked for. */
function pbxproj(bundle: ReadonlyMap<string, Uint8Array>) {
  const text = decoder.decode([...bundle].find(([path]) => path.endsWith('project.pbxproj'))![1])
  const objects = (parsePlist(text) as PlistDict).objects as Record<string, PlistDict>
  const all = (isa: string) => Object.entries(objects).filter(([, object]) => object.isa === isa)
  return { text, objects, all }
}

describe('the Xcode project bundles the fonts and lists them in UIAppFonts', () => {
  const bundle = bundleFor(project, 'xcodeproj')

  it('copies each font file unchanged into a Fonts group beside the sources', () => {
    expect(isGeist(bundle.get('Café & Co/Café & Co/Fonts/Geist-Regular.ttf'))).toBe(true)
  })

  it('writes an Info.plist with UIAppFonts and points INFOPLIST_FILE at it, keeping the generated one', () => {
    expect(decoder.decode(bundle.get('Café & Co/Café & Co/Info.plist')!)).toBe(UIAPPFONTS)
    const { all } = pbxproj(bundle)
    for (const [, config] of all('XCBuildConfiguration').filter(([, c]) => (c.buildSettings as PlistDict).PRODUCT_BUNDLE_IDENTIFIER)) {
      expect((config.buildSettings as PlistDict).INFOPLIST_FILE).toBe('Café & Co/Info.plist')
      expect((config.buildSettings as PlistDict).GENERATE_INFOPLIST_FILE).toBe('YES')
    }
  })

  it('puts the font in Copy Bundle Resources and leaves the Info.plist out of every build phase', () => {
    const { objects, all } = pbxproj(bundle)
    const refs = Object.fromEntries(all('PBXFileReference').map(([id, ref]) => [ref.path as string, id]))
    const font = refs['Geist-Regular.ttf']!, plist = refs['Info.plist']!
    expect(font && plist).toBeTruthy()
    const resources = all('PBXResourcesBuildPhase')[0]![1].files as string[]
    expect(resources.map(id => objects[id]!.fileRef)).toContain(font)
    expect(all('PBXBuildFile').map(([, file]) => file.fileRef)).not.toContain(plist)
    const fonts = all('PBXGroup').find(([, group]) => group.path === 'Fonts')!
    expect(fonts[1].children).toEqual([font])
  })

  it('changes nothing for a project without fonts', () => {
    const plain = bundleFor({ ...project, fonts: undefined }, 'xcodeproj')
    expect([...plain.keys()].some(path => path.endsWith('Info.plist') || path.includes('/Fonts/'))).toBe(false)
    expect(pbxproj(plain).text).not.toMatch(/\bINFOPLIST_FILE/)
    expect(pbxproj(plain).text).toBe(pbxproj(bundleFor({ ...project, fonts: [] }, 'xcodeproj')).text)
  })
})

describe('the XcodeGen spec bundles the fonts and lists them in UIAppFonts', () => {
  const bundle = bundleFor(project, 'xcodegen')
  it('copies the font under Sources, writes the Info.plist there, and names it in project.yml without compiling it', () => {
    expect(isGeist(bundle.get('Café & Co/Sources/Fonts/Geist-Regular.ttf'))).toBe(true)
    expect(decoder.decode(bundle.get('Café & Co/Sources/Info.plist')!)).toBe(UIAPPFONTS)
    const spec = decoder.decode(bundle.get('Café & Co/project.yml')!)
    expect(spec).toContain('    sources:\n      - path: Sources\n        excludes:\n          - Info.plist\n')
    expect(spec).toContain('        INFOPLIST_FILE: Sources/Info.plist\n')
    expect(spec).toContain('        GENERATE_INFOPLIST_FILE: YES\n')
  })
  it('changes nothing for a project without fonts', () => {
    const spec = decoder.decode(bundleFor({ ...project, fonts: undefined }, 'xcodegen').get('Café & Co/project.yml')!)
    expect(spec).toContain('    sources:\n      - Sources\n')
    expect(spec).not.toMatch(/\bINFOPLIST_FILE/)
  })
})

describe('the package formats carry the fonts as resources', () => {
  it.each([['swiftpm', 'Café & Co.swiftpm'], ['spm', 'Café & Co']] as const)('%s: copies the font into Resources and says how to register it', (format, root) => {
    const bundle = bundleFor(project, format)
    expect(isGeist(bundle.get(`${root}/Sources/Café & Co/Resources/Fonts/Geist-Regular.ttf`))).toBe(true)
    expect(decoder.decode(bundle.get(`${root}/Package.swift`)!)).toContain('resources: [.process("Resources")]')
    expect(decoder.decode(bundle.get(`${root}/README.md`)!)).toContain('CTFontManagerRegisterFontsForURL')
    expect([...bundle.keys()].some(path => path.endsWith('Info.plist'))).toBe(false)
  })
})

describe('every archive opens again with its fonts', () => {
  it.each(FORMATS)('%s', format => {
    const reopened = readProjectArchive(exportProjectZip(project, format)).project!
    expect(fontsOf(reopened.fonts)).toEqual(fontsOf(project.fonts))
  })
  it('the editable archive, with the font under Fonts/', () => {
    const zip = exportEditableZip(project)
    expect(isGeist(unzipSync(zip)['Café & Co/Fonts/Geist-Regular.ttf'])).toBe(true)
    expect(fontsOf(readProjectArchive(zip).project!.fonts)).toEqual(fontsOf(project.fonts))
  })
  it('an archive without fonts opens without any', () => {
    expect(readProjectArchive(exportEditableZip({ ...project, fonts: undefined })).project!.fonts).toBeUndefined()
  })
  it('refuses an archive whose font file is damaged, with the reason', () => {
    const entries = unzipSync(exportEditableZip(project))
    entries['Café & Co/Fonts/Geist-Regular.ttf'] = new TextEncoder().encode('not a font')
    expect(readProjectArchive(zipSync(entries)).problem).toBe('That file isn’t a TrueType or OpenType font. Use a .ttf or .otf file.')
  })
  it('refuses an archive carrying a font iOS already has, by PostScript name or by family', () => {
    const entries = unzipSync(exportEditableZip(project))
    entries['Café & Co/Fonts/Geist-Regular.ttf'] = geistNamed(6, 'Menlo-Regular')
    expect(readProjectArchive(zipSync(entries)).problem).toBe('iOS already has a font named Menlo-Regular, and would draw its own in place of this file.')
    entries['Café & Co/Fonts/Geist-Regular.ttf'] = geistNamed(1, 'Arial')
    expect(readProjectArchive(zipSync(entries)).problem).toBe('iOS already has the Arial family, so a device would draw its own Arial in place of this file. Add a copy of the font with its family renamed.')
  })
  it('asks which fonts to keep when both sides changed them, and keeps the choice', () => {
    const { project: incoming, handoff } = readProjectArchive(exportEditableZip(project))
    const local = normalizeProject({ ...project, fonts: [] })
    const review = reviewImport(local, incoming!, handoff!)
    const conflict = review.conflicts.find(c => c.key === '$fonts')!
    expect(conflict).toMatchObject({ label: 'Font files', local: '(none)', incoming: `Geist-Regular · ${GEIST.length} bytes` })
    expect(fontsOf(resolveImport(local, incoming!, handoff!, { $fonts: 'incoming' }).fonts)).toEqual(fontsOf(project.fonts))
    expect(resolveImport(local, incoming!, handoff!, { $fonts: 'local' }).fonts).toEqual([])
  })
})

describe('the fallback archive mentions fonts only when the project has them', () => {
  /** A project whose image record no longer matches its bytes, so every export falls back to its sources. */
  const broken = (fonts?: readonly FontAsset[]): Project => ({ ...base, ...(fonts ? { fonts } : {}), assets: [{ id: 'logo', name: 'Logo', scale: 1, light: { ...readImage(PNG), width: readImage(PNG).width + 1 } }] })
  const knownIssues = (p: Project) => decoder.decode(Object.entries(unzipSync(exportArchive(p, { format: 'xcodeproj', now: new Date(2026, 9, 17) }).bytes)).find(([path]) => path.endsWith('KNOWN-ISSUES.md'))![1]).split('Why: ')[0]
  it('says what it said before fonts, without any', () => {
    expect(knownIssues(broken())).toBe('# What this export leaves out\n\nThe project could not be built into the format you chose, so this archive holds its Swift files exactly as they were written. project-backup.json holds everything else it had: images, colour sets, designer settings and the AI conversation.\n\n')
  })
  it('names fonts among what the backup holds, with some', () => {
    expect(knownIssues(broken([fontAsset('geist', GEIST)]))).toContain('everything else it had: images, fonts, colour sets, designer settings and the AI conversation.')
  })
})
