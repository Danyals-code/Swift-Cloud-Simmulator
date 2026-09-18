import { normalizeFileName, type OpenedFile } from '@studio/project-model'

/** Decode the entire selection before opening it. Blob.text() would discard a UTF-8 BOM. */
export async function readSwiftFiles(picked: readonly File[]): Promise<readonly OpenedFile[]> {
  const files = picked.filter(file => file.name.endsWith('.swift'))
  if (!files.length) throw new Error('Pick .swift files, or a project ZIP archive.')
  if (files.length > 256 || files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) throw new Error('Open at most 256 Swift files, totaling no more than 8 MB.')
  const ids = files.map(file => normalizeFileName(file.name)?.normalize('NFC').toLowerCase())
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('These files have invalid or colliding names. Use unique names or open a ZIP that preserves their folders.')
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    return await Promise.all(files.map(async file => ({ name: file.name, text: decoder.decode(await file.arrayBuffer()) })))
  } catch { throw new Error('A Swift file could not be read as UTF-8. Save it with UTF-8 encoding and try again; no files were opened.') }
}
