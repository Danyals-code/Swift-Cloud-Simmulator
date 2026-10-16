import { beforeEach, describe, expect, it } from 'vitest'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { resetPipelineState } from '@studio/swiftui-runtime'
import type { AuthoringNode, DesignEditRequest, ScreenBars } from '@studio/shared'
import { APP, XCODE, draw, edited, project, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 6c, around the screen and iOS 27 chrome, as Design reads and writes it: the Search tab
 * switch in Screen > Bars, which writes `Tab(role: .search)` beside tabs written as `Tab`, and
 * the Placement field's Navigation and Status.
 */

/** The screen called `view`'s definition, as Screen settings receives it. */
function definition(source: string, view = 'ContentView', target?: string): AuthoringNode {
  const found = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(source), deploymentTarget: target }).nodes.find(n => n.kind === 'definition' && n.name === view)
  if (!found) throw new Error(`No screen called ${view}`)
  return found
}
/** What the planner makes of `operation` on the screen: the file after it, or the reason it was refused. */
function onScreen(source: string, operation: DesignEditRequest['operation'], target?: string): { text: string } | { refused: string } {
  const screenNode = definition(source, 'ContentView', target)
  const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: project(source), scope: screenNode.owner, target: screenNode.source, fingerprint: screenNode.fingerprint, deploymentTarget: target, operation })
  return plan.ok ? { text: plan.changes.find(change => change.file === APP)?.after ?? source } : { refused: plan.reason }
}
function written(source: string, operation: DesignEditRequest['operation'], target?: string): string {
  const result = onScreen(source, operation, target)
  if ('refused' in result) throw new Error(result.refused)
  return result.text
}
const barsOf = (source: string, target?: string): ScreenBars | undefined => definition(source, 'ContentView', target).bars

const TABS = screen(`        TabView {
            Tab("Home", systemImage: "house") {
                NavigationStack {
                    Text("Home")
                        .navigationTitle("Home")
                }
            }
            Tab("Saved", systemImage: "bookmark") {
                Text("Saved")
            }
        }`)
const SEARCH_TAB = `            Tab(role: .search) {
                NavigationStack {
                    Text("Search")
                        .navigationTitle("Search")
                }
            }`
const SEARCHED = TABS.replace('                Text("Saved")\n            }\n', `                Text("Saved")\n            }\n${SEARCH_TAB}\n`)

