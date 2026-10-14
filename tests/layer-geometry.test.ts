import { beforeEach, describe, expect, it } from 'vitest'
import { compile, endLayerDraft, resetPipelineState, setMeasureTarget } from '@studio/swiftui-runtime'
import type { CompileRequest, CompileResult, Rect, RenderNode, SourceFile, ViewInstance } from '@studio/shared'
import { node, project, screen } from './helpers/layer-project'
import { worldFrame } from './render-geometry'

/**
 * Where the selected view is drawn, box by box, for the handles the canvas draws on it
 * (Wave 2b). The view is named as the canvas names it, by its authoring node's source;
 * the page is compiled as the canvas compiles it, and each box is checked against the
 * nodes the render tree paints and the values written in the Swift.
 */

beforeEach(() => {
  resetPipelineState()
  setMeasureTarget(null)
})

const request = (files: readonly SourceFile[], extra: Partial<CompileRequest> = {}): CompileRequest => ({
  files: [...files], canvas: { width: 393, height: 852 }, colorScheme: 'light', safeArea: { top: 59, bottom: 34, leading: 0, trailing: 0 }, revision: 1, ...extra,
})

/** The page compiled with `name` (the `index`th of them) selected. */
function measured(body: string, name: string, index = 0, extra: Partial<CompileRequest> = {}): CompileResult {
  const files = project(screen(body))
  setMeasureTarget(node(files, name, index).source)
  const result = compile(request(files, extra))
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result
}

function only(result: CompileResult): ViewInstance {
  expect(result.geometry?.instances).toHaveLength(1)
  return result.geometry!.instances[0]!
}

const nodeAt = (result: CompileResult, id: string): RenderNode => {
  const found = result.renderTree!.nodes.find(n => n.id === id)
  if (!found) throw new Error(`No node ${id}`)
  return found
}
/**
 * The `at`th node of a kind the tree paints, the text a view draws, with its frame in the
 * space the geometry's rects are in: the anchor's.
 */
function painted(result: CompileResult, kind: RenderNode['kind'], at = 0, tree = result.renderTree!): RenderNode {
  const found = tree.nodes.filter(n => n.kind === kind)[at]!
  const anchor = tree.nodes.find(n => n.id === result.geometry?.instances[0]?.anchor)
  const space = anchor?.parent ? worldFrame(tree.nodes, tree.nodes.find(n => n.id === anchor.parent)!) : { x: 0, y: 0 }
  const world = worldFrame(tree.nodes, found)
  return { ...found, frame: { ...world, x: world.x - space.x, y: world.y - space.y } }
}
const grown = (rect: Rect, by: number): Rect => ({ x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 })
const near = (actual: Rect, expected: Rect) => {
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(actual[key]).toBeCloseTo(expected[key], 3)
}

