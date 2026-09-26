import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../app/api/generate/route'
import { parseGeneratedApp, parseOptions, type GenerationOptions } from './schema'
import { SWIFTUI_GUIDANCE } from './guidance'
import { SYSTEM_PROMPT } from './prompt'

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
  it('names a file left outside Sources/ and the rule, so asking again can fix it (G2)', () => {
    const outside = { ...app, pages: [{ title: 'Today', file: 'Features/TodayView.swift' }], files: [...app.files, { path: 'Features/TodayView.swift', code: 'import SwiftUI\nstruct TodayView: View { var body: some View { Text("Today") } }' }] }
    expect(() => parseGeneratedApp(outside, 1)).toThrow('A generated file is not under Sources/: Features/TodayView.swift. Every file goes under Sources/, such as Sources/Features/TodayView.swift.')
  })
  it('asks for every file under Sources/, folders included, as the route checks', () => {
    expect(SYSTEM_PROMPT).toContain('Every file is under Sources/: the entry file first, then Sources/Models/, Sources/Components/ and Sources/Features/.')
  })
  it('rejects file collisions on case-insensitive Macs', () => {
    expect(() => parseGeneratedApp({ ...app, files: [...app.files, { ...app.files[0], path: 'Sources/readingapp.swift' }] })).toThrow('duplicate')
  })
  it('rejects missing pages and mismatched page counts', () => {
    expect(() => parseGeneratedApp({ ...app, pages: [{ title: 'Missing', file: 'Sources/Missing.swift' }] })).toThrow('missing file')
    expect(() => parseGeneratedApp(app, 4)).toThrow('The app has 1 page, and 4 were asked for.')
  })
  it('accepts one page more or fewer than asked for, and no further off (G2)', () => {
    const page = app.pages[0]!
    const three = { ...app, pages: [page, { ...page, title: 'Detail' }, { ...page, title: 'Settings' }] }
    expect(parseGeneratedApp(app, 2)).toEqual(app)
    expect(parseGeneratedApp(three, 2)).toEqual(three)
    expect(() => parseGeneratedApp(three, 1)).toThrow('The app has 3 pages, and 1 was asked for.')
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
  it('tells the provider what was wrong with the first answer when asking again (G2)', async () => {
    const fetch = vi.fn().mockResolvedValue(openaiResponse()); vi.stubGlobal('fetch', fetch)
    const previousAttempt = { problems: [{ message: "Cannot find 'Theme' in scope.", file: 'Sources/ReadingApp.swift', line: 3, source: 'Text(Theme.title)' }] }
    expect((await POST(request({ ...options, previousAttempt }))).status).toBe(200)
    expect(JSON.parse(JSON.parse(fetch.mock.calls[0]![1].body).input).previousAttempt).toEqual(previousAttempt)
  })
  it('has room for a second request with a long description in any script, and all its problems (G2)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(openaiResponse()))
    const problem = { message: '읽'.repeat(400), file: 'Sources/ReadingApp.swift', line: 3, source: '읽'.repeat(200) }
    const previousAttempt = { problems: Array.from({ length: 8 }, () => problem) }
    const body = JSON.stringify({ ...options, prompt: '읽기목표'.repeat(1500), previousAttempt })
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(30_000)

    expect((await POST(request(JSON.parse(body)))).status).toBe(200)
  })
  it.each([
    ['no list of problems', { problems: 'Theme is missing' }],
    ['no problems at all', { problems: [] }],
    ['too many problems', { problems: Array.from({ length: 9 }, (_, i) => ({ message: `Problem ${i}` })) }],
    ['a message too long to be one', { problems: [{ message: 'x'.repeat(401) }] }],
    ['a file outside the project', { problems: [{ message: 'Broken', file: '../secrets.swift', line: 1 }] }],
  ])('refuses a note about the first answer with %s, before any paid request', async (_case, previousAttempt) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const response = await POST(request({ ...options, previousAttempt }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'The note about the first answer is not valid.' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects a request that does not say which page it comes from, without contacting a provider (G4)', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const unsigned = new Request('http://localhost/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(options) })
    expect((await POST(unsigned)).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects invalid input and missing credentials without a paid request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await POST(request({ ...options, pageCount: 8 }))).status).toBe(400)
    expect((await POST(request(options, { Authorization: '' }))).status).toBe(400)
    expect((await POST(request({ ...options, prompt: 'x'.repeat(65_000) }))).status).toBe(413)
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
  it.each([
    ['an unreadable project', { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'not JSON' }] }] }, true],
    ['too many pages', { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...app, pages: [app.pages[0], app.pages[0], app.pages[0]] }) }] }] }, true],
    ['an unfinished answer', { status: 'incomplete', output: [] }, false],
    ['a refusal', { status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'No' }] }] }, false],
  ])('says whether asking again could make a usable draft, after %s (G2)', async (_case, body, retryable) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    const response = await POST(request())
    expect(response.status).toBe(422)
    expect((await response.json()).retryable ?? false).toBe(retryable)
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
