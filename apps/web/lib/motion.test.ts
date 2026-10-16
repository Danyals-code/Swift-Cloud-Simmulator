import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import { actionStatement, animationWords } from './motion'

describe('a tap action as When tapped reads it (Wave 5a)', () => {
  it('reads the statement inside withAnimation when the action animates', () => {
    expect(actionStatement('{\n    withAnimation(.spring) {\n        expanded.toggle()\n    }\n}', true)).toBe('expanded.toggle()')
    expect(actionStatement('{ withAnimation { count = 2 } }', true)).toBe('count = 2')
    expect(actionStatement('{ withAnimation(.easeInOut(duration: 0.4)) { showDetails.toggle() } }', true)).toBe('showDetails.toggle()')
  })

  it('leaves an action that does not animate as it is written', () => {
    expect(actionStatement('{\n    showDetails.toggle()\n}', false)).toBe('showDetails.toggle()')
    expect(actionStatement(undefined, false)).toBe('')
  })

  it('reads what an animated tap does, and how it animates, as the authoring model reads the Button', () => {
    const text = 'import SwiftUI\nstruct ContentView: View {\n    @State private var expanded = false\n    var body: some View {\n        Button("Expand") {\n            withAnimation(.smooth) {\n                expanded.toggle()\n            }\n        }\n    }\n}\n'
    const behavior = buildAuthoringModel({ projectId: 'p', revision: 1, files: [{ id: 'App.swift', text }] }).nodes.find(node => node.name === 'Button')!.behavior!
    expect(behavior.animation && animationWords(behavior.animation)).toBe('Smooth')
    expect(actionStatement(behavior.currentAction, !!behavior.animation)).toBe('expanded.toggle()')
  })

  it('names the animation with Apple’s words, its duration when it has one, and a curve Design does not name as written', () => {
    expect(animationWords({ style: 'smooth', written: '.smooth' })).toBe('Smooth')
    expect(animationWords({ style: 'default', written: '' })).toBe('Default')
    expect(animationWords({ style: 'easeInOut', duration: 0.4, written: '.easeInOut(duration: 0.4)' })).toBe('Ease in and out, 0.4 s')
    expect(animationWords({ style: null, written: '.spring(response: 0.4)' })).toBe('.spring(response: 0.4)')
  })
})
