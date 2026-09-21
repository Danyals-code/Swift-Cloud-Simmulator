import { assetName, readImage, type ImageAsset, type ImageVariant } from '@studio/project-model'

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
