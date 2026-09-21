import { applyProjectTransaction, type Project } from '@studio/project-model'
import type { CompileResult } from '@studio/shared'
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
export function promptPreviewProblem(result: CompileResult): string | null {
  const issue = result.diagnostics.find(item => item.severity === 'error')?.message ?? result.logs.find(item => item.level === 'error')?.message
  if (issue) return `No changes applied: ${issue.slice(0, 220)}`
  return result.renderTree ? null : 'The edit did not produce a preview. No changes applied.'
}