describe('the Search tab switch', () => {
  it('reads a screen of tabs written as Tab with no search tab as off, and nothing for other screens', () => {
    expect(barsOf(TABS)?.searchTab).toEqual({ on: false })
    expect(barsOf(screen('        NavigationStack {\n            Text("Row")\n        }'))?.searchTab).toBeUndefined()
  })

  it('adds a search tab as the last tab, at the tabs’ indent, and takes it away again, leaving the code as it was', () => {
    const added = written(TABS, { kind: 'search-tab-add' })
    expect(added).toBe(SEARCHED)
    expect(written(added, { kind: 'search-tab-remove' })).toBe(TABS)
  })

  it('reads a search tab back as on, with its Tab to select', () => {
    const model = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(SEARCHED) })
    const bars = model.nodes.find(n => n.kind === 'definition' && n.name === 'ContentView')!.bars!
    const tab = model.nodes.find(n => n.id === bars.searchTab?.node)
    expect(bars.searchTab).toMatchObject({ on: true })
    expect(bars.searchTab?.problem).toBeUndefined()
    expect(tab?.name).toBe('Tab')
    expect(tab?.properties.find(p => p.name === 'role')?.expression).toBe('.search')
  })

  it('writes nothing when the tab is there already, or when there is none to take away', () => {
    expect(written(SEARCHED, { kind: 'search-tab-add' })).toBe(SEARCHED)
    expect(written(TABS, { kind: 'search-tab-remove' })).toBe(TABS)
  })

  it('takes away a search tab written in other words, with its own content', () => {
    const own = TABS.replace('                Text("Saved")\n            }\n', '                Text("Saved")\n            }\n            Tab(role: .search) { SearchScreen() }\n')
    expect(barsOf(own)?.searchTab?.on).toBe(true)
    expect(written(own, { kind: 'search-tab-remove' })).toBe(TABS)
  })

  it('adds to tabs in a NavigationStack, and to tabs grouped in sections', () => {
    const stacked = screen(`        NavigationStack {
            TabView {
                Tab("Home", systemImage: "house") {
                    Text("Home")
                }
            }
        }`)
    expect(written(stacked, { kind: 'search-tab-add' })).toContain(`                Tab("Home", systemImage: "house") {
                    Text("Home")
                }
                Tab(role: .search) {
                    NavigationStack {
                        Text("Search")
                            .navigationTitle("Search")
                    }
                }
            }
        }`)
    const sections = TABS.replace('            Tab("Saved", systemImage: "bookmark") {\n                Text("Saved")\n            }\n', '            TabSection("Library") {\n                Tab("Saved", systemImage: "bookmark") {\n                    Text("Saved")\n                }\n            }\n')
    expect(barsOf(sections)?.searchTab).toEqual({ on: false })
    expect(written(sections, { kind: 'search-tab-add' })).toContain(`                }\n            }\n${SEARCH_TAB}\n        }`)
  })

  it.each([
    ['below iOS 18', TABS, '17.0', 'A search tab needs iOS 18 or newer. Change the deployment target to add one.'],
    ['tabs written with .tabItem', screen(`        TabView {
            Text("Home")
                .tabItem { Label("Home", systemImage: "house") }
        }`), undefined, 'These tabs are written with .tabItem. Write them as Tab to add a search tab in Code.'],
    ['tabs built by a ForEach', screen(`        TabView {
            ForEach(["A", "B"], id: \\.self) { name in
                Tab(name, systemImage: "circle") {
                    Text(name)
                }
            }
        }`), undefined, 'These tabs are built in Swift, so a search tab is added in Code.'],
    ['a TabView that keeps which tab is selected', TABS.replace('        TabView {', '        TabView(selection: $tab) {').replace('struct ContentView: View {\n', 'struct ContentView: View {\n    @State private var tab = 0\n'), undefined, 'This TabView keeps which tab is selected, so a search tab needs a value of its own. Add it in Code.'],
  ])('is read only %s, saying why, and refuses to add one', (_, source, target, why) => {
    expect(barsOf(source, target)?.searchTab).toEqual({ on: false, problem: why })
    expect(onScreen(source, { kind: 'search-tab-add' }, target)).toEqual({ refused: why })
  })

  it('is not offered on pages swiped through, which have no tab bar', () => {
    const pages = screen(`        TabView {
            Tab("A", systemImage: "a.circle") {
                Text("A")
            }
        }
        .tabViewStyle(.page)`)
    expect(barsOf(pages)?.searchTab).toBeUndefined()
    expect(onScreen(pages, { kind: 'search-tab-add' })).toEqual({ refused: 'This screen has no tab bar to add a search tab to.' })
  })
})

/** TABS with its Saved tab in a section called Library, and `extra` written in that section after it. */
const sectioned = (extra = '') => TABS.replace('            Tab("Saved", systemImage: "bookmark") {\n                Text("Saved")\n            }\n', `            TabSection("Library") {\n                Tab("Saved", systemImage: "bookmark") {\n                    Text("Saved")\n                }\n${extra}            }\n`)
/** TABS with views beside its TabView, in `wrapper`, as a floating button or a mini player is written. */
const beside = (wrapper: 'ZStack' | 'VStack', tabs = TABS) => tabs.replace(/ {8}TabView \{[\s\S]*?\n {8}\}\n/, whole => `        ${wrapper} {\n${whole.replace(/^(?=.)/gm, '    ')}            Button("Add", systemImage: "plus") { }\n        }\n`)

