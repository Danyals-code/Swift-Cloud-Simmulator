import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { getDevice } from '@studio/sim-shell'
import { downloadProjectZip, type ScreenSnapshot } from '@studio/exporter'
import { STUDIO_BUILD } from './build'
import type { Project } from '@studio/project-model'
import type { PagePreview } from '@studio/shared'
import { compileSnapshot } from './compileSnapshot'
import { capturePreview } from './designExport'
import type { PreviewSettings } from './store'
import { screenCatalog, screenDefinition } from './screens'

const ignoreEvent = () => {}
/** Capture an immutable source snapshot without navigating or changing the live canvas. */
export async function exportCompleteProject(project: Project, preview: PreviewSettings): Promise<number> {
  const signal = AbortSignal.timeout(120000)
  const result = await compileSnapshot(project, signal, { colorScheme: preview.colorScheme, dynamicTypeSize: preview.dynamicTypeSize, typeScale: preview.typeScale, galleryLimit: 128 })
  const problem = result.diagnostics.find(item => item.severity === 'error')?.message ?? result.logs.find(item => item.level === 'error')?.message
  if (!result.renderTree || problem) throw new Error(`Screen capture needs a working preview${problem ? `: ${problem.slice(0, 180)}` : '.'} You can still export code from Export options.`)
  const pages: readonly PagePreview[] = result.pages?.length ? result.pages : [{ id: 'app', name: project.manifest.name, kind: 'root', active: true, tree: result.renderTree }]
  const catalog = screenCatalog(result.authoring, pages, project.studio?.screens)
  if ((project.studio?.screens?.length ?? 0) > 128 || pages.filter(page => page.kind === 'root').length >= 128 || pages.filter(page => page.kind !== 'root').length >= 128) throw new Error('This project exceeds the screen capture limit. Export code and individual images from Export options.')
  const missing = project.studio?.screens?.filter(screen => !pages.some(page => page.id === `screen:${screen.view}`)) ?? []
  if (missing.length) throw new Error(`Could not capture ${missing.map(screen => screen.name).join(', ')}. Resolve these screen previews or use a code-only export.`)
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true'); host.inert = true
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', pointerEvents: 'none' })
  document.body.append(host)
  const root = createRoot(host), screens: ScreenSnapshot[] = []
  try {
    for (const page of pages) {
      signal.throwIfAborted()
      const { width, height } = page.tree.canvas
      flushSync(() => root.render(<div key={page.id} style={{ width, height, background: page.tree.colorScheme === 'dark' ? '#000' : '#fff' }}><RenderTreeView tree={page.tree} onEvent={ignoreEvent} /></div>))
      const canvas = await capturePreview(host.firstElementChild as HTMLElement, width, height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('A screen could not be converted to PNG.')), 'image/png'))
      const definition = screenDefinition(result.authoring, page)
      const name = catalog.find(screen => screen.view === definition?.name)?.name ?? page.name
      screens.push({ id: page.id, name, kind: page.kind ?? 'root', width, height, png: new Uint8Array(await blob.arrayBuffer()) })
    }
    signal.throwIfAborted()
    downloadProjectZip(project, 'xcodeproj', { device: getDevice(project.manifest.device).name, colorScheme: preview.colorScheme, dynamicTypeSize: preview.dynamicTypeSize ?? 'large', typeScale: preview.typeScale, screens, diagnostics: [...result.diagnostics.map(item => `${item.severity}: ${item.message}`), ...result.logs.filter(item => item.level !== 'log').map(item => `${item.level}: ${item.message}`)] }, STUDIO_BUILD)
    return screens.length
  } finally { root.unmount(); host.remove() }
}
