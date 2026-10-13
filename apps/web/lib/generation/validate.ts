import * as Comlink from 'comlink'
import { DEVICES } from '@studio/sim-shell'
import type { CompileResult, CompilerApi, SourceSpan } from '@studio/shared'
import type { GeneratedApp } from './schema'

/** One thing the preview reported, placed in a file and line where it has one. */
export interface PreviewIssue {
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly file?: string
  readonly line?: number
}

/**
 * Every screen of a draft, run in a disposable worker.
 *
 * A new worker instance shares the compiler bundle, never the active project's
 * state. All pages are drawn, so a sheet or a pushed screen that fails is reported
 * here rather than the first time someone opens it.
 */
export function checkPreview(app: GeneratedApp, signal: AbortSignal): Promise<PreviewIssue[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
    const worker = new Worker(new URL('../../workers/compiler.worker.ts', import.meta.url), { type: 'module' })
    const api = Comlink.wrap<CompilerApi>(worker)
    let settled = false
    const finish = (issues: PreviewIssue[]) => { if (settled) return; cleanup(); resolve(issues) }
    const notice = (message: string): PreviewIssue[] => [{ severity: 'warning', message }]
    const abort = () => { if (settled) return; cleanup(); reject(new DOMException('Cancelled', 'AbortError')) }
    const timer = setTimeout(() => finish(notice('Preview validation timed out. Review the code after opening.')), 15000)
    function cleanup() { settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); api[Comlink.releaseProxy](); worker.terminate() }
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => finish(notice('Preview validation is unavailable. Review the code after opening.'))
    const device = DEVICES['iphone-15']
    void api.compile({ files: app.files.map(f => ({ id: f.path, text: f.code })), canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: 1, allPages: true }).then(result => {
      finish(previewIssues(result, app.files))
    }).catch(() => finish(notice('The preview could not evaluate this project. Review its code after opening.')))
  })
}

/**
 * What the preview reports, errors first, once each.
 *
 * Includes lifecycle failures even when the screen can still be drawn, and the
 * related screens - sheets, pushed details - the all-pages pass could not build.
 */
export function previewIssues(result: CompileResult, files: readonly { path: string; code: string }[] = []): PreviewIssue[] {
  const at = (span: SourceSpan | undefined): Pick<PreviewIssue, 'file' | 'line'> => {
    if (!span?.file) return {}
    const code = files.find(file => file.path === span.file)?.code
    return { file: span.file, ...(code !== undefined ? { line: code.slice(0, span.start).split('\n').length } : {}) }
  }
  const issues: PreviewIssue[] = result.diagnostics.filter(d => d.severity !== 'info').map(d => ({ severity: d.severity === 'error' ? 'error' : 'warning', message: d.message, ...at(d.span) }))
  issues.push(...result.logs.filter(log => log.level === 'error').map(log => ({ severity: 'error' as const, message: log.message, ...at(log.origin) })))
  issues.push(...(result.pageFailures ?? []).map(page => ({ severity: 'error' as const, message: `${page.message} (opening ${page.kind === 'destination' ? 'the screen' : `the ${page.kind}`} “${page.name}”)`, ...at(page.source) })))
  if (!result.renderTree) issues.push({ severity: 'error', message: 'The preview did not produce a screen.' })
  if (result.renderTree?.nodes.some(n => n.kind === 'placeholder')) issues.push({ severity: 'warning', message: 'Some views are not supported by this preview.' })
  const seen = new Set<string>()
  return issues
    .filter(issue => { const key = issueText(issue); if (seen.has(key)) return false; seen.add(key); return true })
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
    .slice(0, 12)
}

/** `Sources/Features/ExploreView.swift:12 · Value of type …`, for a list a person reads. */
export function issueText(issue: PreviewIssue): string {
  const place = issue.file ? `${issue.file.replace(/^Sources\//, '')}${issue.line ? `:${issue.line}` : ''} · ` : ''
  return `${place}${issue.message}`
}