describe('the Search tab switch, as reviewed', () => {
  it('reads a search tab inside a TabSection as on, writes no second one, and takes its lines away', () => {
    const inSection = sectioned('                Tab(role: .search) {\n                    Text("Search")\n                }\n')
    expect(barsOf(inSection)?.searchTab).toMatchObject({ on: true })
    expect(barsOf(inSection)?.searchTab?.problem).toBeUndefined()
    expect(written(inSection, { kind: 'search-tab-add' })).toBe(inSection)
    expect(written(inSection, { kind: 'search-tab-remove' })).toBe(sectioned())
  })

  it('reads a search tab alone in its section as on, read only, saying why', () => {
    const alone = TABS.replace('            }\n        }\n    }\n}', '            }\n            TabSection("Find") {\n                Tab(role: .search) {\n                    Text("Search")\n                }\n            }\n        }\n    }\n}')
    expect(alone).toContain('            TabSection("Find") {\n                Tab(role: .search) {')
    const why = 'This search tab is the only tab in its section. Take it away in Code.'
    expect(barsOf(alone)?.searchTab).toMatchObject({ on: true, problem: why })
    expect(onScreen(alone, { kind: 'search-tab-remove' })).toEqual({ refused: why })
  })

  it.each(['ZStack', 'VStack'] as const)('is offered on tabs with views beside them in a %s, and adds and takes away the tab there', wrapper => {
    const tabs = beside(wrapper)
    expect(tabs).toContain(`        ${wrapper} {\n            TabView {\n                Tab("Home", systemImage: "house") {`)
    expect(barsOf(tabs)?.searchTab).toEqual({ on: false })
    const added = written(tabs, { kind: 'search-tab-add' })
    expect(added).toBe(beside(wrapper, SEARCHED))
    expect(barsOf(added)?.searchTab).toMatchObject({ on: true })
    expect(written(added, { kind: 'search-tab-remove' })).toBe(tabs)
  })

  it('says how to change .tabItem tabs, with views beside them too, and says it before the deployment target', () => {
    const items = screen(`        TabView {
            Text("Home")
                .tabItem { Label("Home", systemImage: "house") }
        }`)
    const why = 'These tabs are written with .tabItem. Write them as Tab to add a search tab in Code.'
    expect(barsOf(items)?.searchTab).toEqual({ on: false, problem: why })
    expect(barsOf(beside('ZStack', items))?.searchTab).toEqual({ on: false, problem: why })
    expect(barsOf(items, '17.0')?.searchTab).toEqual({ on: false, problem: 'These tabs are written with .tabItem. Write them as Tab, at iOS 18 or newer, to add a search tab in Code.' })
  })

  it('takes a note at the end of the search tab’s line away with it', () => {
    const noted = TABS.replace('                Text("Saved")\n            }\n', '                Text("Saved")\n            }\n            Tab(role: .search) { SearchScreen() } // find anything\n')
    expect(written(noted, { kind: 'search-tab-remove' })).toBe(TABS)
  })
})

describe('Placement: Navigation and Status', () => {
  const ITEM = 'ToolbarItem(placement: .topBarLeading) {\n                    Button("Edit") { }\n                }'
  const INBOX = screen(`        NavigationStack {
            List {
                Text("Row")
            }
            .navigationTitle("Inbox")
            .toolbar {
                ${ITEM}
            }
        }`)
  const placementOf = (source: string, item: string) => viewWritten(source, item).controls?.find(c => c.id === 'toolbar:placement')
  const set = (value: string) => ({ kind: 'property' as const, control: 'toolbar:placement', value })

  it('offers them in the Placement select, and writes .navigation and .status', () => {
    expect(placementOf(INBOX, ITEM)?.options).toEqual(['Leading', 'Trailing', 'Title', 'Bottom', 'Navigation', 'Status', 'Automatic'])
    expect(edited(INBOX, ITEM, set('Navigation'))).toContain('ToolbarItem(placement: .navigation) {')
    expect(edited(INBOX, ITEM, set('Status'))).toContain('ToolbarItem(placement: .status) {')
  })

  it('reads them back, in the field and in Bars', () => {
    const status = INBOX.replace('.topBarLeading', '.status')
    expect(placementOf(status, ITEM.replace('.topBarLeading', '.status'))?.value).toBe('Status')
    const navigation = INBOX.replace('.topBarLeading', '.navigation')
    expect(placementOf(navigation, ITEM.replace('.topBarLeading', '.navigation'))?.value).toBe('Navigation')
    expect(barsOf(status)?.items.map(item => item.placement)).toEqual(['status'])
    expect(barsOf(navigation)?.items.map(item => item.placement)).toEqual(['navigation'])
  })

  it('says which placements Bars sets when one is shown read only', () => {
    const confirm = INBOX.replace('.topBarLeading', '.confirmationAction')
    expect(placementOf(confirm, ITEM.replace('.topBarLeading', '.confirmationAction'))?.disabledReason).toBe('Bars sets Leading, Trailing, Title, Bottom, Navigation, Status and Automatic. Change this placement in Code.')
  })

  it('adds an item at either, a plain button, when asked for one there', () => {
    expect(written(INBOX, { kind: 'toolbar-item-add', placement: 'status' })).toContain('                ToolbarItem(placement: .status) {\n                    Button("Action") { }\n                }\n')
    expect(written(INBOX, { kind: 'toolbar-item-add', placement: 'navigation' })).toContain('                ToolbarItem(placement: .navigation) {\n                    Button("Action") { }\n                }\n')
  })
})

