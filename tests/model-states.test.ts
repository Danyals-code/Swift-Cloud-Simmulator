import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, scenarioFiles } from '@studio/swift-sema'
import { Parser } from '@studio/swift-syntax'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { validatePreviewScenario, type AuthoringSnapshot, type CompileResult, type PreviewScenario, type SourceFile, type StateInput, type SuggestedState } from '@studio/shared'
import { typecheckInXcode, XCODE } from './helpers/layer-project'
import { describeState, stateSuggestions } from '../apps/web/lib/screenStates'

/**
 * View-model states (Wave 3b, Concern 2 #5): the loading, empty and error states a screen
 * draws from a model, offered as States the canvas can show without changing the Swift.
 */

/** The screen the AI writes most: an @Observable model with a load on appear, read through the environment. */
const FEED = `import SwiftUI

struct Article: Identifiable {
    let id: Int
    var title: String
}

@Observable
final class FeedModel {
    var articles: [Article] = []
    var isLoading = false
    var errorMessage: String?

    func load() async {
        isLoading = true
        errorMessage = nil
        try? await Task.sleep(for: .seconds(1))
        articles = [Article(id: 1, title: "Hello"), Article(id: 2, title: "World")]
        isLoading = false
    }
}

@main
struct FeedApp: App {
    @State private var model = FeedModel()

    var body: some Scene {
        WindowGroup {
            FeedScreen()
                .environment(model)
        }
    }
}

struct FeedScreen: View {
    @Environment(FeedModel.self) private var model

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading {
                    ProgressView("Loading articles")
                } else if let message = model.errorMessage {
                    VStack {
                        Text("Couldn't load")
                        Text(message)
                    }
                } else if model.articles.isEmpty {
                    ContentUnavailableView("No articles", systemImage: "newspaper")
                } else {
                    List(model.articles) { article in
                        Text(article.title)
                    }
                }
            }
            .navigationTitle("Feed")
            .task { await model.load() }
        }
    }
}
`

/** The same screen as an ObservableObject the view owns, as older AI-written code has it. */
const PUBLISHED = `import SwiftUI

struct Article: Identifiable {
    let id: Int
    let title: String
}

@MainActor
final class FeedViewModel: ObservableObject {
    @Published var articles: [Article] = []
    @Published var isLoading = false

    func load() async {
        isLoading = true
        try? await Task.sleep(nanoseconds: 100_000_000)
        articles = [Article(id: 1, title: "Hello"), Article(id: 2, title: "World")]
        isLoading = false
    }
}

@main
struct FeedApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
    @StateObject private var model = FeedViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading {
                    ProgressView("Loading…")
                } else {
                    List(model.articles) { article in
                        Text(article.title)
                    }
                }
            }
            .navigationTitle("Feed")
            .task { await model.load() }
        }
    }
}
`

/** A tab app that loads the model its feed reads each time the tab changes. */
const TABS = `import SwiftUI

@Observable
final class Feed {
    var posts: [String] = []

    func load() {
        posts = ["Hello"]
    }
}

@main
struct TabsApp: App {
    @State private var feed = Feed()
    @State private var tab = 0

    var body: some Scene {
        WindowGroup {
            TabView(selection: $tab) {
                FeedScreen()
                    .tabItem { Label("Feed", systemImage: "house") }
                    .tag(0)
                Text("Preferences")
                    .tabItem { Label("Settings", systemImage: "gear") }
                    .tag(1)
            }
            .environment(feed)
            .onChange(of: tab) { feed.load() }
        }
    }
}

struct FeedScreen: View {
    @Environment(Feed.self) private var feed

    var body: some View {
        VStack {
            if feed.posts.isEmpty {
                Text("No posts")
            } else {
                ForEach(feed.posts, id: \\.self) { Text($0) }
            }
        }
    }
}
`

