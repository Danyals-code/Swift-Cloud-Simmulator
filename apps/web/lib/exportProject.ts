import { exportArchive, type ExportReview, type ScreenSnapshot } from '@studio/exporter'
import type { Project } from '@studio/project-model'
import { getDevice } from '@studio/sim-shell'
import { viewsDrawing, type ArchiveFormat, type CompileResult, type PagePreview } from '@studio/shared'
import { STUDIO_BUILD } from './build'
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
  /** Hands the archive to the browser's downloads. */
  download(name: string, bytes: Uint8Array): void
}

export interface ExportOutcome {
  /** What the download is called. */
  readonly name: string
  /** How many screen images the complete bundle has. */
  readonly screenImages: number
  /** What the archive leaves out, as its report says. */
  readonly issues: readonly string[]
}

/** How long each step may take before the export goes on without it. */
const SAVE_MS = 2_500
const COMPILE_MS = 40_000
const CAPTURE_MS = 10_000
/** How long all the screens together may take. */
const CAPTURE_ALL_MS = 90_000

/**
 * Exports the project in `format`, and always downloads something.
 *
 * An export is the result of somebody's work, so nothing refuses it: a preview with
 * errors, a screen that can't be drawn, a step that never answers. What could not be
 * done is said in the archive's report instead, and every step has a deadline, so the
 * Export button always comes back.
 */
export async function exportProject(project: Project, format: ArchiveFormat, preview: CaptureSettings, steps: ExportSteps): Promise<ExportOutcome> {
  // The archive is made from the project on screen, so a slow save only delays it.
  await within(() => steps.save(), SAVE_MS).catch(() => undefined)
  const review = format === 'complete' ? await captureScreens(project, preview, steps) : undefined
  const archive = exportArchive(project, { format, review, build: STUDIO_BUILD, now: new Date() })
  steps.download(archive.name, archive.bytes)
  return { name: archive.name, screenImages: review?.screens.length ?? 0, issues: archive.issues }
}

/** What the studio says once the archive is in the downloads. */
export function exportNote(format: ArchiveFormat, { name, screenImages, issues }: ExportOutcome): string {
  const images = format === 'complete' ? ` with ${screenImages} screen image${screenImages === 1 ? '' : 's'}` : ''
  if (issues.length) return `Exported ${name}${images}. Not everything could be included; the archive lists what is missing.`
  return format === 'complete' ? `Exported ${name}${images}, the report and the chat history.` : `Exported ${name}.`
}

/** Every screen of the app drawn, and what kept any of them out. */
async function captureScreens(project: Project, preview: CaptureSettings, steps: ExportSteps): Promise<ExportReview> {
  const issues: string[] = [], screens: ScreenSnapshot[] = []
  const review = { device: getDevice(project.manifest.device).name, colorScheme: preview.colorScheme, dynamicTypeSize: preview.dynamicTypeSize ?? 'large', typeScale: preview.typeScale, screens, issues }
  let result: CompileResult
  try { result = await within(signal => steps.compile(project, preview, signal), COMPILE_MS) }
  catch (error) { issues.push(`The preview could not be drawn, so no screen is in this export: ${reason(error)}`); return { ...review, diagnostics: [] } }

  const diagnostics = [...result.diagnostics.map(item => `${item.severity}: ${item.message}`), ...result.logs.filter(item => item.level !== 'log').map(item => `${item.level}: ${item.message}`)]
  const pages = drawnPages(project, result)
  const errors = result.diagnostics.filter(item => item.severity === 'error')
  if (!pages.length) {
    const problem = errors[0]?.message ?? result.renderTree?.notice?.detail
    if (problem) issues.push(`The preview has ${errors.length || 1} error${errors.length > 1 ? 's' : ''}, so no screen could be drawn: ${problem}`)
    return { ...review, diagnostics }
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
  return { ...review, diagnostics }
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
