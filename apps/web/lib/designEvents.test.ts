import { describe, expect, it } from 'vitest'
import { buildAuthoringModel } from '@studio/swift-sema'
import type { AuthoringNode, DesignEditRequest } from '@studio/shared'
import { VIEW_CATALOG } from './viewCatalog'
import { designEvent } from './designEvents'

/**
 * What a design edit is called in the event log (G5).
 *
 * Only the studio's own words go in: the kind of change, the built-in type of the
 * layer, and the controls, library views and modifiers the studio offers. Whatever the
 * designer typed or named stays out: text, values, screens, states, components,
 * tokens and pasted code. Every field that can carry such words says SECRET here, and
 * so do the designer's own type names.
 */

const source = `import SwiftUI
@main struct SecretApp: App { var body: some Scene { WindowGroup { SecretScreen() } } }
struct SecretCard: View {
  var title: String
  var body: some View { Text(title) }
}
struct SecretScreen: View {
  @State private var secretFlag = false
  var body: some View {
    VStack {
      Text("SECRET text").padding(8)
      SecretCard(title: "SECRET title")
    }
  }
}`
const snapshot = buildAuthoringModel({ projectId: 'p', revision: 1, files: [{ id: 'App.swift', text: source }] })
const find = (test: (node: AuthoringNode) => boolean) => snapshot.nodes.find(test)!
const text = find(node => node.name === 'Text' && node.owner === 'SecretScreen')
const card = find(node => node.kind === 'component')
const screen = find(node => node.kind === 'definition' && node.name === 'SecretScreen')

type Operation = DesignEditRequest['operation']
const S = 'SECRET'
const record = { name: S, note: S }
const action = { type: 'set', state: S, value: S } as const

/** One of every kind of design edit, so a new kind does not compile until it is here. */
const EVERY_KIND: { readonly [K in Operation['kind']]: Extract<Operation, { kind: K }> } = {
  'property': { kind: 'property', control: `component:${S}`, value: S },
  'delete': { kind: 'delete' },
  'move': { kind: 'move', direction: 1 },
  'insert': { kind: 'insert', snippet: `${S}Card(title: "${S}")` },
  'moveTo': { kind: 'moveTo', targetOffset: 12, position: 'inside' },
  'hide': { kind: 'hide' },
  'show': { kind: 'show' },
  'style-create-link': { kind: 'style-create-link', property: S, name: S, style: 'color', value: S, token: { value: S, dark: S } },
  'style-create': { kind: 'style-create', name: S, style: 'font', value: S },
  'style-edit': { kind: 'style-edit', name: S, value: S },
  'style-link': { kind: 'style-link', property: S, name: S },
  'style-local': { kind: 'style-local', property: S, value: S },
  'style-migrate': { kind: 'style-migrate', name: S },
  'asset-references': { kind: 'asset-references', from: S, to: S },
  'asset-use': { kind: 'asset-use', name: S },
  'modifier-add': { kind: 'modifier-add', name: S, before: S },
  'modifier-remove': { kind: 'modifier-remove', modifier: S },
  'modifier-duplicate': { kind: 'modifier-duplicate', modifier: S },
  'modifier-move': { kind: 'modifier-move', modifier: S, toIndex: 0 },
  'modifier-toggle': { kind: 'modifier-toggle', modifier: S, enabled: false },
  'navigation-style': { kind: 'navigation-style', style: 'tabs', name: S, icon: S },
  'tab-add': { kind: 'tab-add', screen: S, name: S, icon: S },
  'tab-update': { kind: 'tab-update', index: 0, name: S, icon: S, screen: S },
  'tab-remove': { kind: 'tab-remove', index: 0 },
  'tab-move': { kind: 'tab-move', index: 0, toIndex: 1 },
  'component-expose': { kind: 'component-expose', control: S, name: S },
  'component-insert': { kind: 'component-insert', component: S },
  'component-variant': { kind: 'component-variant', variant: { owner: S, signature: S, name: S, values: [{ control: S, value: S }] } },
  'screen-create': { kind: 'screen-create', name: S, title: S, layout: 'VStack' },
  'screen-duplicate': { kind: 'screen-duplicate', name: S },
  'screen-remove': { kind: 'screen-remove' },
  'card-customize': { kind: 'card-customize', color: S },
  'layer-duplicate': { kind: 'layer-duplicate' },
  'layer-wrap': { kind: 'layer-wrap', ids: [S], layout: 'HStack' },
  'layer-reparent': { kind: 'layer-reparent', ids: [S], destination: S },
  'guided-action': { kind: 'guided-action', action, replace: true, createValue: { name: S, value: S, activeTitle: S }, createScreen: { name: S, title: S } },
  'navigation-target': { kind: 'navigation-target', destination: S },
  'navigation-type': { kind: 'navigation-type', type: 'sheet' },
  'value-create': { kind: 'value-create', name: S, value: S },
  'records': { kind: 'records', records: [record] },
  'collection-field': { kind: 'collection-field', name: S, type: 'String', optional: false, value: S },
  'collection-convert': { kind: 'collection-convert', name: S, recordType: S },
  'empty-state': { kind: 'empty-state', text: S },
  'bind-field': { kind: 'bind-field', field: S },
  'extract-component': { kind: 'extract-component', name: S },
  'make-component': { kind: 'make-component', name: S, copies: [S], names: { [S]: S }, screens: [S] },
  'behavior': { kind: 'behavior', action: { type: 'append', collection: S, record }, replace: false },
  'bind-state': { kind: 'bind-state', name: S, create: { value: S } },
  'transition': { kind: 'transition', state: S, style: 'slide', duration: 0.3 },
}

describe('design edits in the event log', () => {
  it('never carry a name, text or value the designer typed, whatever the edit and wherever it lands', () => {
    for (const operation of Object.values(EVERY_KIND)) {
      for (const node of [text, card, screen, undefined]) {
        const event = designEvent(operation, node)
        expect(event).toMatchObject({ type: 'design', op: operation.kind })
        expect(JSON.stringify(event)).not.toMatch(/secret/i)
      }
    }
  })

  it('say what changed and on what: the layer’s built-in type, and the control, view or modifier the studio offered', () => {
    const control = (label: string) => text.controls!.find(item => item.label === label)!.id
    const padding = text.modifiers!.find(modifier => modifier.name === 'padding')!
    const vstack = VIEW_CATALOG.find(entry => entry.id === 'vstack')!

    expect(designEvent({ kind: 'property', control: control('Font size'), value: '17' }, text)).toEqual({ type: 'design', op: 'property', layer: 'Text', control: 'add:font' })
    expect(designEvent({ kind: 'property', control: control('padding'), value: '12' }, text)).toEqual({ type: 'design', op: 'property', layer: 'Text', control: 'modifier' })
    expect(designEvent({ kind: 'property', control: 'component:title', value: 'Hi' }, card)).toEqual({ type: 'design', op: 'property', layer: 'component', control: 'component' })
    expect(designEvent({ kind: 'insert', snippet: vstack.snippet }, screen)).toEqual({ type: 'design', op: 'insert', layer: 'definition', view: 'VStack' })
    expect(designEvent({ kind: 'modifier-add', name: 'opacity' }, text)).toEqual({ type: 'design', op: 'modifier-add', layer: 'Text', modifier: 'opacity' })
    expect(designEvent({ kind: 'modifier-toggle', modifier: padding.id, enabled: false }, text)).toEqual({ type: 'design', op: 'modifier-toggle', layer: 'Text', modifier: 'padding' })
    expect(designEvent({ kind: 'delete' })).toEqual({ type: 'design', op: 'delete' })
  })
})
