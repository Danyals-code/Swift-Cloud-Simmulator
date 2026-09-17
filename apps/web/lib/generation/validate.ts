import * as Comlink from 'comlink'
import { DEVICES } from '@studio/sim-shell'
import type { CompileResult, CompilerApi } from '@studio/shared'
import type { GeneratedApp } from './schema'

/** A new worker instance shares the compiler bundle, never the active project's state. */
export function checkPreview(app: GeneratedApp, signal: AbortSignal): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return }
    const worker = new Worker(new URL('../../workers/compiler.worker.ts', import.meta.url), { type: 'module' })
    const api = Comlink.wrap<CompilerApi>(worker)
    let settled = false
    const finish = (issues: string[]) => { if (settled) return; cleanup(); resolve(issues) }
    const abort = () => { if (settled) return; cleanup(); reject(new DOMException('Cancelled', 'AbortError')) }
    const timer = setTimeout(() => finish(['Preview validation timed out. Review the code after opening.']), 12000)
    function cleanup() { settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); api[Comlink.releaseProxy](); worker.terminate() }
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => finish(['Preview validation is unavailable. Review the code after opening.'])
    const device = DEVICES['iphone-15']
    void api.compile({ files: app.files.map(f => ({ id: f.path, text: f.code })), canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: 'light', revision: 1 }).then(result => {
      finish(previewIssues(result))
    }).catch(() => finish(['The preview could not evaluate this project. Review its code after opening.']))
  })
}

/** Include initial lifecycle failures even when the screen can still be drawn. */
export function previewIssues(result: CompileResult): string[] {
  const issues = result.diagnostics.map(d => `${d.severity}: ${d.message}`)
  issues.push(...result.logs.filter(log => log.level === 'error').map(log => `runtime: ${log.message}`))
  if (!result.renderTree) issues.push('The preview did not produce a screen.')
  if (result.renderTree?.nodes.some(n => n.kind === 'placeholder')) issues.push('Some views are not supported by this preview.')
  return [...new Set(issues)].slice(0, 12)
}