/** The checker's word on a one-screen project, as the Problems pane lists it. */
const said = (body: string) => draw(project(screen(body))).diagnostics.filter(d => d.code !== 'runtime_trap').map(d => `${d.severity}: ${d.message}`)

/** iOS 26 and 27 chrome the preview now draws (Wave 6c), each type-checked in Xcode 27 below. */
const DRAWN = [
  ['GlassEffectContainer', `        GlassEffectContainer(spacing: 20) {
            HStack {
                Text("A").padding().glassEffect()
                Text("B").padding().glassEffect()
            }
        }`],
  ['ToolbarSpacer and DefaultToolbarItem', `        NavigationStack {
            Text("A")
                .searchable(text: .constant(""))
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { Button("A") {} }
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                    ToolbarItem(placement: .topBarTrailing) { Button("B") {} }
                    ToolbarSpacer(.flexible, placement: .bottomBar)
                    DefaultToolbarItem(kind: .search, placement: .bottomBar)
                }
        }`],
  ['navigationSubtitle', `        NavigationStack {
            Text("A")
                .navigationTitle("Inbox")
                .navigationSubtitle("3 unread")
        }`],
  ['tabViewBottomAccessory and a search tab', `        TabView {
            Tab("Home", systemImage: "house") {
                Text("Home")
            }
            Tab(role: .search) {
                Text("Search")
            }
        }
        .tabViewBottomAccessory {
            Text("Now playing")
        }`],
  ['a compact popover', `        Button("Info") { }
            .popover(isPresented: .constant(true)) {
                Text("Details")
                    .padding()
                    .presentationCompactAdaptation(.popover)
            }`],
  ['the Navigation and Status placements', `        NavigationStack {
            Text("A")
                .toolbar {
                    ToolbarItem(placement: .navigation) { Button("Menu", systemImage: "line.3.horizontal") {} }
                    ToolbarItem(placement: .status) { Text("Updated just now") }
                    ToolbarItem(placement: .secondaryAction) { Button("More") {} }
                    ToolbarItem(placement: .confirmationAction) { Button("Done") {} }
                    ToolbarItem(placement: .primaryAction) { Button("Add") {} }
                }
        }`],
] as const

/** What the checker still warns of, each real Swift that Xcode 27 builds. */
const STILL_WARNED = `        NavigationStack {
            Text("A")
                .searchable(text: .constant(""))
                .toolbar {
                    DefaultToolbarItem(kind: .search, placement: .topBarTrailing)
                    DefaultToolbarItem(kind: .sidebarToggle, placement: .bottomBar)
                    DefaultToolbarItem(kind: .search)
                }
                .popover(isPresented: .constant(true), attachmentAnchor: .point(.top), arrowEdge: .bottom) {
                    VStack {
                        Text("A").presentationCompactAdaptation(.fullScreenCover)
                        Text("B").presentationCompactAdaptation(horizontal: .fullScreenCover, vertical: .popover)
                    }
                }
        }`

