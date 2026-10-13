import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../app/api/edit/route'
import { parsePromptEditInput, parsePromptEditResult, promptEditChanges, promptConversationContext, promptPreviewContext, type PromptEditInput } from './edit-schema'
import { promptEditContext } from './edit-prompt'
import { preparePromptEdit, promptPreviewProblem } from './applyPromptEdit'
import { useStudio } from '../store'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { createDefaultProject } from '@studio/project-model/templates'
import { normalizeProject, type PromptMessage } from '@studio/project-model'

const source = 'import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { Text("Before") } } }'
const input: PromptEditInput = { provider: 'openai', model: 'gpt-5.4-mini', prompt: 'Change the title to After.', files: [{ id: 'Sources/App.swift', text: source }], selection: { label: 'Title', file: 'Sources/App.swift', start: source.indexOf('Text'), end: source.indexOf('Text') + 14, owner: 'DemoApp' }, history: [{ role: 'assistant', content: 'Added a title.' }], project: { name: 'DemoApp', deploymentTarget: '17.0', images: [], colors: [] }, previewProblems: [{ severity: 'warning', file: 'Sources/App.swift', message: '`.toolbarBackground` is recognised but not applied by the preview.' }] }
const edit ={ reply: 'Changed the title to After.', files: [{ path: 'Sources/App.swift', code: source.replace('Before', 'After') }], deletedFiles: [] }
const key = 'sk-test-not-a-real-key-123456789'
const request = (body: unknown = input, headers = {}) => new Request('http://localhost/api/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Authorization: `Bearer ${key}`, ...headers }, body: JSON.stringify(body) })
const sse = (...events: object[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
const response = (value: unknown = edit) => sse({ type: 'response.output_text.delta', delta: JSON.stringify(value) }, { type: 'response.completed', response: { status: 'completed' } })
const message = (content = 'Change the title'): PromptMessage => ({ id: crypto.randomUUID(), role: 'user', content, createdAt: 1, kind: 'edit', provider: 'openai', model: input.model })
afterEach(() => vi.unstubAllGlobals())

describe('prompt edit boundaries', () => {
  it('excludes failed and unfinished turns from the next request while keeping complete pairs', () => {
    expect(promptConversationContext([message('keep'), { ...message('done'), role: 'assistant', status: 'applied' }, message('failed request'), { ...message('error'), role: 'assistant', status: 'failed' }, message('interrupted')])).toEqual([{ role: 'user', content: 'keep' }, { role: 'assistant', content: 'done' }])
  })
  it('sends the precise selection, current sources and recent conversation as data', () => {
    expect(parsePromptEditInput(input)).toEqual(input)
    const context = promptEditContext(input)
    expect(context).toContain('Text(\\"Before\\")')
    expect(context).toContain('Added a title.')
    expect(context).toContain(source.replace(/\n/g, '\\n').replace(/"/g, '\\"'))
    expect(JSON.parse(context).previewProblems).toEqual(input.previewProblems)
  })
  it('sends the preview\'s errors before its warnings, once each and bounded', () => {
    const at = (severity: 'error' | 'warning' | 'info', message: string) => ({ severity, message, code: 'unsupported_swiftui_modifier' as const, span: { file: 'Sources/App.swift', start: 0, end: 1 } })
    const problems = promptPreviewContext([at('warning', 'Not drawn.'), at('info', 'Just so you know.'), at('error', 'Cannot find X.'), at('warning', 'Not drawn.'), ...Array.from({ length: 60 }, (_, i) => at('warning', `Warning ${i}`))])
    expect(problems.slice(0, 2)).toEqual([{ severity: 'error', file: 'Sources/App.swift', message: 'Cannot find X.' }, { severity: 'warning', file: 'Sources/App.swift', message: 'Not drawn.' }])
    expect(problems).toHaveLength(40)
    expect(problems.some(problem => problem.message === 'Just so you know.')).toBe(false)
    expect(parsePromptEditInput({ ...input, previewProblems: undefined }).previewProblems).toEqual([])
    expect(() => parsePromptEditInput({ ...input, previewProblems: [{ severity: 'info', file: '', message: 'x' }] })).toThrow('preview problems')
    expect(() => parsePromptEditInput({ ...input, previewProblems: Array(41).fill(input.previewProblems[0]) })).toThrow('preview problems')
  })
  it.each(['../App.swift', '/App.swift', 'Sources/../App.swift', 'Sources/App.ts'])('rejects unsafe result path %s', path => {
    expect(() => parsePromptEditResult({ ...edit, files: [{ ...edit.files[0], path }] })).toThrow()
  })
  it('rejects stale selections, source collisions and excessive history before requesting', () => {
    expect(() => parsePromptEditInput({ ...input, selection: { ...input.selection, end: 90000 } })).toThrow('out of date')
    expect(() => parsePromptEditInput({ ...input, files: [...input.files, { id: 'Sources/app.swift', text: source }] })).toThrow('conflicting')
    expect(() => parsePromptEditInput({ ...input, history: Array(25).fill(input.history[0]) })).toThrow('context')
  })
  it('rejects inconsistent deletions and never removes the final file', () => {
    expect(() => promptEditChanges(input.files, { ...edit, files: [], deletedFiles: ['Sources/Missing.swift'] })).toThrow('does not exist')
    expect(() => promptEditChanges(input.files, { ...edit, files: [], deletedFiles: ['Sources/App.swift'] })).toThrow('every source')
    expect(() => parsePromptEditResult({ ...edit, deletedFiles: ['Sources/App.swift'] })).toThrow('conflicting')
  })
  it('permits a concise answer without changing source', () => {
    expect(promptEditChanges(input.files, { reply: 'The title is inside the app’s main view.', files: [], deletedFiles: [] })).toEqual([])
  })
  it('compiles the edited candidate and keeps untouched files unchanged', () => {
    resetPipelineState()
    const project = { ...createDefaultProject(), files: [...input.files, { id: 'Sources/Notes.swift', text: '// keep this comment\r\n' }] }
    const prepared = preparePromptEdit(project, 4, edit)
    expect(prepared.candidate.files[1]).toBe(project.files[1])
    const result = compile({ files: prepared.candidate.files, canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 4 })
    expect(promptPreviewProblem(result)).toBeNull()
    expect(result.renderTree?.nodes.flatMap(node => node.text?.runs.map(run => run.text) ?? [])).toContain('After')
    const broken = compile({ files: [{ id: 'Sources/App.swift', text: 'import SwiftUI\n@main struct' }], canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 5 })
    expect(promptPreviewProblem(broken)).toContain('No changes applied')
  })
  it('applies additions, deletions and replacements in one undo while retaining the chat', async () => {
    await useStudio.getState().openFiles([...input.files.map(file => ({ name: file.id, text: file.text })), { name: 'Sources/Old.swift', text: '// old' }])
    const before = useStudio.getState().project!, user = message()
    expect(useStudio.getState().appendPromptMessages(before.id, [user])).toBeNull()
    const current = useStudio.getState(), project = current.project!
    const prepared = preparePromptEdit(project, current.documentRevision, { ...edit, files: [...edit.files, { path: 'Sources/New.swift', code: '// new' }], deletedFiles: ['Sources/Old.swift'] })
    expect(useStudio.getState().commitTransaction(project, prepared.transaction)).toBeNull()
    expect(useStudio.getState().project?.files.map(file => file.id)).toEqual(['Sources/App.swift', 'Sources/New.swift'])
    const assistant: PromptMessage = { ...message(edit.reply), role: 'assistant', status: 'applied' }
    useStudio.getState().appendPromptMessages(before.id, [assistant])
    useStudio.getState().replayDocument('undo')
    expect(useStudio.getState().project?.files).toEqual(before.files)
    expect(useStudio.getState().project?.chatHistory).toEqual([user, assistant])
    useStudio.getState().replayDocument('redo')
    expect(useStudio.getState().project?.files).toEqual(prepared.candidate.files)
    expect(useStudio.getState().project?.chatHistory).toEqual([user, assistant])
  })
  it('rejects a delayed edit after manual typing or a project switch', async () => {
    await useStudio.getState().openFiles(input.files.map(file => ({ name: file.id, text: file.text })))
    const current = useStudio.getState(), expected = current.project!
    const prepared = preparePromptEdit(expected, current.documentRevision, edit)
    useStudio.getState().setFileText(input.files[0]!.id, source.replace('Before', 'Manual'))
    expect(useStudio.getState().commitTransaction(expected, prepared.transaction)).toBeTruthy()
    expect(useStudio.getState().project?.files[0]?.text).toContain('Manual')
    await useStudio.getState().openFiles([{ name: 'Other.swift', text: '// other project' }])
    expect(useStudio.getState().appendPromptMessages(expected.id, [message()])).toBeTruthy()
    expect(useStudio.getState().project?.chatHistory).toBeUndefined()
  })
  it('validates persisted conversations without discarding old projects', () => {
    expect(normalizeProject(createDefaultProject()).chatHistory).toBeUndefined()
    expect(() => normalizeProject({ ...createDefaultProject(), chatHistory: [{ ...message(), createdAt: NaN }] })).toThrow('invalid')
  })
})

describe('edit endpoint', () => {
  it('uses OpenAI structured output without retaining responses or putting keys in the body', async () => {
    const fetch = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetch)
    const result = await POST(request())
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(await result.json()).toEqual({ edit })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(JSON.parse(init.body)).toMatchObject({ store: false, stream: true, text: { format: { type: 'json_schema', strict: true } } })
    expect(init.body).not.toContain(key)
  })
  it('supports Anthropic with the same validated edit contract', async () => {
    const fetch = vi.fn().mockResolvedValue(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(edit) } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } })); vi.stubGlobal('fetch', fetch)
    const result = await POST(request({ ...input, provider: 'anthropic', model: 'claude-sonnet-5' }))
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ edit })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/v1/messages')
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({ max_tokens: 24000, stream: true, output_config: { effort: 'medium', format: { type: 'json_schema' } } })
    expect(fetch.mock.calls[0]?.[1].body).not.toContain(key)
  })
  it('does not contact the provider for foreign origins, missing keys or oversized requests', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect((await POST(request(input, { Origin: 'https://elsewhere.test' }))).status).toBe(403)
    expect((await POST(request(input, { Authorization: '' }))).status).toBe(400)
    expect((await POST(request({ ...input, prompt: 'x'.repeat(2_500_001) }))).status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([401, 403, 429, 500])('sanitizes provider error %s without retrying', async status => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: key }, { status })); vi.stubGlobal('fetch', fetch)
    const result = await POST(request())
    expect(result.ok).toBe(false)
    expect(await result.text()).not.toContain(key)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each([
    [{ type: 'response.incomplete', response: { incomplete_details: null } }],
    [{ type: 'response.refusal.done', refusal: 'No' }, { type: 'response.completed', response: {} }],
    [{ type: 'response.output_text.delta', delta: 'not JSON' }, { type: 'response.completed', response: {} }],
    [{ type: 'response.output_text.delta', delta: JSON.stringify(edit) }],
  ])('rejects incomplete, refused or malformed output', async (...events) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse(...events)))
    const result = await POST(request())
    expect(result.status).toBe(422)
    expect(await result.json()).not.toHaveProperty('edit')
  })
  it.each([
    ['anthropic', { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, 'length limit'],
    ['openai', { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }, 'length limit'],
    ['anthropic', { type: 'message_delta', delta: { stop_reason: 'refusal' } }, 'declined'],
    ['openai', { type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } }, 'declined'],
  ] as const)('tells a %s edit that ran out of room from a declined one', async (provider, event, error) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse(event)))
    const result = await POST(request({ ...input, provider, model: provider === 'anthropic' ? 'claude-sonnet-5' : input.model }))
    expect(result.status).toBe(422)
    expect((await result.json()).error).toContain(error)
  })
  it('rejects output that deletes an unknown file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...edit, deletedFiles: ['Sources/Unknown.swift'] })))
    expect((await POST(request())).status).toBe(422)
  })
  it('propagates cancellation to the provider', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => { controller.abort(); expect(init.signal.aborted).toBe(true); throw new DOMException('Aborted', 'AbortError') }))
    expect((await POST(new Request(request(), { signal: controller.signal }))).status).toBe(499)
  })
})
