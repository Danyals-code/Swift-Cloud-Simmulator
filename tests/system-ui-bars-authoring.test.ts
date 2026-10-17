import { describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { isNonView, type AuthoringNode, type DesignEditRequest, type ScreenBars } from '@studio/shared'
import { APP, XCODE, bodyOf, edited, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 4b: a screen's bars in Design (doc 18, Wave 4): toolbar items in every placement and
 * a search field, added from the Bars section of Screen settings, which reads them back.
 */

/** The screen called `view`'s definition, as Screen settings receives it. */
function definition(source: string, view = 'ContentView', target?: string): AuthoringNode {
  const found = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(source), deploymentTarget: target }).nodes.find(n => n.kind === 'definition' && n.name === view)
  if (!found) throw new Error(`No screen called ${view}`)
  return found
}
/** What the planner makes of `operation` on the screen called `view`: the file after it, or the reason it was refused. */
function onScreen(source: string, operation: DesignEditRequest['operation'], view = 'ContentView', target?: string): { text: string } | { refused: string } {
  const screenNode = definition(source, view, target)
  const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: project(source), scope: screenNode.owner, target: screenNode.source, fingerprint: screenNode.fingerprint, deploymentTarget: target, operation })
  return plan.ok ? { text: plan.changes.find(change => change.file === APP)?.after ?? source } : { refused: plan.reason }
}
/** The file after `operation` on the screen; throws with the planner's reason when it refuses. */
function written(source: string, operation: DesignEditRequest['operation'], view = 'ContentView', target?: string): string {
  const result = onScreen(source, operation, view, target)
  if ('refused' in result) throw new Error(result.refused)
  return result.text
}
/** The screen's Bars, as its definition carries them. */
const barsOf = (source: string, view = 'ContentView', target?: string): ScreenBars | undefined => definition(source, view, target).bars

const INBOX = screen(`        NavigationStack {
            List {
                Text("Row")
            }
            .navigationTitle("Inbox")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Edit") { }
                }
            }
        }`)