describe('the selected view’s boxes', () => {
  it('reports the padding inside a fill as the box the fill paints, around the text', () => {
    const result = measured('        Text("Hello")\n            .padding(12)\n            .background(.blue)', 'Text')
    const view = only(result)
    const text = painted(result, 'text'), fill = painted(result, 'layer', 1)
    near(view.content, text.frame)
    expect(view.boxes).toEqual([{ index: 0, kind: 'padding', rect: expect.any(Object) }])
    near(view.boxes[0]!.rect, grown(text.frame, 12))
    near(view.boxes[0]!.rect, fill.frame)
  })

  it('measures from a node the tree draws, in that node’s own space', () => {
    const result = measured('        Text("Hello").padding(12).background(.blue)', 'Text')
    const view = only(result)
    expect(view.anchorFrame).toEqual(nodeAt(result, view.anchor).frame)
  })

  it('reports a frame’s box at the size written, around the content it centres', () => {
    const view = only(measured('        Text("Hi").frame(width: 200, height: 80)', 'Text'))
    expect(view.boxes.map(box => [box.index, box.kind])).toEqual([[0, 'frame']])
    const frame = view.boxes[0]!.rect
    expect([frame.width, frame.height]).toEqual([200, 80])
    expect(view.content.x + view.content.width / 2).toBeCloseTo(frame.x + 100, 3)
    expect(view.content.y + view.content.height / 2).toBeCloseTo(frame.y + 40, 3)
  })

  it('counts the chain as the layer reads it, every call included', () => {
    const view = only(measured('        Text("Hi").font(.title).padding(8).foregroundStyle(.red).frame(maxWidth: .infinity).offset(y: 4)', 'Text'))
    expect(view.boxes.map(box => [box.index, box.kind])).toEqual([[1, 'padding'], [3, 'frame'], [4, 'offset']])
  })

  it('reports an offset where it moves the view to, in its Overlap', () => {
    const result = measured('        ZStack {\n            Color.gray\n            Text("Hi").offset(x: 10, y: 20)\n        }\n        .frame(width: 300, height: 200)', 'Text')
    const view = only(result)
    const text = painted(result, 'text')
    expect(view.boxes.map(box => box.kind)).toEqual(['offset'])
    near(view.boxes[0]!.rect, text.frame)
    near(view.content, text.frame)
    expect(view.parent?.kind).toBe('overlap')
    expect([view.parent!.rect.width, view.parent!.rect.height]).toEqual([300, 200])
    // Without the offset the text would be centred in the Overlap.
    expect(text.frame.x - 10 + text.frame.width / 2).toBeCloseTo(view.parent!.rect.x + 150, 3)
    expect(text.frame.y - 20 + text.frame.height / 2).toBeCloseTo(view.parent!.rect.y + 100, 3)
  })

  it('reports a stack’s views, for the gaps between them', () => {
    const result = measured('        VStack(spacing: 10) {\n            Text("One")\n            Text("Two")\n            Text("Three")\n        }', 'VStack')
    const view = only(result)
    expect(view.children).toHaveLength(3)
    const [a, b, c] = view.children!
    expect(b!.y - (a!.y + a!.height)).toBeCloseTo(10, 3)
    expect(c!.y - (b!.y + b!.height)).toBeCloseTo(10, 3)
    near(b!, painted(result, 'text', 1).frame)
  })

  it('says what the view is in: a column, a row or an Overlap', () => {
    expect(only(measured('        VStack {\n            Text("A")\n        }', 'Text')).parent?.kind).toBe('column')
    expect(only(measured('        HStack {\n            Text("A")\n            Text("B")\n        }', 'Text')).parent?.kind).toBe('row')
    expect(only(measured('        ZStack {\n            Color.red\n            Text("A")\n        }', 'Text')).parent?.kind).toBe('overlap')
  })

  it('reports every row a row design is drawn in', () => {
    const result = measured('        VStack {\n            ForEach(0..<3, id: \\.self) { row in\n                Text("Row \\(row)").padding(8)\n            }\n        }', 'Text')
    const instances = result.geometry!.instances
    expect(instances).toHaveLength(3)
    instances.forEach((instance, at) => {
      near(instance.content, painted(result, 'text', at).frame)
      near(instance.boxes[0]!.rect, grown(instance.content, 8))
    })
    expect(new Set(instances.map(instance => instance.content.y)).size).toBe(3)
  })

  it('reports a Button’s label, where its padding and size are written', () => {
    const result = measured('        Button(action: {}) {\n            Text("Save").padding(6)\n        }\n        .buttonStyle(.borderedProminent)', 'Button')
    const view = only(result)
    const text = painted(result, 'text')
    near(view.label!, text.frame)
    expect(view.boxes.filter(box => box.label)).toEqual([{ index: 0, kind: 'padding', rect: expect.any(Object), label: true }])
    near(view.boxes[0]!.rect, grown(text.frame, 6))
    // The button's own shape is drawn around its label, padded by its style.
    expect(view.content.width).toBeGreaterThan(view.boxes[0]!.rect.width)
  })

  it('names the page each copy is drawn on in the gallery', () => {
    const result = measured('        Text("Hello").padding(4)', 'Text', 0, { allPages: true })
    expect(result.pages?.length).toBeGreaterThan(0)
    const view = only(result)
    const page = result.pages!.find(p => p.id === view.page)!
    expect(page.tree.nodes.some(n => n.id === view.anchor)).toBe(true)
  })
})

describe('the measure target', () => {
  it('carries no geometry when nothing is selected', () => {
    const files = project(screen('        Text("Hello")'))
    expect(compile(request(files)).geometry).toBeUndefined()
  })

  it('gives an empty geometry for a view that is not drawn', () => {
    const result = measured('        VStack {\n            if false {\n                Text("Hidden").padding(4)\n            }\n            Text("Shown")\n        }', 'Text')
    expect(result.geometry?.instances).toEqual([])
  })

  it('brings the geometry of a newly selected view without compiling again', () => {
    const files = project(screen('        VStack {\n            Text("A").padding(4)\n            Text("B").padding(9)\n        }'))
    setMeasureTarget(node(files, 'Text', 0).source)
    const first = compile(request(files))
    setMeasureTarget(node(files, 'Text', 1).source)
    const second = endLayerDraft(2)
    expect(second.revision).toBe(2)
    expect(second.renderTree!.nodes.map(n => n.frame)).toEqual(first.renderTree!.nodes.map(n => n.frame))
    const view = only(second)
    near(view.boxes[0]!.rect, grown(view.content, 9))
    near(view.content, painted(second, 'text', 1).frame)
  })
})
