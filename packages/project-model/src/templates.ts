import { readFileSync } from 'node:fs'
import type { SourceFile } from '@studio/shared'
import { STARTER_TEMPLATE_ID, TEMPLATE_CATALOG } from './catalog'
import { BLANK_FILES, type Template } from './starter'

export { appNameOf, BLANK_FILES, createDefaultProject, createProjectFromTemplate, type Template } from './starter'

/**
 * The gallery with its Swift, for Node: tests, the exporter's checks and the Xcode
 * builds.
 *
 * The sources are static files under `apps/web/public/templates/<id>/`, at the paths
 * the catalog lists, and the browser fetches them (`apps/web/lib/templateSources.ts`).
 * Reading the same files here keeps one copy of each template, so what the tests
 * check is what the studio serves. Nothing in the app imports this module: a static
 * import would put the whole corpus back into a chunk the bundle budget counts.
 */
const TEMPLATE_DIR = new URL('../../../apps/web/public/templates/', import.meta.url)

function filesOf(id: string, paths: readonly string[]): readonly SourceFile[] {
  if (id === STARTER_TEMPLATE_ID) return BLANK_FILES
  return paths.map((path) => ({ id: path, text: readFileSync(new URL(`${id}/${path}`, TEMPLATE_DIR), 'utf8') }))
}

/** Every template in gallery order, read from disk when this module loads. */
export const TEMPLATES: readonly Template[] = TEMPLATE_CATALOG.map((info) => ({
  ...info,
  files: filesOf(info.id, info.files),
}))

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

function filesById(id: string): readonly SourceFile[] {
  return templateById(id)?.files ?? []
}

export const FOLIO_FILES = filesById('folio')
export const KITCHEN_FILES = filesById('kitchen')
export const LEDGER_FILES = filesById('ledger')
export const PULSE_FILES = filesById('pulse')
export const TRAILHEAD_FILES = filesById('trailhead')
