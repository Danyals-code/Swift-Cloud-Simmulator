import { templateById, type Template } from '@studio/project-model/templates'

/**
 * `apps/web/lib/templateSources.ts` for tests that run in Node, where there is no
 * server to fetch `public/templates/` from.
 *
 * Answers with the same files read from disk, so a store test still creates a project
 * from the real template content. Use it with
 * `vi.mock('./templateSources', () => import('../../../tests/helpers/template-sources'))`.
 */
export async function fetchTemplate(id: string): Promise<Template | undefined> {
  return templateById(id)
}
