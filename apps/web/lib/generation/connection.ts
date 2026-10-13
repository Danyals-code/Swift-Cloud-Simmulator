import { create } from 'zustand'
import { keep, readKept, tabStorage } from '../tabStorage'
import { DEFAULT_MODELS, type Provider } from './schema'

/** The AI connection a tab keeps for both AI panels (G3): the provider, the model and the key pasted for them. */
export interface AiConnection {
  readonly provider: Provider
  readonly model: string
  readonly key: string
}

const CONNECTION_KEY = 'studio.aiConnection'
const DEFAULT_CONNECTION: AiConnection = { provider: 'openai', model: DEFAULT_MODELS.openai, key: '' }

/** The connection this tab has, or OpenAI with its default model and no key. */
export function loadConnection(storage: Storage | null = tabStorage()): AiConnection {
  const kept = readKept(storage, CONNECTION_KEY)
  if (typeof kept !== 'object' || kept === null) return DEFAULT_CONNECTION
  const { provider, model, key } = kept as Record<string, unknown>
  if ((provider !== 'openai' && provider !== 'anthropic') || typeof model !== 'string' || typeof key !== 'string') return DEFAULT_CONNECTION
  return { provider, model, key }
}

/** Keeps the connection until the tab closes. */
export function saveConnection(connection: AiConnection, storage: Storage | null = tabStorage()): void {
  keep(storage, CONNECTION_KEY, connection)
}

export interface ConnectionState {
  readonly connection: AiConnection
  /** Another provider: its default model, and no key, since a key belongs to one provider. */
  chooseProvider(provider: Provider): void
  setModel(model: string): void
  setKey(key: string): void
}

/**
 * One connection for both AI panels, kept for the tab.
 *
 * Prompt Editing stays mounted behind its tab, so each panel reading the storage when it
 * opened was not enough: a key pasted in Create with AI never reached it, and changing
 * its model saved no key over the one pasted.
 */
export function createConnectionStore(storage: Storage | null = tabStorage()) {
  return create<ConnectionState>((set, get) => {
    const change = (connection: AiConnection) => {
      saveConnection(connection, storage)
      set({ connection })
    }
    return {
      connection: loadConnection(storage),
      chooseProvider: provider => {
        if (provider !== get().connection.provider) change({ provider, model: DEFAULT_MODELS[provider], key: '' })
      },
      setModel: model => change({ ...get().connection, model }),
      setKey: key => change({ ...get().connection, key }),
    }
  })
}

/** This tab's connection. */
export const useAiConnection = createConnectionStore()
