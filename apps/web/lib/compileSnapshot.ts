import * as Comlink from 'comlink'
import { getDevice } from '@studio/sim-shell'
import { imageDataURL, type Project } from '@studio/project-model'
import type { CompileRequest, CompileResult, CompilerApi } from '@studio/shared'
import { measureFontsWhenReady, measureTextBatch } from './fontMetrics'

/** A bounded, disposable compiler; never changes the user's live preview state. */
export function compileSnapshot(project: Project, signal: AbortSignal, overrides: Partial<CompileRequest> = {}): Promise<CompileResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const worker = new Worker(new URL('../workers/compiler.worker.ts', import.meta.url), { type: 'module' })
    const api = Comlink.wrap<CompilerApi>(worker)
    let finished = false
    const cleanup = () => { finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort); api[Comlink.releaseProxy](); worker.terminate() }
    const fail = (error: Error) => { if (!finished) { cleanup(); reject(error) } }
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'))
    const timer = setTimeout(() => fail(new Error('The preview check took too long. Try a smaller change.')), 30000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => fail(new Error('The preview check could not run. Please try again.'))
    const device = getDevice(project.manifest.device)
    void (async () => {
      await api.setFontMetrics(await measureFontsWhenReady())
      if (finished) return
      let result = await api.compile({
        projectId: project.id, files: project.files, revision: 1, deploymentTarget: project.manifest.deploymentTarget, previewTarget: project.manifest.previewTarget,
        canvas: { width: device.width, height: device.height }, safeArea: device.safeArea, colorScheme: project.manifest.colorScheme,
        designScreens: project.studio?.screens, componentDescriptions: project.studio?.components, colors: project.colors,
        images: project.assets?.map(asset => ({ name: asset.name, width: asset.light.width / asset.scale, height: asset.light.height / asset.scale, light: imageDataURL(asset.light), dark: asset.dark ? imageDataURL(asset.dark) : undefined })),
        allPages: true, ...overrides,
      })
      for (let pass = 0; pass < 3 && !finished; pass++) {
        const requests = result.textMeasurement?.requests ?? []
        if (!requests.length) break
        const next = await api.setTextMeasurements(measureTextBatch(requests), result.revision, result.textMeasurement?.generation)
        if (!next) break
        result = next
      }
      if (!finished) { cleanup(); resolve(result) }
    })().catch(error => fail(error instanceof Error ? error : new Error('Preview validation failed.')))
  })
}
