import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { emptyStudioMetadata, type Project } from '@studio/project-model'
import { createDefaultProject } from '@studio/project-model/templates'
import { getDevice } from '@studio/sim-shell'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { exportNote, exportProject, type ExportSteps } from './exportProject'

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
