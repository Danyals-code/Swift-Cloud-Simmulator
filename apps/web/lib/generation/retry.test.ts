import { describe, expect, it, vi } from 'vitest'
import { answerWithOneRetry, UnusableAnswer } from './retry'

/**
 * Asking the AI once more when its answer fails the preview (G2). The problems the
 * first answer brought go with the second request, and the second answer is the last.
 */

const broken = [{ message: "Cannot find 'Theme' in scope." }]

describe('an AI answer with one retry', () => {
  it('uses a first answer the preview finds nothing wrong with, asking once', async () => {
    const ask = vi.fn(async () => 'first answer')
    const retrying = vi.fn()

    const result = await answerWithOneRetry({ ask, check: async () => [], retrying })

    expect(result).toEqual({ answer: 'first answer', problems: [] })
    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(null)
    expect(retrying).not.toHaveBeenCalled()
  })

  it('asks once more with the problems the first answer brought, and uses a second answer the preview finds nothing wrong with', async () => {
    const ask = vi.fn(async (previous: unknown) => previous ? 'second answer' : 'first answer')
    const retrying = vi.fn()

    const result = await answerWithOneRetry({ ask, check: async answer => answer === 'first answer' ? broken : [], retrying })

    expect(result).toEqual({ answer: 'second answer', problems: [] })
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask).toHaveBeenLastCalledWith({ problems: broken })
    expect(retrying).toHaveBeenCalledWith(broken)
  })

  it('tells the second request only as many problems as a request carries', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ message: `Problem ${i + 1}` }))
    const ask = vi.fn(async (previous: unknown) => previous ? 'second answer' : 'first answer')

    await answerWithOneRetry({ ask, check: async answer => answer === 'first answer' ? many : [], retrying: () => {} })

    expect(ask).toHaveBeenLastCalledWith({ problems: many.slice(0, 8) })
  })

  it('stops at the second answer, with what is still wrong with it', async () => {
    const ask = vi.fn(async (previous: unknown) => previous ? 'second answer' : 'first answer')

    const result = await answerWithOneRetry({ ask, check: async answer => [{ message: `${answer} does not build` }], retrying: () => {} })

    expect(result).toEqual({ answer: 'second answer', problems: [{ message: 'second answer does not build' }] })
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('asks once more when an answer could not be used, saying why', async () => {
    const ask = vi.fn(async (previous: unknown) => {
      if (!previous) throw new UnusableAnswer('The app has 5 pages, and 3 were asked for.')
      return 'second answer'
    })

    const result = await answerWithOneRetry({ ask, check: async () => [], retrying: () => {} })

    expect(result).toEqual({ answer: 'second answer', problems: [] })
    expect(ask).toHaveBeenLastCalledWith({ problems: [{ message: 'The app has 5 pages, and 3 were asked for.' }] })
  })

  it.each([
    ['fails', new Error('Too many AI requests came from this network.')],
    ['comes back unusable', new UnusableAnswer('The provider returned an unreadable project.')],
  ])('keeps the paid first answer, with its problems and why, when the second request %s', async (_case, failure) => {
    const ask = vi.fn(async (previous: unknown) => {
      if (previous) throw failure
      return 'first answer'
    })

    const result = await answerWithOneRetry({ ask, check: async () => broken, retrying: () => {} })

    expect(result).toEqual({ answer: 'first answer', problems: broken, secondTryFailed: failure })
  })

  it('has nothing to keep when the first answer could not be used and the second request fails too', async () => {
    const failure = new Error('The provider is unavailable.')
    const ask = vi.fn(async (previous: unknown) => {
      throw previous ? failure : new UnusableAnswer('The provider returned an unreadable project.')
    })

    await expect(answerWithOneRetry({ ask, check: async () => [], retrying: () => {} })).rejects.toBe(failure)
  })

  it('keeps nothing when the second request is cancelled, as the participant asked', async () => {
    const cancelled = new DOMException('Cancelled', 'AbortError')
    const ask = vi.fn(async (previous: unknown) => {
      if (previous) throw cancelled
      return 'first answer'
    })

    await expect(answerWithOneRetry({ ask, check: async () => broken, retrying: () => {} })).rejects.toBe(cancelled)
  })

  it.each([
    ['a rejected key', new Error('Check your API key and model access.')],
    ['a cancelled request', new DOMException('Cancelled', 'AbortError')],
  ])('does not ask again after %s, which a second request would not change', async (_case, failure) => {
    const ask = vi.fn(async () => { throw failure })

    await expect(answerWithOneRetry({ ask, check: async () => [], retrying: () => {} })).rejects.toBe(failure)
    expect(ask).toHaveBeenCalledOnce()
  })
})
