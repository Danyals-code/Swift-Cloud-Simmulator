import { describe, expect, it } from 'vitest'
import type { PromptMessage } from '@studio/project-model'
import { clearDraft, loadDraft, saveDraft, type KeptDraft } from './draft'

/**
 * A Create with AI draft, kept for the tab until it is opened or thrown away (G13).
 * A draft takes minutes and is paid for, and it used to live only as long as the panel.
 *
 * The storage is a stand-in for the tab's sessionStorage.
 */

function standInStorage(): Storage {
  const items = new Map<string, string>()
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value) }, removeItem: key => { items.delete(key) } } as Storage
}

const history: PromptMessage[] = [{ id: 'm1', role: 'user', content: 'A quiet place to track reading.', createdAt: 1, provider: 'openai', model: 'gpt-test', kind: 'create' }]
const DRAFT: KeptDraft = {
  app: {
    name: 'ReadingApp', summary: 'A quiet place for your reading goals.',
    pages: [{ title: 'Reading', file: 'Sources/ReadingApp.swift' }],
    files: [{ path: 'Sources/ReadingApp.swift', code: 'import SwiftUI\n@main\nstruct ReadingApp: App { var body: some Scene { WindowGroup { Text("A chapter a day") } } }' }],
  },
  issues: ['Reading has a warning.'],
  history,
  stamp: { attempt: 2, sentAt: 1000, project: 'p1' },
}

describe('a Create with AI draft kept for the tab', () => {
  it('is kept until it is cleared', () => {
    const storage = standInStorage()

    saveDraft(DRAFT, storage)
    expect(loadDraft(storage)).toEqual(DRAFT)

    clearDraft(storage)
    expect(loadDraft(storage)).toBeNull()
  })

  it('is not there when what is kept is not a draft', () => {
    const storage = standInStorage()
    storage.setItem('studio.aiDraft', JSON.stringify({ ...DRAFT, app: { ...DRAFT.app, files: [] } }))

    expect(loadDraft(storage)).toBeNull()
  })

  it('throws nothing when the storage refuses it, which is then left as it was', () => {
    const storage = standInStorage()
    saveDraft(DRAFT, storage)
    const full = { ...storage, setItem: () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') } } as Storage

    expect(() => saveDraft({ ...DRAFT, issues: [] }, full)).not.toThrow()
    expect(loadDraft(storage)).toEqual(DRAFT)
  })
})
