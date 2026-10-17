import { imageDataURL, LIBRARY_IMAGES, libraryImage, libraryImageURL, libraryThumbURL, type ImageAsset, type LibraryImage, type Project } from '@studio/project-model'
import type { PreviewImageAsset, ResourceOperation } from '@studio/shared'

/** An asset name as the asset catalog compares names, so two that match can't both be in it: Unicode-normalised, ignoring case. */
export const catalogKey = (name: string) => name.trim().normalize('NFC').toLowerCase()

/**
 * The library images the project's own images leave out (Wave 7b), the one rule the preview,
 * the panel, the pickers and the export share.
 * - An own image of exactly a library image's name shadows it: `Image("snowy-peak")` draws the
 *   own image, since `bitmapOf` and iOS both look an image up by its exact name.
 * - The studio never names an own image like a library image in other letter case (imports
 *   get "snowy-peak 2" and such a rename is refused), since an asset catalog can't hold both. An
 *   older project may already have one: the export then leaves the library image out, so the
 *   preview does too, and draws what the exported app would.
 */
export function shadowedLibraryNames(assets: readonly Pick<ImageAsset, 'name'>[]): ReadonlySet<string> {
  const own = new Set(assets.map(asset => catalogKey(asset.name)))
  return new Set(LIBRARY_IMAGES.filter(image => own.has(catalogKey(image.name))).map(image => image.name))
}

/**
 * The images the preview can draw (Wave 7b): the project's own, then each library image they
 * don't shadow. The project wins so that an older project holding its own image under a name
 * the library now uses draws, and exports, as it always did. A library image is its
 * same-origin path, not its bytes, so a compile carries a few hundred bytes of names rather
 * than megabytes of base64.
 */
export function previewImages(project: Pick<Project, 'assets'>): PreviewImageAsset[] {
  const assets = project.assets ?? []
  const shadowed = shadowedLibraryNames(assets)
  return [
    ...assets.map(asset => ({ name: asset.name, width: asset.light.width / asset.scale, height: asset.light.height / asset.scale, light: imageDataURL(asset.light), dark: asset.dark ? imageDataURL(asset.dark) : undefined })),
    ...LIBRARY_IMAGES.filter(image => !shadowed.has(image.name)).map(image => ({ name: image.name, width: image.width / image.scale, height: image.height / image.scale, light: libraryImageURL(image.name) })),
  ]
}

export interface LibraryRow {
  /** The manifest entry, with its pixel size and scale, for the preview sheet. */
  readonly image: LibraryImage
  readonly name: string
  readonly alt: string
  /** Its size in points, as an unresized `Image` draws it. */
  readonly width: number
  readonly height: number
  readonly url: string
  readonly thumb: string
  /** The project's own images shadow it (`shadowedLibraryNames`), so it is neither drawn nor exported. */
  readonly replaced: boolean
}

/** The library as the Assets panel and the image pickers list it, in its own order. */
export function libraryRows(assets: readonly Pick<ImageAsset, 'name'>[]): LibraryRow[] {
  const shadowed = shadowedLibraryNames(assets)
  return LIBRARY_IMAGES.map(image => ({ image, name: image.name, alt: image.alt, width: image.width / image.scale, height: image.height / image.scale, url: libraryImageURL(image.name), thumb: libraryThumbURL(image.name), replaced: shadowed.has(image.name) }))
}

/** The library images a picker offers beside the project's own: those it doesn't replace. */
export const libraryChoices = (assets: readonly Pick<ImageAsset, 'name'>[]) => libraryRows(assets).filter(row => !row.replaced).map(row => row.name)

/** Whether an own image of this name is drawn instead of a library image, which a rename says. */
export const replacesLibrary = (name: string) => libraryImage(name.trim()) !== undefined

/** Why an own image can't take this name: a library image's name in other letter case, which an asset catalog can't hold beside it. */
export function libraryNameProblem(name: string): string | undefined {
  const image = LIBRARY_IMAGES.find(image => catalogKey(image.name) === catalogKey(name))
  return image && image.name !== name.trim() ? `The Library has an image named “${image.name}”. Use exactly that name to replace it, or choose another name.` : undefined
}

/**
 * How deleting an own image rewrites the Swift that names it. One that replaces a library
 * image of exactly its name rewrites nothing unless a replacement is chosen: its uses go back
 * to the library image, so nothing is left pointing at nothing (Wave 7b).
 */
export function removalOperation(name: string, replacement: string): ResourceOperation | undefined {
  if (!replacement && libraryImage(name)) return undefined
  return { kind: 'asset-references', from: name, to: replacement || null }
}
