import { zipSync } from 'fflate'
import type { Project } from '@studio/project-model'
import { buildExportBundle, type ExportBundle } from './bundle'
import {
  buildPackageBundle,
  buildSwiftPMAppBundle,
  buildXcodeGenBundle,
  EXPORT_FORMATS,
  type ExportFormat,
} from './formats'

export * from './bundle'
export * from './formats'
export { generatePbxproj, IdAllocator, targetRelativePath, type XcodeProjectPlan } from './pbxproj'
export { parsePlist, serializePlist, type PlistDict, type PlistValue } from './plist'
export * from './xcode-files'

/** Zip an already-built bundle. Separated from `buildExportBundle` so tests can assert on file contents without unzipping. */
/**
 * A fixed timestamp for every entry, so the archive is reproducible.
 *
 * `fflate` stamps each file with `Date.now()` by default, which makes two exports of
 * the same project differ - quietly, and only when the calls happen to straddle a
 * second. That breaks Phase 5's gate 2 and, more to the point, makes a committed
 * export show a diff every time it is regenerated.
 *
 * 1980-01-01 is the earliest instant the ZIP format can represent, and the
 * conventional choice for reproducible archives.
 */
const FIXED_MTIME = Date.UTC(1980, 0, 1)

export function zipBundle(bundle: ExportBundle): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: number }]> = {}
  for (const [path, bytes] of bundle) entries[path] = [bytes, { mtime: FIXED_MTIME }]
  // Level 6 keeps a 50-file project comfortably inside the 2s budget (NFR-1).
  return zipSync(entries, { level: 6, mtime: FIXED_MTIME })
}

export function exportProjectZip(project: Project, format: ExportFormat = 'xcodeproj'): Uint8Array {
  return zipBundle(bundleFor(project, format))
}

/** The file set for a format. One switch, so a new format cannot be half-wired. */
export function bundleFor(project: Project, format: ExportFormat): ExportBundle {
  switch (format) {
    case 'swiftpm':
      return buildSwiftPMAppBundle(project)
    case 'spm':
      return buildPackageBundle(project)
    case 'xcodegen':
      return buildXcodeGenBundle(project)
    case 'xcodeproj':
      return buildExportBundle(project)
  }
}

export function zipFileName(project: Project, format: ExportFormat = 'xcodeproj'): string {
  const safe = project.manifest.name.replace(/[^A-Za-z0-9._-]/g, '-') || 'SwiftUIProject'
  const suffix = EXPORT_FORMATS.find((f) => f.id === format)?.suffix ?? '.zip'
  return `${safe}${suffix}`
}

/**
 * Trigger a browser download. Kept here rather than in the UI so the export path is
 * one call from a button handler.
 */
export function downloadProjectZip(project: Project, format: ExportFormat = 'xcodeproj'): void {
  const bytes = exportProjectZip(project, format)
  // Copy into a fresh ArrayBuffer - the fflate output may be a view over a larger pooled buffer.
  const blob = new Blob([bytes.slice()], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = zipFileName(project, format)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
