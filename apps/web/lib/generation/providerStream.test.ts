import { afterEach, describe, expect, it, vi } from 'vitest'
import { readProviderStream, streamDeadline } from './providerStream'

/** A body that arrives in exactly these pieces, the way a network splits it. */
const chunked = (...pieces: string[]) => new ReadableStream<Uint8Array>({ start(controller) { for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece)); controller.close() } })
const event = (data: object, newline = '\n') => `event: ${(data as { type: string }).type}${newline}data: ${JSON.stringify(data)}${newline}${newline}`
afterEach(() => vi.useRealTimers())

describe('provider event streams', () => {
  it('joins Anthropic text across split chunks and skips thinking', async () => {
    const stream = event({ type: 'message_start', message: {} })
      + event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })
      + event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'secret plan' } })
      + event({ type: 'ping' })
      + event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '{"name":' } })
      + event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '"Trips é"}' } })
      + event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })
    const bytes = new TextEncoder().encode(stream)
    // Split mid-event and mid-character, so neither lines nor UTF-8 sequences arrive whole.
    const cut = stream.indexOf('é') + 1, alive = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 50)); c.enqueue(bytes.slice(50, cut)); c.enqueue(bytes.slice(cut)); c.close() } })
    expect(await readProviderStream(body, alive)).toEqual({ text: '{"name":"Trips é"}', stop: 'done' })
    expect(alive).toHaveBeenCalledTimes(3)
  })
  it('reads CRLF-delimited OpenAI events', async () => {
    const body = chunked(event({ type: 'response.output_text.delta', delta: '{}' }, '\r\n'), event({ type: 'response.completed', response: {} }, '\r\n'))
    expect(await readProviderStream(body, () => {})).toEqual({ text: '{}', stop: 'done' })
  })
  it.each([
    [[{ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }], 'length'],
    [[{ type: 'message_delta', delta: { stop_reason: 'model_context_window_exceeded' } }], 'length'],
    [[{ type: 'message_delta', delta: { stop_reason: 'refusal' } }], 'declined'],
    [[{ type: 'message_delta', delta: { stop_reason: 'pause_turn' } }], 'unfinished'],
    [[{ type: 'error', error: { type: 'overloaded_error' } }], 'unfinished'],
    [[{ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }], 'length'],
    [[{ type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } }], 'declined'],
    [[{ type: 'response.refusal.done', refusal: 'No' }, { type: 'response.completed', response: {} }], 'declined'],
    [[{ type: 'response.failed', response: {} }], 'unfinished'],
    [[{ type: 'response.output_text.delta', delta: '{}' }], 'unfinished'],
  ] as const)('reports %j as %s', async (events, stop) => {
    expect((await readProviderStream(chunked(...events.map(e => event(e))), () => {})).stop).toBe(stop)
  })
  it('treats a malformed event or an empty body as unfinished', async () => {
    expect((await readProviderStream(chunked('data: {broken\n\n', event({ type: 'response.completed', response: {} })), () => {})).stop).toBe('unfinished')
    expect(await readProviderStream(null, () => {})).toEqual({ text: '', stop: 'unfinished' })
  })
})

describe('stream deadline', () => {
  it('aborts only after the provider has been quiet for the whole window', () => {
    vi.useFakeTimers()
    const deadline = streamDeadline(new AbortController().signal, 60000, 1000)
    vi.advanceTimersByTime(900); deadline.alive()
    vi.advanceTimersByTime(900)
    expect(deadline.signal.aborted).toBe(false)
    vi.advanceTimersByTime(200)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.expired()).toBe(true)
  })
  it('passes cancellation through without counting it as a timeout, and stops its timer', () => {
    vi.useFakeTimers()
    const cancel = new AbortController(), deadline = streamDeadline(cancel.signal, 60000, 1000)
    cancel.abort()
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.expired()).toBe(false)
    deadline.stop()
    vi.advanceTimersByTime(2000)
    expect(deadline.expired()).toBe(false)
  })
})
