import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { tappableProblem, viewsDrawing, type AuthoringNode, type AuthoringSnapshot } from '@studio/shared'
import { APP, XCODE, draw, editWritten as edit, project as files, typecheckInXcode, writtenAs as written } from './helpers/layer-project'

/**
 * Wave 3a: views written in a helper, a computed `some View` property or a function
 * that returns one (doc 18, Concern 2, item 1). Each helper is read once, where it is
 * declared, and every place that calls it points at those views.
 */
beforeEach(resetPipelineState)

/** A screen whose `ContentView` has `members` beside its body, and `declarations` after it. */
const screen = (body: string, members: string, declarations = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    var body: some View {
${body}
    }
${members}
}
${declarations}`

const model = (text: string): AuthoringSnapshot => buildAuthoringModel({ projectId: 'reach', revision: 1, files: files(text) })
const byId = (snapshot: AuthoringSnapshot) => new Map(snapshot.nodes.map(node => [node.id, node]))
/** The views a node holds, as the source writes them. */
const children = (snapshot: AuthoringSnapshot, text: string, node: AuthoringNode) => node.children.map(id => written(text, byId(snapshot).get(id)!))

describe('a computed view property', () => {
  const text = screen(`        VStack {
            header
        }`, `
    var header: some View {
        Text("Header").font(.title)
    }`)

  it('is read once, where it is declared, and its call points at it', () => {
    const snapshot = model(text)
    const definition = snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'header')!
    expect(definition).toBeDefined()
    expect(children(snapshot, text, definition)).toEqual(['Text("Header").font(.title)'])
    const call = snapshot.nodes.find(node => node.definitionId === definition.id)!
    expect(written(text, call)).toBe('header')
    expect(call.name).toBe('header')
    expect(byId(snapshot).get(call.parentId!)?.name).toBe('VStack')
  })
})

describe('a view builder function', () => {
  const text = screen(`        VStack {
            stats(title: "Done", count: 3)
            stats(title: "Left", count: 4)
        }`, `
    @ViewBuilder
    func stats(title: String, count: Int) -> some View {
        HStack {
            Text(title)
            Text("\\(count)")
        }
    }`)

  it('is one set of views, however many places call it', () => {
    const snapshot = model(text)
    const definitions = snapshot.nodes.filter(node => node.kind === 'definition' && node.name === 'stats')
    expect(definitions).toHaveLength(1)
    const calls = snapshot.nodes.filter(node => node.definitionId === definitions[0]!.id)
    expect(calls.map(call => written(text, call))).toEqual(['stats(title: "Done", count: 3)', 'stats(title: "Left", count: 4)'])
    expect(snapshot.nodes.filter(node => node.name === 'HStack')).toHaveLength(1)
  })

  it('reads its parameters as values it is given, and leaves the arguments that give them as written', () => {
    const snapshot = model(text)
    const title = snapshot.nodes.find(node => written(text, node) === 'Text(title)')!
    const content = title.properties.find(property => property.name === 'content')!
    expect(content).toMatchObject({ valueKind: 'component-argument', helperArgument: true, writable: false })
    expect(written(text, { source: content.declaration! } as AuthoringNode)).toBe('title: String')
    const call = snapshot.nodes.find(node => written(text, node) === 'stats(title: "Done", count: 3)')!
    expect(call.properties.map(property => [property.name, property.expression, property.writable])).toEqual([['title', '"Done"', false], ['count', '3', false]])
  })
})

describe('text a helper is given', () => {
  const text = screen(`        VStack {
            ForEach(items) { item in
                row(for: item)
            }
            label("Hello")
            label("World")
        }`, `
    let items = [Item(id: 1, name: "Milk")]

    @ViewBuilder
    func row(for item: Item) -> some View {
        Text(item.name)
    }

    func label(_ title: String) -> some View {
        Text(title)
    }`, `