describe('+ Leading, + Trailing, + Title and + Bottom', () => {
  it('add an item to the toolbar the screen has, in its placement', () => {
    expect(bodyOf(project(written(INBOX, { kind: 'toolbar-item-add', placement: 'trailing' })))).toBe(`        NavigationStack {
            List {
                Text("Row")
            }
            .navigationTitle("Inbox")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Edit") { }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add", systemImage: "plus") { }
                }
            }
        }`)
  })

  it('give a screen with no toolbar one where its title goes, on its content inside the stack, never on the stack', () => {
    const plain = screen(`        NavigationStack {
            List {
                Text("Row")
            }
        }`)
    expect(bodyOf(project(written(plain, { kind: 'toolbar-item-add', placement: 'principal' })))).toBe(`        NavigationStack {
            List {
                Text("Row")
            }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Title")
                }
            }
        }`)
    const titled = screen(`        NavigationStack {
            VStack {
                List {
                    Text("Row")
                }
                .navigationTitle("Inbox")
            }
        }`)
    expect(written(titled, { kind: 'toolbar-item-add', placement: 'bottom' })).toContain(`                .navigationTitle("Inbox")
                .toolbar {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Action") { }
                    }
                }`)
  })

  it('wrap a screen shown on no stack in a NavigationStack, as a link does, and refuse below iOS 16, saying why', () => {
    const bare = screen(`        VStack {
            Text("Hi")
        }
        .padding()`)
    expect(bodyOf(project(written(bare, { kind: 'toolbar-item-add', placement: 'leading' })))).toBe(`        NavigationStack {
            VStack {
                Text("Hi")
            }
            .padding()
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Edit") { }
                }
            }
        }`)
    expect(onScreen(bare, { kind: 'toolbar-item-add', placement: 'leading' }, 'ContentView', '15.0')).toEqual({ refused: 'Toolbar items need a navigation stack here, which needs iOS 16 or newer. Change the deployment target to add one.' })
    expect(onScreen(bare, { kind: 'toolbar-item-add', placement: 'leading' }, 'ContentView', '13.0')).toEqual({ refused: 'Toolbar items need iOS 14 or newer. Change the deployment target to add one.' })
  })

  it('count a split view as a bar: never wrap one, and add to the column content its title is on', () => {
    const split = screen(`        NavigationSplitView {
            List {
                Text("Inbox")
            }
            .navigationTitle("Folders")
        } detail: {
            Text("Pick one")
        }`)
    expect(bodyOf(project(written(split, { kind: 'toolbar-item-add', placement: 'trailing' })))).toBe(`        NavigationSplitView {
            List {
                Text("Inbox")
            }
            .navigationTitle("Folders")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add", systemImage: "plus") { }
                }
            }
        } detail: {
            Text("Pick one")
        }`)
    expect(bodyOf(project(written(split, { kind: 'searchable-add', prompt: 'Search' })))).toBe(`        NavigationSplitView {
            List {
                Text("Inbox")
            }
            .navigationTitle("Folders")
            .searchable(text: $searchText, prompt: "Search")
        } detail: {
            Text("Pick one")
        }`)
    expect(written(split.replace('\n            .navigationTitle("Folders")', ''), { kind: 'toolbar-item-add', placement: 'leading' })).toContain(`            List {
                Text("Inbox")
            }
            .toolbar {`)
    const column = screen(`        NavigationSplitView {
            FolderList()
        } detail: {
            Text("Pick one")
        }`, `
struct FolderList: View {
    var body: some View {
        List {
            Text("Inbox")
        }
    }
}
`)
    expect(written(column, { kind: 'toolbar-item-add', placement: 'trailing' }, 'FolderList')).toContain(`struct FolderList: View {
    var body: some View {
        List {
            Text("Inbox")
        }
        .toolbar {`)
    expect(barsOf(split)).toMatchObject({ items: [] })
    expect(barsOf(split)?.problem).toBeUndefined()
  })

  it('leave a screen pushed onto a stack as it is, as it is on that stack already', () => {
    const pushed = screen(`        NavigationStack {
            NavigationLink("Details") { DetailScreen() }
        }`, `
struct DetailScreen: View {
    var body: some View {
        Text("Details")
    }
}
`)
    expect(written(pushed, { kind: 'toolbar-item-add', placement: 'trailing' }, 'DetailScreen')).toContain(`struct DetailScreen: View {
    var body: some View {
        Text("Details")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add", systemImage: "plus") { }
                }
            }
    }
}`)
  })

  it('give a toolbar of views an item in a toolbar of its own beside it, as one toolbar holds items or views', () => {
    const views = screen(`        NavigationStack {
            List {
                Text("Row")
            }
            .toolbar { Button("Reset") { } }
        }`)
    expect(written(views, { kind: 'toolbar-item-add', placement: 'bottom' })).toContain(`            .toolbar { Button("Reset") { } }
            .toolbar {
                ToolbarItem(placement: .bottomBar) {
                    Button("Action") { }
                }
            }`)
  })

  it('give a toolbar of the screen’s own toolbar content an item in a toolbar of its own beside it', () => {
    const built = screen(`        NavigationStack {
            Text("Row")
                .toolbar { items }
        }`).replace('    var body: some View {\n', '    @ToolbarContentBuilder var items: some ToolbarContent {\n        ToolbarItem(placement: .topBarLeading) { Button("Edit") { } }\n    }\n\n    var body: some View {\n')
    expect(written(built, { kind: 'toolbar-item-add', placement: 'trailing' })).toContain(`                .toolbar { items }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Add", systemImage: "plus") { }
                    }
                }`)
  })

  it('never add to a toolbar written on the stack itself, which iOS doesn’t show', () => {
    const onStack = screen(`        NavigationStack {
            Text("Row")
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Edit") { }
            }
        }`)
    expect(bodyOf(project(written(onStack, { kind: 'toolbar-item-add', placement: 'trailing' })))).toBe(`        NavigationStack {
            Text("Row")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Add", systemImage: "plus") { }
                    }
                }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Edit") { }
            }
        }`)
  })

  it('add to a toolbar written on one line on that line, and add an item given whole as written', () => {
    const oneLine = screen(`        NavigationStack {
            Text("Row")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { } } }
        }`)
    expect(written(oneLine, { kind: 'toolbar-item-add', placement: 'automatic' })).toContain('.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { } }; ToolbarItem { Button("Action") { } } }')
    expect(written(INBOX, { kind: 'toolbar-item-add', placement: 'bottom', snippet: 'ToolbarItemGroup(placement: .bottomBar) {\n    Button("A") { }\n    Spacer()\n    Button("B") { }\n}' })).toContain(`                ToolbarItemGroup(placement: .bottomBar) {
                    Button("A") { }
                    Spacer()
                    Button("B") { }
                }
            }`)
  })
})

