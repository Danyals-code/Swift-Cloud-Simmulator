import { EDIT_SCHEMA, parsePromptEditInput, parsePromptEditResult, promptEditChanges } from '../../../lib/generation/edit-schema'
import { EDIT_SYSTEM_PROMPT, promptEditContext } from '../../../lib/generation/edit-prompt'
import { readProviderStream, streamDeadline } from '../../../lib/generation/providerStream'
import { answer, fail, fromTheStudio, unusable } from '../../../lib/generation/routeAnswers'

export const runtime = 'nodejs'
// The answer streams, so it may run to the route's limit; see streamDeadline below.
export const maxDuration = 300

/** Explicit BYOK edit request. Credentials are forwarded only to the chosen provider. */
export async function POST(request: Request): Promise<Response> {
  if (!fromTheStudio(request)) return fail('This request must come from the studio.', 403)
  if (!request.headers.get('content-type')?.startsWith('application/json')) return fail('Send a JSON request.', 415)
  const apiKey = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!/^[\x21-\x7e]{20,512}$/.test(apiKey)) return fail('Enter a valid API key.')
  let input
  try {
    const reader = request.body?.getReader()
    if (!reader) return fail('The request is empty.')
    const chunks: Uint8Array[] = []; let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 2_500_000) { await reader.cancel(); return fail('This project is too large for prompt editing.', 413) }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    input = parsePromptEditInput(JSON.parse(new TextDecoder().decode(bytes)))
  } catch (error) { return fail(error instanceof SyntaxError ? 'The request is not valid JSON.' : error instanceof Error ? error.message : 'Invalid request.') }
  // The answer streams, so a long edit runs until the route's limit; a stream silent for two minutes is stuck.
  const deadline = streamDeadline(request.signal, 290000, 120000)
  try {
    const openai = input.provider === 'openai'
    const response = await fetch(openai ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: deadline.signal, cache: 'no-store', redirect: 'error',
      headers: openai ? { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } : { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(openai ? { model: input.model, store: false, stream: true, instructions: EDIT_SYSTEM_PROMPT, input: promptEditContext(input), max_output_tokens: 24000, text: { format: { type: 'json_schema', name: 'swiftui_edit', strict: true, schema: EDIT_SCHEMA } } } : { model: input.model, max_tokens: 24000, stream: true, system: EDIT_SYSTEM_PROMPT, messages: [{ role: 'user', content: promptEditContext(input) }], output_config: { effort: 'medium', format: { type: 'json_schema', schema: EDIT_SCHEMA } } }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      if ([401, 403].includes(response.status)) return fail('Check your API key and model access. No changes applied.', 401)
      if (response.status === 429) return fail('Provider rate limit or credit balance reached. No changes applied.', 429)
      if ([400, 404, 422].includes(response.status)) return fail('This model could not process the request. Check its ID and structured-output support.', 400)
      return fail('The provider is unavailable. Try again later.', 502)
    }
    const { text, stop } = await readProviderStream(response.body, deadline.alive)
    if (stop === 'declined') return fail('The provider declined this request. No changes applied.', 422)
    if (stop === 'length') return fail('The response hit its length limit before the edit was finished. Try a smaller change. No changes applied.', 422)
    if (stop !== 'done') return fail('The edit was incomplete. Try again. No changes applied.', 422)
    try {
      const edit = parsePromptEditResult(JSON.parse(text))
      promptEditChanges(input.files, edit)
      return answer({ edit })
    } catch (error) { return unusable(error instanceof SyntaxError ? 'The AI returned an unreadable edit. No changes applied.' : error instanceof Error ? error.message : 'Invalid edit.') }
  } catch {
    if (request.signal.aborted) return fail('Cancelled. No changes applied.', 499)
    if (deadline.expired()) return fail('The edit took too long. Try a smaller change.', 504)
    return fail('Could not reach the provider. No changes applied.', 502)
  } finally { deadline.stop() }
}
