/** Conversation records belong to the project, but are not reverted by source Undo. */
export interface PromptSelection {
  readonly label: string
  readonly file: string
  readonly start: number
  readonly end: number
  readonly owner: string
}
export interface PromptMessage {
  readonly id: string
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly createdAt: number
  readonly provider: 'openai' | 'anthropic'
  readonly model: string
  readonly kind: 'create' | 'edit'
  readonly selection?: PromptSelection
  readonly status?: 'applied' | 'replied' | 'failed' | 'cancelled'
  readonly changedFiles?: readonly string[]
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit
export function validPromptSelection(value: unknown): value is PromptSelection {
  return record(value) && text(value.label, 200) && text(value.file, 512) && typeof value.owner === 'string' && value.owner.length <= 200 && Number.isSafeInteger(value.start) && Number(value.start) >= 0 && Number.isSafeInteger(value.end) && Number(value.end) > Number(value.start)
}
export function validatePromptHistory(value: unknown): asserts value is readonly PromptMessage[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Prompt history may contain up to 1,000 messages.')
  const ids = new Set<string>()
  for (const message of value) {
    if (!record(message) || !text(message.id, 128) || ids.has(message.id) || !['user', 'assistant'].includes(String(message.role)) || !text(message.content, 8000) || (typeof message.createdAt !== 'number' || !Number.isFinite(message.createdAt) || Math.abs(message.createdAt) > 8.64e15) || !['openai', 'anthropic'].includes(String(message.provider)) || !text(message.model, 100) || !['create', 'edit'].includes(String(message.kind)) || message.selection !== undefined && !validPromptSelection(message.selection) || message.status !== undefined && !['applied', 'replied', 'failed', 'cancelled'].includes(String(message.status)) || message.changedFiles !== undefined && (!Array.isArray(message.changedFiles) || message.changedFiles.length > 256 || message.changedFiles.some(path => !text(path, 512)))) throw new Error('Prompt history contains an invalid message.')
    ids.add(message.id)
  }
  if (JSON.stringify(value).length > 2_000_000) throw new Error('Prompt history has reached its 2 MB limit. Export this project before starting a new conversation.')
}
