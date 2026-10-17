import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { emptyStudioMetadata, readImage, type Project } from '@studio/project-model'
import { exportArchive } from '@studio/exporter'
import { createDefaultProject } from '@studio/project-model/templates'
import { getDevice } from '@studio/sim-shell'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { STUDIO_BUILD } from './build'
import { exportNote, exportProject, usedLibraryNames, type ExportSteps } from './exportProject'

/**
 * Exporting, as the Export button runs it.
 *
 * The preview compiler is the real one, run here rather than in a worker; drawing a
 * screen and handing a file to the browser are stand-ins, since only a browser can.
 */

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDOkAAAAASUVORK5CYII=', 'base64'))
const PREVIEW = { colorScheme: 'light' as const, dynamicTypeSize: 'large' as const, typeScale: 1 }
const LOG = '{"format":"swift-web-studio-events","version":1}\n'

/** A blank design whose home screen is `body`. */
function app(body: string): Project {
  const base = createDefaultProject(0)
  const home = `import SwiftUI\n\nstruct HomeScreen: View {\n    var body: some View {\n        ${body}\n    }\n}\n`
  return { ...base, files: base.files.map(file => file.id.endsWith('HomeScreen.swift') ? { ...file, text: home } : file) }
}

function browser(instead: Partial<ExportSteps> = {}) {
  const downloads: { name: string; bytes: Uint8Array }[] = []
  const steps: ExportSteps = {
    save: async () => {},
    compile: async project => {
      const device = getDevice(project.manifest.device)
      return compile({ projectId: project.id, files: project.files, revision: 1, canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', allPages: true, galleryLimit: 128, designScreens: project.studio?.screens })
    },
    capture: async () => PNG,
    events: async () => ({ text: LOG, partial: false }),
    download: (name, bytes) => { downloads.push({ name, bytes }) },
    ...instead,
  }
  return { steps, downloads }
}

function inside(bytes: Uint8Array) {
  const entries = unzipSync(bytes)
  const text = (end: string) => Object.entries(entries).filter(([path]) => path.endsWith(end)).map(([, data]) => new TextDecoder().decode(data))
  return {
    screens: Object.keys(entries).filter(path => path.endsWith('.png')),
    report: text('Studio Report/report.md')[0] ?? '',
    logs: text('.swiftstudio/events.jsonl'),
  }
}

beforeEach(() => resetPipelineState())
afterEach(() => { vi.useRealTimers() })

describe('the Export button', () => {
  it('still downloads the project while its code has an error, and the report says why no screen is in it', async () => {
    const project = app('Text("Hello"')
    const { steps, downloads } = browser()

    const outcome = await exportProject(project, 'complete', PREVIEW, steps)

    expect(downloads.map(download => download.name)).toEqual([expect.stringMatching(/-complete\.zip$/)])
    const { screens, report } = inside(downloads[0]!.bytes)
    expect(screens).toEqual([])
    expect(report).toMatch(/## Known issues\n\n- The preview has 1 error, so no screen could be drawn: /)
    expect(outcome.issues).toEqual([expect.stringContaining('The preview has 1 error'), 'No screen images were captured.'])
  })

  it('gives up on a preview that never answers, and downloads the project without screens', async () => {
    vi.useFakeTimers()
    const project = app('Text("Hello")')
    const { steps, downloads } = browser({ compile: () => new Promise(() => {}) })

    const exporting = exportProject(project, 'complete', PREVIEW, steps)
    await vi.advanceTimersByTimeAsync(60_000)
    const outcome = await exporting

    expect(downloads).toHaveLength(1)
    expect(outcome.issues).toEqual(['The preview could not be drawn, so no screen is in this export: it took too long', 'No screen images were captured.'])
  })

  it('keeps the other screens when one cannot be drawn, and names that one in the report', async () => {
    const project = app('NavigationStack { List { NavigationLink("Details") { Text("More") } }.navigationTitle("Home") }')
    const { steps, downloads } = browser({ capture: async page => { if (page.kind !== 'root') throw new Error('the browser would not draw it'); return PNG } })

    const outcome = await exportProject(project, 'complete', PREVIEW, steps)

    expect(inside(downloads[0]!.bytes).screens).toEqual([expect.stringMatching(/Screens\/001-Home\.png$/)])
    expect(outcome.issues).toEqual([expect.stringMatching(/^The image of .+ could not be made: the browser would not draw it$/)])
  })

  it('lists a saved screen that nothing draws any more, and exports the rest', async () => {
    const base = app('Text("Hello")')
    // Renamed in Code since it was saved as a screen.
    const project = { ...base, studio: { ...emptyStudioMetadata(), screens: [{ view: 'GoneScreen', name: 'Gone' }] } }
    const { steps, downloads } = browser()

    const outcome = await exportProject(project, 'complete', PREVIEW, steps)

    expect(inside(downloads[0]!.bytes).screens).toHaveLength(1)
    expect(outcome.issues).toEqual(['Gone is not in this export: nothing in the app draws it any more.'])
  })

  it('does not wait on a save that never finishes', async () => {
    vi.useFakeTimers()
    const project = app('Text("Hello")')
    const { steps, downloads } = browser({ save: () => new Promise(() => {}) })

    const exporting = exportProject(project, 'xcodeproj', PREVIEW, steps)
    await vi.advanceTimersByTimeAsync(5_000)
    await exporting

    expect(downloads.map(download => download.name)).toEqual([expect.stringMatching(/-xcodeproj\.zip$/)])
  })

  it('puts the project’s event log in the archive, asked for as this export', async () => {
    const project = app('Text("Hello")'), asked: unknown[] = []
    const { steps, downloads } = browser({ events: async (id, format) => { asked.push([id, format]); return { text: LOG, partial: false } } })

    await exportProject(project, 'xcodeproj', PREVIEW, steps)

    expect(asked).toEqual([[project.id, 'xcodeproj']])
    expect(inside(downloads[0]!.bytes).logs).toEqual([LOG])
  })

  it('goes without an event log that cannot be read in time, saying so only in the report: the log is the study’s, not the designer’s', async () => {
    vi.useFakeTimers()
    const project = app('Text("Hello")')
    const { steps, downloads } = browser({ events: () => new Promise(() => {}) })

    const exporting = exportProject(project, 'complete', PREVIEW, steps)
    await vi.advanceTimersByTimeAsync(60_000)
    const outcome = await exporting

    const { logs, report } = inside(downloads[0]!.bytes)
    expect(logs).toEqual([])
    expect(report).toContain('- The studio’s event log could not be read, so events.jsonl is not in this export.')
    expect(outcome.issues).toEqual([])
    expect(exportNote('complete', outcome)).toBe(`Exported ${outcome.name} with 1 screen image, the report and the chat history.`)
  })

  it('says in the report, and only there, when the log holds only this session’s events', async () => {
    const project = app('Text("Hello")')
    const { steps, downloads } = browser({ events: async () => ({ text: LOG, partial: true }) })

    const outcome = await exportProject(project, 'complete', PREVIEW, steps)

    const { logs, report } = inside(downloads[0]!.bytes)
    expect(logs).toEqual([LOG])
    expect(report).toContain('- The studio’s event log could not be read in full, so events.jsonl holds only the events of the session that exported it.')
    expect(outcome.issues).toEqual([])
  })
})

/** A library image's bytes as the studio serves them. */
const served = (name: string) => new Uint8Array(readFileSync(new URL(`../public/library/v1/${name}.jpg`, import.meta.url)))
/** A design whose Swift files are `texts`, one each. */
function swift(...texts: string[]): Project {
  const base = createDefaultProject(0)
  return { ...base, files: texts.map((text, i) => ({ id: `Sources/File${i}.swift`, text })) }
}

describe('the library images an export needs (Wave 7b)', () => {
  it('finds library names written as whole string literals, wherever the code keeps them', () => {
    const project = swift(
      'struct Trail { let photo: String }\nlet trails = [Trail(photo: "snowy-peak"), Trail(photo: "giant-redwoods")]',
      'import SwiftUI\nstruct Row: View { var body: some View { Text("Look \\(Image("sea-tram")) here") } }',
      'import SwiftUI\nstruct Hero: View { var body: some View { Image("red-bus-bridge").resizable() } }',
    )
    expect(usedLibraryNames(project)).toEqual(['giant-redwoods', 'sea-tram', 'red-bus-bridge', 'snowy-peak'])
  })

  it('ignores comments, other spellings, longer strings and names built at runtime', () => {
    const project = swift([
      '// Image("blue-mosaic")',
      '/* Image("arch-view") */',
      'let a = "Snowy-Peak"',
      'let b = "snowy-peak 2"',
      'let c = "portrait-\\(n)"',
      'let d = "sea-tram.jpg"',
    ].join('\n'))
    expect(usedLibraryNames(project)).toEqual([])
  })

  it('leaves out a library image the project’s own images shadow, an older project’s other letter case included, so the catalog never holds both', () => {
    const own = { id: 'own', name: 'Snowy-Peak', scale: 1 as const, light: readImage(served('blue-mosaic')) }
    const project = { ...swift('let a = "snowy-peak"; let b = "sea-tram"'), assets: [own] }
    expect(usedLibraryNames(project)).toEqual(['sea-tram'])
  })
})

describe('exporting a design that uses library images', () => {
  it('downloads only the library images the code uses and puts them in the catalog at 3x', async () => {
    const project = app('VStack { Image("snowy-peak"); Image("sea-tram") }'), asked: string[] = []
    const { steps, downloads } = browser({ library: async name => { asked.push(name); return served(name) } })

    await exportProject(project, 'xcodeproj', PREVIEW, steps)

    expect(asked).toEqual(['sea-tram', 'snowy-peak'])
    const entries = unzipSync(downloads[0]!.bytes)
    const sets = Object.keys(entries).filter(path => path.endsWith('.imageset/Contents.json')).map(path => path.split('/').at(-2))
    expect(sets.sort()).toEqual(['sea-tram.imageset', 'snowy-peak.imageset'])
    const [, handoff] = Object.entries(entries).find(([path]) => path.endsWith('.swiftstudio/project.json'))!
    expect(JSON.parse(new TextDecoder().decode(handoff))).toMatchObject({ assets: [], library: ['sea-tram', 'snowy-peak'] })
  })

  it('stops with a clear message, and downloads nothing, when a library image cannot be downloaded', async () => {
    const project = app('Image("snowy-peak")')
    const { steps, downloads } = browser({ library: async () => { throw new TypeError('Failed to fetch') } })

    await expect(exportProject(project, 'xcodeproj', PREVIEW, steps)).rejects.toThrow('Couldn’t download the library image “snowy-peak”. Check your connection and export again.')
    expect(downloads).toEqual([])
  })

  it('exports a design that uses no library image exactly as before, asking for none', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 17, 12, 0))
    const project = app('Text("Hello")')
    const { steps, downloads } = browser({ library: async () => { throw new Error('not asked') } })

    await exportProject(project, 'xcodeproj', PREVIEW, steps)

    const expected = exportArchive(project, { format: 'xcodeproj', build: STUDIO_BUILD, events: LOG, now: new Date() })
    expect(Buffer.from(downloads[0]!.bytes).equals(Buffer.from(expected.bytes))).toBe(true)
  })
})
