'use client'

import { create } from 'zustand'
import type { DynamicTypeSize } from '@studio/shared'

import {
  DocumentHistory,
  applyProjectTransaction,
  translateDocumentSelection,
  type ProjectTransaction,
  type DocumentSelection,
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
  type PromptMessage,
  validatePromptHistory,
} from '@studio/project-model'
import type { DeviceKey } from '@studio/sim-shell'
import { STUDIO_BUILD } from './build'
import { registerLiveWork, takeSafeStart } from './recovery'
import { lastOpenedId, rememberLastOpened } from './lastOpened'
import type { FileId, SourceSpan } from '@studio/shared'

const AUTOSAVE_MS = 500

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
let saveQueue: Promise<unknown> = Promise.resolve()
function writeProject(project: Project): Promise<string | null> {
  const write = saveQueue.then(async () => {
    if (handedOver) return 'Swift Web Studio is open in another tab, so this tab no longer saves.'
    try { await persistence().save(project); saved = project; return null }
    catch (error) { return error instanceof Error && error.message ? `Could not save: ${error.message}` : 'Could not save to this browser’s storage.' }
  })
  saveQueue = write
  return write
}

/**
 * The project as storage last had it from this tab: the object last written, or read.
 *
 * A flush of that same object has nothing to add, and it used to be written anyway -
 * each time the tab was hidden *or shown* - which is how looking at an old tab put its
 * copy back over the newer work of another.
 */
let saved: Project | null = null

/** Set once another tab has the studio: from then on this one writes nothing. */
let handedOver = false

/**
 * Asks the browser not to clear this site's storage when space runs short.
 *
 * Browsers treat a site's storage as a cache they may empty unless asked otherwise.
 * Chrome answers from how the site has been used and Firefox asks the person, so the
 * answer changes nothing here and is not waited for.
 */
function requestPersistence(): void {
  try { void navigator.storage?.persist?.().catch(() => {}) } catch { /* no storage manager */ }
}

/**
 * How a switch to another project went.
 *
 * `'unsaved'` - the project being left could not be saved, so nothing changed. The
 * caller asks first, then calls again with `leaveUnsaved` to go without it: storage
 * that has stopped working must not also stop the next task from starting.
 * `'failed'` - there was nothing to open: a template that did not arrive, files with
 * nothing usable in them, a project no longer in this browser, or a later switch
 * that overtook this one.
 */
export type SwitchResult = 'opened' | 'unsaved' | 'failed'
export interface SwitchOptions {
  /** Switch even though the project being left could not be saved. */
  readonly leaveUnsaved?: boolean
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

/**
 * What the first load found, which is what the welcome sheet reports.
 *
 * `'restored'` - work was already in this browser and is what you are looking at.
 * `'shared'`   - the page was opened with a link carrying a project.
 * `'fresh'`    - nothing was saved, so the starter project was laid down.
 * `'recovered'` - after a crash, the saved project was skipped on purpose.
 *
 * The sheet needs all four: it offers to continue only in the first case, it does
 * not open at all in the second, because following a link is already an explicit
 * request to see *that* project, and in the last it opens on the saved projects so
 * choosing one is the participant's decision rather than a repeat of the crash.
 */
export type ProjectOrigin = 'restored' | 'shared' | 'fresh' | 'recovered'

export interface StudioState {
  project: Project | null
  documentRevision: number
  canUndo: boolean
  canRedo: boolean
  documentSelection: DocumentSelection | null
  setDocumentSelection: (selection: DocumentSelection | null) => void
  commitTransaction: (expected: Project, transaction: ProjectTransaction) => string | null
  appendPromptMessages: (projectId: string, messages: readonly PromptMessage[]) => string | null
  replayDocument: (direction: 'undo' | 'redo') => { selection: DocumentSelection | null } | null
  activeFileId: FileId | null
  /** Files the user has opened, in tab order. */
  openFileIds: FileId[]
  /** false until the first load resolves; avoids flashing the template over saved work */
  loaded: boolean
  /** What the first load found; null until it has run. */
  origin: ProjectOrigin | null
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
  /**
   * Set when the saved projects could not be read at launch.
   *
   * Not a failed save, and it used to be reported as one: nothing typed since is at
   * risk, but the work from before is out of reach until a reload reads it.
   */
  loadError: string | null
  /** Whether saves outlive the page. False when the browser gave the studio nowhere to keep them. */
  durable: boolean
  preview: PreviewSettings

