import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import type { DesignControl, DesignEditPlan, SourceFile } from '@studio/shared'

// The kinds of value the older controls take (doc 18, Wave 2): a switch for a true or
// false value, and a number shown in its unit, with an opacity shown as a percentage.
const wrap = (body: string, members = '', extra = '') => `import SwiftUI\n@main struct TestApp: App { var body: some Scene { WindowGroup { ContentView() } } }\nstruct ContentView: View { ${members}\nvar body: some View { ${body} } }\n${extra}`
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
const nodeOf = (text: string, name: string) => buildAuthoringModel({ projectId: 'p', revision: 1, files: files(text), deploymentTarget: '18.0' }).nodes.find(n => n.name === name && n.kind !== 'definition')!
function control(text: string, name: string, label: string): DesignControl {
  const controls = nodeOf(text, name).controls ?? []
  const found = controls.find(c => c.label === label)
  expect(found, `${name} ${label}: ${controls.map(c => c.label).join(', ')}`).toBeDefined()
  return found!
}
function plan(text: string, name: string, label: string, value: string): DesignEditPlan {
  const node = nodeOf(text, name)
  return planDesignEdit({ projectId: 'p', baseRevision: 1, scope: node.owner, files: files(text), target: node.source, fingerprint: node.fingerprint, deploymentTarget: '18.0', operation: { kind: 'property', control: control(text, name, label).id, value } })
}
function edited(text: string, name: string, label: string, value: string): string {
  const result = plan(text, name, label, value)
  if (!result.ok) throw new Error(result.reason)
  return result.changes[0]?.after ?? text
}

const card = 'struct Card: View { var featured: Bool = false; var body: some View { Text("Card") } }'

describe('a true or false value is a switch', () => {
  it.each([
    ['Button("Go") {}.disabled(true)', 'Button', 'disabled', 'true'],
    ['ScrollView(.vertical, showsIndicators: false) { Text("A") }', 'ScrollView', 'Show indicators', 'false'],
    ['ScrollView { Text("A") }', 'ScrollView', 'Show indicators', 'true'],
    ['Text("A").padding([.top, .bottom], 8)', 'Text', 'Pad top', 'true'],
    ['Text("A").padding([.top, .bottom], 8)', 'Text', 'Pad leading', 'false'],
    ['Text("A").fixedSize()', 'Text', 'Ideal horizontal size', 'true'],
    ['Text("A").fixedSize(horizontal: true, vertical: false)', 'Text', 'fixed Size · vertical', 'false'],
    ['Text("A").allowsHitTesting(false)', 'Text', 'allows Hit Testing', 'false'],
    ['Text("A").accessibilityHidden(true)', 'Text', 'accessibility Hidden', 'true'],
    ['Text("A").allowsTightening(true)', 'Text', 'allows Tightening', 'true'],
    ['Text("A").underline()', 'Text', 'Enabled', 'true'],
    ['Text("A").lineLimit(2, reservesSpace: true)', 'Text', 'Reserve line space', 'true'],
    ['Card()', 'Card', 'featured', 'false'],
  ])('%s: %s %s reads as a switch', (body, name, label, value) => {
    const found = control(wrap(body, '', card), name, label)
    expect(found).toMatchObject({ kind: 'toggle', value })
    expect(found.options).toBeUndefined()
  })
  it('reads a ColorPicker’s opacity support as a switch', () => {
    expect(control(wrap('ColorPicker("Color", selection: $color)', '@State var color = Color.blue'), 'ColorPicker', 'Supports opacity')).toMatchObject({ kind: 'toggle', value: 'true' })
  })
  it('writes the switched value as the Swift literal', () => {
    const source = wrap('Button("Go") {}.disabled(true)')
    expect(edited(source, 'Button', 'disabled', 'false')).toBe(source.replace('disabled(true)', 'disabled(false)'))
    const padded = wrap('Text("A").padding([.top, .bottom], 8)')
    expect(edited(padded, 'Text', 'Pad leading', 'true')).toBe(padded.replace('[.top, .bottom]', '[.top, .bottom, .leading]'))
    const scroll = wrap('ScrollView { Text("A") }')
    expect(edited(scroll, 'ScrollView', 'Show indicators', 'false')).toBe(scroll.replace('ScrollView {', 'ScrollView(showsIndicators: false) {'))
    const instance = wrap('Card()', '', card)
    expect(edited(instance, 'Card', 'featured', 'true')).toBe(instance.replace('Card()', 'Card(featured: true)'))
  })
  it('keeps each branch of a condition its own switch', () => {
    const source = wrap('Button("Go") {}.disabled(busy ? true : false)', '@State var busy = false')
    expect(control(source, 'Button', 'disabled · when busy is true')).toMatchObject({ kind: 'toggle', value: 'true' })
    expect(edited(source, 'Button', 'disabled · otherwise', 'true')).toBe(source.replace('busy ? true : false', 'busy ? true : true'))
  })
  it.each(['True', 'yes', '1', '', '.true', 'false; bad()'])('refuses %j for a switch without changing the source', value => {
    expect(plan(wrap('Button("Go") {}.disabled(true)'), 'Button', 'disabled', value)).toMatchObject({ ok: false })
    expect(plan(wrap('Card()', '', card), 'Card', 'featured', value)).toMatchObject({ ok: false })
  })
})

