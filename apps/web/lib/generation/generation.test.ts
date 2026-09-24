import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../app/api/generate/route'
import { parseGeneratedApp, parseOptions, type GenerationOptions } from './schema'
import { SWIFTUI_GUIDANCE } from './guidance'

const options: GenerationOptions = { provider: 'openai', model: 'gpt-5.4-mini', prompt: 'A simple tracker for daily reading habits.', pageCount: 1, navigation: 'stack', accent: 'teal', sampleData: true, includeSettings: false }
const app = { name: 'ReadingApp', summary: 'A reading tracker.', pages: [{ title: 'Today', file: 'Sources/ReadingApp.swift' }], files: [{ path: 'Sources/ReadingApp.swift', code: 'import SwiftUI\n@main struct ReadingApp: App { var body: some Scene { WindowGroup { Text("Today") } } }' }] }
const key = 'sk-test-not-a-real-key-123456789'
function request(body: unknown = options, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Origin: 'http://localhost', ...headers }, body: JSON.stringify(body) })
}
const openaiResponse = (value: unknown = app) => Response.json({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] })
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
    expect(body.text.format.type).toBe('json_schema')
    expect(body.text.format.strict).toBe(true)
    expect(init.body).not.toContain(key)
    expect(body.input).toContain(options.prompt)
  })
  it('asks for the SwiftUI the studio previews and Design edits, the same as Prompt Editing does (G1)', async () => {
    const fetch = vi.fn().mockResolvedValue(openaiResponse()); vi.stubGlobal('fetch', fetch)
    await POST(request())
    const { instructions } = JSON.parse(fetch.mock.calls[0]![1].body)
    expect(instructions).toContain(SWIFTUI_GUIDANCE)
    expect(instructions).not.toContain('iOS 17')
  })
  it('uses Anthropic messages and its current JSON-output format', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(app) }] })); vi.stubGlobal('fetch', fetch)
    expect((await POST(request({ ...options, provider: 'anthropic', model: 'claude-sonnet-5' }))).status).toBe(200)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe(key)
    expect(JSON.parse(init.body).output_config.format.type).toBe('json_schema')
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
    { status: 'incomplete', output: [] },
    { status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'No' }] }] },
    { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'not JSON' }] }] },
  ])('does not return a broken or refused draft', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect(await response.json()).not.toHaveProperty('app')
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
