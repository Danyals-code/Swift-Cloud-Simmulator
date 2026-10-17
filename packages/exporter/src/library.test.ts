import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, zipSync, zlibSync } from 'fflate'
import { LIBRARY_IMAGES, projectFromFiles, readImage, type ImageAsset, type Project } from '@studio/project-model'
import { exportArchive, exportEditableZip, exportProjectZip, libraryAsset, readProjectArchive } from './index'

/**
 * Library images in an export and back (Wave 7b, WAVE7-PLAN §2.5 and §2.6).
 *
 * The page adds a library image the code uses to an export-only copy of the project; the
 * exporter writes it as a 3x imageset, records it under the handoff's `library` key rather
 * than `assets`, and counts it apart from the designer's own images. Reading an archive turns
 * an unchanged library imageset back into a reference, so it never becomes an own image.
 */
const served = (name: string) => new Uint8Array(readFileSync(new URL(`../../../apps/web/public/library/v1/${name}.jpg`, import.meta.url)))
const utf8 = new TextEncoder()
function crc(bytes: Uint8Array) { let c = -1; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return (c ^ -1) >>> 0 }
/** A 1x1 PNG of one red value. */
function png(red = 255): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer)
    view.setUint32(0, data.length); bytes.set(utf8.encode(type), 4); bytes.set(data, 8); view.setUint32(bytes.length - 4, crc(bytes.subarray(4, -4)))
    return bytes
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, 1); view.setUint32(4, 1); header[8] = 8; header[9] = 6
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(new Uint8Array([0, red, 0, 0, 255]))), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const own = (name: string, red = 255): ImageAsset => ({ id: `own-${red}-${name.replace(/\W/g, '')}`, name, scale: 1, light: readImage(png(red)) })
const app = (body: string) => `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { ${body} } }\n`
function project(assets: readonly ImageAsset[], body = 'Image("snowy-peak")'): Project {
  return { ...projectFromFiles([{ name: 'App.swift', text: app(body) }], 0)!, schemaVersion: 1, assets }
}
function handoffOf(zip: Uint8Array) {
  const [, bytes] = Object.entries(unzipSync(zip)).find(([path]) => path.endsWith('.swiftstudio/project.json'))!
  return JSON.parse(new TextDecoder().decode(bytes)) as { assets: { name: string }[]; library?: string[] }
}
const imagesets = (zip: Uint8Array) => Object.keys(unzipSync(zip)).filter(path => path.endsWith('.imageset/Contents.json')).map(path => path.split('/').at(-2)!.replace(/\.imageset$/, '')).sort()

describe('a library image as the export writes it', () => {
  const peak = libraryAsset('snowy-peak', served('snowy-peak'))

  it('is the served file, unchanged, at 3x', () => {
    expect(peak).toMatchObject({ name: 'snowy-peak', scale: 3, light: { mime: 'image/jpeg', width: 681, height: 1024 } })
    expect(Buffer.from(peak.light.bytes).equals(Buffer.from(served('snowy-peak')))).toBe(true)
  })

  it('refuses bytes that are not that library image', () => {
    expect(() => libraryAsset('snowy-peak', served('sea-tram'))).toThrow(/snowy-peak/)
    expect(() => libraryAsset('not-in-library', served('sea-tram'))).toThrow()
  })

  it.each(['xcodeproj', 'swiftpm', 'spm', 'xcodegen'] as const)('goes into the %s catalog as a 3x imageset, listed under library, not assets', format => {
    const zip = exportProjectZip(project([own('Logo'), peak]), format)
    const files = unzipSync(zip)
    const [contents] = Object.entries(files).filter(([path]) => path.endsWith('snowy-peak.imageset/Contents.json')).map(([, b]) => JSON.parse(new TextDecoder().decode(b)))
    expect(contents.images).toEqual([{ idiom: 'universal', scale: '3x', filename: 'light.jpg' }])
    const [, jpg] = Object.entries(files).find(([path]) => path.endsWith('snowy-peak.imageset/light.jpg'))!
    expect(Buffer.from(jpg).equals(Buffer.from(served('snowy-peak')))).toBe(true)
    const handoff = handoffOf(zip)
    expect(handoff.assets.map(a => a.name)).toEqual(['Logo'])
    expect(handoff.library).toEqual(['snowy-peak'])
  })

  it('leaves the handoff without a library key when no library image is used', () => {
    const zip = exportProjectZip(project([own('Logo')], 'Image("Logo")'))
    expect(handoffOf(zip)).not.toHaveProperty('library')
    expect(imagesets(zip)).toEqual(['Logo'])
  })

  it('counts library images apart from the 64 own images a project may have', () => {
    const many = Array.from({ length: 64 }, (_, i) => own(`Own ${i}`, i))
    const library = ['snowy-peak', 'sea-tram', 'blue-mosaic', 'portrait-sword', 'portrait-pipe', 'red-bus-bridge', 'portrait-village', 'stone-circle-moon'].map(name => libraryAsset(name, served(name)))
    const zip = exportProjectZip(project([...many, ...library]))
    expect(imagesets(zip)).toHaveLength(72)
    expect(handoffOf(zip).library).toHaveLength(8)
  })
})

