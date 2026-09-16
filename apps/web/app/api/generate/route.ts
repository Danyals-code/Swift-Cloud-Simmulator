import { parseGeneratedApp, parseOptions, PROJECT_SCHEMA } from '../../../lib/generation/schema'
import { SYSTEM_PROMPT, userPrompt } from '../../../lib/generation/prompt'

export const runtime = 'nodejs'
export const maxDuration = 180
const HEADERS = { 'Cache-Control': 'no-store' }
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: HEADERS })

/** BYOK only. Fixed upstream URLs, no stored credentials, prompts, or project source. */
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return fail('This request must come from the studio.', 403)
  if (!request.headers.get('content-type')?.startsWith('application/json')) return fail('Send a JSON request.', 415)
  const apiKey = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!/^[\x21-\x7e]{20,512}$/.test(apiKey)) return fail('Enter a valid API key.')
  let options
  try {
    // Bound reads even when Content-Length is absent or inaccurate.
    const reader = request.body?.getReader()
    if (!reader) return fail('The request is empty.')
    let bytes = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 30000) { await reader.cancel(); return fail('The request is too large.', 413) }
      chunks.push(value)
    }
    const data = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
    options = parseOptions(JSON.parse(new TextDecoder().decode(data)))
  } catch (error) {
    return fail(error instanceof SyntaxError ? 'The request is not valid JSON.' : error instanceof Error ? error.message : 'Invalid request.')
  }
  const timeout = AbortSignal.timeout(165000)
  const signal = AbortSignal.any([request.signal, timeout])
  try {
    const openai = options.provider === 'openai'
    const response = await fetch(openai ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages', {
      method: 'POST', signal, cache: 'no-store', redirect: 'error',
      headers: openai
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
        : { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(openai ? {
        model: options.model, store: false, instructions: SYSTEM_PROMPT,
        input: userPrompt(options), max_output_tokens: 16000,
        text: { format: { type: 'json_schema', name: 'swiftui_project', strict: true, schema: PROJECT_SCHEMA } },
      } : {
        model: options.model, max_tokens: 16000, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt(options) }],
        output_config: { format: { type: 'json_schema', schema: PROJECT_SCHEMA } },
      }),
    })
    if (!response.ok) {
      // Do not echo upstream bodies: they can contain user input or credentials.
      await response.body?.cancel()
      if ([401, 403].includes(response.status)) return fail('The provider rejected this key or model access. Check your API key and permissions.', 401)
      if (response.status === 429) return fail('Your provider rate limit or credit balance was reached. Check your account before trying again.', 429)
      if ([400, 404, 422].includes(response.status)) return fail('The provider could not use this model or structured-output request. Check the model ID and its capabilities.', 400)
      return fail('The provider is unavailable. Please try again later.', 502)
    }
    const result = await response.json()
    if ((openai && result.status !== 'completed') || (!openai && result.stop_reason !== 'end_turn')) return fail('Generation did not finish. Try fewer pages or a smaller scope. Your current project is unchanged.', 422)
    const blocks = openai ? (result.output ?? []).flatMap((item: { content?: unknown[] }) => item.content ?? []) : result.content ?? []
    if (blocks.some((b: { type: string }) => b.type === 'refusal')) return fail('The provider declined this request. Revise the app description.', 422)
    const output = blocks.filter((b: { type: string }) => b.type === (openai ? 'output_text' : 'text')).map((b: { text: string }) => b.text).join('')
    let app
    try { app = parseGeneratedApp(JSON.parse(output), options.pageCount) }
    catch (error) { return fail(error instanceof SyntaxError ? 'The provider returned an unreadable project. Try generating again.' : error instanceof Error ? error.message : 'Invalid project.', 422) }
    return Response.json({ app }, { headers: HEADERS })
  } catch {
    if (request.signal.aborted) return fail('Generation was cancelled.', 499)
    if (timeout.aborted) return fail('Generation took too long. Try a smaller app or fewer pages.', 504)
    return fail('Could not reach the provider. Check your connection and try again.', 502)
  }
}
