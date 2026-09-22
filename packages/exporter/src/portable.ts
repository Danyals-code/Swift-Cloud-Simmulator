import { newProjectId, normalizeProject, normalizeProjectName, normalizeFileName, normalizeFolderPath, readColorSet, readImage, readStudioMetadata, validateAssets, validateColors, type ColorAsset, type Project, type ProjectManifest, type ImageAsset, type StudioMetadata } from '@studio/project-model'
import { DEVICES } from '@studio/sim-shell'
import { isPreviewTarget, type SourceFile } from '@studio/shared'
import { encodeText, type ExportBundle } from './bundle'
import { importSourceAssets } from './import-assets'
import { validatePromptHistory } from '@studio/project-model'

export const PROJECT_DOCUMENT = '.swiftstudio/project.json'
interface ResourceEntry { id: string; name: string; scale: 1 | 2 | 3; light: string; dark?: string }
/** The Studio build an export came from: the commit it was built from, and when. */
export interface StudioBuild { readonly commit: string; readonly builtAt: string }
export interface Handoff {
  readonly version: 1
  readonly format: 'swift-web-studio'
  /**
   * Which build wrote the archive, for the people who look inside it. Reading drops it
   * unchecked, so older and newer builds open each other's archives alike.
   */
  readonly generator?: { readonly name: 'Swift Web Studio'; readonly build: StudioBuild }
  readonly project: Omit<Project, 'files' | 'assets' | 'studio' | 'colors'>
  readonly sources: readonly { readonly id: string; readonly path: string; readonly base: string }[]
  readonly assets: readonly ResourceEntry[]
  /** Colour sets, read back from the catalog so a developer's edit there returns too. */
  readonly colors?: readonly { readonly name: string; readonly path: string }[]
  readonly baseManifest: ProjectManifest
  readonly baseStudio?: StudioMetadata
}
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
export const decodeText = (bytes: Uint8Array) => decoder.decode(bytes)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const safePath = (value: unknown): value is string => typeof value === 'string' && value.length <= 512 && !(/[\\:]/.test(value) || Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) && value.split('/').every(p => p.length > 0 && p !== '.' && p !== '..')
export function validatePortableProject(value: unknown): asserts value is Project {
  if (!object(value) || value.schemaVersion !== 1) throw new Error('Unsupported editable-project version. Use a compatible Studio; nothing was imported.')
  if (value.chatHistory !== undefined) validatePromptHistory(value.chatHistory)
  const m = value.manifest
  if (typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 128 || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || !object(m) || typeof m.name !== 'string' || normalizeProjectName(m.name) !== m.name || typeof m.bundleId !== 'string' || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(m.bundleId) || typeof m.deploymentTarget !== 'string' || !/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/.test(m.deploymentTarget) || !Object.hasOwn(DEVICES, String(m.device)) || !['light', 'dark'].includes(String(m.colorScheme))) throw new Error('Invalid project identity or app settings.')
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 256) throw new Error('A project must contain 1–256 Swift files.')
  if (m.previewTarget !== undefined && !isPreviewTarget(m.previewTarget)) throw new Error('This project uses an unsupported preview target.')
  const paths = new Set<string>()
  let size = 0
  for (const file of value.files) {
    if (!object(file) || !safePath(file.id) || !file.id.endsWith('.swift') || normalizeFileName(file.id) !== file.id || paths.has(file.id.normalize('NFC').toLowerCase()) || typeof file.text !== 'string') throw new Error('Invalid or duplicate Swift file path.')
    paths.add(file.id.normalize('NFC').toLowerCase()); size += encodeText(file.text).length
  }
  if ([...paths].some(path => [...paths].some(other => other !== path && other.startsWith(`${path}/`)))) throw new Error('A source file conflicts with a containing folder.')
  if (size > 8 * 1024 * 1024) throw new Error('A project may contain no more than 8 MB of Swift.')
  if (value.folders !== undefined && (!Array.isArray(value.folders) || value.folders.length > 256 || value.folders.some(f => typeof f !== 'string' || normalizeFolderPath(f) !== f))) throw new Error('Invalid project groups.')
  if (value.studio !== undefined && readStudioMetadata(value.studio).status !== 'valid') throw new Error('Unsupported or invalid Studio metadata. Use a compatible Studio.')
  validateAssets((value.assets ?? []) as ImageAsset[])
  validateColors((value.colors ?? []) as ColorAsset[])
}
/** Source files and resources stay outside the optional Studio metadata. */
export function attachHandoff(project: Project, bundle: ExportBundle, root: string, sourcePath: (id: string) => string, catalogPath: string, build?: StudioBuild): ExportBundle {
  const normalized = normalizeProject(project)
  validatePortableProject(normalized)
  const files = new Map(bundle)
  const document: Handoff = {
    version: 1, format: 'swift-web-studio',
    ...(build ? { generator: { name: 'Swift Web Studio', build: { commit: build.commit, builtAt: build.builtAt } } } : {}),
    project: { schemaVersion: 1, id: project.id, manifest: project.manifest, folders: project.folders, createdAt: project.createdAt, updatedAt: project.updatedAt, ...(project.chatHistory ? { chatHistory: project.chatHistory } : {}) },
    sources: project.files.map(f => ({ id: f.id, path: sourcePath(f.id), base: f.text })),
    assets: (project.assets ?? []).map(a => ({ id: a.id, name: a.name, scale: a.scale, light: `${catalogPath}/${a.name}.imageset/light.${a.light.mime === 'image/png' ? 'png' : 'jpg'}`, ...(a.dark ? { dark: `${catalogPath}/${a.name}.imageset/dark.${a.dark.mime === 'image/png' ? 'png' : 'jpg'}` } : {}) })),
    ...(project.colors?.length ? { colors: project.colors.map(color => ({ name: color.name, path: `${catalogPath}/${color.name}.colorset/Contents.json` })) } : {}),
    baseManifest: project.manifest, baseStudio: project.studio,
  }
  const put = (path: string, bytes: Uint8Array) => { if (files.has(path)) throw new Error('The project conflicts with an export metadata path.'); files.set(path, bytes) }
  put(`${root}/${PROJECT_DOCUMENT}`, encodeText(JSON.stringify(document)))
  if (project.studio) put(`${root}/.swiftstudio/studio.json`, encodeText(JSON.stringify(project.studio)))
  return files
}
export function readHandoff(entries: ReadonlyMap<string, Uint8Array>): { project: Project; handoff: Handoff } | null {
  const candidates = [...entries.keys()].filter(path => path.endsWith(`/${PROJECT_DOCUMENT}`))
  if (!candidates.length) return null
  if (candidates.length !== 1) throw new Error('The archive contains multiple project identities.')
  const documentPath = candidates[0]!, root = documentPath.slice(0, -PROJECT_DOCUMENT.length)
  const value: unknown = JSON.parse(decodeText(entries.get(documentPath)!))
  if (!object(value) || value.format !== 'swift-web-studio' || value.version !== 1) throw new Error('Unsupported editable-project version. Use a compatible Studio.')
  if (!object(value.project) || !Array.isArray(value.sources) || !Array.isArray(value.assets) || value.assets.length > 64 || value.sources.length > 256 || value.colors !== undefined && (!Array.isArray(value.colors) || value.colors.length > 256)) throw new Error('Invalid editable-project manifest.')
  const used = new Set<string>()
  const read = (path: unknown) => {
    if (!safePath(path) || !path.startsWith(root) || used.has(path)) throw new Error('Invalid or duplicate resource reference.')
    used.add(path)
    const bytes = entries.get(path)
    if (!bytes) throw new Error(`The archive is missing a referenced file: ${path}`)
    return bytes
  }
  const files = value.sources.flatMap(s => {
    if (!object(s) || typeof s.id !== 'string' || typeof s.base !== 'string' || typeof s.path !== 'string' || !s.path.endsWith('.swift')) throw new Error('Invalid source reference.')
    if (!safePath(s.path) || !s.path.startsWith(root)) throw new Error('Invalid source reference.')
    // A removed Swift file is a reviewed deletion. A missing binary resource remains an error.
    return entries.has(s.path) ? [{ id: s.id, text: decodeText(read(s.path)) }] : []
  })
  const roots = new Set(value.sources.flatMap(s => {
    const source = s as { id: string; path: string }
    const relative = source.id.replace(/^Sources\//, '')
    return source.path.endsWith(relative) ? [source.path.slice(0, -relative.length)] : []
  }))
  const referenced = new Set(value.sources.map(s => (s as { path: string }).path))
  for (const [path, bytes] of entries) {
    if (!path.endsWith('.swift') || referenced.has(path)) continue
    const matches = [...roots].filter(sourceRoot => path.startsWith(sourceRoot))
    if (matches.length !== 1) continue
    files.push({ id: `Sources/${path.slice(matches[0]!.length)}`, text: decodeText(bytes) })
  }
  const assets = value.assets.map(a => {
    if (!object(a)) throw new Error('Invalid asset reference.')
    return { id: a.id, name: a.name, scale: a.scale, light: readImage(read(a.light)), ...(a.dark === undefined ? {} : { dark: readImage(read(a.dark)) }) }
  })
  const colors = (Array.isArray(value.colors) ? value.colors : []).flatMap(c => {
    if (!object(c) || typeof c.name !== 'string' || typeof c.path !== 'string') throw new Error('Invalid colour set reference.')
    // Missing baseline names are deletions; renamed sets are discovered below.
    // Unsupported appearances stay out of the project without refusing the archive.
    if (!entries.has(c.path)) return []
    try { return [readColorSet(c.name, decodeText(read(c.path)))] } catch { return [] }
  })
  // The handoff is a baseline, not an inventory of the developer's current catalog.
  // Read additions too, while retaining stable IDs for resources in the baseline.
  const knownDirectories = new Set<string>()
  for (const resource of value.assets) {
    const path = (resource as { light: string }).light
    knownDirectories.add(path.slice(0, path.lastIndexOf('/') + 1))
  }
  for (const resource of Array.isArray(value.colors) ? value.colors : []) {
    const path = (resource as { path: string }).path
    knownDirectories.add(path.slice(0, path.lastIndexOf('/') + 1))
  }
  const directories = [...knownDirectories]
  const additions = new Map([...entries].filter(([path]) => path.startsWith(root) && path.includes('.xcassets/') && !directories.some(directory => path.startsWith(directory))))
  const discovered = importSourceAssets(files.map(file => ({ name: file.id, text: file.text })), additions)?.project
  assets.push(...(discovered?.assets ?? []))
  colors.push(...(discovered?.colors ?? []))
  const metadata = entries.get(`${root}.swiftstudio/studio.json`)
  const { colors: _ignored, ...identity } = value.project as Record<string, unknown>
  void _ignored
  const project = { ...identity, files, assets, ...(colors.length ? { colors } : {}), ...(metadata ? { studio: JSON.parse(decodeText(metadata)) as unknown } : {}) }
  validatePortableProject(project)
  // Baselines are untrusted too. They are used only for a visible merge proposal.
  const baseline = { ...project, manifest: value.baseManifest, studio: value.baseStudio, files: value.sources.map(s => ({ id: (s as { id: string }).id, text: (s as { base: string }).base })) }
  validatePortableProject(baseline)
  const { generator: _written, ...handoff } = value
  void _written
  return { project, handoff: handoff as unknown as Handoff }
}

export interface ImportConflict { readonly key: string; readonly label: string; readonly local: string; readonly incoming: string }
export interface ImportReview { readonly sameIdentity: boolean; readonly conflicts: readonly ImportConflict[]; readonly changedFiles: readonly string[] }
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (a instanceof Uint8Array && b instanceof Uint8Array) return a.length === b.length && a.every((value, i) => value === b[i])
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => same(value, b[i]))
  if (object(a) && object(b)) { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); return [...keys].every(key => same(a[key], b[key])) }
  return false
}
/** Three-way merge is by explicit ID and source path, never by display name. */
export function reviewImport(local: Project, incoming: Project, handoff: Handoff): ImportReview {
  if (local.id !== incoming.id) return { sameIdentity: false, conflicts: [], changedFiles: incoming.files.map(f => f.id) }
  const conflicts: ImportConflict[] = [], changedFiles: string[] = []
  for (const id of new Set([...local.files.map(f => f.id), ...incoming.files.map(f => f.id)])) {
    const a = local.files.find(f => f.id === id)?.text, b = incoming.files.find(f => f.id === id)?.text, base = handoff.sources.find(f => f.id === id)?.base
    if (a === b) continue
    changedFiles.push(id)
    if (a !== base && b !== base) conflicts.push({ key: id, label: id, local: a ?? '(deleted)', incoming: b ?? '(deleted)' })
  }
  for (const [key, label, base] of [['manifest', 'App settings', handoff.baseManifest], ['studio', 'Designer metadata', handoff.baseStudio], ['assets', 'Bundled images', undefined], ['colors', 'Colour tokens', undefined], ['folders', 'Empty groups', undefined], ['chatHistory', 'Prompt conversation', undefined]] as const) {
    // A list nobody has is the same list, however it is spelled. Without this, every
    // project with no images conflicted with itself over having none.
    const list = key === 'assets' || key === 'colors' || key === 'folders' || key === 'chatHistory'
    const ours = list ? local[key] ?? [] : local[key], theirs = list ? incoming[key] ?? [] : incoming[key]
    if (!same(ours, theirs) && (list || !same(ours, base) && !same(theirs, base))) conflicts.push({ key: `$${key}`, label, local: key === 'assets' ? describeAssets(local) : JSON.stringify(local[key], null, 2) ?? '(none)', incoming: key === 'assets' ? describeAssets(incoming) : JSON.stringify(incoming[key], null, 2) ?? '(none)' })
  }
  return { sameIdentity: true, conflicts, changedFiles }
}
const describeAssets = (p: Project) => (p.assets ?? []).map(a => `${a.name} · ${a.light.width} × ${a.light.height} · ${a.light.bytes.length} bytes${a.dark ? ' · dark variant' : ''}`).join('\n') || '(none)'
export function resolveImport(local: Project, incoming: Project, handoff: Handoff, choices: Readonly<Record<string, 'local' | 'incoming'>>, copy = false): Project {
  validatePortableProject(incoming)
  if (copy || local.id !== incoming.id) return { ...incoming, id: newProjectId(), createdAt: Date.now(), updatedAt: Date.now(), manifest: { ...incoming.manifest, origin: undefined, templateId: undefined } }
  const review = reviewImport(local, incoming, handoff)
  if (review.conflicts.some(c => !['local', 'incoming'].includes(choices[c.key] ?? ''))) throw new Error('Choose how to resolve every conflict before applying the import.')
  const files: SourceFile[] = []
  for (const id of new Set([...local.files.map(f => f.id), ...incoming.files.map(f => f.id)])) {
    const a = local.files.find(f => f.id === id), b = incoming.files.find(f => f.id === id), base = handoff.sources.find(f => f.id === id)?.base
    const selected = choices[id] === 'local' ? a : choices[id] === 'incoming' ? b : a?.text === base ? b : a
    if (selected) files.push(selected)
  }
  const choose = <K extends 'manifest' | 'studio' | 'assets' | 'colors' | 'folders' | 'chatHistory'>(key: K, base: unknown): Project[K] => choices[`$${key}`] === 'local' ? local[key] : choices[`$${key}`] === 'incoming' || same(local[key], base) ? incoming[key] : local[key]
  const result = { ...local, files, manifest: choose('manifest', handoff.baseManifest), studio: choose('studio', handoff.baseStudio), assets: choose('assets', undefined), colors: choose('colors', undefined), folders: choose('folders', undefined), chatHistory: choose('chatHistory', undefined), updatedAt: Date.now() }
  validatePortableProject(result)
  return result
}
