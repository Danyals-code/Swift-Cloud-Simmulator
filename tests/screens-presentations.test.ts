import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileResult, PagePreview, RenderTree } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { XCODE, typecheckInXcode } from './helpers/layer-project'
import { layerForRenderNode } from '../apps/web/lib/layers'
import { designTree } from '../apps/web/lib/designTree'
import { pageSlots } from '../apps/web/lib/pageLayout'

/**
 * Wave 3b-2: every way SwiftUI presents or pushes a screen is a screen in Design (doc 18,
 * Concern 1 item 11 and Concern 2 item 9). Each is drawn in the gallery under the screen
 * that opens it, or listed as not drawn with what it needs.
 */
beforeEach(resetPipelineState)

let revision = 0
const options = { canvas: { width: 402, height: 874 }, safeArea: { top: 59, leading: 0, bottom: 34, trailing: 0 }, colorScheme: 'light' as const, allPages: true }
const texts = (tree: RenderTree) => tree.nodes.flatMap(node => node.text?.runs.map(run => run.text) ?? []).join(' ')

function run(body: string, state = '', declarations = ''): CompileResult {
  const result = compile({ ...options, files: [{ id: 'App.swift', text: `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    ${state}
    var body: some View {
        ${body}
    }
}
${declarations}` }], revision: ++revision })
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result
}
const children = (result: CompileResult): PagePreview[] => result.pages!.filter(page => page.parentId)
/** The app after a tap on the control labelled `label`, as the running preview draws it. */
function tap(result: CompileResult, label: string): CompileResult {
  const target = result.renderTree!.nodes.find(node => node.a11y?.label === label && node.hitTarget)
  expect(target, label).toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(++revision)
}
const back = (result: CompileResult) => {
  const button = result.renderTree!.nodes.find(node => node.hitTarget?.handlerId.endsWith('/back'))
  expect(button).toBeDefined()
  expect(applyEvent({ kind: 'tap', handlerId: button!.hitTarget!.handlerId, location: { x: 0, y: 0 } })).toBe(true)
  return rerender(++revision)
}

const BOOK = 'struct Book: Identifiable { let id: Int; let title: String }'
const DETAIL = 'struct BookDetail: View { let book: Book; var body: some View { Text("Reading \\(book.title)") } }'

describe('a sheet opened with an item that is nil', () => {
  it('is drawn with the first record of the list the view holds, named after the view it shows', () => {
    const result = run('List(books) { book in Button(book.title) { selected = book } }\n            .sheet(item: $selected) { book in BookDetail(book: book) }',
      '@State private var books = [Book(id: 1, title: "Emma"), Book(id: 2, title: "Persuasion")]\n    @State private var selected: Book?', `${BOOK}\n${DETAIL}`)
    expect(children(result).map(page => [page.kind, page.name])).toEqual([['sheet', 'BookDetail']])
    expect(texts(children(result)[0]!.tree)).toContain('Reading Emma')
    expect(result.pagesNotDrawn).toBeUndefined()
  })

  it('takes the record from a model the view holds, for a cover and a popover too', () => {
    const model = '@Observable final class Shelf { var books = [Book(id: 1, title: "Emma")]; var selected: Book?; var opened: Book? }'
    const result = run('VStack { Text("Shelf") }\n            .fullScreenCover(item: $shelf.selected) { book in BookDetail(book: book) }\n            .popover(item: $shelf.opened) { book in Text("Popover for \\(book.title)") }',
      '@State private var shelf = Shelf()', `${BOOK}\n${DETAIL}\n${model}`)
    expect(children(result).map(page => [page.kind, page.name])).toEqual([['cover', 'BookDetail'], ['popover', 'Popover']])
    expect(texts(children(result)[0]!.tree)).toContain('Reading Emma')
    expect(texts(children(result)[1]!.tree)).toContain('Popover for Emma')
  })

  it('is listed as not drawn when nothing holds a record of its type, saying what it needs', () => {
    const result = run('Text("Shelf")\n            .sheet(item: $selected) { book in BookDetail(book: book) }', '@State private var selected: Book?', `${BOOK}\n${DETAIL}`)
    expect(children(result)).toEqual([])
    expect(result.pagesNotDrawn).toEqual(['"BookDetail" isn\'t drawn on the Design canvas: it needs a Book to show, and the view holds no [Book] to take one from.'])
  })

  it('names what it needs with the article its name takes', () => {
    const result = run('Text("Shelf")\n            .sheet(item: $selected) { item in Text(item.title) }', '@State private var selected: Item?', 'struct Item: Identifiable { let id: Int; let title: String }')
    expect(result.pagesNotDrawn).toEqual(['"Sheet" isn\'t drawn on the Design canvas: it needs an Item to show, and the view holds no [Item] to take one from.'])
  })
})