describe('a toolbar item’s Placement', () => {
  const ITEM = 'ToolbarItem(placement: .topBarLeading) {\n                    Button("Edit") { }\n                }'
  const placementOf = (source: string, view: string, target?: string) => viewWritten(source, view, target).controls?.find(c => c.id === 'toolbar:placement')
  const set = (value: string) => ({ kind: 'property' as const, control: 'toolbar:placement', value })

  it('reads Leading, Trailing, Title, Bottom or Automatic, the older names for the bar’s sides too', () => {
    expect(placementOf(INBOX, ITEM)).toMatchObject({ kind: 'select', label: 'Placement', value: 'Leading', options: ['Leading', 'Trailing', 'Title', 'Bottom', 'Navigation', 'Status', 'Automatic'] })
    const older = INBOX.replace('.topBarLeading', '.navigationBarTrailing')
    expect(placementOf(older, ITEM.replace('.topBarLeading', '.navigationBarTrailing'))?.value).toBe('Trailing')
    const bare = INBOX.replace('ToolbarItem(placement: .topBarLeading) {', 'ToolbarItem {')
    expect(placementOf(bare, ITEM.replace('(placement: .topBarLeading)', ''))?.value).toBe('Automatic')
  })

  it('writes the placement in place, adds it where there is none, and takes it away for Automatic', () => {
    expect(edited(INBOX, ITEM, set('Title'))).toContain('ToolbarItem(placement: .principal) {')
    expect(edited(INBOX, ITEM, set('Automatic'))).toContain('            .toolbar {\n                ToolbarItem {\n')
    const bare = INBOX.replace('ToolbarItem(placement: .topBarLeading) {', 'ToolbarItem {')
    expect(edited(bare, ITEM.replace('(placement: .topBarLeading)', ''), set('Bottom'))).toContain('ToolbarItem(placement: .bottomBar) {')
    const group = INBOX.replace('ToolbarItem(placement: .topBarLeading) {', 'ToolbarItemGroup(placement: .bottomBar) {')
    expect(edited(group, ITEM.replace('ToolbarItem(placement: .topBarLeading)', 'ToolbarItemGroup(placement: .bottomBar)'), set('Trailing'))).toContain('ToolbarItemGroup(placement: .topBarTrailing) {')
  })

  it('shows any other placement as written, read only, saying why', () => {
    const confirm = INBOX.replace('.topBarLeading', '.confirmationAction')
    expect(placementOf(confirm, ITEM.replace('.topBarLeading', '.confirmationAction'))).toMatchObject({ kind: 'text', value: '.confirmationAction', disabledReason: 'Bars sets Leading, Trailing, Title, Bottom, Navigation, Status and Automatic. Change this placement in Code.' })
  })
})

describe('a toolbar item, which is no view', () => {
  const ITEM = 'ToolbarItem(placement: .topBarLeading) {\n                    Button("Edit") { }\n                }'

  it('has its Placement alone: no layer, no When tapped, no modifiers to add', () => {
    const item = viewWritten(INBOX, ITEM)
    expect(item.controls?.map(c => c.id)).toEqual(['toolbar:placement'])
    expect(item.layer).toBeUndefined()
    expect(item.behavior).toBeUndefined()
    expect(item.modifierCatalog).toEqual([])
    expect(isNonView(item)).toBe(true)
    expect(isNonView(viewWritten(INBOX, 'Button("Edit") { }'))).toBe(false)
  })

  it.each<[string, DesignEditRequest['operation']]>([
    ['a layer change', { kind: 'layer-set', changes: [{ section: 'effects', opacity: 0.5 }] }],
    ['a modifier', { kind: 'modifier-add', name: 'padding' }],
    ['a tap', { kind: 'make-tappable' }],
    ['a tap action', { kind: 'behavior', action: { type: 'toggle', state: 'on' }, replace: false }],
    ['a guided tap action', { kind: 'guided-action', action: { type: 'dismiss', state: 'dismiss' }, replace: false }],
    ['a transition', { kind: 'transition', state: 'on', style: 'opacity', duration: 0.3 }],
    ['a component', { kind: 'extract-component', name: 'EditItem' }],
    ['a component of copies', { kind: 'make-component', name: 'EditItem', copies: [] }],
    ['a stack around it', { kind: 'layer-wrap', ids: [], layout: 'VStack' }],
  ])('refuses %s, which only a view takes, saying why', (_, operation) => {
    expect(refusal(INBOX, ITEM, operation)).toBe('ToolbarItem is part of the toolbar, not a view, so it takes none of a view’s settings. Select the view inside it.')
  })

  it('is like the app’s scene and a tab, which take no modifier either', () => {
    const tabbed = screen('        TabView {\n            Tab("Home", systemImage: "house") {\n                Text("Home")\n            }\n        }')
    const scene = viewWritten(tabbed, 'WindowGroup {\n            ContentView()\n        }'), tab = viewWritten(tabbed, 'Tab("Home", systemImage: "house") {\n                Text("Home")\n            }')
    expect([scene, tab].map(node => [isNonView(node), node.modifierCatalog, node.layer, node.behavior])).toEqual([[true, [], undefined, undefined], [true, [], undefined, undefined]])
    expect(refusal(tabbed, 'Tab("Home", systemImage: "house") {\n                Text("Home")\n            }', { kind: 'modifier-add', name: 'padding' })).toBe('Tab is part of the app, not a view, so it takes none of a view’s settings. Select the view inside it.')
  })

  it('can still be taken away, and given a view', () => {
    const two = written(INBOX, { kind: 'toolbar-item-add', placement: 'trailing' })
    expect(refusal(two, ITEM, { kind: 'delete' })).toBeUndefined()
    expect(refusal(INBOX, ITEM, { kind: 'insert', snippet: 'Text("New")' })).toBeUndefined()
  })
})

