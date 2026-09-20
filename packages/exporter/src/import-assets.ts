import { newProjectId, projectFromFiles, readColorSet, readImage, validColorName, type ColorAsset, type ImageAsset, type OpenedFile, type Project } from '@studio/project-model'
import { decodeText, validatePortableProject, type Handoff } from './portable'

/** The same universal PNG/JPEG image-set subset that the Studio exports. */
export function importSourceAssets(files: readonly OpenedFile[], entries: ReadonlyMap<string, Uint8Array>): { project: Project; handoff: Handoff } | null {
  const catalogs = [...entries.keys()].filter(path => path.endsWith('.imageset/Contents.json'))
  // Colour sets come along too: a project's colour tokens read them by name. Xcode's
  // empty AccentColor holds nothing to import. A set the studio cannot represent -
  // per-device values, system colour references - is left out, as every colour set
  // was before, rather than arriving flattened into something it is not.
  const colors: ColorAsset[] = []
  for (const path of [...entries.keys()].filter(path => path.endsWith('.colorset/Contents.json'))) {
    const name = path.split('/').at(-2)!.replace(/\.colorset$/, '')
    if (name === 'AccentColor' || !validColorName(name)) continue
    try { colors.push(readColorSet(name, decodeText(entries.get(path)!))) } catch { /* unrepresentable; keep the import */ }
  }
  if (!catalogs.length && colors.length) {
    const source = projectFromFiles(files)
    if (!source) throw new Error('The source archive contains no editable Swift files.')
    const project: Project = { ...source, schemaVersion: 1, colors }
    validatePortableProject(project)
    return { project, handoff: { version: 1, format: 'swift-web-studio', project: { schemaVersion: 1, id: project.id, manifest: project.manifest, createdAt: project.createdAt, updatedAt: project.updatedAt }, sources: project.files.map(file => ({ id: file.id, path: file.id, base: file.text })), assets: [], baseManifest: project.manifest } }
  }
  if (!catalogs.length) {
    if ([...entries.keys()].some(path => /\.(png|jpe?g)$/i.test(path))) throw new Error('This source archive includes images without image sets. Open its Swift files and import the images through Project resources, or include an asset catalog.')
    return null
  }
  const assets: ImageAsset[] = []
  for (const path of catalogs) {
    const directory = path.slice(0, -'Contents.json'.length), name = directory.split('/').at(-2)!.replace(/\.imageset$/, '')
    const contents: unknown = JSON.parse(decodeText(entries.get(path)!))
    if (!contents || typeof contents !== 'object' || !('images' in contents) || !Array.isArray(contents.images)) throw new Error(`Invalid image set: ${name}`)
    let scale: 1 | 2 | 3 | undefined, light: ImageAsset['light'] | undefined, dark: ImageAsset['dark']
    for (const item of contents.images as unknown[]) {
      if (!item || typeof item !== 'object') throw new Error(`Invalid image entry: ${name}`)
      const image = item as Record<string, unknown>
      if (image.filename === undefined) continue
      if (image.idiom !== 'universal' || typeof image.filename !== 'string' || /[\\/:]/.test(image.filename) || ['.', '..'].includes(image.filename) || !['1x', '2x', '3x'].includes(String(image.scale))) throw new Error(`Image set ${name} needs universal PNG/JPEG variants at one pixel scale.`)
      const nextScale = Number(String(image.scale)[0]) as 1 | 2 | 3
      if (scale && scale !== nextScale) throw new Error(`Image set ${name} has multiple pixel scales. Keep one complete light/dark pair before importing.`)
      scale = nextScale
      const bytes = entries.get(directory + image.filename)
      if (!bytes) throw new Error(`Missing image resource: ${image.filename}`)
      const variant = readImage(bytes)
      if (image.appearances === undefined || JSON.stringify(image.appearances) === '[]') {
        if (light) throw new Error(`Duplicate light variant: ${name}`)
        light = variant
      } else if (Array.isArray(image.appearances) && image.appearances.length === 1 && image.appearances[0]?.appearance === 'luminosity' && image.appearances[0]?.value === 'dark') {
        if (dark) throw new Error(`Duplicate dark variant: ${name}`)
        dark = variant
      } else throw new Error(`Image set ${name} uses an unsupported appearance.`)
    }
    if (!light || !scale) throw new Error(`Image set ${name} needs a default light image.`)
    assets.push({ id: newProjectId(), name, scale, light, dark })
  }
  const source = projectFromFiles(files)
  if (!source) throw new Error('The source archive contains no editable Swift files.')
  const project: Project = { ...source, schemaVersion: 1, assets, ...(colors.length ? { colors } : {}) }
  validatePortableProject(project)
  return { project, handoff: { version: 1, format: 'swift-web-studio', project: { schemaVersion: 1, id: project.id, manifest: project.manifest, createdAt: project.createdAt, updatedAt: project.updatedAt }, sources: project.files.map(file => ({ id: file.id, path: file.id, base: file.text })), assets: [], baseManifest: project.manifest } }
}