describe('a presentation the gallery cannot draw', () => {
  it('is listed with what stopped it, not dropped', () => {
    const result = run('Text("Notes")\n            .sheet(isPresented: $editing) { Text(note!) }', '@State private var editing = false\n    @State private var note: String? = nil')
    expect(children(result)).toEqual([])
    expect(result.pagesNotDrawn).toEqual([expect.stringMatching(/^"Sheet" isn't drawn on the Design canvas: Swift runtime failure: .*nil/)])
  })

  it('is listed when the preview cannot put it up from where it is written', () => {
    const result = run(`NavigationStack {
            Text("Inbox")
                .toolbar { Button("Clear") { confirming = true }.alert("Clear the inbox?", isPresented: $confirming) { Button("Clear") { } } }
        }`, '@State private var confirming = false')
    expect(children(result)).toEqual([])
    expect(result.pagesNotDrawn).toEqual(['"Clear the inbox?" isn\'t drawn on the Design canvas: the preview can\'t put it up over the screen from where it is written.'])
  })
})

describe('an alert', () => {
  const ALERT = `Text("Inbox")
            .alert("Delete the draft?", isPresented: $confirming) {
                Button("Delete", role: .destructive) { }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This can't be undone.")
            }`

  it('is named by a title written as a Text, as a dialog is', () => {
    const result = run(`Text("Inbox")
            .alert(Text("Delete?"), isPresented: $deleting) { Button("Delete", role: .destructive) { } }
            .confirmationDialog(Text("Options"), isPresented: $choosing) { Button("Archive") { } }`, '@State private var deleting = false\n    @State private var choosing = false')
    expect(children(result).map(page => [page.kind, page.name])).toEqual([['alert', 'Delete?'], ['dialog', 'Options']])
  })

  it('is a page over the screen that shows it, named by its title', () => {
    const result = run(ALERT, '@State private var confirming = false')
    const [alert] = children(result)
    expect(children(result).map(page => [page.kind, page.name, page.parentId])).toEqual([['alert', 'Delete the draft?', 'page:root']])
    expect(texts(alert!.tree)).toBe("Inbox Delete the draft? This can't be undone. Cancel Delete")
  })
  /** Every run of text a tree draws, with its colour. */
  const runs = (tree: RenderTree) => tree.nodes.flatMap(node => node.text?.runs.map(run => [run.text, run.color]) ?? [])
  // iOS 27's label, secondary label, system blue and system red.
  const LABEL = { r: 0, g: 0, b: 0, a: 1 }, SECONDARY = { r: 60, g: 60, b: 67, a: 0.6 }, BLUE = { r: 0, g: 136, b: 255, a: 1 }, RED = { r: 255, g: 56, b: 60, a: 1 }

  it.each([
    ['an alert', ALERT, 'Delete the draft?', [['Inbox', LABEL], ['Delete the draft?', LABEL], ["This can't be undone.", SECONDARY], ['Cancel', BLUE], ['Delete', RED]]],
    ['a confirmation dialog', `Text("Inbox")
            .confirmationDialog("Archive the list?", isPresented: $confirming) {
                Button("Archive") { }
                Button("Delete", role: .destructive) { }
            }`, 'Archive the list?', [['Inbox', LABEL], ['Archive', BLUE], ['Delete', RED]]],
    ['a dialog showing its title', `Text("Inbox")
            .confirmationDialog("Archive the list?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Archive") { }
            } message: {
                Text("You can find it later.")
            }`, 'Archive the list?', [['Inbox', LABEL], ['Archive the list?', LABEL], ['You can find it later.', SECONDARY], ['Archive', BLUE]]],
  ])('draws %s on its page as the running app draws it up', (_, body, title, drawn) => {
    const shown = run(body, '@State private var confirming = true')
    expect(runs(shown.renderTree!)).toEqual(drawn)
    expect(runs(children(shown).find(item => item.name === title)!.tree)).toEqual(drawn)
  })
  const PRESENTING = `Text("Inbox")
            .alert("Delete the draft?", isPresented: $confirming, presenting: draft) { draft in
                Button("Delete \\(draft.title)", role: .destructive) { }
            } message: { draft in
                Text("\\(draft.title) goes for good.")
            }`
  const DRAFT = 'struct Draft { let title: String }'

  it('shows the data it presents, as the running app does', () => {
    const page = run(PRESENTING, '@State private var confirming = false\n    @State private var draft: Draft? = Draft(title: "Notes")', DRAFT)
    expect(texts(children(page)[0]!.tree)).toBe('Inbox Delete the draft? Notes goes for good. Delete Notes')
    const live = run(PRESENTING, '@State private var confirming = true\n    @State private var draft: Draft? = Draft(title: "Notes")', DRAFT)
    expect(texts(live.renderTree!)).toBe('Inbox Delete the draft? Notes goes for good. Delete Notes')
  })

  it('is listed as not drawn while the data it presents is nil, and is not up in the running app', () => {
    const result = run(PRESENTING, '@State private var confirming = true\n    @State private var draft: Draft?', DRAFT)
    expect(children(result)).toEqual([])
    expect(result.pagesNotDrawn).toEqual(['"Delete the draft?" isn\'t drawn on the Design canvas: it shows the data it presents, and that is nil now.'])
    expect(texts(result.renderTree!)).toBe('Inbox')
  })
  it('is listed as not drawn when it is made from an error, which the preview does not draw', () => {
    const result = run('Text("Inbox")\n            .alert(isPresented: $failed, error: problem) { Button("OK") { } }', '@State private var failed = false\n    @State private var problem: LoadError? = LoadError()',
      'struct LoadError: LocalizedError { var errorDescription: String? { "The list didn\'t load." } }')
    expect(children(result)).toEqual([])
    expect(result.pagesNotDrawn).toEqual(['"Alert" isn\'t drawn on the Design canvas: the preview doesn\'t draw an alert made from an error, whose title is its description.'])
  })
})

/** A view's parts as Design lists them, `Slot: views` with the views as written, a slot within a slot in brackets. */
function parts(text: string, written: string): string[] {
  const snapshot = buildAuthoringModel({ projectId: 'screens', revision: 1, files: [{ id: 'App.swift', text }] })
  const byId = new Map(snapshot.nodes.map(node => [node.id, node]))
  const source = (id: string) => { const node = byId.get(id)!; return text.slice(node.source.start, node.source.end) }
  const listed = (id: string): string => {
    const node = byId.get(id)!
    return node.kind === 'branch' ? `${node.name}: [${node.children.map(listed).join(', ')}]` : source(id)
  }
  const owner = snapshot.nodes.find(node => node.kind !== 'branch' && node.kind !== 'definition' && text.slice(node.source.start, node.source.end).startsWith(written))!
  return owner.children.map(listed)
}
const app = (body: string, state = '') => `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    ${state}
    var body: some View {
        ${body}
    }
}
`

describe('an alert in Design', () => {
  it('lists its title, actions and message where they are written', () => {
    expect(parts(app(`Text("Inbox")
            .alert("Delete the draft?", isPresented: $confirming) {
                Button("Delete", role: .destructive) { }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This can't be undone.")
            }`, '@State private var confirming = false'), 'Text("Inbox")')).toEqual([
      'Alert: ["Delete the draft?", Actions: [Button("Delete", role: .destructive) { }, Button("Cancel", role: .cancel) { }], Message: [Text("This can\'t be undone.")]]',
    ])
  })
  const ALERT_APP = app(`Text("Inbox")
            .alert("Delete the draft?", isPresented: $confirming) {
                Button("Delete", role: .destructive) { }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This can't be undone.")
            }`, '@State private var confirming = false')

  /** The file after the view written as `written` has `control` set to `value`, or the planner's reason. */
  function edit(text: string, written: string, control: string, value: string): string {
    const target = buildAuthoringModel({ projectId: 'screens', revision: 1, files: [{ id: 'App.swift', text }] }).nodes.find(node => node.kind !== 'branch' && text.slice(node.source.start, node.source.end) === written)!
    const plan = planDesignEdit({ projectId: 'screens', baseRevision: 1, files: [{ id: 'App.swift', text }], scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation: { kind: 'property', control, value } })
    return plan.ok ? plan.changes[0]!.after : plan.reason
  }

  it('edits its title, message and action labels in place', () => {
    expect(edit(ALERT_APP, '"Delete the draft?"', 'content', 'Discard the draft?')).toBe(ALERT_APP.replace('"Delete the draft?"', '"Discard the draft?"'))
    expect(edit(ALERT_APP, 'Text("This can\'t be undone.")', 'content', 'It goes for good.')).toBe(ALERT_APP.replace('Text("This can\'t be undone.")', 'Text("It goes for good.")'))
    expect(edit(ALERT_APP, 'Button("Delete", role: .destructive) { }', 'title', 'Discard')).toBe(ALERT_APP.replace('Button("Delete"', 'Button("Discard"'))
  })

  it('shows a title that comes from data read only, saying why', () => {
    const text = ALERT_APP.replace('"Delete the draft?"', 'prompt').replace('@State private var confirming = false', '@State private var confirming = false\n    @State private var prompt = "Delete the draft?"')
    const title = buildAuthoringModel({ projectId: 'screens', revision: 1, files: [{ id: 'App.swift', text }] }).nodes.find(node => node.name === 'Text' && text.slice(node.source.start, node.source.end) === 'prompt')!
    expect(title.controls).toEqual([expect.objectContaining({ id: 'content:data', value: 'prompt', disabledReason: 'This text comes from data. Change it in Code.' })])
  })

  it('offers its title nothing to add, as a title takes no modifiers', () => {
    const title = buildAuthoringModel({ projectId: 'screens', revision: 1, files: [{ id: 'App.swift', text: ALERT_APP }] }).nodes.find(node => ALERT_APP.slice(node.source.start, node.source.end) === '"Delete the draft?"')!
    expect(title.controls?.map(control => control.id)).toEqual(['content'])
    expect(title.layer).toBeUndefined()
    expect(title.modifierCatalog).toBeUndefined()
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds what editing an alert writes', () => {
      typecheckInXcode([edit(ALERT_APP, '"Delete the draft?"', 'content', 'Discard "the" draft?'), edit(ALERT_APP, 'Button("Delete", role: .destructive) { }', 'title', 'Discard')])
    }, 120_000)
  })
  /** Whether a click on what the alert's page draws for the view written as `written` selects that view. */
  function selectable(result: CompileResult, text: string, written: string): boolean {
    const node = result.authoring!.nodes.find(item => item.kind !== 'branch' && text.slice(item.source.start, item.source.end) === written)
    const page = children(result).find(item => item.kind === 'alert' || item.kind === 'dialog')!
    return !!node?.runtimeIds.length && page.tree.nodes.some(drawn => node.runtimeIds.includes(layerForRenderNode(page.viewHierarchy ?? [], drawn)?.id ?? ''))
  }

  it.each(['"Delete the draft?"', 'Text("This can\'t be undone.")', 'Button("Delete", role: .destructive) { }'])('selects %s where its page draws it', written => {
    const result = compile({ ...options, files: [{ id: 'App.swift', text: ALERT_APP }], revision: ++revision })
    expect(selectable(result, ALERT_APP, written)).toBe(true)
  })
  it.each([
    ['a title written as a Text', `.alert(Text("Delete the draft?"), isPresented: $confirming) { Button("Delete", role: .destructive) { } }`, ['Text("Delete the draft?")', 'Button("Delete", role: .destructive) { }']],
    ['a dialog', `.confirmationDialog("Archive?", isPresented: $confirming, titleVisibility: .visible) { Button("Archive") { } } message: { Text("You can find it later.") }`, ['"Archive?"', 'Button("Archive") { }', 'Text("You can find it later.")']],
  ])('selects the parts of %s', (_, modifier, written) => {
    const text = app(`Text("Inbox")\n            ${modifier}`, '@State private var confirming = false')
    const result = compile({ ...options, files: [{ id: 'App.swift', text }], revision: ++revision })
    expect(written.filter(view => !selectable(result, text, view))).toEqual([])
  })
})

describe('the Screens list', () => {
  it('lists an alert and a dialog under the screen that shows them, as what they are', () => {
    const result = run(`NavigationStack {
            Text("Inbox")
                .navigationTitle("Inbox")
                .alert("Delete the draft?", isPresented: $confirming) { Button("Delete", role: .destructive) { } }
                .confirmationDialog("Archive?", isPresented: $archiving) { Button("Archive") { } }
                .sheet(isPresented: $composing) { Text("Compose").navigationTitle("Compose") }
        }`, '@State private var confirming = false\n    @State private var archiving = false\n    @State private var composing = false')
    const tree = designTree(result.pages, result.authoring, [])
    expect(tree.lanes[0]!.root.children.map(screen => [screen.presentation, screen.name])).toEqual([['alert', 'Delete the draft?'], ['dialog', 'Archive?']])
    expect(tree.sheets.map(sheet => [sheet.screen.presentation, sheet.screen.name])).toEqual([['sheet', 'Compose']])
    // On the canvas each is beside the screen it is up over, reached as what it is.
    expect(pageSlots(result.pages!).filter(slot => slot.parentId).map(slot => [slot.presentation, slot.page.name])).toEqual([['alert', 'Delete the draft?'], ['dialog', 'Archive?'], ['sheet', 'Compose']])
  })
})

describe('a destination pushed by a binding', () => {
  const PUSHED = `NavigationStack {
            Button("Show settings") { showing = true }
                .navigationTitle("Home")
                .navigationDestination(isPresented: $showing) { SettingsView() }
        }`
  const SETTINGS = 'struct SettingsView: View { var body: some View { Text("Settings form") } }'

  it('is pushed while its binding is true, and Back sets it false', () => {
    let result = run(PUSHED, '@State private var showing = false', SETTINGS)
    expect(result.diagnostics).toEqual([])
    result = tap(result, 'Show settings')
    expect(texts(result.renderTree!)).toContain('Settings form')
    result = back(result)
    expect(texts(result.renderTree!)).toContain('Show settings')
    expect(texts(result.renderTree!)).not.toContain('Settings form')
  })

  it('is a page pushed from the screen that holds it, named after the view it shows', () => {
    const result = run(PUSHED, '@State private var showing = false', SETTINGS)
    expect(children(result).map(page => [page.kind, page.name])).toEqual([['destination', 'SettingsView']])
    expect(texts(children(result)[0]!.tree).trim()).toBe('Settings form')
    expect(children(result)[0]!.tree.nodes.some(node => node.id.endsWith('/backchev'))).toBe(true)
  })
  it('is pushed while an item binding holds a value, and drawn with a record the view holds', () => {
    const body = `NavigationStack {
            List(books) { book in Button(book.title) { selected = book } }
                .navigationDestination(item: $selected) { book in BookDetail(book: book) }
        }`
    const state = '@State private var books = [Book(id: 1, title: "Emma"), Book(id: 2, title: "Persuasion")]\n    @State private var selected: Book?'
    let result = run(body, state, `${BOOK}\n${DETAIL}`)
    expect(result.diagnostics).toEqual([])
    expect(children(result).map(page => [page.kind, page.name])).toEqual([['destination', 'BookDetail']])
    expect(texts(children(result)[0]!.tree)).toContain('Reading Emma')
    result = tap(result, 'Persuasion')
    expect(texts(result.renderTree!)).toContain('Reading Persuasion')
    expect(texts(back(result).renderTree!)).toContain('Emma')
  })
})

describe('a navigation stack bound to a path', () => {
  const STACK = `NavigationStack(path: $path) {
            VStack {
                Button("Open Emma") { path.append("Emma") }
                NavigationLink("Persuasion", value: "Persuasion")
            }
            .navigationTitle("Library")
            .navigationDestination(for: String.self) { title in Text("Reading \\(title), \\(path.count) deep") }
        }`

  it('pushes the destination for what is appended to it, and Back removes it', () => {
    let result = run(STACK, '@State private var path: [String] = []')
    expect(result.diagnostics).toEqual([])
    result = tap(result, 'Open Emma')
    expect(texts(result.renderTree!)).toContain('Reading Emma, 1 deep')
    result = back(result)
    expect(texts(result.renderTree!)).toContain('Open Emma')
    expect(texts(result.renderTree!)).not.toContain('Reading')
  })

  it('appends a link’s value to it', () => {
    const result = tap(run(STACK, '@State private var path: [String] = []'), 'Persuasion')
    expect(texts(result.renderTree!)).toContain('Reading Persuasion, 1 deep')
  })

  it('starts from what it holds', () => {
    const result = run(STACK, '@State private var path = ["Emma", "Persuasion"]')
    expect(texts(result.renderTree!)).toContain('Reading Persuasion, 2 deep')
    expect(texts(back(result).renderTree!)).toContain('Reading Emma, 1 deep')
  })
  const APPENDS = `NavigationStack(path: $path) {
            Button("Open Emma") { path.append("Emma") }
                .navigationDestination(for: String.self) { title in Text("Reading \\(title)").navigationTitle(title) }
        }`

  it('draws the destination for its type as a page, with a value of that type the view holds', () => {
    const result = run(APPENDS, '@State private var path: [String] = []\n    @State private var recent = ["Emma"]')
    expect(children(result).map(page => [page.kind, page.name])).toEqual([['destination', 'Emma']])
    expect(texts(children(result)[0]!.tree)).toContain('Reading Emma')
  })

  it('names its first screen by its own title while the app shows a screen pushed over it', () => {
    const titled = APPENDS.replace('.navigationDestination', '.navigationTitle("Library")\n                .navigationDestination')
    const result = run(titled, '@State private var path = ["Emma"]')
    expect(texts(result.renderTree!)).toContain('Reading Emma')
    expect(result.pages!.map(page => [page.kind, page.name])).toEqual([['root', 'Library'], ['destination', 'Emma']])
  })

  it('lists that destination as not drawn when the path starts empty and the view holds no other value of its type', () => {
    const result = run(APPENDS.replaceAll('String', 'Route').replace('path.append("Emma")', 'path.append(Route(title: "Emma"))').replace('\\(title)', '\\(title.title)').replace('navigationTitle(title)', 'navigationTitle(title.title)'),
      '@State private var path: [Route] = []', 'struct Route: Hashable { let title: String }')
    expect(children(result)).toEqual([])
    expect(result.pagesNotDrawn).toEqual(['"Details" isn\'t drawn on the Design canvas: the path starts empty, and the view holds no other [Route] to take one from.'])
    const numbers = run(APPENDS.replaceAll('String', 'Int').replace('path.append("Emma")', 'path.append(7)').replace('navigationTitle(title)', 'navigationTitle("No. \\(title)")'), '@State private var path: [Int] = []')
    expect(numbers.pagesNotDrawn).toEqual(['"Details" isn\'t drawn on the Design canvas: the path starts empty, and the view holds no other [Int] to take one from.'])
  })
})

describe('a navigation stack bound to a path of enum cases', () => {
  const ROUTED = `NavigationStack(path: $path) {
            Button("Go") { path.append(.detail) }
                .navigationTitle("Home")
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .detail: DetailView()
                    case .settings: SettingsView()
                    }
                }
        }`
  const ROUTES = `enum Route: Hashable { case detail, settings }
struct DetailView: View { var body: some View { Text("Detail page") } }
struct SettingsView: View { var body: some View { Text("Settings page") } }`

  it('pushes the case appended as `.detail`, and Back removes it', () => {
    let result = run(ROUTED, '@State private var path: [Route] = []', ROUTES)
    result = tap(result, 'Go')
    expect(texts(result.renderTree!)).toContain('Detail page')
    result = back(result)
    expect(texts(result.renderTree!)).toContain('Go')
    expect(texts(result.renderTree!)).not.toContain('Detail page')
  })

  it('starts from the cases written in it', () => {
    const result = run(ROUTED, '@State private var path: [Route] = [.detail, .settings]', ROUTES)
    expect(texts(result.renderTree!)).toContain('Settings page')
    expect(texts(back(result).renderTree!)).toContain('Detail page')
  })

  it('reads a case written into a list of its type as that case', () => {
    let result = run('Button(kinds.map(\\.rawValue).joined(separator: ", ")) { kinds.append(.view) }', '@State private var kinds: [SheetKind] = [.edit]', 'enum SheetKind: String { case edit, view }')
    expect(texts(result.renderTree!)).toBe('edit')
    result = tap(result, 'edit')
    expect(texts(result.renderTree!)).toBe('edit, view')
  })

  it('draws each case of its type as a page while it starts empty, named after the view each shows', () => {
    const result = run(ROUTED, '@State private var path: [Route] = []', ROUTES)
    expect(children(result).map(page => [page.kind, page.name])).toEqual([['destination', 'DetailView'], ['destination', 'SettingsView']])
    expect(texts(children(result)[0]!.tree)).toContain('Detail page')
    expect(texts(children(result)[1]!.tree)).toContain('Settings page')
    expect(result.pagesNotDrawn).toBeUndefined()
  })

  it('warns where nothing shows a value pushed onto it, rather than ignoring the tap', () => {
    const result = tap(run(`NavigationStack(path: $path) {
            Button("Go") { path.append(3) }
                .navigationDestination(for: String.self) { title in Text(title) }
        }`, '@State private var path: [Int] = []'), 'Go')
    expect(texts(result.renderTree!)).toBe('Go')
    expect(result.diagnostics.filter(d => !result.pagesNotDrawn?.includes(d.message)).map(d => [d.severity, d.message]))
      .toEqual([['warning', 'This NavigationStack shows nothing for the Int on its path: no navigationDestination(for: Int.self) is written inside it.']])
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds the paths of cases these tests draw', () => {
      typecheckInXcode([
        `${app(ROUTED, '@State private var path: [Route] = [.detail, .settings]')}${ROUTES}`,
        `${app('Button(kinds.map(\\.rawValue).joined(separator: ", ")) { kinds.append(.view) }', '@State private var kinds: [SheetKind] = [.edit]')}enum SheetKind: String { case edit, view }`,
        app(`Text("Inbox")
            .alert(Text("Delete?"), isPresented: $deleting) { Button("Delete", role: .destructive) { } }
            .confirmationDialog(Text("Options"), isPresented: $choosing) { Button("Archive") { } }`, '@State private var deleting = false\n    @State private var choosing = false'),
      ])
    }, 300_000)
  })
})