describe('the Bars section’s summary of a screen', () => {
  const MAIL = screen(`        NavigationStack {
            List {
                Text("Row")
            }
            .navigationTitle("Mail")
            .searchable(text: $query, prompt: "Find mail")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Edit") { }
                }
                ToolbarItem(placement: .principal) {
                    Text("Mailboxes")
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    Button("Archive") { }
                    Button { } label: {
                        Image(systemName: "square.and.pencil")
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { }
                }
                ToolbarItem {
                    Menu {
                        Button("Flag") { }
                    } label: {
                        Label("More", systemImage: "ellipsis")
                    }
                }
            }
            .sheet(isPresented: .constant(false)) {
                NavigationStack {
                    Text("Sheet")
                        .navigationTitle("Compose")
                        .toolbar { Button("Send") { } }
                        .searchable(text: .constant(""))
                }
            }
        }`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var query = ""\n')

  it('lists its toolbar items with their placements and labels, its title and its search field, and none of its sheet’s', () => {
    const model = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(MAIL) })
    const bars = model.nodes.find(n => n.kind === 'definition' && n.name === 'ContentView')!.bars!
    const named = (id: string) => model.nodes.find(n => n.id === id)!
    expect(bars.items.map(item => [named(item.node).name, item.placement, item.label])).toEqual([
      ['ToolbarItem', 'leading', 'Edit'], ['ToolbarItem', 'principal', 'Mailboxes'], ['ToolbarItemGroup', 'bottom', 'Archive, square.and.pencil'], ['ToolbarItem', null, 'Done'], ['ToolbarItem', 'automatic', 'More'],
    ])
    expect(named(bars.title!.node).name).toBe('List')
    expect(named(bars.title!.node).controls?.find(c => c.id === bars.title!.control)?.value).toBe('Mail')
    expect(bars.search).toMatchObject({ node: bars.title!.node, prompt: 'Find mail' })
    expect(named(bars.search!.node).controls?.find(c => c.id === bars.search!.control)?.label).toBe('Prompt')
    expect(bars.barless).toBeUndefined()
    expect(bars.problem).toBeUndefined()
    expect(bars.searchProblem).toBeUndefined()
  })

  it('says when the screen has no bar for its title, and why an item or a search field can’t be added', () => {
    const app = screen('        Text("Hi")\n            .navigationTitle("Home")')
    expect(barsOf(app)).toMatchObject({ barless: true, items: [] })
    expect(barsOf(app)?.search).toBeUndefined()
    expect(barsOf(app, 'ContentView', '15.0')).toMatchObject({ problem: 'Toolbar items need a navigation stack here, which needs iOS 16 or newer. Change the deployment target to add one.', searchProblem: 'A search field needs a navigation stack here, which needs iOS 16 or newer. Change the deployment target to add one.' })
    expect(barsOf(app, 'ContentView', '14.0')?.searchProblem).toBe('A search field needs iOS 15 or newer. Change the deployment target to add one.')
    const split = screen('        HStack {\n            Text("A")\n        }\n        Text("B")')
    expect(barsOf(split)?.problem).toBe('This screen’s views aren’t in one view to put this on. Change it in Code.')
    const tabs = screen('        TabView {\n            Text("A")\n                .tabItem { Label("A", systemImage: "a.circle") }\n        }')
    expect(onScreen(tabs, { kind: 'toolbar-item-add', placement: 'trailing' })).toEqual({ refused: 'This screen holds the app’s tabs. Add this to a tab’s screen.' })
  })

  it.each([
    ['a Tab', `        TabView {
            Tab("Home", systemImage: "house") {
                NavigationStack {
                    List {
                        Text("Row")
                    }
                    .navigationTitle("Home")
                }
            }
        }`],
    ['.tabItem', `        TabView {
            NavigationStack {
                Text("Row")
                    .navigationTitle("Home")
            }
            .tabItem { Label("Home", systemImage: "house") }
        }`],
    ['the TabView itself', `        NavigationStack {
            TabView {
                Text("Row")
                    .tabItem { Label("Home", systemImage: "house") }
            }
            .navigationTitle("Home")
        }`],
  ])('refuses to add to a screen of tabs whose title is in %s, saying why', (_, body) => {
    const why = 'This screen holds the app’s tabs. Add this to a tab’s screen.'
    expect(barsOf(screen(body))).toMatchObject({ problem: why, searchProblem: why })
    expect(onScreen(screen(body), { kind: 'toolbar-item-add', placement: 'trailing' })).toEqual({ refused: why })
    expect(onScreen(screen(body), { kind: 'searchable-add', prompt: 'Search' })).toEqual({ refused: why })
  })

  it('is on screens alone: not on the app, a helper or a #Preview', () => {
    const model = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(MAIL + '\n#Preview {\n    ContentView()\n}\n') })
    expect(model.nodes.filter(n => n.bars).map(n => n.name)).toEqual(['ContentView'])
  })
})

