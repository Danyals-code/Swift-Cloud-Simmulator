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
 * cloud-backed store without touching a single call site — the alternative is
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
 * rejected operation returns the project unchanged rather than throwing — there is
 * nothing useful for the UI to do with an exception here.
 */

export const SOURCE_DIR = 'Sources'

/** Normalises a user-typed name into a workspace path. */
export function normalizeFileName(name: string): FileId | null {
  const trimmed = name.trim().replace(/^\/+|\/+$/g, '')
  if (trimmed.length === 0) return null

  // Reject anything that would escape the project or collide with a directory.
  if (trimmed.includes('..') || trimmed.endsWith('/')) return null
  if (/[<>:"\\|?*]/.test(trimmed)) return null
  // Control characters, checked numerically: a regex range for them is unreadable,
  // and lint rightly objects to one.
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return null
  }

  const withExtension = trimmed.endsWith('.swift') ? trimmed : `${trimmed}.swift`
  return withExtension.includes('/') ? withExtension : `${SOURCE_DIR}/${withExtension}`
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
