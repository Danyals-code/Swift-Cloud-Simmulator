import { expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { createDefaultProject } from '@studio/project-model/templates'
import { exportProjectZip, readProjectArchive, resolveImport, reviewImport, type ExportReview } from '@studio/exporter'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'

const project = { ...createDefaultProject(), schemaVersion: 1 as const, chatHistory: [
  { id: 'prompt-1', role: 'user' as const, content: 'Make the title blue.', createdAt: 1, provider: 'openai' as const, model: 'example', kind: 'edit' as const, selection: { label: 'Title', file: 'Sources/App.swift', start: 0, end: 10, owner: 'ContentView' } },
  { id: 'reply-1', role: 'assistant' as const, content: 'Made the title blue.', createdAt: 2, provider: 'openai' as const, model: 'example', kind: 'edit' as const, status: 'applied' as const },
] }
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDOkAAAAASUVORK5CYII=', 'base64'))
const review: ExportReview = { device: 'iPhone 15', colorScheme: 'dark', dynamicTypeSize: 'large', typeScale: 1, diagnostics: ['warning: example diagnostic'], screens: [
  { id: 'one', name: '../../Overview', kind: 'root', width: 1, height: 1, png },
  { id: 'two', name: '../../Overview', kind: 'sheet', width: 1, height: 1, png },
] }

it('exports untouched native sources, distinct screen images, defaults and complete conversation', () => {
  const zip = exportProjectZip(project, 'xcodeproj', review), entries = unzipSync(zip), root = project.manifest.name
  const text = (path: string) => new TextDecoder().decode(entries[`${root}/${path}`])
  expect(entries[`${root}/${root}.xcodeproj/project.pbxproj`]).toBeDefined()
  for (const file of project.files) expect(text(`${root}/${file.id.replace(/^Sources\//, '')}`)).toBe(file.text)
  const names = Object.keys(entries).filter(name => name.endsWith('.png'))
  expect(names).toEqual([`${root}/Studio Report/Screens/001-Overview.png`, `${root}/Studio Report/Screens/002-Overview.png`])
  expect(entries[names[0]!]).toEqual(png)
  expect(JSON.parse(text('Studio Report/chat-history.json'))).toEqual(project.chatHistory)
  expect(text('Studio Report/chat-history.md')).toContain('Make the title blue.')
  const settings = JSON.parse(text('Studio Report/settings.json'))
  expect(settings.manifest).toEqual(project.manifest)
  expect(settings.capture).toMatchObject({ colorScheme: 'dark', state: 'App starting content', scale: 2 })
  expect(settings.signing).toEqual({ style: 'Automatic', developmentTeam: null })
  expect(text('Studio Report/report.md')).toContain('warning: example diagnostic')
  expect(text('Studio Report/report.md')).toContain('2 individual screen PNGs')
  const imported = readProjectArchive(zip)
  expect(imported.problem).toBeNull()
  expect(imported.project?.files).toEqual(project.files)
  expect(imported.project?.chatHistory).toEqual(project.chatHistory)
})

it('keeps chat in native and editable metadata and resolves conflicting imported conversations explicitly', () => {
  const imported = readProjectArchive(exportProjectZip(project))
  const incoming = imported.project!, handoff = imported.handoff!
  expect(incoming.chatHistory).toEqual(project.chatHistory)
  const local = { ...project, chatHistory: project.chatHistory.slice(0, 1) }
  expect(reviewImport(local, incoming, handoff).conflicts.map(item => item.key)).toContain('$chatHistory')
  expect(() => resolveImport(local, incoming, handoff, {})).toThrow('every conflict')
  expect(resolveImport(local, incoming, handoff, { $chatHistory: 'incoming' }).chatHistory).toEqual(project.chatHistory)
})

it('does not silently download an incomplete or oversized set of screenshots', () => {
  expect(() => exportProjectZip(project, 'xcodeproj', { ...review, screens: [] })).toThrow('No screen images')
  expect(() => exportProjectZip(project, 'xcodeproj', { ...review, screens: [{ ...review.screens[0]!, png: new Uint8Array(4 * 1024 * 1024 + 1) }] })).toThrow('4 MB')
})

it('captures standalone screens beyond the interactive gallery’s twelve-screen limit', () => {
  resetPipelineState()
  const screens = Array.from({ length: 14 }, (_, index) => ({ view: `Screen${index}`, name: `Screen ${index}` }))
  const text = `import SwiftUI\n@main struct TestApp: App { var body: some Scene { WindowGroup { Text("Home") } } }\n${screens.map(screen => `struct ${screen.view}: View { var body: some View { Text("${screen.name}") } }`).join('\n')}`
  const result = compile({ projectId: 'export-gallery', files: [{ id: 'Sources/App.swift', text }], revision: 1, colorScheme: 'light', canvas: { width: 393, height: 852 }, allPages: true, galleryLimit: 128, designScreens: screens })
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  for (const screen of screens) expect(result.pages?.some(page => page.id === `screen:${screen.view}`)).toBe(true)
})
