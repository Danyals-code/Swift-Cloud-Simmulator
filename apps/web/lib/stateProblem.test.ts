import { describe, expect, it } from 'vitest'
import type { Diagnostic } from '@studio/shared'
import { stateProblem } from './stateProblem'

/** What a state phone on the canvas says when it can't show its state. */
describe("the note on a state phone", () => {
  const at = { file: 'App.swift', start: 0, end: 1 }
  const syntax: Diagnostic = { severity: 'error', code: 'expected_token', message: "Expected ')'", span: at }
  const trap: Diagnostic = { severity: 'error', code: 'runtime_trap', message: 'Swift runtime failure: Index out of range', span: at }

  it('says the code has errors when they keep the state from being drawn', () => {
    expect(stateProblem({ page: 'Home', compiled: true, diagnostics: [syntax], drawn: false, stale: false })).toBe('This state cannot be drawn while the code has errors.')
  })

  it('says nothing when the state is drawn, a view in it stopped included', () => {
    expect(stateProblem({ page: 'Home', compiled: true, diagnostics: [trap], drawn: true, stale: false })).toBeNull()
  })

  it('says the worker stopped before anything else', () => {
    expect(stateProblem({ page: 'Home', compiled: true, diagnostics: [syntax], drawn: false, stale: false, workerError: 'The preview took too long' })).toBe('The preview took too long')
  })

  it('says nothing before the first compile', () => {
    expect(stateProblem({ page: 'Home', compiled: false, diagnostics: [], drawn: false, stale: false })).toBeNull()
  })

  it('says the state no longer matches its screen when it has no page to draw', () => {
    expect(stateProblem({ page: 'Home', compiled: true, diagnostics: [], drawn: false, stale: false })).toBe('This state no longer matches Home. Open Screen › States to change or remove it.')
  })
})
