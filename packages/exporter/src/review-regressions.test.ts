import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { colorSetContents, projectFromFiles, readImage } from '@studio/project-model'
import { exportEditableZip, exportProjectZip, readProjectArchive, zipBundle } from './index'
import { MAX_ARCHIVE_ENTRIES, readArchiveEntries } from './archive-reader'

const png = new Uint8Array(readFileSync(new URL('../../../tests/fixtures/authoring-photo.png', import.meta.url)))
const project = () => projectFromFiles([{ name: 'App.swift', text: 'import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { Image("NewPhoto").foregroundStyle(Color("newColor")) } } }' }])!

it('discovers images and colors added to an Xcode handoff while retaining known asset identity', () => {
  const source = { ...project(), assets: [{ id: 'existing-photo', name: 'OldPhoto', scale: 1 as const, light: readImage(png) }] }
  const entries = readArchiveEntries(exportProjectZip(source))
  const catalog = `${source.manifest.name}/${source.manifest.name}/Assets.xcassets/`
  entries.set(catalog + 'newColor.colorset/Contents.json', new TextEncoder().encode(colorSetContents({ name: 'newColor', light: '#FF0000' })))
  entries.set(catalog + 'NewPhoto.imageset/photo.png', png)
  entries.set(catalog + 'NewPhoto.imageset/Contents.json', new TextEncoder().encode(JSON.stringify({ images: [{ filename: 'photo.png', idiom: 'universal', scale: '1x' }], info: { author: 'xcode', version: 1 } })))
  const imported = readProjectArchive(zipBundle(entries))
  expect(imported.problem).toBeNull()
  expect(imported.project?.colors).toContainEqual({ name: 'newColor', light: '#FF0000' })
  expect(imported.project?.assets?.map(a => a.name)).toEqual(['OldPhoto', 'NewPhoto'])
  expect(imported.project?.assets?.[0]?.id).toBe('existing-photo')
  const reopened = readProjectArchive(exportEditableZip(imported.project!))
  expect(reopened.problem).toBeNull()
  expect(reopened.project?.assets).toEqual(imported.project?.assets)
  expect(reopened.project?.colors).toEqual(imported.project?.colors)
})

it('refuses an unsupported new image set instead of silently discarding it', () => {
  const source = project(), entries = readArchiveEntries(exportProjectZip(source))
  const path = `${source.manifest.name}/${source.manifest.name}/Assets.xcassets/New.imageset/Contents.json`
  entries.set(path, new TextEncoder().encode(JSON.stringify({ images: [{ filename: 'photo.png', idiom: 'iphone', scale: '1x' }] })))
  expect(readProjectArchive(zipBundle(entries)).problem).toContain('universal')
})

it.each(['editable', 'xcode'] as const)('reopens a %s export at the supported source, color, and image counts', format => {
  const source = projectFromFiles(Array.from({ length: 256 }, (_, i) => ({ name: `File${i}.swift`, text: `struct Type${i} {}` })))!
  const full = { ...source,
    colors: Array.from({ length: 256 }, (_, i) => ({ name: `color${i}`, light: '#FF0000' })),
    assets: Array.from({ length: 64 }, (_, i) => ({ id: `photo-${i}`, name: `Photo${i}`, scale: 1 as const, light: readImage(png), dark: readImage(png) })),
  }
  const bytes = format === 'editable' ? exportEditableZip(full) : exportProjectZip(full)
  const imported = readProjectArchive(bytes)
  expect(imported.problem).toBeNull()
  expect(imported.project?.files).toHaveLength(256)
  expect(imported.project?.colors).toHaveLength(256)
  expect(imported.project?.assets).toHaveLength(64)
})

it('still rejects excessive archive entries even when their extensions are ignored', () => {
  const entries = new Map(Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, i) => [`Root/${i}.txt`, new Uint8Array()] as const))
  expect(readProjectArchive(zipBundle(entries)).problem).toContain('too many entries')
})