describe('a navigation stack bound to a NavigationPath', () => {
  const STACK = `NavigationStack(path: $path) {
            VStack {
                Button("Open 7") { path.append(7) }
                Button("Open Emma") { path.append("Emma") }
                Text(path.isEmpty ? "Nothing open" : "Open")
            }
            .navigationDestination(for: Int.self) { number in
                Button("Number \\(number), \\(path.count) deep") { path.removeLast() }
            }
            .navigationDestination(for: String.self) { title in
                Button("Reading \\(title)") { path = NavigationPath() }
            }
        }`

  it('pushes each value appended to it with the destination for its type, and counts them', () => {
    let result = run(STACK, '@State private var path = NavigationPath()')
    expect(texts(result.renderTree!)).toBe('Open 7 Open Emma Nothing open')
    result = tap(result, 'Open 7')
    expect(texts(result.renderTree!)).toContain('Number 7, 1 deep')
    result = tap(back(result), 'Open Emma')
    expect(texts(result.renderTree!)).toContain('Reading Emma')
  })

  it('goes back with removeLast() and to its root with a new NavigationPath()', () => {
    let result = tap(run(STACK, '@State private var path = NavigationPath()'), 'Open 7')
    result = tap(result, 'Number 7, 1 deep')
    expect(texts(result.renderTree!)).toContain('Nothing open')
    result = tap(tap(result, 'Open Emma'), 'Reading Emma')
    expect(texts(result.renderTree!)).toContain('Nothing open')
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds the stack these tests draw', () => {
      typecheckInXcode([app(STACK, '@State private var path = NavigationPath()')])
    }, 120_000)
  })
})

