import { Unzlib } from 'fflate'

export interface ImageVariant {
  readonly bytes: Uint8Array
  readonly mime: 'image/png' | 'image/jpeg'
  readonly width: number
  readonly height: number
}
export interface ImageAsset {
  readonly id: string
  readonly name: string
  readonly scale: 1 | 2 | 3
  readonly light: ImageVariant
  readonly dark?: ImageVariant
}
export const ASSET_LIMITS = { count: 64, variantBytes: 4 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, dimension: 4096, pixels: 4 * 1024 * 1024, totalPixels: 16 * 1024 * 1024 } as const
const key = (s: string) => s.normalize('NFC').toLowerCase()
export function assetName(name: string): string {
  const value = name.trim().normalize('NFC')
  if (!value || value.length > 80 || /[./\\<>:"|?*]/u.test(value) || Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || ['appicon', 'accentcolor'].includes(key(value))) throw new Error('Use an asset name of 1–80 characters without dots, separators, or reserved catalog names.')
  return value
}
function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > ASSET_LIMITS.dimension || height > ASSET_LIMITS.dimension || width * height > ASSET_LIMITS.pixels) throw new Error('Images must be at most 4096 pixels per side and 4 megapixels.')
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
  return value >>> 0
})
function crc32(bytes: Uint8Array): number {
  let crc = -1
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!
  return (crc ^ -1) >>> 0
}
/** Bounds are checked before decoding. PNG data is also inflated with a strict output cap. */
export function readImage(bytes: Uint8Array): ImageVariant {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > ASSET_LIMITS.variantBytes) throw new Error('Each PNG or JPEG must be no larger than 4 MB.')
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fail = () => { throw new Error('That image is corrupt or is not a supported PNG or JPEG.') }
  if (bytes.length >= 33 && data.getUint32(0) === 0x89504e47 && data.getUint32(4) === 0x0d0a1a0a) {
    if (data.getUint32(8) !== 13 || data.getUint32(12) !== 0x49484452) return fail()
    const width = data.getUint32(16), height = data.getUint32(20)
    dimensions(width, height)
    const depth = bytes[24]!, color = bytes[25]!, channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]
    const validDepths = ({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] } as Record<number, number[]>)[color]
    if (!channels || !validDepths?.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) throw new Error('Use a non-interlaced PNG or a JPEG image.')
    const expected = (Math.ceil(width * channels * depth / 8) + 1) * height
    let decoded = 0, seenData = false, endedData = false, done = false, palette = false
    const stride = Math.ceil(width * channels * depth / 8) + 1
    const inflater = new Unzlib(chunk => {
      for (let at = (stride - decoded % stride) % stride; at < chunk.length; at += stride) if (chunk[at]! > 4) fail()
      decoded += chunk.length
      if (decoded > expected) fail()
    })
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) return fail()
      const length = data.getUint32(offset), end = offset + length + 12
      if (end > bytes.length || crc32(bytes.subarray(offset + 4, end - 4)) !== data.getUint32(end - 4)) return fail()
      const type = data.getUint32(offset + 4)
      if (offset !== 8 && type === 0x49484452) return fail()
      if (type === 0x504c5445) palette = true
      if (type === 0x49444154) {
        if (endedData) return fail()
        seenData = true
        for (let i = offset + 8; i < end - 4; i += 256) inflater.push(bytes.subarray(i, Math.min(i + 256, end - 4)), false)
      } else if (seenData) endedData = true
      if (type === 0x49454e44) { if (length || end !== bytes.length || !seenData) return fail(); done = true }
      offset = end
    }
    if (!done || color === 3 && !palette) return fail()
    inflater.push(new Uint8Array(), true)
    if (decoded !== expected) return fail()
    return { bytes: bytes.slice(), mime: 'image/png', width, height }
  }
  if (bytes.length >= 4 && data.getUint16(0) === 0xffd8 && data.getUint16(bytes.length - 2) === 0xffd9) {
    let offset = 2, width = 0, height = 0, scan = false
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) return fail()
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]!, length = data.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) return fail()
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8 || bytes[offset + 2] !== 8) return fail()
        height = data.getUint16(offset + 3); width = data.getUint16(offset + 5); dimensions(width, height)
      }
      if (marker === 0xda) { scan = true; break }
      offset += length
    }
    if (!scan || !width || !height) return fail()
    return { bytes: bytes.slice(), mime: 'image/jpeg', width, height }
  }
  return fail()
}
export function validateAssets(assets: readonly ImageAsset[]): void {
  if (!Array.isArray(assets) || assets.length > ASSET_LIMITS.count) throw new Error('A project can contain up to 64 images.')
  const names = new Set<string>(), ids = new Set<string>()
  let total = 0, pixels = 0
  for (const asset of assets) {
    if (!asset || typeof asset.name !== 'string' || assetName(asset.name) !== asset.name || names.has(key(asset.name)) || typeof asset.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(asset.id) || ids.has(asset.id) || ![1, 2, 3].includes(asset.scale)) throw new Error('Asset IDs and names must be valid and unique, including case and Unicode normalization.')
    names.add(key(asset.name)); ids.add(asset.id)
    for (const variant of [asset.light, asset.dark].filter((v): v is ImageVariant => !!v)) {
      const decoded = readImage(variant.bytes)
      if (decoded.width !== variant.width || decoded.height !== variant.height || decoded.mime !== variant.mime) throw new Error('Image metadata does not match its bytes.')
      total += variant.bytes.length
      pixels += variant.width * variant.height
      if (pixels > ASSET_LIMITS.totalPixels) throw new Error('Project image variants may total no more than 16 megapixels of decoded pixels.')
    }
    if (!asset.light || asset.dark && (asset.light.width !== asset.dark.width || asset.light.height !== asset.dark.height)) throw new Error('Light and dark variants must have the same dimensions.')
    if (total > ASSET_LIMITS.totalBytes) throw new Error('Project images must total no more than 32 MB.')
  }
}
export function imageDataURL(image: ImageVariant): string {
  let binary = ''
  for (let offset = 0; offset < image.bytes.length; offset += 8192) binary += String.fromCharCode(...image.bytes.subarray(offset, offset + 8192))
  return `data:${image.mime};base64,${btoa(binary)}`
}
