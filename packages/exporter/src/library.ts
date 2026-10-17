import { libraryImage, readImage, type ImageAsset, type ImageVariant } from '@studio/project-model'

/**
 * Library images in an export (Wave 7b, WAVE7-PLAN §2.5 and §2.6).
 *
 * The page adds each library image the code uses to an export-only copy of the project, as
 * `libraryAsset` makes it. Here the exporter tells those apart from the designer's own images:
 * the catalog writes both, but only own images count toward a project's limits and go in the
 * handoff's `assets`; library images are listed by name under `library` instead.
 */

/** Each served `v1` file's length and FNV-1a hash, so an import can tell an unchanged library imageset without a network. */
const SERVED: Readonly<Record<string, readonly [number, number]>> = {
  'blue-mosaic': [464016, 0xf20e8f47],
  'terracotta-figures': [128145, 0xc080488e],
  'stone-circle-moon': [87821, 0xae16b27e],
  'giant-redwoods': [129152, 0xf69f90d1],
  'arch-view': [90471, 0xd9436ec7],
  'portrait-card-table': [20145, 0x393ce8f3],
  'portrait-sword': [294283, 0x0aa9bdab],
  'portrait-village': [303429, 0x8d8625fb],
  'red-roof-house': [152886, 0x862cd4c3],
  'sea-tram': [103203, 0x12336f7b],
  'red-bus-bridge': [280025, 0xae389908],
  'portrait-press': [44740, 0x48926880],
  'basketball-player': [93111, 0x0ff8f6b9],
  'portrait-pipe': [177652, 0x5ae0d57e],
  'snowy-peak': [215203, 0xec4b24f1],
}

function fnv1a(bytes: Uint8Array): number {
  let hash = 0x811c9dc5
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  return hash
}

/** Whether `bytes` are exactly the served library image `name`. */
function isServed(name: string, bytes: Uint8Array): boolean {
  const served = Object.hasOwn(SERVED, name) ? SERVED[name] : undefined
  return !!served && bytes.length === served[0] && fnv1a(bytes) === served[1]
}

/** The id an export-only library image carries. */
const libraryId = (name: string) => `library-${name}`

/** The library image `name`, from its served bytes, as the export's catalog writes it: at 3x. */
export function libraryAsset(name: string, bytes: Uint8Array): ImageAsset {
  if (!libraryImage(name) || !isServed(name, bytes)) throw new Error(`The library image “${name}” did not download correctly. Export again.`)
  return { id: libraryId(name), name, scale: 3, light: readImage(bytes) }
}

/** Whether an asset is a library image `libraryAsset` made, rather than one of the designer's own. */
export function isLibraryAsset(asset: ImageAsset): boolean {
  return asset.id === libraryId(asset.name) && !!libraryImage(asset.name)
}

/**
 * Whether an imageset read from a catalog is an unchanged library image: its name, at 3x,
 * one light variant whose bytes are the served file's. One a developer changed in Xcode is not,
 * and comes back as an own image that replaces the library image of that name.
 */
export function isLibraryCopy(name: string, scale: number, light: ImageVariant, dark: ImageVariant | undefined): boolean {
  return scale === 3 && !dark && !!libraryImage(name) && isServed(name, light.bytes)
}
