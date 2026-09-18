import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { unzipSync, zipSync, zlibSync } from 'fflate'
import { ASSET_LIMITS, assetName, readImage, validateAssets, imageDataURL, projectFromFiles, normalizeProject, emptyStudioMetadata, DocumentHistory, MemoryProjectStore, applyProjectTransaction, encodeProject, type Project, type ImageAsset } from '@studio/project-model'
import { exportEditableZip, exportProjectZip, readProjectArchive, reviewImport, resolveImport, bundleFor, EXPORT_FORMATS } from '@studio/exporter'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { DesignEditRequest, SourceFile } from '@studio/shared'

const utf8 = new TextEncoder()
function crc(bytes: Uint8Array) { let c = -1; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return (c ^ -1) >>> 0 }
function png(width = 2, height = 1, red = 255): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer)
    view.setUint32(0, data.length); bytes.set(utf8.encode(type), 4); bytes.set(data, 8); view.setUint32(bytes.length - 4, crc(bytes.subarray(4, -4)))
    return bytes
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6
  const pixels = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { pixels[y * (width * 4 + 1) + 1 + x * 4] = red; pixels[y * (width * 4 + 1) + 4 + x * 4] = 255 }
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(pixels)), chunk('IEND', new Uint8Array())]
  const result = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0)); let at = 0
  for (const c of chunks) { result.set(c, at); at += c.length } return result
}
const asset = (name = 'Photo'): ImageAsset => ({ id: 'photo-id', name, scale: 1, light: readImage(png()), dark: readImage(png(2, 1, 20)) })
const app = (body: string) => `import SwiftUI\n@main struct TestApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { ${body} } }\n`
const project = (body = 'Image("Photo").resizable().scaledToFit().frame(width: 100, height: 100)'): Project => ({ ...projectFromFiles([{ name: 'App.swift', text: app(body) }], 0)!, schemaVersion: 1, assets: [asset()], studio: { ...emptyStudioMetadata(), canvas: [{ screen: 'ContentView', x: 40, y: 80 }] } })
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
function edit(files: readonly SourceFile[], operation: DesignEditRequest['operation'], name = 'Text', index = 0) {
  const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files }), node = snapshot.nodes.filter(n => n.name === name)[index]!
  expect(node).toBeDefined()
  return planDesignEdit({ projectId: 'p', baseRevision: 1, files, target: node.source, fingerprint: node.fingerprint, scope: node.owner, operation })
}
function updated(files: readonly SourceFile[], operation: DesignEditRequest['operation'], name = 'Text', index = 0): SourceFile[] {
  const result = edit(files, operation, name, index)
  if (!result.ok) throw new Error(result.reason)
  return [...files.map(f => ({ ...f, text: result.changes.find(c => c.file === f.id)?.after ?? f.text })), ...result.changes.filter(c => c.before === null).map(c => ({ id: c.file, text: c.after }))]
}
beforeEach(() => resetPipelineState())