struct Item: Identifiable {
    let id: Int
    let name: String
}
`)
  /** The read-only field the Text written as `view` shows for its words. */
  const words = (view: string) => model(text).nodes.find(node => written(text, node) === view)!.controls?.find(control => control.id === 'content:data')

  it('shows words the helper is given as data read-only, and says they come from data', () => {
    expect(words('Text(item.name)')).toMatchObject({ kind: 'text', label: 'Text', value: 'item.name', disabledReason: 'This text comes from data. Change it in Code.' })
  })

  it('says words every call writes out are set where the helper is used', () => {
    expect(words('Text(title)')).toMatchObject({ kind: 'text', label: 'Text', value: 'title', disabledReason: 'This text is set where this helper is used. Change it there.' })
  })

  it('says words are data when any call gives them from data', () => {
    const sum = screen('        VStack {\n            label(name)\n            label("Plain")\n        }', '\n    @State private var name = "Ada"\n\n    func label(_ title: String) -> some View {\n        Text(title)\n    }')
    const field = model(sum).nodes.find(node => written(sum, node) === 'Text(title)')!.controls?.find(control => control.id === 'content:data')
    expect(field).toMatchObject({ disabledReason: 'This text comes from data. Change it in Code.' })
  })

  it('is refused where the field is read-only, in the field’s own words', () => {
    expect(edit(text, 'Text(title)', { kind: 'property', control: 'content:data', value: 'Hi' })).toEqual({ refused: 'This text is set where this helper is used. Change it there.' })
  })
})

describe('where helpers are written and called', () => {
  it('reads one in a private extension, in another file too', () => {
    const text = screen('        footer()', '')
    const other = 'import SwiftUI\n\nprivate extension ContentView {\n    func footer() -> some View {\n        Text("Footer")\n    }\n}\n'
    const snapshot = buildAuthoringModel({ projectId: 'reach', revision: 1, files: [{ id: APP, text }, { id: 'Sources/Footer.swift', text: other }] })
    const definition = snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'footer')!
    expect(definition.source.file).toBe('Sources/Footer.swift')
    expect(definition.owner).toBe('ContentView')
    expect(byId(snapshot).get(definition.children[0]!)?.name).toBe('Text')
  })

  it('follows self, and leaves a name a local value hides', () => {
    const text = screen(`        VStack {
            self.header
            ForEach(0..<2, id: \\.self) { header in
                Text("\\(header)")
            }
        }`, `
    var header: some View {
        Text("Header")
    }`)
    const snapshot = model(text)
    const calls = snapshot.nodes.filter(node => node.definitionId && node.name === 'header')
    expect(calls.map(call => written(text, call))).toEqual(['self.header'])
  })

  it('reads a helper given to an overlay as that overlay’s view, which goes with the view it is on', () => {
    const text = screen('        Circle().overlay(badge)', `
    var badge: some View {
        Text("3")
    }`)
    const snapshot = model(text)
    const call = snapshot.nodes.find(node => node.definitionId && node.name === 'badge')!
    expect(byId(snapshot).get(call.parentId!)?.name).toBe('Overlay')
    expect(call.argument).toBe(true)
  })

  it('reads a helper called from another helper, and one nothing calls', () => {
    const text = screen('        header', `
    var header: some View {
        VStack {
            title
        }
    }
    var title: some View {
        Text("Title")
    }
    var unused: some View {
        Text("Unused")
    }`)
    const snapshot = model(text)
    expect(snapshot.nodes.filter(node => node.kind === 'definition').map(node => node.name)).toEqual(['DemoApp', 'ContentView', 'header', 'title', 'unused'])
    const unused = snapshot.nodes.find(node => node.kind === 'definition' && node.name === 'unused')!
    expect(children(snapshot, text, unused)).toEqual(['Text("Unused")'])
    expect(snapshot.nodes.some(node => node.definitionId === unused.id)).toBe(false)
  })

  it('leaves a call that fits none of a function’s overloads, or more than one, as written', () => {
    const text = screen(`        VStack {
            row("A")
            row(title: "B")
        }`, `
    func row(_ title: String) -> some View { Text(title) }
    func row(_ title: String, detail: String = "") -> some View { Text(title + detail) }`)
    const snapshot = model(text)
    expect(snapshot.nodes.filter(node => node.definitionId && node.name === 'row')).toEqual([])
  })
})

describe('what a change to a helper’s view reaches', () => {
  it('says a helper called in a row design changes every row', () => {
    const text = screen(`        List {
            ForEach(0..<3, id: \\.self) { index in
                row(index)
            }
        }`, `
    func row(_ index: Int) -> some View {
        Text("Row").padding(8)
    }`)
    const row = model(text).nodes.find(node => node.name === 'Text')!
    expect(row.properties.find(property => property.name === 'padding')?.scope).toBe('template')
    expect(row.controls?.find(control => control.label === 'padding')?.scope).toBe('All rows in this template')
  })

  it('says a helper called in two places changes both', () => {
    const text = screen(`        VStack {
            badge
            badge
        }`, `
    var badge: some View {
        Text("New").padding(8)
    }`)
    const badge = model(text).nodes.find(node => node.name === 'Text')!
    expect(badge.properties.find(property => property.name === 'padding')?.scope).toBe('definition')
    expect(badge.controls?.find(control => control.label === 'padding')?.scope).toBe('Used in 2 places')
  })
})

describe('the screen a helper belongs to', () => {
  it('keeps the screen’s states once, however many helpers it has', () => {
    const text = screen('        VStack { header; footer() }', `
    @State private var on = false
    var header: some View { Text("Header") }
    func footer() -> some View { Toggle("On", isOn: $on) }`)
    expect(model(text).inputs?.map(input => input.name)).toEqual(['on'])
  })
})

describe('changing a helper’s views', () => {
  const text = screen(`        VStack {
            header
            stats(count: 3)
        }`, `
    var header: some View {
        Text("Header")
    }

    @ViewBuilder
    func stats(count: Int) -> some View {
        Text("Count")
        Text("\\(count)")
    }`)

  it('writes a layer change where the view is written, inside the helper', () => {
    const after = edit(text, 'Text("Header")', { kind: 'layer-set', changes: [{ section: 'layout', padding: { top: 12, leading: 12, bottom: 12, trailing: 12 } }] })
    expect(after).toEqual({ text: text.replace('Text("Header")', 'Text("Header").padding(12)') })
  })

  it('adds a modifier from the catalog to a view inside a helper, and to the call of a function', () => {
    expect(edit(text, 'Text("Count")', { kind: 'modifier-add', name: 'opacity' })).toEqual({ text: text.replace('Text("Count")', 'Text("Count").opacity(1)') })
    const call = model(text).nodes.find(node => node.name === 'stats' && node.kind !== 'definition')!
    expect(call.modifierCatalog?.find(entry => entry.name === 'opacity')?.available).toBe(true)
    expect(edit(text, 'stats(count: 3)', { kind: 'modifier-add', name: 'opacity' })).toEqual({ text: text.replace('stats(count: 3)', 'stats(count: 3).opacity(1)') })
  })

  it('adds a view beside one in a view builder, and refuses one beside a helper’s only view', () => {
    expect(edit(text, 'Text("Count")', { kind: 'insert', snippet: 'Text("New")' })).toEqual({ text: text.replace('Text("Count")\n', 'Text("Count")\n        Text("New")\n') })
    expect(edit(text, 'Text("Header")', { kind: 'insert', snippet: 'Text("New")' })).toEqual({ refused: '`header` can hold only one view, so this change would stop the app from building. Nothing was changed.' })
  })

  it('deletes a view from a helper, but never its only one', () => {
    expect(edit(text, 'Text("Count")', { kind: 'delete' })).toEqual({ text: text.replace('        Text("Count")\n', '') })
    expect(edit(text, 'Text("Header")', { kind: 'delete' })).toEqual({ refused: 'This is the only view here, and this spot can’t be left empty. Add another view first, or delete what holds it.' })
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds every change written inside a helper', () => {
      const changed = [
        edit(text, 'Text("Header")', { kind: 'layer-set', changes: [{ section: 'layout', padding: { top: 12, leading: 12, bottom: 12, trailing: 12 } }] }),
        edit(text, 'stats(count: 3)', { kind: 'modifier-add', name: 'opacity' }),
        edit(text, 'Text("Count")', { kind: 'insert', snippet: 'Text("New")' }),
        edit(text, 'Text("Count")', { kind: 'delete' }),
      ]
      typecheckInXcode([text, ...changed.map(result => 'text' in result ? result.text : '')])
    }, 120_000)
  })
})

describe('a helper nothing calls', () => {
  const text = screen(`        VStack {
            Text("Body")
        }`, `
    private var header: some View {
        Text("Header")
            .font(.title)
    }

    func caption() -> String {
        "Caption"
    }`)
  const helper = (source: string) => model(source).nodes.find(node => node.kind === 'definition' && node.name === 'header')!
  /** The planner's answer to removing the `header` helper from `source`. */
  const removed = (source: string): { text: string } | { refused: string } => {
    const target = helper(source)
    const plan = planDesignEdit({ projectId: 'reach', baseRevision: 1, files: files(source), scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation: { kind: 'delete' } })
    return plan.ok ? { text: plan.changes[0]?.after ?? source } : { refused: plan.reason }
  }

  it('is read where it is declared, and its views change there', () => {
    expect(children(model(text), text, helper(text))).toEqual(['Text("Header")\n            .font(.title)'])
    expect(edit(text, 'Text("Header")\n            .font(.title)', { kind: 'property', control: 'content', value: 'Title' })).toEqual({ text: text.replace('Text("Header")', 'Text("Title")') })
  })

  it('is removed from Design, with nothing left of it', () => {
    expect(removed(text)).toEqual({ text: text.replace(`
    private var header: some View {
        Text("Header")
            .font(.title)
    }