describe('the Search field switch', () => {
  const LIST = screen(`        NavigationStack {
            List {
                Text("Row")
            }
            .navigationTitle("Fruit")
        }`)
  const searching = () => written(LIST, { kind: 'searchable-add', prompt: 'Search' })

  it('on, keeps the searched text in the screen’s state and adds the field where the title goes', () => {
    expect(searching()).toContain(`struct ContentView: View {
    @State private var searchText = ""
    var body: some View {
        NavigationStack {
            List {
                Text("Row")
            }
            .navigationTitle("Fruit")
            .searchable(text: $searchText, prompt: "Search")
        }
    }
}`)
  })

  it('names the state with a free name, and leaves out an empty prompt', () => {
    const taken = LIST.replace('struct ContentView: View {\n', 'struct ContentView: View {\n    let searchText = "kiwi"\n')
    const text = written(taken, { kind: 'searchable-add', prompt: '' })
    expect(text).toContain('    @State private var searchText2 = ""\n')
    expect(text).toContain('.searchable(text: $searchText2)\n')
  })

  it('searches the text the screen keeps already: its searchText, or what its filter reads, never a second beside it', () => {
    const FRUIT = screen(`        NavigationStack {
            List(shown, id: \\.self) { name in
                Text(name)
            }
            .navigationTitle("Fruit")
        }`)
    const keeping = (members: string) => FRUIT.replace('struct ContentView: View {\n', `struct ContentView: View {\n${members}`)
    // Off kept the state its filter reads, so on searches it again.
    const filtered = keeping('    @State private var searchText = ""\n    var shown: [String] { ["Kiwi", "Fig"].filter { searchText.isEmpty || $0.contains(searchText) } }\n')
    const on = written(filtered, { kind: 'searchable-add', prompt: 'Search' })
    expect(on).toContain('            .navigationTitle("Fruit")\n            .searchable(text: $searchText, prompt: "Search")\n')
    expect(on.match(/@State/g)).toHaveLength(1)
    const query = keeping('    @State private var query = ""\n    var shown: [String] { ["Kiwi", "Fig"].filter { query.isEmpty || $0.contains(query) } }\n')
    expect(written(query, { kind: 'searchable-add', prompt: '' })).toContain('.searchable(text: $query)\n')
    const unused = keeping('    @State private var searchText = ""\n    let shown = ["Kiwi"]\n')
    expect(written(unused, { kind: 'searchable-add', prompt: '' }).match(/searchText\d|@State/g)).toEqual(['@State'])
    // One a search field elsewhere is bound to stays that field's.
    const bound = keeping('    @State private var searchText = ""\n    let shown = ["Kiwi"]\n').replace('            .navigationTitle("Fruit")\n', '            .navigationTitle("Fruit")\n            .sheet(isPresented: .constant(false)) { Text("Find").searchable(text: $searchText) }\n')
    expect(written(bound, { kind: 'searchable-add', prompt: '' })).toContain('    @State private var searchText2 = ""\n')
    const counted = keeping('    @State private var searchText = 0\n    let shown = ["Kiwi"]\n')
    expect(written(counted, { kind: 'searchable-add', prompt: '' })).toContain('.searchable(text: $searchText2)\n')
  })

  it('gives a field with no prompt an empty Prompt, showing iOS’s “Search” until one is written', () => {
    const presented = LIST.replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var query = ""\n    @State private var searching = false\n').replace('.navigationTitle("Fruit")', '.navigationTitle("Fruit")\n            .searchable(text: $query, isPresented: $searching)')
    const list = 'List {\n                Text("Row")\n            }\n            .navigationTitle("Fruit")\n            .searchable(text: $query, isPresented: $searching)'
    expect(viewWritten(presented, list, '17.0').controls?.find(c => c.id === 'modifier:1:detail:prompt')).toMatchObject({ label: 'Prompt', value: '', placeholder: 'Search', disabledReason: undefined })
    expect(barsOf(presented, 'ContentView', '17.0')?.search).toEqual({ node: viewWritten(presented, list, '17.0').id, control: 'modifier:1:detail:prompt' })
    expect(edited(presented, list, { kind: 'property', control: 'modifier:1:detail:prompt', value: 'Find fruit' }, '17.0')).toContain('.searchable(text: $query, isPresented: $searching, prompt: "Find fruit")')
    expect(viewWritten(searching().replace(', prompt: "Search"', ''), list.replace(', isPresented: $searching', '').replace('$query', '$searchText')).controls?.find(c => c.id === 'modifier:1:detail:prompt')?.placeholder).toBe('Search')
  })

  it('wraps a screen shown on no stack, as a toolbar item does, and refuses below iOS 15, saying why', () => {
    const bare = screen('        List {\n            Text("Row")\n        }')
    expect(bodyOf(project(written(bare, { kind: 'searchable-add', prompt: 'Find' })))).toBe(`        NavigationStack {
            List {
                Text("Row")
            }
            .searchable(text: $searchText, prompt: "Find")
        }`)
    expect(onScreen(bare, { kind: 'searchable-add', prompt: 'Find' }, 'ContentView', '14.0')).toEqual({ refused: 'A search field needs iOS 15 or newer. Change the deployment target to add one.' })
  })

  it('off, takes the field away, and its state when nothing else reads it', () => {
    expect(written(searching(), { kind: 'searchable-remove' })).toBe(LIST)
    const read = searching().replace('Text("Row")', 'Text(searchText)')
    const kept = written(read, { kind: 'searchable-remove' })
    expect(kept).toContain('@State private var searchText = ""')
    expect(kept).not.toContain('.searchable')
  })

  it('is read back by the screen’s Bars, and the field’s Prompt and Placement are edited on its card', () => {
    const text = searching()
    expect(barsOf(text)?.search).toMatchObject({ prompt: 'Search' })
    const list = 'List {\n                Text("Row")\n            }\n            .navigationTitle("Fruit")\n            .searchable(text: $searchText, prompt: "Search")'
    expect(edited(text, list, { kind: 'property', control: 'modifier:1:detail:prompt', value: 'Find fruit' })).toContain('.searchable(text: $searchText, prompt: "Find fruit")')
    expect(edited(text, list, { kind: 'property', control: 'modifier:1:detail:prompt', value: '' })).toContain('.searchable(text: $searchText)\n')
    expect(edited(text, list, { kind: 'property', control: 'modifier:1:detail:placement', value: 'Under the title' })).toContain('.searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search")')
    const bare = text.replace(', prompt: "Search"', '')
    expect(edited(bare, list.replace(', prompt: "Search"', ''), { kind: 'property', control: 'modifier:1:detail:prompt', value: 'Find' })).toContain('.searchable(text: $searchText, prompt: "Find")')
  })
})

