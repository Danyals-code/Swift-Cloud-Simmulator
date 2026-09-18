import { beforeEach, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { deleteView, insertView, moveView, viewSiteAt } from '@studio/swift-syntax'
import type { CompileResult, ViewLayer } from '@studio/shared'

/**
 * The canvas's edits, end to end.
 *
 * `edits.test.ts` checks the text transforms against text. This checks the thing the
 * studio actually does: take the span the *view hierarchy* reports for a view somebody
 * clicked, edit the file with it, and compile the result. That join is where this
 * feature would break silently - an offset that names the wrong statement produces a
 * perfectly valid file that moved the wrong view - so every case here goes through a
 * real compile and asserts on what the preview would draw.
 */

const FILE = 'App.swift'
let revision = 0
beforeEach(resetPipelineState)

function compileText(text: string): CompileResult {
  return compile({
    files: [{ id: FILE, text }],
    canvas: { width: 402, height: 874 },
    safeArea: { top: 59, leading: 0, bottom: 34, trailing: 0 },
    colorScheme: 'light',
    revision: ++revision,
  })
}

const all = (layers: readonly ViewLayer[]): ViewLayer[] => layers.flatMap(l => [l, ...all(l.children)])

/** Every drawn string, in paint order - which is the order the stack put them in. */
const texts = (result: CompileResult): string[] =>
  (result.renderTree?.nodes ?? [])
    .filter(node => node.text)
    .sort((a, b) => a.frame.y - b.frame.y)
    .flatMap(node => node.text!.runs.map(run => run.text))

/** What the studio passes to the editor: the span the hierarchy reports for a view. */
function spanOf(result: CompileResult, name: string): number {
  const layer = all(result.viewHierarchy!).find(l => l.name === name)
  expect(layer, name).toBeDefined()
  expect(layer!.source, name).toBeDefined()
  return layer!.source!.start
}

const SCREEN = `        VStack(spacing: 12) {
            Text("Alpha")
                .font(.title)
            Text("Beta")
            Text("Gamma")
        }`

it('moves the view the hierarchy points at, and the preview draws the new order', () => {
  const text = `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
${SCREEN}
    }
}`
  const before = compileText(text)
  expect(before.diagnostics).toEqual([])
  expect(texts(before)).toEqual(['Alpha', 'Beta', 'Gamma'])

  const moved = moveView(text, FILE, spanOf(before, 'Alpha'), 1)!
  const after = compileText(moved.text)
  expect(after.diagnostics).toEqual([])
  expect(texts(after)).toEqual(['Beta', 'Alpha', 'Gamma'])

  // The modifier went with it: Alpha is still the one drawn at title size.
  const alpha = (after.renderTree?.nodes ?? []).find(node => node.text?.runs.some(run => run.text === 'Alpha'))!
  const beta = (after.renderTree?.nodes ?? []).find(node => node.text?.runs.some(run => run.text === 'Beta'))!
  expect(alpha.frame.height).toBeGreaterThan(beta.frame.height)

  // And the offset it reports names the view that moved, so the studio can keep it
  // selected: the layer at that span is Alpha, not the neighbour it swapped with.
  const reselected = all(after.viewHierarchy!).find(layer => layer.source?.start === moved.offset)
  expect(reselected?.name).toBe('Alpha')
})

it('moves a whole container, children and all', () => {
  const text = `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack {
            HStack {
                Text("One")
                Text("Two")
            }
            Text("Last")
        }
    }
}`
  const before = compileText(text)
  expect(texts(before)).toEqual(['One', 'Two', 'Last'])

  const layer = all(before.viewHierarchy!).find(l => l.type === 'HStack')!
  const moved = moveView(text, FILE, layer.source!.start, 1)!
  const after = compileText(moved.text)
  expect(after.diagnostics).toEqual([])
  expect(texts(after)).toEqual(['Last', 'One', 'Two'])
})

it('deletes the view that was clicked and nothing else', () => {
  const text = `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
${SCREEN}
    }
}`
  const before = compileText(text)
  const deleted = deleteView(text, FILE, spanOf(before, 'Beta'))!
  const after = compileText(deleted.text)

  expect(after.diagnostics).toEqual([])
  expect(texts(after)).toEqual(['Alpha', 'Gamma'])
  expect(all(after.viewHierarchy!).some(layer => layer.name === 'Beta')).toBe(false)
})

it('adds a view where the selection says, and the preview draws it', () => {
  const text = `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
${SCREEN}
    }
}`
  const before = compileText(text)

  // Beside a leaf.
  const beside = insertView(text, FILE, spanOf(before, 'Alpha'), 'Text("Added")')!
  const after = compileText(beside.text)
  expect(after.diagnostics).toEqual([])
  expect(texts(after)).toEqual(['Alpha', 'Added', 'Beta', 'Gamma'])
  expect(all(after.viewHierarchy!).find(layer => layer.source?.start === beside.offset)?.name).toBe('Added')

  // Inside a container: the stack takes it as its last child.
  const stack = all(before.viewHierarchy!).find(l => l.type === 'VStack')!
  const inside = compileText(insertView(text, FILE, stack.source!.start, 'Text("Tail")')!.text)
  expect(inside.diagnostics).toEqual([])
  expect(texts(inside)).toEqual(['Alpha', 'Beta', 'Gamma', 'Tail'])
})

it('adds a container and then adds into it, which is how a screen gets built', () => {
  let text = `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack {
            Text("Existing")
        }
    }
}`
  let result = compileText(text)

  text = insertView(text, FILE, spanOf(result, 'Existing'), 'HStack {\n}')!.text
  result = compileText(text)
  expect(result.diagnostics).toEqual([])
  const added = all(result.viewHierarchy!).find(layer => layer.type === 'HStack')!

  text = insertView(text, FILE, added.source!.start, 'Text("Inside")')!.text
  result = compileText(text)
  expect(result.diagnostics).toEqual([])
  expect(texts(result)).toEqual(['Existing', 'Inside'])
  expect(all(result.viewHierarchy!).find(l => l.type === 'HStack')?.children.some(c => c.name === 'Inside')).toBe(true)
})

it('edits a view inside a ForEach by editing the one place it is written', () => {
  const text = `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        VStack {
            ForEach(["a", "b"], id: \\.self) { item in
                HStack {
                    Text(item)
                    Text("tail")
                }
            }
        }
    }
}`
  const before = compileText(text)
  expect(before.diagnostics).toEqual([])
  expect(texts(before)).toEqual(['a', 'tail', 'b', 'tail'])

  // One row is selected; the source it names is the row every iteration draws.
  const tail = all(before.viewHierarchy!).filter(l => l.name === 'tail')
  expect(tail).toHaveLength(2)
  const moved = moveView(text, FILE, tail[0]!.source!.start, -1)!
  const after = compileText(moved.text)
  expect(after.diagnostics).toEqual([])
  expect(texts(after)).toEqual(['tail', 'a', 'tail', 'b'])
})

it('refuses the edits that would produce a file that does not compile', () => {
  const text = `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
        Text("Only")
    }
}`
  const result = compileText(text)
  const only = spanOf(result, 'Only')

  // The body's only view: deleting it would leave `some View` returning nothing.
  expect(deleteView(text, FILE, only)).toBeNull()
  expect(moveView(text, FILE, only, 1)).toBeNull()
  expect(moveView(text, FILE, only, -1)).toBeNull()

  // Adding beside it is fine, and the result is a body with two views in it.
  const added = compileText(insertView(text, FILE, only, 'Text("Second")')!.text)
  expect(added.diagnostics).toEqual([])
  expect(texts(added)).toEqual(['Only', 'Second'])
})

it('reports what the studio needs to draw its controls', () => {
  const text = `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    var body: some View {
${SCREEN}
    }
}`
  const result = compileText(text)

  const beta = viewSiteAt(text, FILE, spanOf(result, 'Beta'))!
  expect(beta.index).toBe(1)
  expect(beta.siblings).toBe(3)
  expect(beta.container).toBe(false)

  const stack = viewSiteAt(text, FILE, all(result.viewHierarchy!).find(l => l.type === 'VStack')!.source!.start)!
  expect(stack.container).toBe(true)
  expect(stack.inContent).toBe(false)
})

it('runs a screen through add, move and delete and leaves it compiling', () => {
  // The sequence a person actually performs, each step compiled.
  let text = `import SwiftUI
@main struct ExampleApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View {
    @State private var count = 0
    var body: some View {
        VStack(spacing: 8) {
            Text("Header")
            Button("Add one") { count += 1 }
        }
    }
}`
  let result = compileText(text)
  expect(result.diagnostics).toEqual([])

  text = insertView(text, FILE, spanOf(result, 'Header'), 'Divider()')!.text
  result = compileText(text)
  expect(result.diagnostics).toEqual([])

  text = insertView(text, FILE, spanOf(result, 'Add one'), 'Text("Footer")')!.text
  result = compileText(text)
  expect(result.diagnostics).toEqual([])
  expect(texts(result)).toEqual(['Header', 'Add one', 'Footer'])

  text = moveView(text, FILE, spanOf(result, 'Footer'), -1)!.text
  result = compileText(text)
  expect(result.diagnostics).toEqual([])
  expect(texts(result)).toEqual(['Header', 'Footer', 'Add one'])

  text = deleteView(text, FILE, spanOf(result, 'Header'))!.text
  result = compileText(text)
  expect(result.diagnostics).toEqual([])
  expect(texts(result)).toEqual(['Footer', 'Add one'])

  // The state the app was written with still works after four edits to its source.
  expect(text).toContain('@State private var count = 0')
  expect(text).toContain('Button("Add one") { count += 1 }')
})
