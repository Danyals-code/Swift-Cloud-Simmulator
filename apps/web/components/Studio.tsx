'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthoringNode, DesignEditRequest, ExportFormat, PreviewInput } from '@studio/shared'
import { validatePreviewScenario, reconcileAuthoringSelection, type AuthoringSelection } from '@studio/shared'
import { emptyStudioMetadata, buildFileTree, encodeProject, isPristine, shareLink } from '@studio/project-model'
import { findFile } from '@studio/project-model'
import { getDevice } from '@studio/sim-shell'
import type { FileId, PagePreview, RenderNode, SourceSpan, UIEvent, ViewLayer } from '@studio/shared'
import { useStudio, type PreviewSettings } from '../lib/store'
import type { HiddenViewInfo, ViewEdit, ViewSiteInfo } from '@studio/shared'
import { AddView } from './AddView'
import { ProjectResources } from './ProjectResources'
import { imageDataURL, validateAssets, type ImageAsset } from '@studio/project-model'
import type { CanvasTool } from './Toolbar'
import { useLayout, PANE_LIMITS, type PaneKey } from '../lib/layout'
import { findLayer, insertionLayer, layerForRenderNode, layerRenderIds } from '../lib/layers'
import { useCompiler } from '../lib/useCompiler'
/**
 * Problems, output, timings and coverage, fetched when the panel is opened.
 *
 * The panel is closed by default and the four tabs behind it are a few kilobytes
 * that the first paint does not need - and the chunk they would otherwise sit in is
 * the one the browser must have before anything appears at all.
 */
const ConsolePane = dynamic(() => import('./ConsolePane').then((m) => m.ConsolePane), { ssr: false })
import { InspectorReadout } from './InspectorReadout'
import { PreviewScenarios } from './PreviewScenarios'
import { DevicePane } from './DevicePane'
const EditorPane = dynamic(() => import('./EditorPane').then(m => m.EditorPane), { ssr: false })
import { ShortcutsDialog } from './ShortcutsDialog'
import { FileSwitcher } from './FileSwitcher'
import { JumpBar } from './JumpBar'
import { Navigator } from './Navigator'
import { TabBar } from './TabBar'
import { TemplateGallery } from './TemplateGallery'
import { Toolbar, PreviewStatus, PreviewTools } from './Toolbar'
import styles from './Workspace.module.css'
import { Splitter } from './ui/Splitter'
import { Icon } from './ui/Icon'

const NO_FILES: never[] = []

/** The narrowest the editor is allowed to get before the side panes start yielding. */
const EDITOR_MIN = 300