/** A one-screen app whose `ContentView` has `members` and draws `body`, with `extra` declarations after it. */
const app = (members: string, body: string, extra = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

struct ContentView: View {
${members}

    var body: some View {
        VStack {
${body}
        }
    }
}
${extra}`

const files = (text: string): SourceFile[] => [{ id: 'Sources/App.swift', text }]
const model = (sources: readonly SourceFile[]) => buildAuthoringModel({ projectId: 'states', revision: 1, files: [...sources], deploymentTarget: '17.0' })
/** The inputs a screen's States offer, as the panel receives them. */
const inputsOf = (snapshot: AuthoringSnapshot, view: string) => (snapshot.inputs ?? []).filter(input => input.owner === view)
/** The named states a screen's conditions draw: each value's, in the order the screen reads the values. */
const statesOf = (snapshot: AuthoringSnapshot, view: string): SuggestedState[] => inputsOf(snapshot, view).flatMap(input => input.states ?? [])
const named = (snapshot: AuthoringSnapshot, view: string, name: string) => {
  const state = inputsOf(snapshot, view).flatMap(input => input.states ?? []).find(s => s.name === name)
  if (!state) throw new Error(`No state ${name} on ${view}: ${inputsOf(snapshot, view).flatMap(i => i.states ?? []).map(s => s.name).join(', ')}`)
  return state
}
const input = (snapshot: AuthoringSnapshot, view: string, name: string): StateInput => {
  const found = inputsOf(snapshot, view).find(i => i.name === name)
  if (!found) throw new Error(`No input ${name} on ${view}: ${inputsOf(snapshot, view).map(i => i.name).join(', ')}`)
  return found
}
/** A suggested state saved as the panel saves it. */
const scenario = (view: string, state: SuggestedState): PreviewScenario => ({ name: state.name, owner: view, hook: '', inputs: state.inputs })
/** What a state's values are, by name, for reading in an expectation. */
const values = (state: SuggestedState) => Object.fromEntries(state.inputs.map(i => [i.name, i.value]))

let revision = 1
function draw(sources: readonly SourceFile[], state?: PreviewScenario): CompileResult {
  resetPipelineState()
  const result = compile({ projectId: 'states', files: [...sources], scenario: state, revision: revision++, canvas: { width: 393, height: 852 }, colorScheme: 'light' })
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result
}
const texts = (result: CompileResult) => result.renderTree?.nodes.flatMap(n => n.text?.runs.map(r => r.text) ?? []) ?? []
/**
 * Taps the control called `label` on the canvas, and what the screen draws after: as a
 * designer does in Preview, or as the Studio does for its own reasons with `origin`.
 */
function tap(result: CompileResult, label: string, origin?: 'studio'): CompileResult {
  const target = result.renderTree?.nodes.find(n => n.hitTarget && n.a11y?.label === label)
  if (!target) throw new Error(`Nothing to tap called ${label}: ${texts(result).join(', ')}`)
  expect(applyEvent({ kind: 'tap', handlerId: target.hitTarget!.handlerId, location: { x: 0, y: 0 }, ...(origin ? { origin } : {}) })).toBe(true)
  return rerender(revision++)
}
/** What the screen draws in a state, read off the canvas. */
const shown = (sources: readonly SourceFile[], view: string, name?: string) => {
  const snapshot = model(sources)
  return texts(draw(sources, name ? scenario(view, named(snapshot, view, name)) : undefined))
}

beforeEach(resetPipelineState)

describe('states a model draws', () => {
  it('names a state for each branch of the screen: Loading, Error, Empty and Has items', () => {
    const snapshot = model(files(FEED))
    expect(statesOf(snapshot, 'FeedScreen').map(s => s.name)).toEqual(['Loading', 'Error', 'Empty', 'Has items'])
    expect(values(named(snapshot, 'FeedScreen', 'Loading'))).toEqual({ 'model.isLoading': true })
    expect(values(named(snapshot, 'FeedScreen', 'Error'))).toEqual({ 'model.isLoading': false, 'model.errorMessage': 'Something went wrong.' })
    expect(values(named(snapshot, 'FeedScreen', 'Empty'))).toEqual({ 'model.isLoading': false, 'model.errorMessage': null, 'model.articles': 'empty' })
    expect(values(named(snapshot, 'FeedScreen', 'Has items'))).toEqual({ 'model.isLoading': false, 'model.errorMessage': null, 'model.articles': 'items' })
  })

  it('reads the model where it is declared, and holds what a state sets there', () => {
    const snapshot = model(files(FEED))
    expect(input(snapshot, 'FeedScreen', 'model.isLoading')).toMatchObject({ kind: 'flag', type: 'Bool', value: false, held: { type: 'FeedModel', member: 'isLoading' } })
    expect(input(snapshot, 'FeedScreen', 'model.errorMessage')).toMatchObject({ type: 'String', optional: true, value: null, held: { type: 'FeedModel', member: 'errorMessage' } })
    // Its items are the ones the model's own load fills it with.
    expect(input(snapshot, 'FeedScreen', 'model.articles')).toMatchObject({ kind: 'list', value: 'empty', choices: [{ value: 'empty', swift: '[]' }, { value: 'items', swift: '[Article(id: 1, title: "Hello"), Article(id: 2, title: "World")]' }] })
  })

  it('draws each state on the canvas, though the model loads as the screen appears', () => {
    const sources = files(FEED)
    // The preview runs the load on appear, which leaves the screen with its items.
    expect(shown(sources, 'FeedScreen')).toEqual(expect.arrayContaining(['Hello', 'World']))
    expect(shown(sources, 'FeedScreen', 'Loading')).toContain('Loading articles')
    expect(shown(sources, 'FeedScreen', 'Error')).toEqual(expect.arrayContaining(['Couldn\'t load', 'Something went wrong.']))
    expect(shown(sources, 'FeedScreen', 'Empty')).toContain('No articles')
    expect(shown(sources, 'FeedScreen', 'Has items')).toEqual(expect.arrayContaining(['Hello', 'World']))
    expect(shown(sources, 'FeedScreen', 'Empty')).not.toContain('Hello')
  })

  it('changes neither the source nor the syntax it was read from', () => {
    const sources = files(FEED), snapshot = model(sources)
    const ast = sources.map(f => Parser.parse(f.text, f.id).sourceFile), before = JSON.stringify(ast)
    const output = scenarioFiles({ files: sources, ast, nodes: snapshot.nodes }, snapshot, scenario('FeedScreen', named(snapshot, 'FeedScreen', 'Loading'))).files
    expect(output).not.toBe(ast)
    expect(JSON.stringify(ast)).toBe(before)
    expect(sources[0]!.text).toBe(FEED)
  })

  it('reads an ObservableObject the view owns through @StateObject, with @Published members', () => {
    const sources = files(PUBLISHED), snapshot = model(sources)
    expect(statesOf(snapshot, 'ContentView').map(s => s.name)).toEqual(['Loading', 'Loaded'])
    expect(shown(sources, 'ContentView', 'Loading')).toContain('Loading…')
    expect(shown(sources, 'ContentView', 'Loaded')).toEqual(expect.arrayContaining(['Hello', 'World']))
  })

  it.each([
    ['@State', '@State private var model = Store()', ''],
    ['@Environment', '@Environment(Store.self) private var model', '.environment(Store())'],
    ['@Bindable', '@Bindable var model: Store', ''],
  ])('reaches an @Observable model through %s', (_, member, environment) => {
    const store = '@Observable class Store {\n    var items: [String] = ["Milk", "Eggs"]\n    var isSyncing = false\n}'
    let text = app(`    ${member}`, '            if model.isSyncing { ProgressView("Syncing") }\n            if model.items.isEmpty { Text("Nothing to buy") } else { ForEach(model.items, id: \\.self) { Text($0) } }', store)
    text = text.replace('WindowGroup { ContentView() }', environment ? `WindowGroup { ContentView()${environment} }` : member.startsWith('@Bindable') ? 'WindowGroup { ContentView(model: Store()) }' : 'WindowGroup { ContentView() }')
    const sources = files(text), snapshot = model(sources)
    // A flag that is not a load is named by itself.
    expect(statesOf(snapshot, 'ContentView').map(s => s.name)).toEqual(['Syncing', 'Empty', 'Has items'])
    expect(input(snapshot, 'ContentView', 'model.items').choices?.find(c => c.value === 'items')?.swift).toBe('["Milk", "Eggs"]')
    expect(shown(sources, 'ContentView', 'Syncing')).toContain('Syncing')
    expect(shown(sources, 'ContentView', 'Empty')).toContain('Nothing to buy')
    expect(shown(sources, 'ContentView')).toEqual(expect.arrayContaining(['Milk', 'Eggs']))
  })

  it('reaches an ObservableObject through @EnvironmentObject', () => {
    const store = 'class Store: ObservableObject {\n    @Published var errorMessage: String? = nil\n}'
    const text = app('    @EnvironmentObject var store: Store', '            if let message = store.errorMessage { Text(message) } else { Text("All good") }', store).replace('WindowGroup { ContentView() }', 'WindowGroup { ContentView().environmentObject(Store()) }')
    const sources = files(text), snapshot = model(sources)
    expect(statesOf(snapshot, 'ContentView').map(s => s.name)).toEqual(['Error', 'No error'])
    expect(shown(sources, 'ContentView', 'Error')).toContain('Something went wrong.')
    expect(shown(sources, 'ContentView', 'No error')).toContain('All good')
  })
})

describe('holding a state while it is shown', () => {
  it('holds a screen’s own flag that its task clears as it appears', () => {
    const sources = files(app('    @State private var isLoading = true', '            if isLoading { ProgressView("Loading") } else { Text("Ready") }').replace('\n        }\n    }\n}\n', '\n        }\n        .task { isLoading = false }\n    }\n}\n'))
    expect(shown(sources, 'ContentView')).toContain('Ready')
    expect(shown(sources, 'ContentView', 'Loading')).toContain('Loading')
    expect(shown(sources, 'ContentView', 'Loaded')).toContain('Ready')
  })

  it('holds a model’s members against writes from the screen and from its own mutating calls', () => {
    const store = '@Observable class Basket {\n    var items: [String] = []\n    var isLoading = false\n    func fill() { items.append("Milk"); self.items.append(contentsOf: ["Eggs"]) }\n}'
    const body = '            if basket.isLoading { ProgressView("Loading") } else if basket.items.isEmpty { Text("Empty basket") } else { ForEach(basket.items, id: \\.self) { Text($0) } }'
    const sources = files(app('    @State private var basket = Basket()', body, store).replace('\n        }\n    }\n}\n', '\n        }\n        .task { basket.isLoading = true; basket.fill(); basket.isLoading = false }\n    }\n}\n'))
    const snapshot = model(sources)
    // Its own code fills it one item at a time, so there are no items to copy.
    expect(named(snapshot, 'ContentView', 'Has items').problem).toMatch(/items starts empty/)
    expect(shown(sources, 'ContentView')).toEqual(expect.arrayContaining(['Milk', 'Eggs']))
    expect(shown(sources, 'ContentView', 'Loading')).toContain('Loading')
    expect(shown(sources, 'ContentView', 'Empty')).toContain('Empty basket')
  })

  it('lets go at the first tap, which acts on what the state drew, and the app carries on from it', () => {
    const body = '            if isSignedIn {\n                Text("Welcome back")\n                Button("Sign out") { isSignedIn = false }\n            } else {\n                Button("Sign in") { isSignedIn = true }\n            }'
    const sources = files(app('    @State private var isSignedIn = false', body).replace('\n        }\n    }\n}\n', '\n        }\n        .task { isSignedIn = false }\n    }\n}\n'))
    const signedIn = draw(sources, scenario('ContentView', named(model(sources), 'ContentView', 'Signed in')))
    // Held against the task that signs out as the screen appears.
    expect(texts(signedIn)).toEqual(['Welcome back', 'Sign out'])
    const signedOut = tap(signedIn, 'Sign out')
    expect(texts(signedOut)).toEqual(['Sign in'])
    // No longer held: the screen's own button changes the canvas, as it does with no state.
    expect(texts(tap(signedOut, 'Sign in'))).toEqual(['Welcome back', 'Sign out'])
  })

  it('holds through the tab switches the Studio makes, and lets go at a designer’s', () => {
    const sources = files(TABS), state = scenario('FeedScreen', named(model(sources), 'FeedScreen', 'Empty'))
    const empty = draw(sources, state)
    expect(texts(empty)).toContain('No posts')
    // Selecting a layer on another tab switches to it, and back: each switch loads the feed.
    const back = tap(tap(empty, 'Settings', 'studio'), 'Feed', 'studio')
    expect(texts(back)).toContain('No posts')
    expect(texts(back)).not.toContain('Hello')
    // The designer's own switch is a touch: the app carries on, and the feed loads.
    const touched = tap(tap(draw(sources, state), 'Settings'), 'Feed')
    expect(texts(touched)).toContain('Hello')
  })

  it('removes one of the rows a held list shows, and flips a toggle from the value shown', () => {
    const body = '            Toggle("Notify", isOn: $notify)\n            if model.items.isEmpty { Text("Nothing") } else { ForEach(model.items, id: \\.self) { Text($0) } }\n            Button("Remove first") { model.items.removeFirst() }'
    const store = '@Observable class Store {\n    var items: [String] = ["Milk", "Eggs", "Bread"]\n    func load() { items = ["Tea"] }\n}'
    const sources = files(app('    @State private var model = Store()\n    @State private var notify = false', body.replace('Toggle', 'if notify { Text("On") }\n            Toggle'), store).replace('\n        }\n    }\n}\n', '\n        }\n        .task { model.load(); notify = false }\n    }\n}\n'))
    const snapshot = model(sources)
    const both: PreviewScenario = { name: 'Both', owner: 'ContentView', hook: '', inputs: [...named(snapshot, 'ContentView', 'Notify').inputs, ...named(snapshot, 'ContentView', 'Has items').inputs] }
    const held = draw(sources, both)
    expect(texts(held)).toEqual(['On', 'Notify', 'Milk', 'Eggs', 'Bread', 'Remove first'])
    const removed = tap(held, 'Remove first')
    expect(texts(removed)).toEqual(['On', 'Notify', 'Eggs', 'Bread', 'Remove first'])
    expect(texts(tap(removed, 'Notify'))).toEqual(['Notify', 'Eggs', 'Bread', 'Remove first'])
  })
})

/**
 * A model the app fills outside its own type, as `seeded()` and a static `preview` do: the
 * screen reads it through the environment, and never sees where it was made.
 */
const ITEMS = (root: string, extra: string, initial = '[Item(id: 1, name: "Milk"), Item(id: 2, name: "Eggs")]') => `import SwiftUI

struct Item: Identifiable {
    let id: Int
    var name: String
}

@Observable
final class ItemsModel {
    var items: [Item] = ${initial}
    var isLoading = false
    var errorMessage: String?
}
${extra}
@main
struct ItemsApp: App {
    var body: some Scene {
        WindowGroup {
            ItemsScreen()
                .environment(${root})
        }
    }
}

struct ItemsScreen: View {
    @Environment(ItemsModel.self) private var model

    var body: some View {
        VStack {
            if model.isLoading {
                ProgressView("Loading items")
            } else if let message = model.errorMessage {
                Text(message)
            } else if model.items.isEmpty {
                Text("No items")
            } else {
                ForEach(model.items) { item in
                    Text(item.name)
                }
            }
        }
    }
}
`

/** Filled by a free function the app root calls. */
const SEEDED = ITEMS('seeded()', '\nfunc seeded() -> ItemsModel {\n    let m = ItemsModel()\n    m.isLoading = true\n    return m\n}\n')
/** Filled by a static the app root reads. */
const PRESET = ITEMS('ItemsModel.preview', '\nextension ItemsModel {\n    static var preview: ItemsModel {\n        let m = ItemsModel()\n        m.items = [Item(id: 9, name: "Preset")]\n        return m\n    }\n}\n', '[]')
/** An ObservableObject a parent holds and fills as it appears, passed to the screen. */
const PARENT = `import SwiftUI

final class ItemsStore: ObservableObject {
    @Published var items: [String] = ["Milk", "Eggs"]
    @Published var isLoading = false
}

@main
struct ItemsApp: App {
    var body: some Scene {
        WindowGroup { ParentView() }
    }
}

struct ParentView: View {
    @StateObject private var store = ItemsStore()

    var body: some View {
        ItemsList(store: store)
            .onAppear { store.isLoading = true; store.items = [] }
    }
}

struct ItemsList: View {
    @ObservedObject var store: ItemsStore

    var body: some View {
        VStack {
            if store.isLoading {
                ProgressView("Loading items")
            } else if store.items.isEmpty {
                Text("No items")
            } else {
                ForEach(store.items, id: \\.self) { Text($0) }
            }
        }
    }
}
`

/** The same, with the parent holding a subclass of the screen's model. */
const SUBCLASS = PARENT.replace('final class ItemsStore', 'class ItemsStore').replace('@StateObject private var store = ItemsStore()', '@StateObject private var store = SeededStore()').replace('\n@main', '\nfinal class SeededStore: ItemsStore {}\n\n@main')

describe('a model filled outside its type', () => {
  it('draws each state though a free function at the app root fills the model', () => {
    const sources = files(SEEDED)
    expect(shown(sources, 'ItemsScreen')).toContain('Loading items')
    expect(shown(sources, 'ItemsScreen', 'Error')).toEqual(['Something went wrong.'])
    expect(shown(sources, 'ItemsScreen', 'Empty')).toEqual(['No items'])
    expect(shown(sources, 'ItemsScreen', 'Has items')).toEqual(['Milk', 'Eggs'])
  })

  it('draws Empty though a static preview fills the model', () => {
    const sources = files(PRESET)
    expect(shown(sources, 'ItemsScreen')).toEqual(['Preset'])
    expect(shown(sources, 'ItemsScreen', 'Empty')).toEqual(['No items'])
    expect(shown(sources, 'ItemsScreen', 'Loading')).toContain('Loading items')
  })

  it('draws each state of an @ObservedObject its parent fills', () => {
    const sources = files(PARENT)
    expect(statesOf(model(sources), 'ItemsList').map(s => s.name)).toEqual(['Loading', 'Empty', 'Has items'])
    expect(shown(sources, 'ItemsList')).toContain('Loading items')
    expect(shown(sources, 'ItemsList', 'Empty')).toEqual(['No items'])
    expect(shown(sources, 'ItemsList', 'Has items')).toEqual(['Milk', 'Eggs'])
  })

  it('holds the members of a subclass the parent passes in', () => {
    const sources = files(SUBCLASS)
    expect(shown(sources, 'ItemsList')).toContain('Loading items')
    expect(shown(sources, 'ItemsList', 'Has items')).toEqual(['Milk', 'Eggs'])
  })
})

describe('emptiness', () => {
  it('flips a @State array on the view between empty and its items', () => {
    const sources = files(app('    @State private var tags: [String] = ["Work", "Home"]', '            if tags.isEmpty {\n                ContentUnavailableView("No tags", systemImage: "tag")\n            } else {\n                ForEach(tags, id: \\.self) { Text($0) }\n            }'))
    const snapshot = model(sources)
    expect(statesOf(snapshot, 'ContentView').map(s => s.name)).toEqual(['Empty', 'Has items'])
    expect(input(snapshot, 'ContentView', 'tags')).toMatchObject({ value: 'items', choices: [{ value: 'empty' }, { value: 'items', swift: '["Work", "Home"]' }] })
    expect(shown(sources, 'ContentView', 'Empty')).toContain('No tags')
    expect(shown(sources, 'ContentView', 'Has items')).toEqual(expect.arrayContaining(['Work', 'Home']))
  })

  it('flips the array a computed isEmpty on the model reads', () => {
    const store = '@Observable class Inbox {\n    var messages: [String] = ["Hi"]\n    var isEmpty: Bool { messages.isEmpty }\n}'
    const sources = files(app('    @State private var inbox = Inbox()', '            if inbox.isEmpty { Text("Inbox zero") } else { Text("\\(inbox.messages.count) messages") }', store))
    const snapshot = model(sources)
    expect(statesOf(snapshot, 'ContentView').map(s => s.name)).toEqual(['Empty', 'Has items'])
    expect(values(named(snapshot, 'ContentView', 'Empty'))).toEqual({ 'inbox.messages': 'empty' })
    expect(shown(sources, 'ContentView', 'Empty')).toContain('Inbox zero')
    expect(shown(sources, 'ContentView', 'Has items')).toContain('1 messages')
  })

  it('empties the list a filtered one is worked out from, as a search screen has it', () => {
    const store = '@Observable class Library {\n    var books: [String] = ["Dune", "Emma"]\n}'
    const members = '    @State private var library = Library()\n    @State private var query = ""\n    private var results: [String] { query.isEmpty ? library.books : library.books.filter { $0.contains(query) } }'
    const sources = files(app(members, '            if results.isEmpty { Text("No results") } else { ForEach(results, id: \\.self) { Text($0) } }', store))
    const snapshot = model(sources)
    expect(values(named(snapshot, 'ContentView', 'Empty'))).toEqual({ 'library.books': 'empty' })
    // Which books it shows is the filter's, so the preview can't choose them.
    expect(named(snapshot, 'ContentView', 'Has items')).toMatchObject({ inputs: [], problem: 'results is worked out from books, so the preview can show it empty but can’t choose its items.' })
    expect(shown(sources, 'ContentView', 'Empty')).toContain('No results')
  })

  it('offers Empty alone, and says why there are no items, when the array starts empty and is filled from outside', () => {
    const store = '@Observable class Feed {\n    var posts: [String] = []\n    func load(from service: Service) async { posts = await service.fetch() }\n}\nstruct Service { func fetch() async -> [String] { [] } }'
    const sources = files(app('    @State private var feed = Feed()', '            if feed.posts.isEmpty { Text("No posts") } else { ForEach(feed.posts, id: \\.self) { Text($0) } }', store))
    const snapshot = model(sources)
    expect(named(snapshot, 'ContentView', 'Empty').problem).toBeUndefined()
    expect(named(snapshot, 'ContentView', 'Has items')).toMatchObject({ inputs: [], problem: expect.stringContaining('posts starts empty') })
  })
})

describe('optionals and computed flags', () => {
  it('reads `!= nil`, a computed Bool, and `if let` on the model', () => {
    const store = '@Observable class Session {\n    var errorMessage: String?\n    var hasError: Bool { errorMessage != nil }\n}'
    const sources = files(app('    @State private var session = Session()', '            if session.hasError { Text("Banner") }\n            if session.errorMessage != nil { Text("Retry") }', store))
    const snapshot = model(sources)
    const error = named(snapshot, 'ContentView', 'Error')
    expect(values(error)).toEqual({ 'session.errorMessage': 'Something went wrong.' })
    expect(shown(sources, 'ContentView', 'Error')).toEqual(expect.arrayContaining(['Banner', 'Retry']))
    expect(shown(sources, 'ContentView')).not.toContain('Banner')
  })

  it('takes a sample message from the model’s own code', () => {
    const store = '@Observable class Session {\n    var errorMessage: String?\n    func fail() { errorMessage = "You’re offline." }\n}'
    const sources = files(app('    @State private var session = Session()', '            if let message = session.errorMessage { Text(message) }', store))
    expect(values(named(model(sources), 'ContentView', 'Error'))).toEqual({ 'session.errorMessage': 'You’re offline.' })
    expect(shown(sources, 'ContentView', 'Error')).toContain('You’re offline.')
  })

  it('takes a sample message the model sets in a defer', () => {
    const store = '@Observable class Session {\n    var errorMessage: String?\n    func load() {\n        defer { errorMessage = "Try again later." }\n    }\n}'
    const sources = files(app('    @State private var session = Session()', '            if let message = session.errorMessage { Text(message) }', store))
    expect(values(named(model(sources), 'ContentView', 'Error'))).toEqual({ 'session.errorMessage': 'Try again later.' })
  })

  it('shows a model-typed optional with the first record of its kind, and an enum with its first case', () => {
    const extra = 'struct Article: Identifiable {\n    let id: Int\n    var title: String\n}\nenum Plan { case free, pro }\n@Observable class Reader {\n    var articles: [Article] = [Article(id: 1, title: "First"), Article(id: 2, title: "Second")]\n    var selected: Article?\n    var plan: Plan?\n}'
    const sources = files(app('    @State private var reader = Reader()', '            if let article = reader.selected { Text(article.title) } else { Text("Pick one") }\n            if reader.plan != nil { Text("Subscribed") }', extra))
    const snapshot = model(sources)
    expect(input(snapshot, 'ContentView', 'reader.selected').choices).toEqual([{ value: 'none', label: 'None', swift: 'nil' }, { value: 'sample', label: 'A sample', swift: 'Article(id: 1, title: "First")' }])
    expect(input(snapshot, 'ContentView', 'reader.plan').choices?.[1]).toMatchObject({ swift: 'Plan.free' })
    expect(statesOf(snapshot, 'ContentView').map(s => s.name)).toEqual(['Selected', 'Not selected', 'Plan'])
    expect(shown(sources, 'ContentView', 'Selected')).toContain('First')
    expect(shown(sources, 'ContentView', 'Plan')).toContain('Subscribed')
  })

  it.each(['Error', '(any Error)', 'LocalizedError'])('shows an %s with a sample message, as its localizedDescription reads', type => {
    const store = `@Observable class Loader {\n    var error: ${type}?\n    func load() async {\n        do { try await fetch() } catch { self.error = error }\n    }\n    func fetch() async throws {}\n}`
    const body = '            if let error = loader.error { Text(error.localizedDescription) } else { Text("Fine") }\n            Text(loader.error?.localizedDescription ?? "No message")'
    const sources = files(app('    @State private var loader = Loader()', body, store).replace('\n        }\n    }\n}\n', '\n        }\n        .task { await loader.load() }\n    }\n}\n'))
    expect(statesOf(model(sources), 'ContentView').map(s => s.name)).toEqual(['Error', 'No error'])
    expect(shown(sources, 'ContentView', 'Error')).toEqual(['Something went wrong.', 'Something went wrong.'])
    expect(shown(sources, 'ContentView', 'No error')).toEqual(['Fine', 'No message'])
  })

  it('refuses a project error it has no sample of, and says why', () => {
    const store = 'enum LoadError: LocalizedError { case offline }\n@Observable class Loader {\n    var error: LoadError?\n}'
    const sources = files(app('    @State private var loader = Loader()', '            if let error = loader.error { Text(error.localizedDescription) } else { Text("Fine") }', store))
    const snapshot = model(sources)
    expect(named(snapshot, 'ContentView', 'Error')).toMatchObject({ inputs: [], problem: expect.stringContaining('LoadError') })
    expect(named(snapshot, 'ContentView', 'No error').problem).toBeUndefined()
  })

  it('sets a model’s enum to the case a branch asks for, past the ones before it', () => {
    const extra = 'enum Phase { case idle, loading, failed }\n@Observable class Loader {\n    var phase = Phase.idle\n    func load() { phase = .loading; phase = .idle }\n}'
    const sources = files(app('    @State private var loader = Loader()', '            if loader.phase == .loading { ProgressView("Loading") } else if loader.phase == .failed { Text("Failed") } else { Text("Ready") }', extra).replace('\n        }\n    }\n}\n', '\n        }\n        .onAppear { loader.load() }\n    }\n}\n'))
    const snapshot = model(sources)
    expect(statesOf(snapshot, 'ContentView').map(s => s.name)).toEqual(['Loading', 'Failed', 'Idle'])
    expect(values(named(snapshot, 'ContentView', 'Failed'))).toEqual({ 'loader.phase': 'failed' })
    expect(input(snapshot, 'ContentView', 'loader.phase').choices?.map(c => c.swift)).toEqual(['Phase.idle', 'Phase.loading', 'Phase.failed'])
    expect(shown(sources, 'ContentView', 'Loading')).toContain('Loading')
    expect(shown(sources, 'ContentView', 'Failed')).toContain('Failed')
    expect(shown(sources, 'ContentView', 'Idle')).toContain('Ready')
  })

  it('names other flags by the member, prettified', () => {
    const sources = files(app('    @State private var isSignedIn = false', '            if isSignedIn { Text("Welcome back") } else { Text("Sign in") }'))
    const snapshot = model(sources)
    expect(statesOf(snapshot, 'ContentView').map(s => s.name)).toEqual(['Signed in', 'Not signed in'])
    // The value the screen already had keeps its signature, so states saved before still match.
    const plain = input(snapshot, 'ContentView', 'isSignedIn')
    expect(plain).toMatchObject({ type: 'Bool', value: false, held: { type: 'ContentView', member: 'isSignedIn' } })
    expect(shown(sources, 'ContentView', 'Signed in')).toContain('Welcome back')
  })
})

describe('what the preview cannot set', () => {
  it('leaves a condition alone and says why', () => {
    const store = '@Observable class Feed {\n    var posts: [String] = []\n    func canRefresh() -> Bool { true }\n}'
    const members = '    @State private var feed = Feed()\n    let showsHeader: Bool\n    @Environment(\\.horizontalSizeClass) private var sizeClass'
    const body = '            if feed.canRefresh() { Text("Pull") }\n            if showsHeader { Text("Header") }\n            if sizeClass == .compact { Text("Compact") }'
    const snapshot = model(files(app(members, body, store).replace('ContentView() }', 'ContentView(showsHeader: true) }')))
    const problems = Object.fromEntries(inputsOf(snapshot, 'ContentView').filter(i => i.problem).map(i => [i.name, i.problem]))
    expect(Object.keys(problems)).toEqual(['feed.canRefresh()', 'showsHeader', 'sizeClass == .compact'])
    expect(problems['feed.canRefresh()']).toMatch(/worked out when the app runs/)
    expect(problems.showsHeader).toMatch(/screen that shows this one/)
    expect(problems['sizeClass == .compact']).toMatch(/system/)
    expect(statesOf(snapshot, 'ContentView')).toEqual([])
  })

  it('says why beside the states it does offer, in the panel’s order', () => {
    const text = FEED.replace('        isLoading = false\n    }\n}', '        isLoading = false\n    }\n\n    func canRefresh() -> Bool { true }\n}')
      .replace('            Group {\n', '            if model.canRefresh() {\n                Button("Refresh") { }\n            }\n            Group {\n')
    const snapshot = model(files(text))
    expect(snapshot.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    const suggestions = stateSuggestions(inputsOf(snapshot, 'FeedScreen'), [{ name: 'empty', owner: 'FeedScreen', hook: '', inputs: [] }])
    expect(suggestions.offered.map(s => s.name)).toEqual(['Loading', 'Error', 'Has items'])
    expect(suggestions.refused).toEqual([{ name: 'model.canRefresh()', problem: expect.stringMatching(/^model\.canRefresh\(\) is worked out when the app runs/) }])
    expect(describeState(named(snapshot, 'FeedScreen', 'Empty').inputs, inputsOf(snapshot, 'FeedScreen'))).toBe('model.articles: No items, model.isLoading: false, model.errorMessage: none')
  })

  it('leaves a value a row is given to the screen that gives it', () => {
    const extra = 'struct Task {\n    var title = "Task"\n    var done = false\n}\nstruct Row: View {\n    let task: Task\n    var body: some View {\n        if task.done { Text("Done") }\n    }\n}'
    const snapshot = model(files(app('', '            Row(task: Task())', extra)))
    expect(inputsOf(snapshot, 'Row')).toEqual([expect.objectContaining({ name: 'task.done', problem: 'task is given by the screen that shows this one, so the preview can’t set it here.' })])
  })

  it('says a value a helper is given comes from where the helper is used', () => {
    const helper = '\n    private func badge(_ count: Int, isNew: Bool) -> some View {\n        Group {\n            if isNew { Text("New") }\n        }\n    }'
    const sources = files(app('    @State private var count = 1' + helper, '            badge(count, isNew: true)'))
    const problems = inputsOf(model(sources), 'ContentView').filter(i => i.problem)
    expect(problems).toEqual([expect.objectContaining({ name: 'isNew', problem: 'isNew is given where this part of the screen is used, so the preview can’t set it here.' })])
  })

  it('refuses to save a state that sets such a condition, or a choice the value does not have', () => {
    const sources = files(FEED), snapshot = model(sources)
    const loading = scenario('FeedScreen', named(snapshot, 'FeedScreen', 'Loading'))
    expect(validatePreviewScenario(snapshot, loading)).toBeNull()
    const articles = input(snapshot, 'FeedScreen', 'model.articles')
    expect(validatePreviewScenario(snapshot, { ...loading, inputs: [{ owner: 'FeedScreen', name: articles.name, signature: articles.signature, value: 'some' }] })).toMatch(/articles/)
    const withProblem = model(files(app('    let showsHeader: Bool', '            if showsHeader { Text("Header") }').replace('ContentView() }', 'ContentView(showsHeader: true) }'))), header = input(withProblem, 'ContentView', 'showsHeader')
    expect(validatePreviewScenario(withProblem, { name: 'Header', owner: 'ContentView', hook: '', inputs: [{ owner: 'ContentView', name: header.name, signature: header.signature, value: true }] })).toMatch(/showsHeader/)
  })
})

describe.skipIf(!XCODE)('Xcode 27', () => {
  it('builds the screens these states are read from', () => {
    typecheckInXcode([FEED, PUBLISHED, SEEDED, PRESET, PARENT, SUBCLASS, TABS])
  }, 300_000)
})
