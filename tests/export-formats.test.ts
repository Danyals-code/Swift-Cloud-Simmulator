import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { type Project } from '@studio/project-model'
import { TEMPLATES, createProjectFromTemplate } from '@studio/project-model/templates'
import {
  bundleFor,
  EXPORT_FORMATS,
  exportProjectZip,
  type ExportFormat,
} from '@studio/exporter'

/**
 * The export formats beyond `.xcodeproj` - Phase 9b.
 *
 * Phase 5's gate 2 applies to every one of them: the user's bytes arrive unchanged and
 * the archive is reproducible. Those two are asserted for all four formats by
 * construction rather than per-format, because a format added later must not be able
 * to opt out of them quietly.
 *
 * What cannot be checked here is the same thing Phase 5 could not check: whether
 * Xcode, Swift Playgrounds and XcodeGen actually accept these manifests. That needs
 * the tools, and the risk is recorded rather than papered over.
 */

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
const project: Project = createProjectFromTemplate(TEMPLATES[0]!, 0)
const FORMATS: readonly ExportFormat[] = EXPORT_FORMATS.map((f) => f.id)

function textFiles(format: ExportFormat): Map<string, string> {
  const out = new Map<string, string>()
  for (const [path, bytes] of bundleFor(project, format)) out.set(path, decoder.decode(bytes))
  return out
}

describe.each(FORMATS)('every format: %s', (format) => {
  it('carries every source byte for byte', () => {
    // The guarantee the whole product rests on. A format that reformats, or that drops
    // a file, has broken the one promise the export makes.
    const files = [...textFiles(format).values()]
    for (const source of project.files) {
      expect(files, `${source.id} is missing or altered`).toContain(source.text)
    }
  })

  it('includes every source exactly once', () => {
    const files = [...textFiles(format).values()]
    for (const source of project.files) {
      expect(files.filter((text) => text === source.text)).toHaveLength(1)
    }
  })

  it('re-exports byte-identically, whenever it is run', () => {
    const first = exportProjectZip(project, format)
    const realNow = Date.now
    Date.now = () => realNow() + 5 * 60 * 1000
    try {
      expect(exportProjectZip(project, format)).toEqual(first)
    } finally {
      Date.now = realNow
    }
  })

  it('round-trips through the zip', () => {
    const unzipped = unzipSync(exportProjectZip(project, format))
    for (const [path, text] of textFiles(format)) {
      expect(decoder.decode(unzipped[path]), `${path} differs after zipping`).toBe(text)
    }
  })

  it('gives every path a project-named root', () => {
    for (const path of textFiles(format).keys()) {
      expect(path.startsWith(project.manifest.name), `${path} escapes the root`).toBe(true)
    }
  })

  it('tells the user what the preview approximated', () => {
    const readme = [...textFiles(format).entries()].find(([p]) => p.endsWith('README.md'))?.[1]
    expect(readme, 'every format needs a README').toBeDefined()
    // The stems both wordings share, so the assertion holds across formats without
    // dictating how each README phrases it.
    for (const topic of [/SF Symbol/i, /font/i, /scroll/i]) expect(readme).toMatch(topic)
  })
})

describe('the Swift Playgrounds package', () => {
  const files = textFiles('swiftpm')

  it('puts the .swiftpm extension on the directory', () => {
    // iPadOS treats the *folder* as a document because of the extension, so the zip
    // has to carry it - a `Package.swift` at the root of a plain folder is a library.
    for (const path of files.keys()) {
      expect(path.startsWith(`${project.manifest.name}.swiftpm/`)).toBe(true)
    }
  })

  it('declares an iOS application, not a library', () => {
    const manifest = files.get(`${project.manifest.name}.swiftpm/Package.swift`)!
    expect(manifest).toContain('import AppleProductTypes')
    expect(manifest).toContain('.iOSApplication(')
    expect(manifest).toContain(`bundleIdentifier: "${project.manifest.bundleId}"`)
  })

  it('uses the project’s deployment target', () => {
    const manifest = files.get(`${project.manifest.name}.swiftpm/Package.swift`)!
    expect(manifest).toContain(`.iOS("${project.manifest.deploymentTarget}")`)
  })

  it('says it needs no Mac', () => {
    const readme = files.get(`${project.manifest.name}.swiftpm/README.md`)!
    expect(readme).toContain('Swift Playgrounds')
    expect(readme).toMatch(/no Mac/i)
  })
})

describe('the Swift package', () => {
  const files = textFiles('spm')

  it('declares a library', () => {
    const manifest = files.get(`${project.manifest.name}/Package.swift`)!
    expect(manifest).toContain('.library(')
    expect(manifest).not.toContain('AppleProductTypes')
  })

  it('says plainly that it will not produce a runnable app', () => {
    // SPM cannot build an iOS application bundle. Claiming otherwise in the manifest
    // would hand the user a build failure to diagnose instead of a working project,
    // so the README says so and points at the two formats that can.
    const readme = files.get(`${project.manifest.name}/README.md`)!
    expect(readme).toMatch(/will not produce a runnable app/i)
    expect(readme).toContain('Xcode project')
    expect(readme).toContain('Swift Playgrounds')
  })
})

describe('the XcodeGen spec', () => {
  const files = textFiles('xcodegen')

  it('declares an application target with the project’s bundle id', () => {
    const spec = files.get(`${project.manifest.name}/project.yml`)!
    expect(spec).toContain('type: application')
    expect(spec).toContain(`PRODUCT_BUNDLE_IDENTIFIER: ${project.manifest.bundleId}`)
    expect(spec).toContain(`iOS: "${project.manifest.deploymentTarget}"`)
  })

  it('ignores the project file it generates', () => {
    // The whole point of the format: a committed .xcodeproj is a merge conflict
    // waiting to happen.
    expect(files.get(`${project.manifest.name}/.gitignore`)).toContain('*.xcodeproj/')
  })

  it('names the target after the project', () => {
    const spec = files.get(`${project.manifest.name}/project.yml`)!
    expect(spec).toContain(`name: ${project.manifest.name}`)
    expect(spec).toContain(`  ${project.manifest.name}:`)
  })
})