/**
 * A screen's title shows in a navigation bar, which only a navigation stack gives it, so Bars
 * says when a screen certainly has none (doc 18, Fix first 8; moved from the web app in Wave 4b).
 */
describe('whether a screen has a bar for its title', () => {
  const titled = (sheet: string, presented = 'SettingsSheet()') => `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
    @State private var showing = false
    var body: some View {
        NavigationStack {
            VStack {
                Button("Open") { showing = true }
                NavigationLink("Details") { DetailScreen() }
            }
            .sheet(isPresented: $showing) { ${presented} }
            .navigationTitle("Home")
        }
    }
}
struct DetailScreen: View { var body: some View { Text("Details").navigationTitle("Details") } }
struct SettingsSheet: View { var body: some View { ${sheet} } }
`
  const barless = (source: string, view: string) => !!barsOf(source, view)?.barless

  it('is none on a sheet’s screen, and one on a screen in a stack, pushed, or in a sheet that brings its own', () => {
    const plain = titled('VStack { Text("Hi") }.navigationTitle("Settings")')
    expect([barless(plain, 'SettingsSheet'), barless(plain, 'HomeScreen'), barless(plain, 'DetailScreen')]).toEqual([true, false, false])
    expect(barsOf(plain, 'HomeScreen')?.title).toBeDefined()
    expect(barless(titled('NavigationStack { VStack { Text("Hi") }.navigationTitle("Settings") }'), 'SettingsSheet')).toBe(false)
    expect(barless(titled('VStack { Text("Hi") }.navigationTitle("Settings")', 'NavigationStack { SettingsSheet() }'), 'SettingsSheet')).toBe(false)
    // With no title, the screen's content is asked: a sheet's own stack gives it a bar.
    expect(barless(titled('NavigationStack { VStack { Text("Hi") } }'), 'SettingsSheet')).toBe(false)
    expect(barless(titled('VStack { Text("Hi") }'), 'SettingsSheet')).toBe(true)
  })

  it.each([
    ['the sidebar of a split view', 'NavigationSplitView { ListScreen() } detail: { Text("Pick one") }', ''],
    ['a stack around a helper property', 'NavigationStack { content }', '\n    var content: some View { ListScreen() }'],
    ['nothing the model can see', 'Text("Home")', ''],
  ])('is not said to be none on a screen shown in %s', (_, body, members) => {
    const source = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
    var body: some View { ${body} }${members}
}
struct ListScreen: View { var body: some View { List { Text("A") }.navigationTitle("Items") } }
`
    expect(barless(source, 'ListScreen')).toBe(false)
  })

  it('is none on the screen the app starts on when no stack is around it', () => {
    expect(barless(`import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View { var body: some View { Text("Hi").navigationTitle("Home") } }
`, 'HomeScreen')).toBe(true)
  })
})

describe('an empty state', () => {
  const FRUIT = screen(`        List(items) { item in
            Text(item.title)
        }`, `
struct Fruit: Identifiable {
    let id: String
    var title: String
}
`).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var items: [Fruit] = [Fruit(id: "kiwi", title: "Kiwi")]\n')
  const LIST = 'List(items) { item in\n            Text(item.title)\n        }'

  it('is iOS’s own empty view from iOS 17, with the message as its description, and a text before it', () => {
    expect(bodyOf(project(edited(FRUIT, LIST, { kind: 'empty-state', text: 'Try a different search.' })))).toBe(`        Group {
            if items.isEmpty {
                ContentUnavailableView("No Results", systemImage: "magnifyingglass", description: Text("Try a different search."))
            } else {
                List(items) { item in
                    Text(item.title)
                }
            }
        }`)
    expect(edited(FRUIT, LIST, { kind: 'empty-state', text: 'Nothing here' }, '16.0')).toContain('            if items.isEmpty {\n                Text("Nothing here")\n')
  })
})

describe.skipIf(!XCODE)('the forms Bars writes, in Xcode 27', () => {
  it('type-check at their lowest iOS with warnings as errors', () => {
    // Before iOS 16 a screen is stacked in a NavigationView.
    const older = INBOX.replace('NavigationStack', 'NavigationView')
    let placed = older
    for (const placement of ['trailing', 'principal', 'bottom', 'automatic', 'leading'] as const) placed = written(placed, { kind: 'toolbar-item-add', placement }, 'ContentView', '14.0')
    const item = 'ToolbarItem(placement: .topBarLeading) {\n                    Button("Edit") { }\n                }'
    const automatic = edited(older, item, { kind: 'property', control: 'toolbar:placement', value: 'Automatic' }, '14.0')
    const views = written(screen('        NavigationView {\n            Text("Row")\n                .toolbar { Button("Reset") { } }\n        }'), { kind: 'toolbar-item-add', placement: 'bottom' }, 'ContentView', '14.0')
    const group = written(older, { kind: 'toolbar-item-add', placement: 'bottom', snippet: 'ToolbarItemGroup(placement: .bottomBar) {\n    Button("A") { }\n    Spacer()\n    Button("B") { }\n}' }, 'ContentView', '14.0')
    const wrapped = written(screen('        VStack {\n            Text("Hi")\n        }'), { kind: 'toolbar-item-add', placement: 'trailing' }, 'ContentView', '16.0')
    const searched = written(older, { kind: 'searchable-add', prompt: 'Find mail' }, 'ContentView', '15.0')
    const drawer = edited(searched, searched.slice(searched.indexOf('List {'), searched.indexOf('prompt: "Find mail")') + 'prompt: "Find mail")'.length), { kind: 'property', control: 'modifier:2:detail:placement', value: 'Under the title' }, '15.0')
    const searchWrapped = written(screen('        List {\n            Text("Row")\n        }'), { kind: 'searchable-add', prompt: 'Search' }, 'ContentView', '16.0')
    const unsearched = written(drawer, { kind: 'searchable-remove' }, 'ContentView', '15.0')
    const empty = edited(screen('        List(items) { item in\n            Text(item.title)\n        }', '\nstruct Fruit: Identifiable {\n    let id: String\n    var title: String\n}\n').replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var items: [Fruit] = [Fruit(id: "kiwi", title: "Kiwi")]\n'), 'List(items) { item in\n            Text(item.title)\n        }', { kind: 'empty-state', text: 'Try a different search.' }, '17.0')
    for (const placement of ['.topBarLeading', '.topBarTrailing', '.principal', '.bottomBar', 'ToolbarItem {']) expect(placed).toContain(placement)
    // Each form is in the Swift checked, as each writes it.
    expect(automatic).toContain('            .toolbar {\n                ToolbarItem {\n')
    expect(views).toContain('                .toolbar { Button("Reset") { } }\n                .toolbar {\n                    ToolbarItem(placement: .bottomBar) {\n')
    expect(group).toContain('                ToolbarItemGroup(placement: .bottomBar) {\n                    Button("A") { }\n                    Spacer()\n')
    expect(wrapped).toContain('        NavigationStack {\n            VStack {\n')
    expect(drawer).toContain('.searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find mail")')
    expect(searchWrapped).toContain('        NavigationStack {\n            List {\n')
    expect(empty).toContain('ContentUnavailableView("No Results", systemImage: "magnifyingglass", description: Text("Try a different search."))')
    expect(unsearched).not.toContain('searchable')
    // A split view's column, the screen's own toolbar content, the text a filter reads and a prompt beside isPresented.
    const split = screen('        NavigationSplitView {\n            List {\n                Text("Inbox")\n            }\n            .navigationTitle("Folders")\n        } detail: {\n            Text("Pick one")\n        }')
    const splitItem = written(split, { kind: 'toolbar-item-add', placement: 'trailing' }, 'ContentView', '16.0')
    const splitSearch = written(split, { kind: 'searchable-add', prompt: 'Search' }, 'ContentView', '16.0')
    const built = written(screen('        NavigationView {\n            Text("Row")\n                .toolbar { items }\n        }').replace('    var body: some View {\n', '    @ToolbarContentBuilder var items: some ToolbarContent {\n        ToolbarItem(placement: .topBarLeading) { Button("Edit") { } }\n    }\n\n    var body: some View {\n'), { kind: 'toolbar-item-add', placement: 'trailing' }, 'ContentView', '14.0')
    const filtering = screen('        NavigationView {\n            List(shown, id: \\.self) { name in\n                Text(name)\n            }\n            .navigationTitle("Fruit")\n        }').replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var query = ""\n    var shown: [String] { ["Kiwi", "Fig"].filter { query.isEmpty || $0.contains(query) } }\n')
    const reused = written(filtering, { kind: 'searchable-add', prompt: 'Find fruit' }, 'ContentView', '15.0')
    const presented = filtering.replace('.navigationTitle("Fruit")', '.navigationTitle("Fruit")\n            .searchable(text: $query, isPresented: $searching)').replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var searching = false\n').replace('NavigationView', 'NavigationStack')
    const prompted = edited(presented, presented.slice(presented.indexOf('List(shown'), presented.indexOf('isPresented: $searching)') + 'isPresented: $searching)'.length), { kind: 'property', control: 'modifier:1:detail:prompt', value: 'Find fruit' }, '17.0')
    expect(splitItem).toContain('            .navigationTitle("Folders")\n            .toolbar {\n')
    expect(splitSearch).toContain('            .navigationTitle("Folders")\n            .searchable(text: $searchText, prompt: "Search")\n')
    expect(built).toContain('                .toolbar { items }\n                .toolbar {\n')
    expect(reused).toContain('.searchable(text: $query, prompt: "Find fruit")')
    expect(prompted).toContain('.searchable(text: $query, isPresented: $searching, prompt: "Find fruit")')
    const forms: [string, string][] = [['14.0', placed], ['14.0', automatic], ['14.0', views], ['14.0', group], ['16.0', wrapped], ['15.0', searched], ['15.0', drawer], ['16.0', searchWrapped], ['15.0', unsearched], ['17.0', empty], ['16.0', splitItem], ['16.0', splitSearch], ['14.0', built], ['15.0', reused], ['17.0', prompted]]
    typecheckInXcode(forms.map(([version, text]) => `// target: iOS ${version}\n${text}`))
  }, 300_000)
})
