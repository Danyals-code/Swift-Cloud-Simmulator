import { beforeEach, describe, expect, it } from 'vitest'
import { planDesignEdit } from '@studio/swift-sema'
import { beginLayerDraft, compile, endLayerDraft, relayout, resetPipelineState, setMeasureTarget, updateLayerDraft } from '@studio/swiftui-runtime'
import type { AxisSize, CompileRequest, CompileResult, LayerChange, LayerDraft, RenderTree, SourceFile } from '@studio/shared'
import { node, project, screen, setLayer, text } from './helpers/layer-project'
import { worldFrame } from './render-geometry'

/**
 * A drag's draft (Wave 2b): the page laid out with the dragged values, from the last
 * evaluation, before anything is written. Letting go writes the same values as one
 * `layer-set` edit, so the draft must look exactly like the page the written Swift draws:
 * every node within half a point, for each form of view the handles change.
 */

beforeEach(() => {
  resetPipelineState()
  setMeasureTarget(null)
})

const request = (files: readonly SourceFile[], revision = 1, extra: Partial<CompileRequest> = {}): CompileRequest => ({
  files: [...files], canvas: { width: 393, height: 852 }, colorScheme: 'light', safeArea: { top: 59, bottom: 34, leading: 0, trailing: 0 }, revision, ...extra,
})

function compiled(files: readonly SourceFile[], extra?: Partial<CompileRequest>): CompileResult {
  const result = compile(request(files, 1, extra))
  expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
  return result
}

/** The page as the canvas shows it while `values` are dragged on the `index`th `name`. */
function drafted(files: readonly SourceFile[], name: string, values: LayerDraft, index = 0, extra?: Partial<CompileRequest>): CompileResult {
  const target = node(files, name, index)
  compiled(files, extra)
  beginLayerDraft(target.source, 2)
  return updateLayerDraft(values, 2)
}

const axis = (value: number | 'hug' | 'fill'): AxisSize => typeof value === 'number' ? { mode: 'fixed', size: value } : { mode: value }

/** The Layout section's change for the same values: what letting go writes. */
function change(values: LayerDraft): LayerChange {
  return {
    section: 'layout',
    ...(values.width !== undefined ? { width: axis(values.width) } : {}),
    ...(values.height !== undefined ? { height: axis(values.height) } : {}),
    ...(values.padding ? { padding: values.padding } : {}),
    ...(values.margin ? { margin: values.margin } : {}),
    ...(values.offset ? { offset: values.offset } : {}),
  }
}

/** The project after the Spacing control is set, as the panel sets it. */
function setSpacing(files: readonly SourceFile[], name: string, spacing: number, index = 0): SourceFile[] {
  const target = node(files, name, index)
  const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: [...files], scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation: { kind: 'property', control: 'spacing', value: String(spacing) } })
  if (!plan.ok) throw new Error(plan.reason)
  return files.map(file => ({ ...file, text: plan.changes.find(c => c.file === file.id)?.after ?? file.text }))
}

/** The page the written Swift draws. */
function written(files: readonly SourceFile[], name: string, values: LayerDraft, index = 0, extra?: Partial<CompileRequest>): CompileResult {
  let after = values.spacing !== undefined ? setSpacing(files, name, values.spacing, index) : [...files]
  const { spacing: _spacing, ...layout } = values
  void _spacing
  if (Object.keys(layout).length) after = setLayer(after, name, [change(layout)], index)
  expect(text(after)).not.toBe(text(files))
  resetPipelineState()
  return compiled(after, extra)
}

/** Every node the tree paints, in order: what it is and where it is on the screen. */
const drawing = (tree: RenderTree) => tree.nodes.map(n => ({ kind: n.kind, frame: worldFrame(tree.nodes, n) }))

function expectSameDrawing(draft: RenderTree, write: RenderTree): void {
  const a = drawing(draft), b = drawing(write)
  expect(a.map(n => n.kind)).toEqual(b.map(n => n.kind))
  a.forEach((n, at) => {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(n.frame[key] - b[at]!.frame[key]), `node ${at} (${n.kind}) ${key}: draft ${n.frame[key]}, written ${b[at]!.frame[key]}`).toBeLessThanOrEqual(0.5)
    }
  })
}

