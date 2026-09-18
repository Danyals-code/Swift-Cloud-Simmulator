'use client'

import { create } from 'zustand'
import type { DynamicTypeSize } from '@studio/shared'

import {
  addFile,
  addFolder,
  createProjectStore,
  decodeProject,
  dirname,
  duplicateFile,
  isInFolder,
  isPristine,
  LEGACY_PROJECT_ID,
  moveFile,
  payloadFromFragment,
  normalizeFileName,
  normalizeProjectName,
  normalizeFolderPath,
  projectFromFiles,
  removeFile,
  removeFolder,
  renameFile,
  renameFolder,
  withFileText,
  type OpenedFile,
  type Project,
  type ProjectStore,
  type ProjectSummary,
} from '@studio/project-model'
import type { DeviceKey } from '@studio/sim-shell'
import type { FileId, SourceSpan } from '@studio/shared'

const AUTOSAVE_MS = 500

/**
 * Which project to reopen.
 *
 * In `localStorage` rather than in the database, because it is a fact about this
 * browser rather than about any project: reopening the last one is a preference, and
 * losing it costs one click on the welcome sheet.
 */
const LAST_OPENED_KEY = 'studio.lastOpened'

function rememberLastOpened(id: string): void {
  try {
    localStorage.setItem(LAST_OPENED_KEY, id)
  } catch {
    // Private windows and blocked site data. The sheet still lists everything.
  }
}

function lastOpenedId(): string | null {
  try {
    return localStorage.getItem(LAST_OPENED_KEY)
  } catch {
    return null
  }
}

/**
 * Loading the templates.
 *
 * Dynamic on purpose: the corpus is about 31 KB gzipped and nothing needs it until
 * somebody presses Create or arrives with nothing saved. Everything the welcome sheet
 * draws comes from the catalog, which is in the initial bundle and is a kilobyte.
 */
async function templates() {
  return import('@studio/project-model/templates')
}

