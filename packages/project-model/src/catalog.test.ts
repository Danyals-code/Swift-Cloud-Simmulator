import { describe, expect, it } from 'vitest'
import { STARTER_TEMPLATE_ID, TEMPLATE_CATALOG, templateInfoById, templatesOfKind } from './index'
import { TEMPLATES, templateById } from './templates'

/**
 * The seam between the two halves of the gallery.
 *
 * The metadata lives in `catalog.ts` and is in the initial bundle; the Swift lives in
 * `templates.ts` and is loaded when somebody presses Create. That split is what keeps
 * 31 KB gzipped out of the first paint, and it is also a chance for the two lists to
 * disagree - a template added to one and forgotten in the other would half-exist: a
 * card in the sheet that creates an empty project, or a project nobody can reach.
 *
 * Every assertion here exists to make that impossible rather than unlikely.
 */

describe('the catalog and the sources', () => {
  it('lists exactly the same templates, in the same order', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(TEMPLATE_CATALOG.map((t) => t.id))
  })

  it('gives every catalog entry the files it promises', () => {
    for (const info of TEMPLATE_CATALOG) {
      const template = templateById(info.id)
      expect(template, `${info.name} has no sources`).toBeDefined()
      expect(template!.files.map((f) => f.id), `${info.name} file list`).toEqual(info.files)
    }
  })

  it('has no template with an empty file list', () => {
    // The failure mode the map lookup makes possible: a missing key answers `[]`,
    // which would produce a card that creates a project with nothing in it.
    for (const template of TEMPLATES) {
      expect(template.files.length, `${template.name} lays down nothing`).toBeGreaterThan(0)
    }
  })

  it('carries the metadata through unchanged', () => {
    for (const info of TEMPLATE_CATALOG) {
      const template = templateById(info.id)!
      expect(template.name).toBe(info.name)
      expect(template.kind).toBe(info.kind)
      expect(template.tagline).toBe(info.tagline)
      expect(template.description).toBe(info.description)
    }
  })

  it('has unique ids and names', () => {
    expect(new Set(TEMPLATE_CATALOG.map((t) => t.id)).size).toBe(TEMPLATE_CATALOG.length)
    expect(new Set(TEMPLATE_CATALOG.map((t) => t.name)).size).toBe(TEMPLATE_CATALOG.length)
  })

  it('names a starter that exists', () => {
    expect(templateInfoById(STARTER_TEMPLATE_ID)).toBeDefined()
    expect(templateById(STARTER_TEMPLATE_ID)).toBeDefined()
  })

  it('splits every template onto exactly one side', () => {
    expect(templatesOfKind('app').length + templatesOfKind('feature').length).toBe(
      TEMPLATE_CATALOG.length,
    )
  })

  /**
   * The reason the split exists at all.
   *
   * If the catalog ever grew a `text` field, or the file lists started carrying
   * source, the whole corpus would be back in the initial chunk and nothing would
   * say so until someone read a bundle report. A rough size ceiling is a cruder
   * check than measuring the build, and it fails in the right place.
   */
  it('stays small enough to be worth splitting out', () => {
    const bytes = JSON.stringify(TEMPLATE_CATALOG).length
    expect(bytes, `the catalog is ${bytes} bytes`).toBeLessThan(12_000)
  })
})
