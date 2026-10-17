import { exportArchive, libraryAsset, type ExportReview, type ScreenSnapshot } from '@studio/exporter'
import { LIBRARY_IMAGES, libraryImageURL, type Project } from '@studio/project-model'
import { Lexer } from '@studio/swift-syntax/lexer'
import { getDevice } from '@studio/sim-shell'
import { viewsDrawing, type AppAccent, type ArchiveFormat, type CompileResult, type PagePreview } from '@studio/shared'
import { STUDIO_BUILD } from './build'
import { shadowedLibraryNames } from './library'
import type { LogFile } from './eventLog'
import { screenNaming } from './designTree'
import { screenCatalog } from './screens'
import type { PreviewSettings } from './store'

/** The preview settings a complete bundle's screens are drawn with. */
export type CaptureSettings = Pick<PreviewSettings, 'colorScheme' | 'dynamicTypeSize' | 'typeScale'>

/** What exporting needs a browser for. The rest is here, and runs anywhere. */
export interface ExportSteps {
  /** Writes the edits autosave has not written yet. */
  save(): Promise<unknown>
  /** The project compiled with every page drawn, as `settings` show it: the complete bundle's screens. */
  compile(project: Project, settings: CaptureSettings, signal: AbortSignal): Promise<CompileResult>
  /** A page drawn as a PNG at twice its size. */
  capture(page: PagePreview, signal: AbortSignal): Promise<Uint8Array>
  /** The project's event log, with this export in it. */
  events(projectId: string, format: ArchiveFormat): Promise<LogFile>
  /** Hands the archive to the browser's downloads. */
  download(name: string, bytes: Uint8Array): void
  /** A library image's served bytes. The page's own fetch when left out. */
  library?(name: string): Promise<Uint8Array>
}

export interface ExportOutcome {
  /** What the download is called. */
  readonly name: string
  /** How many screen images the complete bundle has. */
  readonly screenImages: number
  /** What the archive leaves out that the designer should hear of. The report can list more. */
  readonly issues: readonly string[]
}

/** How long each step may take before the export goes on without it. */
const SAVE_MS = 2_500
const EVENTS_MS = 5_000
const COMPILE_MS = 40_000
const CAPTURE_MS = 10_000
const LIBRARY_MS = 30_000
/**
 * What the report says when the event log is missing, or holds only the exporting
 * session's events. The complete bundle's report is the only place that says so: the
 * log is for the study, not for the designer.
 */
const NO_LOG = 'The studio’s event log could not be read, so events.jsonl is not in this export.'
const PARTIAL_LOG = 'The studio’s event log could not be read in full, so events.jsonl holds only the events of the session that exported it.'

/** How long all the screens together may take. */
const CAPTURE_ALL_MS = 90_000

/**
 * Exports the project in `format`, and always downloads something.
 *
 * An export is the result of somebody's work, so nothing refuses it: a preview with
 * errors, a screen that can't be drawn, a step that never answers. What could not be
 * done is said in the archive's report instead, and every step has a deadline, so the
 * Export button always comes back. `accent` is the tint written at the app's root, which
 * goes into AccentColor; the complete bundle takes it from its own compile, of exactly
 * the project it exports.
 */
export async function exportProject(project: Project, format: ArchiveFormat, preview: CaptureSettings, steps: ExportSteps, accent?: AppAccent): Promise<ExportOutcome> {
  // The archive is made from the project on screen, so a slow save only delays it.
  await within(() => steps.save(), SAVE_MS).catch(() => undefined)
  const log = await within(() => steps.events(project.id, format), EVENTS_MS).catch(() => undefined)
  const capture = format === 'complete' ? await captureScreens(project, preview, steps) : undefined
  const captured = capture?.review
  const unlogged = !log ? NO_LOG : log.partial ? PARTIAL_LOG : null
  const review = captured && unlogged ? { ...captured, issues: [...captured.issues ?? [], unlogged] } : captured
  const tint = capture ? capture.accent : accent
  const exported = await withLibraryImages(project, steps.library ?? fetchLibraryImage)
  const archive = exportArchive(exported, { format, review, build: STUDIO_BUILD, events: log?.text, now: new Date(), ...(tint ? { accent: tint } : {}) })
  steps.download(archive.name, archive.bytes)
  return { name: archive.name, screenImages: review?.screens.length ?? 0, issues: archive.issues.filter(issue => issue !== unlogged) }
}

/**
 * Every library image name the Swift writes as a whole string literal, in the library's order,
 * leaving out those the project's own images shadow (Wave 7b, `shadowedLibraryNames`), so the
 * asset catalog never holds two images whose names differ only in case.
 *
 * Literals rather than `Image("…")` calls, since an app keeps image names in its model data
 * too (`Trail(photo: "snowy-peak")`). Read with the lexer, so a name in a comment is not one;
 * a name built at runtime, `"photo-\(i)"`, can't be found, and the guidance asks for literals.
 */