describe('bundled image resources', () => {
  it('validates PNG pixels, Unicode names, and stable resource identity', () => {
    expect(readImage(png())).toMatchObject({ width: 2, height: 1, mime: 'image/png' })
    expect(assetName(' カード ')).toBe('カード')
    validateAssets([asset('カード')])
    expect(imageDataURL(asset().light)).toMatch(/^data:image\/png;base64,/)
  })
  it.each(['../Photo', 'A/B', 'A\\B', 'AppIcon', 'AccentColor', '.', 'a\u0000b'])('rejects unsafe image name %s', name => expect(() => validateAssets([asset(name)])).toThrow())
  it('rejects case collisions, duplicate IDs, Unicode collisions, and mismatched variants', () => {
    expect(() => validateAssets([asset(), { ...asset('photo'), id: 'other' }])).toThrow(/unique/)
    expect(() => validateAssets([asset(), asset('Other')])).toThrow(/unique/)
    expect(() => validateAssets([asset('é'), { ...asset('e\u0301'), id: 'other' }])).toThrow()
    expect(() => validateAssets([{ ...asset(), dark: readImage(png(3)) }])).toThrow(/same dimensions/)
  })
  it('refuses truncated, corrupt, oversized, and header-forged image data', () => {
    expect(() => readImage(png().slice(0, -2))).toThrow()
    const bad = png(); bad[50] = bad[50]! ^ 1; expect(() => readImage(bad)).toThrow()
    expect(() => readImage(new Uint8Array(ASSET_LIMITS.variantBytes + 1))).toThrow(/4 MB/)
    const huge = png(); new DataView(huge.buffer).setUint32(16, 100000); expect(() => readImage(huge)).toThrow(/4096/)
    expect(() => validateAssets([{ ...asset(), light: { ...asset().light, width: 6 } }])).toThrow(/metadata/)
  })
  it.each(['light', 'dark'] as const)('paints exact %s bitmap, aspect ratio, and scale without a placeholder', scheme => {
    const p = project(), a = p.assets![0]!
    const result = compile({ projectId: p.id, files: p.files, revision: 1, colorScheme: scheme, canvas: { width: 393, height: 852 }, images: [{ name: a.name, width: 2, height: 1, light: imageDataURL(a.light), dark: imageDataURL(a.dark!) }] })
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    const image = result.renderTree?.nodes.find(n => n.image?.bitmap)
    expect(image?.image?.bitmap?.url).toBe(imageDataURL(a[scheme]!))
    expect(image?.image?.approximated).toBe(false)
    expect(image?.frame.width).toBe(100); expect(image?.frame.height).toBe(50)
  })
  it('renames only image references and commits source plus binary resources in one undo step', () => {
    const p = project('VStack { Image("Photo"); Text("Photo") }'), revision = 4
    const plan = edit(p.files, { kind: 'asset-references', from: 'Photo', to: 'Portrait' }, 'Image')
    if (!plan.ok) throw new Error(plan.reason)
    const nextAssets = [{ ...p.assets![0]!, name: 'Portrait' }]
    const result = applyProjectTransaction(p, revision, { ...plan, projectId: p.id, baseRevision: revision, assets: { before: p.assets, after: nextAssets } })
    if (!result.ok) throw new Error(result.reason)
    expect(result.project.files[0]!.text).toContain('Image("Portrait"); Text("Photo")')
    expect(result.project.assets![0]!.id).toBe('photo-id')
    const history = new DocumentHistory(); history.record(p, result.project, null, null)
    expect(history.take('undo', result.project)?.project).toMatchObject({ files: p.files, assets: p.assets })
    expect(history.take('redo', p)?.project.assets).toBe(nextAssets)
    expect(applyProjectTransaction(p, 5, { ...plan, projectId: p.id, baseRevision: revision, assets: { before: p.assets, after: nextAssets } }).ok).toBe(false)
  })
  it('requires replacement for referenced deletions and refuses dynamic image names', () => {
    expect(edit(project().files, { kind: 'asset-references', from: 'Photo', to: null }, 'Image')).toMatchObject({ ok: false })
    const p = project('Image(name)'); const files = [{ ...p.files[0]!, text: 'let name = "Photo"\n' + p.files[0]!.text }]
    expect(edit(files, { kind: 'asset-references', from: 'Photo', to: 'New' }, 'Image')).toMatchObject({ ok: false })
  })
  it('does not silently strip assets from share links', () => expect(encodeProject(project())).toBeNull())
})

