'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ArchiveFormat, AuthoringNode, CopiedView, DesignEditRequest, NavigationOperation, PreviewInput, ResourceOperation } from '@studio/shared'
import { LAYER_MOVE_CONTAINERS, validatePreviewScenario, reconcileAuthoringSelection, type AuthoringSelection, type AuthoringSnapshot } from '@studio/shared'
import { emptyStudioMetadata, buildFileTree, encodeProject, isPristine, shareLink, type Project, type StudioMetadata } from '@studio/project-model'
import { findFile } from '@studio/project-model'
import { DEFAULT_DEVICE, getDevice } from '@studio/sim-shell'
import type { DropPosition, FileId, PagePreview, PreviewScenario, RenderNode, RenderTree, SourcePoint, SourceSpan, ViewLayer } from '@studio/shared'
import { AI_EDITING, useStudio, type PreviewSettings } from '../lib/store'
import type { HiddenViewInfo, ViewSiteInfo } from '@studio/shared'
import { AddView } from './AddView'
import { imageViewSnippet } from '../lib/images'
import { imageDataURL, validateAssets, type ImageAsset } from '@studio/project-model'
import type { CanvasTool } from './Toolbar'
import { useLayout, PANE_LIMITS, type PaneKey } from '../lib/layout'
import { findLayer, insertionLayer, layerForRenderNode, layerRenderIds } from '../lib/layers'
import { navigationDestinationForPage } from '../lib/navigationPicker'
import { useNavigationPicker } from '../lib/useNavigationPicker'
import { authoringRenderIds, hoveredSourceIds, resolveAuthoringRuntimeSelection } from '../lib/authoringHover'
import { useCompiler } from '../lib/useCompiler'
import { phoneView } from '../lib/phoneView'
/**
 * Problems, output, timings and coverage, fetched when the panel is opened.
 *
 * The panel is closed by default and the four tabs behind it are a few kilobytes
 * that the first paint does not need - and the chunk they would otherwise sit in is
 * the one the browser must have before anything appears at all.
 */
const ConsolePane = dynamic(() => import('./ConsolePane').then((m) => m.ConsolePane), { ssr: false })
import { InspectorReadout } from './InspectorReadout'
import { DevicePane } from './DevicePane'
import { AuthoringInspector } from './AuthoringInspector'
import type { FeatureProps } from './AuthoringFeatures'
import { DesignNavigator, type DesignLevel } from './DesignNavigator'
import { StudioSidebar } from './StudioSidebar'
import { AiEditBanner } from './AiEditBanner'
import { LogicalLayers } from './LogicalLayers'
import { AppSettings } from './settings/AppSettings'
import { AppNavigationSettings } from './settings/AppNavigationSettings'
import { ScreenSettings } from './settings/ScreenSettings'
import { AppearancePicker, DevicePicker, TextSizePicker } from './PreviewEnvironment'
import { designScreens, designTree, type DesignTree } from '../lib/designTree'
import { sourceLayerLabel } from '../lib/sourceLayers'
const EditorPane = dynamic(() => import('./EditorPane').then(m => m.EditorPane), { ssr: false })
import { ShortcutsDialog } from './ShortcutsDialog'
import { FileSwitcher } from './FileSwitcher'
import { JumpBar } from './JumpBar'
import { reconcileLayerLabel } from '../lib/layerLabels'
const DesignReview = dynamic(() => import('./DesignReview').then(m => m.DesignReview), { ssr: false })
import { scenarioKey, scenarioScreen, screenCatalog, screenDefinition, type ScreenCommand, type DesignScreen } from '../lib/screens'
import { Navigator } from './Navigator'
import { TabBar } from './TabBar'
import { TemplateGallery, type GallerySource } from './TemplateGallery'
import { Toolbar, PreviewStatus, PreviewTools } from './Toolbar'
import { BUILD_DETAILS, BUILD_NAME } from '../lib/build'
import { eventLog, type StudioChange } from '../lib/eventLog'
import { designEvent, refusedClipboard, studioChange } from '../lib/designEvents'
import { NOTHING_COPIED, busyEditProblem } from '../lib/editRefusals'
import { crashIfTesting, leavingOnPurpose } from '../lib/recovery'
import { PaneBoundary } from './PaneBoundary'
import { ErrorBanner } from './ErrorBanner'
import { StorageBanner } from './StorageBanner'
import { saveNote, storageProblem } from '../lib/storageProblem'
import { keyFocus, shortcutFor, SHORTCUT_KEYS } from '../lib/shortcuts'
import { COMFORTABLE_WIDTH, environmentPlacement, paneLayout, type EnvironmentPicker } from '../lib/paneLayout'
import { OpenElsewhere } from './OpenElsewhere'
import { startStudioTab, studioTabState, subscribeStudioTab } from '../lib/activeTab'
import styles from './Workspace.module.css'
import { Splitter } from './ui/Splitter'
import { Icon } from './ui/Icon'

const NO_FILES: never[] = []
const EMPTY_TREE: DesignTree = { navigation: 'none', lanes: [], sheets: [], detached: [], components: [] }

/** Changes the studio's own records for `project`: one Undo step, named `op` in the event log. */
function commitStudioRecords(project: Project, after: StudioMetadata, op: StudioChange): string | null {
  const state = useStudio.getState()
  return state.commitTransaction(project, { projectId: project.id, baseRevision: state.documentRevision, changes: [], studio: { before: project.studio, after } }, studioChange(op))
}

