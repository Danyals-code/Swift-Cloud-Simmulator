import { beforeEach, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { CompileResult, RenderNode, RenderTree } from '@studio/shared'
import { canvasDrop, canvasParent, canvasPick, type CanvasScene, type CanvasSelection } from './canvasSelection'
import { sourceLayerLabel } from './sourceLayers'

beforeEach(resetPipelineState)
function run(body: string, extra = '', state = '', allPages = false) {
  const result = compile({ projectId: 'canvas', revision: 1, files: [{ id: 'App.swift', text: `import SwiftUI
@main struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }
struct ContentView: View { ${state}
var body: some View { ${body} } }
${extra}` }], canvas: { width: 402, height: 874 }, colorScheme: 'light', allPages })
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  return result
}
const scene = (result: CompileResult): CanvasScene => ({ snapshot: result.authoring!, layers: result.viewHierarchy! })

/** Where a node is on the screen, through the containers it is drawn in. */
function box(tree: RenderTree, node: RenderNode) {
  let x = node.frame.x, y = node.frame.y, parent = node.parent
  while (parent) {
    const outer = tree.nodes.find(item => item.id === parent)
    if (!outer) break
    x += outer.frame.x; y += outer.frame.y; parent = outer.parent
  }
  return { x, y, width: node.frame.width, height: node.frame.height }
}

/** Everything drawn under the middle of the text `text`, topmost first, as the browser finds it. */
function under(result: CompileResult | RenderTree, text: string): RenderNode[] {
  const tree = 'nodes' in result ? result : result.renderTree!
  const painted = tree.nodes.find(node => node.text?.runs.map(run => run.text).join('') === text)
  expect(painted, text).toBeDefined()
  const at = box(tree, painted!)
  return underAt(tree, at.x + at.width / 2, at.y + at.height / 2)
}

/** Everything drawn at a point, topmost first. */
function underAt(tree: RenderTree, x: number, y: number): RenderNode[] {
  const nodes = tree.nodes
  return nodes
    .map((node, order) => ({ node, order, frame: box(tree, node) }))
    .filter(({ node, frame }) => node.id !== 'screen' && frame.width > 0 && frame.height > 0 && x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height)
    .sort((a, b) => b.node.z - a.node.z || b.order - a.order)
    .map(({ node }) => node)
}

const named = (pick: CanvasSelection | undefined) => pick && `${pick.node.name} ${sourceLayerLabel(pick.node)}`

const CARDS = `NavigationStack {
  ScrollView {
    VStack(spacing: 16) {
      Text("Featured")
      ForEach(0..<2, id: \\.self) { index in
        VStack(alignment: .leading) {
          Text("Card \\(index)")
          Text("Detail")
        }
      }
      Button("See all") { }
    }
  }
  .navigationTitle("Home")
}`

it('selects a whole card with a click inside it, as Figma selects what sits in the frame (D1)', () => {
  const result = run(CARDS)
  const card = canvasPick(scene(result), under(result, 'Card 1'), 'click')
  expect(named(card)).toBe('VStack Column')
  expect(card?.runtimeId).toBe(result.renderTree!.nodes.find(node => node.text?.runs[0]?.text === 'Card 1')!.id.replace(/-0$/, ''))
  expect(named(canvasPick(scene(result), under(result, 'Featured'), 'click'))).toBe('Text Featured')
  expect(named(canvasPick(scene(result), under(result, 'See all'), 'click'))).toBe('Button See all')
})

it('reaches the innermost view with ⌘-click, and a view inside a tappable card too (D1)', () => {
  const result = run(`VStack {
  Button { } label: { VStack { Text("Card title"); Text("Card detail") } }
    .buttonStyle(.plain)
  Text("After")
}`)
  expect(named(canvasPick(scene(result), under(result, 'Card title'), 'click'))).toBe('Button Button')
  expect(named(canvasPick(scene(result), under(result, 'Card title'), 'deep'))).toBe('Text Card title')
  expect(named(canvasPick(scene(result), under(result, 'After'), 'deep'))).toBe('Text After')
})

it('goes one level in with a double-click, from the view that is selected (D1)', () => {
  const result = run(CARDS)
  const card = canvasPick(scene(result), under(result, 'Detail'), 'click')!
  expect(named(card)).toBe('VStack Column')
  expect(named(canvasPick(scene(result), under(result, 'Detail'), 'drill', card))).toBe('Text Detail')
  const detail = canvasPick(scene(result), under(result, 'Detail'), 'drill', card)!
  // Nothing is inside a Text, so going in again keeps it.
  expect(named(canvasPick(scene(result), under(result, 'Detail'), 'drill', detail))).toBe('Text Detail')
})

const PEOPLE = `VStack(spacing: 16) {
  Text("Featured")
  VStack { Text("Mia"); Text("Designer") }
  VStack { Text("Leo"); Text("Engineer") }
}`

it('keeps the depth inside a card it went into, and goes back to whole cards outside it (D1)', () => {
  const result = run(PEOPLE)
  const mia = canvasPick(scene(result), under(result, 'Mia'), 'click')!
  const name = canvasPick(scene(result), under(result, 'Mia'), 'drill', mia)!
  expect(named(name)).toBe('Text Mia')
  expect(named(canvasPick(scene(result), under(result, 'Designer'), 'click', name))).toBe('Text Designer')
  expect(named(canvasPick(scene(result), under(result, 'Mia'), 'click', name))).toBe('Text Mia')
  expect(canvasPick(scene(result), under(result, 'Leo'), 'click', name)?.node.children).toHaveLength(2)
  expect(named(canvasPick(scene(result), under(result, 'Featured'), 'click', name))).toBe('Text Featured')
  // A whole card that is selected stays selected when it is clicked again.
  expect(canvasPick(scene(result), under(result, 'Mia'), 'click', mia)).toEqual(mia)
})

it('goes up a level with Escape, to nothing above the screen\'s own stack (D1)', () => {
  const result = run(PEOPLE)
  const mia = canvasPick(scene(result), under(result, 'Mia'), 'click')!
  const name = canvasPick(scene(result), under(result, 'Mia'), 'drill', mia)!
  expect(canvasParent(scene(result), name)).toEqual(mia)
  const main = canvasParent(scene(result), mia)!
  expect(named(main)).toBe('VStack Column')
  expect(main.node.children).toHaveLength(3)
  expect(canvasParent(scene(result), main)).toBeUndefined()
})

it('goes up from a view that is not drawn now, by the source around it (D1)', () => {
  const result = run('VStack { Text("Shown"); if showsMore { Text("More") } }', '', '@State private var showsMore = false')
  const more = result.authoring!.nodes.find(node => node.properties[0]?.expression === '"More"')!
  expect(more.runtimeIds).toEqual([])
  const parent = canvasParent(scene(result), { node: more })!
  expect(parent.node.name).toBe('VStack')
  expect(parent.runtimeId).toBe(parent.node.runtimeIds[0])
})

it('selects a copy of a component whole, and goes into its Main with a double-click (D1)', () => {
  const result = run('VStack { Card(title: "First"); Card(title: "Second") }', 'struct Card: View { let title: String; var body: some View { VStack { Text(title); Text("Detail") } } }')
  const second = canvasPick(scene(result), under(result, 'Second'), 'click')!
  expect(second.node.kind).toBe('component')
  expect(second.node.source.start).toBe(result.authoring!.nodes.filter(node => node.kind === 'component' && node.name === 'Card')[1]!.source.start)
  const inside = canvasPick(scene(result), under(result, 'Second'), 'drill', second)!
  expect(inside.node.name).toBe('VStack')
  expect(inside.node.owner).toBe('Card')
  expect(canvasParent(scene(result), inside)).toEqual(second)
})

it('selects a list\'s sections, or its rows when it has one section (D1)', () => {
  const two = run('NavigationStack { List { Section("One") { Text("Row A"); Text("Row B") }; Section("Two") { Text("Row C") } } }')
  expect(named(canvasPick(scene(two), under(two, 'Row A'), 'click'))).toBe('Section One')
  const one = run('NavigationStack { List { Section("One") { Text("Row A"); Text("Row B") } } }')
  expect(named(canvasPick(scene(one), under(one, 'Row A'), 'click'))).toBe('Text Row A')
  const rows = run('List { ForEach(["Mia", "Leo"], id: \\.self) { name in HStack { Text(name); Spacer(); Text("Online") } } }')
  const row = canvasPick(scene(rows), under(rows, 'Leo'), 'click')!
  expect(row.node.name).toBe('HStack')
  expect(row.node.runtimeIds).toContain(row.runtimeId)
})

it('picks on every screen the canvas draws, never the screen itself (D1)', () => {
  const result = run('NavigationStack { VStack { NavigationLink("Open") { DetailScreen() }; Text("Home") } }', 'struct DetailScreen: View { var body: some View { VStack { Text("Detail title"); HStack { Text("Left"); Text("Right") } } } }', '', true)
  const detail = result.pages!.find(page => page.tree.nodes.some(node => node.text?.runs[0]?.text === 'Detail title'))!
  const layers = { snapshot: result.authoring!, layers: result.pages!.flatMap(page => page.viewHierarchy ?? []) }
  expect(named(canvasPick(layers, under(detail.tree, 'Right'), 'click'))).toBe('HStack Row')
  expect(named(canvasPick(layers, under(detail.tree, 'Detail title'), 'click'))).toBe('Text Detail title')
  const home = result.pages!.find(page => page.tree.nodes.some(node => node.text?.runs[0]?.text === 'Home'))!
  expect(named(canvasPick(layers, under(home.tree, 'Home'), 'click'))).toBe('Text Home')
})

it('finds a link card under its tap target, so a row is picked at the depth gone into (D1)', () => {
  const result = run(`NavigationStack { VStack {
  Text("Library")
  List {
    ForEach(["First book", "Second book"], id: \\.self) { title in
      NavigationLink { Text("Detail") } label: { BookRow(title: title) }
    }
  }
} }`, 'struct BookRow: View { let title: String; var body: some View { HStack { Image(systemName: "book"); Text(title) } } }')
  // What the pointer enters is the link's tap target, drawn over the whole row.
  const target = (text: string) => under(result, text).filter(node => node.hitTarget)
  expect(target('Second book')).toHaveLength(1)
  expect(named(canvasPick(scene(result), target('Second book'), 'click'))).toBe('List List')
  const first = canvasPick(scene(result), under(result, 'First book'), 'drill', canvasPick(scene(result), under(result, 'First book'), 'click'))!
  expect(first.node.name).toBe('BookRow')
  const second = canvasPick(scene(result), target('Second book'), 'click', first)!
  expect(second.node).toBe(first.node)
  expect(second.runtimeId).not.toBe(first.runtimeId)
})

it('keeps the depth gone into anywhere in the card, not only beside the selection (D1)', () => {
  const result = run(`VStack(spacing: 16) {
  Text("Featured")
  VStack {
    HStack { Text("Mia"); Text("Online") }
    Text("Designer")
  }
  Text("Footer")
}`)
  const card = canvasPick(scene(result), under(result, 'Mia'), 'click')!
  const row = canvasPick(scene(result), under(result, 'Mia'), 'drill', card)!
  const name = canvasPick(scene(result), under(result, 'Mia'), 'drill', row)!
  expect(named(name)).toBe('Text Mia')
  // Beside the row it went into: the card's other view is picked at that depth.
  expect(named(canvasPick(scene(result), under(result, 'Designer'), 'click', name))).toBe('Text Designer')
  expect(named(canvasPick(scene(result), under(result, 'Online'), 'click', name))).toBe('Text Online')
  expect(named(canvasPick(scene(result), under(result, 'Footer'), 'click', name))).toBe('Text Footer')
})

it('goes into a scrolling area straight to its cards, past the stack that only holds them (D1)', () => {
  const result = run(`VStack {
  Text("Header")
  ScrollView {
    VStack {
      VStack { Text("Mia"); Text("Designer") }
      VStack { Text("Leo"); Text("Engineer") }
    }
  }
}`)
  const area = canvasPick(scene(result), under(result, 'Leo'), 'click')!
  expect(named(area)).toBe('ScrollView Scroll')
  const card = canvasPick(scene(result), under(result, 'Leo'), 'drill', area)!
  expect(card.node.children).toHaveLength(2)
  expect(named(canvasPick(scene(result), under(result, 'Leo'), 'drill', card))).toBe('Text Leo')
  // Escape still comes back through the stack, which has settings of its own.
  expect(named(canvasParent(scene(result), card))).toBe('VStack Column')
})

it('drags what a click would pick, and drops it beside a view at its own depth or into a stack\'s own space (D1)', () => {
  const result = run(`VStack(spacing: 16) {
  Text("Featured")
  VStack { Text("Mia"); Text("Designer") }
  VStack { Text("Leo"); Text("Engineer") }
    .padding(24)
    .background(Color.yellow)
}`)
  const cards = result.authoring!.nodes.filter(node => node.name === 'VStack' && node.children.length === 2)
  const leo = canvasDrop(scene(result), under(result, 'Mia'), under(result, 'Engineer'))!
  expect(leo.from.node.id).toBe(cards[1]!.id)
  expect(leo.to.node.id).toBe(cards[0]!.id)
  expect(leo.inside).toBe(false)
  // Inside a card gone into, its own views move among themselves.
  const mia = canvasPick(scene(result), under(result, 'Mia'), 'drill', canvasPick(scene(result), under(result, 'Mia'), 'click'))!
  const within = canvasDrop(scene(result), under(result, 'Mia'), under(result, 'Designer'), mia)!
  expect(named(within.from)).toBe('Text Designer')
  expect(named(within.to)).toBe('Text Mia')
  // The padded card's own yellow is its space: a drop there goes into it.
  const yellow = result.renderTree!.nodes.find(node => node.id !== 'screen' && node.background?.kind === 'solid')!
  const corner = box(result.renderTree!, yellow)
  const into = canvasDrop(scene(result), underAt(result.renderTree!, corner.x + 4, corner.y + 4), under(result, 'Designer'), mia)!
  expect(into.to.node.id).toBe(cards[1]!.id)
  expect(into.inside).toBe(true)
})

it('picks a bordered card with a click, and the words in it through its border (D8)', () => {
  const result = run(`VStack(spacing: 16) {
  Text("Featured")
  VStack { Text("Mia"); Text("Designer") }
    .padding()
    .clipShape(.rect(cornerRadius: 12))
    .overlay {
      RoundedRectangle(cornerRadius: 12)
        .strokeBorder(Color.gray, lineWidth: 1)
    }
  Text("After")
}`)
  const card = canvasPick(scene(result), under(result, 'Mia'), 'click')!
  expect(named(card)).toBe('VStack Column')
  expect(named(canvasPick(scene(result), under(result, 'Mia'), 'deep'))).toBe('Text Mia')
  expect(named(canvasPick(scene(result), under(result, 'Mia'), 'drill', card))).toBe('Text Mia')
})

it('drops into a bordered card\'s own space, through its border (D8)', () => {
  const result = run(`VStack(spacing: 16) {
  Text("Featured")
  VStack { Text("Mia"); Text("Designer") }
  VStack { Text("Leo"); Text("Engineer") }
    .padding(24)
    .background(Color.yellow)
    .overlay {
      Rectangle()
        .strokeBorder(Color.gray, lineWidth: 2)
    }
}`)
  const cards = result.authoring!.nodes.filter(node => node.name === 'VStack' && node.children.length === 2)
  const mia = canvasPick(scene(result), under(result, 'Mia'), 'drill', canvasPick(scene(result), under(result, 'Mia'), 'click'))!
  const yellow = result.renderTree!.nodes.find(node => node.id !== 'screen' && node.background?.kind === 'solid')!
  const corner = box(result.renderTree!, yellow)
  const into = canvasDrop(scene(result), underAt(result.renderTree!, corner.x + 6, corner.y + 6), under(result, 'Designer'), mia)!
  expect(into.to.node.id).toBe(cards[1]!.id)
  expect(into.inside).toBe(true)
})