describe('Swift-owned shared styles', () => {
  const files = () => [{ id: 'Sources/App.swift', text: 'import SwiftUI\nenum Theme { static let brand = Color.blue; static let gap: CGFloat = 12; static let title = Font.title }\n' + app('VStack(spacing: Theme.gap) { Text("One").foregroundStyle(Theme.brand).font(Theme.title); Text("Two").foregroundStyle(Theme.brand); Text("Local").foregroundStyle(Color.green) }') }]
  it('updates both linked users and leaves a local override byte-identical', () => {
    const next = updated(files(), { kind: 'style-edit', name: 'Theme.brand', value: 'red' })
    expect(next[0]!.text).toBe(files()[0]!.text.replace('brand = Color.blue', 'brand = Color.red'))
    const snapshot = buildAuthoringModel({ files: next, projectId: 'p', revision: 1 })
    expect(snapshot.styles?.find(t => t.name === 'Theme.brand')).toMatchObject({ value: 'red', uses: expect.any(Array) })
    expect(snapshot.styles?.find(t => t.name === 'Theme.brand')?.uses).toHaveLength(2)
    const r = compile({ files: next, revision: 1, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
    const text = (s: string) => r.renderTree?.nodes.find(n => n.text?.runs.some(run => run.text === s))?.text?.runs[0]?.color
    expect(text('One')).toEqual(text('Two')); expect(text('One')).not.toEqual(text('Local'))
  })
  it('links and detaches a single source property while preserving other uses', () => {
    const snapshot = buildAuthoringModel({ files: files(), projectId: 'p', revision: 1 }), node = snapshot.nodes.filter(n => n.name === 'Text')[0]!
    const property = node.styles!.find(p => p.kind === 'color')!
    const next = updated(files(), { kind: 'style-local', property: property.property, value: '#123456' })
    expect(next[0]!.text).toContain('Text("Two").foregroundStyle(Theme.brand)')
    expect(next[0]!.text).toContain('Color(red: 0.07058823529411765, green: 0.20392156862745098, blue: 0.33725490196078434)')
    const fresh = buildAuthoringModel({ files: next, projectId: 'p', revision: 2 }).nodes.filter(n => n.name === 'Text')[2]!
    expect(updated(next, { kind: 'style-link', property: fresh.styles![0]!.property, name: 'Theme.brand' }, 'Text', 2)[0]!.text).toContain('Text("Local").foregroundStyle(Theme.brand)')
  })
  it.each([['color', '#2563eb'], ['spacing', '20'], ['font', 'headline']] as const)('creates a typed %s declaration and recognizes later external changes', (style, value) => {
    const next = updated(files(), { kind: 'style-create', name: 'newStyle', style, value })
    expect(next).toHaveLength(2)
    expect(next[1]!.text).toContain('let newStyle:')
    expect(buildAuthoringModel({ files: next, projectId: 'p', revision: 1 }).styles?.find(s => s.name === 'newStyle')?.value).toBe(value)
  })
  it('rejects invalid spacing, arbitrary expressions, duplicate names and computed definitions', () => {
    expect(edit(files(), { kind: 'style-edit', name: 'Theme.gap', value: '-1' })).toMatchObject({ ok: false })
    expect(edit(files(), { kind: 'style-edit', name: 'Theme.brand', value: 'Color.red; fatalError()' })).toMatchObject({ ok: false })
    expect(edit(files(), { kind: 'style-create', name: 'Theme', style: 'color', value: 'red' })).toMatchObject({ ok: false })
    for (const name of ['Color', 'Font', 'SwiftUI', '_']) expect(edit(files(), { kind: 'style-create', name, style: 'color', value: 'red' })).toMatchObject({ ok: false })
    const computed = [{ ...files()[0]!, text: files()[0]!.text.replace('static let brand = Color.blue', 'static var brand: Color { Color.blue }') }]
    expect(edit(computed, { kind: 'style-edit', name: 'Theme.brand', value: 'red' })).toMatchObject({ ok: false })
  })
})

describe('editable archive and external handoff', () => {
  it.each(['editable', ...EXPORT_FORMATS.map(f => f.id)] as const)('round-trips %s with exact source and resource hashes, IDs, metadata, and app settings', format => {
    const p = { ...project(), manifest: { ...project().manifest, deploymentTarget: '18.0', bundleId: 'com.example.images' } }
    const bytes = format === 'editable' ? exportEditableZip(p) : exportProjectZip(p, format)
    const imported = readProjectArchive(bytes)
    expect(imported.problem).toBeNull()
    expect(imported.project).toMatchObject({ id: p.id, files: p.files, studio: p.studio, manifest: p.manifest })
    expect(sha(imported.project!.assets![0]!.light.bytes)).toBe(sha(p.assets![0]!.light.bytes))
    expect(sha(imported.project!.assets![0]!.dark!.bytes)).toBe(sha(p.assets![0]!.dark!.bytes))
    expect(imported.project!.assets![0]!.id).toBe(p.assets![0]!.id)
    expect(format === 'editable' ? exportEditableZip(p) : exportProjectZip(p, format)).toEqual(bytes)
  })
  it('packages image catalogs and configured deployment targets in every native format', () => {
    const p = { ...project(), manifest: { ...project().manifest, deploymentTarget: '18.0' } }
    for (const { id } of EXPORT_FORMATS) {
      const bundle = bundleFor(p, id)
      expect([...bundle.keys()].some(k => k.endsWith('Photo.imageset/light.png'))).toBe(true)
      const contents = [...bundle].find(([k]) => k.endsWith('Photo.imageset/Contents.json'))![1]
      expect(JSON.parse(new TextDecoder().decode(contents)).images[1].appearances).toEqual([{ appearance: 'luminosity', value: 'dark' }])
      const settings = [...bundle].find(([k]) => /Package.swift|project.yml|project.pbxproj$/.test(k))![1]
      expect(new TextDecoder().decode(settings)).toContain('18.0')
    }
  })
  it('reopens real externally edited Swift and offers review instead of overwriting divergent local work', () => {
    const p = project('Text("Original")'), entries = unzipSync(exportEditableZip(p)), path = Object.keys(entries).find(p => p.endsWith('/Sources/App.swift'))!
    const dir = mkdtempSync(join(tmpdir(), 'studio-external-'))
    try {
      const file = join(dir, 'App.swift'); writeFileSync(file, entries[path]!); writeFileSync(file, readFileSync(file, 'utf8').replace('Original', 'External'))
      entries[path] = new Uint8Array(readFileSync(file))
      const imported = readProjectArchive(zipSync(entries))
      expect(imported.problem).toBeNull()
      const local = { ...p, files: [{ ...p.files[0]!, text: p.files[0]!.text.replace('Original', 'Local') }] }
      const review = reviewImport(local, imported.project!, imported.handoff!)
      expect(review.conflicts.map(c => c.key)).toContain('Sources/App.swift')
      expect(() => resolveImport(local, imported.project!, imported.handoff!, {})).toThrow(/every conflict/)
      const result = resolveImport(local, imported.project!, imported.handoff!, { 'Sources/App.swift': 'incoming' })
      expect(result.files[0]!.text).toContain('External'); expect(result.id).toBe(local.id)
      const copy = resolveImport(local, imported.project!, imported.handoff!, {}, true)
      expect(copy.id).not.toBe(local.id)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('merges separate file edits and never uses app-name equality as identity', () => {
    const p = { ...project(), files: [...project().files, { id: 'Sources/Helper.swift', text: '// original helper' }] }
    const imported = readProjectArchive(exportEditableZip(p)), incoming = { ...imported.project!, files: imported.project!.files.map(f => f.id.endsWith('Helper.swift') ? { ...f, text: '// external helper' } : f) }
    const local = { ...p, files: p.files.map(f => f.id.endsWith('App.swift') ? { ...f, text: f.text + '// local change' } : f) }
    const result = resolveImport(local, incoming, imported.handoff!, {})
    expect(result.files[0]!.text).toContain('// local change'); expect(result.files[1]!.text).toBe('// external helper')
    expect(reviewImport({ ...local, id: 'another-id' }, incoming, imported.handoff!).sameIdentity).toBe(false)
  })
  it('removing Studio metadata has no effect on source or image payloads', () => {
    const p = project(), entries = unzipSync(exportEditableZip(p))
    delete entries[`${p.manifest.name}/.swiftstudio/studio.json`]
    const imported = readProjectArchive(zipSync(entries))
    expect(imported.problem).toBeNull(); expect(imported.project?.studio).toBeUndefined(); expect(imported.project?.files).toEqual(p.files)
    expect(sha(imported.project!.assets![0]!.light.bytes)).toBe(sha(p.assets![0]!.light.bytes))
  })
  it('rejects future schemas, missing resources, traversal, case collisions, and corrupt CRCs without partial import', () => {
    const p = project(), archive = unzipSync(exportEditableZip(p)), doc = `${p.manifest.name}/.swiftstudio/project.json`
    const future = { ...archive, [doc]: utf8.encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(archive[doc]!)), version: 999 })) }
    expect(readProjectArchive(zipSync(future)).problem).toMatch(/version/)
    delete archive[Object.keys(archive).find(k => k.endsWith('/dark.png'))!]
    expect(readProjectArchive(zipSync(archive))).toMatchObject({ files: [], problem: expect.stringContaining('missing') })
    expect(readProjectArchive(zipSync({ '../App.swift': utf8.encode('hello') }))).toMatchObject({ files: [], problem: expect.stringContaining('unsafe') })
    expect(readProjectArchive(zipSync({ 'A/File.swift': utf8.encode('hello'), 'A/file.swift': utf8.encode('world') })).problem).toMatch(/colliding/)
    const bytes = zipSync({ 'A/File.swift': utf8.encode('hello') }, { level: 0 }); bytes[42] = bytes[42]! ^ 1
    expect(readProjectArchive(bytes).problem).not.toBeNull()
  })
  it('clones persisted resource bytes, migrates legacy storage, and rejects future storage without replacing the last good project', async () => {
    const p = project(), store = new MemoryProjectStore(); await store.save(p)
    const loaded = (await store.load(p.id))!; loaded.assets![0]!.light.bytes[0] = 0
    expect((await store.load(p.id))!.assets![0]!.light.bytes[0]).toBe(137)
    expect(normalizeProject({ ...p, schemaVersion: undefined }).schemaVersion).toBe(1)
    await expect(store.save({ ...p, schemaVersion: 99 } as unknown as Project)).rejects.toThrow(/newer/)
    expect((await store.load(p.id))!.files).toEqual(p.files)
  })
})


it('exports the actual shared-style writer result for Apple typechecking and catalog inspection', () => {
  let p = project('VStack(spacing: 8) { Text("Resources").foregroundStyle(Color.blue); Image("Photo").resizable().scaledToFit().frame(width: 100, height: 50) }')
  const files = updated(p.files, { kind: 'style-create', name: 'brandColor', style: 'color', value: '#2468ac' })
  const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files })
  const text = snapshot.nodes.find(n => n.name === 'Text')!
  const linked = updated(files, { kind: 'style-link', name: 'brandColor', property: text.styles![0]!.property })
  p = { ...p, files: linked, manifest: { ...p.manifest, name: 'ResourceReference' } }
  const output = process.env.PHASE789_EXPORT_DIR
  if (output) {
    for (const { id } of EXPORT_FORMATS) {
      for (const [path, bytes] of bundleFor(p, id)) { const dest = join(output, id, path); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, bytes) }
      writeFileSync(join(output, `${id}.zip`), exportProjectZip(p, id))
    }
    writeFileSync(join(output, 'ResourceReference.swiftstudio.zip'), exportEditableZip(p))
    writeFileSync(join(output, 'resource-hashes.json'), JSON.stringify(p.assets!.map(a => ({ name: a.name, light: sha(a.light.bytes), dark: sha(a.dark!.bytes) })), null, 2))
  }
})

