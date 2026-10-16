import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { evenInsets, type AuthoringNode, type DesignEditRequest, type LayerChange } from '@studio/shared'
import { XCODE, bodyOf, layerOf, node, project, setLayer, text, typecheckInXcode } from './helpers/layer-project'

/**
 * Views carrying everyday Apple modifiers stay open in Design (doc 18, Wave 3a): a known
 * SwiftUI modifier returns `some View`, so the Add list, the quick fields and the layer
 * sections write next to it. Only a project's own modifier, whose type Design cannot see,
 * still locks the view.
 */
beforeEach(resetPipelineState)

/** A screen with the state the sample modifiers read. */
const app = (body: string, declarations = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var count = 0
    @State private var selection: Item?
    @State private var shown = false
    @State private var selected = false
    @StateObject private var model = Model()
    var body: some View {
${body}
    }
}

struct Item: Identifiable {
    let id = 1
    var name = "Item"
}

final class Model: ObservableObject {}
${declarations}`

const files = (body: string, declarations = '') => project(app(body, declarations))
const textOf = (body: string, declarations = '') => node(files(`        ${body}`, declarations), 'Text')

/**
 * Apple modifiers the preview applies, whether the capabilities table reads their form or not,
 * as it reads a context menu's, a row's background and insets and swipe actions (Wave 4a).
 */
const APPLIED = [
  '.onTapGesture { count += 1 }', '.task { }', '.onAppear { }', '.toolbar { Button("Done") { } }', '.environmentObject(model)',
  '.sheet(item: $selection) { item in Text(item.name) }', '.alert("Saved", isPresented: $shown) { }',
  '.confirmationDialog("Delete?", isPresented: $shown) { Button("Delete", role: .destructive) { } }',
  '.navigationDestination(isPresented: $shown) { Text("Next") }', '.contextMenu { Button("Copy") { } }',
  '.animation(.default, value: count)', '.transition(.opacity)', '.id(count)', '.badge(3)', '.listRowBackground(Color.yellow)',
  '.listRowInsets(EdgeInsets())', '.ignoresSafeArea()', '.mask { Circle() }', '.monospacedDigit()',
  '.safeAreaInset(edge: .bottom) { Text("Bar") }', '.searchable(text: .constant(""))', '.presentationDetents([.medium])',
  '.shadow(color: .black, radius: 4, y: 2)', '.swipeActions { Button("Delete") { } }', '.contentTransition(.numericText())',
  '.zIndex(1)',
]
/** Apple modifiers the preview names and does not draw, and real ones it has no list of. */
const NOT_DRAWN = [
  '.refreshable { }', '.contentShape(Rectangle())', '.compositingGroup()',
  '.fontWidth(.condensed)', '.scrollTransition { content, phase in content }',
  '.sensoryFeedback(.success, trigger: count)', '.labelsHidden()',
]

describe('the Add list and the quick fields', () => {
  it.each([...APPLIED, ...NOT_DRAWN, '.accessibilityIdentifier("total")'])('stay open on a view with %s', modifier => {
    const text = textOf(`Text("A")${modifier}`)
    expect(text.modifierCatalog?.find(entry => entry.name === 'padding')).toMatchObject({ available: true })
    expect(text.controls?.map(control => control.id)).toContain('add:padding')
  })

  it('still lock on a modifier the project declares, whose type Design cannot see', () => {
    const text = textOf('Text("A").cardStyle()', '\nextension View {\n    func cardStyle() -> some View { padding(4) }\n}\n')
    expect(text.modifierCatalog?.every(entry => !entry.available)).toBe(true)
    expect(text.modifierCatalog?.[0]?.reason).toMatch(/custom modifier/)
    expect(text.controls?.map(control => control.id)).not.toContain('add:padding')
    expect(text.modifiers?.[0]).toMatchObject({ category: 'custom', summary: 'Custom modifier' })
  })
})

describe('an image’s sizing', () => {
  it('stays next to Apple modifiers, and keeps them as written', () => {
    const body = '        Image("photo").onTapGesture { count += 1 }'
    const image = node(files(body), 'Image')
    const sizing = image.controls?.find(control => control.label === 'Image sizing')
    expect(sizing).toMatchObject({ value: 'Intrinsic' })
    expect(bodyOf(project(edited(app(body), 'Image', { kind: 'property', control: sizing!.id, value: 'Fit' })))).toBe('        Image("photo").resizable().scaledToFit().onTapGesture { count += 1 }')
  })

  it('is still left to Code beside a modifier the project declares', () => {
    const declared = files('        Image("photo").cardStyle()', '\nextension View {\n    func cardStyle() -> some View { padding(4) }\n}\n')
    expect(node(declared, 'Image').controls?.some(control => control.label === 'Image sizing')).toBe(false)
  })
})

describe('what a known Apple modifier reads as', () => {
  it.each([
    ['.refreshable { }', 'behavior'],
    ['.contentShape(Rectangle())', 'behavior'],
    ['.compositingGroup()', 'appearance'],
    ['.fontWidth(.condensed)', 'text'],
    ['.sensoryFeedback(.success, trigger: count)', 'behavior'],
  ])('%s is not drawn in the preview, in its own category', (modifier, category) => {
    expect(textOf(`Text("A")${modifier}`).modifiers?.[0]).toMatchObject({ category, summary: 'Not drawn in the preview' })
  })

  it('reads .contentTransition(.numericText()) as drawn, since the preview rolls the digits (Wave 5a)', () => {
    const card = textOf('Text("A").contentTransition(.numericText())').modifiers?.[0]
    expect(card).toMatchObject({ name: 'contentTransition', category: 'behavior' })
    expect(card?.summary).not.toBe('Not drawn in the preview')
  })

  it('keeps the modifiers the preview draws as they read', () => {
    expect(textOf('Text("A").onTapGesture { count += 1 }').modifiers?.[0]).toMatchObject({ category: 'behavior', summary: 'Configured action' })
  })
})

describe('the layer sections', () => {
  const written = (body: string, change: LayerChange) => bodyOf(setLayer(files(`        ${body}`), 'Text', [change]))

  it.each([...APPLIED, ...NOT_DRAWN])('are open on a view with %s', modifier => {
    expect(layerOf(files(`        Text("A")${modifier}`), 'Text').locked).toBeUndefined()
  })

  it('still lock on a modifier the project declares', () => {
    const declared = files('        Text("A").cardStyle()', '\nextension View {\n    func cardStyle() -> some View { padding(4) }\n}\n')
    expect(layerOf(declared, 'Text').locked).toMatch(/does not know/)
  })

  it.each<[string, string, LayerChange, string]>([
    ['Layout', 'Text("A").onTapGesture { count += 1 }', { section: 'layout', padding: evenInsets(12) }, 'Text("A").padding(12).onTapGesture { count += 1 }'],
    ['Layout', 'Text("A").sheet(item: $selection) { item in Text(item.name) }', { section: 'layout', width: { mode: 'fixed', size: 120 } }, 'Text("A").frame(width: 120).sheet(item: $selection) { item in Text(item.name) }'],
    ['Fill', 'Text("A").task { }', { section: 'fill', fill: { kind: 'color', color: { name: 'red' } } }, 'Text("A").background(.red).task { }'],
    ['Corners', 'Text("A").background(.red).contextMenu { Button("Copy") { } }', { section: 'corners', corners: { shape: 'rounded', radius: 8, continuous: true } }, 'Text("A").background(.red).clipShape(.rect(cornerRadius: 8)).contextMenu { Button("Copy") { } }'],
    ['Stroke', 'Text("A").padding(8).shadow(color: .black, radius: 4, y: 2)', { section: 'stroke', stroke: { color: { name: 'gray' }, width: 1, position: 'inside' } }, 'Text("A").padding(8).overlay(Rectangle().strokeBorder(.gray, lineWidth: 1)).shadow(color: .black, radius: 4, y: 2)'],
    ['Text', 'Text("A").monospacedDigit().swipeActions { Button("Delete") { } }', { section: 'text', alignment: 'center' }, 'Text("A").monospacedDigit().multilineTextAlignment(.center).swipeActions { Button("Delete") { } }'],
    ['Effects', 'Text("A").zIndex(1).sensoryFeedback(.success, trigger: count)', { section: 'effects', opacity: 0.5 }, 'Text("A").zIndex(1).opacity(0.5).sensoryFeedback(.success, trigger: count)'],
  ])('%s writes next to %s', (_, body, change, expected) => {
    expect(written(body, change)).toBe(`        ${expected}`)
  })
})

describe('accessibilityIdentifier, which Design itself writes', () => {
  it('locks nothing', () => {
    const text = textOf('Text("A").accessibilityIdentifier("total")')
    expect(text.layer?.locked).toBeUndefined()
    expect(text.modifierCatalog?.filter(entry => entry.available).length).toBeGreaterThan(0)
    expect(bodyOf(setLayer(files('        Text("A").accessibilityIdentifier("total")'), 'Text', [{ section: 'layout', padding: evenInsets(8) }])))
      .toBe('        Text("A").padding(8).accessibilityIdentifier("total")')
  })
})

/** The planner's answer to one Design request on the `index`th view called `name`. */
function plan(source: string, name: string, operation: DesignEditRequest['operation'], index = 0) {
  const target = buildAuthoringModel({ projectId: 'reach', revision: 1, files: project(source) }).nodes.filter(n => n.name === name && n.kind !== 'definition' && n.kind !== 'branch')[index]!
  return planDesignEdit({ projectId: 'reach', baseRevision: 1, files: project(source), scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation })
}
/** The file after the request; throws with the planner's reason when it refuses. */
function edited(source: string, name: string, operation: DesignEditRequest['operation'], index = 0): string {
  const result = plan(source, name, operation, index)
  if (!result.ok) throw new Error(result.reason)
  return result.changes[0]?.after ?? source
}
const control = (view: AuthoringNode, label: string) => view.controls?.find(c => c.label === label)

describe('adding from the Add list', () => {
  const added = (body: string, name: string, view = 'Text') => bodyOf(project(edited(app(body), view, { kind: 'modifier-add', name })))

  it('writes a new modifier in its place, before a known Apple modifier', () => {
    expect(added('        Text("A").onTapGesture { count += 1 }', 'font')).toBe('        Text("A").font(.body).onTapGesture { count += 1 }')
    expect(added('        Text("A").padding(8).swipeActions { Button("Delete") { } }', 'opacity')).toBe('        Text("A").padding(8).opacity(1).swipeActions { Button("Delete") { } }')
  })

  it('never writes one before a call only an Image or a ForEach takes', () => {
    expect(added('        Image("photo").resizable().onTapGesture { }', 'padding', 'Image')).toBe('        Image("photo").resizable().onTapGesture { }.padding(16)')
    expect(added('        List {\n            ForEach(0..<3, id: \\.self) { row in\n                Text("Row \\(row)")\n            }\n            .onDelete { _ in }\n        }', 'opacity', 'ForEach'))
      .toBe('        List {\n            ForEach(0..<3, id: \\.self) { row in\n                Text("Row \\(row)")\n            }\n            .onDelete { _ in }\n            .opacity(1)\n        }')
  })

  it('writes on a line of its own under a block’s closing brace', () => {
    expect(added('        VStack {\n            Text("A")\n        }', 'opacity', 'VStack')).toBe('        VStack {\n            Text("A")\n        }\n        .opacity(1)')
    expect(added('        VStack {\n            Text("A")\n        }\n        .padding(8)', 'opacity', 'VStack')).toBe('        VStack {\n            Text("A")\n        }\n        .padding(8)\n        .opacity(1)')
  })

  it('follows a chain already written on one line', () => {
    expect(added('        VStack {\n            Text("A")\n        }.padding(8)', 'opacity', 'VStack')).toBe('        VStack {\n            Text("A")\n        }.padding(8).opacity(1)')
  })

  it('puts a modifier added to a List on the List, and one added to its rows on the rows', () => {
    const list = '        List {\n            ForEach(0..<3, id: \\.self) { row in\n                Text("Row \\(row)")\n            }\n        }'
    expect(added(list, 'opacity', 'List')).toBe(`${list}\n        .opacity(1)`)
    expect(added(list, 'opacity', 'ForEach')).toBe('        List {\n            ForEach(0..<3, id: \\.self) { row in\n                Text("Row \\(row)")\n            }\n            .opacity(1)\n        }')
  })
})

describe('numbers chosen by a condition', () => {
  const view = (body: string) => node(files(`        ${body}`), 'Text')
  const set = (body: string, label: string, value: string) => bodyOf(project(edited(app(`        ${body}`), 'Text', { kind: 'property', control: control(view(body), label)!.id, value })))

  it.each([
    ['Text("A").padding(selected ? 16 : 8)', 'padding', '16', '8', 'pt'],
    ['Text("A").opacity(selected ? 1 : 0.4)', 'opacity', '1', '0.4', '%'],
    ['Text("A").frame(width: selected ? 200 : 100)', 'frame · width', '200', '100', 'pt'],
  ])('%s has a field for each branch', (body, label, then, otherwise, unit) => {
    expect(control(view(body), `${label} · when selected is true`)).toMatchObject({ kind: 'number', unit, value: then })
    expect(control(view(body), `${label} · otherwise`)).toMatchObject({ kind: 'number', unit, value: otherwise })
  })

  it('changes one branch and keeps the condition', () => {
    expect(set('Text("A").padding(selected ? 16 : 8)', 'padding · otherwise', '12')).toBe('        Text("A").padding(selected ? 16 : 12)')
    expect(set('Text("A").opacity(selected ? 1 : 0.4)', 'opacity · when selected is true', '0.9')).toBe('        Text("A").opacity(selected ? 0.9 : 0.4)')
    expect(set('Text("A").frame(width: selected ? 200 : 100)', 'frame · width · otherwise', '80')).toBe('        Text("A").frame(width: selected ? 200 : 80)')
  })

  it('keeps a branch that is not a number in Code', () => {
    expect(control(view('Text("A").padding(selected ? 16 : Double(count))'), 'padding · otherwise')).toBeUndefined()
  })
})

describe('the plainest Swift for padding on every edge', () => {
  const set = (body: string, label: string, value: string) => {
    const view = node(files(`        ${body}`), 'Text')
    return bodyOf(project(edited(app(`        ${body}`), 'Text', { kind: 'property', control: control(view, label)!.id, value })))
  }

  it('writes Edges set to all as a plain padding', () => {
    expect(set('Text("A").padding(.horizontal, 8)', 'Padding edges', 'all')).toBe('        Text("A").padding(8)')
    expect(set('Text("A").padding(.horizontal)', 'Padding edges', 'all')).toBe('        Text("A").padding()')
    expect(set('Text("A").padding(.horizontal, 8)', 'Padding edges', 'vertical')).toBe('        Text("A").padding(.vertical, 8)')
  })

  it('writes an amount for every edge as a plain padding', () => {
    expect(set('Text("A").padding(.all)', 'Padding amount', '8')).toBe('        Text("A").padding(8)')
  })
})

describe('wrapping in another direction', () => {
  const wrapped = (stack: string, layout: 'VStack' | 'HStack' | 'ZStack') => {
    const source = app(`        ${stack} {\n            Text("A")\n            Text("B")\n            Text("C")\n        }`)
    const texts = buildAuthoringModel({ projectId: 'reach', revision: 1, files: project(source) }).nodes.filter(n => n.name === 'Text')
    return bodyOf(project(edited(source, 'Text', { kind: 'layer-wrap', ids: texts.slice(0, 2).map(n => n.id), layout })))
  }
  const expected = (stack: string, group: string) => `        ${stack} {\n            ${group} {\n                Text("A")\n                Text("B")\n            }\n            Text("C")\n        }`

  it('keeps the spacing of the stack the views sat in', () => {
    expect(wrapped('VStack(alignment: .leading, spacing: 12)', 'HStack')).toBe(expected('VStack(alignment: .leading, spacing: 12)', 'HStack(spacing: 12)'))
  })

  it('writes no spacing where that stack has none of its own', () => {
    expect(wrapped('VStack', 'HStack')).toBe(expected('VStack', 'HStack'))
    expect(wrapped('ZStack', 'VStack')).toBe(expected('ZStack', 'VStack'))
  })
})

describe.skipIf(!XCODE)('what Design writes next to Apple modifiers builds in Xcode 27', () => {
  it('for every sample, every section and every new write', () => {
    const sources: string[] = []
    const layered = (body: string, change: LayerChange) => sources.push(text(setLayer(files(`        ${body}`), 'Text', [change])))
    for (const modifier of [...APPLIED, ...NOT_DRAWN, '.accessibilityIdentifier("total")']) {
      layered(`Text("A")${modifier}`, { section: 'layout', padding: evenInsets(12) })
      sources.push(edited(app(`        Text("A")${modifier}`), 'Text', { kind: 'modifier-add', name: 'opacity' }))
    }
    layered('Text("A").sheet(item: $selection) { item in Text(item.name) }', { section: 'layout', width: { mode: 'fixed', size: 120 } })
    layered('Text("A").task { }', { section: 'fill', fill: { kind: 'color', color: { name: 'red' } } })
    layered('Text("A").background(.red).contextMenu { Button("Copy") { } }', { section: 'corners', corners: { shape: 'rounded', radius: 8, continuous: true } })
    layered('Text("A").padding(8).shadow(color: .black, radius: 4, y: 2)', { section: 'stroke', stroke: { color: { name: 'gray' }, width: 1, position: 'inside' } })
    layered('Text("A").monospacedDigit().swipeActions { Button("Delete") { } }', { section: 'text', alignment: 'center' })
    layered('Text("A").zIndex(1).sensoryFeedback(.success, trigger: count)', { section: 'effects', opacity: 0.5 })
    sources.push(edited(app('        Image("photo").resizable().onTapGesture { }'), 'Image', { kind: 'modifier-add', name: 'padding' }))
    const image = '        Image("photo").onTapGesture { count += 1 }'
    sources.push(edited(app(image), 'Image', { kind: 'property', control: control(node(files(image), 'Image'), 'Image sizing')!.id, value: 'Fit' }))
    sources.push(edited(app('        List {\n            ForEach(0..<3, id: \\.self) { row in\n                Text("Row \\(row)")\n            }\n            .onDelete { _ in }\n        }'), 'ForEach', { kind: 'modifier-add', name: 'opacity' }))
    sources.push(edited(app('        List {\n            ForEach(0..<3, id: \\.self) { row in\n                Text("Row \\(row)")\n            }\n        }'), 'List', { kind: 'modifier-add', name: 'opacity' }))
    for (const [body, label, value] of [
      ['Text("A").padding(selected ? 16 : 8)', 'padding · otherwise', '12'],
      ['Text("A").opacity(selected ? 1 : 0.4)', 'opacity · when selected is true', '0.9'],
      ['Text("A").frame(width: selected ? 200 : 100)', 'frame · width · otherwise', '80'],
      ['Text("A").padding(.horizontal, 8)', 'Padding edges', 'all'],
      ['Text("A").padding(.horizontal)', 'Padding edges', 'all'],
      ['Text("A").padding(.all)', 'Padding amount', '8'],
    ] as const) sources.push(edited(app(`        ${body}`), 'Text', { kind: 'property', control: control(node(files(`        ${body}`), 'Text'), label)!.id, value }))
    const stack = app('        VStack(spacing: 12) {\n            Text("A")\n            Text("B")\n        }')
    const texts = buildAuthoringModel({ projectId: 'reach', revision: 1, files: project(stack) }).nodes.filter(n => n.name === 'Text')
    sources.push(edited(stack, 'Text', { kind: 'layer-wrap', ids: texts.map(n => n.id), layout: 'HStack' }))
    typecheckInXcode(sources)
    expect(sources.length).toBeGreaterThan(80)
  }, 900_000)
})