describe('an opacity is a share of one, shown as a percentage', () => {
  it.each([
    ['Text("A")', 'Opacity', ''],
    ['Text("A").opacity(0.5)', 'opacity', '0.5'],
    ['Text("A").foregroundStyle(Color.blue.opacity(0.4))', 'foregroundStyle · opacity', '0.4'],
    ['Text("A").background(Color.red.opacity(0.2))', 'background · opacity', '0.2'],
  ])('%s: %s keeps its Swift value and bounds, in percent', (body, label, value) => {
    expect(control(wrap(body), 'Text', label)).toMatchObject({ kind: 'number', unit: '%', value, min: 0, max: 1, step: 0.01 })
  })
  it('writes the Swift number it is given', () => {
    const source = wrap('Text("A")')
    expect(edited(source, 'Text', 'Opacity', '0.25')).toBe(source.replace('Text("A")', 'Text("A").opacity(0.25)'))
    const faded = wrap('Text("A").opacity(0.5)')
    expect(edited(faded, 'Text', 'opacity', '0.75')).toBe(faded.replace('0.5', '0.75'))
  })
  it('says the range in percent', () => {
    expect(plan(wrap('Text("A").opacity(0.5)'), 'Text', 'opacity', '1.5')).toMatchObject({ ok: false, reason: expect.stringContaining('maximum 100%') })
    expect(plan(wrap('Text("A").opacity(0.5)'), 'Text', 'opacity', '-0.5')).toMatchObject({ ok: false, reason: expect.stringContaining('minimum 0%') })
  })
  it('leaves other values from zero to one as plain numbers', () => {
    expect(control(wrap('Text("A").grayscale(0.5)'), 'Text', 'grayscale').unit).toBeUndefined()
  })
})

describe('a number says its unit', () => {
  it.each([
    ['Text("A").rotationEffect(.degrees(15))', 'rotationEffect · degrees'],
    ['Text("A").hueRotation(.degrees(30))', 'Angle (degrees)'],
    ['Text("A").hueRotation(Angle(degrees: 30))', 'Angle (degrees)'],
  ])('%s: %s is in degrees', (body, label) => {
    expect(control(wrap(body), 'Text', label)).toMatchObject({ kind: 'number', unit: '°' })
  })
  it('leaves radians without a unit', () => {
    expect(control(wrap('Text("A").rotationEffect(.radians(1))'), 'Text', 'Angle (radians)').unit).toBeUndefined()
  })
  it.each([
    ['Text("A").padding(8)', 'Text', 'padding'],
    ['Text("A").padding(.horizontal, 12)', 'Text', 'padding'],
    ['Text("A").padding()', 'Text', 'Padding'],
    ['Text("A")', 'Text', 'Padding'],
    ['Text("A").padding(.horizontal)', 'Text', 'Padding amount'],
    ['Text("A").frame(width: 120, height: 40)', 'Text', 'frame · width'],
    ['Text("A").frame(width: 120, height: 40)', 'Text', 'frame · height'],
    ['Text("A").frame(maxWidth: 200)', 'Text', 'frame · maxWidth'],
    ['Text("A").frame(maxWidth: 200)', 'Text', 'min Width'],
    ['Text("A")', 'Text', 'Fixed width'],
    ['Text("A")', 'Text', 'Fixed height'],
    ['VStack(spacing: 12) { Text("A") }', 'VStack', 'Spacing'],
    ['Text("A").cornerRadius(8)', 'Text', 'cornerRadius'],
    ['Text("A")', 'Text', 'Corner radius'],
    ['Text("A").clipShape(.rect(cornerRadius: 12))', 'Text', 'clipShape · cornerRadius'],
    ['RoundedRectangle(cornerRadius: 8)', 'RoundedRectangle', 'Shape corner radius'],
    ['Text("A").shadow(radius: 4, x: 0, y: 2)', 'Text', 'shadow · radius'],
    ['Text("A").shadow(radius: 4, x: 0, y: 2)', 'Text', 'shadow · x'],
    ['Text("A").shadow(radius: 4, x: 0, y: 2)', 'Text', 'shadow · y'],
    ['Text("A").offset(x: 4, y: 8)', 'Text', 'offset · x'],
    ['Text("A").offset(x: 4, y: 8)', 'Text', 'offset · y'],
    ['Text("A").blur(radius: 3)', 'Text', 'blur · radius'],
    ['Text("A").lineSpacing(4)', 'Text', 'lineSpacing'],
    ['Text("A").tracking(1)', 'Text', 'tracking'],
  ])('%s: %s %s is in points', (body, name, label) => {
    expect(control(wrap(body), name, label)).toMatchObject({ kind: 'number', unit: 'pt' })
  })
  it.each([
    ['Text("A").scaleEffect(1.5)', 'scaleEffect'],
    ['Text("A").lineLimit(2)', 'lineLimit'],
    ['Text("A").layoutPriority(1)', 'layout Priority'],
  ])('%s: %s has no unit', (body, label) => {
    expect(control(wrap(body), 'Text', label)).toMatchObject({ kind: 'number' })
    expect(control(wrap(body), 'Text', label).unit).toBeUndefined()
  })
  it('writes points as the number typed', () => {
    const source = wrap('Text("A").padding(8)')
    expect(edited(source, 'Text', 'padding', '12')).toBe(source.replace('padding(8)', 'padding(12)'))
    const turned = wrap('Text("A").rotationEffect(.degrees(15))')
    expect(edited(turned, 'Text', 'rotationEffect · degrees', '45')).toBe(turned.replace('15', '45'))
  })
})
