'use client'

import { create } from 'zustand'
import {
  addFile,
  createDefaultProject,
  createProjectFromTemplate,
  createProjectStore,
  DEFAULT_PROJECT_ID,
  normalizeFileName,
  removeFile,
  renameFile,
  templateById,
  withFileText,
  type Project,
  type ProjectStore,
} from '@studio/project-model'
import type { DeviceKey } from '@studio/sim-shell'
import type { FileId } from '@studio/shared'

const AUTOSAVE_MS = 500

let store: ProjectStore | null = null
function persistence(): ProjectStore {
  store ??= createProjectStore()
  return store
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Preview settings live outside the project: they describe how you are looking at it. */
export interface PreviewSettings {
  readonly colorScheme: 'light' | 'dark'
  /** Dynamic Type multiplier, 1 = the Large default. */
  readonly typeScale: number
}

export interface StudioState {
  project: Project | null
  activeFileId: FileId | null
  /** Files the user has opened, in tab order. */
  openFileIds: FileId[]
  /** false until the first load resolves; avoids flashing the template over saved work */
  loaded: boolean
  lastSavedAt: number | null
  preview: PreviewSettings

  load: () => Promise<void>
  flush: () => Promise<void>
  setFileText: (fileId: FileId, text: string) => void
  setActiveFile: (fileId: FileId) => void
  closeFile: (fileId: FileId) => void

  createFile: (name: string) => FileId | null
  renameActiveFile: (name: string) => void
  deleteFile: (fileId: FileId) => void

  setDevice: (device: DeviceKey) => void
  setPreview: (settings: Partial<PreviewSettings>) => void
  applyTemplate: (templateId: string) => void
}

export const useStudio = create<StudioState>((set, get) => {
  /**
   * Debounced write-behind. The editor stays responsive and IndexedDB sees one write
   * per pause rather than one per keystroke. `flush` exists so `visibilitychange` and
   * `pagehide` can force the pending write before the tab goes away — the case where
   * a naive debounce quietly loses the last few seconds of work.
   */
  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void get().flush(), AUTOSAVE_MS)
  }

  function commit(project: Project, activeFileId?: FileId): void {
    const open = get().openFileIds.filter((id) => project.files.some((f) => f.id === id))
    const active = activeFileId ?? get().activeFileId
    const resolvedActive =
      active && project.files.some((f) => f.id === active) ? active : (project.files[0]?.id ?? null)

    set({
      project,
      activeFileId: resolvedActive,
      openFileIds: resolvedActive && !open.includes(resolvedActive) ? [...open, resolvedActive] : open,
    })
    scheduleSave()
  }

  return {
    project: null,
    activeFileId: null,
    openFileIds: [],
    loaded: false,
    lastSavedAt: null,
    preview: { colorScheme: 'light', typeScale: 1 },

    async load() {
      const existing = await persistence().load(DEFAULT_PROJECT_ID)
      const project = existing ?? createDefaultProject()
      const first = project.files[0]?.id ?? null

      set({
        project,
        activeFileId: first,
        openFileIds: first ? [first] : [],
        loaded: true,
      })
      if (!existing) await persistence().save(project)
    },

    async flush() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const { project } = get()
      if (!project) return
      await persistence().save(project)
      set({ lastSavedAt: Date.now() })
    },

    setFileText(fileId, text) {
      const { project } = get()
      if (!project) return
      set({ project: withFileText(project, fileId, text) })
      scheduleSave()
    },

    setActiveFile(fileId) {
      const { openFileIds } = get()
      set({
        activeFileId: fileId,
        openFileIds: openFileIds.includes(fileId) ? openFileIds : [...openFileIds, fileId],
      })
    },

    closeFile(fileId) {
      const { openFileIds, activeFileId, project } = get()
      const remaining = openFileIds.filter((id) => id !== fileId)

      // Closing the active tab focuses its neighbour, which is what every editor does
      // and what the muscle memory expects.
      const fallback =
        activeFileId === fileId
          ? (remaining[Math.max(0, openFileIds.indexOf(fileId) - 1)] ??
            project?.files[0]?.id ??
            null)
          : activeFileId

      set({ openFileIds: remaining, activeFileId: fallback })
    },

    createFile(name) {
      const { project } = get()
      if (!project) return null

      const fileId = normalizeFileName(name)
      if (!fileId) return null
      if (project.files.some((f) => f.id === fileId)) return null

      commit(addFile(project, fileId), fileId)
      return fileId
    },

    renameActiveFile(name) {
      const { project, activeFileId } = get()
      if (!project || !activeFileId) return

      const target = normalizeFileName(name)
      if (!target || target === activeFileId) return

      const renamed = renameFile(project, activeFileId, target)
      if (renamed === project) return

      set({ openFileIds: get().openFileIds.map((id) => (id === activeFileId ? target : id)) })
      commit(renamed, target)
    },

    deleteFile(fileId) {
      const { project } = get()
      if (!project) return

      const next = removeFile(project, fileId)
      if (next === project) return

      set({ openFileIds: get().openFileIds.filter((id) => id !== fileId) })
      commit(next)
    },

    setDevice(device) {
      const { project } = get()
      if (!project) return
      commit({ ...project, manifest: { ...project.manifest, device }, updatedAt: Date.now() })
    },

    setPreview(settings) {
      set({ preview: { ...get().preview, ...settings } })
    },

    applyTemplate(templateId) {
      const template = templateById(templateId)
      if (!template) return

      const project = createProjectFromTemplate(template)
      const first = project.files[0]?.id ?? null
      set({ project, activeFileId: first, openFileIds: first ? [first] : [] })
      scheduleSave()
    },
  }
})
