import { describe, expect, it } from 'vitest'
import type { RenderTree } from '@studio/shared'
import { phoneView } from './phoneView'

/**
 * What the phone shows while the code can't run.
 *
 * A half-typed line or an AI draft with an error used to replace the phone with a
 * notice card. The last screen that ran stays up instead, dimmed, with the notice
 * over it, which is what a designer mid-edit wants to keep looking at.
 */
describe('what the phone shows', () => {
  const ran: RenderTree = { canvas: { width: 402, height: 874 }, nodes: [], revision: 1 }
  const errors: RenderTree = { canvas: { width: 402, height: 874 }, nodes: [], revision: 2, notice: { title: '1 error', detail: "Expected ')'" } }

  it('keeps the last screen that ran, dimmed, under the notice', () => {
    expect(phoneView(errors, ran)).toEqual({ tree: ran, dimmed: true, notice: errors.notice })
  })

  it('shows the notice itself when nothing has run yet', () => {
    expect(phoneView(errors, null)).toEqual({ tree: errors, dimmed: false })
  })

  it('shows a screen that ran as it is', () => {
    expect(phoneView(ran, ran)).toEqual({ tree: ran, dimmed: false })
  })

  it('keeps the screen, dimmed, when the preview itself stopped, and says how to start it again', () => {
    const view = phoneView(ran, ran, 'The preview took too long and was stopped.')
    expect(view).toMatchObject({ tree: ran, dimmed: true, stopped: true })
    expect(view.notice).toEqual({
      title: 'Preview stopped',
      detail: 'The preview took too long and was stopped. Tap the phone, edit the code or press Reset to start it again.',
    })
    // A stop while the code has errors still shows the last screen that ran.
    expect(phoneView(errors, ran, 'The compiler worker was closed.').tree).toBe(ran)
  })
})
