import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { applyProjectTransaction, DocumentHistory, imageDataURL, projectFromFiles, readImage } from '@studio/project-model'
import { exportProjectZip } from '@studio/exporter'
import { importedImageName, imageViewSnippet } from '../apps/web/lib/images'
import { searchCatalog } from '../apps/web/lib/viewCatalog'
import { sourceLayerType } from '../apps/web/lib/sourceLayers'

beforeEach(resetPipelineState)
it('distinguishes photos, symbols and all three stack directions, by Figma\'s words and Swift\'s (D3)', () => {
  expect(searchCatalog('row')[0]?.name).toBe('Row')
  expect(searchCatalog('column')[0]?.name).toBe('Column')
  expect(searchCatalog('overlap')[0]?.name).toBe('Overlap')
  expect(searchCatalog('zstack')[0]?.name).toBe('Overlap')
  expect(searchCatalog('vertical stack')[0]?.name).toBe('Column')
  expect(searchCatalog('symbols')[0]?.name).toBe('Symbols')
  expect(searchCatalog('images')[0]?.action).toBe('image')
})
it('assigns valid unique names without case or Unicode collisions', () => {
  expect(importedImageName('Photo.png', [{ name: 'photo' }, { name: 'Photo 2' }])).toBe('Photo 3')
  expect(importedImageName('e\u0301.jpg', [{ name: 'é' }])).toBe('é 2')
  expect(importedImageName('AppIcon.png', [])).toBe('AppIcon Image')
  expect(importedImageName('trip.photo:1.png', [])).toBe('trip-photo-1')
})
it('inserts source and pixels atomically, renders the bitmap, undoes both, and exports its Xcode asset', () => {
  const text = 'import SwiftUI\n@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { VStack { Text("Photos") } } }'
  const project = projectFromFiles([{ name: 'App.swift', text }])!
  const asset = { id: 'photo', name: 'My Photo', scale: 1 as const, light: readImage(new Uint8Array(readFileSync(new URL('./fixtures/authoring-photo.png', import.meta.url)))) }
  const model = buildAuthoringModel({ projectId: project.id, revision: 1, files: project.files })
  const node = model.nodes.find(node => node.name === 'VStack')!
  const plan = planDesignEdit({ projectId: project.id, baseRevision: 1, files: project.files, scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'insert', snippet: imageViewSnippet(asset.name) } })
  if (!plan.ok) throw new Error(plan.reason)
  const applied = applyProjectTransaction(project, 1, { ...plan, assets: { before: project.assets, after: [asset] } })
  if (!applied.ok) throw new Error(applied.reason)
  const added = applied.project
  expect(added.files[0]!.text).toContain('Image("My Photo")')
  const result = compile({ projectId: project.id, files: added.files, revision: 2, canvas: { width: 393, height: 852 }, colorScheme: 'light', images: [{ name: asset.name, width: asset.light.width, height: asset.light.height, light: imageDataURL(asset.light) }] })
  expect(result.diagnostics).toEqual([])
  const bitmap = result.renderTree?.nodes.find(node => node.image?.bitmap)
  expect(bitmap?.image?.bitmap?.url).toBe(imageDataURL(asset.light))
  expect(bitmap!.frame.width / bitmap!.frame.height).toBeCloseTo(asset.light.width / asset.light.height)
  const history = new DocumentHistory(); history.record(project, added, null, null)
  const undone = history.take('undo', added)!.project
  expect(undone.files).toEqual(project.files); expect(undone.assets).toEqual(project.assets)
  expect(history.take('redo', undone)?.project.assets).toEqual([asset])
  const entries = unzipSync(exportProjectZip(added))
  const imageEntry = Object.keys(entries).find(path => path.includes('My Photo.imageset/') && path.endsWith('.png'))!
  expect(entries[imageEntry]).toEqual(asset.light.bytes)
  const photoNode = plan.authoring!.nodes.find(node => node.name === 'Image')!
  expect(sourceLayerType(photoNode)).toBe('Image')
  const symbol = buildAuthoringModel({ projectId: project.id, revision: 3, files: [{ id: 'App.swift', text: text.replace('Text("Photos")', 'Image(systemName: "star")') }] }).nodes.find(node => node.name === 'Image')!
  expect(sourceLayerType(symbol)).toBe('Symbols')
})
