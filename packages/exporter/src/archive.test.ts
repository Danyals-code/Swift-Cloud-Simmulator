import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { readImage, type Project } from '@studio/project-model'
import { createDefaultProject } from '@studio/project-model/templates'
import { exportArchive, readProjectArchive, type ExportReview } from './index'

/** 2026-09-24 16:30 on the clock of whoever exports. */
const NOW = new Date(2026, 8, 24, 16, 30)
const PNG = new Uint8Array(readFileSync(new URL('../../../tests/fixtures/authoring-photo.png', import.meta.url)))
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

function entriesOf(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([path, data]) => [path, decoder.decode(data)]))
}

/** A blank design whose HomeScreen.swift is `text`. */
function withHome(text: string): Project {
  const base = createDefaultProject(0)
  return { ...base, files: base.files.map(file => file.id.endsWith('HomeScreen.swift') ? { ...file, text } : file) }
}

/** A blank design called `name`. */
function named(name: string): Project {
  const base = createDefaultProject(0)
  return { ...base, manifest: { ...base.manifest, name } }
}

/** A capture of two screens, as the complete bundle gets it. */
const screenPng = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDOkAAAAASUVORK5CYII=', 'base64'))
const review: ExportReview = { device: 'iPhone 18 Pro', colorScheme: 'light', dynamicTypeSize: 'large', typeScale: 1, diagnostics: [], screens: [
  { id: 'home', name: 'Home', kind: 'root', width: 1, height: 1, png: screenPng },
  { id: 'detail', name: 'Detail', kind: 'destination', width: 1, height: 1, png: screenPng },
] }

describe('the app name in the files Xcode reads', () => {

  it('is escaped in the scheme, so an app called “Café & Co” still builds', () => {
    const entries = entriesOf(exportArchive(named('Café & Co'), { format: 'xcodeproj', now: NOW }).bytes)

    const scheme = entries['Café & Co/Café & Co.xcodeproj/xcshareddata/xcschemes/Café & Co.xcscheme']
    expect(scheme).toContain('BuildableName = "Café &amp; Co.app"')
    expect(scheme).not.toMatch(/&(?!amp;)/)
  })

  it('is quoted in the XcodeGen spec, so YAML reads “Notes #2” as the name and not as a comment', () => {
    const entries = entriesOf(exportArchive(named('Notes #2'), { format: 'xcodegen', now: NOW }).bytes)

    const spec = entries['Notes #2/project.yml']
    expect(spec).toContain('name: "Notes #2"\n')
    expect(spec).toContain('\n  "Notes #2":\n    type: application\n')
  })

  it('names the bundle after the app as it is called now, not as it was first called', () => {
    // Created as MyDesignApp, renamed since.
    const entries = entriesOf(exportArchive(named('Café & Co'), { format: 'xcodeproj', now: NOW }).bytes)

    expect(entries['Café & Co/Café & Co.xcodeproj/project.pbxproj']).toMatch(/PRODUCT_BUNDLE_IDENTIFIER = "?com\.example\.Cafe-Co"?;/)
  })

  it('gives an app whose stored identifier Xcode would refuse one it takes, and builds it', () => {
    // Opened from files whose @main type is My_App: identifiers may not hold underscores.
    const base = named('My_App'), project = { ...base, manifest: { ...base.manifest, bundleId: 'com.example.My_App' } }

    const archive = exportArchive(project, { format: 'xcodeproj', now: NOW })

    expect(archive.issues).toEqual([])
    expect(entriesOf(archive.bytes)['My_App/My_App.xcodeproj/project.pbxproj']).toMatch(/PRODUCT_BUNDLE_IDENTIFIER = "?com\.example\.My-App"?;/)
  })
})

/** A screen with a switched-off modifier and a hidden view, as the Design panel leaves them. */
const MARKED = `import SwiftUI

struct HomeScreen: View {
    var body: some View {
        VStack {
            Text("Shown")
                /*studio-off:1 ".background(Color.blue)"*/
                .padding()
            // hidden by Swift Web Studio
            // Text("Secret")
            //     .bold()
            // end hidden view
        }
    }
}
`
/** The same screen as Xcode should get it. */
const CLEAN = `import SwiftUI

struct HomeScreen: View {
    var body: some View {
        VStack {
            Text("Shown")
                .padding()
        }
    }
}
`

