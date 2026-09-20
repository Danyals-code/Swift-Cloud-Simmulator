import { Unzip, UnzipInflate } from 'fflate'

export const MAX_ARCHIVE_BYTES = 48 * 1024 * 1024
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024
// 256 sources + 256 colors + 64 light/dark image sets already exceed 512.
// Leave room for scaffolding and directory entries; byte/inflation limits still apply.
export const MAX_ARCHIVE_ENTRIES = 2048
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let n = 0; n < 8; n++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1))
  return value >>> 0
})
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!
  return (crc ^ 0xffffffff) >>> 0
}
const decoder = new TextDecoder('utf-8', { fatal: true })
function pathKey(path: string): string {
  const parts = path.replace(/\/$/, '').split('/')
  if (path.length > 1024 || /[\\:]/.test(path) || Array.from(path).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || parts.some(p => !p || p === '.' || p === '..')) throw new Error('That archive contains an unsafe path.')
  return parts.join('/').normalize('NFC').toLowerCase()
}
/** Inspect the complete directory first; streaming inflation then enforces actual sizes and CRC. */
export function readArchiveEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const fail = () => { throw new Error('That file is not a readable zip archive. It may be incomplete or corrupt.') }
  if (bytes.length < 22) return fail()
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('That archive is too large. The limit is 48 MB.')
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= Math.max(0, bytes.length - 65557) && (data.getUint32(end, true) !== 0x06054b50 || end + 22 + data.getUint16(end + 20, true) !== bytes.length)) end--
  if (end < Math.max(0, bytes.length - 65557)) return fail()
  if (data.getUint16(end + 4, true) || data.getUint16(end + 6, true) || data.getUint16(end + 8, true) !== data.getUint16(end + 10, true)) return fail()
  const count = data.getUint16(end + 10, true), start = data.getUint32(end + 16, true)
  if (count > MAX_ARCHIVE_ENTRIES) throw new Error('That archive has too many entries.')
  if (start + data.getUint32(end + 12, true) !== end) return fail()
  const headers = new Map<string, { size: number; crc: number; selected: boolean; offset: number }>(), paths = new Set<string>(), offsets = new Set<number>()
  let position = start, declared = 0, swiftBytes = 0
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || data.getUint32(position, true) !== 0x02014b50) return fail()
    const length = data.getUint16(position + 28, true), extra = data.getUint16(position + 30, true), comment = data.getUint16(position + 32, true), next = position + 46 + length + extra + comment
    if (next > end || data.getUint16(position + 8, true) & 1) return fail()
    const path = decoder.decode(bytes.subarray(position + 46, position + 46 + length)), key = pathKey(path)
    if (paths.has(key)) throw new Error('That archive contains duplicate or case-colliding paths.')
    paths.add(key)
    const offset = data.getUint32(position + 42, true), size = data.getUint32(position + 24, true)
    if (offset + 30 > start || offsets.has(offset) || data.getUint32(offset, true) !== 0x04034b50) return fail()
    offsets.add(offset)
    const localLength = data.getUint16(offset + 26, true), localExtra = data.getUint16(offset + 28, true)
    if (offset + 30 + localLength + localExtra + data.getUint32(position + 20, true) > start || decoder.decode(bytes.subarray(offset + 30, offset + 30 + localLength)) !== path || data.getUint16(offset + 8, true) !== data.getUint16(position + 10, true)) return fail()
    if ((data.getUint32(position + 38, true) >>> 16 & 0xf000) === 0xa000) throw new Error('That archive contains a symbolic link.')
    const selected = /\.(swift|json|png|jpe?g)$/i.test(path)
    if (selected) declared += size
    if (path.endsWith('.swift')) swiftBytes += size
    if (swiftBytes > 8 * 1024 * 1024) throw new Error('That archive holds more Swift than a project can.')
    if (declared > MAX_EXPANDED_BYTES || selected && size > (path.endsWith('.json') ? 22 : path.endsWith('.swift') ? 8 : 4) * 1024 * 1024) throw new Error('That archive expands beyond the project resource limits.')
    headers.set(path, { size, crc: data.getUint32(position + 16, true), selected, offset })
    position = next
  }
  if (position !== end) return fail()
  const result = new Map<string, Uint8Array>(), seen = new Set<string>()
  let total = 0, swiftTotal = 0
  const archive = new Unzip(file => {
    const header = headers.get(file.name)
    if (!header || seen.has(file.name)) return fail()
    seen.add(file.name)
    if (!header.selected) return
    let length = 0
    const chunks: Uint8Array[] = []
    file.ondata = (error, chunk, final) => {
      if (error) throw error
      length += chunk.length; total += chunk.length
      if (file.name.endsWith('.swift')) swiftTotal += chunk.length
      if (swiftTotal > 8 * 1024 * 1024) throw new Error('That archive holds more Swift than a project can.')
      if (total > MAX_EXPANDED_BYTES || length > header.size) return fail()
      chunks.push(chunk)
      if (final) {
        const joined = new Uint8Array(length)
        let offset = 0
        for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length }
        if (length !== header.size || crc32(joined) !== header.crc) return fail()
        result.set(file.name, joined)
      }
    }
    file.start()
  })
  archive.register(UnzipInflate)
  for (let offset = 0; offset < bytes.length; offset += 256) archive.push(bytes.subarray(offset, offset + 256), offset + 256 >= bytes.length)
  if (seen.size !== headers.size || [...headers].some(([path, h]) => h.selected && !result.has(path))) return fail()
  return result
}
