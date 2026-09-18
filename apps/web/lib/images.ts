import { readImage, type ImageVariant } from '@studio/project-model'

/** Decode on the main thread before committing bytes to the project. Always release the bitmap. */
export async function decodeImportedImage(bytes: Uint8Array): Promise<ImageVariant> {
  const image = readImage(bytes)
  const bitmap = await createImageBitmap(new Blob([image.bytes.slice()], { type: image.mime }))
  try {
    if (bitmap.width !== image.width || bitmap.height !== image.height) throw new Error('Rotate and save this image upright before importing it; its encoded orientation changes its dimensions.')
  } finally { bitmap.close() }
  return image
}
