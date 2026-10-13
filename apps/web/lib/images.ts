import { ASSET_LIMITS, assetName, readImage, type ImageAsset, type ImageVariant } from '@studio/project-model'

/** What an Assets row carries when it is dragged: the image's name. */
export const ASSET_DRAG_TYPE = 'application/x-studio-asset'

/** Whether a drag holds files from outside the studio, rather than something dragged within it. */
export function draggingFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && Array.from(transfer.types).includes('Files')
}

/**
 * Images from a picker or a drop, decoded and named, ready to add to the Assets folder.
 *
 * A drop can hold anything, so each file is checked rather than the batch: the ones
 * that are not usable are reported by name, and the rest still come in.
 */
export async function importImageFiles(files: readonly File[], existing: readonly Pick<ImageAsset, 'name'>[]): Promise<{ added: ImageAsset[]; problems: string[] }> {
  const added: ImageAsset[] = [], problems: string[] = []
  for (const file of files) {
    if (!['image/png', 'image/jpeg'].includes(file.type) && !/\.(png|jpe?g)$/i.test(file.name)) { problems.push(`${file.name} is not a PNG or JPEG image.`); continue }
    if (file.size > ASSET_LIMITS.variantBytes) { problems.push(`${file.name} is larger than 4 MB.`); continue }
    try {
      const light = await decodeImportedImage(new Uint8Array(await file.arrayBuffer()))
      added.push({ id: crypto.randomUUID(), name: importedImageName(file.name, [...existing, ...added]), scale: 1, light })
    } catch (error) {
      problems.push(`${file.name}: ${error instanceof Error ? error.message : 'it could not be read.'}`)
    }
  }
  return { added, problems }
}

/** Keep filenames friendly while avoiding reserved names and catalog collisions. */
export function importedImageName(filename: string, assets: readonly Pick<ImageAsset, 'name'>[]): string {
  // Strip control bytes as well as characters forbidden by Xcode asset catalogs.
  // eslint-disable-next-line no-control-regex
  let base = filename.replace(/\.[^.]+$/, '').normalize('NFC').replace(/[./\\<>:"|?*\u0000-\u001f\u007f]/gu, '-').trim().slice(0, 70) || 'Image'
  if (['appicon', 'accentcolor'].includes(base.toLowerCase())) base += ' Image'
  const names = new Set(assets.map(asset => asset.name.normalize('NFC').toLowerCase()))
  let name = base, suffix = 2
  while (names.has(name.toLowerCase())) name = `${base} ${suffix++}`
  return assetName(name)
}

export function imageViewSnippet(name: string): string {
  return `Image(${JSON.stringify(assetName(name))})\n    .resizable()\n    .scaledToFit()\n    .frame(width: 160, height: 120)`
}

/** Decode on the main thread before committing bytes to the project. Always release the bitmap. */
export async function decodeImportedImage(bytes: Uint8Array): Promise<ImageVariant> {
  const image = readImage(bytes)
  const bitmap = await createImageBitmap(new Blob([image.bytes.slice()], { type: image.mime }))
  try {
    if (bitmap.width !== image.width || bitmap.height !== image.height) throw new Error('Rotate and save this image upright before importing it; its encoded orientation changes its dimensions.')
  } finally { bitmap.close() }
  return image
}