describe('the handoff report', () => {
  const report = (assets: readonly ImageAsset[]) => {
    const p = project(assets), root = p.manifest.name
    const review = { device: 'iPhone 18 Pro', colorScheme: 'light' as const, dynamicTypeSize: 'large', typeScale: 1, diagnostics: [], screens: [] }
    return new TextDecoder().decode(unzipSync(exportArchive(p, { format: 'complete', review, now: new Date(0) }).bytes)[`${root}/Studio Report/report.md`])
  }

  it('lists library images with the bundled ones, since they are in the app, and says how many came from the library', () => {
    const library = ['snowy-peak', 'sea-tram'].map(name => libraryAsset(name, served(name)))
    expect(report([own('Logo'), ...library])).toContain('3 bundled images, including 2 from the studio library; ')
  })

  it('says nothing of the library when the app uses none of it', () => {
    expect(report([own('Logo')])).toContain('\n1 bundled images; ')
  })
})

describe('reading a library image back', () => {
  const peak = libraryAsset('snowy-peak', served('snowy-peak'))

  it.each([['editable', (p: Project) => exportEditableZip(p)], ['xcodeproj', (p: Project) => exportProjectZip(p)]] as const)('turns the %s handoff\'s library imagesets back into references', (_, write) => {
    const archive = readProjectArchive(write(project([own('Logo'), peak])))
    expect(archive.problem).toBeNull()
    expect(archive.project!.assets!.map(a => a.name)).toEqual(['Logo'])
  })

  it('keeps a library imageset a developer changed in Xcode as an own image that replaces it', () => {
    const files = unzipSync(exportProjectZip(project([peak])))
    const path = Object.keys(files).find(p => p.endsWith('snowy-peak.imageset/light.jpg'))!
    files[path] = served('sea-tram')
    const archive = readProjectArchive(zipSync(files))
    expect(archive.problem).toBeNull()
    expect(archive.project!.assets!.map(a => [a.name, a.light.width])).toEqual([['snowy-peak', 736]])
  })

  it('drops an Xcode catalog\'s imageset that is byte-equal to the library image of its name', () => {
    const contents = (scale: string) => utf8.encode(JSON.stringify({ images: [{ idiom: 'universal', scale, filename: 'light.jpg' }], info: { author: 'xcode', version: 1 } }))
    const zip = (name: string, bytes: Uint8Array, scale = '3x') => zipSync({
      'Demo/Demo/App.swift': utf8.encode(app(`Image("${name}")`)),
      [`Demo/Demo/Assets.xcassets/${name}.imageset/Contents.json`]: contents(scale),
      [`Demo/Demo/Assets.xcassets/${name}.imageset/light.jpg`]: bytes,
      'Demo/Demo/Assets.xcassets/Logo.imageset/Contents.json': utf8.encode(JSON.stringify({ images: [{ idiom: 'universal', scale: '1x', filename: 'light.png' }] })),
      'Demo/Demo/Assets.xcassets/Logo.imageset/light.png': png(),
    })
    const names = (bytes: Uint8Array) => readProjectArchive(bytes).project!.assets!.map(a => a.name).sort()
    expect(names(zip('sea-tram', served('sea-tram')))).toEqual(['Logo'])
    expect(names(zip('sea-tram', served('snowy-peak')))).toEqual(['Logo', 'sea-tram'])
    expect(names(zip('sea-tram', served('sea-tram'), '1x'))).toEqual(['Logo', 'sea-tram'])
    expect(names(zip('Sea-Tram', served('sea-tram')))).toEqual(['Logo', 'Sea-Tram'])
  })

  it('knows every library image', () => {
    for (const { name } of LIBRARY_IMAGES) expect(libraryAsset(name, served(name)).name).toBe(name)
  })
})

