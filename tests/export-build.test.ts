import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { TEMPLATES, createProjectFromTemplate } from '@studio/project-model/templates'
import { EXPORT_FORMATS, exportEditableZip, exportProjectZip, readProjectArchive, type ExportReview } from '@studio/exporter'

/**
 * A5: every export names the build that made it, so a study result can be tied to
 * the pinned deployment it came from.
 */

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const project = createProjectFromTemplate(TEMPLATES[0]!, 0)
const BUILD = { commit: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c', builtAt: '2026-10-01T09:00:00.000Z' }

function documentIn(zip: Uint8Array): Record<string, unknown> {
  const entries = unzipSync(zip)
  const path = Object.keys(entries).find(name => name.endsWith('/.swiftstudio/project.json'))!
  return JSON.parse(decoder.decode(entries[path]!)) as Record<string, unknown>
}

describe('A5: exports name the build that made them', () => {
  it('the editable archive records the commit and build time', () => {
    expect(documentIn(exportEditableZip(project, BUILD)).generator).toEqual({ name: 'Swift Web Studio', build: BUILD })
  })

  it.each(EXPORT_FORMATS.map(format => format.id))('the %s export records the commit and build time', (format) => {
    expect(documentIn(exportProjectZip(project, format, { build: BUILD })).generator).toEqual({ name: 'Swift Web Studio', build: BUILD })
  })

  it('the complete export’s report names the build for the people reviewing it', () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDOkAAAAASUVORK5CYII=', 'base64'))
    const review: ExportReview = { device: 'iPhone 18 Pro', colorScheme: 'light', dynamicTypeSize: 'large', typeScale: 1, diagnostics: [], screens: [{ id: 'one', name: 'Home', kind: 'root', width: 1, height: 1, png }] }
    const entries = unzipSync(exportProjectZip(project, 'xcodeproj', { review, build: BUILD }))
    const report = decoder.decode(entries[`${project.manifest.name}/Studio Report/report.md`]!)
    expect(report.split('\n').slice(0, 3)).toEqual([
      `# ${project.manifest.name}: project report`,
      '',
      'Exported by Swift Web Studio build 0f1e2d3 (commit 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c, built 2026-10-01T09:00:00.000Z).',
    ])
  })

  it('reopens an archive that names its build, and leaves the build behind', () => {
    const { project: reopened, handoff } = readProjectArchive(exportEditableZip(project, BUILD))
    expect(reopened!.files).toEqual(project.files)
    expect(reopened!.manifest).toEqual(project.manifest)
    expect(JSON.stringify(reopened)).not.toContain(BUILD.commit)
    expect(JSON.stringify(handoff)).not.toContain(BUILD.commit)
  })
})