  load: () => Promise<void>
  flush: () => Promise<void>
  /**
   * Stops writing for good: another tab has the studio. What this tab holds is saved
   * first unless `save` is false - when the studio was taken from a tab that did not
   * answer, its copy is the old one. A reload replaces it.
   */
  handOver: (save?: boolean) => Promise<void>
  /**
   * Whether closing the page now would lose work: an edit not yet written, a save
   * that failed, or storage that keeps nothing past the page.
   */
  unsavedWork: () => boolean
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
   * Async because the sources are a separate chunk. Fails when that chunk could not
   * be fetched - offline, or a deploy that moved it mid-session - so the caller can
   * say so. A Create button that silently does nothing is worse than one that fails.
   */
  applyTemplate: (templateId: string, options?: SwitchOptions) => Promise<SwitchResult>
  /** Reopens one of the projects in this browser. */
  openProject: (id: string, options?: SwitchOptions) => Promise<SwitchResult>
  /** Deletes a project. Refuses the one that is open - close it by opening another. */
  removeProject: (id: string) => Promise<void>
  /**
   * Replaces the project with one built from files off the user's disk.
   *
   * Fails when nothing usable was in the selection, so the caller can say so rather
   * than presenting an empty project as a successful open.
   */
  openFiles: (files: readonly OpenedFile[], options?: SwitchOptions) => Promise<SwitchResult>
  importProject: (expected: Project, incoming: Project) => Promise<string | null>
}

export const useStudio = create<StudioState>((rawSet, get) => {
  const history = new DocumentHistory()
  let importGuard: { id: string; latest: Project } | null = null
  let replaying = false
  let typingGroup: string | undefined
  let switchRequest = 0

  /**
   * Saves the project being left, typing that arrives during the write included.
   *
   * Null when it may be left: saved, or `leaveUnsaved` says to go without. Otherwise
   * why not - it could not be saved, or a later switch overtook this one.
   */
  async function leaveOutgoing(request: number, outgoingId: string | undefined, leaveUnsaved: boolean): Promise<'unsaved' | 'failed' | null> {
    while (request === switchRequest && get().project?.id === outgoingId) {
      const snapshot = get().project
      await get().flush()
      if (request !== switchRequest || get().project?.id !== outgoingId) return 'failed'
      if (get().project !== snapshot) continue
      return get().saveError && !leaveUnsaved ? 'unsaved' : null
    }
    return 'failed'
  }
  function set(patch: Partial<StudioState>): void {
    const previous = get()
    if (importGuard && patch.project?.id === importGuard.id) importGuard.latest = patch.project
    if ('project' in patch && patch.project !== previous.project) {
      if (patch.documentSelection === undefined) patch = { ...patch, documentSelection: translateDocumentSelection(previous.project, patch.project ?? null, previous.documentSelection) }
      if (!replaying) history.record(previous.project, patch.project ?? null, previous.documentSelection, patch.documentSelection === undefined ? previous.documentSelection : patch.documentSelection, typingGroup)
      patch = { ...patch, documentRevision: previous.documentRevision + 1 }
      if (patch.project?.id !== previous.project?.id) patch.documentSelection = null
    }
    rawSet({ ...patch, canUndo: history.canUndo, canRedo: history.canRedo })
  }

  /**
   * Debounced write-behind. The editor stays responsive and IndexedDB sees one write
   * per pause rather than one per keystroke. `flush` exists so `visibilitychange` and
   * `pagehide` can force the pending write before the tab goes away - the case where
   * a naive debounce quietly loses the last few seconds of work.
   */
  function scheduleSave(): void {
    if (get().lastSavedAt !== null) set({ lastSavedAt: null })
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
  async function replace(project: Project, { leaveUnsaved = false }: SwitchOptions = {}): Promise<SwitchResult> {
    // Keep the latest keystrokes in the outgoing project's saved copy.
    const request = ++switchRequest, outgoingId = get().project?.id
    const blocked = await leaveOutgoing(request, outgoingId, leaveUnsaved)
    if (blocked) return blocked
    // A new project that cannot be written opens all the same. Storage that has
    // stopped working says so on screen until a save works, and refusing to open
    // anything would only add a second problem to the first.
    const problem = await writeProject(project)
    if (request !== switchRequest) return 'failed'
    const overtaken = await leaveOutgoing(request, outgoingId, leaveUnsaved)
    if (overtaken) return overtaken
    const outgoing = get().project
    const first = project.files[0]?.id ?? null

    set({
      project,
      activeFileId: first,
      openFileIds: first ? [first] : [],
      origin: 'restored',
      lastSavedAt: problem ? null : Date.now(),
      saveError: problem,
    })
    rememberLastOpened(project.id)

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
    return 'opened'
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
    requestPersistence()
    const durable = persistence().durable

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
        durable,
      })
      const problem = await writeProject(shared)
      if (problem) set({ saveError: problem })
      return
    }

    // After a crash, "Open another project" starts here without the project that was
    // open, so a crash its content causes does not repeat on every reload.
    const recovering = takeSafeStart()

    // A failed load must not leave the studio waiting forever on `loaded`. Falling
    // back to the starter project loses nothing that was not already unreachable.
    let existing: Project | null = null
    let failure: string | null = null
    let summaries: readonly ProjectSummary[] = []

    try {
      summaries = await persistence().list()
      if (!recovering) {
        // Whatever was open last, then the most recently touched, then the key every
        // project used to share - which is how an install from before projects had
        // their own ids still finds its work.
        const wanted = lastOpenedId()
        const id =
          (wanted && summaries.some((p) => p.id === wanted) ? wanted : null) ??
          summaries[0]?.id ??
          LEGACY_PROJECT_ID
        existing = await persistence().load(id)
      }
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
        set({ loaded: true, origin: 'fresh', durable, loadError: 'Could not load the starter project. Check the connection and reload.' })
        return
      }
    }
    const first = project.files[0]?.id ?? null
    if (existing) saved = existing