it('preserves added/deleted external Swift, computed code, unsupported helpers, and legacy hide markers', () => {
  const p = { ...project('Text("Original")'), files: [...project('Text("Original")').files, { id: 'Sources/Unused.swift', text: '// unused' }] }
  const entries = unzipSync(exportEditableZip(p)), source = `${p.manifest.name}/Sources/App.swift`
  entries[source] = utf8.encode(new TextDecoder().decode(entries[source]!).replace('Text("Original")', 'Text(String(42 * 2))') + '\n// studio-hidden: keep this exact developer marker\n')
  delete entries[`${p.manifest.name}/Sources/Unused.swift`]
  entries[`${p.manifest.name}/Sources/External.swift`] = utf8.encode('protocol CustomRule { associatedtype Value }\nfunc external<T: CustomRule>(_ value: T) -> T { value }')
  const imported = readProjectArchive(zipSync(entries))
  expect(imported.problem).toBeNull()
  const merged = resolveImport(p, imported.project!, imported.handoff!, {})
  expect(merged.files.some(f => f.id.endsWith('Unused.swift'))).toBe(false)
  expect(merged.files.find(f => f.id.endsWith('External.swift'))?.text).toContain('associatedtype Value')
  expect(merged.files[0]!.text).toContain('Text(String(42 * 2))')
  expect(merged.files[0]!.text).toContain('// studio-hidden: keep this exact developer marker')
})

