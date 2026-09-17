import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerRequests } from './workerRequests'

afterEach(() => vi.useRealTimers())
describe('compiler worker deadline', () => {
  it('returns successful calls and cancels their timers', async () => {
    vi.useFakeTimers()
    const stopped = vi.fn()
    const requests = new WorkerRequests(stopped)
    await expect(requests.run(async () => 'done')).resolves.toBe('done')
    expect(vi.getTimerCount()).toBe(0)
    expect(stopped).not.toHaveBeenCalled()
  })
  it('stops a hung worker once and rejects all queued requests', async () => {
    vi.useFakeTimers()
    const stopped = vi.fn()
    const requests = new WorkerRequests(stopped)
    const first = expect(requests.run(() => new Promise(() => {}))).rejects.toThrow('took too long')
    const queued = expect(requests.run(() => new Promise(() => {}))).rejects.toThrow('took too long')
    await vi.advanceTimersByTimeAsync(12000)
    await Promise.all([first, queued])
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    const invoke = vi.fn(async () => 1)
    await expect(requests.run(invoke)).rejects.toThrow('took too long')
    expect(invoke).not.toHaveBeenCalled()
  })
  it('settles pending calls on crashes and ignores late results', async () => {
    const stopped = vi.fn()
    const requests = new WorkerRequests(stopped)
    let finish!: (value: string) => void
    const pending = expect(requests.run(() => new Promise<string>(resolve => { finish = resolve }))).rejects.toThrow('crashed')
    requests.stop(new Error('crashed'))
    finish('obsolete')
    await pending
    expect(stopped).toHaveBeenCalledTimes(1)
  })
  it('disposes silently without leaving a timer or request behind', async () => {
    vi.useFakeTimers()
    const stopped = vi.fn()
    const requests = new WorkerRequests(stopped)
    const pending = expect(requests.run(() => new Promise(() => {}))).rejects.toThrow('closed')
    requests.stop(undefined, false)
    await pending
    expect(stopped).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