export function usedLibraryNames(project: Project): string[] {
  const used = new Set<string>()
  const scan = (text: string) => {
    for (const token of Lexer.tokenize(text, 'library').tokens) {
      const segments = token.kind === 'stringLiteral' ? token.segments ?? [] : []
      if (segments.length && segments.every(segment => segment.kind === 'text')) used.add(segments.map(segment => segment.value).join(''))
      for (const segment of segments) if (segment.kind === 'interpolation') scan(segment.value)
    }
  }
  for (const file of project.files) scan(file.text)
  const shadowed = shadowedLibraryNames(project.assets ?? [])
  return LIBRARY_IMAGES.filter(image => used.has(image.name) && !shadowed.has(image.name)).map(image => image.name)
}

/**
 * An export-only copy of the project with the library images its code uses, or the project
 * itself when it uses none, so such an export is byte for byte what it was. An image that can't
 * be downloaded stops the export: an app missing an image it draws is not one to hand over.
 */
async function withLibraryImages(project: Project, download: (name: string) => Promise<Uint8Array>): Promise<Project> {
  const names = usedLibraryNames(project)
  if (!names.length) return project
  const images = await Promise.all(names.map(name => within(() => download(name), LIBRARY_MS).then(bytes => libraryAsset(name, bytes), () => {
    throw new Error(`Couldn’t download the library image “${name}”. Check your connection and export again.`)
  })))
  return { ...project, assets: [...project.assets ?? [], ...images] }
}

/** A library image as the page serves it. */
async function fetchLibraryImage(name: string): Promise<Uint8Array> {
  const response = await fetch(libraryImageURL(name))
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** What the studio says once the archive is in the downloads. */
export function exportNote(format: ArchiveFormat, { name, screenImages, issues }: ExportOutcome): string {
  const images = format === 'complete' ? ` with ${screenImages} screen image${screenImages === 1 ? '' : 's'}` : ''
  if (issues.length) return `Exported ${name}${images}. Not everything could be included; the archive lists what is missing.`
  return format === 'complete' ? `Exported ${name}${images}, the report and the chat history.` : `Exported ${name}.`
}

/** Every screen of the app drawn, and what kept any of them out, with the accent the same compile found. */
async function captureScreens(project: Project, preview: CaptureSettings, steps: ExportSteps): Promise<{ readonly review: ExportReview; readonly accent?: AppAccent }> {
  const issues: string[] = [], screens: ScreenSnapshot[] = []
  const review = { device: getDevice(project.manifest.device).name, colorScheme: preview.colorScheme, dynamicTypeSize: preview.dynamicTypeSize ?? 'large', typeScale: preview.typeScale, screens, issues }
  let result: CompileResult
  try { result = await within(signal => steps.compile(project, preview, signal), COMPILE_MS) }
  catch (error) { issues.push(`The preview could not be drawn, so no screen is in this export: ${reason(error)}`); return { review: { ...review, diagnostics: [] } } }

  const diagnostics = [...result.diagnostics.map(item => `${item.severity}: ${item.message}`), ...result.logs.filter(item => item.level !== 'log').map(item => `${item.level}: ${item.message}`)]
  const accent = result.authoring?.accent
  const done = () => ({ review: { ...review, diagnostics }, ...(accent ? { accent } : {}) })
  const pages = drawnPages(project, result)
  const errors = result.diagnostics.filter(item => item.severity === 'error')
  if (!pages.length) {
    const problem = errors[0]?.message ?? result.renderTree?.notice?.detail
    if (problem) issues.push(`The preview has ${errors.length || 1} error${errors.length > 1 ? 's' : ''}, so no screen could be drawn: ${problem}`)
    return done()
  }

  const { nameOf } = screenNaming(pages, result.authoring, screenCatalog(result.authoring, pages, project.studio?.screens))
  // A screen written inside another is drawn with it, not as a page of its own.
  for (const screen of project.studio?.screens ?? []) {
    if (!pages.some(page => page.id === `screen:${screen.view}` || viewsDrawing(page).some(view => view.name === screen.view))) issues.push(`${screen.name} is not in this export: nothing in the app draws it any more.`)
  }
  const started = Date.now()
  for (const [index, page] of pages.entries()) {
    if (Date.now() - started > CAPTURE_ALL_MS) { issues.push(`${pages.length - index} more screens were left out, because drawing them took too long.`); break }
    const name = nameOf(page)
    try { screens.push({ id: page.id, name, kind: page.kind ?? 'root', width: page.tree.canvas.width, height: page.tree.canvas.height, png: await within(signal => steps.capture(page, signal), CAPTURE_MS) }) }
    catch (error) { issues.push(`The image of ${name} could not be made: ${reason(error)}`) }
  }
  return done()
}

/** The pages a compile drew, leaving out one that only says why nothing could be. */
function drawnPages(project: Project, result: CompileResult): readonly PagePreview[] {
  const pages = result.pages?.length ? result.pages : result.renderTree ? [{ id: 'app', name: project.manifest.name, kind: 'root' as const, active: true, tree: result.renderTree }] : []
  return pages.filter(page => !page.tree.notice)
}

/** `run`'s answer, or a rejection once `ms` have passed, when its signal is aborted so it can stop. */
async function within<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('it took too long')) }, ms) })
  try { return await Promise.race([run(controller.signal), deadline]) }
  finally { clearTimeout(timer) }
}

function reason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'something went wrong'
}
