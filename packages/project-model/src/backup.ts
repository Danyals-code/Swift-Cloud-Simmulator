/**
 * A project as one JSON file: what a download falls back to when nothing better can be made.
 *
 * The recovery screen hands it over when the studio's own code has failed, and an export
 * when the project fails the archive's checks. It holds the record whole, image bytes as
 * base64; nothing in the studio opens it again. A module of its own, with nothing else in
 * it, so the page's recovery code can use it without loading the rest of the project model.
 */
export function projectBackup(project: unknown, build?: { readonly commit: string; readonly builtAt: string }): string {
  return JSON.stringify({ format: 'swift-web-studio-backup', ...(build ? { build } : {}), project }, bytesAsBase64)
}

/** Image bytes survive JSON as base64 rather than as an object with a key per byte. */
function bytesAsBase64(_key: string, value: unknown): unknown {
  if (!(value instanceof Uint8Array)) return value
  let binary = ''
  for (let offset = 0; offset < value.length; offset += 8192) binary += String.fromCharCode(...value.subarray(offset, offset + 8192))
  return { base64: btoa(binary) }
}
