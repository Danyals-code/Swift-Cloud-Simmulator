import { describe, expect, it } from 'vitest'
import { createConnectionStore, loadConnection, saveConnection } from './connection'
import { DEFAULT_MODELS } from './schema'

/**
 * The AI connection a tab keeps for both AI panels (G3): the provider, the model and
 * the key pasted for them, until the tab closes.
 *
 * The storage is a stand-in for the tab's sessionStorage.
 */

function standInStorage(): Storage {
  const items = new Map<string, string>()
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value) }, removeItem: key => { items.delete(key) } } as Storage
}

/** Storage the browser refuses, as a private window can. */
const refusing = { getItem: () => { throw new DOMException('The operation is insecure.', 'SecurityError') }, setItem: () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }, removeItem: () => {} } as unknown as Storage

describe('the AI connection a tab keeps', () => {
  it('starts with OpenAI, its default model and no key', () => {
    expect(loadConnection(standInStorage())).toEqual({ provider: 'openai', model: DEFAULT_MODELS.openai, key: '' })
  })

  it('keeps the provider, model and key for the tab', () => {
    const storage = standInStorage()

    saveConnection({ provider: 'anthropic', model: 'model-test', key: 'sk-ant-test-key' }, storage)

    expect(loadConnection(storage)).toEqual({ provider: 'anthropic', model: 'model-test', key: 'sk-ant-test-key' })
  })

  it('is one connection for both panels: a change made in one is there for the other, and kept for the tab', () => {
    const storage = standInStorage()
    const connection = createConnectionStore(storage)

    connection.getState().setKey('sk-test-key')
    connection.getState().setModel('model-test')

    expect(connection.getState().connection).toEqual({ provider: 'openai', model: 'model-test', key: 'sk-test-key' })
    expect(loadConnection(storage)).toEqual({ provider: 'openai', model: 'model-test', key: 'sk-test-key' })
  })

  it('gives another provider its own default model, and no key, since a key belongs to one provider', () => {
    const connection = createConnectionStore(standInStorage())
    connection.getState().setKey('sk-test-key')

    connection.getState().chooseProvider('anthropic')

    expect(connection.getState().connection).toEqual({ provider: 'anthropic', model: DEFAULT_MODELS.anthropic, key: '' })
  })

  it('starts over when what is kept is not a connection, and throws nothing when the storage refuses', () => {
    const storage = standInStorage()
    storage.setItem('studio.aiConnection', JSON.stringify({ provider: 'someone-else', model: 7, key: 'x' }))

    expect(loadConnection(storage)).toEqual({ provider: 'openai', model: DEFAULT_MODELS.openai, key: '' })
    expect(() => saveConnection({ provider: 'openai', model: 'model-test', key: 'sk-test-key' }, refusing)).not.toThrow()
    expect(loadConnection(refusing)).toEqual({ provider: 'openai', model: DEFAULT_MODELS.openai, key: '' })
  })
})