describe('the studio’s markers', () => {

  it('stay out of the Swift that Xcode builds', () => {
    const project = withHome(MARKED), root = project.manifest.name

    const entries = entriesOf(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)

    expect(entries[`${root}/${root}/Features/Home/HomeScreen.swift`]).toBe(CLEAN)
    for (const format of ['swiftpm', 'spm', 'xcodegen'] as const) {
      const swift = Object.entries(entriesOf(exportArchive(project, { format, now: NOW }).bytes)).filter(([path]) => path.endsWith('.swift'))
      expect(swift.filter(([, text]) => /studio-off|hidden by Swift Web Studio|end hidden view/.test(text))).toEqual([])
    }
  })

  it('are only taken from comments: the same words inside a string are the app’s text', () => {
    const root = createDefaultProject(0).manifest.name
    const text = `import SwiftUI

struct HomeScreen: View {
    let help = """
        // hidden by Swift Web Studio
        """
    var body: some View {
        Text(#"/*studio-off:1 ".bold()"*/"#)
    }
}
`
    const project = withHome(text)

    const entries = entriesOf(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)

    expect(entries[`${root}/${root}/Features/Home/HomeScreen.swift`]).toBe(text)
  })

  it('leave a person’s own comments alone, even between an old hidden view with no end line and the next one', () => {
    const root = createDefaultProject(0).manifest.name
    const text = `import SwiftUI

struct HomeScreen: View {
    var body: some View {
        VStack {
            // hidden by Swift Web Studio
            // Text("Old")
            // Check the copy with Dana.
            // hidden by Swift Web Studio
            // Text("New")
            // end hidden view
            Text("Shown")
        }
    }
}
`
    const project = withHome(text)

    const swift = entriesOf(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)[`${root}/${root}/Features/Home/HomeScreen.swift`]

    expect(swift).toContain('// Check the copy with Dana.')
    expect(swift).not.toContain('Text("New")')
  })

  it('take only the marker line of an old hidden view, which has no end line to say where it stops', () => {
    const root = createDefaultProject(0).manifest.name
    const home = (lines: string) => `import SwiftUI\n\nstruct HomeScreen: View {\n    var body: some View {\n        VStack {\n${lines}            Text("Shown")\n        }\n    }\n}\n`
    const project = withHome(home('            // hidden by Swift Web Studio\n            // Text("Old")\n'))

    const swift = entriesOf(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)[`${root}/${root}/Features/Home/HomeScreen.swift`]

    expect(swift).toBe(home('            // Text("Old")\n'))
  })

  it('keep a file’s Windows line endings, on the lines they empty and the lines they share', () => {
    const root = createDefaultProject(0).manifest.name
    const crlf = (text: string) => text.replace(/\n/g, '\r\n')
    const shared = (text: string) => text.replace('Text("Shown")', 'Text("Shown") /*studio-off:1 ".bold()"*/')
    const project = withHome(crlf(shared(MARKED)))

    const swift = entriesOf(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)[`${root}/${root}/Features/Home/HomeScreen.swift`]

    expect(swift).toBe(crlf(CLEAN))
  })

  it('stay in what the studio reopens: the editable archive and each export’s project record', () => {
    const project = withHome(MARKED), root = project.manifest.name

    const editable = entriesOf(exportArchive(project, { format: 'editable', now: NOW }).bytes)
    const record = JSON.parse(entriesOf(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)[`${root}/.swiftstudio/project.json`]!)

    expect(Object.entries(editable).find(([path]) => path.endsWith('HomeScreen.swift'))?.[1]).toBe(MARKED)
    expect(record.sources.find((source: { id: string }) => source.id.endsWith('HomeScreen.swift')).base).toBe(MARKED)
  })
})

describe('reopening an Xcode export', () => {
  const homeScreen = (project: Project | null | undefined) => project?.files.find(file => file.id.endsWith('HomeScreen.swift'))?.text

  it('brings back the hidden views and switched-off modifiers its Swift left out', () => {
    const reopened = readProjectArchive(exportArchive(withHome(MARKED), { format: 'xcodeproj', now: NOW }).bytes)

    expect(homeScreen(reopened.project)).toBe(MARKED)
  })

  it('keeps a file as Xcode left it when a developer changed it there', () => {
    const project = withHome(MARKED), root = project.manifest.name
    const entries = unzipSync(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)
    const edited = CLEAN.replace('"Shown"', '"Changed in Xcode"')
    entries[`${root}/${root}/Features/Home/HomeScreen.swift`] = new TextEncoder().encode(edited)

    const reopened = readProjectArchive(zipSync(entries))

    expect(homeScreen(reopened.project)).toBe(edited)
  })
})