/** The draft of `values` on the `index`th `name` in `body` draws what writing them does. */
function agrees(body: string, name: string, values: LayerDraft, index = 0, declarations = ''): void {
  const files = project(screen(body, declarations))
  const draft = drafted(files, name, values, index)
  // The draft moves something, or the corpus is not testing it.
  resetPipelineState()
  const before = compiled(files)
  const write = written(files, name, values, index)
  expect(drawing(write.renderTree!)).not.toEqual(drawing(before.renderTree!))
  expectSameDrawing(draft.renderTree!, write.renderTree!)
}

const even = (n: number) => ({ top: n, leading: n, bottom: n, trailing: n })
const sides = (top: number, leading: number, bottom: number, trailing: number) => ({ top, leading, bottom, trailing })

describe('a draft draws what writing it draws', () => {
  describe('a plain Text', () => {
    const body = '        VStack(alignment: .leading) {\n            Text("Plain words")\n            Text("A much longer line of words below it")\n        }'
    it.each<[string, LayerDraft]>([
      ['a fixed width', { width: 220 }],
      ['a fixed height', { height: 64 }],
      ['both', { width: 180, height: 40 }],
      ['fill across', { width: 'fill' }],
      ['new padding', { padding: even(12) }],
      ['padding on a pair of axes', { padding: sides(4, 20, 4, 20) }],
      ['padding on every side apart', { padding: sides(1, 2, 3, 4) }],
    ])('%s', (_, values) => agrees(body, 'Text', values))
  })

  describe('a filled card', () => {
    const body = '        VStack(alignment: .leading, spacing: 4) {\n            Text("Title").font(.headline)\n            Text("Subtitle")\n        }\n        .padding(16)\n        .background(.gray.opacity(0.2))\n        .clipShape(.rect(cornerRadius: 12))'
    it.each<[string, LayerDraft]>([
      ['its padding', { padding: even(24) }],
      ['no padding', { padding: even(0) }],
      ['a fixed width', { width: 300 }],
      ['a fixed size', { width: 260, height: 140 }],
      ['fill across', { width: 'fill' }],
    ])('%s', (_, values) => agrees(body, 'VStack', values))

    it('back to hug from a fixed size', () => {
      agrees('        Text("Card").padding(8).frame(width: 200, height: 100).background(.yellow)', 'Text', { width: 'hug' })
    })
    it('a mixed size, fixed one way and filling the other', () => {
      agrees('        Text("Card").frame(minWidth: 40, maxWidth: .infinity).background(.yellow)', 'Text', { height: 90 })
    })
    it('a Hug up to a maximum made fixed', () => {
      agrees('        Text("A long message that wraps onto a second line").padding(10).background(.blue).frame(maxWidth: 220, alignment: .leading)', 'Text', { width: 160 })
    })
    it('a fixed height beside a Hug up to a maximum', () => {
      agrees('        Text("A long message that wraps onto a second line").padding(10).background(.blue).frame(maxWidth: 220, alignment: .leading)', 'Text', { height: 120 })
    })
  })

  describe('padding and margin', () => {
    const body = '        VStack {\n            Text("Inside").padding(8).background(.yellow).padding(4)\n            Text("Next")\n        }'
    it.each<[string, LayerDraft]>([
      ['the padding', { padding: even(20) }],
      ['the margin', { margin: even(16) }],
      ['a margin on one side', { margin: sides(0, 0, 30, 0) }],
      ['both at once', { padding: even(2), margin: even(10) }],
    ])('%s', (_, values) => agrees(body, 'Text', values))

    it('a new margin, just outside the fill', () => {
      agrees('        VStack {\n            Text("Inside").background(.yellow).shadow(radius: 2)\n            Text("Next")\n        }', 'Text', { margin: even(12) })
    })
    it('padding on lines of their own', () => {
      agrees('        VStack {\n            Text("Inside")\n                .font(.title)\n                .background(Color.blue)\n            Text("Next")\n        }', 'Text', { padding: sides(8, 16, 8, 16) })
    })
  })

  describe('a Button of each form', () => {
    const inColumn = (button: string) => `        VStack {\n            ${button}\n            Text("Below")\n        }`
    it.each<[string, string, LayerDraft]>([
      ['titled, its padding', 'Button("Save") {}\n                .buttonStyle(.borderedProminent)', { padding: even(14) }],
      ['titled, its width', 'Button("Save") {}\n                .buttonStyle(.borderedProminent)', { width: 200 }],
      ['titled, padding and size at once', 'Button("Save") {}\n                .buttonStyle(.bordered)', { padding: sides(4, 10, 4, 10), height: 60 }],
      ['titled with a symbol', 'Button("Save", systemImage: "star") {}\n                .buttonStyle(.bordered)', { padding: even(10) }],
      ['a label of one view', 'Button(action: {}) {\n                Text("Save")\n            }\n            .buttonStyle(.borderedProminent)', { padding: even(12) }],
      ['a label of one view, its width', 'Button(action: {}) {\n                Text("Save")\n            }\n            .buttonStyle(.borderedProminent)', { width: 180 }],
      ['a padded label', 'Button {\n            } label: {\n                Text("Save").padding(4)\n            }\n            .buttonStyle(.bordered)', { padding: even(16) }],
      ['a label of several views', 'Button(action: {}) {\n                Image(systemName: "star")\n                Text("Save")\n            }\n            .buttonStyle(.borderedProminent)', { padding: even(10) }],
      ['a plain button, its margin', 'Button("Go") {}\n                .buttonStyle(.bordered)\n                .padding(8)', { margin: even(20) }],
    ])('%s', (_, button, values) => agrees(inColumn(button), 'Button', values))
  })

  describe('a shape', () => {
    it.each<[string, string, LayerDraft]>([
      ['its size', '        Circle().fill(.red).frame(width: 40, height: 40)', { width: 90, height: 60 }],
      ['a new margin', '        VStack {\n            RoundedRectangle(cornerRadius: 8).fill(.blue).frame(height: 50)\n            Text("Below")\n        }', { margin: even(12) }],
      ['its margin', '        VStack {\n            Capsule().fill(.green).frame(width: 100, height: 30).padding(8)\n            Text("Below")\n        }', { margin: sides(20, 0, 2, 0) }],
    ])('%s', (_, body, values) => agrees(body, body.includes('Circle') ? 'Circle' : body.includes('Capsule') ? 'Capsule' : 'RoundedRectangle', values))
  })

  describe('a stack’s spacing', () => {
    it.each<[string, string, string, LayerDraft]>([
      ['written', '        VStack(spacing: 8) {\n            Text("One")\n            Text("Two")\n            Text("Three")\n        }', 'VStack', { spacing: 24 }],
      ['the default', '        HStack {\n            Text("One")\n            Image(systemName: "star")\n        }', 'HStack', { spacing: 30 }],
      ['to none', '        VStack(alignment: .leading) {\n            Text("One")\n            Text("Two")\n        }', 'VStack', { spacing: 0 }],
      ['from Auto, taking its Spacers out', '        VStack {\n            Text("One")\n            Spacer()\n            Text("Two")\n        }\n        .frame(maxHeight: .infinity)', 'VStack', { spacing: 12 }],
    ])('%s', (_, body, name, values) => agrees(body, name, values))
  })

  describe('an Overlap offset', () => {
    const overlap = (badge: string) => `        ZStack {\n            Color.gray\n            ${badge}\n        }\n        .frame(width: 240, height: 160)`
    it.each<[string, string, LayerDraft]>([
      ['a new offset', 'Text("Badge").padding(6).background(.white)', { offset: { x: 30, y: -20 } }],
      ['one there', 'Text("Badge").offset(x: 10, y: 10)', { offset: { x: -40, y: 25 } }],
      ['back to none', 'Text("Badge").offset(x: 10, y: 10)', { offset: { x: 0, y: 0 } }],
      ['a pinned view’s margin', 'Text("Badge").padding(4).background(.white).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)', { margin: sides(12, 16, 0, 0) }],
    ])('%s', (_, badge, values) => agrees(overlap(badge), 'Text', values))
  })

  describe('where the view sits', () => {
    it.each<[string, string, string, LayerDraft, string?]>([
      ['in a List row', '        List {\n            Text("Row").padding(4)\n            Text("Next")\n        }', 'Text', { padding: even(14) }],
      ['in a ScrollView', '        ScrollView {\n            VStack {\n                Text("Scrolled").padding(4).background(.mint)\n                Text("Next")\n            }\n        }', 'Text', { height: 90 }],
      ['under a navigation title', '        NavigationStack {\n            VStack {\n                Text("Content").background(.mint)\n                Text("Next")\n            }\n            .navigationTitle("Title")\n        }', 'Text', { width: 250, margin: even(6) }],
      ['a component, where it is used', '        VStack {\n            CardView().padding(10)\n            Text("Next")\n        }', 'CardView', { padding: even(24) }, 'struct CardView: View {\n    var body: some View {\n        Text("Card").padding(4).background(.mint)\n    }\n}\n'],
      ['an aligned frame, made taller', '        Text("A").frame(width: 200, alignment: .leading).background(.red)', 'Text', { height: 60 }],
      ['a view with a modifier the studio does not know, its padding in place', '        VStack {\n            Text("A").padding(6).background(.red).customLook()\n            Text("Next")\n        }', 'Text', { padding: even(18) }, 'extension View {\n    func customLook() -> some View { self.opacity(0.9) }\n}\n'],
      ['a Button with a frame of its own', '        VStack {\n            Button("Save") {}\n                .buttonStyle(.bordered)\n                .frame(width: 160)\n            Text("Next")\n        }', 'Button', { width: 240 }],
    ])('%s', (_, body, name, values, declarations) => agrees(body, name, values, 0, declarations))
  })

  it('changes every row a row design is drawn in', () => {
    agrees('        VStack {\n            ForEach(0..<3, id: \\.self) { row in\n                Text("Row \\(row)").padding(4).background(.yellow)\n            }\n        }', 'Text', { padding: even(10), width: 150 })
  })
})

