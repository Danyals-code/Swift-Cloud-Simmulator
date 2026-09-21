import { EDIT_SCHEMA, parsePromptEditInput, parsePromptEditResult, promptEditChanges } from '../../../lib/generation/edit-schema'
import { EDIT_SYSTEM_PROMPT, promptEditContext } from '../../../lib/generation/edit-prompt'

export const runtime = 'nodejs'
export const maxDuration = 180
const headers = { 'Cache-Control': 'no-store' }
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers })

/** Explicit BYOK edit request. Credentials are forwarded only to the chosen provider. */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return fail('This request must come from the studio.', 403)
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
  const timeout = AbortSignal.timeout(165000), signal = AbortSignal.any([request.signal, timeout])
  try {
    const openai = input.provider === 'openai'
    const response = await fetch(openai ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages', {
      method: 'POST', signal, cache: 'no-store', redirect: 'error',
      headers: openai ? { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` } : { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(openai ? { model: input.model, store: false, instructions: EDIT_SYSTEM_PROMPT, input: promptEditContext(input), max_output_tokens: 16000, text: { format: { type: 'json_schema', name: 'swiftui_edit', strict: true, schema: EDIT_SCHEMA } } } : { model: input.model, max_tokens: 16000, system: EDIT_SYSTEM_PROMPT, messages: [{ role: 'user', content: promptEditContext(input) }], output_config: { format: { type: 'json_schema', schema: EDIT_SCHEMA } } }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      if ([401, 403].includes(response.status)) return fail('Check your API key and model access. No changes applied.', 401)
      if (response.status === 429) return fail('Provider rate limit or credit balance reached. No changes applied.', 429)
      if ([400, 404, 422].includes(response.status)) return fail('This model could not process the request. Check its ID and structured-output support.', 400)
      return fail('The provider is unavailable. Try again later.', 502)
    }
    const output = await response.json()
    if (openai ? output.status !== 'completed' : output.stop_reason !== 'end_turn') return fail('The edit was incomplete. Try a smaller change. No changes applied.', 422)
    const blocks = openai ? (output.output ?? []).flatMap((item: { content?: unknown[] }) => item.content ?? []) : output.content ?? []
    if (blocks.some((block: { type: string }) => block.type === 'refusal')) return fail('The provider declined this request. No changes applied.', 422)
    try {
      const text = blocks.filter((block: { type: string }) => block.type === (openai ? 'output_text' : 'text')).map((block: { text: string }) => block.text).join('')
      const edit = parsePromptEditResult(JSON.parse(text))
      promptEditChanges(input.files, edit)
      return Response.json({ edit }, { headers })
    } catch (error) { return fail(error instanceof SyntaxError ? 'The AI returned an unreadable edit. No changes applied.' : error instanceof Error ? error.message : 'Invalid edit.', 422) }
  } catch {
    if (request.signal.aborted) return fail('Cancelled. No changes applied.', 499)
    if (timeout.aborted) return fail('The edit took too long. Try a smaller change.', 504)
    return fail('Could not reach the provider. No changes applied.', 502)
  }
}
