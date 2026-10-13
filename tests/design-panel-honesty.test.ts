import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringNode, DesignEditRequest } from '@studio/shared'

beforeEach(resetPipelineState)
const source = (body: string, extra = '') => `import SwiftUI
@main struct Demo: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var showing = false
    var body: some View {
        ${body}
    }
}${extra}`
const files = (text: string) => [{ id: 'App.swift', text }]
const model = (text: string, deploymentTarget = '18.0') => buildAuthoringModel({ projectId: 'panel', revision: 1, files: files(text), deploymentTarget })
const find = (text: string, name: string, deploymentTarget?: string) => model(text, deploymentTarget).nodes.find(n => n.name === name && n.kind !== 'definition')!
function plan(text: string, node: AuthoringNode, operation: DesignEditRequest['operation'], deploymentTarget = '18.0') {
  return planDesignEdit({ projectId: 'panel', baseRevision: 1, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation, deploymentTarget })
}
function edit(text: string, name: string, operation: DesignEditRequest['operation']) {
  const result = plan(text, find(text, name), operation)
  if (!result.ok) throw new Error(result.reason)
  return result.changes[0]?.after ?? text
}
const control = (text: string, name: string, id: string) => find(text, name).controls?.find(c => c.id === id)
function render(text: string) {
  const result = compile({ files: files(text), revision: 1, canvas: { width: 393, height: 852 }, colorScheme: 'light', safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result.renderTree!
}

describe('material fills', () => {
  const FILL = 'modifier:0:advanced:0:fillType', THICKNESS = 'modifier:0:advanced:0:material'
  it.each([
    ['.ultraThinMaterial', 'ultraThin'], ['.thinMaterial', 'thin'], ['.regularMaterial', 'regular'], ['.thickMaterial', 'thick'], ['.ultraThickMaterial', 'ultraThick'],
    ['Material.thin', 'thin'], ['.regularMaterial, in: RoundedRectangle(cornerRadius: 12)', 'regular'],
  ])('reads .background(%s) as a Material with its thickness', (fill, thickness) => {
    const text = source(`VStack { Text("A") }.background(${fill})`)
    expect(control(text, 'VStack', FILL)).toMatchObject({ value: 'Material', options: ['Solid', 'Gradient', 'Material'] })
    expect(control(text, 'VStack', THICKNESS)).toMatchObject({ value: thickness, options: ['ultraThin', 'thin', 'regular', 'thick', 'ultraThick'] })
    expect(find(text, 'VStack').modifiers![0]!.summary).toBe(`Material · ${thickness}`)
  })
  const materialOf = (text: string) => render(text).nodes.find(n => n.material)?.material
  const solidOf = (text: string) => render(text).nodes.find(n => n.id !== 'screen' && n.background?.kind === 'solid')?.background
  it('switches between Solid, Gradient and Material, writing Swift that draws each', () => {
    const material = source('VStack { Text("A") }.background(.ultraThinMaterial)')
    expect(materialOf(material)).toBeDefined()
    const solid = edit(material, 'VStack', { kind: 'property', control: FILL, value: 'Solid' })
    expect(solid).toContain('.background(Color.blue)')
    expect(solidOf(solid)).toBeDefined()
    expect(materialOf(solid)).toBeUndefined()
    const back = edit(solid, 'VStack', { kind: 'property', control: FILL, value: 'Material' })
    expect(back).toContain('.background(.regularMaterial)')
    expect(materialOf(back)).toBeDefined()
    const gradient = edit(back, 'VStack', { kind: 'property', control: FILL, value: 'Gradient' })
    expect(gradient).toContain('.background(LinearGradient(colors: [Color.red, Color.blue]')
    expect(materialOf(gradient)).toBeUndefined()
  })
  it('changes the thickness in the spelling the code already uses', () => {
    const thick = edit(source('VStack { Text("A") }.background(.ultraThinMaterial)'), 'VStack', { kind: 'property', control: THICKNESS, value: 'thick' })
    expect(thick).toContain('.background(.thickMaterial)')
    expect(materialOf(thick)!.opacity).toBeGreaterThan(materialOf(source('VStack { Text("A") }.background(.ultraThinMaterial)'))!.opacity)
    expect(edit(source('VStack { Text("A") }.background(Material.thin)'), 'VStack', { kind: 'property', control: THICKNESS, value: 'regular' })).toContain('.background(Material.regular)')
  })
  it('keeps the shape of .background(_:in:) and edits its colour once it is solid', () => {
    const text = source('VStack { Text("A") }.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))')
    const solid = edit(text, 'VStack', { kind: 'property', control: FILL, value: 'Solid' })
    expect(solid).toContain('.background(Color.blue, in: RoundedRectangle(cornerRadius: 12))')
    render(solid)
    const red = edit(solid, 'VStack', { kind: 'property', control: 'modifier:0:advanced:0:color', value: 'red' })
    expect(red).toContain('.background(Color.red, in: RoundedRectangle(cornerRadius: 12))')
    render(red)
  })
  it('offers Material only where the deployment target has it', () => {
    const text = source('VStack { Text("A") }.background(Color.red)')
    expect(control(text, 'VStack', FILL)?.options).toEqual(['Solid', 'Gradient', 'Material'])
    expect(find(text, 'VStack', '14.0').controls?.find(c => c.id === FILL)?.options).toEqual(['Solid', 'Gradient'])
    expect(control(source('Text("A").foregroundStyle(Color.red)'), 'Text', FILL)?.options).toEqual(['Solid', 'Gradient'])
  })
})

describe('hex colours with alpha', () => {
  const styleOf = (text: string, name: string) => find(text, name).styles!.find(s => s.kind === 'color')!
  it('writes #RRGGBBAA as a colour with its opacity, reads it back with the alpha, and draws it translucent', () => {
    const text = source('VStack { Text("A") }.background(Color.red)')
    const changed = edit(text, 'VStack', { kind: 'style-local', property: styleOf(text, 'VStack').property, value: '#FFFFFF80' })
    expect(changed).toContain('.background(Color(red: 1, green: 1, blue: 1, opacity: 0.502))')
    expect(styleOf(changed, 'VStack').value?.toUpperCase()).toBe('#FFFFFF80')
    const fill = render(changed).nodes.find(n => n.id !== 'screen' && n.background?.kind === 'solid')?.background
    expect(fill?.kind === 'solid' && fill.color).toMatchObject({ r: 255, g: 255, b: 255 })
    expect(fill?.kind === 'solid' && Math.round(fill.color.a * 255)).toBe(128)
  })
  it('keeps an opaque #RRGGBBFF as six digits', () => {
    const text = source('VStack { Text("A") }.background(Color.red)')
    const changed = edit(text, 'VStack', { kind: 'style-local', property: styleOf(text, 'VStack').property, value: '#123456FF' })
    expect(changed).toContain('.background(Color(red: 0.071, green: 0.204, blue: 0.337))')
    expect(styleOf(changed, 'VStack').value?.toUpperCase()).toBe('#123456')
  })
})

describe('appear animation', () => {
  const transition = (state = 'showing') => ({ kind: 'transition' as const, state, style: 'opacity' as const, duration: 0.25 })
  it('refuses a view that is always shown, where the transition would never play', () => {
    const text = source('VStack { Text("Always"); Button("Show") { showing.toggle() } }')
    const result = plan(text, find(text, 'Text'), transition())
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.reason).toMatch(/added or removed/)
  })
  it('still animates a view an if inserts, from its surviving container', () => {
    const text = source('VStack { if showing { Text("Sometimes") } }')
    const changed = edit(text, 'Text', transition())
    expect(changed).toContain('Text("Sometimes").transition(.opacity) }')
    expect(changed).toContain('}.animation(.easeInOut(duration: 0.25), value: showing)')
    render(changed)
  })
  it('animates the rows of a collection from the view around it, keyed on the collection', () => {
    const extra = ''
    const text = source('VStack { ForEach(items, id: \\.self) { item in Text(item) } }', extra).replace('@State private var showing = false', '@State private var items = ["A", "B"]')
    const changed = edit(text, 'Text', transition(''))
    expect(changed).toContain('Text(item).transition(.opacity) }')
    expect(changed).toContain('} }.animation(.easeInOut(duration: 0.25), value: items.count)')
    render(changed)
    const list = text.replace('VStack { ForEach(items, id: \\.self) { item in Text(item) } }', 'List(items, id: \\.self) { item in Text(item) }')
    expect(edit(list, 'Text', transition(''))).toContain('Text(item).transition(.opacity) }.animation(.easeInOut(duration: 0.25), value: items.count)')
  })
  it('refuses rows that are fixed in the code, which are never added or removed', () => {
    const text = source('VStack { ForEach(0..<3) { i in Text("Row") } }')
    const result = plan(text, find(text, 'Text'), transition(''))
    expect(!result.ok && result.reason).toMatch(/added or removed/)
  })
  it('offers the panel exactly what the writer takes, with the writer\'s reason where it would refuse', () => {
    const appear = (text: string) => find(text, 'Text').behavior?.appear
    expect(appear(source('VStack { if showing { Text("Sometimes") } }'))).toEqual({ by: 'branch' })
    expect(appear(source('VStack { ForEach(items, id: \\.self) { item in Text(item) } }').replace('@State private var showing = false', '@State private var items = ["A", "B"]'))).toEqual({ by: 'row' })
    expect(appear(source('VStack { Text("Always") }'))).toMatchObject({ problem: expect.stringMatching(/always shown/) })
    // A ForEach over a `let` with a value never changes, so its rows never come or go.
    const fixed = source('VStack { ForEach(items, id: \\.self) { item in Text(item) } }').replace('@State private var showing = false', 'let items = ["A", "B"]')
    expect(appear(fixed)).toMatchObject({ problem: expect.stringMatching(/fixed in the code/) })
    expect(plan(fixed, find(fixed, 'Text'), transition(''))).toMatchObject({ ok: false })
  })
})

describe('image sizing and symbols', () => {
  it.each([['fit', 'Fit'], ['fill', 'Fill']])('reads .aspectRatio(contentMode: .%s) as %s, and switching writes one set of scaling modifiers', (mode, label) => {
    const text = source(`Image("photo").resizable().aspectRatio(contentMode: .${mode}).frame(width: 100, height: 80)`)
    expect(control(text, 'Image', 'image:sizing')?.value).toBe(label)
    const other = label === 'Fit' ? 'Fill' : 'Fit'
    const changed = edit(text, 'Image', { kind: 'property', control: 'image:sizing', value: other })
    expect(changed).toContain(`Image("photo").resizable().scaledTo${other}().frame(width: 100, height: 80)`)
    expect(edit(text, 'Image', { kind: 'property', control: 'image:sizing', value: 'Stretch' })).toContain('Image("photo").resizable().frame(width: 100, height: 80)')
  })
  it('leaves an explicit aspect ratio to its own card rather than offering sizing that would stack on it', () => {
    const text = source('Image("photo").resizable().aspectRatio(1.5, contentMode: .fit)')
    expect(control(text, 'Image', 'image:sizing')).toBeUndefined()
  })
  const symbol = (value: string) => plan(source('Image(systemName: "star")'), find(source('Image(systemName: "star")'), 'Image'), { kind: 'property', control: 'image', value })
  it.each(['', '   ', 'Star Fill', 'star..fill', 'star.fill.', 'heart!'])('refuses the symbol name %j', value => {
    expect(symbol(value)).toMatchObject({ ok: false })
  })
  it('accepts a symbol the preview draws, and a well-formed Apple name it does not', () => {
    expect(symbol('heart.fill')).toMatchObject({ ok: true })
    expect(symbol('person.crop.circle.badge.questionmark')).toMatchObject({ ok: true })
  })
})

describe('duplicating a Picker option', () => {
  const picker = (options: string, state = '@State private var choice = 0', extra = '') => source(`Picker("Theme", selection: $choice) {
            ${options}
        }`, extra).replace('@State private var showing = false', state)
  const duplicate = (text: string, label: string) => {
    const node = model(text).nodes.find(n => n.name === 'Text' && n.properties.some(p => p.expression === `"${label}"`))!
    return plan(text, node, { kind: 'layer-duplicate' })
  }
  const after = (text: string, label: string) => { const result = duplicate(text, label); if (!result.ok) throw new Error(result.reason); return result.changes[0]!.after }
  it('gives the copy of an Int-tagged option the next number', () => {
    const text = picker('Text("Light").tag(0)\n            Text("Dark").tag(1)')
    const changed = after(text, 'Dark')
    expect(changed).toContain('Text("Dark").tag(1)\n            Text("Dark").tag(2)')
    render(changed)
    expect(after(text, 'Light')).toContain('Text("Light").tag(0)\n            Text("Light").tag(2)')
  })
  it('gives the copy of a String-tagged option a numbered name', () => {
    const text = picker('Text("Light").tag("light")\n            Text("Dark").tag("dark")', '@State private var choice = "light"')
    expect(after(text, 'Dark')).toContain('Text("Dark").tag("dark")\n            Text("Dark").tag("dark 2")')
  })
  it('gives the copy of an enum-tagged option a case no other option uses', () => {
    const extra = '\nenum Theme { case light, dark, system }'
    const text = picker('Text("Light").tag(Theme.light)\n            Text("Dark").tag(Theme.dark)', '@State private var choice = Theme.light', extra)
    const changed = after(text, 'Dark')
    expect(changed).toContain('Text("Dark").tag(Theme.dark)\n            Text("Dark").tag(Theme.system)')
    render(changed)
  })
  it('refuses, in plain words, when every case of the enum already has an option', () => {
    const text = picker('Text("Light").tag(Theme.light)\n            Text("Dark").tag(Theme.dark)', '@State private var choice = Theme.light', '\nenum Theme { case light, dark }')
    const result = duplicate(text, 'Dark')
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.reason).toMatch(/Every case of Theme already has an option/)
  })
  it('refuses a copy that would repeat the tags of the options inside it', () => {
    const text = picker('HStack {\n                Text("Light").tag(0)\n                Text("Dark").tag(1)\n            }\n            Text("System").tag(2)')
    const stack = find(text, 'HStack')
    const result = plan(text, stack, { kind: 'layer-duplicate' })
    expect(!result.ok && result.reason).toMatch(/options one at a time/)
  })
  it('leaves a tagged view outside a Picker as an exact copy', () => {
    const text = source('VStack {\n            Text("Dark").tag(1)\n        }')
    expect(after(text, 'Dark')).toContain('Text("Dark").tag(1)\n            Text("Dark").tag(1)')
  })
})
