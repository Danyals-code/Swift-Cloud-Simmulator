import { parseGeneratedApp, parseOptions, PROJECT_SCHEMA } from '../../../lib/generation/schema'
import { SYSTEM_PROMPT, userPrompt } from '../../../lib/generation/prompt'
import { readProviderStream, streamDeadline } from '../../../lib/generation/providerStream'
import { answer, fail, fromTheStudio, unusable } from '../../../lib/generation/routeAnswers'

export const runtime = 'nodejs'
// The answer streams, so it may run to the route's limit; see streamDeadline below.
export const maxDuration = 300

/** BYOK only. Fixed upstream URLs, no stored credentials, prompts, or project source. */
export async function POST(request: Request): Promise<Response> {
  if (!fromTheStudio(request)) return fail('This request must come from the studio.', 403)
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
      // Room for a 6,000-character description in any script, and a second request's problems (G2).
      if (bytes > 64_000) { await reader.cancel(); return fail('The request is too large.', 413) }
      chunks.push(value)
    }
    const data = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
    options = parseOptions(JSON.parse(new TextDecoder().decode(data)))
  } catch (error) {
    return fail(error instanceof SyntaxError ? 'The request is not valid JSON.' : error instanceof Error ? error.message : 'Invalid request.')
  }
  // The answer streams, so a long generation runs until the route's limit; a stream silent for two minutes is stuck.
  const deadline = streamDeadline(request.signal, 290000, 120000)
  try {
    const openai = options.provider === 'openai'
    const response = await fetch(openai ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: deadline.signal, cache: 'no-store', redirect: 'error',
      headers: openai
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
        : { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(openai ? {
        model: options.model, store: false, stream: true, instructions: SYSTEM_PROMPT,
        input: userPrompt(options), max_output_tokens: 24000,
        text: { format: { type: 'json_schema', name: 'swiftui_project', strict: true, schema: PROJECT_SCHEMA } },
      } : {
        model: options.model, max_tokens: 24000, stream: true, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt(options) }],
        // Current Claude models think by default, and thinking spends max_tokens; medium leaves room for the project.
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: PROJECT_SCHEMA } },
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
    const { text: output, stop } = await readProviderStream(response.body, deadline.alive)
    if (stop === 'declined') return fail('The provider declined this request. Revise the app description.', 422)
    if (stop === 'length') return fail('The response hit its length limit before the app was finished. Try fewer pages or a smaller scope. Your current project is unchanged.', 422)
    if (stop !== 'done') return fail('Generation did not finish. Try again. Your current project is unchanged.', 422)
    let app
    try { app = parseGeneratedApp(JSON.parse(output), options.pageCount) }
    catch (error) { return unusable(error instanceof SyntaxError ? 'The provider returned an unreadable project. Try generating again.' : error instanceof Error ? error.message : 'Invalid project.') }
    return answer({ app })
  } catch {
    if (request.signal.aborted) return fail('Generation was cancelled.', 499)
    if (deadline.expired()) return fail('Generation took too long. Try a smaller app or fewer pages.', 504)
    return fail('Could not reach the provider. Check your connection and try again.', 502)
  } finally { deadline.stop() }
}
