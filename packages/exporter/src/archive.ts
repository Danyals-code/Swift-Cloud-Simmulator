import type { Project } from '@studio/project-model'
import { projectBackup } from '@studio/project-model/backup'
import { EXPORT_FORMATS, type ArchiveFormat, type ExportFormat } from '@studio/shared'
import { withoutStudioMarkers } from '@studio/swift-syntax/markers'
import { encodeText } from './bundle'
import { MAX_BUNDLE_BYTES, MAX_SCREEN_BYTES, type ExportReview } from './handoff-report'
import type { StudioBuild } from './portable'
import { exportEditableZip, exportProjectZip, zipBundle } from './zip'

export interface ArchiveRequest {
  readonly format: ArchiveFormat
  /** The complete bundle's screens and diagnostics. */
  readonly review?: ExportReview
  readonly build?: StudioBuild
  /** When the archive is made. */
  readonly now: Date
}

export interface Archive {
  /** What the download is called. */
  readonly name: string
  readonly bytes: Uint8Array
  /** What the archive leaves out, in plain words; empty when nothing is. */
  readonly issues: readonly string[]
}

/**
 * The archive for a format, whatever state the project is in.
 *
 * An export is the result of somebody's work, so it is never refused. When the checked
 * build fails, the Swift still goes out as it was written, with a note saying why the
 * rest could not be built.
 */
export function exportArchive(stored: Project, { format, review, build, now }: ArchiveRequest): Archive {
  const project = withCurrentBundleId(stored)
  const name = archiveName(project, format, now)
  const captured = format === 'complete' && review ? usableScreens(review, project) : undefined
  const issues = captured?.issues ?? []
  try {
    const bytes = format === 'editable' ? exportEditableZip(project, build) : exportProjectZip(project, format === 'complete' ? 'xcodeproj' : format, { review: captured, build })
    return { name, bytes, issues }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { name, bytes: sourcesOnly(project, reason, build, format !== 'editable'), issues: [...issues, reason] }
  }
}

/**
 * The project as it goes out, its bundle identifier following the app's name.
 *
 * A project keeps the identifier it was created with, `com.example.MyDesignApp`, however
 * often it is renamed since, so the export names it after the app as it is called now.
 * One somebody chose, outside com.example, stays theirs, unless Xcode could not take it.
 */
function withCurrentBundleId(project: Project): Project {
  const { bundleId, name } = project.manifest
  if (!bundleId.startsWith('com.example.') && /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId)) return project
  // A name with no Latin letters, "카페", gets one from the project's own id, so two such apps don't install over each other.
  const segment = asciiName(name) || `App-${project.id.replace(/^p-/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`
  return { ...project, manifest: { ...project.manifest, bundleId: `com.example.${segment}` } }
}

/** The app's name in ASCII letters, digits and hyphens, as a bundle identifier takes it: "Café & Co" is "Cafe-Co". */
function asciiName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** How a download's name ends: the four formats' own suffixes, and these two. */
const SUFFIX: Readonly<Record<ArchiveFormat, string>> = {
  ...Object.fromEntries(EXPORT_FORMATS.map(format => [format.id, format.suffix])) as Record<ExportFormat, string>,
  complete: '-complete.zip',
  editable: '.swiftstudio.zip',
}

/**
 * "Café-Co-20260924-1630-complete.zip": the app, the minute it was exported on the
 * exporter's clock, and what it holds. Somebody exporting three apps, or one app three
 * times, gets files a reader can tell apart without opening them.
 */
function archiveName(project: Project, format: ArchiveFormat, now: Date): string {
  const two = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
  const name = project.manifest.name.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  return `${name || 'Project'}-${stamp}${SUFFIX[format]}`
}

/** What a complete bundle holds besides its screens, at most: the Swift twice (the sources and the project record), the images, and the scaffolding, report and chat around them. */
function bundleBytesBesidesScreens(project: Project): number {
  const swift = project.files.reduce((total, file) => total + encodeText(file.text).length, 0)
  const images = (project.assets ?? []).reduce((total, asset) => total + asset.light.bytes.length + (asset.dark?.bytes.length ?? 0), 0)
  return 2 * swift + images + 2 * 1024 * 1024
}

/** The capture without the images an archive can't take, in order until it is full, and with why each other one is missing. */
function usableScreens(review: ExportReview, project: Project): ExportReview & { readonly issues: readonly string[] } {
  const issues = [...review.issues ?? []]
  let room = MAX_BUNDLE_BYTES - bundleBytesBesidesScreens(project)
  const screens = review.screens.filter(screen => {
    if (screen.png.length > MAX_SCREEN_BYTES) issues.push(`The image of ${screen.name} was over 4 MB, so it was left out.`)
    else if (!screen.png.length) issues.push(`The image of ${screen.name} came out empty, so it was left out.`)
    else if (screen.png.length > room) issues.push(`The image of ${screen.name} was left out, to keep the archive under 60 MB.`)
    else { room -= screen.png.length; return true }
    return false
  })
  if (!screens.length && !review.screens.length) issues.push('No screen images were captured.')
  return { ...review, screens, issues }
}

/**
 * The Swift as written, everything else in a backup, and why: what an export falls back to.
 *
 * The project it gets may be the one that failed its checks for having paths no archive
 * can hold, so each file keeps only the plain segments of its path, and a name another
 * file already has, in any letter case, gets a number. The backup is the one the recovery
 * screen hands over.
 */
function sourcesOnly(project: Project, reason: string, build: StudioBuild | undefined, native: boolean): Uint8Array {
  const root = plainSegments(project.manifest.name ?? '').replace(/\//g, '-') || 'Project'
  const taken = new Set(['known-issues.md', 'project-backup.json'])
  const files = new Map<string, Uint8Array>()
  for (const file of project.files) files.set(`${root}/${unusedPath(plainSegments(file.id) || 'Untitled.swift', taken)}`, encodeText(native ? withoutStudioMarkers(file.text) : file.text))
  files.set(`${root}/project-backup.json`, encodeText(projectBackup(project, build)))
  files.set(`${root}/KNOWN-ISSUES.md`, encodeText(`# What this export leaves out\n\nThe project could not be built into the format you chose, so this archive holds its Swift files exactly as they were written. project-backup.json holds everything else it had: images, colour sets, designer settings and the AI conversation.\n\nWhy: ${reason}\n`))
  return zipBundle(files)
}

/** A path with no step an extractor could follow out of its folder: no `..`, `.`, empty or drive segments. */
function plainSegments(path: string): string {
  return path.split(/[\\/]+/).filter(segment => segment && segment !== '.' && segment !== '..').map(segment => segment.replace(/:/g, '-')).join('/')
}

/** `path`, or `path` numbered before its extension when an earlier one has it in any letter case. */
function unusedPath(path: string, taken: Set<string>): string {
  const dot = path.lastIndexOf('.')
  const stem = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path, extension = path.slice(stem.length)
  const key = (candidate: string) => candidate.normalize('NFC').toLowerCase()
  let candidate = path
  for (let n = 2; taken.has(key(candidate)); n++) candidate = `${stem} ${n}${extension}`
  taken.add(key(candidate))
  return candidate
}