describe('an alert written as Alert(...), as before iOS 15', () => {
  const LEGACY = `Text("Inbox")
            .alert(isPresented: $shown) {
                Alert(title: Text("Deleted"), message: Text("Gone for good"), dismissButton: .default(Text("OK")))
            }`

  it('draws its title, message and button, up in the app and as a page named by its title', () => {
    const result = run(LEGACY, '@State private var shown = true')
    expect(result.diagnostics).toEqual([])
    expect(texts(result.renderTree!)).toBe('Inbox Deleted Gone for good OK')
    expect(children(result).map(page => [page.kind, page.name, texts(page.tree)])).toEqual([['alert', 'Deleted', 'Inbox Deleted Gone for good OK']])
  })

  it('draws a primary and a secondary button, each closing it, and runs the one tapped', () => {
    const body = `Text(note)
            .alert(isPresented: $shown) {
                Alert(title: Text("Delete the draft?"), primaryButton: .destructive(Text("Delete"), action: { note = "Deleted" }), secondaryButton: .cancel())
            }`
    let result = run(body, '@State private var shown = true\n    @State private var note = "Draft"')
    expect(texts(result.renderTree!)).toBe('Draft Delete the draft? Cancel Delete')
    result = tap(result, 'Delete')
    expect(texts(result.renderTree!)).toBe('Deleted')
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('builds the alerts these tests draw, at the iOS before they were deprecated', () => {
      typecheckInXcode([`// target: iOS 14\n${app(`${LEGACY}
            .alert(isPresented: $asking) {
                Alert(title: Text("Delete the draft?"), primaryButton: .destructive(Text("Delete"), action: { shown = false }), secondaryButton: .cancel())
            }`, '@State private var shown = true\n    @State private var asking = false')}`])
    }, 120_000)
  })
})