describe('the archive’s name', () => {
  it('says which app, when it was made and what it holds, so one person’s exports never share a name', () => {
    const project = named('Café & Co')

    const names = (['complete', 'xcodeproj', 'swiftpm', 'spm', 'xcodegen', 'editable'] as const).map(format => exportArchive(project, { format, now: NOW }).name)

    expect(names).toEqual([
      'Café-Co-20260924-1630-complete.zip',
      'Café-Co-20260924-1630-xcodeproj.zip',
      'Café-Co-20260924-1630-swiftpm.zip',
      'Café-Co-20260924-1630-package.zip',
      'Café-Co-20260924-1630-xcodegen.zip',
      'Café-Co-20260924-1630.swiftstudio.zip',
    ])
  })

  it('keeps a name written in any script, and gives each such app a bundle identifier of its own', () => {
    const [cafe, bakery] = [named('카페'), named('パン屋')]

    const archives = [cafe, bakery].map(project => exportArchive(project, { format: 'xcodeproj', now: NOW }))

    expect(archives.map(archive => archive.name)).toEqual(['카페-20260924-1630-xcodeproj.zip', 'パン屋-20260924-1630-xcodeproj.zip'])
    const ids = archives.map((archive, index) => /PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/.exec(entriesOf(archive.bytes)[`${[cafe, bakery][index]!.manifest.name}/${[cafe, bakery][index]!.manifest.name}.xcodeproj/project.pbxproj`]!)![1])
    expect(ids[0]).not.toBe(ids[1])
    expect(ids.every(id => /^com\.example\.[A-Za-z0-9-]+$/.test(id!))).toBe(true)
  })
})

describe('the complete bundle', () => {
  it('hands over the Xcode project and report when no screen could be captured, and says so', () => {
    const project = createDefaultProject(0), root = project.manifest.name

    const archive = exportArchive(project, { format: 'complete', review: { ...review, screens: [] }, now: NOW })

    const entries = entriesOf(archive.bytes)
    expect(entries[`${root}/${root}.xcodeproj/project.pbxproj`]).toBeDefined()
    expect(archive.issues).toEqual(['No screen images were captured.'])
    expect(entries[`${root}/Studio Report/report.md`]).toContain('No screen images were captured.')
  })

  it('keeps the Xcode project, the report and the screens that fit when all of them would pass 60 MB', () => {
    const project = createDefaultProject(0), root = project.manifest.name
    const screens = Array.from({ length: 17 }, (_, index) => ({ ...review.screens[0]!, id: `s${index}`, name: `Screen ${index + 1}`, png: new Uint8Array(3.9 * 1024 * 1024) }))

    const archive = exportArchive(project, { format: 'complete', review: { ...review, screens }, now: NOW })

    const entries = unzipSync(archive.bytes)
    expect(entries[`${root}/${root}.xcodeproj/project.pbxproj`]).toBeDefined()
    expect(entries[`${root}/Studio Report/report.md`]).toBeDefined()
    const kept = Object.keys(entries).filter(path => path.endsWith('.png')).length
    expect(kept).toBeGreaterThan(0)
    expect(archive.issues).toHaveLength(17 - kept)
    expect(archive.issues[0]).toBe(`The image of Screen ${kept + 1} was left out, to keep the archive under 60 MB.`)
  })

  it('leaves out a screen image over the size limit and keeps the others', () => {
    const project = createDefaultProject(0), root = project.manifest.name
    const huge = { ...review.screens[0]!, png: new Uint8Array(4 * 1024 * 1024 + 1) }

    const archive = exportArchive(project, { format: 'complete', review: { ...review, screens: [huge, review.screens[1]!] }, now: NOW })

    expect(Object.keys(unzipSync(archive.bytes)).filter(path => path.endsWith('.png'))).toEqual([`${root}/Studio Report/Screens/001-Detail.png`])
    expect(archive.issues).toEqual(['The image of Home was over 4 MB, so it was left out.'])
  })
})

