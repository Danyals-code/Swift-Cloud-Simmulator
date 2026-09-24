import { zipSync } from 'fflate'
import type { Project } from '@studio/project-model'
import { buildExportBundle, encodeText, type ExportBundle } from './bundle'
import { buildPackageBundle, buildSwiftPMAppBundle, buildXcodeGenBundle, type ExportFormat } from './formats'
import { attachExportReview, type ExportReview } from './handoff-report'
import { targetRelativePath } from './pbxproj'
import { attachHandoff, type StudioBuild } from './portable'
import { assetCatalog } from './resources'

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

/** What an export can carry besides the project. */
export interface ExportOptions {
  /** The review screens and report; only the complete bundle has them. */
  readonly review?: ExportReview
  /** The Studio build making the export, written into it. */
  readonly build?: StudioBuild
}

export function exportProjectZip(project: Project, format: ExportFormat = 'xcodeproj', { review, build }: ExportOptions = {}): Uint8Array {
  const name = project.manifest.name, root = format === 'swiftpm' ? `${name}.swiftpm` : name
  const sourceRoot = format === 'xcodeproj' ? `${root}/${name}` : format === 'xcodegen' ? `${root}/Sources` : `${root}/Sources/${name}`
  const catalog = `${sourceRoot}/${format === 'spm' || format === 'swiftpm' ? 'Resources/' : ''}Assets.xcassets`
  const bundle = attachHandoff(project, bundleFor(project, format), root, id => `${sourceRoot}/${targetRelativePath(id)}`, catalog, build)
  if (review && format !== 'xcodeproj') throw new Error('The complete bundle uses the Xcode project format.')
  return zipBundle(review ? attachExportReview(project, bundle, review, build) : bundle)
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

/** Portable designer document, kept separate from the four native export choices. */
export function exportEditableZip(project: Project, build?: StudioBuild): Uint8Array {
  const root = project.manifest.name
  const files = assetCatalog(project, `${root}/Assets.xcassets`)
  for (const file of project.files) files.set(`${root}/${file.id}`, encodeText(file.text))
  return zipBundle(attachHandoff(project, files, root, id => `${root}/${id}`, `${root}/Assets.xcassets`, build))
}