export function Studio() {
  const project = useStudio((s) => s.project)
  const activeFileId = useStudio((s) => s.activeFileId)
  const openFileIds = useStudio((s) => s.openFileIds)
  const loaded = useStudio((s) => s.loaded)
  const origin = useStudio((s) => s.origin)
  const lastSavedAt = useStudio((s) => s.lastSavedAt)
  const saveError = useStudio((s) => s.saveError)
  const saveOutdated = useStudio((s) => s.saveOutdated)
  const loadError = useStudio((s) => s.loadError)
  const durable = useStudio((s) => s.durable)
  const storage = useMemo(() => storageProblem({ saveError, saveOutdated, durable, loadError }), [saveError, saveOutdated, durable, loadError])
  const previewSettings = useStudio((s) => s.preview)
  const canUndo = useStudio((s) => s.canUndo)
  /** An AI edit holds the project: editing waits until its answer lands (G12). */
  const aiEditing = useStudio((s) => s.aiEdit !== null)
  const canRedo = useStudio((s) => s.canRedo)

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
  const [hoveredAuthoring, setHoveredAuthoring] = useState<{ node: AuthoringNode; runtimeId?: string; projectId?: string } | null>(null)
  const [designPageSelection, setDesignPageSelection] = useState<{ projectId: string; id: string } | null>(null)
  const hoverProjectId = project?.id
  const hoverAuthoring = useCallback((node: AuthoringNode | null, runtimeId?: string) => setHoveredAuthoring(node ? { node, runtimeId, projectId: hoverProjectId } : null), [hoverProjectId])
  const hoverPreview = useCallback((node: RenderNode | null, pageId?: string) => {
    setHoveredNode(node)
    if (node && pageId && hoverProjectId) setDesignPageSelection(previous => previous?.projectId === hoverProjectId && previous.id === pageId ? previous : { projectId: hoverProjectId, id: pageId })
  }, [hoverProjectId])
  const setNavigatorTab = useLayout(s => s.setNavigatorTab)
  const navigatorLayout = useLayout(s => s.navigatorLayout)
  const setNavigatorLayout = useLayout(s => s.setNavigatorLayout)
  /**
   * Which settings level the right-hand panel shows when no view is selected: the App,
   * or the focused screen. A selected view always means the View level.
   */
  const [focusLevel, setFocusLevel] = useState<{ projectId: string; level: 'app' | 'screen' } | null>(null)
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

  const [inspecting, setInspecting] = useState(true)
  const [previewFrom, setPreviewFrom] = useState<{ projectId: string; view: string } | null>(null)
  const focusedDesignPage = useRef<PagePreview | undefined>(undefined)
  /**
   * The page gallery: every page drawn at once, instead of the one that is running.
   *
   * Design's alone. In Code the canvas is a column beside the editor, where six
   * phones would each be the width of a word - and the pages would be laid out on
   * every keystroke to draw them.
   */
  // The canvas is the app's map: every lane, from the start. Narrowing to one lane
  // is a choice the designer makes, not where they begin.
  const [allPages, setAllPages] = useState(true)
  /** What a click on the canvas does: choose a view, or take one out. */
  const [tool, setToolState] = useState<CanvasTool>('select')
  const [adding, setAdding] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pageFocusEpoch, setPageFocusEpoch] = useState(0)
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
  /** What the last edit said; a refusal that points into the source - a syntax error Code can show - carries where. */
  const [editNote, setEditNote] = useState<string | { readonly text: string; readonly location: SourcePoint } | null>(null)
  const noteText = typeof editNote === 'string' ? editNote : editNote?.text
  const noteLocation = typeof editNote === 'string' ? undefined : editNote?.location
  const [exporting, setExporting] = useState(false)
  const exportInProgress = useRef(false)
  /** Serializes source planning; typing can still invalidate an in-flight plan. */
  const editingRef = useRef(false)
  const [preparingEdit, setPreparingEdit] = useState(false)
  const [committedEditRevision, setCommittedEditRevision] = useState(0)
  /** A view copied from Layers or the canvas, as the Swift that draws it. */
  const [clipboard, setClipboard] = useState<CopiedView | null>(null)
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
  /** Where the sheet opens when it was asked for: the projects, or a new one. */
  const [gallerySource, setGallerySource] = useState<GallerySource | undefined>(undefined)
  const greeted = useRef(false)
  const [caret, setCaret] = useState(0)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY)
  const [reveal, setReveal] = useState<{ offset: number; nonce: number } | null>(null)
  const revealNonce = useRef(0)

  /** Whether this tab has the studio, or another tab does (B1). Nothing loads until it is this one. */
  const tab = useSyncExternalStore(subscribeStudioTab, studioTabState, () => 'checking' as const)
  useEffect(() => { startStudioTab(options => useStudio.getState().handOver(options)) }, [])
  useEffect(() => {
    if (tab === 'active') void load()
  }, [tab, load])

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
    // Coming back to saved work - or after a crash, when the next project opened should
    // be a choice - leads to the projects rather than to a new one (B6). The untouched
    // starter on its own is not work yet; a rename is, as it is everywhere else.
    const { project: opened, recents: saved } = useStudio.getState()
    const untouched = !!opened && opened.manifest.templateId !== undefined && isPristine(opened)
    setGallerySource(origin === 'recovered' || (origin === 'restored' && (!untouched || saved.length > 1)) ? 'open' : 'design')
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
    if (!designing) { const page = focusedDesignPage.current; setPreviewFrom(project && page?.standalone && page.id.startsWith('screen:') ? { projectId: project.id, view: page.id.slice(7) } : null) }
    setInspecting(designing)
    setInspectorTab(designing ? 'settings' : 'preview')
    if (!designing) setTool('select')
  }, [setInspectorTab, setTool, project])

  const toggleInspect = useCallback(() => setDesigning(!inspecting), [setDesigning, inspecting])

  /**
   * A change a panel asks the store for. While an AI edit holds the project the store
   * refuses it; this says why, rather than failing silently or as if the name were wrong.
   */
  const unlessAiEditing = <A extends unknown[], R>(change: (...args: A) => R, refused: R) => (...args: A): R => {
    if (!useStudio.getState().aiEdit) return change(...args)
    setEditNote(AI_EDITING)
    return refused
  }

  const openGallery = useCallback((source: GallerySource) => {
    // Opening another project would stop the AI edit and throw away its paid answer (G12).
    if (useStudio.getState().aiEdit) { setEditNote(AI_EDITING); return }
    setGallerySource(source)
    setGalleryAtLaunch(false)
    setGalleryOpen(true)
  }, [])

  // Debounced autosave can lose the last edit when a tab is closed or backgrounded,
  // so force the pending writes, the project's and the event log's, at both of the
  // points the browser gives us. Only when the tab is hidden: coming back to one has
  // nothing new to write, and used to put this tab's copy back over whatever another
  // tab had saved meanwhile (B1).
  useEffect(() => {
    const leaving = () => { void flush(); void eventLog.flush() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') leaving() }
    const onPageHide = leaving
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [flush])

  // Closing or reloading while work is not saved asks first (B3): a pending save may
  // not finish as the page goes, and a failing one never will. Not when a recovery
  // surface is reloading because somebody chose to there - they have been asked.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (tab !== 'active' || leavingOnPurpose() || !useStudio.getState().unsavedWork()) return
      void flush()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [tab, flush])

  const images = useMemo(() => project?.assets?.map(asset => ({ name: asset.name, width: asset.light.width / asset.scale, height: asset.light.height / asset.scale, light: imageDataURL(asset.light), dark: asset.dark ? imageDataURL(asset.dark) : undefined })), [project?.assets])
  const device = getDevice(project?.manifest.device ?? DEFAULT_DEVICE)
  const files = project?.files ?? NO_FILES
  const [scenarioSelection, setScenarioSelection] = useState<{ projectId: string; key: string } | null>(null)
  const scenario = scenarioSelection?.projectId === project?.id ? project?.studio?.scenarios.find(s => scenarioKey(s) === scenarioSelection?.key) : undefined
  const standalonePreview = !inspecting && project?.id === previewFrom?.projectId ? previewFrom?.view : undefined
  const [previewResetEpoch, setPreviewResetEpoch] = useState(0)
  const previewIdentity = useMemo(() => JSON.stringify([project?.id, project?.files, scenario ?? null, previewResetEpoch]), [project?.id, project?.files, scenario, previewResetEpoch])

  const { result, stale, workerError, dispatch, reset, language, planDesignEdit, validateResourceRemoval, describeView, copyView, findCopies, hiddenViews } = useCompiler({
    projectId: project?.id,
    deploymentTarget: project?.manifest.deploymentTarget,
    images, colors: project?.colors, scenario, componentDescriptions: project?.studio?.components, designScreens: project?.studio?.screens, previewScreen: standalonePreview,
    files,
    device,
    colorScheme: previewSettings.colorScheme,
    typeScale: previewSettings.typeScale,
    dynamicTypeSize: previewSettings.dynamicTypeSize,
    previewTarget: project?.manifest.previewTarget,
    allPages: inspecting && mode === 'design',
    committedEditRevision,
  })

  /** The authoring snapshot on its own, so memoized work depends on it and not the whole result. */
  const snapshot = result?.authoring

  /**
   * The last screen that ran, per project and state, so that while the code has errors
   * the phone keeps it, dimmed, under the notice (FR-6.3).
   */
  const phoneKey = JSON.stringify([project?.id, scenario ?? null])
  const [lastRan, setLastRan] = useState<{ key: string; tree: RenderTree } | null>(null)
  const latestTree = result?.renderTree ?? null
  if (latestTree && !latestTree.notice && (lastRan?.tree !== latestTree || lastRan.key !== phoneKey)) setLastRan({ key: phoneKey, tree: latestTree })
  const phone = phoneView(latestTree, lastRan?.key === phoneKey ? lastRan.tree : null, workerError)

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
   * Layers asked for in a Design window too narrow to set it beside the canvas, where it is
   * drawn over the canvas instead (D15). Never stored: the window decides, not a preference.
   */
  const [layersOver, setLayersOver] = useState(false)
  /** The narrow-window note, dismissed for this visit. */
  const [narrowNoted, setNarrowNoted] = useState(false)
  const layout = useMemo(() => paneLayout({ available, mode, shown, widths: { navigator: navigatorWidth, preview: previewWidth }, layersOver }),
    [available, navigatorWidth, previewWidth, shown, mode, layersOver])
  // Closed once the window has room for it beside the canvas, so narrowing again does not reopen it.
  if (layersOver && !layout.narrow) setLayersOver(false)

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

  /** The left panel's button and ⌘0: over the canvas in a narrow Design window, the stored choice otherwise (D15). */
  const toggleLeftPanel = useCallback(() => {
    if (layout.narrow) setLayersOver(open => !open)
    else togglePane('navigator')
  }, [layout.narrow, togglePane])

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

  /** Reset interaction state while leaving the document and its undo history intact. */
  const run = useCallback(() => { void reset().then(() => { setPreviewResetEpoch(value => value + 1); setEditNote('Preview reset. Your design is unchanged.') }).catch(() => setEditNote('Could not reset the preview. Try again.')) }, [reset])


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

  const designPages = mode === 'design' && inspecting ? result?.pages : undefined
  const designPage = designPages?.find(page => project?.id === designPageSelection?.projectId && page.id === designPageSelection?.id)
    ?? designPages?.find(page => page.active) ?? designPages?.[0]
  useEffect(() => { if (inspecting) focusedDesignPage.current = designPage }, [inspecting, designPage])
  // What the person is looking at, in each project's event log: Design or Code, editing or trying the app.
  const projectId = project?.id
  useEffect(() => {
    if (projectId) eventLog.record(projectId, { type: 'mode', mode: mode === 'develop' ? 'code' : 'design', preview: !inspecting })
  }, [projectId, mode, inspecting])
  const livePage = result?.viewHierarchy?.find(layer => layer.type === 'Presentation') ?? result?.viewHierarchy?.find(layer => layer.page?.active)
  const pageHierarchy = useMemo(() => designPage?.viewHierarchy ?? (livePage ? [livePage] : undefined), [designPage?.viewHierarchy, livePage])
  const focusedPage = designPage ?? livePage
  const layers = useMemo(() => designPages?.length ? designPages.flatMap(page => page.viewHierarchy ?? []) : result?.viewHierarchy ?? NO_FILES, [designPages, result?.viewHierarchy])
  const designRootId = designPage?.rootId ?? designPage?.id
  const pageCount = designPages?.length ?? layers.filter(layer => layer.type === 'Page').length
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

  const navigationPickerIdentity = useMemo(() => ({ projectId: project?.id, files: project?.files, nodeId: authoringNode?.id, inspecting, mode, inspectorTab, showSettings: shown.preview }), [project?.id, project?.files, authoringNode?.id, inspecting, mode, inspectorTab, shown.preview])
  const navigationPicker = useNavigationPicker(navigationPickerIdentity, mode === 'design' && inspecting && shown.preview && !stale)
  const pickingNavigation = !!navigationPicker.destinations
  const visibleRootId = showingAllPages || pickingNavigation ? undefined : designRootId
  const navigationPageTargets = useMemo(() => navigationPicker.destinations && designPages ? Object.fromEntries(designPages.map(page => [page.id, navigationDestinationForPage(page, navigationPicker.destinations!, result?.authoring, project?.files ?? NO_FILES)])) : undefined, [navigationPicker.destinations, designPages, result?.authoring, project?.files])

  const selectAuthoring = useCallback((node: AuthoringNode, runtimeId?: string) => {
    const snapshot = result?.authoring
    if (!project || stale || !snapshot || snapshot.projectId !== project.id) return
    setPendingSelect(null); setEditNote(null); setFocusLevel(null)
    useStudio.getState().setDocumentSelection({ file: node.source.file, offset: node.source.start })
    const runtime = runtimeId ?? (node.kind === 'definition' ? layerSelection?.anchor?.runtimeId : undefined)
    setLayerSelection({ projectId: project.id, id: runtime ?? node.runtimeIds[0] ?? '', anchor: { snapshot, nodeId: node.id, files: project.files, ...(runtime ? { runtimeId: runtime } : {}) } })
    if (node.kind === 'branch') {
      const related = designPages?.filter(page => page.parentId && page.source?.file === node.source.file && page.source.start <= node.source.start && page.source.end >= node.source.end)
        .sort((a, b) => Number(b.rootId === designRootId) - Number(a.rootId === designRootId) || (a.source!.end - a.source!.start) - (b.source!.end - b.source!.start))[0]
      if (related) {
        setDesignPageSelection({ projectId: project.id, id: related.id })
        setCenterOn({ id: related.id, nonce: ++centerNonce.current })
      }
    }
    setInspectorTab('settings')
  }, [project, stale, result?.authoring, setInspectorTab, layerSelection?.anchor?.runtimeId, designPages, designRootId])

  const saveScenario = useCallback((name: string, inputs: readonly PreviewInput[]): string | null => {
    const state = useStudio.getState(), snapshot = result?.authoring
    if (!project || state.project !== project || stale || !snapshot) return 'Wait for the current source to finish compiling.'
    const scenario = { name: name.trim(), owner: inputs[0]?.owner ?? '', hook: '', inputs }
    const problem = validatePreviewScenario(snapshot, scenario)
    if (problem) return problem
    const before = project.studio, metadata = before ?? emptyStudioMetadata()
    const after = { ...metadata, scenarios: [...metadata.scenarios.filter(s => scenarioKey(s) !== scenarioKey(scenario)), scenario] }
    const error = commitStudioRecords(project, after, 'state-save')
    if (!error) setScenarioSelection({ projectId: project.id, key: scenarioKey(scenario) })
    return error
  }, [project, stale, result?.authoring])

  const captureLayer = useCallback((layer: ViewLayer) => {
    if (!project || stale) return
    setFocusLevel(null)
    if (layer.source) useStudio.getState().setDocumentSelection({ file: layer.source.file, offset: layer.source.start })
    const snapshot = result?.authoring
    const nodeId = snapshot?.runtimeToSource[layer.id]
    setLayerSelection({ projectId: project.id, id: layer.id, anchor: snapshot && nodeId ? { snapshot, nodeId, files: project.files, runtimeId: layer.id } : undefined })
  }, [project, stale, result?.authoring])

  const sourceRuntimeSelection = useMemo(() => resolveAuthoringRuntimeSelection(authoringNode, result?.authoring, layers, layerSelection?.anchor?.runtimeId, pageHierarchy), [authoringNode, result?.authoring, layers, layerSelection?.anchor?.runtimeId, pageHierarchy])
  const selectedLayerId = editedLayer?.id
    ?? (layerSelection?.anchor ? sourceRuntimeSelection.layer?.id ?? null
      : layerSelection?.projectId === project?.id ? layerSelection?.id ?? null : null)
  const selectedRenderIds = useMemo(() => {
    if (mode !== 'design') return new Set<string>()
    const trees = designPages?.map(page => page.tree) ?? [result?.renderTree]
    const exact = sourceRuntimeSelection.exact ? sourceRuntimeSelection.layer?.id : undefined
    return new Set(trees.flatMap(tree => [...(exact
      ? layerRenderIds(findLayer(layers, exact), tree, layers)
      : authoringRenderIds(authoringNode, result?.authoring, pageHierarchy ?? layers, tree))]))
  }, [mode, designPages, result?.renderTree, result?.authoring, sourceRuntimeSelection, layers, authoringNode, pageHierarchy])
  const selectLayer = (layer: ViewLayer, page: ViewLayer) => {
    if (stale || !project) return
    setPendingSelect(null)
    setEditNote(null)
    captureLayer(layer)
    // Bring its page into view, which is what makes Layers usable on a canvas that
    // has been zoomed into or panned away from the page being chosen.
    setCenterOn({ id: page.id, nonce: ++centerNonce.current })
    const preview = designPages?.find(item => item.id === page.id)
    if (preview) setDesignPageSelection({ projectId: project.id, id: preview.id })
    else if (page.page?.handlerId && !page.page.active) {
      void dispatch({ kind: 'tap', handlerId: page.page.handlerId, location: { x: 0, y: 0 } })
    }
  }

  /** Focus a design phone without navigating or mutating the running app. */
  const openPage = useCallback((page: PagePreview) => {
    if (!project) return
    setFocusLevel({ projectId: project.id, level: 'screen' })
    setDesignPageSelection({ projectId: project.id, id: page.id })
    setPageFocusEpoch(value => value + 1)
    setLayerSelection(null)
    setPendingSelect(null)
    setHoveredNode(null)
    setHoveredAuthoring(null)
    setCenterOn({ id: page.id, nonce: ++centerNonce.current })
  }, [project])

  /** The App level: tokens, navigation and images. Clicking empty canvas lands here too. */
  const selectApp = useCallback(() => {
    if (!project) return
    setFocusLevel({ projectId: project.id, level: 'app' })
    setLayerSelection(null)
    setPendingSelect(null)
    setHoveredNode(null)
    setHoveredAuthoring(null)
    setEditNote(null)
  }, [project])

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
  const performDesignEdit = useCallback(async (target: SourceSpan, fingerprint: string | undefined, scope: string, operation: DesignEditRequest['operation'], screenUpdate?: readonly DesignScreen[], scenarioFrom?: (authoring: AuthoringSnapshot | undefined) => PreviewScenario | null, assets?: readonly ImageAsset[], keepSelection = false): Promise<string | null> => {
    const state = useStudio.getState()
    // The layer the edit lands on, or the hidden view Show brings back.
    const landsOn = result?.authoring?.nodes.find(node => node.source.file === target.file && node.source.start === target.start && node.source.end === target.end)
      ?? hidden.views.find(view => view.file === target.file && view.offset === target.start)
    const label = designEvent(operation, landsOn)
    // Said where the designer is looking and logged, as the planner's refusals are (C7).
    const blocked = busyEditProblem({ current: !!project && state.project === project, stale, applying: editingRef.current })
    if (blocked || !project) {
      setEditNote(blocked)
      if (project) eventLog.record(project.id, { ...label, refused: true })
      return blocked
    }
    editingRef.current = true
    setPreparingEdit(true)
    try {
      if (assets) validateAssets(assets)
      const plan = await planDesignEdit({ projectId: project.id, baseRevision: state.documentRevision, authoringRevision: result?.authoring?.revision, scope, deploymentTarget: project.manifest.deploymentTarget, files: project.files, colors: project.colors, componentDescriptions: project.studio?.components, target, fingerprint, operation })
      if (!plan.ok) {
        eventLog.record(project.id, { ...label, refused: true })
        setEditNote(plan.location ? { text: plan.reason, location: plan.location } : plan.reason)
        return plan.reason
      }
      // Context settings edit the navigation owner while the designer keeps the
      // visible label/row selected. Reconcile it against the exact planned source.
      const afterFiles = project.files.map(file => ({ ...file, text: plan.changes.find(change => change.file === file.id)?.after ?? file.text }))
      const navigationSelection = operation.kind === 'navigation-target' && authoringNode && result?.authoring && plan.authoring
        ? reconcileAuthoringSelection({ snapshot: result.authoring, nodeId: authoringNode.id, files: project.files }, plan.authoring, afterFiles)
        : undefined
      const { colorSets: planColors, ...planned } = plan
      const selectedPlan = navigationSelection ? { ...planned, selection: { file: navigationSelection.source.file, offset: navigationSelection.source.start } } : planned
      const preserveSelection = keepSelection || ['style-edit', 'style-create', 'style-migrate', 'asset-references'].includes(operation.kind)
      // A colour token's values live in the asset catalog, and change with its Swift.
      const colorChange = planColors ? { colors: { before: project.colors, after: planColors } } : {}
      const changed = plan.changes.length > 0 || !!planColors || !!assets
      const currentSelection = useStudio.getState().documentSelection
      const selectionChanged = JSON.stringify(currentSelection) !== JSON.stringify(state.documentSelection)
      const before = project.studio, metadata = before ?? emptyStudioMetadata()
      const screens = screenUpdate ?? (operation.kind === 'guided-action' && operation.createScreen ? [...screenCatalog(result?.authoring, result?.pages, metadata.screens), { view: operation.createScreen.name, name: operation.createScreen.title }] : undefined)
      const labels = metadata.labels.flatMap(label => {
        const old = result?.authoring?.nodes.filter(n => n.owner === label.owner && n.fingerprint === label.fingerprint && (label.offset === undefined || label.offset === n.source.start)) ?? []
        if (old.length !== 1 || !plan.authoring) return [label]
        const moved = reconcileLayerLabel(old[0]!, result!.authoring!, plan.authoring, project.files, afterFiles, operation, target, plan.selection?.offset)
        return moved ? [{ ...label, owner: moved.owner, fingerprint: moved.fingerprint, offset: moved.source.start }] : []
      })
      // A state saved beside the value it switches: one edit, one undo.
      const savedScenario = scenarioFrom?.(plan.authoring) ?? null
      const scenarios = savedScenario ? [...metadata.scenarios.filter(item => scenarioKey(item) !== scenarioKey(savedScenario)), savedScenario] : undefined
      const transaction = { ...selectedPlan, ...colorChange, ...(assets ? { assets: { before: project.assets, after: assets } } : {}), ...(screens || scenarios || JSON.stringify(labels) !== JSON.stringify(metadata.labels) ? { studio: { before, after: { ...metadata, ...(screens ? { screens } : {}), ...(scenarios ? { scenarios } : {}), labels } } } : {}) }
      const problem = useStudio.getState().commitTransaction(project, selectionChanged || preserveSelection ? { ...transaction, selection: undefined } : transaction, label)
      if (problem) { setEditNote(problem); eventLog.record(project.id, { ...label, refused: true }); return problem }
      if (savedScenario) setScenarioSelection({ projectId: project.id, key: scenarioKey(savedScenario) })
      if (changed) setCommittedEditRevision(revision => revision + 1)
      if (plan.changes.length && !selectionChanged && !preserveSelection) {
        const selected = selectedPlan.selection
        const snapshot = plan.authoring
        const node = selected && snapshot?.nodes.find(n => n.source.file === selected.file && n.source.start === selected.offset && n.kind !== 'definition')
        const files = useStudio.getState().project!.files
        setLayerSelection(node && snapshot ? { projectId: project.id, id: '', anchor: { snapshot, nodeId: node.id, files } } : null)
        const text = selected && useStudio.getState().project?.files.find(f => f.id === selected.file)?.text
        setPendingSelect(selected && typeof text === 'string' ? { ...selected, projectId: project.id, text } : null)
      }
      setEditNote(changed ? operation.kind === 'insert' || operation.kind === 'paste' ? 'View added. You can edit its properties or undo this change.' : operation.kind === 'delete' ? 'View deleted. Undo is available.' : operation.kind === 'behavior' ? 'Interaction updated. Switch to Preview to try it.' : 'Design updated.' : null)
      return null
    } finally { editingRef.current = false; setPreparingEdit(false) }
  }, [project, stale, planDesignEdit, result, authoringNode, hidden.views])

  /**
   * Giving a screen its first state.
   *
   * A state switches a value, and a screen that has none cannot have states. So this
   * writes the value onto the screen and saves the state that turns it on together:
   * the designer asked for a state, not for a Swift property.
   */
  const createStateValue = useCallback(async (view: string, state: string, value: { name: string; initial: boolean; when: boolean }): Promise<string | null> => {
    const definition = snapshot?.nodes.find(node => node.kind === 'definition' && node.name === view)
    if (!definition) return 'Wait for the screen to finish drawing.'
    if (!state.trim()) return 'Give the state a name.'
    return performDesignEdit(definition.source, definition.fingerprint, definition.owner, { kind: 'value-create', name: value.name, value: value.initial }, undefined, authoring => {
      const input = authoring?.inputs?.find(item => item.owner === view && item.name === value.name)
      return input ? { name: state.trim(), owner: view, hook: '', inputs: [{ owner: view, name: value.name, signature: input.signature, value: value.when }] } : null
    })
  }, [snapshot, performDesignEdit])

  const screens = useMemo(() => screenCatalog(result?.authoring, designPages, project?.studio?.screens), [result?.authoring, designPages, project?.studio?.screens])
  const updateScreens = async (command: ScreenCommand): Promise<string | null> => {
    if (!project || stale || preparingEdit) return 'Wait for the preview to finish updating.'
    const metadata = project.studio ?? emptyStudioMetadata()
    const name = 'name' in command ? command.name.trim() : ''
    if ('name' in command && (!name || name.length > 100)) return 'Enter a screen name of 1–100 characters.'
    if (command.kind === 'rename' || command.kind === 'up' || command.kind === 'down') {
      const next = [...screens], index = next.findIndex(s => s.view === command.view)
      if (index < 0) return 'Select an existing screen.'
      if (command.kind === 'rename') next[index] = { ...next[index]!, name }
      else { const to = index + (command.kind === 'up' ? -1 : 1); if (to < 0 || to >= next.length) return null; [next[index], next[to]] = [next[to]!, next[index]!] }
      return commitStudioRecords(project, { ...metadata, screens: next }, command.kind === 'rename' ? 'screen-rename' : 'screen-move')
    }
    const node = command.kind === 'create' ? result?.authoring?.nodes.find(n => n.kind === 'definition') : result?.authoring?.nodes.find(n => n.kind === 'definition' && n.name === command.view)
    if (!node) return 'Wait for the screen definitions to finish loading.'
    if (command.kind === 'remove') return performDesignEdit(node.source, node.fingerprint, node.owner, { kind: 'screen-remove' }, screens.filter(s => s.view !== command.view))
    const title = command.kind === 'create' ? name : (screens.find(s => s.view === command.view)?.name ?? 'Screen') + ' copy'
    const base = (title.replace(/[^a-zA-Z0-9 ]/g, '').split(/ +/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('').replace(/^[0-9]+/, '') || 'New') + 'Screen'
    let view = base, suffix = 2
    while (result?.authoring?.nodes.some(n => n.name === view)) view = base + suffix++
    const operation: DesignEditRequest['operation'] = command.kind === 'create' ? { kind: 'screen-create', name: view, title, layout: command.layout } : { kind: 'screen-duplicate', name: view }
    const error = await performDesignEdit(node.source, node.fingerprint, node.owner, operation, [...screens, { view, name: title }])
    if (!error) { setDesignPageSelection({ projectId: project.id, id: 'screen:' + view }); setCenterOn({ id: 'screen:' + view, nonce: ++centerNonce.current }); setLayerSelection(null); setPendingSelect(null) }
    return error
  }
  const renameLayer = (node: AuthoringNode, label: string): string | null => {
    if (!project || stale || preparingEdit) return 'Wait for the preview to finish updating.'
    if (label.trim().length > 100) return 'Use a layer name of 100 characters or fewer.'
    const metadata = project.studio ?? emptyStudioMetadata()
    const labels = metadata.labels.filter(l => !(l.owner === node.owner && l.fingerprint === node.fingerprint && (l.offset === undefined || l.offset === node.source.start)))
    if (label.trim()) labels.push({ owner: node.owner, fingerprint: node.fingerprint, offset: node.source.start, label: label.trim() })
    return commitStudioRecords(project, { ...metadata, labels }, 'layer-rename')
  }

  /**
   * The one tree the left panel, the settings panel and the canvas all read.
   *
   * Pages are only drawn while designing, so the last tree is kept for Preview: the
   * outline does not empty itself while the app is being tried.
   */
  const liveTree = useMemo(() => designPages ? designTree(designPages, result?.authoring, screens) : undefined, [designPages, result?.authoring, screens])
  const [lastTree, setLastTree] = useState<{ projectId: string; tree: DesignTree } | null>(null)
  if (liveTree && project && lastTree?.tree !== liveTree) setLastTree({ projectId: project.id, tree: liveTree })
  const tree = liveTree ?? (lastTree && lastTree.projectId === project?.id ? lastTree.tree : EMPTY_TREE)
  const treeScreens = useMemo(() => designScreens(tree), [tree])
  const focusedScreen = treeScreens.find(screen => screen.id === designPage?.id) ?? treeScreens.find(screen => screen.id === focusedPage?.id) ?? treeScreens[0]
  // Keep the view inspector mounted while its source is recompiling. Switching
  // briefly to screen settings used to reset every modifier and scroll position.
  const updatingSelectedView = stale && layerSelection?.projectId === project?.id && !!layerSelection?.anchor
  const level: DesignLevel = authoringNode || updatingSelectedView ? 'view' : focusLevel?.projectId === project?.id && focusLevel?.level === 'app' ? 'app' : 'screen'

  /**
   * What the canvas needs to draw the app's shape: the lanes, the states, and what
   * a state costs to draw.
   *
   * Every one of these comes from the same design tree the outline reads, so the
   * canvas cannot show a lane the outline does not, or name a screen differently.
   */
  const scenarios = project?.studio?.scenarios ?? NO_FILES
  const activeState = scenario ? scenarioKey(scenario) : undefined
  const canvas = useMemo(() => !designPages || !project ? undefined : {
    laneNames: [...tree.lanes.map(lane => lane.name), ...(tree.detached.length ? ['Not linked yet'] : [])],
    laneIcons: [...tree.lanes.map(lane => lane.root.page.icon), ...(tree.detached.length ? [undefined] : [])],
    sameScreen: (page: PagePreview) => screenDefinition(snapshot, page)?.name ?? page.id,
    ...(visibleRootId ? { visibleRootId } : {}),
    statesOf: (page: PagePreview) => {
      const view = screenDefinition(snapshot, page)?.name
      return view ? scenarios.filter(saved => scenarioScreen(saved) === view) : NO_FILES
    },
    ...(activeState ? { activeState } : {}),
    onSelectState: (page: PagePreview, state: PreviewScenario | null) => {
      openPage(page)
      setScenarioSelection(state ? { projectId: project.id, key: scenarioKey(state) } : null)
    },
    compile: {
      projectId: project.id,
      files,
      images,
      colors: project.colors,
      designScreens: project.studio?.screens,
      componentDescriptions: project.studio?.components,
      deploymentTarget: project.manifest.deploymentTarget,
      previewTarget: project.manifest.previewTarget,
    },
  }, [designPages, project, tree, snapshot, visibleRootId, scenarios, activeState, openPage, files, images])

  /** The App's own navigation is written against the project rather than a view. */
  const navigationCommand = useCallback((operation: NavigationOperation) => {
    const node = snapshot?.nodes[0]
    return node ? performDesignEdit(node.source, node.fingerprint, node.owner, operation) : Promise.resolve('Wait for the project to compile.')
  }, [snapshot, performDesignEdit])

  const resourceCommand = useCallback((operation: ResourceOperation) => {
    const node = result?.authoring?.nodes[0]
    return node ? performDesignEdit(node.source, node.fingerprint, node.owner, operation) : Promise.resolve('Wait for the project to compile.')
  }, [result?.authoring, performDesignEdit])

  const updateAssets = useCallback(async (assets: readonly ImageAsset[], operation?: ResourceOperation): Promise<string | null> => {
    const state = useStudio.getState()
    if (!project || state.project !== project || stale || editingRef.current) return 'The project changed or is still compiling. Try again.'
    editingRef.current = true
    try {
      validateAssets(assets)
      const node = snapshot?.nodes[0]
      if (operation && !node) return 'Compile the source before changing image references.'
      const plan = operation && node ? await planDesignEdit({ projectId: project.id, baseRevision: state.documentRevision, scope: node.owner, files: project.files, colors: project.colors, target: node.source, fingerprint: node.fingerprint, operation }) : { ok: true as const, projectId: project.id, baseRevision: state.documentRevision, changes: [] }
      if (!plan.ok) return plan.reason
      return useStudio.getState().commitTransaction(project, { ...plan, selection: undefined, assets: { before: project.assets, after: assets } }, studioChange('images'))
    } catch (e) { return e instanceof Error ? e.message : 'Could not update images.' } finally { editingRef.current = false }
  }, [project, stale, snapshot, planDesignEdit])

  const deleteScenario = useCallback((key: string) => {
    const state = useStudio.getState()
    if (!project || state.project !== project || !project.studio) return
    const error = commitStudioRecords(project, { ...project.studio, scenarios: project.studio.scenarios.filter(s => scenarioKey(s) !== key) }, 'state-delete')
    if (error) setEditNote(error); else setScenarioSelection(current => current?.projectId === project.id && current.key === key ? null : current)
  }, [project])

  /** An edit refused before it reaches the planner: said where the designer is looking, and logged (C7). */
  const refuseEdit = useCallback((operation: DesignEditRequest['operation'], reason: string, layer?: ViewLayer) => {
    setEditNote(reason)
    const model = result?.authoring
    const node = layer && model?.nodes.find(n => n.id === model.runtimeToSource[layer.id])
    if (project) eventLog.record(project.id, { ...designEvent(operation, node ?? undefined), refused: true })
  }, [project, result?.authoring])

  const applyEdit = useCallback(async (edit: DesignEditRequest['operation'], layer?: ViewLayer) => {
    const target = layer ?? selectedLayer
    const model = result?.authoring
    const node = model?.nodes.find(n => n.id === model.runtimeToSource[target?.id ?? ''])
    if (!node) { refuseEdit(edit, 'Select a supported source view to edit.'); return }
    await performDesignEdit(node.source, node.fingerprint, node.owner, edit)
  }, [selectedLayer, result?.authoring, performDesignEdit, refuseEdit])

  const changeProperty = useCallback(async (control: string, value: string) => {
    if (!authoringNode) return 'Select the view again.'
    return performDesignEdit(authoringNode.source, authoringNode.fingerprint, authoringNode.owner, { kind: 'property', control, value })
  }, [authoringNode, performDesignEdit])

  /** Where Add would put it, which the palette says before anything is added. */
  const addTarget = selectedLayer
    ? site?.container ? `Into ${authoringNode ? sourceLayerLabel(authoringNode) : selectedLayer.name}` : `After ${authoringNode ? sourceLayerLabel(authoringNode) : selectedLayer.name}`
    : 'Into this screen'

  /**
   * Add, from the palette or the keyboard.
   *
   * With nothing selected it targets the visible page's own content, so Add works on
   * a screen nobody has clicked into yet.
   */
  const addTargetLayer = useMemo(() => insertionLayer(pageHierarchy ?? layers, selectedLayer), [selectedLayer, pageHierarchy, layers])

  const canAdd = !!addTargetLayer?.source && !stale && !aiEditing

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
    if (useStudio.getState().aiEdit) { setEditNote(AI_EDITING); return }
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

  /** A copy or paste the studio refused: said, and logged as a refused edit is (C7). */
  const refuseClipboard = useCallback((op: 'copy' | 'paste', reason: string, target?: AuthoringNode) => {
    setEditNote(reason)
    if (project) eventLog.record(project.id, refusedClipboard(op, target))
  }, [project])

  /**
   * Copies the view at `source` as the Swift that draws it, for a paste anywhere, with
   * the values of its screen it reads, which a paste onto another screen brings (D6).
   */
  const copyAt = useCallback(async (source: SourceSpan | undefined, name: string, node?: AuthoringNode) => {
    const file = source && project ? findFile(project, source.file) : undefined
    if (!source || !file) return
    const copied = await copyView(file.text, source.file, source.start)
    if (!copied || 'refused' in copied) { refuseClipboard('copy', copied?.refused ?? 'This view could not be copied. Try again.', node); return }
    setClipboard(copied)
    setEditNote(`Copied ${name}`)
    // Best effort, and never waited on: a studio clipboard is what Paste reads, and
    // the system one is a courtesy for pasting into the editor or somewhere else.
    try { await navigator.clipboard.writeText(copied.snippet) } catch { /* not granted, or not secure */ }
  }, [copyView, project, refuseClipboard])
  const copySelection = useCallback(() => copyAt(selectedLayer?.source, selectedLayer?.name ?? '', authoringNode ?? undefined), [copyAt, selectedLayer, authoringNode])
  const copyLayer = useCallback((node: AuthoringNode) => void copyAt(node.source, sourceLayerLabel(node), node), [copyAt])

  /**
   * Pasting the same view a third time is worth a word, once.
   *
   * Counted by what was pasted rather than by where it landed, so three pastes into
   * three different screens still add up - that is exactly the case a component is
   * for. Dismissing it stops the hint for that shape.
   */
  const pasteCounts = useRef(new Map<string, number>())
  const [pasteNudge, setPasteNudge] = useState<string | null>(null)
  const dismissedNudges = useRef(new Set<string>())
  /** Pastes what was copied beside or into `target`, a layer in Layers, or else where Add would put a view. */
  const pasteClipboard = useCallback((target?: AuthoringNode) => {
    if (!clipboard) { refuseClipboard('paste', NOTHING_COPIED); return }
    const shape = clipboard.snippet.replace(/\s+/g, ' ').trim()
    const pastes = (pasteCounts.current.get(shape) ?? 0) + 1
    pasteCounts.current.set(shape, pastes)
    if (pastes >= 3 && !dismissedNudges.current.has(shape)) setPasteNudge(shape)
    const paste = { kind: 'paste' as const, snippet: clipboard.snippet, values: clipboard.values }
    if (target) void performDesignEdit(target.source, target.fingerprint, target.owner, paste)
    else void applyEdit(paste, addTargetLayer)
  }, [clipboard, applyEdit, addTargetLayer, performDesignEdit, refuseClipboard])

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
   * The keys, as `shortcutFor` reads them (D5): one table for both workspaces, by where the
   * focus is, so nothing pressed in a field reaches the view. A dialog or sheet that is
   * open has the keys to itself, and a key a control has already handled is its own.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || galleryOpen || switcherOpen || adding || shortcutsOpen || reviewOpen) return
      const shortcut = shortcutFor({ key: e.key, mod: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey }, { workspace: mode, editing: inspecting, focus: keyFocus(e.target), selected: !!selectedLayer })
      if (!shortcut) return
      // Escape is left for the canvas's own uses of it, such as cancelling a destination pick.
      if (shortcut !== 'escape') e.preventDefault()
      switch (shortcut) {
        case 'undo': undo(); break
        case 'redo': redo(); break
        case 'copy': void copySelection(); break
        case 'paste': pasteClipboard(); break
        case 'duplicate': void applyEdit({ kind: 'layer-duplicate' }); break
        case 'hide': void applyEdit({ kind: 'hide' }); break
        case 'delete': void applyEdit({ kind: 'delete' }); break
        case 'move-up': case 'move-down': void applyEdit({ kind: 'move', direction: shortcut === 'move-up' ? -1 : 1 }); break
        case 'add': if (canAdd) setAdding(true); break
        case 'select-tool': setTool('select'); break
        case 'escape':
          if (layout.layersOver) setLayersOver(false)
          else if (inspecting && tool === 'delete') setTool('select')
          else if (inspecting) setLayerSelection(null)
          break
        case 'all-screens': setAllPages(on => !on); break
        case 'save':
          // What was typed in a field goes in first, as leaving the field would put it.
          if (keyFocus(e.target) === 'text') (e.target as HTMLElement).blur()
          void flush().then(() => setEditNote(saveNote(storageProblem(useStudio.getState()))))
          break
        case 'restart-preview': run(); break
        case 'open-file': setSwitcherOpen(true); break
        case 'shortcuts': setShortcutsOpen(true); break
        case 'left-panel': toggleLeftPanel(); break
        case 'right-panel': togglePane('preview'); break
        case 'problems': togglePane('debug'); break
        case 'inspect': case 'preview': toggleInspect(); break
        case 'workspace': setMode(mode === 'design' ? 'develop' : 'design'); break
        case 'group': case 'hold': break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, inspecting, galleryOpen, switcherOpen, adding, shortcutsOpen, reviewOpen, applyEdit, selectedLayer, canAdd, tool, setTool,
      undo, redo, copySelection, pasteClipboard, flush, run, togglePane, toggleLeftPanel, toggleInspect, setMode, layout.layersOver])

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
  const reorderLayers = useCallback((layer: ViewLayer, target: ViewLayer, position: DropPosition) => {
    const from = layer.source
    const to = target.source
    if (!from || !to || from.file !== to.file) {
      refuseEdit({ kind: 'moveTo', targetOffset: to?.start ?? 0, position }, 'A view can only be moved within the file it is written in.', layer)
      return
    }
    void applyEdit({ kind: 'moveTo', targetOffset: to.start, position }, layer)
  }, [applyEdit, refuseEdit])

  /** The stack a canvas drop onto this node goes into - its own empty space, usually its background - or null. */
  const containerNameAt = useCallback((node: RenderNode) => {
    const layer = layerForRenderNode(layers, node)
    return layer && LAYER_MOVE_CONTAINERS.has(layer.type) ? layer.type : null
  }, [layers])

  /** A drop on the canvas, named in the terms the file understands. */
  const reorderNodes = useCallback((source: RenderNode | 'selection', target: RenderNode, position: DropPosition) => {
    const from = source === 'selection' ? selectedLayer : layerForRenderNode(layers, source)
    const to = layerForRenderNode(layers, target)
    if (!from) return
    if (!to || from.id === to.id) {
      refuseEdit({ kind: 'moveTo', targetOffset: to?.source?.start ?? 0, position }, to ? 'A view can’t be dropped onto itself.' : 'That spot isn’t a view to drop beside. Drop it on a layer instead.', from)
      return
    }
    reorderLayers(from, to, position)
  }, [layers, reorderLayers, selectedLayer, refuseEdit])

  /** The layer under the inspector's pointer, while Layers is there to show it. */
  const hoveredLayerId = useMemo(
    () => (inspecting && mode === 'design' && !stale && hoveredNode && (result?.renderTree?.nodes.some(node => node.id === hoveredNode.id && node.origin?.start === hoveredNode.origin?.start && node.origin?.end === hoveredNode.origin?.end && node.origin?.file === hoveredNode.origin?.file) || designPages?.some(page => page.tree.nodes.some(node => node.id === hoveredNode.id && node.origin?.start === hoveredNode.origin?.start && node.origin?.end === hoveredNode.origin?.end && node.origin?.file === hoveredNode.origin?.file))) ? layerForRenderNode(layers, hoveredNode)?.id ?? null : null),
    [inspecting, mode, stale, result?.renderTree, designPages, layers, hoveredNode],
  )

  const selectedSources = useMemo(() => hoveredSourceIds(result?.authoring, layers, selectedLayerId), [result?.authoring, layers, selectedLayerId])
  const hoveredSources = useMemo(() => hoveredSourceIds(result?.authoring, layers, hoveredLayerId), [result?.authoring, layers, hoveredLayerId])
  const liveHoveredAuthoring = useMemo(() => {
    if (!inspecting || mode !== 'design' || stale || !hoveredAuthoring || hoveredAuthoring.projectId !== project?.id) return null
    const previous = hoveredAuthoring.node
    const node = result?.authoring?.nodes.find(node => node.id === previous.id && node.fingerprint === previous.fingerprint && node.source.file === previous.source.file && node.source.start === previous.source.start && node.source.end === previous.source.end)
    return node ? { ...hoveredAuthoring, node } : null
  }, [inspecting, mode, stale, hoveredAuthoring, project?.id, result?.authoring])
  const hoveredRenderIds = useMemo(() => {
    if (!liveHoveredAuthoring) return new Set<string>()
    const { node, runtimeId } = liveHoveredAuthoring
    const tree = designPage?.tree ?? result?.renderTree
    return runtimeId ? layerRenderIds(findLayer(pageHierarchy ?? layers, runtimeId), tree, pageHierarchy ?? layers)
      : authoringRenderIds(node, result?.authoring, pageHierarchy ?? layers, tree)
  }, [liveHoveredAuthoring, designPage?.tree, result?.renderTree, result?.authoring, pageHierarchy, layers])

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
    (node: RenderNode, pageId?: string) => {
      if (pageId && project) setDesignPageSelection({ projectId: project.id, id: pageId })
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
   * behind them exists. Every step of an export has a deadline, so it always ends
   * and the button always comes back.
   */
  const handleExport = useCallback(
    (format: ArchiveFormat) => {
      if (!project || exportInProgress.current) return
      exportInProgress.current = true; setExporting(true); setEditNote(null)
      void (async () => {
        const [{ exportNote, exportProject }, { browserExportSteps }] = await Promise.all([import('../lib/exportProject'), import('../lib/browserExport')])
        setEditNote(exportNote(format, await exportProject(project, format, previewSettings, browserExportSteps(flush))))
      })().catch(error => setEditNote(error instanceof Error ? error.message : 'Could not export this project.')).finally(() => { exportInProgress.current = false; setExporting(false) })
    },
    [project, flush, previewSettings],
  )

  // Nothing of the studio is left to use in a tab without it: what it holds is out of
  // date, and the sheets behind an overlay could still be reached from the keyboard.
  if (tab === 'elsewhere') return <OpenElsewhere />
  if (!loaded || !project) {
    return (
      <main className="grid h-dvh place-items-center bg-xc-editor text-[12px] text-xc-text-3">
        Loading project…
      </main>
    )
  }
  crashIfTesting('app', project.id)

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
            {noteText ? <span className={styles.note} role="status" data-testid="edit-note">{noteText}</span> : null}
            {selection && mode === 'design' ? (
              <div className={styles.selection} data-testid="selection-controls">
                <span className={styles.selectionName}>{selection.name}</span>
                <span className={styles.selectionKind}>{selection.type}</span>
                <button type="button" data-testid="move-up" disabled={!selection.canMoveUp} title="Move up (⌥↑)" aria-label="Move up" onClick={() => void applyEdit({ kind: 'move', direction: -1 })}><Icon name="chevron-up-down" size={13} /><span>Up</span></button>
                <button type="button" data-testid="move-down" disabled={!selection.canMoveDown} title="Move down (⌥↓)" aria-label="Move down" onClick={() => void applyEdit({ kind: 'move', direction: 1 })}><Icon name="chevron-up-down" size={13} /><span>Down</span></button>
                <button type="button" data-testid="hide-selection" title={`Hide (${SHORTCUT_KEYS.hide})`} aria-label="Hide" onClick={() => void applyEdit({ kind: 'hide' })}><Icon name="eye" size={13} /></button>
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

  const screenViews = screens.map(screen => screen.view)
  const authoringFeatures: Omit<FeatureProps, 'node'> = { variants: project.studio?.variants, previewInputs: scenario?.inputs, screens: screenViews,
                pasteNudge: !!pasteNudge, onDismissNudge: () => { if (pasteNudge) dismissedNudges.current.add(pasteNudge); setPasteNudge(null) },
                onFindCopies: (node: AuthoringNode) => findCopies(project.files, node.source, { deploymentTarget: project.manifest.deploymentTarget, screens: screenViews }), onSaveVariant: variant => {
                  const state = useStudio.getState(), before = project.studio, metadata = before ?? emptyStudioMetadata()
                  if (state.project !== project || stale || preparingEdit) return 'Wait for the current design to finish updating.'
                  return commitStudioRecords(project, { ...metadata, variants: [...(metadata.variants ?? []).filter(v => v.owner !== variant.owner || v.name !== variant.name), variant] }, 'variant-save')
                }, onDeleteVariant: (owner, name) => {
                  const state = useStudio.getState(), before = project.studio
                  if (state.project !== project || !before || stale || preparingEdit) return 'Wait for the current design to finish updating.'
                  return commitStudioRecords(project, { ...before, variants: before.variants?.filter(v => v.owner !== owner || v.name !== name) }, 'variant-delete')
                }, onPickNavigation: navigationPicker.start, assets: project.assets, snapshot: result?.authoring, onSelect: selectAuthoring, onPreview: saveScenario, descriptions: project.studio?.components, onDescribe: description => {
                  const state = useStudio.getState(), before = project.studio, metadata = before ?? emptyStudioMetadata()
                  if (state.project !== project || stale) return 'Wait for the current source to compile.'
                  return commitStudioRecords(project, { ...metadata, components: [...metadata.components.filter(c => c.owner !== description.owner), description] }, 'component-describe')
                }, onNodeCommand: (node, operation) => performDesignEdit(node.source, node.fingerprint, node.owner, operation), onNodeChange: (node, control, value) => performDesignEdit(node.source, node.fingerprint, node.owner, { kind: 'property', control, value }), onCommand: operation => authoringNode ? performDesignEdit(authoringNode.source, authoringNode.fingerprint, authoringNode.owner, operation) : Promise.resolve('Select a source layer first.') }
  /** Editing waits for the edit being prepared, and for an AI edit holding the project. */
  const editingPaused = preparingEdit || aiEditing
  const busy = stale || editingPaused
  const revealSpan = (span: SourceSpan) => revealSpanIn(span.file, span.start)
  /**
   * What each panel is drawn from. A panel that crashed tries again when one of these
   * changes. Panels drawn from the compiler key on the compile's revision: it changes
   * once the Undo or edit has been compiled, which is when a retry can succeed, and
   * not for each text measurement that refines the same compile.
   */
  const drawnFrom = { navigator: [result?.revision, mode], settings: [result?.revision, mode, level, authoringNode?.id], editor: [project, activeFileId, mode], preview: [result?.revision, mode] }
  /** The right-hand panel shows the App, the focused screen, or the selected view. */
  const settingsPanel = <PaneBoundary area="settings" resetKeys={drawnFrom.settings}>{level === 'app'
    ? <AppSettings project={project} tree={tree} snapshot={result?.authoring} screenViews={screens.map(screen => screen.view)} busy={busy} onRenameApp={useStudio.getState().renameProject} onResource={resourceCommand} onAssets={updateAssets} onSelect={selectAuthoring}
        navigation={<AppNavigationSettings navigation={result?.authoring?.navigation} screens={screens} busy={busy} onCommand={navigationCommand} onReveal={revealSpan} />} />
    : level === 'screen'
      ? focusedScreen
        ? <ScreenSettings key={focusedScreen.id} screen={focusedScreen} tree={tree} snapshot={result?.authoring} tokens={result?.authoring?.styles ?? NO_FILES} busy={busy} scenarios={project.studio?.scenarios ?? NO_FILES} activeScenario={scenario ? scenarioKey(scenario) : ''}
            onSelectScenario={key => setScenarioSelection(key ? { projectId: project.id, key } : null)} onSaveScenario={saveScenario} onDeleteScenario={deleteScenario} onCreateStateValue={createStateValue} onScreenCommand={updateScreens}
            onNodeChange={(node, control, value) => performDesignEdit(node.source, node.fingerprint, node.owner, { kind: 'property', control, value }, undefined, undefined, undefined, true)}
            onNodeCommand={(node, operation) => performDesignEdit(node.source, node.fingerprint, node.owner, operation, undefined, undefined, undefined, true)} onSelect={selectAuthoring} onReveal={revealSpan} />
        : <p className="text-[12px] text-xc-text-3" role={busy ? 'status' : undefined}>{busy ? 'Drawing screens…' : 'Select a screen, a view, or the App.'}</p>
      : <AuthoringInspector key={project.id} features={authoringFeatures} onChange={changeProperty} node={authoringNode} stale={busy} onReveal={revealSpan} onCopy={copyLayer} onPaste={clipboard ? pasteClipboard : undefined} />}</PaneBoundary>
  const settingsTitle = <nav className={styles.levelPath} aria-label="Settings level" data-level={level}>
    <button type="button" aria-current={level === 'app' ? 'page' : undefined} onClick={selectApp} data-testid="level-app">App</button>
    {level !== 'app' && focusedScreen && <><span aria-hidden>›</span><button type="button" aria-current={level === 'screen' ? 'page' : undefined} onClick={() => openPage(focusedScreen.page)} data-testid="level-screen">{focusedScreen.name}</button></>}
    {level === 'view' && authoringNode && <><span aria-hidden>›</span><span aria-current="page" data-testid="level-view">{sourceLayerLabel(authoringNode)}</span></>}
  </nav>

  const showLeftPanel = <button type="button" className={styles.panelToggle} data-testid="pane-toggle-navigator" aria-pressed="false" aria-label="Show left panel" title="Show left panel" onClick={toggleLeftPanel}><Icon name="sidebar-left" size={16} /></button>
  /** Design's preview environment, in the toolbar or the canvas heading as the window allows (D15). */
  const environment = environmentPlacement(available)
  const picker = (which: EnvironmentPicker) => which === 'device' ? <DevicePicker key={which} device={device} onChange={unlessAiEditing(setDevice, undefined)} />
    : which === 'appearance' ? <AppearancePicker key={which} preview={previewSettings} onChange={setPreview} />
    : <TextSizePicker key={which} preview={previewSettings} onChange={setPreview} />

  const previewTools = <PreviewTools inspecting={inspecting} onSetInspecting={setDesigning} showEditActions={mode === 'design'} showModeSwitch={mode !== 'design'} tool={tool} onSetTool={setTool} onAdd={() => setAdding(true)} canAdd={canAdd && !preparingEdit} mode={mode} busy={stale || preparingEdit} errors={errors} warnings={warnings} workerError={workerError} onUndo={undo} onRedo={redo} onReset={run} canUndo={canUndo && !aiEditing} canRedo={canRedo && !aiEditing} note={noteText} noteAction={noteLocation ? { label: 'Show in Code', onClick: () => revealSpanIn(noteLocation.file, noteLocation.offset) } : null} />
  const previewStatus = <PreviewStatus inspecting={inspecting} tool={tool} mode={mode} busy={stale || preparingEdit} errors={errors} warnings={warnings} workerError={workerError} />

  return (
    <main data-testid="workspace" data-mode={mode} className="flex h-dvh flex-col overflow-hidden bg-xc-editor text-xc-text">
      <div className="flex min-h-0 flex-1 flex-col" inert={galleryOpen || switcherOpen || adding || shortcutsOpen || reviewOpen}>
      <Toolbar
        mode={mode}
        onModeChange={setMode}
        theme={theme}
        onThemeChange={setTheme}
        onOpenGallery={openGallery}
        onRenameProject={useStudio.getState().renameProject}
        renameDisabled={aiEditing}
        onShortcuts={() => setShortcutsOpen(true)}
        onCopyBuild={() => {
          void navigator.clipboard.writeText(BUILD_DETAILS).then(() => setEditNote(`${BUILD_NAME} copied.`), () => setEditNote(BUILD_DETAILS))
        }}
        onReview={() => { setDesigning(true); setReviewOpen(true) }}
        reviewDisabled={stale || preparingEdit || !result?.renderTree}
        projectName={project.manifest.name}
        savedAt={lastSavedAt}
        storage={storage}
        // The toggles report the preference, so each is a switch that always
        // responds; `suppressed` is how a pane that is on but has no room says so.
        panes={new Set((Object.keys(shown) as PaneKey[]).filter((key) => shown[key]))}
        suppressed={
          new Set<PaneKey>(shown.preview && !layout.showPreview ? (['preview'] as const) : [])
        }
        onTogglePane={togglePane}
        onExport={handleExport}
        exporting={exporting}
        onShare={handleShare}
        environment={environment.toolbar.length ? <>{environment.toolbar.map(picker)}</> : undefined}
        previewing={!inspecting}
        onSetPreviewing={previewing => setDesigning(!previewing)}
        previewDisabled={stale || preparingEdit}
      />
      <StorageBanner problem={storage} onRetry={() => void flush()} />
      <AiEditBanner />
      {available < COMFORTABLE_WIDTH && !narrowNoted && <p className={styles.narrowNote} role="note" data-testid="narrow-window">
        <span>This window is narrow. The studio works best at {COMFORTABLE_WIDTH.toLocaleString('en-US')} px wide or more.</span>
        <button type="button" onClick={() => setNarrowNoted(true)}>Dismiss</button>
      </p>}

      <div ref={splitRef} className="relative flex min-h-0 flex-1">
        {/* A narrow window keeps its rail, under Layers drawn over the canvas too, so the canvas does not move. */}
        {layout.narrow && <div className={styles.panelRail}>{!layout.layersOver && showLeftPanel}</div>}
        {layout.showNavigator || layout.narrow ? (
          <>
            {layout.layersOver && <button type="button" className={styles.layersBackdrop} aria-label="Close Layers" tabIndex={-1} onClick={() => setLayersOver(false)} />}
            {/* Kept, hidden, while a narrow window closes it: an unsent prompt and the open tab are still there. */}
            <div style={{ width: layout.narrow ? navigatorWidth : layout.nav }} className={layout.narrow ? styles.layersOver : 'shrink-0 overflow-hidden'} hidden={layout.narrow && !layout.layersOver} data-testid={layout.layersOver ? 'layers-over' : undefined}>
              <PaneBoundary area="navigator" resetKeys={drawnFrom.navigator}>
              <StudioSidebar key={project.id} design={mode === 'design'} stale={stale || preparingEdit} onCollapse={toggleLeftPanel} onApplied={() => { setCommittedEditRevision(value => value + 1); setEditNote('Prompt edits applied. Use Undo to reverse them.') }} selection={authoringNode && !stale ? { label: sourceLayerLabel(authoringNode), file: authoringNode.source.file, start: authoringNode.source.start, end: authoringNode.source.end, owner: authoringNode.owner } : null}>
              {mode === 'design' ? <DesignNavigator
                tabbed
                key={project.id}
                appName={project.manifest.name}
                tree={tree}
                layout={navigatorLayout}
                onLayoutChange={setNavigatorLayout}
                level={level}
                selectedScreenId={focusedScreen?.id}
                selectedComponent={authoringNode?.kind === 'definition' ? authoringNode.name : undefined}
                busy={busy}
                diagnostics={allDiagnostics}
                onReveal={revealSpanIn}
                onTogglePanel={toggleLeftPanel}
                onSelectApp={selectApp}
                onSelectScreen={openPage}
                onSelectComponent={component => { if (component.definition) selectAuthoring(component.definition); else setEditNote(`${component.name} is built in Swift the studio does not read. Open it in Code.`) }}
                onInsertComponent={component => authoringNode ? performDesignEdit(authoringNode.source, authoringNode.fingerprint, authoringNode.owner, { kind: 'component-insert', component: component.name }) : Promise.resolve('Select a layer where the copy should go.')}
                onScreenCommand={updateScreens}
                renderLayers={options => result?.authoring ? <LogicalLayers key={`${focusedPage?.id}:${pageFocusEpoch}`} {...options}
                  labels={project.studio?.labels} onRename={renameLayer} pageId={focusedPage?.id} pageName={focusedPage?.name} pageSource={focusedPage?.source} runtimeLayers={pageHierarchy}
                  selectedRuntimeId={selectedLayerId} hoveredRuntimeId={hoveredLayerId} snapshot={result.authoring} files={project.files} selection={layerSelection?.anchor}
                  selected={authoringNode?.id} selectedAncestors={selectedSources} hovered={liveHoveredAuthoring?.node.id ?? hoveredSources[0]} hoveredAncestors={hoveredSources.slice(1)}
                  onHover={hoverAuthoring} stale={busy} onSelect={selectAuthoring} onEdit={(node, operation) => performDesignEdit(node.source, node.fingerprint, node.owner, operation)}
                  onCopy={copyLayer} onPaste={clipboard ? pasteClipboard : undefined}
                  hidden={hidden.views} onShow={showHidden} editable={inspecting} /> : <p className="px-4 py-2 text-[12px] text-xc-text-3">Building the view hierarchy…</p>}
              /> : <Navigator tabbed
                key={project.id}
                layerLabels={project.studio?.labels}
                onRenameLayer={renameLayer}
                pageFocusEpoch={pageFocusEpoch}
                pageId={focusedPage?.id}
                pageName={focusedPage?.name}
                pageSource={focusedPage?.source}
                pageLayers={pageHierarchy}
                authoring={result?.authoring}
                authoringFiles={project.files}
                authoringSelection={layerSelection?.anchor}
                selectedAuthoringId={authoringNode?.id}
                selectedAuthoringAncestors={selectedSources}
                hoveredAuthoringId={liveHoveredAuthoring?.node.id ?? hoveredSources[0]}
                hoveredAuthoringAncestors={hoveredSources.slice(1)}
                onHoverAuthoring={hoverAuthoring}
                onEditAuthoring={(node, operation) => performDesignEdit(node.source, node.fingerprint, node.owner, operation)}
                onSelectAuthoring={selectAuthoring}
                layers={layers}
                selectedLayerId={selectedLayerId}
                hoveredLayerId={hoveredLayerId}
                hiddenViews={NO_FILES}
                onHideLayer={(layer) => void applyEdit({ kind: 'hide' }, layer)}
                onShowHidden={showHidden}
                layersEditable={false}
                stale={busy}
                onSelectLayer={selectLayer}
                tree={fileTree}
                activeFileId={activeFileId}
                filesWithErrors={filesWithErrors}
                diagnostics={allDiagnostics}
                canDelete={files.length > 1}
                onSelect={openSource}
                onCreateFile={unlessAiEditing((name: string, parent?: string) => { setMode('develop'); return createFile(name, parent) }, null)}
                onCreateFolder={unlessAiEditing(createFolder, null)}
                onTogglePanel={toggleLeftPanel}
                onRenameFile={unlessAiEditing(renameFile, true)}
                onRenameFolder={unlessAiEditing(renameFolder, undefined)}
                onDeleteFile={unlessAiEditing(deleteFile, undefined)}
                onDeleteFolder={unlessAiEditing(deleteFolder, undefined)}
                onDuplicateFile={unlessAiEditing(duplicateFile, undefined)}
                onMoveFile={unlessAiEditing(moveFile, undefined)}
                onRevealDiagnostic={revealSpanIn}
                onOpenTemplates={() => openGallery('design')}
              />}
              </StudioSidebar>
              </PaneBoundary>
            </div>
            {!layout.narrow && <Splitter
              orientation="col"
              size={layout.nav}
              onResize={(size) => setSize('navigator', size)}
              min={PANE_LIMITS.navigator.min}
              max={PANE_LIMITS.navigator.max}
              direction={1}
              label="Navigator width"
              onToggle={() => togglePane('navigator')}
            />}
          </>
        ) : <div className={styles.panelRail}>{showLeftPanel}</div>}

        <div className="flex min-w-0 flex-1 flex-col" style={mode === 'design' ? { display: 'none' } : undefined}>
          <TabBar
            key={project.id}
            onRenameFile={unlessAiEditing(renameFile, true)}
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
            <PaneBoundary area="editor" resetKeys={drawnFrom.editor}>
            {activeFile ? (
              <EditorPane
                // Remount editor selection per file; undo belongs to the project timeline.
                key={`${project.id}:${activeFile.id}`}
                text={activeFile.text}
                diagnostics={diagnostics}
                onChange={handleChange}
                onUndo={undo}
                onRedo={redo}
                readOnly={aiEditing}
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
            </PaneBoundary>
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
              <PaneBoundary area="preview" resetKeys={drawnFrom.preview} keep={previewTools}>
              <DevicePane
                expanded={mode === 'design'}
                projectId={project.id}
                previewIdentity={previewIdentity}
                panelLayout={`${layout.showNavigator && !layout.layersOver}:${shown.preview}`}
                showSettings={shown.preview}
                settingsWidth={settingsWidth}
                onSettingsResize={(size) => setSize('settings', size)}
                onToggleSettings={() => togglePane('preview')}
                onHoverNode={pickingNavigation ? undefined : hoverPreview}
                pages={designPages}
                canvas={canvas}
                selectedPageId={designPage?.id}
                pageCount={pageCount}
                pagesNotDrawn={designPages ? result?.pagesNotDrawn : undefined}
                onSelectPage={openPage}
                allPages={allPages || pickingNavigation}
                navigationPicker={navigationPageTargets ? {
                  targets: navigationPageTargets,
                  onPick: page => {
                    const destination = navigationPageTargets[page.id]?.destination
                    if (destination) navigationPicker.finish(destination.expression)
                  },
                  onCancel: () => navigationPicker.finish(null),
                } : undefined}
                onToggleAllPages={setAllPages}
                belowCanvas={mode === 'design' ? debugArea : null}
                tool={tool}
                selection={selection}
                authoringFeatures={authoringFeatures}
                settingsPanel={settingsPanel}
                settingsTitle={settingsTitle}
                onSelectBackground={mode === 'design' ? selectApp : undefined}
                onReorderNodes={reorderNodes}
                containerNameAt={containerNameAt}
                centerOn={centerOn}
                status={previewStatus}
                onDeviceChange={unlessAiEditing(setDevice, undefined)}
                environment={mode === 'design' && environment.heading.length ? <>{environment.heading.map(picker)}</> : undefined}
                tools={previewTools}
                device={device}
                tree={phone.tree}
                notice={phone.notice}
                onRestart={phone.stopped ? run : undefined}
                revision={result?.revision}
                selectedRenderIds={selectedRenderIds}
                hoveredRenderIds={hoveredRenderIds}
                stale={stale || preparingEdit || phone.dimmed}
                onEvent={dispatch}
                inspecting={inspecting}
                onRevealSource={inspectSelect}
                preview={previewSettings}
                onPreviewChange={(settings: Partial<PreviewSettings>) => setPreview(settings)}
              />
              </PaneBoundary>
              </div>
            </div>
          </>
        ) : <div className={styles.panelRail}><button type="button" className={styles.panelToggle} data-testid="pane-toggle-preview" aria-pressed="false" aria-label="Show preview" title="Show preview" onClick={() => togglePane('preview')}><Icon name="sidebar-right" size={16} /></button></div>}
      </div>
      {!layout.showPreview && <div className={styles.codeFooter}>{previewTools}</div>}

      </div>
      {reviewOpen && <DesignReview key={project.id} name={project.manifest.name} pages={designPages ?? []} selectedPageId={designPage?.id} options={{ projectId: project.id, files: project.files, images, colors: project.colors, scenario, designScreens: project.studio?.screens, componentDescriptions: project.studio?.components, deploymentTarget: project.manifest.deploymentTarget, previewTarget: project.manifest.previewTarget }} onClose={() => setReviewOpen(false)} onInspect={source => {
        setReviewOpen(false)
        const node = result?.authoring?.nodes.filter(n => n.kind !== 'definition' && n.source.file === source.file && n.source.start <= source.start && n.source.end >= source.end).sort((a, b) => (a.source.end - a.source.start) - (b.source.end - b.source.start))[0]
        if (node) selectAuthoring(node)
      }} />}
      {shortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
      {/* Failures outside any panel. Outside the inert workspace, so it stays usable
          while a sheet is open. */}
      <ErrorBanner />
      {adding ? (
        <AddView
          target={addTarget}
          assets={project.assets ?? []}
          onImage={async (name, asset) => {
            const model = result?.authoring
            const target = addTargetLayer ?? selectedLayer
            const node = model?.nodes.find(item => item.id === model.runtimeToSource[target?.id ?? ''])
            if (!node) return 'Select a view or stack on the canvas first.'
            if (!asset && !project.assets?.some(item => item.name === name)) return 'This image is no longer in the project.'
            return performDesignEdit(node.source, node.fingerprint, node.owner, { kind: 'insert', snippet: imageViewSnippet(name) }, undefined, undefined, asset ? [...(project.assets ?? []), asset] : undefined)
          }}
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
          onImport={async (expected, incoming, removedNames, removedColors) => { const referenceProblem = await validateResourceRemoval(incoming.files, removedNames, removedColors); if (referenceProblem) return referenceProblem; const problem = await useStudio.getState().importProject(expected, incoming); if (!problem) setGalleryOpen(false); return problem }}
          projectId={project.id}
          projectName={project.manifest.name}
          fileCount={files.length}
          recents={recents}
          pristine={isPristine(project)}
          origin={origin}
          savedAt={lastSavedAt}
          atLaunch={galleryAtLaunch}
          initialSource={gallerySource}
          onClose={() => setGalleryOpen(false)}
          onChoose={async (templateId, options) => {
            const made = await applyTemplate(templateId, options)
            // Kept open otherwise: the sheet is where the message goes, and closing it
            // would leave somebody looking at a project they did not ask for.
            if (made === 'opened') { setGalleryOpen(false); setMode('design'); setDesigning(true) }
            return made
          }}
          onOpenProject={openProject}
          onRemoveProject={(id) => void removeProject(id)}
          onOpenFiles={async (picked, { history, ...options } = {}) => {
            const result = await openFiles(picked, options)
            const opened = result === 'opened'
            if (opened && history?.length) {
              const current = useStudio.getState()
              if (current.project) current.appendPromptMessages(current.project.id, history)
              await flush()
            }
            if (opened) setGalleryOpen(false)
            return result
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