export function Studio() {
  const project = useStudio((s) => s.project)
  const activeFileId = useStudio((s) => s.activeFileId)
  const openFileIds = useStudio((s) => s.openFileIds)
  const loaded = useStudio((s) => s.loaded)
  const origin = useStudio((s) => s.origin)
  const lastSavedAt = useStudio((s) => s.lastSavedAt)
  const saveError = useStudio((s) => s.saveError)
  const previewSettings = useStudio((s) => s.preview)

  const load = useStudio((s) => s.load)
  const flush = useStudio((s) => s.flush)
  const setFileText = useStudio((s) => s.setFileText)
  const setActiveFile = useStudio((s) => s.setActiveFile)
  const closeFile = useStudio((s) => s.closeFile)
  const createFile = useStudio((s) => s.createFile)
  const renameFile = useStudio((s) => s.renameFile)
  const deleteFile = useStudio((s) => s.deleteFile)
  const duplicateFile = useStudio((s) => s.duplicateFile)
  const createFolder = useStudio((s) => s.createFolder)
  const renameFolder = useStudio((s) => s.renameFolder)
  const deleteFolder = useStudio((s) => s.deleteFolder)
  const moveFile = useStudio((s) => s.moveFile)
  const setDevice = useStudio((s) => s.setDevice)
  const setPreview = useStudio((s) => s.setPreview)
  const renameSymbol = useStudio((s) => s.renameSymbol)
  const applyTemplate = useStudio((s) => s.applyTemplate)
  const openFiles = useStudio((s) => s.openFiles)
  const openProject = useStudio((s) => s.openProject)
  const removeProject = useStudio((s) => s.removeProject)
  const recents = useStudio((s) => s.recents)

  const [layerSelection, setLayerSelection] = useState<{ projectId: string; id: string; anchor?: AuthoringSelection } | null>(null)
  /** The node the inspector's pointer is over. Null whenever it is over nothing. */
  const [hoveredNode, setHoveredNode] = useState<RenderNode | null>(null)
  const navigatorTab = useLayout(s => s.navigatorTab)
  const setNavigatorTab = useLayout(s => s.setNavigatorTab)
  const inspectorTab = useLayout(s => s.inspectorTab)
  const setInspectorTab = useLayout(s => s.setInspectorTab)
  const mode = useLayout(s => s.mode)
  const setMode = useLayout(s => s.setMode)
  const theme = useLayout(s => s.theme)
  const setTheme = useLayout(s => s.setTheme)
  useEffect(() => { document.documentElement.dataset.workspaceTheme = theme }, [theme])
  const shown = useLayout((s) => s.shown)
  const navigatorWidth = useLayout((s) => s.navigatorWidth)
  const previewWidth = useLayout((s) => s.previewWidth)
  const debugHeight = useLayout((s) => s.debugHeight)
  const settingsWidth = useLayout((s) => s.settingsWidth)
  const setSize = useLayout((s) => s.setSize)
  const setPane = useLayout((s) => s.setPane)

  const [inspecting, setInspecting] = useState(false)
  /**
   * The page gallery: every page drawn at once, instead of the one that is running.
   *
   * Design's alone. In Code the canvas is a column beside the editor, where six
   * phones would each be the width of a word - and the pages would be laid out on
   * every keystroke to draw them.
   */
  const [allPages, setAllPages] = useState(false)
  /** What a click on the canvas does: choose a view, or take one out. */
  const [tool, setToolState] = useState<CanvasTool>('select')
  const [adding, setAdding] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** What the source says can be done to the selection, which the controls are drawn from. */
  const [siteInfo, setSiteInfo] = useState<{ key: string; info: ViewSiteInfo | null } | null>(null)
  /**
   * The view to select once the edit has been compiled.
   *
   * By source offset, not by identity: an identity is positional, so after a move
   * the old one names the neighbour the view was swapped with. The offset is where
   * the view is now *written*, which is the one thing an edit can report exactly.
   */
  const [pendingSelect, setPendingSelect] = useState<{ projectId: string; file: FileId; offset: number; text: string } | null>(null)
  /** Raised when an edit could not be made, so the canvas can say why. */
  const [editNote, setEditNote] = useState<string | null>(null)
  /** Serializes source planning; typing can still invalidate an in-flight plan. */
  const editingRef = useRef(false)
  const [committedEditRevision, setCommittedEditRevision] = useState(0)
  /** A view copied from Layers or the canvas, as the Swift that draws it. */
  const [clipboard, setClipboard] = useState<string | null>(null)
  const [hidden, setHidden] = useState<{ key: string; views: readonly HiddenViewInfo[] }>({ key: '', views: [] })
  const [centerOn, setCenterOn] = useState<{ id: string; nonce: number } | null>(null)
  const centerNonce = useRef(0)
  /** Picking up a different tool answers whatever the last refusal said. */
  const setTool = useCallback((next: CanvasTool) => { setToolState(next); setEditNote(null) }, [])
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  /**
   * Whether the sheet on screen opened by itself.
   *
   * Only the launch one refuses to close on a click outside: at launch nothing behind
   * it has been chosen yet, so a stray click dismissing it would leave somebody
   * looking at a project they did not pick.
   */
  const [galleryAtLaunch, setGalleryAtLaunch] = useState(false)
  const greeted = useRef(false)
  const [caret, setCaret] = useState(0)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY)
  const [reveal, setReveal] = useState<{ offset: number; nonce: number } | null>(null)
  const revealNonce = useRef(0)

  useEffect(() => {
    void load()
  }, [load])

  /**
   * The sheet at launch.
   *
   * Once, after the first load resolves, and never for a project that arrived in a
   * link - following one is already an explicit request to see *that* project, and
   * asking "what would you like to open?" over the top of it is a question that has
   * been answered.
   */
  useEffect(() => {
    if (!loaded || greeted.current || origin === 'shared') return
    greeted.current = true
    setGalleryAtLaunch(true)
    setGalleryOpen(true)
  }, [loaded, origin])

  /**
   * The gallery belongs to Edit.
   *
   * Live Preview hands the phone to the person using it, and a row of phones where
   * a click opens a *page* is the opposite of that. The checkbox greys out there
   * rather than disappearing, and it keeps its setting: coming back to Edit finds
   * the canvas as it was left.
   */
  const showingAllPages = allPages && inspecting

  /**
   * The switch moves the right-hand rail with it.
   *
   * Designing and previewing ask different questions of the panel beside the canvas -
   * what is this view, against how am I looking at it - so the panel follows the
   * switch rather than waiting to be told twice. Either tab is still one press away,
   * and pressing one is a decision the switch then leaves alone.
   */
  const setDesigning = useCallback((designing: boolean) => {
    setInspecting(designing)
    setInspectorTab(designing ? 'settings' : 'preview')
    if (!designing) setTool('select')
  }, [setInspectorTab, setTool])

  const toggleInspect = useCallback(() => setDesigning(!inspecting), [setDesigning, inspecting])

  const openGallery = useCallback(() => {
    setGalleryAtLaunch(false)
    setGalleryOpen(true)
  }, [])

  // Debounced autosave can lose the last edit when a tab is closed or backgrounded,
  // so force the pending write at both of the points the browser gives us.
  useEffect(() => {
    const onHide = () => void flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [flush])

  const images = useMemo(() => project?.assets?.map(asset => ({ name: asset.name, width: asset.light.width / asset.scale, height: asset.light.height / asset.scale, light: imageDataURL(asset.light), dark: asset.dark ? imageDataURL(asset.dark) : undefined })), [project?.assets])
  const device = getDevice(project?.manifest.device ?? 'iphone-15')
  const files = project?.files ?? NO_FILES
  const [scenarioSelection, setScenarioSelection] = useState<{ projectId: string; name: string } | null>(null)
  const scenario = scenarioSelection?.projectId === project?.id ? project?.studio?.scenarios.find(s => s.name === scenarioSelection?.name) : undefined
  const [previewResetEpoch, setPreviewResetEpoch] = useState(0)
  const previewIdentity = useMemo(() => JSON.stringify([project?.id, project?.files, scenario ?? null, previewResetEpoch]), [project?.id, project?.files, scenario, previewResetEpoch])

  const { result, stale, workerError, dispatch, reset, language, planDesignEdit, validateResourceRemoval, describeView, copyView, hiddenViews } = useCompiler({
    projectId: project?.id,
    deploymentTarget: project?.manifest.deploymentTarget,
    images, scenario, componentDescriptions: project?.studio?.components,
    files,
    device,
    colorScheme: previewSettings.colorScheme,
    typeScale: previewSettings.typeScale,
    dynamicTypeSize: previewSettings.dynamicTypeSize,
    previewTarget: project?.manifest.previewTarget,
    allPages: showingAllPages && mode === 'design',
    committedEditRevision,
  })

  const activeFile = useMemo(
    () => (project && activeFileId ? findFile(project, activeFileId) : undefined),
    [project, activeFileId],
  )

  const diagnostics = useMemo(
    () => (result?.diagnostics ?? []).filter((d) => d.span.file === activeFileId),
    [result, activeFileId],
  )

  const allDiagnostics = result?.diagnostics ?? NO_FILES

  /** Files carrying an error, so the navigator and tabs can mark them unopened. */
  const filesWithErrors = useMemo(() => {
    const out = new Set<FileId>()
    for (const d of result?.diagnostics ?? []) {
      if (d.severity === 'error') out.add(d.span.file)
    }
    return out
  }, [result])

  const fileTree = useMemo(() => (project ? buildFileTree(project) : NO_FILES), [project])

  // The split row's width, so the side panes can give way rather than pushing the
  // editor to nothing. Measured rather than read from `window`, because the app is
  // embedded in a pane as often as it fills a window.
  useEffect(() => {
    const el = splitRef.current
    if (!el) return
    const measure = () => setAvailable(el.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [loaded])

  /**
   * What the side panes actually get.
   *
   * Their stored widths and even their visibility are a preference, not a promise.
   * Below about 780px there is no arrangement in which a navigator, an editor and a
   * phone all have a usable width, so one of them has to go - and a preview squeezed
   * to 300px beside a 104px editor serves nobody. The preview yields first: a
   * narrower phone is still a phone, while an editor that fits eight characters is
   * not an editor.
   *
   * The preference is kept rather than written back, so widening the window brings
   * the pane back exactly as it was.
   */
  const layout = useMemo(() => {
    const navMin = PANE_LIMITS.navigator.min
    const previewMin = PANE_LIMITS.preview.min

    // Only the *combination* is refused. A single side pane the user asked for is
    // always shown, even if the editor then has to go under its comfortable
    // minimum: hiding the one thing somebody just switched on is worse than a
    // narrow editor, and they can close it again in one keystroke.
    const showNavigator = shown.navigator && !(mode === 'design' && available < 820)
    if (mode === 'design') return { nav: showNavigator ? navigatorWidth : 0, preview: 0, showNavigator, showPreview: true }
    const showPreview =
      shown.preview &&
      !(
        showNavigator &&
        Number.isFinite(available) &&
        available < navMin + previewMin + EDITOR_MIN
      )

    const nav = showNavigator ? navigatorWidth : 0
    const prev = showPreview ? previewWidth : 0
    const overflow = nav + prev + EDITOR_MIN - available

    if (!Number.isFinite(overflow) || overflow <= 0) {
      return { nav, preview: prev, showNavigator, showPreview }
    }

    const fromPreview = Math.min(overflow, Math.max(0, prev - previewMin))
    const rest = overflow - fromPreview
    return {
      nav: Math.max(navMin, nav - Math.max(0, rest)),
      preview: prev - fromPreview,
      showNavigator,
      showPreview,
    }
  }, [available, navigatorWidth, previewWidth, shown.navigator, shown.preview, mode])

  /**
   * Toggling a pane.
   *
   * Flips the stored preference and nothing else. An earlier version also turned
   * the *other* pane off to make room, which looked helpful and quietly wrote a
   * preference the user never expressed - so widening the window afterwards did not
   * bring the pane back, because as far as the store was concerned it had been
   * switched off on purpose. Space is a display concern and is settled in `layout`
   * above, where it can be reversed by resizing the window.
   */
  const togglePane = useCallback(
    (pane: PaneKey) => setPane(pane, !shown[pane]),
    [setPane, shown],
  )

  const openSource = useCallback((fileId: FileId) => {
    setActiveFile(fileId)
    if (mode === 'design') setMode('develop')
  }, [setActiveFile, mode, setMode])

  const revealSpanIn = useCallback(
    (file: FileId, offset: number) => {
      if (file !== activeFileId) setActiveFile(file)
      if (mode === 'design') setMode('develop')
      setReveal({ offset, nonce: ++revealNonce.current })
    },
    [activeFileId, setActiveFile, mode, setMode],
  )

  /** Inspector click: jump the editor to the Swift that produced this view (FR-5.8). */
  const revealSource = useCallback(
    (node: RenderNode) => {
      if (!node.origin) return
      revealSpanIn(node.origin.file, node.origin.start)
    },
    [revealSpanIn],
  )

  /**
   * Run: drop the preview's state and evaluate from scratch.
   *
   * ⌘R and nothing else now. The dock is a switch between editing the app and using
   * it, and a third button that silently resets everything you had typed into the
   * running app did not belong beside those two.
   */
  const run = useCallback(() => { void reset().then(() => setPreviewResetEpoch(value => value + 1)) }, [reset])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (galleryOpen || switcherOpen || adding || shortcutsOpen) return
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"], .cm-editor')

      /**
       * The two switches, on one key each.
       *
       * Tab moves between designing the app and using it; the backquote moves
       * between the two workspaces. Both are plain keys, so both stand aside for
       * anything with a cursor in it - Tab in a form is a Tab.
       */
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !typing) {
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault()
          setDesigning(!inspecting)
          return
        }
        if (e.key === '`') {
          e.preventDefault()
          setMode(mode === 'design' ? 'develop' : 'design')
          return
        }
      }

      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()

      // Xcode's own bindings, which is the point: muscle memory is most of what
      // "feels like Xcode" means once the pixels are right.
      if (key === '/') {
        e.preventDefault()
        setShortcutsOpen(true)
      } else if (key === '0') {
        e.preventDefault()
        togglePane('navigator')
      } else if (key === 'y' && e.shiftKey) {
        e.preventDefault()
        togglePane('debug')
      } else if (key === 'enter' && e.altKey) {
        e.preventDefault()
        togglePane('preview')
      } else if (key === 'b') {
        e.preventDefault()
        togglePane('preview')
      } else if ((key === 'o' && e.shiftKey) || key === 'p') {
        e.preventDefault()
        setSwitcherOpen(true)
      } else if (key === 'i') {
        e.preventDefault()
        toggleInspect()
      } else if (key === 'a' && e.shiftKey) {
        e.preventDefault()
        if (mode === 'design' && inspecting) setAllPages((on) => !on)
      } else if (key === 'r') {
        e.preventDefault()
        run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePane, run, galleryOpen, switcherOpen, adding, shortcutsOpen, toggleInspect, mode, inspecting, setDesigning, setMode])



  const handleChange = useCallback(
    (text: string) => {
      // An undo may still have a pending source selection. Anchor it before typing
      // changes the text that made the pending offset valid.
      const snapshot = result?.authoring
      if (pendingSelect && !stale && snapshot && project?.id === pendingSelect.projectId && project.files.find(f => f.id === pendingSelect.file)?.text === pendingSelect.text) {
        const node = snapshot.nodes.find(n => n.source.file === pendingSelect.file && n.source.start === pendingSelect.offset && n.kind !== 'definition')
        if (node) setLayerSelection({ projectId: project.id, id: '', anchor: { snapshot, nodeId: node.id, files: project.files } })
        setPendingSelect(null)
      }
      if (activeFileId) setFileText(activeFileId, text)
    },
    [activeFileId, setFileText, result?.authoring, pendingSelect, stale, project],
  )

  const handleEvent = useCallback((event: UIEvent) => void dispatch(event), [dispatch])
  const layers = result?.viewHierarchy ?? NO_FILES
  /** What the app has, against what the gallery drew - they differ only past its limit. */
  const pageCount = useMemo(() => layers.filter((layer) => layer.type === 'Page').length, [layers])
  /**
   * The view an edit produced, found again in the tree the recompile made.
   *
   * Derived rather than assigned when the result arrives: the edit knows where the
   * view is *written*, and the layer at that offset is the answer whenever the
   * compile that includes it lands. Until then the old selection stands, so nothing
   * flickers between the edit and the tree that reflects it.
   */
  const editedLayer = useMemo(() => {
    if (!pendingSelect || stale || project?.id !== pendingSelect.projectId || project.files.find(f => f.id === pendingSelect.file)?.text !== pendingSelect.text) return undefined
    const find = (items: readonly ViewLayer[]): ViewLayer | undefined => {
      for (const item of items) {
        if (item.source?.file === pendingSelect.file && item.source.start === pendingSelect.offset) return item
        const child = find(item.children)
        if (child) return child
      }
    }
    return find(layers)
  }, [pendingSelect, layers, project, stale])

  const authoringNode = useMemo(() => {
    const snapshot = result?.authoring
    if (!snapshot || snapshot.projectId !== project?.id || stale) return undefined
    if (pendingSelect && pendingSelect.projectId === project.id && project.files.find(f => f.id === pendingSelect.file)?.text === pendingSelect.text) { const selected = snapshot.nodes.find(n => n.source.file === pendingSelect.file && n.source.start === pendingSelect.offset && n.kind !== 'definition'); if (selected) return selected }
    if (editedLayer) return snapshot.nodes.find(n => n.id === snapshot.runtimeToSource[editedLayer.id])
    if (layerSelection?.anchor) return reconcileAuthoringSelection(layerSelection.anchor, snapshot, project.files) ?? undefined
    return undefined
  }, [result?.authoring, project, stale, editedLayer, layerSelection, pendingSelect])

  const selectAuthoring = useCallback((node: AuthoringNode) => {
    const snapshot = result?.authoring
    if (!project || stale || !snapshot || snapshot.projectId !== project.id) return
    setPendingSelect(null); setEditNote(null)
    useStudio.getState().setDocumentSelection({ file: node.source.file, offset: node.source.start })
    setLayerSelection({ projectId: project.id, id: node.runtimeIds[0] ?? '', anchor: { snapshot, nodeId: node.id, files: project.files } })
    setInspectorTab('settings')
  }, [project, stale, result?.authoring, setInspectorTab])

  const saveScenario = useCallback((name: string, inputs: readonly PreviewInput[]): string | null => {
    const state = useStudio.getState(), snapshot = result?.authoring
    if (!project || state.project !== project || stale || !snapshot) return 'Wait for the current source to finish compiling.'
    const scenario = { name: name.trim(), owner: inputs[0]?.owner ?? '', hook: '', inputs }
    const problem = validatePreviewScenario(snapshot, scenario)
    if (problem) return problem
    const before = project.studio, metadata = before ?? emptyStudioMetadata()
    const after = { ...metadata, scenarios: [...metadata.scenarios.filter(s => s.name !== scenario.name), scenario] }
    const error = state.commitTransaction(project, { projectId: project.id, baseRevision: state.documentRevision, changes: [], studio: { before, after } })
    if (!error) setScenarioSelection({ projectId: project.id, name: scenario.name })
    return error
  }, [project, stale, result?.authoring])

  const captureLayer = useCallback((layer: ViewLayer) => {
    if (!project || stale) return
    if (layer.source) useStudio.getState().setDocumentSelection({ file: layer.source.file, offset: layer.source.start })
    const snapshot = result?.authoring
    const nodeId = snapshot?.runtimeToSource[layer.id]
    setLayerSelection({ projectId: project.id, id: layer.id, anchor: snapshot && nodeId ? { snapshot, nodeId, files: project.files, runtimeId: layer.id } : undefined })
  }, [project, stale, result?.authoring])

  const selectedLayerId = editedLayer?.id
    ?? (layerSelection?.anchor ? authoringNode?.runtimeIds.find(id => id === layerSelection.id) ?? authoringNode?.runtimeIds[0] ?? null
      : layerSelection?.projectId === project?.id ? layerSelection?.id ?? null : null)
  const selectedRenderIds = useMemo(() => layerRenderIds(
    mode === 'design' && navigatorTab === 'layers' && selectedLayerId ? findLayer(layers, selectedLayerId) : undefined,
    result?.renderTree, layers,
  ), [layers, selectedLayerId, result?.renderTree, mode, navigatorTab])
  const selectLayer = (layer: ViewLayer, page: ViewLayer) => {
    if (stale || !project) return
    setPendingSelect(null)
    setEditNote(null)
    captureLayer(layer)
    // Bring its page into view, which is what makes Layers usable on a canvas that
    // has been zoomed into or panned away from the page being chosen.
    setCenterOn({ id: page.id, nonce: ++centerNonce.current })
    if (page.page?.handlerId && !page.page.active) {
      void dispatch({ kind: 'tap', handlerId: page.page.handlerId, location: { x: 0, y: 0 } })
    }
  }

  /**
   * Opening a page from the gallery.
   *
   * The same press the tab bar would have taken, so the app changes tab exactly as
   * it would on the device - and the gallery redraws with the new page live.
   */
  const openPage = useCallback((page: PagePreview) => {
    if (!page.handlerId) return
    void dispatch({ kind: 'tap', handlerId: page.handlerId, location: { x: 0, y: 0 } })
  }, [dispatch])

  // ------------------------------------------------------------ editing

  const selectedLayer = useMemo(
    () => (selectedLayerId ? findLayer(layers, selectedLayerId) : undefined),
    [layers, selectedLayerId],
  )

  /**
   * Asks the worker what the selection's source can take.
   *
   * The hierarchy cannot answer this: a row drawn by a `ForEach` has siblings on
   * screen and one statement in the file, and it is the file that decides whether
   * "move down" means anything. So the parser is asked, once per selection.
   */
  useEffect(() => {
    const source = selectedLayer?.source
    const file = source && project ? findFile(project, source.file) : undefined
    if (!source || !file || !selectedLayerId) return
    let live = true
    void describeView(file.text, source.file, source.start)
      .then((info) => { if (live) setSiteInfo({ key: selectedLayerId, info }) })
    return () => { live = false }
  }, [selectedLayer, selectedLayerId, project, describeView])

  // Keyed by the selection it was asked about, so an answer that arrives after the
  // selection moved on describes nothing rather than the wrong view.
  const site = siteInfo?.key === selectedLayerId ? siteInfo.info : null

  /**
   * Performs an edit, and keeps hold of what it edited.
   *
   * Everything goes through here - the canvas, Layers, the keyboard and the palette -
   * because every one of them means the same thing: change the file, then follow the
   * view into its new place. A refusal is reported rather than swallowed: the reasons
   * are real ones (the end of a stack, a body that would be left empty) and a control
   * that quietly did nothing would read as a bug.
   */
  const performDesignEdit = useCallback(async (target: SourceSpan, fingerprint: string | undefined, scope: string, operation: DesignEditRequest['operation']): Promise<string | null> => {
    const state = useStudio.getState()
    if (!project || state.project !== project || stale) return 'The source is updating. Try again when the preview is ready.'
    if (editingRef.current) return 'An edit is already being prepared. Try again.'
    editingRef.current = true
    try {
      const plan = await planDesignEdit({ projectId: project.id, baseRevision: state.documentRevision, authoringRevision: result?.authoring?.revision, scope, deploymentTarget: project.manifest.deploymentTarget, files: project.files, componentDescriptions: project.studio?.components, target, fingerprint, operation })
      if (!plan.ok) { setEditNote(plan.reason); return plan.reason }
      const preserveSelection = ['style-edit', 'style-create', 'asset-references'].includes(operation.kind)
      const currentSelection = useStudio.getState().documentSelection
      const selectionChanged = JSON.stringify(currentSelection) !== JSON.stringify(state.documentSelection)
      const problem = useStudio.getState().commitTransaction(project, selectionChanged || preserveSelection ? { ...plan, selection: undefined } : plan)
      if (problem) { setEditNote(problem); return problem }
      if (plan.changes.length) setCommittedEditRevision(revision => revision + 1)
      if (plan.changes.length && !selectionChanged && !preserveSelection) {
        const selected = plan.selection
        const snapshot = plan.authoring
        const node = selected && snapshot?.nodes.find(n => n.source.file === selected.file && n.source.start === selected.offset && n.kind !== 'definition')
        const files = useStudio.getState().project!.files
        setLayerSelection(node && snapshot ? { projectId: project.id, id: '', anchor: { snapshot, nodeId: node.id, files } } : null)
        const text = selected && useStudio.getState().project?.files.find(f => f.id === selected.file)?.text
        setPendingSelect(selected && typeof text === 'string' ? { ...selected, projectId: project.id, text } : null)
      }
      setEditNote(null)
      return null
    } finally { editingRef.current = false }
  }, [project, stale, planDesignEdit, result?.authoring?.revision])

  const applyEdit = useCallback(async (edit: ViewEdit, layer?: ViewLayer) => {
    const target = layer ?? selectedLayer
    const model = result?.authoring
    const node = model?.nodes.find(n => n.id === model.runtimeToSource[target?.id ?? ''])
    if (!node) { setEditNote('Select a supported source view to edit.'); return }
    await performDesignEdit(node.source, node.fingerprint, node.owner, edit)
  }, [selectedLayer, result?.authoring, performDesignEdit])

  const changeProperty = useCallback(async (control: string, value: string) => {
    if (!authoringNode) return 'Select the view again.'
    return performDesignEdit(authoringNode.source, authoringNode.fingerprint, authoringNode.owner, { kind: 'property', control, value })
  }, [authoringNode, performDesignEdit])

  /** Where Add would put it, which the palette says before anything is added. */
  const addTarget = selectedLayer
    ? site?.container ? `Into ${selectedLayer.name}` : `After ${selectedLayer.name}`
    : 'Into this screen'

  /**
   * Add, from the palette or the keyboard.
   *
   * With nothing selected it targets the visible page's own content, so Add works on
   * a screen nobody has clicked into yet.
   */
  const addTargetLayer = useMemo(() => insertionLayer(layers, selectedLayer), [selectedLayer, layers])

  const canAdd = !!addTargetLayer?.source && !stale

  const selection = selectedLayer && site
    ? {
        name: selectedLayer.name,
        type: selectedLayer.type,
        canMoveUp: site.index > 0,
        canMoveDown: site.index < site.siblings - 1,
        canDelete: site.siblings > 1 || site.inContent,
        // What it paints, so a drag can begin anywhere inside it rather than on
        // whichever innermost view the pointer happens to be over.
        renderIds: [...selectedRenderIds],
      }
    : null

  const replayEdit = useCallback((direction: 'undo' | 'redo') => {
    const replayed = useStudio.getState().replayDocument(direction)
    if (!replayed) { setEditNote('No document edit to ' + direction); return }
    const current = useStudio.getState().project
    const selected = replayed.selection
    const text = selected && current?.files.find(f => f.id === selected.file)?.text
    setLayerSelection(null)
    setPendingSelect(selected && current && typeof text === 'string' ? { ...selected, projectId: current.id, text } : null)
    setEditNote(direction === 'undo' ? 'Undone' : 'Redone')
  }, [])
  const undo = useCallback(() => replayEdit('undo'), [replayEdit])
  const redo = useCallback(() => replayEdit('redo'), [replayEdit])

  /** Copies the selected view as the Swift that draws it, for a paste anywhere. */
  const copySelection = useCallback(async () => {
    const source = selectedLayer?.source
    const file = source && project ? findFile(project, source.file) : undefined
    if (!source || !file) return
    const snippet = await copyView(file.text, source.file, source.start)
    if (!snippet) return
    setClipboard(snippet)
    setEditNote(`Copied ${selectedLayer!.name}`)
    // Best effort, and never waited on: a studio clipboard is what Paste reads, and
    // the system one is a courtesy for pasting into the editor or somewhere else.
    try { await navigator.clipboard.writeText(snippet) } catch { /* not granted, or not secure */ }
  }, [copyView, project, selectedLayer])

  const pasteClipboard = useCallback(() => {
    if (!clipboard) return
    void applyEdit({ kind: 'insert', snippet: clipboard }, addTargetLayer)
  }, [clipboard, applyEdit, addTargetLayer])

  /**
   * Showing a hidden view again.
   *
   * Not an edit to a *view*, because there is no view: the thing being edited is a
   * block of comments, named by where it sits in the file. So it takes the same path
   * as every other edit, with an offset the parser recognises rather than a layer.
   */
  const showHidden = useCallback((view: HiddenViewInfo) => {
    void performDesignEdit({ file: view.file, start: view.offset, end: view.offset }, undefined, view.file, { kind: 'show' })
  }, [performDesignEdit])

  /**
   * Every view the project is hiding, re-read whenever a compile settles.
   *
   * Keyed by what was read, so an answer that arrives after another edit describes
   * the file that is open rather than the one that was.
   */
  useEffect(() => {
    if (!project || stale) return
    const key = `${project.id}:${result?.revision ?? 0}`
    if (hidden.key === key) return
    let live = true
    void hiddenViews(project.files).then((views) => { if (live) setHidden({ key, views }) })
    return () => { live = false }
  }, [project, stale, result?.revision, hiddenViews, hidden.key])

  /**
   * The designing keys, which carry no modifier.
   *
   * Held apart from the Xcode chords above because they must never fire while
   * somebody is typing: V, A and D are letters, and Backspace in a text field is a
   * backspace. Anything with a focused field or an open sheet is left alone.
   */
  useEffect(() => {
    if (mode !== 'design' || !inspecting) return
    const onKey = (e: KeyboardEvent) => {
      if (galleryOpen || switcherOpen || adding || shortcutsOpen) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"], .cm-editor')) return

      const key = e.key.toLowerCase()
      // The editing chords. Undo is the studio's here rather than the editor's,
      // because the editor is not the thing being typed into.
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
        else if (key === 'y' && !e.shiftKey) { e.preventDefault(); redo() }
        else if (key === 'c') { if (selectedLayer) { e.preventDefault(); void copySelection() } }
        else if (key === 'v') { if (clipboard) { e.preventDefault(); pasteClipboard() } }
        else if (key === 'h') { if (selectedLayer) { e.preventDefault(); void applyEdit({ kind: 'hide' }) } }
        return
      }

      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        void applyEdit({ kind: 'move', direction: e.key === 'ArrowUp' ? -1 : 1 })
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (!selectedLayer) return
        e.preventDefault()
        void applyEdit({ kind: 'delete' })
      } else if (key === 'v') {
        setTool('select')
      } else if (key === 'd') {
        setTool(tool === 'delete' ? 'select' : 'delete')
      } else if (key === 'a') {
        if (canAdd) { e.preventDefault(); setAdding(true) }
      } else if (e.key === 'Escape') {
        if (tool === 'delete') setTool('select')
        else setLayerSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, inspecting, galleryOpen, switcherOpen, adding, shortcutsOpen, applyEdit, selectedLayer, canAdd, tool, setTool,
      undo, redo, copySelection, pasteClipboard, clipboard])

  /**
   * Undo and redo, over the edits the canvas made.
   *
   * A change is the whole file before and after, which is the only representation
   * that cannot drift: replaying an *operation* backwards would have to know what
   * the file looked like when it ran, and after a second edit it no longer does.
   */
  /**
   * A drop, from the tree or from the canvas.
   *
   * One operation for both, because both are saying the same thing: put this view
   * beside that one. The source's own offset and the target's are all the parser
   * needs, and it is the parser that decides whether the result is a file that
   * still compiles.
   */
  const reorderLayers = useCallback((layer: ViewLayer, target: ViewLayer, position: 'before' | 'after') => {
    const from = layer.source
    const to = target.source
    if (!from || !to || from.file !== to.file) {
      setEditNote('A view can only be moved within the file it is written in')
      return
    }
    void applyEdit({ kind: 'moveTo', targetOffset: to.start, position }, layer)
  }, [applyEdit])

  /** A drop on the canvas, named in the terms the file understands. */
  const reorderNodes = useCallback((source: RenderNode | 'selection', target: RenderNode, position: 'before' | 'after') => {
    const from = source === 'selection' ? selectedLayer : layerForRenderNode(layers, source)
    const to = layerForRenderNode(layers, target)
    if (!from || !to || from.id === to.id) return
    reorderLayers(from, to, position)
  }, [layers, reorderLayers, selectedLayer])

  /** The layer under the inspector's pointer, while Layers is there to show it. */
  const hoveredLayerId = useMemo(
    () => (inspecting && mode === 'design' ? layerForRenderNode(layers, hoveredNode)?.id ?? null : null),
    [inspecting, mode, layers, hoveredNode],
  )

  /**
   * Clicking a view while inspecting.
   *
   * In Code that means "show me the Swift that drew this", which is what the
   * inspector has always done. In Design there is no editor on screen to jump to,
   * and the panel that *can* answer is Layers - so the click selects the view
   * there and leaves you where you were. The editor is still pointed at the right
   * line, so switching to Code afterwards lands on it.
   */
  const inspectSelect = useCallback(
    (node: RenderNode) => {
      if (mode !== 'design') {
        revealSource(node)
        return
      }
      if (tool === 'delete') {
        const target = layerForRenderNode(layers, node)
        if (target) void applyEdit({ kind: 'delete' }, target)
        return
      }
      if (node.origin) {
        if (node.origin.file !== activeFileId) setActiveFile(node.origin.file)
        setReveal({ offset: node.origin.start, nonce: ++revealNonce.current })
      }
      const layer = layerForRenderNode(layers, node)
      if (!layer || !project) return
      setNavigatorTab('layers')
      setPane('navigator', true)
      setPendingSelect(null)
      setEditNote(null)
      captureLayer(layer)
    },
    [mode, revealSource, layers, project, activeFileId, setActiveFile, setNavigatorTab, setPane, tool, applyEdit, captureLayer],
  )


  /** The rename in progress, if F2 found something to rename. */
  const [rename, setRename] = useState<{ name: string; spans: readonly SourceSpan[] } | null>(null)

  /**
   * Copies a link that carries the whole project.
   *
   * Three outcomes, and the caller shows all three: the clipboard can be refused (it
   * needs a user gesture and a secure context) and the project can be too big for a
   * URL. Reporting only success would leave a user pasting nothing and wondering.
   */
  const handleShare = useCallback(async (): Promise<'copied' | 'too-large' | 'failed'> => {
    if (!project) return 'failed'
    void flush()

    const encoded = encodeProject(project)
    if (!encoded) return 'too-large'

    try {
      await navigator.clipboard.writeText(
        shareLink(window.location.origin, window.location.pathname, encoded),
      )
      return 'copied'
    } catch {
      return 'failed'
    }
  }, [project, flush])

  /**
   * Loaded on click, not on first paint.
   *
   * The project generator - pbxproj, plists, asset catalogues, four manifests - is
   * about thirty kilobytes that runs once per session at most, and it was in the
   * initial bundle for the sake of one function reference. The menu itself is plain
   * data and stays static, so the button still knows its options before the code
   * behind them exists.
   */
  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (!project) return
      void flush()
      void import('@studio/exporter').then(({ downloadProjectZip }) => {
        downloadProjectZip(project, format)
      })
    },
    [project, flush],
  )

  if (!loaded || !project) {
    return (
      <main className="grid h-dvh place-items-center bg-xc-editor text-[12px] text-xc-text-3">
        Loading project…
      </main>
    )
  }

  const errors = allDiagnostics.filter((d) => d.severity === 'error').length
  const warnings = allDiagnostics.filter((d) => d.severity === 'warning').length

  /**
   * Problems, output, timings and coverage.
   *
   * One element, placed under whichever editor is on screen: the source editor in
   * Code, the canvas in Design. It used to exist only in Code, which is why asking
   * for it from Design used to take you there - the panel was answering with a
   * different workspace.
   */
  const debugArea = shown.debug ? (
    <>
      <Splitter
        orientation="row"
        size={debugHeight}
        onResize={(size) => setSize('debug', size)}
        min={PANE_LIMITS.debug.min}
        max={PANE_LIMITS.debug.max}
        direction={-1}
        label="Debug area height"
        onToggle={() => togglePane('debug')}
      />
      <div style={{ height: debugHeight, maxHeight: '65%' }} className="flex shrink-0 flex-col">
        {/* What the pointer is over and what is selected, at the top of the panel
            that reports on the app. It used to be a strip under the canvas, which
            made the canvas change height between Design and Live Preview - and a
            simulator that resizes when you switch modes looks like a glitch. */}
        {inspecting ? (
          <div className={styles.readout} data-testid="canvas-bar">
            {/* In Code the panel sits under the editor, and the same line reports
                the same thing there - what the pointer is over, and what a click on
                it will do, which in Code is open its source. */}
            <InspectorReadout node={hoveredNode} active action={mode === 'design' ? 'select' : 'reveal'} />
            {editNote ? <span className={styles.note} role="status" data-testid="edit-note">{editNote}</span> : null}
            {selection && mode === 'design' ? (
              <div className={styles.selection} data-testid="selection-controls">
                <span className={styles.selectionName}>{selection.name}</span>
                <span className={styles.selectionKind}>{selection.type}</span>
                <button type="button" data-testid="move-up" disabled={!selection.canMoveUp} title="Move up (⌥↑)" aria-label="Move up" onClick={() => void applyEdit({ kind: 'move', direction: -1 })}><Icon name="chevron-up-down" size={13} /><span>Up</span></button>
                <button type="button" data-testid="move-down" disabled={!selection.canMoveDown} title="Move down (⌥↓)" aria-label="Move down" onClick={() => void applyEdit({ kind: 'move', direction: 1 })}><Icon name="chevron-up-down" size={13} /><span>Down</span></button>
                <button type="button" data-testid="hide-selection" title="Hide (⌘H)" aria-label="Hide" onClick={() => void applyEdit({ kind: 'hide' })}><Icon name="eye" size={13} /></button>
                <button type="button" data-testid="delete-selection" disabled={!selection.canDelete} title="Delete (⌫)" aria-label="Delete" onClick={() => void applyEdit({ kind: 'delete' })}><Icon name="xmark" size={12} /></button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <ConsolePane result={result} workerError={workerError} onRevealSpan={revealSpanIn} />
        </div>
      </div>
    </>
  ) : null

  const previewTools = <PreviewTools inspecting={inspecting} onSetInspecting={setDesigning} showEditActions={mode === 'design'} tool={tool} onSetTool={setTool} onAdd={() => setAdding(true)} canAdd={canAdd} mode={mode} busy={stale} errors={errors} warnings={warnings} workerError={workerError} />
  const previewStatus = <PreviewStatus inspecting={inspecting} tool={tool} mode={mode} busy={stale} errors={errors} warnings={warnings} workerError={workerError} />

  return (
    <main data-testid="workspace" data-mode={mode} className="flex h-dvh flex-col overflow-hidden bg-xc-editor text-xc-text">
      <div className="flex min-h-0 flex-1 flex-col" inert={galleryOpen || switcherOpen || adding || shortcutsOpen}>
      <Toolbar
        mode={mode}
        onModeChange={setMode}
        theme={theme}
        onThemeChange={setTheme}
        onOpenGallery={openGallery}
        onRenameProject={useStudio.getState().renameProject}
        onShortcuts={() => setShortcutsOpen(true)}
        projectName={project.manifest.name}
        savedAt={lastSavedAt}
        saveError={saveError}
        // The toggles report the preference, so each is a switch that always
        // responds; `suppressed` is how a pane that is on but has no room says so.
        panes={new Set((Object.keys(shown) as PaneKey[]).filter((key) => shown[key]))}
        suppressed={
          new Set<PaneKey>(shown.preview && !layout.showPreview ? (['preview'] as const) : [])
        }
        onTogglePane={togglePane}
        onExport={handleExport}
        onDownloadEditable={() => { void import('@studio/exporter').then(async module => { await flush(); module.downloadEditableProject(project) }).catch(error => setEditNote(error instanceof Error ? error.message : 'Could not download the editable project.')) }}
        onShare={handleShare}
      />

      <div ref={splitRef} className="flex min-h-0 flex-1">
        {layout.showNavigator ? (
          <>
            <div style={{ width: layout.nav }} className="shrink-0 overflow-hidden">
              <Navigator
                key={project.id}
                authoring={result?.authoring}
                authoringFiles={project.files}
                authoringSelection={layerSelection?.anchor}
                selectedAuthoringId={authoringNode?.id}
                onEditAuthoring={(node, operation) => performDesignEdit(node.source, node.fingerprint, node.owner, operation)}
                onSelectAuthoring={selectAuthoring}
                layers={layers}
                selectedLayerId={selectedLayerId}
                hoveredLayerId={hoveredLayerId}
                onReorderLayer={mode === 'design' && inspecting ? reorderLayers : undefined}
                hiddenViews={mode === 'design' ? hidden.views : NO_FILES}
                onHideLayer={(layer) => void applyEdit({ kind: 'hide' }, layer)}
                onShowHidden={showHidden}
                layersEditable={mode === 'design' && inspecting}
                stale={stale}
                onSelectLayer={selectLayer}
                tree={fileTree}
                activeFileId={activeFileId}
                filesWithErrors={filesWithErrors}
                diagnostics={allDiagnostics}
                canDelete={files.length > 1}
                onSelect={openSource}
                onCreateFile={(name, parent) => { setMode('develop'); return createFile(name, parent) }}
                onCreateFolder={createFolder}
                onTogglePanel={() => togglePane('navigator')}
                onRenameFile={renameFile}
                onRenameFolder={renameFolder}
                onDeleteFile={deleteFile}
                onDeleteFolder={deleteFolder}
                onDuplicateFile={duplicateFile}
                onMoveFile={moveFile}
                onRevealDiagnostic={revealSpanIn}
                onOpenTemplates={openGallery}
              />
            </div>
            <Splitter
              orientation="col"
              size={layout.nav}
              onResize={(size) => setSize('navigator', size)}
              min={PANE_LIMITS.navigator.min}
              max={PANE_LIMITS.navigator.max}
              direction={1}
              label="Navigator width"
              onToggle={() => togglePane('navigator')}
            />
          </>
        ) : <div className={styles.panelRail}><button type="button" className={styles.panelToggle} data-testid="pane-toggle-navigator" aria-pressed="false" aria-label="Show left panel" title="Show left panel" onClick={() => togglePane('navigator')}><Icon name="sidebar-left" size={16} /></button></div>}

        <div className="flex min-w-0 flex-1 flex-col" style={mode === 'design' ? { display: 'none' } : undefined}>
          <TabBar
            key={project.id}
            onRenameFile={renameFile}
            openFileIds={openFileIds}
            activeFileId={activeFileId}
            filesWithErrors={filesWithErrors}
            onSelect={setActiveFile}
            onClose={closeFile}
          />

          {activeFile ? (
            <JumpBar
              fileId={activeFile.id}
              text={activeFile.text}
              caret={caret}
              onJump={(offset) => revealSpanIn(activeFile.id, offset)}
            />
          ) : null}

          {rename ? (
            <RenameBar
              rename={rename}
              onCancel={() => setRename(null)}
              onConfirm={(newName) => {
                renameSymbol(rename.spans, newName)
                setRename(null)
              }}
            />
          ) : null}

          <div className="min-h-0 flex-1">
            {activeFile ? (
              <EditorPane
                // Remount editor selection per file; undo belongs to the project timeline.
                key={`${project.id}:${activeFile.id}`}
                text={activeFile.text}
                diagnostics={diagnostics}
                onChange={handleChange}
                onUndo={undo}
                onRedo={redo}
                onSave={() => void flush()}
                reveal={reveal}
                fileId={activeFile.id}
                language={language}
                onOpenFile={revealSpanIn}
                onRename={(name, spans) => setRename({ name, spans })}
                onCaret={setCaret}
              />
            ) : (
              <p className="p-4 text-[12px] text-xc-text-3">No file selected.</p>
            )}
          </div>

          {mode !== 'design' ? debugArea : null}
        </div>

        {layout.showPreview ? (
          <>
            {mode !== 'design' && <Splitter
              orientation="col"
              size={layout.preview}
              onResize={(size) => setSize('preview', size)}
              min={PANE_LIMITS.preview.min}
              max={PANE_LIMITS.preview.max}
              direction={-1}
              label="Preview width"
              onToggle={() => togglePane('preview')}
            />}
            <div style={mode === 'design' ? { flex: 1, minWidth: 0 } : { width: layout.preview }} className="flex shrink-0 flex-col overflow-hidden">
              <div className="min-h-0 flex-1">
              <DevicePane
                expanded={mode === 'design'}
                projectId={project.id}
                previewIdentity={previewIdentity}
                panelLayout={`${layout.showNavigator}:${shown.preview}`}
                showSettings={shown.preview}
                settingsWidth={settingsWidth}
                onSettingsResize={(size) => setSize('settings', size)}
                onToggleSettings={() => togglePane('preview')}
                onHoverNode={setHoveredNode}
                pages={mode === 'design' && showingAllPages ? result?.pages : undefined}
                pageCount={pageCount}
                onSelectPage={openPage}
                allPages={allPages}
                onToggleAllPages={setAllPages}
                belowCanvas={mode === 'design' ? debugArea : null}
                tool={tool}
                selection={selection}
                authoringFeatures={{ assets: project.assets, snapshot: result?.authoring, onSelect: selectAuthoring, onPreview: saveScenario, descriptions: project.studio?.components, onDescribe: description => {
                  const state = useStudio.getState(), before = project.studio, metadata = before ?? emptyStudioMetadata()
                  if (state.project !== project || stale) return 'Wait for the current source to compile.'
                  return state.commitTransaction(project, { projectId: project.id, baseRevision: state.documentRevision, changes: [], studio: { before, after: { ...metadata, components: [...metadata.components.filter(c => c.owner !== description.owner), description] } } })
                }, onCommand: operation => authoringNode ? performDesignEdit(authoringNode.source, authoringNode.fingerprint, authoringNode.owner, operation) : Promise.resolve('Select a source layer first.') }}
                authoringTools={<ProjectResources project={project} snapshot={result?.authoring} stale={stale} onCommand={operation => {
                  const node = result?.authoring?.nodes[0]
                  return node ? performDesignEdit(node.source, node.fingerprint, node.owner, operation) : Promise.resolve('Wait for the project to compile.')
                }} onAssets={async (assets: readonly ImageAsset[], operation) => {
                  const state = useStudio.getState()
                  if (state.project !== project || stale || editingRef.current) return 'The project changed or is still compiling. Try again.'
                  editingRef.current = true
                  try {
                    validateAssets(assets)
                    const node = result?.authoring?.nodes[0]
                    if (operation && !node) return 'Compile the source before changing image references.'
                    const plan = operation && node ? await planDesignEdit({ projectId: project.id, baseRevision: state.documentRevision, scope: node.owner, files: project.files, target: node.source, fingerprint: node.fingerprint, operation }) : { ok: true as const, projectId: project.id, baseRevision: state.documentRevision, changes: [] }
                    if (!plan.ok) return plan.reason
                    return useStudio.getState().commitTransaction(project, { ...plan, selection: undefined, assets: { before: project.assets, after: assets } })
                  } catch (e) { return e instanceof Error ? e.message : 'Could not update images.' } finally { editingRef.current = false }
                }} />}
                previewTools={<PreviewScenarios key={project.id} snapshot={result?.authoring} stale={stale} scenarios={project.studio?.scenarios ?? []} active={scenario?.name ?? ''} onSelect={name => setScenarioSelection({ projectId: project.id, name })} onSave={saveScenario} onReset={run} onDelete={name => {
                  const state = useStudio.getState()
                  if (state.project !== project || !project.studio) return
                  const error = state.commitTransaction(project, { projectId: project.id, baseRevision: state.documentRevision, changes: [], studio: { before: project.studio, after: { ...project.studio, scenarios: project.studio.scenarios.filter(s => s.name !== name) } } })
                  if (error) setEditNote(error); else setScenarioSelection(null)
                }} />}
                authoringNode={authoringNode}
                onChangeAuthoring={changeProperty}
                onRevealAuthoring={span => revealSpanIn(span.file, span.start)}
                onReorderNodes={reorderNodes}
                centerOn={centerOn}
                status={previewStatus}
                inspectorTab={inspectorTab}
                onInspectorTab={setInspectorTab}
                onDeviceChange={setDevice}
                tools={previewTools}
                device={device}
                tree={result?.renderTree ?? null}
                selectedRenderIds={selectedRenderIds}
                stale={stale}
                onEvent={handleEvent}
                inspecting={inspecting}
                onRevealSource={inspectSelect}
                preview={previewSettings}
                onPreviewChange={(settings: Partial<PreviewSettings>) => setPreview(settings)}
              />
              </div>
            </div>
          </>
        ) : <div className={styles.panelRail}><button type="button" className={styles.panelToggle} data-testid="pane-toggle-preview" aria-pressed="false" aria-label="Show preview" title="Show preview" onClick={() => togglePane('preview')}><Icon name="sidebar-right" size={16} /></button></div>}
      </div>
      {!layout.showPreview && <div className={styles.codeFooter}>{previewTools}</div>}

      </div>
      {shortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
      {adding ? (
        <AddView
          target={addTarget}
          onClose={() => setAdding(false)}
          onChoose={(snippet) => {
            setAdding(false)
            void applyEdit({ kind: 'insert', snippet: snippet.snippet }, addTargetLayer)
          }}
        />
      ) : null}

      {switcherOpen ? (
        <FileSwitcher
          files={files}
          onSelect={(fileId) => {
            setSwitcherOpen(false)
            openSource(fileId)
          }}
          onClose={() => setSwitcherOpen(false)}
        />
      ) : null}

      {galleryOpen ? (
        <TemplateGallery
          currentProject={project}
          onImport={async (expected, incoming, removedNames) => { const referenceProblem = await validateResourceRemoval(incoming.files, removedNames); if (referenceProblem) return referenceProblem; const problem = await useStudio.getState().importProject(expected, incoming); if (!problem) setGalleryOpen(false); return problem }}
          projectId={project.id}
          projectName={project.manifest.name}
          fileCount={files.length}
          recents={recents}
          pristine={isPristine(project)}
          origin={origin}
          savedAt={lastSavedAt}
          atLaunch={galleryAtLaunch}
          onClose={() => setGalleryOpen(false)}
          onChoose={async (templateId) => {
            const made = await applyTemplate(templateId)
            // Kept open on failure: the sheet is where the message goes, and closing
            // it would leave somebody looking at a project they did not ask for.
            if (made) setGalleryOpen(false)
            return made
          }}
          onOpenProject={openProject}
          onRemoveProject={(id) => void removeProject(id)}
          onOpenFiles={async (picked) => {
            const opened = await openFiles(picked)
            if (opened) setGalleryOpen(false)
            return opened
          }}
        />
      ) : null}
    </main>
  )
}

/**
 * The rename prompt.
 *
 * It states the count and the file spread before anything changes, because that is the
 * one thing the analyser cannot decide for the user: matching is by name, so two
 * unrelated symbols spelled the same are indistinguishable to it. "12 occurrences in
 * 3 files" is how that ambiguity gets handed over - a number that looks wrong is a
 * reason to press Escape.
 */
function RenameBar({
  rename,
  onConfirm,
  onCancel,
}: {
  rename: { name: string; spans: readonly SourceSpan[] }
  onConfirm: (newName: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(rename.name)
  const files = new Set(rename.spans.map((s) => s.file)).size

  return (
    <form
      className="flex h-[30px] shrink-0 items-center gap-2.5 border-b border-xc-line bg-xc-bar px-2.5 text-[11.5px]"
      data-testid="rename-bar"
      onSubmit={(e) => {
        e.preventDefault()
        if (value && value !== rename.name) onConfirm(value)
        else onCancel()
      }}
    >
      <Icon name="new-file" size={13} className="text-xc-text-3" />
      <span className="text-xc-text-2">
        Rename <span className="font-mono text-xc-text">{rename.name}</span>
      </span>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        spellCheck={false}
        aria-label="New name"
        data-testid="rename-input"
        className="h-[20px] w-48 rounded-[5px] border border-xc-accent bg-xc-panel px-2 font-mono text-xc-text outline-none"
      />
      <span className="text-xc-text-3" data-testid="rename-count">
        {rename.spans.length} {rename.spans.length === 1 ? 'occurrence' : 'occurrences'} in{' '}
        {files} {files === 1 ? 'file' : 'files'}
      </span>
      <span className="ml-auto text-xc-text-3">Enter to rename · Esc to cancel</span>
    </form>
  )
}