let store: ProjectStore | null = null
function persistence(): ProjectStore {
  store ??= createProjectStore()
  return store
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * The first load, so it can only happen once.
 *
 * React runs an effect twice in development, and a `<StrictMode>` double-mount used
 * to be harmless here because every project was written to one fixed key: the second
 * load overwrote the first and nobody could tell. Now that a new project gets its own
 * id, two loads that both find an empty database mint *two* starter projects - and
 * the studio opens with a duplicate of itself in the recents list.
 *
 * Held at module scope rather than in the store, because the point is that it
 * survives a component remounting.
 */
let loading: Promise<void> | null = null

/**
 * Writes a project, returning what went wrong rather than throwing.
 *
 * Every caller here is fire-and-forget from a React effect, so a rejection would be
 * an unhandled one - which is to say invisible. IndexedDB is genuinely unavailable in
 * a private window in more than one browser, and a person whose work has stopped
 * being written needs to be told, not to find out on the next reload.
 */
async function writeProject(project: Project): Promise<string | null> {
  try {
    await persistence().save(project)
    return null
  } catch (error) {
    return error instanceof Error && error.message
      ? `Could not save: ${error.message}`
      : 'Could not save to this browser’s storage.'
  }
}

/** Preview settings live outside the project: they describe how you are looking at it. */
export interface PreviewSettings {
  readonly colorScheme: 'light' | 'dark'
  /** Dynamic Type multiplier, 1 = the Large default. */
  readonly typeScale: number
  readonly dynamicTypeSize?: DynamicTypeSize
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
  /**
   * What the first load found, which is what the welcome sheet reports.
   *
   * `'restored'` - work was already in this browser and is what you are looking at.
   * `'shared'`   - the page was opened with a link carrying a project.
   * `'fresh'`    - nothing was saved, so the starter project was laid down.
   *
   * The sheet needs all three: it offers to continue only in the first case, and it
   * does not open at all in the second, because following a link is already an
   * explicit request to see *that* project.
   */
  origin: 'restored' | 'shared' | 'fresh' | null
  /**
   * Every project in this browser, newest first.
   *
   * Refreshed whenever the set changes rather than watched, because the only thing
   * that reads it is the welcome sheet and the only thing that writes it is this
   * store. Empty until the first load resolves.
   */
  recents: readonly ProjectSummary[]
  lastSavedAt: number | null
  /**
   * Set when persistence failed, cleared by the next save that works.
   *
   * The editor keeps going either way - the project is in memory and the export does
   * not need the database - but silence was the wrong answer: work that is not being
   * written is exactly the thing a person needs told, and IndexedDB is off in a
   * private window in more than one browser.
   */
  saveError: string | null
  preview: PreviewSettings

  load: () => Promise<void>
  flush: () => Promise<void>
  setFileText: (fileId: FileId, text: string) => void
  setActiveFile: (fileId: FileId) => void
  closeFile: (fileId: FileId) => void

  /** Creates a source file, inside `parentFolder` when one is given. */
  createFile: (name: string, parentFolder?: string) => FileId | null
  renameFile: (fileId: FileId, name: string) => boolean
  renameProject: (name: string) => boolean
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
  /**
   * Creates a project from a template.
   *
   * Async because the sources are a separate chunk. Returns false when that chunk
   * could not be fetched - offline, or a deploy that moved it mid-session - so the
   * caller can say so. A Create button that silently does nothing is worse than one
   * that fails.
   */
  applyTemplate: (templateId: string) => Promise<boolean>
  /** Reopens one of the projects in this browser. */
  openProject: (id: string) => Promise<boolean>
  /** Deletes a project. Refuses the one that is open - close it by opening another. */
  removeProject: (id: string) => Promise<void>
  /**
   * Replaces the project with one built from files off the user's disk.
   *
   * Returns false when nothing usable was in the selection, so the caller can say so
   * rather than presenting an empty project as a successful open.
   */
  openFiles: (files: readonly OpenedFile[]) => Promise<boolean>
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

  /**
   * Swaps the whole project out: a template, or files opened off the disk.
   *
   * Every tab is closed rather than filtered, because none of them name a file that
   * still exists, and the write is immediate rather than debounced - a replacement is
   * a decision, not a keystroke, and a reload half a second later must not bring the
   * old project back.
   */
  async function replace(project: Project): Promise<void> {
    // Keep the latest keystrokes in the outgoing project's saved copy.
    await get().flush()
    const outgoing = get().project
    const first = project.files[0]?.id ?? null

    set({
      project,
      activeFileId: first,
      openFileIds: first ? [first] : [],
      origin: 'restored',
    })
    rememberLastOpened(project.id)
    await get().flush()

    /**
     * What happens to what was open.
     *
     * Kept, unless it is still exactly what it was created as. A project somebody
     * worked on is the one thing here that cannot be recreated, so it stays in the
     * list; a template nobody touched can be made again in two clicks, and keeping
     * one per click would fill the list with things nobody chose to keep.
     */
    if (outgoing && outgoing.id !== project.id) {
      const untouched = outgoing.manifest.templateId !== undefined && isPristine(outgoing)
      if (untouched) {
        try {
          await persistence().remove(outgoing.id)
        } catch {
          // A project that could not be deleted is a stale row, not lost work.
        }
      }
    }
    await refreshRecents()
  }

  /** Re-reads the list the welcome sheet shows. Failure leaves the old list up. */
  async function refreshRecents(): Promise<void> {
    try {
      set({ recents: await persistence().list() })
    } catch {
      // The sheet still offers the templates and the file picker.
    }
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

  /**
   * The body of the first load, run exactly once by `load` above.
   *
   * A separate function rather than an inline closure so the guard reads as one
   * thing: "start this if it has not started".
   */
  async function firstLoad(): Promise<void> {
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
        origin: 'shared',
      })
      const problem = await writeProject(shared)
      if (problem) set({ saveError: problem })
      return
    }

    // A failed load must not leave the studio waiting forever on `loaded`. Falling
    // back to the starter project loses nothing that was not already unreachable.
    let existing: Project | null = null
    let failure: string | null = null
    let summaries: readonly ProjectSummary[] = []

    try {
      summaries = await persistence().list()
      // Whatever was open last, then the most recently touched, then the key every
      // project used to share - which is how an install from before projects had
      // their own ids still finds its work.
      const wanted = lastOpenedId()
      const id =
        (wanted && summaries.some((p) => p.id === wanted) ? wanted : null) ??
        summaries[0]?.id ??
        LEGACY_PROJECT_ID
      existing = await persistence().load(id)
    } catch (error) {
      failure = error instanceof Error && error.message
        ? `Could not open saved work: ${error.message}`
        : 'Could not open saved work from this browser’s storage.'
    }

    // The starter project lives in the same chunk the templates do. If it cannot be
    // fetched there is nothing to open, and the studio has to say that rather than
    // sit on "Loading project…" for ever.
    let project = existing
    if (!project) {
      try {
        project = (await templates()).createDefaultProject()
      } catch {
        set({ loaded: true, origin: 'fresh', saveError: 'Could not load the starter project. Check the connection and reload.' })
        return
      }
    }
    const first = project.files[0]?.id ?? null

    set({
      project,
      activeFileId: first,
      openFileIds: first ? [first] : [],
      loaded: true,
      origin: existing ? 'restored' : 'fresh',
      recents: summaries,
      saveError: failure,
    })
    rememberLastOpened(project.id)

    // Laying down the starter project deliberately does *not* move `lastSavedAt`:
    // the indicator answers "is what I typed written down", and starting the clock
    // before the user has typed anything makes it say yes while their first edits
    // are still in the debounce.
    if (!existing && !failure) {
      const problem = await writeProject(project)
      if (problem) set({ saveError: problem })
      else await refreshRecents()
    }
  }

  return {
    project: null,
    activeFileId: null,
    openFileIds: [],
    loaded: false,
    origin: null,
    recents: [],
    lastSavedAt: null,
    saveError: null,
    preview: { colorScheme: 'light', typeScale: 1, zoom: 'fit' },

    load() {
      // Already done, or already running: either way there is nothing to start.
      if (get().loaded) return Promise.resolve()
      loading ??= firstLoad().finally(() => {
        loading = null
      })
      return loading
    },
    async flush() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const { project } = get()
      if (!project) return

      const problem = await writeProject(project)
      set(problem ? { saveError: problem } : { lastSavedAt: Date.now(), saveError: null })
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
      if (!project) return false

      const target = normalizeFileName(name, dirname(fileId))
      if (!target) return false
      if (target === fileId) return true

      const renamed = renameFile(project, fileId, target)
      if (renamed === project) return false

      set({ openFileIds: get().openFileIds.map((id) => (id === fileId ? target : id)) })
      commit(renamed, get().activeFileId === fileId ? target : undefined)
      return true
    },

    renameProject(name) {
      const project = get().project
      const normalized = normalizeProjectName(name)
      if (!project || !normalized) return false
      if (project.manifest.name === normalized) return true
      commit({ ...project, manifest: { ...project.manifest, name: normalized, templateId: undefined }, updatedAt: Date.now() })
      return true
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

    async applyTemplate(templateId) {
      let module: Awaited<ReturnType<typeof templates>>
      try {
        module = await templates()
      } catch {
        return false
      }

      const template = module.templateById(templateId)
      if (!template) return false

      await replace(module.createProjectFromTemplate(template))
      return true
    },

    async openFiles(files) {
      const project = projectFromFiles(files)
      if (!project) return false
      await replace(project)
      return true
    },

    async openProject(id) {
      if (get().project?.id === id) return true

      // The project on screen is written before anything else is read: the debounce
      // may still be holding the last few keystrokes, and they belong to the project
      // being left rather than to the one being opened.
      await get().flush()

      let opened: Project | null = null
      try {
        opened = await persistence().load(id)
      } catch {
        opened = null
      }
      if (!opened) {
        // The row was stale - deleted in another tab, or storage went away.
        await refreshRecents()
        return false
      }

      const first = opened.files[0]?.id ?? null
      set({
        project: opened,
        activeFileId: first,
        openFileIds: first ? [first] : [],
        origin: 'restored',
        lastSavedAt: null,
      })
      rememberLastOpened(id)
      await refreshRecents()
      return true
    },

    async removeProject(id) {
      // Deleting what is on screen would leave the studio holding a project that no
      // longer exists, and the next autosave would write it straight back.
      if (get().project?.id === id) return

      try {
        await persistence().remove(id)
      } catch {
        // Nothing useful to do: the row stays, and the list says so on the next read.
      }
      await refreshRecents()
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
