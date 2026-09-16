import type { FileId, SourceFile } from '@studio/shared'
import type { DeviceKey } from '@studio/sim-shell'

export interface ProjectManifest {
  /** Display name and the Xcode target name. */
  readonly name: string
  /** e.g. `com.example.CounterApp` */
  readonly bundleId: string
  /** e.g. `17.0` */
  readonly deploymentTarget: string
  readonly device: DeviceKey
  readonly colorScheme: 'light' | 'dark'
}

export interface Project {
  readonly id: string
  readonly manifest: ProjectManifest
  readonly files: readonly SourceFile[]
  /**
   * Groups that hold nothing yet.
   *
   * A folder with files in it needs no record: it is implied by their paths, and
   * storing it twice is a chance for the two to disagree. An *empty* one has
   * nothing to be implied by, and "New Group, then drag files into it" is the
   * order people actually work in - so the empty case, and only the empty case,
   * is written down.
   */
  readonly folders?: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ProjectSummary {
  readonly id: string
  readonly name: string
  readonly updatedAt: number
  readonly fileCount: number
}

/**
 * Persistence boundary.
 *
 * v0.1 is local-only (decision Q3): the sole implementation is IndexedDB, there is
 * no account and no server. The interface exists anyway so that Phase 7b can add a
 * cloud-backed store without touching a single call site - the alternative is
 * IndexedDB calls sprayed through the UI, which is exactly the rework we want to
 * avoid paying for later.
 */
export interface ProjectStore {
  list(): Promise<readonly ProjectSummary[]>
  load(id: string): Promise<Project | null>
  save(project: Project): Promise<void>
  remove(id: string): Promise<void>
}

export function summarize(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.manifest.name,
    updatedAt: project.updatedAt,
    fileCount: project.files.length,
  }
}

export function findFile(project: Project, id: FileId): SourceFile | undefined {
  return project.files.find((f) => f.id === id)
}

/** Returns a new Project with `fileId`'s text replaced. Does not mutate. */
export function withFileText(project: Project, fileId: FileId, text: string): Project {
  return {
    ...project,
    files: project.files.map((f) => (f.id === fileId ? { ...f, text } : f)),
    updatedAt: Date.now(),
  }
}

/**
 * File operations.
 *
 * All non-mutating, and all validating their own preconditions, because the store
 * that calls them is driven by a text field the user can type anything into. A
 * rejected operation returns the project unchanged rather than throwing - there is
 * nothing useful for the UI to do with an exception here.
 */

export const SOURCE_DIR = 'Sources'

/**
 * Control characters, checked numerically: a regex range for them is unreadable,
 * and lint rightly objects to one.
 */
