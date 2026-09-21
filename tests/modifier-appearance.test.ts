import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { colorForName, compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { DesignEditRequest } from '@studio/shared'
import { modifierGuidance } from '../apps/web/lib/modifierGuidance'
import { SYSTEM_COLOR_SWATCHES } from '../apps/web/lib/tokens'

const wrap = (body: string) => `import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { var body: some View { ${body} } }`
const files = (text: string) => [{ id: 'App.swift', text }]
const model = (text: string) => buildAuthoringModel({ projectId: 'appearance', revision: 1, files: files(text) })
const node = (text: string, name = 'Text') => model(text).nodes.find(item => item.name === name && item.kind !== 'definition')!
function edit(text: string, operation: DesignEditRequest['operation'], name = 'Text') {
  const selected = node(text, name)
  const plan = planDesignEdit({ projectId: 'appearance', baseRevision: 1, files: files(text), scope: selected.owner, target: selected.source, fingerprint: selected.fingerprint, operation })
  if (!plan.ok) throw new Error(plan.reason)
  expect(plan.changes).toHaveLength(1)
  expect(plan.changes[0]!.before).toBe(text)
  return plan.changes[0]!.after
}
function draw(text: string) {
  const result = compile({ projectId: 'appearance', revision: 1, files: files(text), canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
  return result.renderTree!.nodes
}
beforeEach(resetPipelineState)

describe('modifier appearance is visible and editable', () => {
  it('shows the same system swatches that the preview renders', () => {
    for (const [name, hex] of Object.entries(SYSTEM_COLOR_SWATCHES)) {
      const color = colorForName(name)!
      expect(color, name).not.toBeNull()
      const actual = '#' + [color.r, color.g, color.b, ...(color.a < 1 ? [Math.round(color.a * 255)] : [])].map(channel => channel.toString(16).padStart(2, '0')).join('')
      expect(actual.toUpperCase(), name).toBe(hex)
    }
    expect(colorForName('tertiarySystemGroupedBackground', 'dark')).toEqual({ r: 44, g: 44, b: 46, a: 1 })
  })
  it.each([8, 24, 40])('draws the contextual rectangle with radius %s', radius => {
    const text = wrap(`Text("Card").frame(width: 160, height: 100).background(Color.blue).clipShape(.rect(cornerRadius: ${radius}))`)
    expect(draw(text).some(item => item.cornerRadius === radius && item.clipShape?.kind === 'roundedRectangle')).toBe(true)
  })
  it.each(['circle', 'capsule', 'ellipse'])('honors the contextual %s clip', shape => {
    expect(draw(wrap(`Text("Card").frame(width: 160, height: 100).background(Color.blue).clipShape(.${shape})`)).some(item => item.clipShape?.kind === shape)).toBe(true)
  })
  it('edits a radius without losing the continuous corner style', () => {
    const text = wrap('Text("Card").padding(16).background(Color.blue).clipShape(.rect(cornerRadius: 12, style: .continuous))')
    const control = node(text).controls!.find(item => item.id.endsWith(':cornerRadius'))!
    expect(control).toBeDefined()
    const changed = edit(text, { kind: 'property', control: control.id, value: '30' })
    expect(changed).toContain('.rect(cornerRadius: 30, style: .continuous)')
    expect(draw(changed).some(item => item.cornerRadius === 30 && item.clipShape?.cornerStyle === 'continuous')).toBe(true)
  })
  it('exposes the default system surface as an editable color', () => {
    const text = wrap('Text("Card").background(Color(.secondarySystemBackground))')
    const style = node(text).styles!.find(item => item.kind === 'color')!
    expect(style.value).toBe('secondarySystemBackground')
    const changed = edit(text, { kind: 'style-local', property: style.property, value: '#123456' })
    expect(changed).toContain('Color(red: 0.071, green: 0.204, blue: 0.337)')
    draw(changed)
  })
  it('changes translucent background color and opacity independently', () => {
    let text = wrap('Text("Card").padding(16).background(Color.red.opacity(0.15))')
    const selected = node(text), modifier = selected.modifiers![1]!
    expect(modifier.controls.map(control => control.value)).toEqual(['red', '0.15'])
    const style = selected.styles!.find(item => item.kind === 'color')!
    text = edit(text, { kind: 'style-local', property: style.property, value: '#123456' })
    expect(text).toContain('Color(red: 0.071, green: 0.204, blue: 0.337).opacity(0.15)')
    const opacity = node(text).controls!.find(control => control.id.endsWith(':opacity'))!
    text = edit(text, { kind: 'property', control: opacity.id, value: '0.65' })
    expect(draw(text).some(item => item.background?.kind === 'solid' && item.background.color.a === 0.65)).toBe(true)
  })
  it('exposes shadow color and opacity, leaving radius and offset untouched', () => {
    const text = wrap('Text("Card").shadow(color: Color.black.opacity(0.15), radius: 8, x: 0, y: 4)')
    const style = node(text).styles!.find(item => item.kind === 'color')!
    expect(style).toBeDefined()
    const changed = edit(text, { kind: 'style-local', property: style.property, value: 'blue' })
    expect(changed).toContain('.shadow(color: Color.blue.opacity(0.15), radius: 8, x: 0, y: 4)')
    draw(changed)
  })
  it('recognizes RGB colors regardless of whitespace', () => {
    expect(node(wrap('Text("Card").background(Color(red:1,green:0,blue:0))')).styles?.find(item => item.kind === 'color')?.value).toBe('#ff0000')
  })
})

describe('native card modifier edits', () => {
  it('applies a background edit to the visible card, preserving its clipping modifier', () => {
    const text = wrap('GroupBox("Title") { Text("Body") }.background(Color.blue).clipShape(.rect(cornerRadius: 20))')
    const control = node(text, 'GroupBox').modifiers![0]!.controls[0]!
    const changed = edit(text, { kind: 'property', control: control.id, value: 'red' }, 'GroupBox')
    expect(changed).not.toContain('GroupBox(')
    expect(changed).not.toContain('secondarySystemBackground')
    expect(changed).not.toContain('.cornerRadius(8)')
    expect(changed).toContain('.background(Color.red).clipShape(.rect(cornerRadius: 20))')
    expect(draw(changed).some(item => item.cornerRadius === 20)).toBe(true)
  })
  it('materializes a radius edit and never introduces a competing default clip', () => {
    const text = wrap('GroupBox("Title") { Text("Body") }.clipShape(.rect(cornerRadius: 12))')
    const control = node(text, 'GroupBox').modifiers![0]!.controls[0]!
    const changed = edit(text, { kind: 'property', control: control.id, value: '36' }, 'GroupBox')
    expect(changed).toContain('Color(.secondarySystemBackground)')
    expect(changed).not.toContain('.cornerRadius(8)')
    expect(draw(changed).some(item => item.cornerRadius === 36)).toBe(true)
  })
  it('adding Background to a standard card makes the blue surface visible in one edit', () => {
    const changed = edit(wrap('GroupBox("Title") { Text("Body") }'), { kind: 'modifier-add', name: 'background' }, 'GroupBox')
    expect(changed).toContain('.background(Color.blue)')
    expect(changed).not.toContain('GroupBox(')
    expect(changed).not.toContain('secondarySystemBackground')
    draw(changed)
  })
  it('retains an existing translucent color while editing a card radius', () => {
    const text = wrap('GroupBox("Title") { Text("Body") }.background(Color.red.opacity(0.3)).cornerRadius(12)')
    const radius = node(text, 'GroupBox').modifiers![1]!.controls[0]!
    const changed = edit(text, { kind: 'property', control: radius.id, value: '24' }, 'GroupBox')
    expect(changed).toContain('.background(Color.red.opacity(0.3)).cornerRadius(24)')
    expect(changed.match(/cornerRadius\(/g)).toHaveLength(1)
    draw(changed)
  })
})

describe('modifier ordering guidance', () => {
  it('identifies a background outside the clipped content and offers its destination', () => {
    const modifiers = node(wrap('Text("Card").clipShape(.rect(cornerRadius: 12)).padding(16).background(Color.blue)')).modifiers!
    expect(modifierGuidance(modifiers, 0)).toMatchObject({ moveAfter: 2 })
  })
  it('identifies overlapping backgrounds and competing corner radii', () => {
    const modifiers = node(wrap('Text("Card").background(Color.gray).background(Color.blue).cornerRadius(8).clipShape(.rect(cornerRadius: 20))')).modifiers!
    expect(modifierGuidance(modifiers, 1)?.message).toContain('cover its color')
    expect(modifierGuidance(modifiers, 3)?.message).toContain('Another corner modifier')
  })
})
