import { normalizeFileName, sourcePathsConflict, validPromptSelection, type PromptSelection, type PromptMessage } from '@studio/project-model'
import type { SourceChange, SourceFile } from '@studio/shared'
import type { Provider } from './schema'
import { parsePreviousAttempt, type PreviousAttempt } from './previousAttempt'

export interface PromptEditInput {
  provider: Provider
  model: string
  prompt: string
  files: readonly SourceFile[]
  selection: PromptSelection | null
  history: readonly { role: 'user' | 'assistant'; content: string }[]
  project: { name: string; deploymentTarget: string; images: readonly string[]; colors: readonly string[] }
  /** The second request of an attempt: what was wrong with the first answer (G2). */
  previousAttempt?: PreviousAttempt
}
export interface PromptEditResult { reply: string; files: { path: string; code: string }[]; deletedFiles: string[] }
/** Failed or interrupted turns are visible in the log, but are not instructions for the next edit. */
export function promptConversationContext(history: readonly PromptMessage[]): PromptEditInput['history'] {
  const completed: { role: 'user' | 'assistant'; content: string }[] = []
  let user: PromptMessage | undefined
  for (const message of history) {
    if (message.role === 'user') { user = message; continue }
    if (message.status !== 'failed' && message.status !== 'cancelled') {
      if (user) completed.push({ role: 'user', content: user.content })
      completed.push({ role: 'assistant', content: message.content })
    }
    user = undefined
  }
  return completed.slice(-24)
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const path = (v: unknown): v is string => text(v, 180) && v.endsWith('.swift') && normalizeFileName(v) === v
export const EDIT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    reply: { type: 'string', description: 'One short sentence, at most 30 words, describing the actual changes, or a brief answer if no changes are needed.' },
    files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, code: { type: 'string' } }, required: ['path', 'code'] } },
    deletedFiles: { type: 'array', items: { type: 'string' } },
  }, required: ['reply', 'files', 'deletedFiles'],
} as const

export function parsePromptEditInput(value: unknown): PromptEditInput {
  if (!record(value) || !['openai', 'anthropic'].includes(String(value.provider)) || !text(value.model, 100) || !/^[A-Za-z0-9._:-]+$/.test(value.model)) throw new Error('Choose a provider and valid model ID.')
  if (!text(value.prompt, 6000)) throw new Error('Describe the change in 1–6,000 characters.')
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 256) throw new Error('This project has too many source files for prompt editing.')
  let total = 0
  const files = value.files.map(f => {
    if (!record(f) || !path(f.id) || typeof f.text !== 'string') throw new Error('The project contains an invalid source file.')
    total += f.text.length
    return { id: f.id, text: f.text }
  })
  if (total > 600_000 || sourcePathsConflict(files.map(f => f.id))) throw new Error('The project is too large or contains conflicting paths.')
  const selection = value.selection ?? null
  if (selection !== null && (!validPromptSelection(selection) || !files.some(f => f.id === selection.file && selection.end <= f.text.length))) throw new Error('The selected layer is out of date. Select it again.')
  if (!Array.isArray(value.history) || value.history.length > 24) throw new Error('Invalid conversation context.')
  const history = value.history.map(message => {
    if (!record(message) || !['user', 'assistant'].includes(String(message.role)) || !text(message.content, 8000)) throw new Error('Invalid conversation message.')
    return { role: message.role as 'user' | 'assistant', content: message.content }
  })
  const project = value.project
  if (!record(project) || !text(project.name, 100) || !text(project.deploymentTarget, 20)) throw new Error('Invalid project settings.')
  const names = (value: unknown) => { if (!Array.isArray(value) || value.length > 256 || value.some(item => !text(item, 180))) throw new Error('Invalid project resources.'); return value as string[] }
  const previousAttempt = parsePreviousAttempt(value.previousAttempt)
  return { provider: value.provider as Provider, model: value.model, prompt: value.prompt.trim(), files, selection, history, project: { name: project.name, deploymentTarget: project.deploymentTarget, images: names(project.images), colors: names(project.colors) }, ...(previousAttempt ? { previousAttempt } : {}) }
}

export function parsePromptEditResult(value: unknown): PromptEditResult {
  if (!record(value) || !text(value.reply, 360) || !Array.isArray(value.files) || value.files.length > 32 || !Array.isArray(value.deletedFiles) || value.deletedFiles.length > 32) throw new Error('The AI returned an invalid edit. No changes were applied.')
  let total = 0
  const files = value.files.map(f => {
    if (!record(f) || !path(f.path) || !text(f.code, 200_000)) throw new Error('The AI returned an invalid source file. No changes were applied.')
    total += f.code.length
    return { path: f.path, code: f.code }
  })
  if (total > 600_000 || value.deletedFiles.some(id => !path(id)) || sourcePathsConflict([...files.map(f => f.path), ...value.deletedFiles as string[]])) throw new Error('The AI returned conflicting or oversized file changes.')
  return { reply: value.reply.trim(), files, deletedFiles: value.deletedFiles as string[] }
}

/** Apply only named changes; untouched files, resources and metadata remain intact. */
export function promptEditChanges(files: readonly SourceFile[], result: PromptEditResult): SourceChange[] {
  const before = new Map(files.map(f => [f.id, f.text]))
  if (result.deletedFiles.some(id => !before.has(id))) throw new Error('The AI tried to remove a file that does not exist.')
  const changes: SourceChange[] = result.files.map(f => ({ file: f.path, before: before.get(f.path) ?? null, after: f.code }))
  for (const file of result.deletedFiles) changes.push({ file, before: before.get(file)!, after: '', deleted: true })
  const remaining = files.filter(f => !result.deletedFiles.includes(f.id)).map(f => f.id)
  for (const f of result.files) if (!before.has(f.path)) remaining.push(f.path)
  if (!remaining.length || sourcePathsConflict(remaining)) throw new Error('The edit would remove every source file or create conflicting paths.')
  return changes.filter(change => change.deleted || change.before !== change.after)
}