function hasControlCharacters(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * The longest project name worth accepting.
 *
 * Not a filesystem limit - it is a limit on how much of a zip entry's path one
 * field can be. Every entry in the archive begins with this name twice over.
 */
const MAX_PROJECT_NAME = 64

/**
 * Rejects a project name that would escape the archive or confuse a filesystem.
 *
 * A project name is a single directory name, so unlike a file id it may not contain
 * a separator at all: every path in the exported bundle starts with it, most of them
 * twice, and a `/` in it would move the whole project somewhere else.
 *
 * Its own function rather than a reuse of `cleanSegmentPath`, because that one's job
 * is to accept a *path* - `Models/Item` is a fine file name and a terrible project
 * name, and the difference is exactly the separator.
 */
export function normalizeProjectName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_PROJECT_NAME) return null

  if (trimmed.includes('/') || trimmed.includes('\\')) return null
  if (trimmed.includes('..')) return null
  if (/[<>:"|?*]/.test(trimmed)) return null
  if (hasControlCharacters(trimmed)) return null
  // A name that is only dots is a path pretending to be a name.
  if (/^\.+$/.test(trimmed)) return null

  return trimmed
}

/**
 * Rejects anything that would escape the project or confuse a filesystem.
 *
 * Shared by the file and folder normalisers so the two cannot drift: a character
 * legal in a group name and illegal in a file name underneath it would produce a
 * path that exports to something Xcode refuses to open.
 */
function cleanSegmentPath(name: string): string | null {
  const trimmed = name.trim().replace(/^\/+|\/+$/g, '')
  if (trimmed.length === 0) return null

  if (trimmed.includes('..') || trimmed.includes('//')) return null
  if (/[<>:"\\|?*]/.test(trimmed)) return null
  if (hasControlCharacters(trimmed)) return null
  // A segment that is only dots or only spaces is a path that looks like a name.
  if (trimmed.split('/').some((segment) => segment.length === 0 || /^\.+$/.test(segment))) {
    return null
  }

  return trimmed
}

/**
 * Normalises a user-typed name into a workspace path.
 *
 * Everything lands under `Sources/`, including a name that already carries
 * folders. It previously did not: `Models/Item` became `Models/Item.swift`, a
 * sibling of `Sources` rather than a file inside it, which then exported to a
 * different place in the target than every other file. The `/` in a typed name
 * means "in this group", never "next to the group".
 */
export function normalizeFileName(name: string, parentFolder?: string): FileId | null {
  const cleaned = cleanSegmentPath(name)
  if (cleaned === null) return null

  const withExtension = cleaned.endsWith('.swift') ? cleaned : `${cleaned}.swift`
  if (withExtension.startsWith(`${SOURCE_DIR}/`)) return withExtension

  const parent = parentFolder ? normalizeFolderPath(parentFolder) : null
  return parent ? `${parent}/${withExtension}` : `${SOURCE_DIR}/${withExtension}`
}

/** Normalises a user-typed group name into a workspace folder path. */
export function normalizeFolderPath(name: string, parentFolder?: string): string | null {
  const cleaned = cleanSegmentPath(name)
  if (cleaned === null) return null
  if (cleaned.endsWith('.swift')) return null
  if (cleaned === SOURCE_DIR || cleaned.startsWith(`${SOURCE_DIR}/`)) return cleaned

  const parent = parentFolder ? normalizeFolderPath(parentFolder) : null
  return parent ? `${parent}/${cleaned}` : `${SOURCE_DIR}/${cleaned}`
}

/** The type name a new file's starter content should declare. */
export function typeNameFor(fileId: FileId): string {
  const base = fileId.slice(fileId.lastIndexOf('/') + 1).replace(/\.swift$/, '')
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, '')
  const name = cleaned.length > 0 ? cleaned : 'NewView'
  return /^[0-9]/.test(name) ? `View${name}` : name
}

export function starterContentFor(fileId: FileId): string {
  const name = typeNameFor(fileId)
  return `import SwiftUI

struct ${name}: View {
    var body: some View {
        Text("${name}")
    }
}
`
}

export function addFile(project: Project, fileId: FileId, text?: string): Project {
  if (project.files.some((f) => f.id === fileId)) return project
  return {
    ...project,
    files: [...project.files, { id: fileId, text: text ?? starterContentFor(fileId) }],
    updatedAt: Date.now(),
  }
}

export function renameFile(project: Project, from: FileId, to: FileId): Project {
  if (from === to) return project
  if (!project.files.some((f) => f.id === from)) return project
  if (project.files.some((f) => f.id === to)) return project

  return {
    ...project,
    files: project.files.map((f) => (f.id === from ? { ...f, id: to } : f)),
    updatedAt: Date.now(),
  }
}

/**
 * Removes a file.
 *
 * Refuses to remove the last one: a project with no sources has nothing to show and
 * no way back, and "undo" does not exist yet.
 */
export function removeFile(project: Project, fileId: FileId): Project {
  if (project.files.length <= 1) return project
  if (!project.files.some((f) => f.id === fileId)) return project

  return {
    ...project,
    files: project.files.filter((f) => f.id !== fileId),
    updatedAt: Date.now(),
  }
}

/** Display name: the last path segment. */
export function fileBasename(fileId: FileId): string {
  return fileId.slice(fileId.lastIndexOf('/') + 1)
}

/** The folder a path sits in, or `''` for one at the workspace root. */
export function dirname(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}

/**
 * Groups.
 *
 * Xcode calls them groups and the studio shows them as folders; they are the same
 * thing, and both names appear below because the export talks about one and the
 * navigator about the other.
 */

/**
 * Every folder in the project, deepest last.
 *
 * Derived from the files' own paths, plus the explicitly-recorded empty ones. A
 * file at `Sources/Features/Discover/View.swift` implies three folders, all of
 * which have to exist for the navigator to have somewhere to draw it.
 */
export function folderPaths(project: Project): readonly string[] {
  const out = new Set<string>()

  const record = (path: string) => {
    const segments = path.split('/')
    for (let i = 1; i <= segments.length; i++) out.add(segments.slice(0, i).join('/'))
  }

  for (const file of project.files) {
    const folder = dirname(file.id)
    if (folder) record(folder)
  }
  for (const folder of project.folders ?? []) record(folder)

  return [...out].sort()
}

/** True when `path` is `folder` itself or lies inside it. */
export function isInFolder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

/**
 * Adds an empty group.
 *
 * A no-op when the folder already exists in either form - recorded, or implied by
 * a file - so creating a group twice cannot produce two of it.
 */
export function addFolder(project: Project, path: string): Project {
  if (folderPaths(project).includes(path)) return project
  return {
    ...project,
    folders: [...(project.folders ?? []), path],
    updatedAt: Date.now(),
  }
}

/**
 * Renames a group, carrying everything inside it.
 *
 * Every descendant file and every recorded sub-folder is rewritten, because a
 * rename that moved only the group would leave its contents pointing at a path
 * that no longer exists. Refuses a destination that already exists rather than
 * merging two groups silently.
 */
export function renameFolder(project: Project, from: string, to: string): Project {
  if (from === to) return project

  const existing = folderPaths(project)
  if (!existing.includes(from)) return project
  if (existing.includes(to)) return project
  // Renaming a group into its own descendant would orphan everything under it.
  if (isInFolder(to, from)) return project

  const rewrite = (path: string) => (isInFolder(path, from) ? to + path.slice(from.length) : path)

  return {
    ...project,
    files: project.files.map((file) => ({ ...file, id: rewrite(file.id) })),
    folders: (project.folders ?? []).map(rewrite),
    updatedAt: Date.now(),
  }
}

/**
 * Removes a group and everything in it.
 *
 * Refuses when that would empty the project, for the same reason `removeFile`
 * does: a project with no sources has nothing to show and no way back, and undo
 * does not exist yet.
 */
export function removeFolder(project: Project, path: string): Project {
  if (!folderPaths(project).includes(path)) return project

  const kept = project.files.filter((file) => !isInFolder(file.id, path))
  if (kept.length === 0) return project

  return {
    ...project,
    files: kept,
    folders: (project.folders ?? []).filter((folder) => !isInFolder(folder, path)),
    updatedAt: Date.now(),
  }
}

/**
 * A file id not already taken, by appending ` 2`, ` 3`, … before the extension.
 *
 * Xcode's own answer to a name collision, and the reason a move into a folder that
 * already holds that name succeeds instead of refusing.
 */
export function uniqueFileId(project: Project, wanted: FileId): FileId {
  const taken = new Set(project.files.map((f) => f.id))
  if (!taken.has(wanted)) return wanted

  const folder = dirname(wanted)
  const base = fileBasename(wanted).replace(/\.swift$/, '')
  const prefix = folder ? `${folder}/` : ''

  for (let n = 2; n < 1000; n++) {
    const candidate = `${prefix}${base} ${n}.swift`
    if (!taken.has(candidate)) return candidate
  }
  return `${prefix}${base} ${Date.now()}.swift`
}

/** Moves a file into a folder, renaming around a collision rather than refusing. */
export function moveFile(project: Project, fileId: FileId, folder: string): Project {
  if (!project.files.some((f) => f.id === fileId)) return project
  if (dirname(fileId) === folder) return project

  const target = uniqueFileId(project, `${folder}/${fileBasename(fileId)}`)
  return {
    ...project,
    files: project.files.map((file) => (file.id === fileId ? { ...file, id: target } : file)),
    updatedAt: Date.now(),
  }
}

/** Copies a file beside itself under an unused name. */
export function duplicateFile(project: Project, fileId: FileId): Project {
  const source = project.files.find((f) => f.id === fileId)
  if (!source) return project

  return {
    ...project,
    files: [...project.files, { id: uniqueFileId(project, fileId), text: source.text }],
    updatedAt: Date.now(),
  }
}

export type TreeNode =
  | { readonly kind: 'folder'; readonly path: string; readonly name: string; readonly children: readonly TreeNode[] }
  | { readonly kind: 'file'; readonly id: FileId; readonly name: string }

/**
 * The navigator's tree.
 *
 * Built here rather than in the component because it is pure, it is the thing the
 * folder operations above have to agree with, and a test can assert on it without
 * rendering anything.
 *
 * Groups sort before files and each sorts by name, which is the convention every
 * file tree people have used follows. Xcode intermixes them; it is also the one
 * thing everybody immediately re-sorts.
 */
export function buildFileTree(project: Project): readonly TreeNode[] {
  const folders = folderPaths(project)
  const childFolders = new Map<string, string[]>()
  const childFiles = new Map<string, FileId[]>()

  for (const folder of folders) {
    const bucket = childFolders.get(dirname(folder))
    if (bucket) bucket.push(folder)
    else childFolders.set(dirname(folder), [folder])
  }

  for (const file of project.files) {
    const folder = dirname(file.id)
    const bucket = childFiles.get(folder)
    if (bucket) bucket.push(file.id)
    else childFiles.set(folder, [file.id])
  }

  const byName = (a: string, b: string) =>
    fileBasename(a).localeCompare(fileBasename(b), undefined, { numeric: true })

  const build = (parent: string): readonly TreeNode[] => [
    ...(childFolders.get(parent) ?? [])
      .sort(byName)
      .map((path): TreeNode => ({
        kind: 'folder',
        path,
        name: fileBasename(path),
        children: build(path),
      })),
    ...(childFiles.get(parent) ?? [])
      .sort(byName)
      .map((id): TreeNode => ({ kind: 'file', id, name: fileBasename(id) })),
  ]

  return build('')
}
