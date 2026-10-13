import type { PromptMessage } from '@studio/project-model'
import { parsePromptEditInput, parsePromptEditResult, promptConversationContext, promptEditChanges, type PromptEditInput } from './edit-schema'
import { parseGeneratedApp, type GeneratedApp, type Provider } from './schema'
import type { PreviewIssue } from './validate'

/**
 * The one instruction a repair carries.
 *
 * Fixed rather than written by the person, because what is being asked is always the
 * same: make the reported problems go away and change nothing else. The problems
 * themselves travel as `previewProblems`, which the edit prompt already explains.
 */
export const REPAIR_PROMPT = 'Fix every error in previewProblems so each screen of this new app runs in the browser preview. Change only what those errors require and keep the screens, design, sample data and behaviour otherwise the same. Where code calls something the preview does not run, use a member from the preview standard library or a small helper written in plain Swift instead. Return complete contents for each file you change.'

/** The problems a repair is sent: errors first, each placed at its file and line. */
export function repairProblems(issues: readonly PreviewIssue[]): PromptEditInput['previewProblems'] {
  return [...issues]
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
    .slice(0, 40)
    .map(issue => ({ severity: issue.severity, file: (issue.file ?? '').slice(0, 180), message: `${issue.line ? `line ${issue.line}: ` : ''}${issue.message}`.slice(0, 300) }))
}

/** Whether a draft has something a repair could fix, as opposed to only notes. */
export function repairable(issues: readonly PreviewIssue[]): boolean {
  return issues.some(issue => issue.severity === 'error')
}

/**
 * One repair request for a generated draft, through the same `/api/edit` contract
 * prompt editing uses: the draft's files, its problems and the brief it came from.
 */
export function repairInput(app: GeneratedApp, issues: readonly PreviewIssue[], connection: { provider: Provider; model: string }, history: readonly PromptMessage[]): PromptEditInput {
  return parsePromptEditInput({
    provider: connection.provider, model: connection.model, prompt: REPAIR_PROMPT,
    files: app.files.map(file => ({ id: file.path, text: file.code })), selection: null,
    history: promptConversationContext(history).map(message => ({ ...message, content: message.content.slice(0, 8000) })),
    project: { name: app.name, deploymentTarget: '17.0', images: [], colors: [] },
    previewProblems: repairProblems(issues),
  })
}

/**
 * A draft with a repair's edit applied, checked as strictly as the generation was.
 *
 * Only the files the repair names change; the result must still be a complete app
 * with its pages, so an edit that removed the entry point or a page's file is
 * refused rather than opened.
 */
export function applyRepair(app: GeneratedApp, value: unknown): { app: GeneratedApp; reply: string; changed: string[] } {
  const edit = parsePromptEditResult(value)
  const changes = promptEditChanges(app.files.map(file => ({ id: file.path, text: file.code })), edit)
  const files = new Map(app.files.map(file => [file.path, file.code]))
  for (const change of changes) {
    if (change.deleted) files.delete(change.file)
    else files.set(change.file, change.after)
  }
  const repaired = parseGeneratedApp({ ...app, files: [...files].map(([path, code]) => ({ path, code })) }, app.pages.length)
  return { app: repaired, reply: edit.reply, changed: changes.filter(change => change.before !== change.after).map(change => change.file) }
}
