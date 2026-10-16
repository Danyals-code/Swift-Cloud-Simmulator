import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import type { AuthoringNode, DesignControl } from '@studio/shared'
import { variantCases, copyColor, differsChoices, exposeChoices } from './componentInputs'

/**
 * What a Main offers to change per copy, what a copy's inputs are drawn as, and what a
 * value in the Main can differ by (Wave 5b). The Swift a copy writes is the planner's;
 * these say only what the panel offers and how it reads a value back.
 */

const source = `import SwiftUI
@main struct PillApp: App { var body: some Scene { WindowGroup { Home() } } }
struct Pill: View {
  var title: String
  var body: some View {
    HStack {
      Image(systemName: "star")
      Image("photo1")
      Text("Hello").foregroundStyle(Color.white).font(.title)
    }
    .padding(8)
    .background(Color.blue)
  }
}
struct Home: View {
  var body: some View {
    VStack {
      Pill(title: "One")
      Pill(title: "Two")
    }
  }
}`
const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files: [{ id: 'App.swift', text: source }] })
const inMain = (name: string, nth = 0) => snapshot.nodes.filter(node => node.owner === 'Pill' && node.name === name)[nth]!
const kinds = (node: AuthoringNode) => exposeChoices(node).map(choice => [choice.as, choice.control])

describe('Changeable per copy', () => {
  it('offers what the view has: its text, then whether it is shown', () => {
    expect(kinds(inMain('Text'))).toEqual([['text', 'content'], ['color', 'modifier:0:0'], ['shown', '']])
  })

  it('offers a symbol as a symbol and a bundled image as an image', () => {
    expect(kinds(inMain('Image', 0))).toEqual([['symbol', 'image'], ['shown', '']])
    expect(kinds(inMain('Image', 1))).toEqual([['image', 'image'], ['shown', '']])
  })

  it('offers a colour and a number written on the view, and never one the view does not have yet', () => {
    expect(kinds(inMain('HStack'))).toEqual([['color', 'modifier:1:0'], ['number', 'modifier:0:0'], ['shown', '']])
  })

  it('lists each choice by its kind and what it is now', () => {
    expect(exposeChoices(inMain('Text')).map(choice => choice.label)).toEqual(['Text · Hello', 'Color · foregroundStyle', 'Shown'])
    expect(exposeChoices(inMain('Image', 0)).map(choice => choice.label)).toEqual(['Symbol · star', 'Shown'])
    expect(exposeChoices(inMain('Image', 1)).map(choice => choice.label)).toEqual(['Image · photo1', 'Shown'])
  })

  it('offers no Shown for the Main itself, which a copy shows or not where it is called', () => {
    const main = snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'Pill')!
    expect(exposeChoices(main).map(choice => choice.as)).not.toContain('shown')
  })
})

const control = (fields: Partial<DesignControl>): DesignControl => ({ id: 'component:icon', source: { file: 'App.swift', start: 0, end: 0 }, label: 'icon', kind: 'text', value: 'star', scope: 'This component instance', description: '', ...fields })

describe('a copy’s inputs', () => {
  it('read a colour as the colour field shows it: a system colour, a hex with its alpha, or a token', () => {
    expect(copyColor('red')).toEqual({ name: 'red' })
    expect(copyColor('#0A84FF')).toEqual({ hex: '#0A84FF' })
    expect(copyColor('#0A84FF80')).toEqual({ hex: '#0A84FF', opacity: 0.502 })
    expect(copyColor('Color.brand')).toEqual({ token: 'Color.brand' })
    expect(copyColor('Theme.accent')).toEqual({ token: 'Theme.accent' })
    expect(copyColor('')).toBeNull()
  })
})

describe('Variants', () => {
  it('let a value written in the Main differ, and not one that already does or that is not written yet', () => {
    expect(differsChoices(inMain('HStack')).map(choice => [choice.control, choice.label])).toEqual([['modifier:0:0', 'padding'], ['modifier:1:0', 'background']])
    expect(differsChoices(inMain('Text')).map(choice => choice.control)).toEqual(['content', 'modifier:0:0'])
    const ternary = { ...inMain('HStack'), controls: [control({ id: 'modifier:1:0:then', label: 'background · When Primary', kind: 'select', value: 'blue' })] }
    expect(differsChoices(ternary)).toEqual([])
  })
})

describe('a value that differs by a variant', () => {
  const variants = [{ name: 'style', cases: ['primary', 'secondary'] as const }, { name: 'size', cases: ['regular', 'extraLarge'] as const }]

  it('names its two sides by the cases they are for', () => {
    expect(variantCases('style == .primary', variants)).toEqual({ then: 'Primary', otherwise: 'Secondary' })
    expect(variantCases('self.size == .regular', variants)).toEqual({ then: 'Regular', otherwise: 'Extra large' })
    expect(variantCases('style == Style.primary', variants)).toEqual({ then: 'Primary', otherwise: 'Secondary' })
  })

  it('names nothing for any other condition, which keeps If and Else', () => {
    expect(variantCases('isOn', variants)).toBeUndefined()
    expect(variantCases('style == .tertiary', variants)).toBeUndefined()
    expect(variantCases('kind == .primary', variants)).toBeUndefined()
    expect(variantCases('style == .primary', undefined)).toBeUndefined()
  })

})
