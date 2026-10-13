/** Why a provider stopped: it finished, ran out of output room, declined, or anything else. */
export type ProviderStop = 'done' | 'length' | 'declined' | 'unfinished'

const ANTHROPIC_STOPS: Record<string, ProviderStop> = { end_turn: 'done', max_tokens: 'length', model_context_window_exceeded: 'length', refusal: 'declined' }

/**
 * Reads an Anthropic Messages or OpenAI Responses event stream into the answer's text and why it stopped.
 * The two providers' event names do not overlap. Thinking and reasoning events are skipped.
 * `onData` runs for every chunk, so the caller can tell a stalled stream from a long one.
 */
export async function readProviderStream(body: ReadableStream<Uint8Array> | null, onData: () => void): Promise<{ text: string; stop: ProviderStop }> {
  let text = '', stop: ProviderStop = 'unfinished', declined = false, broken = false
  const handle = (raw: string) => {
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
    if (!data || data === '[DONE]') return
    let event
    try { event = JSON.parse(data) } catch { broken = true; return }
    switch (event.type) {
      case 'content_block_delta': if (event.delta?.type === 'text_delta') text += event.delta.text; break
      case 'message_delta': stop = ANTHROPIC_STOPS[event.delta?.stop_reason] ?? 'unfinished'; break
      case 'response.output_text.delta': text += event.delta; break
      case 'response.refusal.delta': case 'response.refusal.done': declined = true; break
      case 'response.completed': stop = 'done'; break
      case 'response.incomplete': {
        const reason = event.response?.incomplete_details?.reason
        stop = reason === 'max_output_tokens' ? 'length' : reason === 'content_filter' ? 'declined' : 'unfinished'
        break
      }
      case 'error': case 'response.failed': broken = true; break
    }
  }
  if (body) {
    const reader = body.getReader(), decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      onData()
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''
      events.forEach(handle)
    }
    handle(buffer + decoder.decode())
  }
  return { text, stop: declined ? 'declined' : broken ? 'unfinished' : stop }
}

/**
 * Aborts on cancellation, at the route's hard limit, or once the provider has sent nothing for `quietMs`.
 * Call `alive` whenever data arrives and `stop` when the request is over.
 */
export function streamDeadline(cancel: AbortSignal, limitMs: number, quietMs: number) {
  const limit = AbortSignal.timeout(limitMs), quiet = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const alive = () => { clearTimeout(timer); timer = setTimeout(() => quiet.abort(), quietMs) }
  alive()
  return { signal: AbortSignal.any([cancel, limit, quiet.signal]), alive, expired: () => limit.aborted || quiet.signal.aborted, stop: () => clearTimeout(timer) }
}
