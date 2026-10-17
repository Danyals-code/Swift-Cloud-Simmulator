import { blankTemplate, STARTER_TEMPLATE_ID, templateInfoById, type Template } from '@studio/project-model'
import { STUDIO_BUILD } from './build'

/**
 * A template with its Swift, fetched from `public/templates/<id>/` when somebody
 * presses Create.
 *
 * The sources are static files rather than JavaScript so that they cost the bundle
 * nothing: the budget counts every chunk, lazy ones included, and the corpus was 27 KB
 * of it. The catalog already lists each template's paths, so the files fetched always
 * match the card that was chosen. The blank screen is inline and never waits on the
 * network.
 *
 * `?v=` is the build's commit, so no browser or CDN copy from an earlier deploy is
 * reused. A tab left open across a deploy that renamed a template's files fails to
 * load it, and a reload fixes it.
 *
 * Answers `undefined` for an id the catalog does not have, and throws, naming the
 * file for the console, when any file fails to arrive. The gallery says what to do.
 */
export async function fetchTemplate(id: string): Promise<Template | undefined> {
  if (id === STARTER_TEMPLATE_ID) return blankTemplate()
  const info = templateInfoById(id)
  if (!info) return undefined

  const version = encodeURIComponent(STUDIO_BUILD.commit)
  const files = await Promise.all(info.files.map(async (path) => {
    const url = `/templates/${id}/${path}`
    try {
      const response = await fetch(`${url}?v=${version}`)
      if (response.ok) return { id: path, text: await response.text() }
    } catch {
      // Offline, or the body stopped arriving: the same answer as a missing file.
    }
    throw new Error(`${url} did not arrive.`)
  }))
  return { ...info, files }
}
