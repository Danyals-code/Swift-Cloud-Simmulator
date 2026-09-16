import { describe, expect, it } from 'vitest'
import { isPristine, projectFromFiles, templatesOfKind, withFileText } from './index'
import { createProjectFromTemplate, TEMPLATES, templateById } from './templates'

/**
 * The two questions the welcome sheet asks the model.
 *
 * "Is anything about to be lost" decides whether replacing the project asks first,
 * and "what did the user just hand me" decides whether Open produces a project at
 * all. Both are pure, both are easy to get subtly wrong, and neither is visible in
 * the render tests the rest of the gallery is covered by.
 */

describe('isPristine', () => {
  it.each(TEMPLATES)('is true for $name straight out of the gallery', (template) => {
    expect(isPristine(createProjectFromTemplate(template, 0))).toBe(true)
  })

  it('is false once a single character has been typed', () => {
    const project = createProjectFromTemplate(TEMPLATES[0]!, 0)
    const edited = withFileText(project, project.files[0]!.id, `${project.files[0]!.text}\n`)

    expect(isPristine(edited)).toBe(false)
  })

  it('is true again when an edit is undone back to the original', () => {
    // The reason this compares text rather than tracking a dirty flag: somebody who
    // typed and then deleted it has nothing to lose, and a flag would still nag.
    const project = createProjectFromTemplate(TEMPLATES[0]!, 0)
    const there = withFileText(project, project.files[0]!.id, 'changed')
    const back = withFileText(there, project.files[0]!.id, project.files[0]!.text)

    expect(isPristine(back)).toBe(true)
  })

  it('is false when a file is added, even with every original untouched', () => {
    const project = createProjectFromTemplate(TEMPLATES[0]!, 0)
    const extra = { ...project, files: [...project.files, { id: 'Sources/Extra.swift', text: '' }] }

    expect(isPristine(extra)).toBe(false)
  })
})

describe('the App and Feature split', () => {
  it('puts every template on exactly one side of it', () => {
    expect(templatesOfKind('app').length + templatesOfKind('feature').length).toBe(TEMPLATES.length)
  })

  it('has at least three of each, so neither side is a category of one', () => {
    expect(templatesOfKind('app').length).toBeGreaterThanOrEqual(3)
    expect(templatesOfKind('feature').length).toBeGreaterThanOrEqual(3)
  })

  it('calls an app template one only when it is actually several files', () => {
    for (const template of templatesOfKind('app')) {
      expect(template.files.length, `${template.name} is one file`).toBeGreaterThan(1)
    }
  })

  it('gives every template a tagline distinct from its description', () => {
    for (const template of TEMPLATES) {
      expect(template.tagline.length).toBeGreaterThan(10)
      expect(template.tagline).not.toBe(template.description)
    }
  })
})

describe('projectFromFiles', () => {
  it('builds a project from files off the disk', () => {
    const project = projectFromFiles(
      [
        { name: 'ContentView.swift', text: 'struct ContentView {}' },
        { name: 'Models/Item.swift', text: 'struct Item {}' },
      ],
      1_000,
    )

    expect(project?.files.map((f) => f.id)).toEqual([
      'Sources/ContentView.swift',
      'Sources/Models/Item.swift',
    ])
  })

  it('names the project after the type that declares @main', () => {
    const project = projectFromFiles([
      { name: 'Aaa.swift', text: 'struct Aaa {}' },
      { name: 'Bbb.swift', text: '@main\nstruct TrailheadApp: App {}' },
    ])

    expect(project?.manifest.name).toBe('TrailheadApp')
    expect(project?.manifest.bundleId).toBe('com.example.TrailheadApp')
  })

  it('falls back to the first file name when nothing is @main', () => {
    const project = projectFromFiles([{ name: 'Scratch.swift', text: '// nothing' }])
    expect(project?.manifest.name).toBe('Scratch')
  })

  it('renames around a collision rather than losing a file', () => {
    // Two `View.swift` from two folders is the normal case, not the exotic one.
    const project = projectFromFiles([
      { name: 'View.swift', text: 'a' },
      { name: 'View.swift', text: 'b' },
    ])

    expect(project?.files.map((f) => f.id)).toEqual(['Sources/View.swift', 'Sources/View 2.swift'])
    expect(project?.files.map((f) => f.text)).toEqual(['a', 'b'])
  })

  it('drops anything that is not Swift', () => {
    const project = projectFromFiles([
      { name: 'Info.plist', text: '<plist/>' },
      { name: 'App.swift', text: '@main\nstruct App2: App {}' },
    ])

    expect(project?.files).toHaveLength(1)
  })

  it('refuses a name that would escape the project', () => {
    // The same normaliser every other path uses, so a traversal is rejected here
    // rather than at the point it would be written into an archive.
    expect(projectFromFiles([{ name: '../../evil.swift', text: 'x' }])).toBeNull()
    expect(projectFromFiles([{ name: 'a<b>.swift', text: 'x' }])).toBeNull()
  })

  it('returns null when nothing usable survived', () => {
    expect(projectFromFiles([])).toBeNull()
    expect(projectFromFiles([{ name: 'notes.txt', text: 'x' }])).toBeNull()
  })

  it('round-trips a template through a save and an open', () => {
    // The whole point of the feature: work leaves as an Xcode project, gets edited
    // on a Mac, and comes back.
    const template = templateById('trailhead')!
    const reopened = projectFromFiles(
      template.files.map((file) => ({
        name: file.id.replace(/^Sources\//, ''),
        text: file.text,
      })),
    )

    expect(reopened?.files.map((f) => f.id)).toEqual(template.files.map((f) => f.id))
    expect(reopened?.manifest.name).toBe('TrailheadApp')
    expect(isPristine(reopened!)).toBe(true)
  })
})