describe('an export never fails', () => {
  it('still hands over the Swift of a project that does not validate, and says why', () => {
    const base = createDefaultProject(0)
    // Storage that went wrong somewhere: the image's recorded size no longer matches its bytes.
    const project: Project = { ...base, assets: [{ id: 'logo', name: 'Logo', scale: 1, light: { ...readImage(PNG), width: readImage(PNG).width + 1 } }] }

    const archive = exportArchive(project, { format: 'xcodeproj', now: NOW })

    const entries = entriesOf(archive.bytes)
    for (const file of project.files) expect(Object.entries(entries).find(([path]) => path.endsWith(file.id))?.[1]).toBe(file.text)
    expect(archive.issues).toEqual([expect.stringContaining('Image metadata does not match its bytes')])
    expect(Object.entries(entries).find(([path]) => path.endsWith('KNOWN-ISSUES.md'))?.[1]).toContain('Image metadata does not match its bytes')
  })

  it('carries everything else the project holds too, so none of the work is lost', () => {
    const base = createDefaultProject(0)
    const chatHistory = [{ id: 'm1', role: 'user' as const, content: 'Make the title blue.', createdAt: 1, provider: 'openai' as const, model: 'example', kind: 'edit' as const }]
    const project: Project = { ...base, chatHistory, assets: [{ id: 'logo', name: 'Logo', scale: 1, light: { ...readImage(PNG), width: readImage(PNG).width + 1 } }] }

    const entries = unzipSync(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)

    const backup = JSON.parse(decoder.decode(Object.entries(entries).find(([path]) => path.endsWith('project-backup.json'))?.[1]))
    expect(backup.project.chatHistory).toEqual(chatHistory)
    expect(Buffer.from(backup.project.assets[0].light.bytes.base64, 'base64')).toEqual(Buffer.from(PNG))
  })

  it('builds the Xcode project of an app with a colour set already named like the accent colour', () => {
    const base = createDefaultProject(0), root = base.manifest.name
    const project: Project = { ...base, colors: [{ name: 'accentcolor', light: '#FF0000' }] }

    const archive = exportArchive(project, { format: 'xcodeproj', now: NOW })

    const entries = entriesOf(archive.bytes)
    expect(archive.issues).toEqual([])
    expect(entries[`${root}/${root}.xcodeproj/project.pbxproj`]).toBeDefined()
    // One set of that name, and it is the app's: the colour it was given.
    const sets = Object.keys(entries).filter(path => /\/accentcolor\.colorset\/Contents\.json$/i.test(path))
    expect(sets.map(path => entries[path])).toEqual([expect.stringMatching(/"red": "0xFF"/)])
  })

  it('leaves the studio’s markers out of the Swift it falls back to, and keeps them in the backup', () => {
    const project: Project = { ...withHome(MARKED), assets: [{ id: 'logo', name: 'Logo', scale: 1, light: { ...readImage(PNG), width: readImage(PNG).width + 1 } }] }

    const entries = entriesOf(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)

    expect(Object.entries(entries).find(([path]) => path.endsWith('HomeScreen.swift'))?.[1]).toBe(CLEAN)
    const backup = JSON.parse(Object.entries(entries).find(([path]) => path.endsWith('project-backup.json'))![1])
    expect(backup.project.files.find((file: { id: string }) => file.id.endsWith('HomeScreen.swift')).text).toBe(MARKED)
  })

  it('keeps every file of a project with unusable paths inside the archive, each under a name of its own', () => {
    const base = createDefaultProject(0)
    const project: Project = { ...base, files: [
      { id: 'Sources/Home.swift', text: '// home' },
      { id: 'Sources/home.swift', text: '// the same name in other letters' },
      { id: '../Outside.swift', text: '// a path that climbs out' },
    ] }

    const entries = entriesOf(exportArchive(project, { format: 'xcodeproj', now: NOW }).bytes)

    const root = `${project.manifest.name}/`
    expect(Object.keys(entries).every(path => path.startsWith(root) && !path.split('/').includes('..'))).toBe(true)
    const swift = Object.entries(entries).filter(([path]) => path.endsWith('.swift'))
    expect(new Set(swift.map(([path]) => path.toLowerCase())).size).toBe(3)
    expect(swift.map(([, text]) => text).sort()).toEqual(['// a path that climbs out', '// home', '// the same name in other letters'])
  })
})
