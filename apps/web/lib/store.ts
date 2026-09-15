'use client'

import { create } from 'zustand'

import {
  addFile,
  addFolder,
  createDefaultProject,
  createProjectFromTemplate,
  createProjectStore,
  decodeProject,
  DEFAULT_PROJECT_ID,
  dirname,
  duplicateFile,
  isInFolder,
  moveFile,
  payloadFromFragment,
  normalizeFileName,
  normalizeFolderPath,
  removeFile,
  removeFolder,
  renameFile,
  renameFolder,
  templateById,
  withFileText,
  type Project,
  type ProjectStore,
} from '@studio/project-model'
import type { DeviceKey } from '@studio/sim-shell'
import type { FileId, SourceSpan } from '@studio/shared'

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
  /** `'fit'`, or a numeric scale as a string. Not a number, so `'fit'` stays a value. */
  readonly zoom: string
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

  /** Creates a source file, inside `parentFolder` when one is given. */
  createFile: (name: string, parentFolder?: string) => FileId | null
  renameFile: (fileId: FileId, name: string) => void
  deleteFile: (fileId: FileId) => void
  duplicateFile: (fileId: FileId) => void

  createFolder: (name: string, parentFolder?: string) => string | null
  renameFolder: (path: string, name: string) => void
  deleteFolder: (path: string) => void
  /** Drag-and-drop in the navigator. Renames around a collision rather than failing. */
  moveFile: (fileId: FileId, folder: string) => void

  setDevice: (device: DeviceKey) => void
  setPreview: (settings: Partial<PreviewSettings>) => void
  /** Rewrites every span to `newName`, returning how many were changed. */
  renameSymbol: (spans: readonly SourceSpan[], newName: string) => number
  applyTemplate: (templateId: string) => void
}

export const useStudio = create<StudioState>((set, get) => {
  /**
   * Debounced write-behind. The editor stays responsive and IndexedDB sees one write
   * per pause rather than one per keystroke. `flush` exists so `visibilitychange` and
   * `pagehide` can force the pending write before the tab goes away - the case where
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
    preview: { colorScheme: 'light', typeScale: 1, zoom: 'fit' },

    async load() {
      // A share link wins over whatever is stored, because following one is an
      // explicit request to see *that* project. The fragment is then cleared, so a
      // later reload does not silently discard whatever the user has since typed.
      const shared = sharedProjectFromLocation()
      if (shared) {
        clearShareFragment()
        const first = shared.files[0]?.id ?? null
        set({
          project: shared,
          activeFileId: first,
          openFileIds: first ? [first] : [],
          loaded: true,
        })
        await persistence().save(shared)
        return
      }

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

    createFile(name, parentFolder) {
      const { project } = get()
      if (!project) return null

      const fileId = normalizeFileName(name, parentFolder)
      if (!fileId) return null
      if (project.files.some((f) => f.id === fileId)) return null

      commit(addFile(project, fileId), fileId)
      return fileId
    },

    /**
     * Renames a file, keeping it in its own group.
     *
     * A typed name with no slash means "call it this", not "move it to the root",
     * so the file's current folder is the parent unless the name names another.
     */
    renameFile(fileId, name) {
      const { project } = get()
      if (!project) return

      const target = normalizeFileName(name, dirname(fileId))
      if (!target || target === fileId) return

      const renamed = renameFile(project, fileId, target)
      if (renamed === project) return

      set({ openFileIds: get().openFileIds.map((id) => (id === fileId ? target : id)) })
      commit(renamed, get().activeFileId === fileId ? target : undefined)
    },

    deleteFile(fileId) {
      const { project } = get()
      if (!project) return

      const next = removeFile(project, fileId)
      if (next === project) return

      set({ openFileIds: get().openFileIds.filter((id) => id !== fileId) })
      commit(next)
    },

    duplicateFile(fileId) {
      const { project } = get()
      if (!project) return

      const next = duplicateFile(project, fileId)
      if (next === project) return

      // Focus the copy: duplicating is almost always the first step of editing it.
      const created = next.files.find((f) => !project.files.some((old) => old.id === f.id))
      commit(next, created?.id)
    },

    createFolder(name, parentFolder) {
      const { project } = get()
      if (!project) return null

      const path = normalizeFolderPath(name, parentFolder)
      if (!path) return null

      const next = addFolder(project, path)
      if (next === project) return null

      commit(next)
      return path
    },

    renameFolder(path, name) {
      const { project } = get()
      if (!project) return

      const target = normalizeFolderPath(name, dirname(path))
      if (!target || target === path) return

      const next = renameFolder(project, path, target)
      if (next === project) return

      // Open tabs name files by path, so every one inside the group has moved.
      const rewrite = (id: FileId) => (isInFolder(id, path) ? target + id.slice(path.length) : id)
      const active = get().activeFileId
      set({ openFileIds: get().openFileIds.map(rewrite) })
      commit(next, active ? rewrite(active) : undefined)
    },

    deleteFolder(path) {
      const { project } = get()
      if (!project) return

      const next = removeFolder(project, path)
      if (next === project) return

      set({ openFileIds: get().openFileIds.filter((id) => !isInFolder(id, path)) })
      commit(next)
    },

    moveFile(fileId, folder) {
      const { project } = get()
      if (!project) return

      const next = moveFile(project, fileId, folder)
      if (next === project) return

      const moved = next.files.find((f) => !project.files.some((old) => old.id === f.id))
      if (!moved) return

      set({ openFileIds: get().openFileIds.map((id) => (id === fileId ? moved.id : id)) })
      commit(next, get().activeFileId === fileId ? moved.id : undefined)
    },

    setDevice(device) {
      const { project } = get()
      if (!project) return
      commit({ ...project, manifest: { ...project.manifest, device }, updatedAt: Date.now() })
    },

    setPreview(settings) {
      set({ preview: { ...get().preview, ...settings } })
    },

    renameSymbol(spans, newName) {
      const { project } = get()
      if (!project || spans.length === 0 || !newName) return 0

      // Grouped by file and applied back to front, because every edit before a span
      // shifts the ones after it. Getting that backwards corrupts the file in a way
      // that looks like a parser bug.
      const byFile = new Map<FileId, { start: number; end: number }[]>()
      for (const span of spans) {
        const list = byFile.get(span.file) ?? []
        list.push({ start: span.start, end: span.end })
        byFile.set(span.file, list)
      }

      let next = project
      for (const [fileId, edits] of byFile) {
        const file = next.files.find((f) => f.id === fileId)
        if (!file) continue

        let text = file.text
        for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
          text = text.slice(0, edit.start) + newName + text.slice(edit.end)
        }
        next = withFileText(next, fileId, text)
      }

      set({ project: { ...next, updatedAt: Date.now() } })
      scheduleSave()
      return spans.length
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

/**
 * The project a share link carries, if the page was opened with one.
 *
 * Returns null for anything that is not a project - a truncated link, a stale format,
 * a fragment that belongs to something else. Falling back to the stored project is
 * the right response to all of them, and it is what a stranger's URL deserves.
 */
function sharedProjectFromLocation(): Project | null {
  if (typeof window === 'undefined') return null
  const payload = payloadFromFragment(window.location.hash)
  return payload ? decodeProject(payload, Date.now()) : null
}

/**
 * Removes the payload from the address bar once it has been read.
 *
 * Without this, a reload re-applies the link and silently discards whatever the user
 * has typed since following it - which is the kind of data loss that is only noticed
 * after it matters. `replaceState` rather than assignment, so the back button still
 * goes back to wherever they came from.
 */
function clearShareFragment(): void {
  if (typeof window === 'undefined') return
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}
