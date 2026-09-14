import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { createDefaultProject, type Project } from '@studio/project-model'
import { buildExportBundle, exportProjectZip, zipFileName } from './index'

/**
 * `ignoreBOM: true` is load-bearing: TextDecoder's *default* is to silently strip a
 * leading U+FEFF, which would make this suite report a BOM-preserving exporter as
 * broken — and, worse, would hide a real BOM-eating bug if one ever appeared
 * upstream. The name reads backwards; it means "treat the BOM as ordinary content".
 */
const decoder = new TextDecoder('utf-8', { ignoreBOM: true })

function projectWith(files: { id: string; text: string }[]): Project {
  const base = createDefaultProject(0)
  return { ...base, files }
}

describe('export byte-identity (FR-7.8)', () => {
  /**
   * This is the guarantee the product is sold on: what you typed is what Xcode
   * compiles. It is cheap to assert and catastrophic to get wrong, so it is tested
   * against content specifically chosen to break naive text handling.
   */
  const hostileContent: { name: string; text: string }[] = [
    { name: 'plain ASCII', text: 'struct A {}\n' },
    { name: 'no trailing newline', text: 'struct A {}' },
    { name: 'CRLF line endings', text: 'struct A {\r\n    var x = 1\r\n}\r\n' },
    { name: 'mixed tabs and spaces', text: 'struct A {\n\tvar x = 1\n    var y = 2\n}\n' },
    { name: 'trailing whitespace', text: 'let a = 1   \nlet b = 2\t\n' },
    { name: 'non-ASCII identifiers and strings', text: 'let café = "naïve — résumé"\n' },
    { name: 'emoji with surrogate pairs', text: 'let wave = "👋🏽 Hello"\n' },
    { name: 'combining marks', text: 'let e = "e\u0301"\n' },
    { name: 'string interpolation and escapes', text: 'Text("a \\(b) \\"c\\" \\\\ \\n")\n' },
    { name: 'raw string delimiters', text: 'let r = #"no \\(escape) here"#\n' },
    { name: 'multiline string literal', text: 'let s = """\n  line one\n  line two\n  """\n' },
    { name: 'empty file', text: '' },
    { name: 'lone newline', text: '\n' },
    { name: 'BOM at start', text: '\uFEFFimport SwiftUI\n' },
  ]

  it.each(hostileContent)('preserves $name exactly through the bundle', ({ text }) => {
    const project = projectWith([{ id: 'Sources/A.swift', text }])
    const bundle = buildExportBundle(project)

    const bytes = bundle.get(`${project.manifest.name}/Sources/A.swift`)
    expect(bytes, 'source file must be present in the bundle').toBeDefined()
    expect(decoder.decode(bytes!)).toBe(text)
  })

  it.each(hostileContent)('preserves $name exactly through the zip', ({ text }) => {
    const project = projectWith([{ id: 'Sources/A.swift', text }])
    const unzipped = unzipSync(exportProjectZip(project))

    expect(decoder.decode(unzipped[`${project.manifest.name}/Sources/A.swift`])).toBe(text)
  })

  it('exports every file in the project', () => {
    const project = projectWith([
      { id: 'Sources/App.swift', text: '// app\n' },
      { id: 'Sources/ContentView.swift', text: '// view\n' },
      { id: 'Sources/Models/Item.swift', text: '// model\n' },
    ])
    const unzipped = unzipSync(exportProjectZip(project))
    const root = project.manifest.name

    for (const file of project.files) {
      expect(unzipped[`${root}/${file.id}`], `${file.id} missing from zip`).toBeDefined()
    }
  })

  it('produces a byte-identical zip for an unchanged project', () => {
    // Reproducible exports make the output diffable and this suite meaningful.
    const project = createDefaultProject(0)
    expect(exportProjectZip(project)).toEqual(exportProjectZip(project))
  })

  it('includes a README alongside the sources', () => {
    const project = createDefaultProject(0)
    const unzipped = unzipSync(exportProjectZip(project))
    const readme = decoder.decode(unzipped[`${project.manifest.name}/README.md`])

    expect(readme).toContain(project.manifest.bundleId)
    expect(readme).toContain('byte for byte')
  })
})

describe('zipFileName', () => {
  it('uses the project name', () => {
    expect(zipFileName(createDefaultProject(0))).toBe('CounterApp.zip')
  })

  it('strips characters that are illegal in filenames', () => {
    const base = createDefaultProject(0)
    const project = { ...base, manifest: { ...base.manifest, name: 'My App/v2: "final"' } }
    expect(zipFileName(project)).toBe('My-App-v2---final-.zip')
  })
})
