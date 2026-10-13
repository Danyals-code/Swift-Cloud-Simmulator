import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../app/api/generate/route'
import { parseGeneratedApp, parseOptions, type GenerationOptions } from './schema'

const options: GenerationOptions = { provider: 'openai', model: 'gpt-5.4-mini', prompt: 'A simple tracker for daily reading habits.', pageCount: 1, navigation: 'stack', accent: 'teal', sampleData: true, includeSettings: false }
const app = { name: 'ReadingApp', summary: 'A reading tracker.', pages: [{ title: 'Today', file: 'Sources/ReadingApp.swift' }], files: [{ path: 'Sources/ReadingApp.swift', code: 'import SwiftUI\n@main struct ReadingApp: App { var body: some Scene { WindowGroup { Text("Today") } } }' }] }
const key = 'sk-test-not-a-real-key-123456789'
function request(body: unknown = options, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Origin: 'http://localhost', ...headers }, body: JSON.stringify(body) })
}
const sse = (...events: object[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
const openaiResponse = (value: unknown = app) => sse({ type: 'response.output_item.added', item: { type: 'reasoning' } }, { type: 'response.output_text.delta', delta: JSON.stringify(value) }, { type: 'response.completed', response: { status: 'completed' } })
const anthropicResponse = (value: unknown = app) => sse({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: JSON.stringify(value) } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } })
afterEach(() => vi.unstubAllGlobals())

describe('generated project boundaries', () => {
  it('accepts a complete project with its requested pages', () => expect(parseGeneratedApp(app, 1)).toEqual(app))
  it.each(['../escape.swift', '/tmp/App.swift', 'Sources/../App.swift', 'Sources/.hidden.swift', 'Sources/App.ts'])('rejects unsafe path %s', path => {
    expect(() => parseGeneratedApp({ ...app, files: [{ ...app.files[0], path }] })).toThrow()
  })
  it('rejects file collisions on case-insensitive Macs', () => {
    expect(() => parseGeneratedApp({ ...app, files: [...app.files, { ...app.files[0], path: 'Sources/readingapp.swift' }] })).toThrow('duplicate')
  })
  it('rejects missing pages and mismatched page counts', () => {
    expect(() => parseGeneratedApp({ ...app, pages: [{ title: 'Missing', file: 'Sources/Missing.swift' }] })).toThrow('missing file')
    expect(() => parseGeneratedApp(app, 4)).toThrow('page count')
  })
  it('does not accept a commented-out entry point', () => {
    expect(() => parseGeneratedApp({ ...app, files: [{ ...app.files[0], code: '// @main struct ReadingApp: App {}' }] })).toThrow('entry point')
  })
  it('rejects oversized code before the preview worker runs', () => {
    expect(() => parseGeneratedApp({ ...app, files: [{ ...app.files[0], code: 'x'.repeat(60001) }] })).toThrow('oversized')
  })
  it.each([0, 7, 2.5, '3'])('rejects invalid page count %s', pageCount => expect(() => parseOptions({ ...options, pageCount })).toThrow())
})

describe('generation endpoint', () => {
  it('uses OpenAI structured output without retaining the response', async () => {
    const fetch = vi.fn().mockResolvedValue(openaiResponse()); vi.stubGlobal('fetch', fetch)
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ app })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/responses')
    const body = JSON.parse(init.body)
    expect(body.store).toBe(false)
    expect(body.stream).toBe(true)
    expect(body.text.format.type).toBe('json_schema')
    expect(body.text.format.strict).toBe(true)
    expect(init.body).not.toContain(key)
    expect(body.input).toContain(options.prompt)
  })
  it('uses Anthropic messages and its current JSON-output format', async () => {
    const fetch = vi.fn().mockResolvedValue(anthropicResponse()); vi.stubGlobal('fetch', fetch)
    const response = await POST(request({ ...options, provider: 'anthropic', model: 'claude-sonnet-5' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ app })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe(key)
    expect(JSON.parse(init.body)).toMatchObject({ max_tokens: 24000, stream: true, output_config: { effort: 'medium', format: { type: 'json_schema' } } })
    expect(init.body).not.toContain(key)
  })
  it('rejects foreign origins without contacting a provider', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await POST(request(options, { Origin: 'https://unrelated.example' }))).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects invalid input and missing credentials without a paid request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await POST(request({ ...options, pageCount: 8 }))).status).toBe(400)
    expect((await POST(request(options, { Authorization: '' }))).status).toBe(400)
    expect((await POST(request({ ...options, prompt: 'x'.repeat(31000) }))).status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([401, 403, 429, 500])('handles provider status %s without leaking upstream content or retrying', async status => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: `secret ${key}` }, { status })); vi.stubGlobal('fetch', fetch)
    const response = await POST(request())
    expect(response.ok).toBe(false)
    expect(await response.text()).not.toContain(key)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    [{ type: 'response.incomplete', response: { incomplete_details: null } }],
    [{ type: 'response.refusal.delta', delta: 'No' }, { type: 'response.completed', response: {} }],
    [{ type: 'response.output_text.delta', delta: 'not JSON' }, { type: 'response.completed', response: {} }],
    [{ type: 'response.output_text.delta', delta: JSON.stringify(app) }],
    [{ type: 'response.output_text.delta', delta: JSON.stringify(app) }, { type: 'error', message: 'overloaded' }],
  ])('does not return a broken, cut-off or refused draft', async (...events) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse(...events)))
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect(await response.json()).not.toHaveProperty('app')
  })
  it.each([
    ['anthropic', { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, 'length limit'],
    ['openai', { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }, 'length limit'],
    ['anthropic', { type: 'message_delta', delta: { stop_reason: 'refusal' } }, 'declined'],
    ['openai', { type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } }, 'declined'],
  ] as const)('tells a %s draft that ran out of room from a declined one', async (provider, event, error) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse(event)))
    const response = await POST(request({ ...options, provider, model: provider === 'anthropic' ? 'claude-sonnet-5' : options.model }))
    expect(response.status).toBe(422)
    expect((await response.json()).error).toContain(error)
  })
  it('keeps the request abort signal connected to the provider', async () => {
    const controller = new AbortController()
    const incoming = new Request(request(), { signal: controller.signal })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
      controller.abort()
      expect(init.signal.aborted).toBe(true)
      throw new DOMException('Aborted', 'AbortError')
    }))
    expect((await POST(incoming)).status).toBe(499)
  })
})
