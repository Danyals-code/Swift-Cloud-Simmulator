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
