import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { projectFromFiles } from '@studio/project-model'
import { TEMPLATES, createProjectFromTemplate, templateById } from '@studio/project-model/templates'
import { EXPORT_FORMATS, type ExportFormat } from './formats'
import { bundleFor, exportProjectZip, zipBundle } from './index'
import { readProjectArchive } from './import'

/**
 * The round trip, closed.
 *
 * Export has always written a `.zip` and Open has only ever taken loose `.swift`
 * files, so the workflow the whole product is built around - author here, build on a
 * Mac, come back - had an unzip step in the middle that nothing in the studio did.
 *
 * These are the assertions that matter: every format comes back, the bytes are the
 * user's own, the folder structure survives, and an archive built to be hostile is
 * refused rather than unpacked.
 */

const trailhead = createProjectFromTemplate(TEMPLATES.find((t) => t.id === 'trailhead')!, 0)

describe.each(EXPORT_FORMATS.map((f) => f.id))('a %s export', (format: ExportFormat) => {
  const archive = readProjectArchive(exportProjectZip(trailhead, format))

  it('comes back with every source file', () => {
    expect(archive.problem).toBeNull()
    expect(archive.files).toHaveLength(trailhead.files.length)
  })

  it('reopens as the project that was exported', () => {
    const reopened = projectFromFiles(archive.files, 0)

    expect(reopened).not.toBeNull()
    expect(reopened!.manifest.name).toBe(trailhead.manifest.name)
    expect([...reopened!.files].map((f) => f.id).sort()).toEqual(
      [...trailhead.files].map((f) => f.id).sort(),
    )
  })

  it('carries every byte of the user’s Swift unchanged', () => {
    const reopened = projectFromFiles(archive.files, 0)!
    for (const original of trailhead.files) {
      const mine = reopened.files.find((f) => f.id === original.id)
      expect(mine?.text, original.id).toBe(original.text)
    }
  })
})

describe('an archive that is not one of ours', () => {
  it('reads a flat archive of Swift files', () => {
    const archive = readProjectArchive(
      zipSync({ 'MyApp/ContentView.swift': encode('struct A {}') }),
    )
    expect(archive.files).toEqual([{ name: 'ContentView.swift', text: 'struct A {}' }])
  })

  it('keeps the folders below Sources and drops everything above it', () => {
    const archive = readProjectArchive(
      zipSync({ 'App/App/Sources/Models/Item.swift': encode('struct Item {}') }),
    )
    expect(archive.files[0]?.name).toBe('Models/Item.swift')
  })

  it('rejects a traversal archive without importing any files', () => {
    // Belt and braces: the project model's normaliser would reject it too, but an
    // archive is a stranger's bytes and should never get as far as being a path.
    const archive = readProjectArchive(
      zipSync({ 'App/Sources/../../../etc/Evil.swift': encode('struct Evil {}') }),
    )
    expect(archive.files).toEqual([])
    expect(archive.problem).toContain('unsafe path')
  })

  it('ignores everything that is not Swift', () => {
    const archive = readProjectArchive(
      zipSync({
        'App/Info.plist': encode('<plist/>'),
        'App/Assets.xcassets/Contents.json': encode('{}'),
        'App/Sources/App.swift': encode('@main struct A: App {}'),
      }),
    )
    expect(archive.files).toHaveLength(1)
  })

  it('says so when there is no Swift at all', () => {
    const archive = readProjectArchive(zipSync({ 'App/README.md': encode('# hello') }))
    expect(archive.files).toHaveLength(0)
    expect(archive.problem).toMatch(/no \.swift/)
  })

  it('says so when the bytes are not a zip', () => {
    const archive = readProjectArchive(encode('not an archive at all, just text'))
    expect(archive.files).toHaveLength(0)
    expect(archive.problem).toMatch(/not a readable zip/)
  })

  it('refuses an archive with an absurd number of entries', () => {
    const many: Record<string, Uint8Array> = {}
    for (let i = 0; i < 600; i++) many[`App/Sources/F${i}.swift`] = encode('//')

    const archive = readProjectArchive(zipSync(many))
    expect(archive.files).toHaveLength(0)
    expect(archive.problem).toMatch(/too many/)
  })

  it('refuses more Swift than a project could hold', () => {
    const huge: Record<string, Uint8Array> = {}
    for (let i = 0; i < 20; i++) huge[`App/Sources/F${i}.swift`] = encode('x'.repeat(600_000))

    const archive = readProjectArchive(zipSync(huge))
    expect(archive.files).toHaveLength(0)
    expect(archive.problem).toMatch(/more Swift/)
  })
})

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** A zip as a developer's repo would hold it: no studio handoff inside. */
const plainArchive = (name: string, format: 'xcodeproj' | 'swiftpm' | 'xcodegen') => {
  const project = createProjectFromTemplate(templateById('blank')!)
  return zipBundle(bundleFor({ ...project, manifest: { ...project.manifest, name } }, format))
}

it('keeps the project\u2019s own folders when the project is named after one', () => {
  for (const format of ['xcodeproj', 'swiftpm', 'xcodegen'] as const) {
    for (const name of ['MyDesignApp', 'App']) {
      const read = readProjectArchive(plainArchive(name, format))
      expect(read.problem, `${name} ${format}`).toBeNull()
      expect(read.files.map(file => file.name).sort(), `${name} ${format}`).toEqual(['App/MyDesignApp.swift', 'Features/Home/HomeScreen.swift'])
    }
  }
})