    set({
      project,
      activeFileId: first,
      openFileIds: first ? [first] : [],
      loaded: true,
      origin: recovering ? 'recovered' : existing ? 'restored' : 'fresh',
      recents: summaries,
      loadError: failure,
      durable,
    })
    // After a failed read the starter is only a place to stand. Remembering it would
    // have the next reload open it instead of the work that could not be read.
    if (!failure) rememberLastOpened(project.id)

    // Laying down the starter project deliberately does *not* move `lastSavedAt`:
    // the indicator answers "is what I typed written down", and starting the clock
    // before the user has typed anything makes it say yes while their first edits
    // are still in the debounce. After a crash the starter is saved too, though it
    // adds one to the list: saved, it is what a reload reopens, rather than the
    // project that crashed.
    if (!existing && !failure) {
      const problem = await writeProject(project)
      if (problem) set({ saveError: problem })
      else await refreshRecents()
    }
  }

  return {
    documentRevision: 0,
    documentSelection: null,
    setDocumentSelection(selection) { set({ documentSelection: selection }) },
    commitTransaction(expected, transaction) {
      const current = get()
      if (current.project !== expected) return 'The project changed while this edit was being prepared. Try again.'
      const result = applyProjectTransaction(expected, current.documentRevision, transaction)
      if (!result.ok) return result.reason
      if (result.project !== expected) {
        set({ project: result.project, ...(transaction.selection === undefined ? {} : { documentSelection: transaction.selection }) })
        scheduleSave()
      }
      return null
    },
    appendPromptMessages(projectId, messages) {
      const project = get().project
      if (!project || project.id !== projectId) return 'The project changed. Open the original project to continue.'
      const chatHistory = [...(project.chatHistory ?? []), ...messages]
      try { validatePromptHistory(chatHistory) } catch (error) { return error instanceof Error ? error.message : 'Could not save the conversation.' }
      set({ project: { ...project, chatHistory, updatedAt: Date.now() } })
      scheduleSave()
      return null
    },
    replayDocument(direction) {
      const current = get().project
      if (!current) return null
      const result = history.take(direction, current)
      if (!result) { set({}); return null }
      replaying = true
      try { commit(result.project, result.selection?.file); set({ documentSelection: result.selection }) }
      finally { replaying = false }
      return { selection: result.selection }
    },
    project: null,
    canUndo: false,
    canRedo: false,
    activeFileId: null,
    openFileIds: [],
    loaded: false,
    origin: null,
    recents: [],
    lastSavedAt: null,
    saveError: null,
    loadError: null,
    durable: true,
    preview: { colorScheme: 'light', typeScale: 1, zoom: 'fit' },

    load() {
      // Already done, or already running: either way there is nothing to start.
      if (get().loaded) return Promise.resolve()
      loading ??= firstLoad().finally(() => {
        loading = null
      })
      return loading
    },
    async handOver(save = true) {
      if (save) await get().flush()
      handedOver = true
    },
    unsavedWork() {
      const { project, saveError, durable } = get()
      return !handedOver && project !== null && (!durable || saveError !== null || project !== saved)
    },
    async flush() {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const { project } = get()
      if (!project || project === saved || handedOver) return

      const problem = await writeProject(project)
      // A completed older write says nothing about edits made while it was saving.
      if (get().project !== project) return
      set(problem ? { saveError: problem } : { lastSavedAt: Date.now(), saveError: null })
    },

    setFileText(fileId, text) {
      const { project } = get()
      if (!project || !project.files.some(f => f.id === fileId && f.text !== text)) return
      typingGroup = 'typing:' + fileId
      try { set({ project: withFileText(project, fileId, text) }) }
      finally { typingGroup = undefined }
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
      const next = addFile(project, fileId)
      if (next === project) return null
      commit(next, fileId)
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

    async applyTemplate(templateId, options) {
      // What this template makes is already open, untouched: making it again would
      // swap it for an identical copy and redraw everything, and for that moment the
      // canvas showed one project while edits went to the other (B6).
      const open = get().project
      if (open?.manifest.templateId === templateId && isPristine(open)) return 'opened'

      let module: Awaited<ReturnType<typeof templates>>
      try {
        module = await templates()
      } catch {
        return 'failed'
      }

      const template = module.templateById(templateId)
      if (!template) return 'failed'

      return replace(module.createProjectFromTemplate(template), options)
    },

    async importProject(expected, incoming) {
      if (importGuard || get().project !== expected) return 'The current project changed. Reopen the archive to review it again.'
      await get().flush()
      if (get().saveError) return get().saveError
      if (get().project !== expected) return 'The project changed while saving. Reopen the archive.'
      importGuard = { id: expected.id, latest: expected }
      try {
        const problem = await writeProject(incoming)
        if (problem) return problem
        if (get().project !== expected) {
          if (incoming.id === expected.id) await writeProject(importGuard.latest)
          return 'The project changed during import. Its current work was preserved. Reopen the archive.'
        }
        const first = incoming.files[0]?.id ?? null
        set({ project: incoming, activeFileId: first, openFileIds: first ? [first] : [], lastSavedAt: Date.now(), saveError: null, origin: 'restored' })
        rememberLastOpened(incoming.id)
        await refreshRecents()
        return null
      } finally { importGuard = null }
    },

    async openFiles(files, options) {
      const project = projectFromFiles(files)
      if (!project) return 'failed'
      return replace(project, options)
    },

    async openProject(id, { leaveUnsaved = false } = {}) {
      const request = ++switchRequest, outgoingId = get().project?.id
      if (outgoingId === id) return 'opened'

      // The project on screen is written before anything else is read: the debounce
      // may still be holding the last few keystrokes, and they belong to the project
      // being left rather than to the one being opened.
      const blocked = await leaveOutgoing(request, outgoingId, leaveUnsaved)
      if (blocked) return blocked

      let opened: Project | null = null
      try {
        opened = await persistence().load(id)
      } catch {
        opened = null
      }
      if (!opened) {
        // The row was stale - deleted in another tab, or storage went away.
        await refreshRecents()
        return 'failed'
      }
      const overtaken = await leaveOutgoing(request, outgoingId, leaveUnsaved)
      if (overtaken) return overtaken

      // What was just read is what is stored, so nothing about it is unsaved - even
      // when the project left behind could not be.
      saved = opened
      const first = opened.files[0]?.id ?? null
      set({
        project: opened,
        activeFileId: first,
        openFileIds: first ? [first] : [],
        origin: 'restored',
        lastSavedAt: null,
        saveError: null,
      })
      rememberLastOpened(id)
      await refreshRecents()
      return 'opened'
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

// The recovery screen reads the open project from here - edits the autosave has not
// written yet included - without importing the store itself.
registerLiveWork({
  project: () => useStudio.getState().project,
  flush: async () => { await useStudio.getState().flush(); return useStudio.getState().saveError },
  archive: async project => (await import('@studio/exporter')).exportEditableZip(project, STUDIO_BUILD),
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
