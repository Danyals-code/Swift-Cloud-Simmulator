import { zipSync } from 'fflate'
import { attachHandoff } from './portable'
import { targetRelativePath } from './pbxproj'
import { assetCatalog } from './resources'
import { encodeText } from './bundle'
import { attachExportReview, type ExportReview } from './handoff-report'
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
export * from './import'
export * from './portable'
export { MAX_ARCHIVE_BYTES } from './archive-reader'
export * from './formats'
export { generatePbxproj, IdAllocator, targetRelativePath, type XcodeProjectPlan } from './pbxproj'
export { parsePlist, serializePlist, type PlistDict, type PlistValue } from './plist'
export * from './xcode-files'
export * from './handoff-report'

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

export function exportProjectZip(project: Project, format: ExportFormat = 'xcodeproj', review?: ExportReview): Uint8Array {
  const name = project.manifest.name, root = format === 'swiftpm' ? `${name}.swiftpm` : name
  const sourceRoot = format === 'xcodeproj' ? `${root}/${name}` : format === 'xcodegen' ? `${root}/Sources` : `${root}/Sources/${name}`
  const catalog = `${sourceRoot}/${format === 'spm' || format === 'swiftpm' ? 'Resources/' : ''}Assets.xcassets`
  const bundle = attachHandoff(project, bundleFor(project, format), root, id => `${sourceRoot}/${targetRelativePath(id)}`, catalog)
  if (review && format !== 'xcodeproj') throw new Error('The complete bundle uses the Xcode project format.')
  return zipBundle(review ? attachExportReview(project, bundle, review) : bundle)
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
export function downloadProjectZip(project: Project, format: ExportFormat = 'xcodeproj', review?: ExportReview): void {
  const bytes = exportProjectZip(project, format, review)
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

/** Portable designer document, kept separate from the four native export choices. */
export function exportEditableZip(project: Project): Uint8Array {
  const root = project.manifest.name
  const files = assetCatalog(project, `${root}/Assets.xcassets`)
  for (const file of project.files) files.set(`${root}/${file.id}`, encodeText(file.text))
  return zipBundle(attachHandoff(project, files, root, id => `${root}/${id}`, `${root}/Assets.xcassets`))
}
export function downloadEditableProject(project: Project): void {
  const url = URL.createObjectURL(new Blob([exportEditableZip(project).slice()], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url; a.download = `${project.manifest.name}.swiftstudio.zip`
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
