import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'

const source = (body: string, members = '') => `import SwiftUI
struct ContentView: View {
${members}
var body: some View { ${body} }
}`
const model = (text: string) => buildAuthoringModel({ projectId: 'hierarchy', revision: 1, files: [{ id: 'App.swift', text }] })

describe('designer authoring hierarchy', () => {
  it('keeps alternate conditional content in an explicit Otherwise branch', () => {
    const snapshot = model(source('VStack { if loading { Text("Loading") } else { Text("Ready") } }', '@State var loading = false'))
    const condition = snapshot.nodes.find(node => node.name === 'Condition')!
    const otherwise = snapshot.nodes.find(node => node.name === 'Otherwise')!
    const loading = snapshot.nodes.find(node => node.controls?.some(control => control.id === 'content' && control.value === 'Loading'))!
    const ready = snapshot.nodes.find(node => node.controls?.some(control => control.id === 'content' && control.value === 'Ready'))!
    expect(condition.children).toEqual([loading.id, otherwise.id])
    expect(otherwise.children).toEqual([ready.id])
    expect(otherwise.parentId).toBe(condition.id)
    expect(model(source('if loading { Text("Loading") }', '@State var loading = false')).nodes.filter(node => node.kind === 'branch')).toHaveLength(1)
  })

  it('keeps switch cases separate, including the default content', () => {
    const snapshot = model(source('switch count { case 1: Text("One")\ndefault: Text("Other") }', '@State var count = 1'))
    const match = snapshot.nodes.find(node => node.name === 'Switch')!
    const branches = match.children.map(id => snapshot.nodes.find(node => node.id === id)!)
    expect(branches.map(node => node.name)).toEqual(['Case 1', 'Otherwise'])
    expect(branches.every(node => node.children.length === 1)).toBe(true)
  })

  it('represents view backgrounds and overlays as slots without inventing a layer for a color', () => {
    const snapshot = model(source('Text("Title").background(Color.red).background { Rectangle() }.overlay(Text("Badge"))'))
    const title = snapshot.nodes.find(node => node.name === 'Text')!
    const slots = title.children.map(id => snapshot.nodes.find(node => node.id === id)!)
    expect(slots.map(node => node.name)).toEqual(['Background', 'Overlay'])
    expect(slots.map(node => snapshot.nodes.find(child => child.id === node.children[0])?.name)).toEqual(['Rectangle', 'Text'])
    expect(title.modifiers?.map(modifier => modifier.name)).toEqual(['background', 'background', 'overlay'])
  })

  it('reads known builder content even where constructor property editing is unavailable', () => {
    const snapshot = model(source('LazyVStack { Form { Text("Content") } }.toolbar { ToolbarItem { Button("Save") { } } }'))
    const lazy = snapshot.nodes.find(node => node.name === 'LazyVStack')!
    const form = snapshot.nodes.find(node => node.name === 'Form')!
    const toolbar = snapshot.nodes.find(node => node.name === 'Toolbar')!
    const item = snapshot.nodes.find(node => node.name === 'ToolbarItem')!
    const button = snapshot.nodes.find(node => node.name === 'Button')!
    expect(lazy.children).toEqual([form.id, toolbar.id])
    expect(form.children).toHaveLength(1)
    expect(toolbar.children).toEqual([item.id])
    expect(item.children).toEqual([button.id])
  })

  it('does not expose action statements as visual children', () => {
    const snapshot = model(source('Button("Save") { Text("Action") }.onAppear { Text("Also action") }'))
    expect(snapshot.nodes.filter(node => node.name === 'Text')).toHaveLength(0)
    expect(snapshot.nodes.find(node => node.name === 'Button')?.children).toHaveLength(0)
  })

  it('edits an inactive branch or slot child without rewriting its owner or sibling', () => {
    for (const body of ['VStack { if loading { Text("Keep") } else { Text("Change") } }', 'Text("Keep").overlay { Text("Change") }']) {
      const text = source(body, '@State var loading = false'), snapshot = model(text)
      const node = snapshot.nodes.find(node => node.controls?.some(control => control.id === 'content' && control.value === 'Change'))!
      const plan = planDesignEdit({ projectId: 'hierarchy', baseRevision: 1, scope: node.owner, files: [{ id: 'App.swift', text }], target: node.source, fingerprint: node.fingerprint, operation: { kind: 'property', control: 'content', value: 'Changed' } })
      expect(plan.ok).toBe(true)
      if (!plan.ok) throw new Error(plan.reason)
      expect(plan.changes[0]?.after).toBe(text.replace('Text("Change")', 'Text("Changed")'))
    }
  })
})


it('keeps builtin color constructors out of visual slots without hiding a component named Color', () => {
  const colors = model(source('Text("Title").background(Color(red: 1, green: 0.5, blue: 0)).overlay(SwiftUI.Color("Brand"))'))
  expect(colors.nodes.filter(node => node.name === 'Background' || node.name === 'Overlay')).toHaveLength(0)
  const customColor = '\nstruct Color: View { var body: some View { Text("Custom content") } }'
  const custom = model(source('Text("Title").background(Color())') + customColor)
  const slot = custom.nodes.find(node => node.name === 'Background')!
  expect(custom.nodes.find(node => node.id === slot.children[0])?.kind).toBe('component')
  const qualified = model(source('Text("Title").background(SwiftUI.Color(red: 1, green: 0.5, blue: 0)).overlay(SwiftUI.Color("Brand"))') + customColor)
  expect(qualified.nodes.filter(node => node.name === 'Background' || node.name === 'Overlay')).toHaveLength(0)
})


it('reads navigation labels as row content and keeps destinations in their own settings slot', () => {
  const snapshot = model(source('List { NavigationLink { Text("Details") } label: { HStack { Text("Open row") } } }'))
  const link = snapshot.nodes.find(node => node.name === 'NavigationLink')!
  const children = link.children.map(id => snapshot.nodes.find(node => node.id === id)!)
  expect(children.map(node => node.name)).toEqual(['HStack', 'Destination'])
  const destination = children[1]!
  expect(snapshot.nodes.find(node => node.id === destination.children[0])?.properties[0]?.expression).toBe('"Details"')
  const row = snapshot.nodes.find(node => node.properties.some(property => property.expression === '"Open row"'))!
  expect(row.parentId).toBe(children[0]!.id)
})

it('reads explicit Button labels without interpreting their actions as visual children', () => {
  for (const button of ['Button { Text("Action") } label: { Text("Visible") }', 'Button(action: { Text("Action") }, label: { Text("Visible") })']) {
    const snapshot = model(source(button))
    expect(snapshot.nodes.filter(node => node.name === 'Text').map(node => node.properties[0]?.expression)).toEqual(['"Visible"'])
  }
})