describe('the checker on iOS 27 chrome', () => {
  beforeEach(resetPipelineState)

  it.each(DRAWN)('says nothing of %s, which the preview draws', (_, body) => {
    expect(said(body)).toEqual([])
  })

  it('still says toolbarColorScheme and tabBarMinimizeBehavior are not applied', () => {
    const lines = said(`        TabView {
            Tab("Home", systemImage: "house") {
                NavigationStack {
                    Text("Home")
                        .toolbarColorScheme(.dark, for: .navigationBar)
                }
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)`)
    expect(lines).toEqual([
      "warning: '.toolbarColorScheme' is recognized but not applied by the preview. It is exported to Xcode unchanged.",
      "warning: '.tabBarMinimizeBehavior' is recognized but not applied by the preview. It is exported to Xcode unchanged.",
    ])
  })

  it.each(['.none', '.sheet', 'horizontal: .popover, vertical: .sheet', 'horizontal: .none, vertical: .fullScreenCover'])('says nothing of a compact adaptation of %s, a popover or the sheet an iPhone shows', adaptation => {
    expect(said(`        Button("Info") { }
            .popover(isPresented: .constant(true)) {
                Text("Details")
                    .presentationCompactAdaptation(${adaptation})
            }`)).toEqual([])
  })

  it.each(['.fullScreenCover', 'horizontal: .fullScreenCover, vertical: .popover'])('still says a compact adaptation of %s is shown as a sheet', adaptation => {
    expect(said(`        Button("Info") { }
            .popover(isPresented: .constant(true)) {
                Text("Details")
                    .presentationCompactAdaptation(${adaptation})
            }`)).toEqual(["warning: '.presentationCompactAdaptation' is drawn by the preview for .popover and .none, and .sheet and .automatic are the sheet an iPhone shows anyway; this one is shown as a sheet. It is exported to Xcode unchanged."])
  })

  it.each([
    ['attachmentAnchor', 'attachmentAnchor: .point(.top)', 'attachmentAnchor is'],
    ['arrowEdge', 'arrowEdge: .bottom', 'arrowEdge is'],
    ['both', 'attachmentAnchor: .rect(.bounds), arrowEdge: .leading', 'attachmentAnchor and arrowEdge are'],
  ])('says a popover’s %s is not drawn', (_, args, what) => {
    expect(said(`        Button("Info") { }
            .popover(isPresented: .constant(true), ${args}) {
                Text("Details")
                    .presentationCompactAdaptation(.popover)
            }`)).toEqual([`warning: .popover: ${what} not applied in the preview, so a popover drawn as one points at the middle of its view's edge. The source exports unchanged.`])
  })

  it.each([
    ['in the top bar', 'DefaultToolbarItem(kind: .search, placement: .topBarTrailing)'],
    ['of another kind', 'DefaultToolbarItem(kind: .sidebarToggle, placement: .bottomBar)'],
    ['with no placement', 'DefaultToolbarItem(kind: .search)'],
  ])('still says a DefaultToolbarItem %s is not drawn', (_, item) => {
    expect(said(`        NavigationStack {
            Text("A")
                .searchable(text: .constant(""))
                .toolbar {
                    ${item}
                }
        }`)).toEqual(["warning: 'DefaultToolbarItem' is drawn in the preview as the search field in the bottom bar alone, so this one is not drawn here. Xcode draws it as written."])
  })
})

describe.skipIf(!XCODE)('the forms 6c writes, in Xcode 27', () => {
  it('type-check at their lowest iOS with warnings as errors', () => {
    const INBOX = screen('        NavigationView {\n            Text("Row")\n                .navigationTitle("Inbox")\n        }')
    let placed = INBOX
    for (const placement of ['navigation', 'status'] as const) placed = written(placed, { kind: 'toolbar-item-add', placement }, '14.0')
    expect(placed).toContain('ToolbarItem(placement: .navigation) {')
    expect(placed).toContain('ToolbarItem(placement: .status) {')
    const searched = written(TABS, { kind: 'search-tab-add' }, '18.0')
    const sections = written(TABS.replace('            Tab("Saved", systemImage: "bookmark") {\n                Text("Saved")\n            }\n', '            TabSection("Library") {\n                Tab("Saved", systemImage: "bookmark") {\n                    Text("Saved")\n                }\n            }\n'), { kind: 'search-tab-add' }, '18.0')
    expect(searched).toBe(SEARCHED)
    expect(sections).toContain('Tab(role: .search) {')
    const inSection = sectioned('                Tab(role: .search) {\n                    Text("Search")\n                }\n')
    const fromSection = written(inSection, { kind: 'search-tab-remove' }, '18.0')
    const besides = (['ZStack', 'VStack'] as const).map(wrapper => written(beside(wrapper), { kind: 'search-tab-add' }, '18.0'))
    typecheckInXcode([`// target: iOS 14.0\n${placed}`, `// target: iOS 18.0\n${searched}`, `// target: iOS 18.0\n${sections}`, `// target: iOS 18.0\n${inSection}`, `// target: iOS 18.0\n${fromSection}`, ...besides.map(source => `// target: iOS 18.0\n${source}`), ...DRAWN.map(([, body]) => screen(body)), screen(STILL_WARNED), screen(`        Button("Info") { }\n            .popover(isPresented: .constant(true)) {\n                VStack {\n${['.none', '.sheet', 'horizontal: .popover, vertical: .sheet', 'horizontal: .none, vertical: .fullScreenCover'].map(a => `                    Text("A").presentationCompactAdaptation(${a})`).join('\n')}\n                }\n            }`)])
  }, 300_000)
})
