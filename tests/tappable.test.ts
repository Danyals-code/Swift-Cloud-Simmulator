import { beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { applyProjectTransaction, DocumentHistory, projectFromFiles } from '@studio/project-model'
import type { AuthoringNode, DesignEditRequest, SourceFile } from '@studio/shared'

/**
 * Tappable cards and rows (D16): any view can be made tappable, as a Button or a
 * NavigationLink with the view as its label, and keeps its look while it is.
 */
beforeEach(resetPipelineState)
const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
const model = (text: string) => buildAuthoringModel({ projectId: 'tap', revision: 1, files: files(text) })
/** The model with each view's settings, as the studio reads it. */
const enriched = (text: string) => compile({ projectId: 'tap', revision: 1, files: files(text), canvas: { width: 402, height: 874 }, colorScheme: 'light' }).authoring!.nodes
const APP = `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`
const screen = (body: string, members = '') => `${APP}
struct ContentView: View {${members}
    var body: some View {
${body}
    }
}
`
const CARD = `        VStack(spacing: 12) {
            Text("Club")
            VStack(alignment: .leading) {
                Text("Mia")
                Text("Designer")
            }
            .padding()
        }`

function plan(text: string, node: AuthoringNode, operation: DesignEditRequest['operation']) {
  return planDesignEdit({ projectId: 'tap', baseRevision: 1, files: files(text), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
}
/** The view named `name`, the `index`th in the file. */
const view = (text: string, name: string, index = 0) => model(text).nodes.filter(node => node.name === name && node.kind === 'view')[index]!
function edit(text: string, name: string, index: number, operation: DesignEditRequest['operation']) {
  const result = plan(text, view(text, name, index), operation)
  if (!result.ok) throw new Error(result.reason)
  return result.changes[0]?.after ?? text
}

describe('making a view tappable (D16)', () => {
  it('wraps a card in a Button whose label is the card, and keeps its look', () => {
    expect(edit(screen(CARD), 'VStack', 1, { kind: 'make-tappable' })).toBe(screen(`        VStack(spacing: 12) {
            Text("Club")
            Button {
            } label: {
                VStack(alignment: .leading) {
                    Text("Mia")
                    Text("Designer")
                }
                .padding()
            }
            .buttonStyle(.plain)
        }`))
  })
})

function render(text: string) {
  const result = compile({ projectId: 'tap', revision: 1, files: files(text), canvas: { width: 402, height: 874 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}
const texts = (result: ReturnType<typeof compile>) => result.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []).join(' ')
/** Taps what is drawn with `text` on it, as a finger would. */
function tap(result: ReturnType<typeof compile>, text: string) {
  const target = result.renderTree?.nodes.find(n => n.hitTarget && n.a11y?.label?.includes(text))
  expect(target, text).toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(2)
}

describe('When tapped on a card (D16)', () => {
  it('pushes a new screen with the card as the link, in one step', () => {
    const pushed = edit(screen(CARD), 'VStack', 1, { kind: 'guided-action', action: { type: 'navigate', destination: 'DetailsScreen' }, replace: false, createScreen: { name: 'DetailsScreen', title: 'Club details' } })
    expect(pushed).toContain(`NavigationLink { DetailsScreen() } label: {
                    VStack(alignment: .leading) {
                        Text("Mia")
                        Text("Designer")
                    }
                    .padding()
                }
                .buttonStyle(.plain)`)
    expect(pushed.match(/NavigationStack/g)).toHaveLength(1)
    expect(texts(tap(render(pushed), 'Mia'))).toContain('Club details')
  })

  it('keeps the card selected after a push, as the link around it is no layer of its own', () => {
    const result = plan(screen(CARD), view(screen(CARD), 'VStack', 1), { kind: 'guided-action', action: { type: 'navigate', destination: 'DetailsScreen' }, replace: false, createScreen: { name: 'DetailsScreen', title: 'Club details' } })
    if (!result.ok) throw new Error(result.reason)
    expect(result.changes[0]!.after.slice(result.selection!.offset)).toMatch(/^VStack\(alignment: \.leading\)/)
  })

  it('opens a sheet from the card, with the sheet under it in line with its style', () => {
    const opened = edit(screen(CARD), 'VStack', 1, { kind: 'guided-action', action: { type: 'sheet', destination: 'DetailsScreen' }, replace: false, createScreen: { name: 'DetailsScreen', title: 'Club details' } })
    expect(opened).toContain(`            Button { isDetailsScreenPresented = true } label: {
                VStack(alignment: .leading) {
                    Text("Mia")
                    Text("Designer")
                }
                .padding()
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $isDetailsScreenPresented) { DetailsScreen() }`)
    expect(opened).toContain('@State private var isDetailsScreenPresented: Bool = false')
    expect(texts(tap(render(opened), 'Mia'))).toContain('Club details')
  })

  it('covers the whole screen from the card, goes back from it, or sets a value, all as its label', () => {
    const cover = edit(screen(CARD), 'VStack', 1, { kind: 'guided-action', action: { type: 'cover', destination: 'DetailsScreen' }, replace: false, createScreen: { name: 'DetailsScreen', title: 'Club details' } })
    expect(cover).toContain(`            Button { isDetailsScreenPresented = true } label: {`)
    expect(cover).toContain(`            .buttonStyle(.plain)
            .fullScreenCover(isPresented: $isDetailsScreenPresented) { DetailsScreen() }`)
    const back = edit(screen(CARD), 'VStack', 1, { kind: 'guided-action', action: { type: 'dismiss', state: '' }, replace: false })
    expect(back).toContain('@Environment(\\.dismiss) private var dismiss')
    expect(back).toContain(`            Button { dismiss() } label: {`)
    const set = edit(screen(CARD), 'VStack', 1, { kind: 'guided-action', action: { type: 'set', state: 'status', value: 'Going' }, replace: false, createValue: { name: 'status', value: 'Maybe' } })
    expect(set).toContain('@State private var status: String = "Maybe"')
    expect(set).toContain(`            Button { status = "Going" } label: {`)
    for (const text of [cover, back, set]) { resetPipelineState(); render(text) }
  })

  it('switches a value from the card, and asks for no title to change', () => {
    const switched = edit(screen(CARD), 'VStack', 1, { kind: 'guided-action', action: { type: 'toggle', state: 'isFavorite' }, replace: false, createValue: { name: 'isFavorite', value: false } })
    expect(switched).toContain(`            Button { isFavorite.toggle() } label: {
                VStack(alignment: .leading) {`)
    expect(switched).toContain('@State private var isFavorite: Bool = false')
    render(switched)
  })
})

describe('When tapped on the buttons AI writes (D16)', () => {
  const ICON = `        VStack {
            Button {
            } label: {
                Label("Add", systemImage: "plus")
            }
        }`
  it('sets what a Button with a label does, as it does for a titled one', () => {
    const button = model(screen(ICON)).nodes.find(node => node.name === 'Button')!
    const settings = enriched(screen(ICON)).find(node => node.id === button.id)?.behavior
    expect(settings).toMatchObject({ canConfigureAction: true, canMakeTappable: false, titled: false })
    const set = edit(screen(ICON), 'Button', 0, { kind: 'guided-action', action: { type: 'toggle', state: 'isAdding' }, replace: false, createValue: { name: 'isAdding', value: false } })
    expect(set).toContain(`            Button { isAdding.toggle() } label: {
                Label("Add", systemImage: "plus")
            }`)
    const pushed = edit(screen(ICON), 'Button', 0, { kind: 'guided-action', action: { type: 'navigate', destination: 'AddScreen' }, replace: false, createScreen: { name: 'AddScreen', title: 'Add' } })
    expect(pushed).toContain(`NavigationLink { AddScreen() } label: {
                    Label("Add", systemImage: "plus")
                }`)
  })
})

describe('what cannot be made tappable (D16)', () => {
  const settingsOf = (text: string, name: string, index = 0) => {
    const node = view(text, name, index)
    return enriched(text).find(item => item.id === node.id)?.behavior
  }
  it('says why, for a control, a list, the screen itself and a view in a button', () => {
    const text = screen(`        VStack {
            Toggle("Alerts", isOn: .constant(true))
            List {
                Text("Row")
            }
            Button {
            } label: {
                Text("Inside")
            }
        }`)
    expect(settingsOf(text, 'Text', 1)?.canMakeTappable).toBe(false)
    expect(settingsOf(text, 'Text', 0)?.canMakeTappable).toBe(true)
    for (const [name, reason] of [['Toggle', /takes taps already/], ['List', /scrolls/], ['VStack', /screen itself/]] as const) {
      const result = plan(text, view(text, name), { kind: 'make-tappable' })
      expect(result.ok ? '' : result.reason, name).toMatch(reason)
    }
    const inside = plan(text, view(text, 'Text', 1), { kind: 'make-tappable' })
    expect(inside.ok ? '' : inside.reason).toMatch(/inside something tappable/)
  })

  it('knows the screen itself under what frames it, a navigation stack or a scroll view', () => {
    const text = screen(`        NavigationStack {
            ScrollView {
                VStack {
                    Text("Mia")
                    Text("Leo")
                }
            }
        }`)
    const content = plan(text, view(text, 'VStack'), { kind: 'make-tappable' })
    expect(content.ok ? '' : content.reason).toMatch(/screen itself/)
    expect(settingsOf(text, 'VStack')?.canMakeTappable).toBe(false)
    expect(settingsOf(text, 'Text')?.canMakeTappable).toBe(true)
    // A row a repeat draws is one of many, even as the list's only view.
    const rows = screen(`        List {
            ForEach(["Mia", "Leo"], id: \\.self) { name in
                Text(name)
            }
        }`)
    expect(settingsOf(rows, 'Text')?.canMakeTappable).toBe(true)
  })
})

describe('changing how a tappable card opens (D16)', () => {
  const PUSHED = `        NavigationStack {
            VStack {
                NavigationLink { DetailsScreen() } label: {
                    Text("Mia")
                }
                .buttonStyle(.plain)
            }
        }`
  const DETAILS = `
struct DetailsScreen: View {
    var body: some View {
        Text("Club details")
    }
}
`
  it('turns a pushed card into one that opens a sheet, and back, keeping the card', () => {
    const sheet = edit(screen(PUSHED) + DETAILS, 'NavigationLink', 0, { kind: 'navigation-type', type: 'sheet' })
    expect(sheet).toContain(`                Button { isDetailsScreenPresented = true } label: {
                    Text("Mia")
                }
                .buttonStyle(.plain)
                .sheet(isPresented: $isDetailsScreenPresented) { DetailsScreen() }`)
    expect(texts(tap(render(sheet), 'Mia'))).toContain('Club details')
    resetPipelineState()
    const back = edit(sheet, 'Button', 0, { kind: 'navigation-type', type: 'push' })
    expect(back).toBe(screen(PUSHED) + DETAILS)
  })
})

describe('a copy of a component (D16)', () => {
  const ROWS = `        VStack {
            PlaceRow(name: "Harbor Walk")
            PlaceRow(name: "Old Town")
        }`
  const PLACE_ROW = `
struct PlaceRow: View {
    let name: String
    var body: some View {
        HStack {
            Image(systemName: "map")
            Text(name)
        }
    }
}
`
  it('is tappable like any view, with the whole copy as the label', () => {
    const text = screen(ROWS) + PLACE_ROW
    const copy = enriched(text).find(node => node.kind === 'component' && node.name === 'PlaceRow')!
    expect(copy.behavior).toMatchObject({ canConfigureAction: false, canMakeTappable: true })
    const result = plan(text, copy, { kind: 'guided-action', action: { type: 'sheet', destination: 'DetailsScreen' }, replace: false, createScreen: { name: 'DetailsScreen', title: 'Place' } })
    if (!result.ok) throw new Error(result.reason)
    const opened = result.changes[0]!.after
    expect(opened).toContain(`            Button { isDetailsScreenPresented = true } label: {
                PlaceRow(name: "Harbor Walk")
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $isDetailsScreenPresented) { DetailsScreen() }
            PlaceRow(name: "Old Town")`)
    expect(texts(tap(render(opened), 'Harbor Walk'))).toContain('Place')
  })
})

describe('a tappable card as an edit (D16)', () => {
  it('refuses a view that changed since it was selected', () => {
    const node = view(screen(CARD), 'VStack', 1)
    const changed = screen(CARD).replace('Text("Mia")', 'Text("Leo")')
    const result = planDesignEdit({ projectId: 'tap', baseRevision: 1, files: files(changed), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'make-tappable' } })
    expect(result.ok).toBe(false)
  })

  it('is one undo step, wrap and action together', () => {
    const project = projectFromFiles([{ name: 'Sources/App.swift', text: screen(CARD) }])!
    const text = project.files[0]!.text, node = view(text, 'VStack', 1)
    const plan = planDesignEdit({ projectId: project.id, baseRevision: 1, files: project.files, scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation: { kind: 'guided-action', action: { type: 'toggle', state: 'isFavorite' }, replace: false, createValue: { name: 'isFavorite', value: false } } })
    if (!plan.ok) throw new Error(plan.reason)
    const done = applyProjectTransaction(project, 1, plan)
    if (!done.ok) throw new Error('The edit was not kept.')
    expect(done.project.files[0]!.text).toContain('Button { isFavorite.toggle() } label: {')
    const history = new DocumentHistory()
    history.record(project, done.project, { file: node.source.file, offset: node.source.start }, plan.selection)
    expect(history.take('undo', done.project)?.project.files).toEqual(project.files)
    expect(history.take('redo', project)?.project.files).toEqual(done.project.files)
  })
})

/**
 * Does what D16 writes build in Xcode 27? Opt-in, as `tests/xcode-build.test.ts` is:
 *
 *     XCODE_BUILD=1 npx vitest run tests/tappable.test.ts
 */
describe.skipIf(process.env.XCODE_BUILD !== '1')('what a tappable card is written as typechecks in Xcode', () => {
  it('for every action, a row, an icon button and a push turned into a sheet and back', () => {
    const made = (name: string, index: number, operation: DesignEditRequest['operation'], text = screen(CARD)) => edit(text, name, index, operation)
    const screenMade = { replace: false, createScreen: { name: 'DetailsScreen', title: 'Details' } }
    const pushed = made('VStack', 1, { kind: 'guided-action', ...screenMade, action: { type: 'navigate', destination: 'DetailsScreen' } })
    const sheet = edit(pushed, 'NavigationLink', 0, { kind: 'navigation-type', type: 'sheet' })
    const shapes = [
      made('VStack', 1, { kind: 'make-tappable' }),
      pushed, sheet, edit(sheet, 'Button', 0, { kind: 'navigation-type', type: 'push' }),
      made('VStack', 1, { kind: 'guided-action', ...screenMade, action: { type: 'sheet', destination: 'DetailsScreen' } }),
      made('VStack', 1, { kind: 'guided-action', ...screenMade, action: { type: 'cover', destination: 'DetailsScreen' } }),
      made('VStack', 1, { kind: 'guided-action', replace: false, action: { type: 'dismiss', state: '' } }),
      made('VStack', 1, { kind: 'guided-action', replace: false, action: { type: 'toggle', state: 'isFavorite' }, createValue: { name: 'isFavorite', value: false } }),
      made('VStack', 1, { kind: 'guided-action', replace: false, action: { type: 'set', state: 'status', value: 'Going' }, createValue: { name: 'status', value: 'Maybe' } }),
      made('Button', 0, { kind: 'guided-action', ...screenMade, action: { type: 'navigate', destination: 'DetailsScreen' } }, screen(`        VStack {
            Button {
            } label: {
                Label("Add", systemImage: "plus")
            }
        }`)),
    ]
    const rows = screen(`        List {
            ForEach(["Harbor Walk", "Old Town"], id: \\.self) { name in
                PlaceRow(name: name)
            }
        }`, '') + `
struct PlaceRow: View {
    let name: String
    var body: some View {
        HStack {
            Image(systemName: "map")
            Text(name)
        }
    }
}
`
    const row = model(rows).nodes.find(node => node.kind === 'component' && node.name === 'PlaceRow')!
    const pushedRow = plan(rows, row, { kind: 'guided-action', ...screenMade, action: { type: 'navigate', destination: 'DetailsScreen' } })
    if (!pushedRow.ok) throw new Error(pushedRow.reason)
    shapes.push(pushedRow.changes.map(change => change.after).join('\n'))
    const root = mkdtempSync(join(tmpdir(), 'studio-tappable-'))
    try {
      const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).trim()
      for (const [index, text] of shapes.entries()) {
        const file = join(root, `Shape${index}.swift`)
        writeFileSync(file, text)
        execFileSync('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-typecheck', '-parse-as-library', '-sdk', sdk, '-target', 'arm64-apple-ios27.0-simulator', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
