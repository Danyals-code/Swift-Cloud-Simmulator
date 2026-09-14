import { zipSync } from 'fflate'
import type { Project } from '@studio/project-model'
import { buildExportBundle, type ExportBundle } from './bundle'

export * from './bundle'

/** Zip an already-built bundle. Separated from `buildExportBundle` so tests can assert on file contents without unzipping. */
export function zipBundle(bundle: ExportBundle): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [path, bytes] of bundle) entries[path] = bytes
  // Level 6 keeps a 50-file project comfortably inside the 2s budget (NFR-1).
  return zipSync(entries, { level: 6 })
}

export function exportProjectZip(project: Project): Uint8Array {
  return zipBundle(buildExportBundle(project))
}

export function zipFileName(project: Project): string {
  const safe = project.manifest.name.replace(/[^A-Za-z0-9._-]/g, '-')
  return `${safe || 'SwiftUIProject'}.zip`
}

/**
 * Trigger a browser download. Kept here rather than in the UI so the export path is
 * one call from a button handler.
 */
export function downloadProjectZip(project: Project): void {
  const bytes = exportProjectZip(project)
  // Copy into a fresh ArrayBuffer — the fflate output may be a view over a larger pooled buffer.
  const blob = new Blob([bytes.slice()], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = zipFileName(project)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
