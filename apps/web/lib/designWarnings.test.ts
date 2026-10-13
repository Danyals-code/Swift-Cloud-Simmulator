import { beforeEach, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { designWarnings } from './designWarnings'
import { screenCatalog } from './screens'

beforeEach(resetPipelineState)
function run(text: string) {
  // Every screen, as the Design canvas draws them.
  const result = compile({ projectId: 'warnings', revision: 1, files: [{ id: 'App.swift', text }], canvas: { width: 402, height: 874 }, colorScheme: 'light', allPages: true })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return designWarnings(result.diagnostics, result.authoring, screenCatalog(result.authoring, result.pages))
}
const TWO_SCREENS = `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
  var body: some View {
    NavigationStack {
      VStack {
        Link("Help", destination: URL(string: "https://example.com")!)
        NavigationLink("Details") { DetailsScreen() }
      }
      .navigationTitle("Home")
    }
  }
}
struct DetailsScreen: View {
  var body: some View {
    VStack {
      Text("Tap").contentShape(Rectangle())
      Image(systemName: "star.fil")
    }
  }
}`

it('finds the layer each warning is on (D11)', () => {
  expect(run(TWO_SCREENS).map(row => row.node?.name)).toEqual(['Link', 'Text', 'Image'])
})

it('says each warning in a designer\'s words, under the screen it is on, in two kinds (D11)', () => {
  expect(run(TWO_SCREENS).map(row => [row.kind, row.screen, row.what, row.sentence])).toEqual([
    ['preview', 'Home', 'Help', 'Tapping it opens nothing in the preview. In the app it opens the link.'],
    ['preview', 'Details', 'Tap', "The preview doesn't apply .contentShape. The app does."],
    ['xcode', 'Details', 'Symbols', "The preview has no drawing for the symbol 'star.fil' and shows a question mark. Did you mean 'star.fill'? If 'star.fil' is right, it still shows in the app."],
  ])
})

const screen = (body: string, extra = '') => `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
  var body: some View {
    VStack {
      ${body}
    }
  }
}
${extra}`

it.each([
  ['a view drawn as a box', 'Chart { }', 'preview', 'The preview shows a labelled box in its place. The app draws it.'],
  ['a view nobody declares', 'Sparkline()', 'xcode', "The preview doesn't know 'Sparkline' and shows a box for it. If it isn't SwiftUI's or the project's, the app won't build."],
  ['a modifier nobody declares', 'Text("A").glow()', 'xcode', "The preview doesn't know .glow and leaves it out. If it isn't SwiftUI's, the app won't build."],
  ['a view the preview runs only in part', 'TimelineView(.everyMinute) { context in Text("Now") }', 'preview', 'The timeline runs only once, for the moment it is drawn, and does not advance its schedule.'],
  ['uneven corners', 'Color.blue.clipShape(.rect(topLeadingRadius: 20))', 'preview', 'Its corners are drawn equal in the preview, all with the largest radius. The app draws each corner as written.'],
  ['a blend the preview has no equivalent for', 'Text("A").blendMode(.destinationOut)', 'preview', "'.blendMode(.destinationOut)' has no equivalent the preview can draw, so it is ignored rather than approximated. The app uses it as written."],
  ['an argument the modifier does not take', 'Text("A").blur(radius: 4, amount: 2)', 'xcode', "'.blur' has no argument 'amount:', so the preview ignores it. The app won't build with it: change it in Code."],
])('says %s plainly (D11)', (_, body, kind, sentence) => {
  expect(run(screen(body)).map(row => [row.kind, row.sentence])).toEqual([[kind, sentence]])
})

it('files a screen the canvas leaves out under the preview, wherever it is written (D11)', () => {
  const skipped = { span: { file: 'App.swift', start: 40, end: 60 }, severity: 'warning' as const, code: 'runtime_trap' as const, message: '"Settings" isn\'t drawn on the Design canvas: Execution took too long.' }
  expect(designWarnings([skipped], undefined, []).map(row => [row.kind, row.sentence])).toEqual([['preview', skipped.message]])
})

it('asks for an attribute the preview doesn\'t know to be checked in Xcode, as a modifier is (D11)', () => {
  const rows = run(screen('Text("A")').replace('struct HomeScreen: View {', 'struct HomeScreen: View {\n  @Frobnicate var count = 1'))
  expect(rows.map(row => [row.kind, row.sentence])).toEqual([['xcode', "The preview doesn't know @Frobnicate and ignores it. If it isn't Swift's or SwiftUI's, the app won't build."]])
})

it('names a component\'s warnings by the component, which is no screen of its own (D11)', () => {
  const rows = run(screen('Badge()', 'struct Badge: View {\n  var body: some View { Link("Help", destination: URL(string: "https://example.com")!) }\n}'))
  expect(rows.map(row => row.screen)).toEqual(['Badge component'])
})

it('lists what running a screen finds on every screen the canvas draws, not only the live one (D11)', () => {
  const rows = run(`import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
  var body: some View {
    NavigationStack {
      NavigationLink("Details") { DetailsScreen() }
        .navigationTitle("Home")
    }
  }
}
struct DetailsScreen: View {
  var body: some View {
    List {
      ForEach(["Mia", "Mia"], id: \\.self) { name in Text(name) }
    }
  }
}`)
  expect(rows.map(row => [row.kind, row.screen, row.sentence])).toEqual([['xcode', 'Details', 'Two rows of this ForEach have the id "Mia". SwiftUI needs every row\'s id to be different, or it can draw or update the wrong row.']])
})