describe('a drag', () => {
  const files = project(screen('        VStack {\n            Text("Hello").padding(8).background(.blue)\n            Text("Below")\n        }'))

  it('keeps its draft through a redraw until it ends, then draws the page as it is', () => {
    const before = compiled(files).renderTree!
    resetPipelineState()
    const draft = drafted(files, 'Text', { padding: even(30) })
    expect(drawing(draft.renderTree!)).not.toEqual(drawing(before))
    const ended = endLayerDraft(3)
    expect(ended.revision).toBe(3)
    expect(drawing(ended.renderTree!)).toEqual(drawing(before))
  })

  it('follows the dragged values in its geometry', () => {
    const target = node(files, 'Text')
    compiled(files)
    beginLayerDraft(target.source, 2)
    const view = updateLayerDraft({ padding: even(30) }, 2).geometry!.instances[0]!
    expect(view.boxes).toEqual([{ index: 0, kind: 'padding', rect: expect.any(Object), draft: true }])
    expect(view.boxes[0]!.rect.width - view.content.width).toBeCloseTo(60, 3)
  })

  it('leaves the authoring model out of each frame, which a draft does not change', () => {
    const draft = drafted(files, 'Text', { padding: even(30) })
    expect(draft.authoring).toBeUndefined()
    expect(endLayerDraft(3).authoring?.nodes.some(n => n.name === 'Text')).toBe(true)
  })

  it('is kept when the page is laid out again, as for a font refinement', () => {
    const draft = drafted(files, 'Text', { padding: even(30) })
    expect(drawing(relayout(3).renderTree!)).toEqual(drawing(draft.renderTree!))
  })

  it('ends when the source changes', () => {
    drafted(files, 'Text', { padding: even(30) })
    const next = compile(request(files, 4))
    const late = updateLayerDraft({ padding: even(40) }, 4)
    resetPipelineState()
    const plain = drawing(compiled(files).renderTree!)
    expect(drawing(next.renderTree!)).toEqual(plain)
    expect(drawing(late.renderTree!)).toEqual(plain)
  })

  it('draws a refused value as the page is', () => {
    // A shape fills its frame, so it has no padding: the writer refuses it, and so does the draft.
    const shape = project(screen('        Circle().fill(.red).frame(width: 40, height: 40)'))
    const before = compiled(shape).renderTree!
    resetPipelineState()
    expect(drawing(drafted(shape, 'Circle', { padding: even(10) }).renderTree!)).toEqual(drawing(before))
  })

  it('draws on every page of the gallery the view is on', () => {
    const draft = drafted(files, 'Text', { padding: even(30) }, 0, { allPages: true })
    resetPipelineState()
    const write = written(files, 'Text', { padding: even(30) }, 0, { allPages: true })
    expect(draft.pages?.length).toBe(write.pages?.length)
    draft.pages!.forEach((page, at) => expectSameDrawing(page.tree, write.pages![at]!.tree))
    expect(draft.geometry?.instances[0]?.page).toBe(draft.pages![0]!.id)
  })
})
