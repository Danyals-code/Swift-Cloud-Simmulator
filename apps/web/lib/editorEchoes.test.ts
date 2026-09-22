import { describe, expect, it } from 'vitest'
import { EditorEchoes } from './editorEchoes'

describe('text handed back to the code editor', () => {
  it('is not news when it is the editor’s own earlier text arriving after newer typing', () => {
    const echoes = new EditorEchoes()
    echoes.sent('Text("a')
    echoes.sent('Text("ab')
    expect(echoes.isNews('Text("a', 'Text("ab')).toBe(false)
  })

  it('is news when Undo returns to earlier typing after the store has caught up', () => {
    const echoes = new EditorEchoes()
    echoes.sent('Text("a')
    echoes.sent('Text("ab')
    expect(echoes.isNews('Text("ab', 'Text("ab')).toBe(false)
    expect(echoes.isNews('Text("a', 'Text("ab')).toBe(true)
  })

  it('is not news when the editor already shows it', () => {
    expect(new EditorEchoes().isNews('Text("hi")', 'Text("hi")')).toBe(false)
  })

  it('is news again once it is too old to be an echo, so unanswered typing cannot pile up', () => {
    const echoes = new EditorEchoes()
    for (let i = 0; i < 40; i++) echoes.sent(`draft ${i}`)
    expect(echoes.isNews('draft 0', 'draft 39')).toBe(true)
    expect(echoes.isNews('draft 30', 'draft 39')).toBe(false)
  })
})