/**
 * The native check: an export using three library images builds in Xcode 27 with warnings as
 * errors, and the compiled catalog holds each at scale 3, so Xcode sizes them as the preview does.
 *
 *     XCODE_BUILD=1 npx vitest run packages/exporter/src/library.test.ts
 */
describe.skipIf(process.env.XCODE_BUILD !== '1')('library images in Xcode 27', () => {
  it('builds, with each used library image at 3x in the app and no other', () => {
    const swift = `import SwiftUI

@main struct LibraryApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}

struct Place: Identifiable {
    let id = UUID()
    let photo: String
}

struct ContentView: View {
    let places = [Place(photo: "sea-tram"), Place(photo: "red-bus-bridge")]

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Image("snowy-peak")
                    .resizable()
                    .scaledToFill()
                    .frame(height: 240)
                    .clipped()
                ForEach(places) { place in
                    Image(place.photo)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                }
            }
        }
    }
}
`
    const library = ['snowy-peak', 'sea-tram', 'red-bus-bridge'].map(name => libraryAsset(name, served(name)))
    const exported = { ...projectFromFiles([{ name: 'App.swift', text: swift }], 0)!, schemaVersion: 1 as const, assets: library }
    const root = mkdtempSync(join(tmpdir(), 'studio-xcode-library-'))
    try {
      let project = ''
      for (const [path, bytes] of Object.entries(unzipSync(exportProjectZip(exported, 'xcodeproj')))) {
        const full = join(root, path)
        mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true })
        writeFileSync(full, bytes)
        if (path.endsWith('.pbxproj')) project = join(root, path.slice(0, path.indexOf('.xcodeproj') + '.xcodeproj'.length))
      }
      const scheme = project.slice(project.lastIndexOf('/') + 1, -'.xcodeproj'.length)
      const output = execFileSync('xcodebuild', ['-project', project, '-scheme', scheme, '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', join(root, 'DerivedData'), 'SWIFT_TREAT_WARNINGS_AS_ERRORS=YES', 'build'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 })
      expect(output).toContain('BUILD SUCCEEDED')
      // Swift and asset catalog warnings; Xcode's own tools log unrelated ones.
      expect(output.split('\n').filter(line => /(\.swift|\.xcassets)(:\d+:\d+)?: warning: /.test(line))).toEqual([])
      const products = join(root, 'DerivedData/Build/Products/Debug-iphonesimulator')
      const app = readdirSync(products).find(name => name.endsWith('.app'))!
      const info = JSON.parse(execFileSync('xcrun', ['assetutil', '--info', join(products, app, 'Assets.car')], { encoding: 'utf8' })) as { Name?: string; Scale?: number; AssetType?: string }[]
      const images = info.filter(entry => entry.AssetType === 'Image').map(entry => [entry.Name, entry.Scale]).sort()
      expect(images).toEqual([['red-bus-bridge', 3], ['sea-tram', 3], ['snowy-peak', 3]])
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 300_000)
})