`, '') })
  })

  it('stays when anything else reads its name, which only Code can follow', () => {
    const read = text.replace('        "Caption"', '        String(describing: header)')
    expect(removed(read)).toEqual({ refused: 'Something else in the code reads header. Remove it in Code.' })
  })

  it('stays while a place uses it', () => {
    const used = text.replace('            Text("Body")', '            header')
    expect(removed(used)).toEqual({ refused: 'header is still used. Delete the places that use it first, or remove it in Code.' })
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds once the helper is removed', () => {
      const result = removed(text)
      typecheckInXcode(['text' in result ? result.text : result.refused])
    }, 120_000)
  })
})

describe('a helper’s views on the canvas', () => {
  it('are what a click on them selects, each place they are drawn', () => {
    const text = screen(`        VStack {
            badge
            badge
        }`, `
    var badge: some View {
        Text("New")
    }`)
    const result = draw(files(text))
    const snapshot = result.authoring!
    const badge = snapshot.nodes.find(node => node.name === 'Text')!
    expect(badge.runtimeIds).toHaveLength(2)
    expect(badge.runtimeIds.map(id => snapshot.runtimeToSource[id])).toEqual([badge.id, badge.id])
  })

  it('are drawn for each call, which the canvas outlines as the call', () => {
    const text = screen(`        VStack {
            badge
            self.badge
            stats(count: 3).padding(4)
        }`, `
    var badge: some View {
        Text("New")
    }
    func stats(count: Int) -> some View {
        HStack { Text("Count"); Text("\\(count)") }
    }`)
    const result = draw(files(text))
    const calls = result.authoring!.nodes.filter(node => node.kind === 'component' && node.definitionId && node.name !== 'ContentView')
    expect(calls.map(call => [written(text, call), call.runtimeIds.length])).toEqual([['badge', 1], ['self.badge', 1], ['stats(count: 3).padding(4)', 1]])
  })

  it('leave the screen named for its view when its body is a helper', () => {
    const text = screen('        content', `
    var content: some View {
        Text("All of it")
    }`)
    const result = draw(files(text), { allPages: true })
    expect(result.pages?.map(page => viewsDrawing(page).map(view => view.name))).toEqual([['ContentView']])
  })
})

describe('what a helper’s views can do on their own', () => {
  const text = screen(`        VStack {
            header
            Button { } label: {
                header
            }
            Text("Body")
        }`, `
    var header: some View {
        Text("Header")
    }`)
  const view = (source: string) => model(text).nodes.find(node => node.kind !== 'definition' && written(text, node) === source)!

  it('makes a helper’s only view tappable, unless a place it is used is tappable already', () => {
    const lone = screen('        VStack {\n            header\n            Text("Body")\n        }', '\n    var header: some View {\n        Text("Header")\n    }')
    const snapshot = model(lone)
    expect(tappableProblem(snapshot.nodes, snapshot.nodes.find(node => written(lone, node) === 'Text("Header")')!)).toBeNull()
    expect(tappableProblem(model(text).nodes, view('Text("Header")'))).toBe('It is inside something tappable already. Select that to set what a tap does.')
  })

  it('names the helper when a view would move into or out of it', () => {
    const moved = edit(text, 'Text("Body")', { kind: 'moveTo', targetOffset: text.indexOf('Text("Header")'), position: 'after' })
    expect(moved).toEqual({ refused: 'Move it within header, or out of it in Code. A view moved into or out of a helper would change every place it is used.' })
  })
})

describe('a helper written in an extension', () => {
  it('belongs to its view, whose actions and states its controls use', () => {
    const text = screen('        footer', `
    @State private var on = false
    func save() { }`, `
