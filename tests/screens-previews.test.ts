import { beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, compile, rerender, resetPipelineState, setAllPages } from '@studio/swiftui-runtime'
import { templateById } from '@studio/project-model/templates'
import type { AuthoringNode, CompileRequest, CompileResult, PagePreview, RenderNode, RenderTree, SourceFile, ViewLayer } from '@studio/shared'
import { canvasPick } from '../apps/web/lib/canvasSelection'
import { stoppedEditProblem, stoppingError } from '../apps/web/lib/stoppingError'
import { pageSlots } from '../apps/web/lib/pageLayout'
import { XCODE, typecheckInXcode } from './helpers/layer-project'

/**
 * Wave 3b-2, screens: each `#Preview` drawn on the Design canvas as a page of its own,
 * and the last good drawing kept while another file has an error.
 */

beforeEach(resetPipelineState)
let revision = 0

function run(files: readonly SourceFile[] | string, request: Partial<CompileRequest> = {}): CompileResult {
  return compile({
    projectId: 'previews',
    files: typeof files === 'string' ? [{ id: 'App.swift', text: files }] : files,
    canvas: { width: 402, height: 874 },
    safeArea: { top: 59, leading: 0, bottom: 34, trailing: 0 },
    colorScheme: 'light',
    allPages: true,
    revision: ++revision,
    ...request,
  })
}

/** Every layer's name, depth first. */
const names = (layers: readonly ViewLayer[] = []): string[] => layers.flatMap(layer => [layer.name, ...names(layer.children)])

const texts = (tree: RenderTree | null | undefined): string[] =>
  (tree?.nodes ?? []).flatMap(node => node.text?.runs.map(run => run.text) ?? [])

const GREETING = `struct Greeting: View {
    var name: String
    var body: some View { Text("Hello, \\(name)") }
}`

const APP = `import SwiftUI
@main struct PreviewsApp: App { var body: some Scene { WindowGroup { Greeting(name: "App") } } }
${GREETING}
`

