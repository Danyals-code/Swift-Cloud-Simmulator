'use client'

import { create } from 'zustand'
import {
  createDefaultProject,
  createProjectStore,
  DEFAULT_PROJECT_ID,
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

export interface StudioState {
  project: Project | null
  activeFileId: FileId | null
  /** false until the first load from IndexedDB resolves; avoids flashing the template over saved work */
  loaded: boolean
  lastSavedAt: number | null

  load: () => Promise<void>
  flush: () => Promise<void>
  setFileText: (fileId: FileId, text: string) => void
  setActiveFile: (fileId: FileId) => void
  setDevice: (device: DeviceKey) => void
  resetToTemplate: () => void
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

  return {
    project: null,
    activeFileId: null,
    loaded: false,
    lastSavedAt: null,

    async load() {
      const existing = await persistence().load(DEFAULT_PROJECT_ID)
      const project = existing ?? createDefaultProject()
      set({
        project,
        activeFileId: project.files[0]?.id ?? null,
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
      set({ activeFileId: fileId })
    },

    setDevice(device) {
      const { project } = get()
      if (!project) return
      set({
        project: { ...project, manifest: { ...project.manifest, device }, updatedAt: Date.now() },
      })
      scheduleSave()
    },

    resetToTemplate() {
      const project = createDefaultProject()
      set({ project, activeFileId: project.files[0]?.id ?? null })
      scheduleSave()
    },
  }
})
