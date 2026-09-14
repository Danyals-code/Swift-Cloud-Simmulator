import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { TEMPLATES, createProjectFromTemplate, type Project } from '@studio/project-model'
import { buildExportBundle, exportProjectZip, parsePlist, type PlistDict } from '@studio/exporter'

/**
 * Whole-bundle export conformance.
 *
 * Phase 5 gate 1 — "opens in Xcode and builds with zero edits" — cannot be run here;
 * it needs a Mac. These tests check everything that *can* be checked without one:
 * that the bundle is structurally complete, that the pbxproj parses and its object
 * graph resolves, and that the user's bytes arrive unchanged.
 *
 * The remaining risk is honest and recorded: whether Xcode accepts these particular
 * build settings. Nothing short of Xcode answers that.
 */

const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

function entries(project: Project): Map<string, string> {
  const out = new Map<string, string>()
  for (const [path, bytes] of buildExportBundle(project)) {
    out.set(path, decoder.decode(bytes))
  }
  return out
}

describe.each(TEMPLATES)('exporting template: $name', (template) => {
  const project = createProjectFromTemplate(template, 0)
  const name = project.manifest.name

  it('contains every file Xcode needs to open the project', () => {
    const paths = [...entries(project).keys()]

    // Anything missing here means Xcode either refuses to open the project or opens
    // it in a state that needs manual repair — both of which fail "zero edits".
    for (const required of [
      `${name}/${name}.xcodeproj/project.pbxproj`,
      `${name}/${name}.xcodeproj/project.xcworkspace/contents.xcworkspacedata`,
      `${name}/${name}.xcodeproj/xcshareddata/xcschemes/${name}.xcscheme`,
      `${name}/${name}/Assets.xcassets/Contents.json`,
      `${name}/${name}/Assets.xcassets/AppIcon.appiconset/Contents.json`,
      `${name}/${name}/Assets.xcassets/AccentColor.colorset/Contents.json`,
      `${name}/README.md`,
      `${name}/.gitignore`,
    ]) {
      expect(paths, `missing ${required}`).toContain(required)
    }
  })

  it('places the sources where the project expects them', () => {
    const files = entries(project)
    for (const source of project.files) {
      const expected = `${name}/${name}/${source.id.replace(/^Sources\//, '')}`
      expect(files.get(expected), `${source.id} not at ${expected}`).toBe(source.text)
    }
  })

  it('generates a pbxproj that parses and resolves', () => {
    const pbxproj = entries(project).get(`${name}/${name}.xcodeproj/project.pbxproj`)!
    const root = parsePlist(pbxproj)
    const objects = root.objects as Record<string, PlistDict>

    expect((objects[root.rootObject as string])?.isa).toBe('PBXProject')

    const defined = new Set(Object.keys(objects))
    const referenced = new Set<string>()
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        if (/^[0-9A-F]{24}$/.test(value)) referenced.add(value)
        return
      }
      if (Array.isArray(value)) return value.forEach(walk)
      if (value && typeof value === 'object') Object.values(value).forEach(walk)
    }
    walk(root)

    expect([...referenced].filter((id) => !defined.has(id))).toEqual([])
  })

  it('compiles exactly the project’s Swift files', () => {
    const pbxproj = entries(project).get(`${name}/${name}.xcodeproj/project.pbxproj`)!
    const root = parsePlist(pbxproj)
    const objects = root.objects as Record<string, PlistDict>

    const phase = Object.values(objects).find((o) => o.isa === 'PBXSourcesBuildPhase')!
    const compiled = (phase.files as string[])
      .map((id) => objects[objects[id]!.fileRef as string]!.path as string)
      .sort()

    const expected = project.files
      .filter((f) => f.id.endsWith('.swift'))
      .map((f) => f.id.replace(/^Sources\//, ''))
      .sort()

    expect(compiled).toEqual(expected)
  })

  it('names the same target in the scheme and the project', () => {
    const files = entries(project)
    const scheme = files.get(`${name}/${name}.xcodeproj/xcshareddata/xcschemes/${name}.xcscheme`)!
    const root = parsePlist(files.get(`${name}/${name}.xcodeproj/project.pbxproj`)!)
    const objects = root.objects as Record<string, PlistDict>

    const targetId = Object.entries(objects).find(([, o]) => o.isa === 'PBXNativeTarget')![0]

    // A scheme pointing at a blueprint id the project does not define leaves Xcode
    // with a scheme it cannot run — and the failure is silent until you press Run.
    expect(scheme).toContain(`BlueprintIdentifier = "${targetId}"`)
    expect(scheme).toContain(`BuildableName = "${name}.app"`)
    expect(scheme).toContain(`ReferencedContainer = "container:${name}.xcodeproj"`)
  })

  it('writes valid JSON in every asset catalogue file', () => {
    for (const [path, text] of entries(project)) {
      if (!path.endsWith('Contents.json')) continue
      expect(() => JSON.parse(text), `${path} is not valid JSON`).not.toThrow()
    }
  })

  it('re-exports byte-identically', () => {
    // Reproducibility is what makes an export diffable, and what makes every
    // assertion above a property of the generator rather than of one run.
    expect(exportProjectZip(project)).toEqual(exportProjectZip(project))
  })

  it('round-trips through the zip', () => {
    const unzipped = unzipSync(exportProjectZip(project))
    for (const [path, text] of entries(project)) {
      expect(decoder.decode(unzipped[path]), `${path} differs after zipping`).toBe(text)
    }
  })
})

describe('the exported README', () => {
  const project = createProjectFromTemplate(TEMPLATES[0]!, 0)
  const readme = entries(project).get(`${project.manifest.name}/README.md`)!

  it('says how to build', () => {
    expect(readme).toContain(`open ${project.manifest.name}.xcodeproj`)
    expect(readme).toContain('Cmd+R')
  })

  it('explains the one thing that does need manual setup', () => {
    // Automatic signing with no team builds for Simulator but not for a device.
    // Saying so up front is the difference between "zero edits" being true and
    // feeling like a lie.
    expect(readme).toContain('Signing & Capabilities')
  })

  it('lists the preview approximations', () => {
    for (const topic of ['font', 'SF Symbol', 'blur', 'Scrolling']) {
      expect(readme).toContain(topic)
    }
  })

  it('states the byte-identity guarantee', () => {
    expect(readme).toContain('byte for byte')
  })
})