private extension ContentView {
    var footer: some View {
        VStack {
            Button("Save") { }
            Toggle("On", isOn: $on)
        }
    }
}
`)
    const nodes = model(text).nodes
    expect(nodes.find(node => node.name === 'Button')?.behavior?.actions).toEqual(['save'])
    expect(nodes.find(node => node.name === 'Toggle')?.behavior?.states.map(state => state.name)).toEqual(['on'])
  })
})

describe('modifiers on a helper read as a property', () => {
  const text = screen(`        VStack {
            header
            header.padding(8)
            Text("Body")
        }`, `
    var header: some View {
        Text("Header")
    }`)
  const call = (source: string) => model(text).nodes.find(node => node.kind === 'component' && written(text, node) === source)!

  it('reads them as a view’s modifiers and layer, and opens the Add list', () => {
    expect(call('header').modifierCatalog?.find(entry => entry.name === 'opacity')?.available).toBe(true)
    const padded = call('header.padding(8)')
    expect(padded.modifiers?.map(modifier => modifier.name)).toEqual(['padding'])
    expect(padded.layer?.layout.padding).toMatchObject({ value: { top: 8, leading: 8, bottom: 8, trailing: 8 }, state: 'literal' })
  })

  it('writes them after the helper’s name, as a function call’s are', () => {
    expect(edit(text, 'header', { kind: 'modifier-add', name: 'opacity' })).toEqual({ text: text.replace('            header\n', '            header.opacity(1)\n') })
    expect(edit(text, 'header.padding(8)', { kind: 'layer-set', changes: [{ section: 'layout', padding: { top: 12, leading: 12, bottom: 12, trailing: 12 } }, { section: 'effects', opacity: 0.5 }] }))
      .toEqual({ text: text.replace('header.padding(8)', 'header.padding(12).opacity(0.5)') })
  })

  it('leaves a stored view, which is no helper, as written', () => {
    const card = screen('        Card { Text("A") }', '', `
struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content.padding(8)
    }
}`)
    const content = model(card).nodes.find(node => written(card, node) === 'content.padding(8)')!
    expect(content).toMatchObject({ kind: 'opaque', name: 'Custom expression' })
    expect(content.modifiers).toBeUndefined()
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds the modifiers written after a helper’s name', () => {
      const changed = [
        edit(text, 'header', { kind: 'modifier-add', name: 'opacity' }),
        edit(text, 'header.padding(8)', { kind: 'layer-set', changes: [{ section: 'layout', padding: { top: 12, leading: 12, bottom: 12, trailing: 12 } }, { section: 'effects', opacity: 0.5 }] }),
      ]
      typecheckInXcode(changed.map(result => 'text' in result ? result.text : ''))
    }, 120_000)
  })
})

describe('what a helper’s views inherit', () => {
  it('reads the font from around the one place the helper is used, and from nowhere when it is used in several', () => {
    const once = screen('        VStack {\n            header\n        }\n        .font(.headline)', '\n    var header: some View {\n        Text("Header")\n    }')
    const font = (text: string) => model(text).nodes.find(node => node.name === 'Text')!.properties.find(property => property.name === 'font')!
    expect(font(once)).toMatchObject({ expression: '.headline', valueKind: 'inherited' })
    const twice = once.replace('            header\n', '            header\n            header\n')
    expect(font(twice)).toMatchObject({ expression: 'Environment / call site', valueKind: 'inherited' })
  })
})

describe('a helper that takes views', () => {
  it('reads the views a call gives it as its Content, where they are written', () => {
    const text = screen('        card(title: "Plans") {\n            Text("Inside")\n        }', `
    func card<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack {
            Text(title)
            content()
        }
    }`)
    const snapshot = model(text)
    const call = snapshot.nodes.find(node => node.kind === 'component' && node.name === 'card')!
    expect(call.children.map(id => byId(snapshot).get(id)!).map(slot => `${slot.name}: ${children(snapshot, text, slot).join(', ')}`)).toEqual(['Content: Text("Inside")'])
    const result = draw(files(text))
    expect(result.authoring!.nodes.find(node => node.name === 'Text' && written(text, node) === 'Text("Inside")')?.runtimeIds).toHaveLength(1)
  })
})