describe('each #Preview is a page of its own', () => {
  it('draws a titled preview beside an app as a page named by its title, after the app’s screens', () => {
    const result = run(`${APP}
#Preview("Long name") {
    Greeting(name: "Bartholomew")
}
`)
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    expect(result.pages!.map(page => [page.name, page.kind])).toEqual([['Main page', 'root'], ['Long name', 'preview']])
    expect(texts(result.pages![0]!.tree)).toEqual(['Hello, App'])
    expect(texts(result.pages![1]!.tree)).toEqual(['Hello, Bartholomew'])
    // The app is what runs: the preview is a picture beside it.
    expect(texts(result.renderTree)).toEqual(['Hello, App'])
  })

  it('draws a preview that only shows a screen the app draws once, as that screen', () => {
    // A new project's Home, and every screen the studio makes, carries `#Preview { HomeScreen() }`.
    const result = run(templateById('blank')!.files)
    expect(result.pages!.map(page => [page.name, page.kind])).toEqual([['Main page', 'root']])
  })

  it('draws a preview that gives a screen the app draws only its environment as that screen, and a titled one always', () => {
    const app = `import SwiftUI
@main struct StoreApp: App { var body: some Scene { WindowGroup { ContentView().environment(Store()) } } }
@Observable final class Store { var name = "Corner shop" }
struct ContentView: View {
    @Environment(Store.self) private var store
    var body: some View { Text(store.name) }
}
`
    const untitled = run(`${app}#Preview { ContentView().environment(Store()) }\n`)
    expect(untitled.pages!.map(page => [page.name, page.kind])).toEqual([['Main page', 'root']])
    const titled = run(`${app}#Preview("Shop") { ContentView().environment(Store()) }\n`)
    expect(titled.pages!.map(page => [page.name, page.kind])).toEqual([['Main page', 'root'], ['Shop', 'preview']])
    expect(texts(titled.pages![1]!.tree)).toEqual(['Corner shop'])
  })

  it('draws a titled preview of the screen a project with no app runs', () => {
    const result = run(`import SwiftUI\n${GREETING}\nstruct ContentView: View { var body: some View { Greeting(name: "Home") } }\n#Preview { ContentView() }\n#Preview("Second") { ContentView() }\n`)
    expect(result.pages!.map(page => [page.id, page.name, page.kind])).toEqual([['page:root', 'Main page', 'root'], ['preview:2', 'Second', 'preview']])
    expect(texts(result.pages![1]!.tree)).toEqual(['Hello, Home'])
  })

  it('names an untitled preview after the view it shows, and by its place where that is ambiguous', () => {
    const result = run(`${APP}
struct Badge: View { var body: some View { Text("New") } }
#Preview { Greeting(name: "Padded").padding() }
#Preview { NavigationStack { Badge() } }
#Preview { VStack { Text("Inline"); Text("Two") } }
#Preview { Greeting(name: "Again") }
`)
    // Two show Greeting, so neither is "Greeting"; a stack of texts shows no one view.
    expect(result.pages!.map(page => page.name)).toEqual(['Main page', 'Preview 1', 'Badge', 'Preview 3', 'Preview 4'])
    expect(texts(result.pages![3]!.tree)).toEqual(['Inline', 'Two'])
  })

  it('runs the first preview of a project with no app, as today, and draws the others beside it', () => {
    const one = run(`import SwiftUI\n${GREETING}\n#Preview("First") { Greeting(name: "One") }\n`)
    // One preview and no app: exactly the page it always had.
    expect(one.pages!.map(page => [page.id, page.name, page.kind])).toEqual([['page:root', 'Main page', 'root']])

    const two = run(`import SwiftUI\n${GREETING}\n#Preview("First") { Greeting(name: "One") }\n#Preview("Second") { Greeting(name: "Two") }\n`)
    expect(texts(two.renderTree)).toEqual(['Hello, One'])
    expect(two.pages!.map(page => [page.id, page.name, page.kind])).toEqual([['page:root', 'Main page', 'root'], ['preview:2', 'Second', 'preview']])
    expect(texts(two.pages![1]!.tree)).toEqual(['Hello, Two'])
  })

  it('selects a view drawn on a preview’s page where it is written, inside that #Preview', () => {
    const source = `${APP}
#Preview("Inline") {
    VStack {
        Text("Written here")
        Greeting(name: "Called here")
    }
}
`
    const result = run(source)
    // Design's layers are every page's, as the canvas has them.
    const scene = { snapshot: result.authoring!, layers: result.pages!.flatMap(page => page.viewHierarchy ?? []) }
    const page = result.pages!.find(item => item.name === 'Inline')!
    const drawn = (text: string): RenderNode[] => page.tree.nodes.filter(node => node.text?.runs.map(run => run.text).join('') === text)
    const written = (node: AuthoringNode | undefined) => node && source.slice(node.source.start, node.source.end)
    const preview = result.authoring!.nodes.find(node => node.name === '#Preview')!
    const text = canvasPick(scene, drawn('Written here'), 'click')?.node
    expect(written(text)).toBe('Text("Written here")')
    expect(text!.source.start).toBeGreaterThan(preview.source.start)
    // A view the preview calls is selected at its call, as a component's copy is.
    expect(written(canvasPick(scene, drawn('Hello, Called here'), 'click')?.node)).toBe('Greeting(name: "Called here")')
  })

  it('names the traits a preview is drawn without in a warning where they are written', () => {
    const source = `${APP}
#Preview("Wide", traits: .landscapeLeft) { Greeting(name: "Wide") }
`
    const result = run(source)
    expect(result.pages!.map(page => page.name)).toEqual(['Main page', 'Wide'])
    const warning = result.diagnostics.find(d => d.message.includes('traits'))
    expect(warning).toMatchObject({ severity: 'warning', message: "The preview doesn't apply traits: .landscapeLeft to this #Preview. Xcode's canvas does." })
    expect(source.slice(warning!.span.start, warning!.span.end)).toBe('traits: .landscapeLeft')

    // So are the ones of the preview a project with no app runs, in Design, where the previews are.
    const alone = `import SwiftUI\n${GREETING}\n#Preview(traits: .sizeThatFitsLayout) { Greeting(name: "Alone") }\n`
    expect(run(alone).diagnostics.filter(d => d.message.includes('traits')).map(d => alone.slice(d.span.start, d.span.end))).toEqual(['traits: .sizeThatFitsLayout'])
    expect(run(alone, { allPages: false }).diagnostics).toEqual([])
  })

  it('keeps a preview’s @Previewable @State between passes, so a tap changes it', () => {
    const body = `{
    @Previewable @State var count = 3
    Button("Count \\(count)") { count += 1 }
}`
    const opened = run(`import SwiftUI\n#Preview ${body}\n`)
    expect(texts(opened.renderTree)).toEqual(['Count 3'])
    const button = opened.renderTree!.nodes.find(node => node.hitTarget?.enabled)!
    applyEvent({ kind: 'tap', handlerId: button.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    expect(texts(rerender(++revision).renderTree)).toEqual(['Count 4'])

    // Beside an app, its page draws the value it starts with.
    expect(texts(run(`${APP}\n#Preview("Counter") ${body}\n`).pages![1]!.tree)).toEqual(['Count 3'])
  })

  it('keeps a preview’s @Previewable @State across an edit while its declaration is unchanged, as a view keeps its @State', () => {
    const body = `{
    @Previewable @State var count = 3
    Button("Count \\(count)") { count += 1 }
}`
    const opened = run(`import SwiftUI\n#Preview ${body}\n`)
    const button = opened.renderTree!.nodes.find(node => node.hitTarget?.enabled)!
    applyEvent({ kind: 'tap', handlerId: button.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    expect(texts(rerender(++revision).renderTree)).toEqual(['Count 4'])
    expect(texts(run(`import SwiftUI\n// Counts taps.\n#Preview ${body}\n`).renderTree)).toEqual(['Count 4'])
    expect(texts(run(`import SwiftUI\n#Preview ${body.replace('= 3', '= 10')}\n`).renderTree)).toEqual(['Count 10'])
  })

  it('puts the previews in a lane of their own on the canvas, after the app’s, side by side', () => {
    const result = run(`${APP}
#Preview("Short") { Greeting(name: "Al") }
#Preview("Long") { Greeting(name: "Bartholomew") }
`)
    expect(result.pages!.map(page => [page.name, page.standalone ?? false])).toEqual([['Main page', false], ['Short', true], ['Long', true]])
    // A screen made in Design that nothing links to yet keeps its own lane.
    const draft: PagePreview = { ...result.pages![0]!, id: 'screen:Draft', name: 'Draft', standalone: true }
    const slots = pageSlots([...result.pages!.slice(0, 1), draft, ...result.pages!.slice(1)])
    expect(slots.map(({ page, lane, column, branchRow }) => [page.name, lane, column, branchRow])).toEqual([
      ['Main page', 0, 0, 0], ['Draft', 1, 0, 0], ['Short', 2, 0, 0], ['Long', 2, 1, 0],
    ])
  })

  it('leaves out a preview that stops, saying why, and still draws the others', () => {
    const result = run(`${APP}
#Preview("Empty list") {
    let first = [String]()[0]
    Text(first)
}
#Preview("Fine") { Greeting(name: "Fine") }
`)
    expect(result.pages!.map(page => page.name)).toEqual(['Main page', 'Fine'])
    expect(result.pagesNotDrawn).toEqual([expect.stringMatching(/^"Empty list" isn't drawn on the Design canvas: /)])
  })
})

describe('a syntax error in another file keeps the last good drawing', () => {
  const HOME: SourceFile = { id: 'Home.swift', text: `import SwiftUI
@main struct KeptApp: App { var body: some Scene { WindowGroup { HomeScreen() } } }
struct HomeScreen: View {
    var body: some View {
        VStack {
            Text("Home title")
            Other()
        }
    }
}
` }
  const OTHER: SourceFile = { id: 'Other.swift', text: `import SwiftUI
struct Other: View {
    var body: some View { Text("Other text") }
}
` }
  // `Text("Other text"` is missing its closing parenthesis.
  const BROKEN: SourceFile = { ...OTHER, text: OTHER.text.replace('Text("Other text")', 'Text("Other text"') }
  const node = (result: CompileResult, written: string) => result.authoring!.nodes.find(item => item.kind !== 'definition' && [HOME, OTHER, BROKEN].some(file => file.id === item.source.file && file.text.slice(item.source.start, item.source.end) === written))

  it('keeps the pages and layers drawn, and finds the views of files that still parse in them', () => {
    const good = run([HOME, OTHER])
    const broken = run([HOME, BROKEN])
    // The phone says why, over the last screen that ran, as it always has (FR-6.3).
    expect(broken.renderTree?.notice).toEqual({ title: '1 error', detail: "Expected ')' to close an argument list, found '}'.", span: expect.objectContaining({ file: 'Other.swift' }) })
    expect(broken.pages!.map(page => [page.id, page.name, texts(page.tree)])).toEqual([['page:root', 'Main page', ['Home title', 'Other text']]])
    // The same picture, dimmed by the canvas: every view where the code that ran drew it.
    expect(broken.pages![0]!.tree.nodes.map(node => [node.text?.runs[0]?.text, node.frame])).toEqual(good.pages![0]!.tree.nodes.map(node => [node.text?.runs[0]?.text, node.frame]))
    expect(names(broken.viewHierarchy)).toEqual(names(good.viewHierarchy))
    const title = node(broken, 'Text("Home title")')!
    expect(title.runtimeIds).toEqual(node(good, 'Text("Home title")')!.runtimeIds)
    expect(title.runtimeIds).not.toEqual([])
  })

  it('keeps the drawing Design last showed, when the code broke while only the phone was drawn', () => {
    run([HOME, OTHER])
    // Code is open: the phone alone is drawn, and then the code breaks.
    run([HOME, OTHER], { allPages: false })
    run([HOME, BROKEN], { allPages: false })
    const reopened = setAllPages(true, ++revision)!
    expect(reopened.renderTree?.notice?.title).toBe('1 error')
    expect(reopened.pages!.map(page => [page.id, page.name, texts(page.tree)])).toEqual([['page:root', 'Main page', ['Home title', 'Other text']]])
  })

  it('finds no view of a file changed since the drawing in it, whatever is written at its place now', () => {
    run([HOME, OTHER])
    const broken = run([HOME, BROKEN])
    const inOther = broken.authoring!.nodes.filter(item => item.source.file === OTHER.id && item.kind !== 'definition')
    expect(inOther.map(item => item.name)).toContain('Text')
    expect(inOther.flatMap(item => item.runtimeIds)).toEqual([])
  })

  it('forgets the drawing it kept when the pipeline is reset', () => {
    run([HOME, OTHER])
    resetPipelineState()
    const broken = run([HOME, BROKEN])
    expect(broken.pages).toBeUndefined()
    expect(broken.viewHierarchy).toEqual([])
  })

  it('keeps a drawing for its own project and state only, and draws afresh once the code runs', () => {
    run([HOME, OTHER])
    expect(run([HOME, BROKEN], { projectId: 'another' }).pages).toBeUndefined()
    expect(run([HOME, BROKEN], { scenario: { name: 'Empty', owner: 'HomeScreen', hook: '', inputs: [] } }).pages).toBeUndefined()

    run([HOME, OTHER])
    run([HOME, BROKEN])
    const fixed = run([HOME, { ...OTHER, text: OTHER.text.replace('Other text', 'Other fixed') }])
    expect(fixed.renderTree?.notice).toBeUndefined()
    expect(texts(fixed.pages![0]!.tree)).toEqual(['Home title', 'Other fixed'])
  })

  it('says which file and line stop the code, and an edit elsewhere waits for it', () => {
    expect(stoppingError(run([HOME, OTHER]), [HOME, OTHER])).toBeNull()
    const error = stoppingError(run([HOME, BROKEN]), [HOME, BROKEN])
    expect(error).toEqual({ file: 'Other.swift', offset: BROKEN.text.indexOf('}'), line: 3, message: "Expected ')' to close an argument list, found '}'." })
    expect(stoppedEditProblem(error, HOME.id)).toBe('Other.swift has an error on line 3, so the design can’t be changed until it’s fixed in Code.')
    // An edit to the file with the error is the planner's to refuse, as it always was.
    expect(stoppedEditProblem(error, OTHER.id)).toBeNull()
  })

  it('leaves a screen that stopped running to its own notice', () => {
    const trap = run(`import SwiftUI\nlet names: [String] = []\nlet first = names[0]\n@main struct TrapApp: App { var body: some Scene { WindowGroup { Text(first) } } }\n`)
    expect(trap.renderTree?.notice?.title).toBe('Execution stopped')
    expect(stoppingError(trap, [])).toBeNull()
  })

  it('leaves out the layers of a drawing none of whose views is found any more, so Layers lists the code', () => {
    run([HOME, OTHER])
    // Home's own file has the error now: its drawing stays, and nothing in it can be found.
    const broken = run([{ ...HOME, text: HOME.text.replace('Text("Home title")', 'Text("Home title"') }, OTHER])
    expect(texts(broken.pages![0]!.tree)).toEqual(['Home title', 'Other text'])
    expect(broken.pages![0]!.viewHierarchy).toBeUndefined()
    expect(broken.viewHierarchy).toEqual([])
  })
})

describe.skipIf(!XCODE)('the previews these tests draw are Swift Xcode 27 builds', () => {
  it('type-checks titles, traits and @Previewable state in #Preview', () => {
    typecheckInXcode([`${APP}
struct Badge: View { var body: some View { Text("New") } }
#Preview("Long name") { Greeting(name: "Bartholomew") }
#Preview { NavigationStack { Badge() } }
#Preview("Wide", traits: .landscapeLeft) { Greeting(name: "Wide") }
#Preview(traits: .sizeThatFitsLayout) { Greeting(name: "Alone") }
#Preview("Counter") {
    @Previewable @State var count = 3
    Button("Count \\(count)") { count += 1 }
}
`, `import SwiftUI
@main struct StoreApp: App { var body: some Scene { WindowGroup { ContentView().environment(Store()) } } }
@Observable final class Store { var name = "Corner shop" }
struct ContentView: View {
    @Environment(Store.self) private var store
    var body: some View { Text(store.name) }
}
#Preview { ContentView().environment(Store()) }
#Preview("Shop") { ContentView().environment(Store()) }
`])
  }, 300_000)
})