it('opens a source bundle with a universal asset catalog when Studio metadata is absent', () => {
  const p = project(), entries = Object.fromEntries(bundleFor(p, 'xcodeproj'))
  const imported = readProjectArchive(zipSync(entries))
  expect(imported.problem).toBeNull()
  expect(imported.project?.id).not.toBe(p.id)
  expect(imported.project?.assets?.[0]?.name).toBe('Photo')
  expect(sha(imported.project!.assets![0]!.light.bytes)).toBe(sha(p.assets![0]!.light.bytes))
})

it('retains external field/component renames and custom logic while continuing a supported visual edit', () => {
  const source = `import SwiftUI
struct Product: Identifiable { let id: String; var title: String }
struct ProductRow: View { var title: String; var body: some View { Text(title.uppercased()).font(.body) } }
@main struct CatalogApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
 let items: [Product] = [Product(id: "one", title: "First")]
 var body: some View { List(items) { item in ProductRow(title: item.title) } }
}`
  const p = { ...project(), files: [{ id: 'Sources/App.swift', text: source }] }, entries = unzipSync(exportEditableZip(p))
  const path = `${p.manifest.name}/Sources/App.swift`
  entries[path] = utf8.encode(source.replaceAll('ProductRow', 'CatalogRow').replaceAll('Product', 'CatalogItem').replaceAll('title', 'name'))
  const custom = 'protocol CustomRule { associatedtype Value }\nfunc preserve<T: CustomRule>(_ value: T) -> T { value }\n'
  entries[`${p.manifest.name}/Sources/Custom.swift`] = utf8.encode(custom)
  const imported = readProjectArchive(zipSync(entries))
  expect(imported.problem).toBeNull()
  const reopened = resolveImport(p, imported.project!, imported.handoff!, {})
  const model = buildAuthoringModel({ projectId: reopened.id, revision: 1, files: reopened.files })
  const row = model.nodes.find(n => n.owner === 'CatalogRow' && n.name === 'Text')!
  const font = row.controls!.find(c => c.options?.includes('body') && c.value === 'body')!
  expect(font).toBeDefined()
  const plan = planDesignEdit({ projectId: reopened.id, baseRevision: 1, files: reopened.files, target: row.source, fingerprint: row.fingerprint, scope: row.owner, operation: { kind: 'property', control: font.id, value: 'headline' } })
  if (!plan.ok) throw new Error(plan.reason)
  expect(plan.changes).toHaveLength(1)
  expect(plan.changes[0]!.after).toContain('Text(name.uppercased()).font(.headline)')
  expect(reopened.files.find(f => f.id.endsWith('Custom.swift'))!.text).toBe(custom)
})
