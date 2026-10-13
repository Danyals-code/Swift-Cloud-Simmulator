import { applyProjectTransaction, type Project } from '@studio/project-model'
import { parsePromptEditResult, promptEditChanges } from './edit-schema'

/** Pure preparation is shared by the UI and stale-response regression tests. */
export function preparePromptEdit(project: Project, revision: number, value: unknown) {
  const edit = parsePromptEditResult(value)
  const changes = promptEditChanges(project.files, edit)
  const transaction = { projectId: project.id, baseRevision: revision, changes }
  const candidate = applyProjectTransaction(project, revision, transaction)
  if (!candidate.ok) throw new Error(candidate.reason)
  return { edit, transaction, candidate: candidate.project }
}
