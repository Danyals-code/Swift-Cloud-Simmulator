import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import type { PagePreview } from '@studio/shared'
import { compileSnapshot } from './compileSnapshot'
import { capturePreview } from './designExport'
import { events } from './eventLog'
import type { ExportSteps } from './exportProject'
import { saveFile } from './recovery'

const ignoreEvent = () => {}

/**
 * Exporting's steps as a browser takes them: the store's save, a disposable compiler
 * that never touches the live preview, the canvas's own renderer drawn off screen, the
 * page's event log, and the downloads bar.
 */
export function browserExportSteps(save: () => Promise<unknown>): ExportSteps {
  return {
    save,
    compile: (project, settings, signal) => compileSnapshot(project, signal, { colorScheme: settings.colorScheme, dynamicTypeSize: settings.dynamicTypeSize, typeScale: settings.typeScale, galleryLimit: 128 }),
    capture: capturePage,
    events: (project, format) => {
      events.record(project, { type: 'export', format })
      return events.jsonl(project)
    },
    download: (name, bytes) => saveFile(name, 'application/zip', bytes),
  }
}

/** One page as a PNG, drawn off screen; given up, it takes its drawing with it. */
async function capturePage(page: PagePreview, signal: AbortSignal): Promise<Uint8Array> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true'); host.inert = true
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', pointerEvents: 'none' })
  document.body.append(host)
  const root = createRoot(host)
  const remove = () => { root.unmount(); host.remove() }
  signal.addEventListener('abort', remove, { once: true })
  try {
    const { width, height } = page.tree.canvas
    flushSync(() => root.render(<div style={{ width, height, background: page.tree.colorScheme === 'dark' ? '#000' : '#fff' }}><RenderTreeView tree={page.tree} onEvent={ignoreEvent} /></div>))
    const canvas = await capturePreview(host.firstElementChild as HTMLElement, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('the browser could not make a PNG')), 'image/png'))
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    if (!signal.aborted) { signal.removeEventListener('abort', remove); remove() }
  }
}
