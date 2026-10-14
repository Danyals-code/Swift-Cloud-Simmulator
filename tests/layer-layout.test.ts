import { beforeEach, describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { AxisSize, LayerChange } from '@studio/shared'
import { APP, XCODE, bodyOf, layerOf, node, planLayer, project, screen, setLayer, text, typecheckInXcode } from './helpers/layer-project'

/**
 * A layer's Layout section (doc 18, Wave 2): Figma's Hug, Fill and Fixed for each axis,
 * the frame's alignment, the offset, and a pin inside an Overlap, read from the frames
 * and written back as the plainest frames that say them.
 */
beforeEach(resetPipelineState)

const TOKENS = '\nenum Layout {\n    static let card: CGFloat = 240\n    static let bubble: CGFloat = 260\n}\n'
const files = (body: string, declarations = TOKENS) => project(screen(`        ${body}`, declarations))
const layout = (body: string, name = 'Text', index = 0) => layerOf(files(body), name, index).layout
type Layout = Extract<LayerChange, { section: 'layout' }>

const hug: AxisSize = { mode: 'hug' }
describe('reading size', () => {
  it.each<[string, string, AxisSize, AxisSize, string]>([
    ['no frame as Hug', 'Text("A")', hug, hug, 'absent'],
    ['a width as Fixed', 'Text("A").frame(width: 120)', { mode: 'fixed', size: 120 }, hug, 'literal'],
    ['a token width as Fixed, kept linked', 'Text("A").frame(width: Layout.card, height: 44)', { mode: 'fixed', size: { token: 'Layout.card' } }, { mode: 'fixed', size: 44 }, 'token'],
    ['an infinite max as Fill', 'Text("A").frame(maxWidth: .infinity)', { mode: 'fill' }, hug, 'literal'],
    ['Fill with a min', 'Text("A").frame(minWidth: 40, maxWidth: .infinity)', { mode: 'fill', min: 40 }, hug, 'literal'],
    ['a max before the fill as Fill up to it', 'Text("A").frame(maxWidth: 260).background(Color.blue)', { mode: 'fill', max: 260 }, hug, 'literal'],
    ['a min alone as Hug with a min', 'Text("A").frame(minWidth: 80)', { mode: 'hug', min: 80 }, hug, 'literal'],
    ['a max after the fill as Hug up to it', 'Text("A").padding(12).background(Color.blue).frame(maxWidth: 260, alignment: .leading)', { mode: 'hug', max: 260 }, hug, 'literal'],
    ['a Fixed width and a Fill height, each in its frame', 'Text("A").frame(width: 100).frame(maxHeight: .infinity)', { mode: 'fixed', size: 100 }, { mode: 'fill' }, 'literal'],
  ])('reads %s', (_, body, width, height, state) => {
    const read = layout(body)
    expect(read.width.value).toEqual(width)
    expect(read.height.value).toEqual(height)
    expect(read.width.state).toBe(state)
  })
})

describe('what the stack tags as Layout', () => {
  it('claims the frames, the offset and the pin it reads', () => {
    const view = node(files('ZStack {\n            Text("A").frame(width: 40).background(Color.red).offset(x: 2).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top).opacity(0.5)\n        }.frame(width: 100, height: 100)'), 'Text')
    expect(view.modifiers!.filter(modifier => view.layer!.claimed[modifier.id] === 'layout').map(modifier => modifier.name)).toEqual(['frame', 'offset', 'frame'])
  })
})

describe('reading what the panel leaves to Code', () => {
  it.each([
    ['an ideal width', 'Text("A").frame(idealWidth: 100, maxWidth: .infinity)', /ideal size/],
    ['a width worked out in Swift', 'Text("A").frame(width: size * 2)', /worked out in Swift/],
    ['a GeometryReader’s size', 'Text("A").frame(width: proxy.size.width)', /worked out in Swift/],
    ['two frames that set the width', 'Text("A").frame(width: 100).frame(minWidth: 50)', /Two frames set this view’s width/],
    ['frames in two places', 'Text("A").frame(width: 100).padding(8).frame(height: 20)', /more than one place/],
    ['a comment in the size', 'Text("A").frame(width: 100) /* wide */ .frame(maxHeight: .infinity)', /comment/],
    ['a room that fills after the fill', 'Text("A").background(Color.blue).frame(maxWidth: .infinity, alignment: .leading)', /room around/],
  ])('shows %s as code, and refuses to change it', (_, body, reason) => {
    const declarations = `${TOKENS}\nlet size: CGFloat = 4\nlet proxy = (size: CGSize(width: 10, height: 10), x: 0)\n`
    const read = layerOf(files(body, declarations), 'Text').layout
    expect(read.width.state).toBe('code')
    expect(read.width.disabledReason).toMatch(reason)
    expect(read.alignment.disabledReason ?? read.width.disabledReason).toMatch(reason)
    expect(() => setLayer(files(body, declarations), 'Text', [{ section: 'layout', height: { mode: 'fixed', size: 10 } }])).toThrow(reason)
  })
})

describe('reading alignment, pin and offset', () => {
  it('reads the frame’s alignment where a size is larger than the content, and says why not otherwise', () => {
    expect(layout('Text("A").frame(maxWidth: .infinity, alignment: .leading)').alignment).toMatchObject({ value: 'leading', state: 'literal' })
    expect(layout('Text("A").frame(width: 200)').alignment).toMatchObject({ value: 'center', state: 'absent' })
    expect(layout('Text("A").frame(width: 100).frame(maxHeight: .infinity, alignment: .top)').alignment).toMatchObject({ value: 'top', state: 'literal' })
    expect(layout('Text("A").frame(width: 100, alignment: .leading).frame(maxHeight: .infinity, alignment: .bottom)').alignment.value).toBe('bottomLeading')
    const hugging = layout('Text("A").padding(8)').alignment
    expect(hugging.value).toBeNull()
    expect(hugging.disabledReason).toBe('Alignment places the content in a size larger than it. Set Fill or Fixed first.')
  })

  it('reads an offset with literals or tokens, and leaves a size or a computed one to Code', () => {
    expect(layout('Text("A").offset(x: 4, y: -8)').offset).toMatchObject({ value: { x: 4, y: -8 }, state: 'literal' })
    expect(layout('Text("A").offset(y: Layout.card)').offset).toMatchObject({ value: { x: 0, y: { token: 'Layout.card' } }, state: 'token' })
    expect(layout('Text("A")').offset).toMatchObject({ value: null, state: 'absent' })
    expect(layout('Text("A").offset(CGSize(width: 4, height: 4))').offset).toMatchObject({ state: 'code', disabledReason: expect.stringMatching(/worked out in Swift/) })
  })

  const overlap = (child: string, size = '.frame(width: 300, height: 200)') => `ZStack {\n            Color.gray\n            ${child}\n        }${size}`
  it('reads a frame that fills both ways inside a sized Overlap as the corner the view is pinned to', () => {
    const read = layout(overlap('Text("New").padding(4).background(Color.red).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)'))
    expect(read.pin).toMatchObject({ value: 'topTrailing', state: 'literal' })
    expect(read.width.value).toEqual(hug)
    expect(read.height.value).toEqual(hug)
    expect(read.context).toMatchObject({ parent: 'overlap', surface: true })
  })

  it('offers a pin only in an Overlap with a size, and says why', () => {
    expect(layout('Text("A")').pin.disabledReason).toMatch(/Group it in an Overlap/)
    expect(layout(overlap('Text("A")', '')).pin.disabledReason).toMatch(/Give the Overlap a Fixed or Fill width and height first/)
    expect(layout(overlap('Text("A")')).pin).toEqual({ value: null, state: 'absent' })
  })
})

describe('reading a Button’s size from its label', () => {
  it('reads the frame that ends the label as the button’s size, and a frame on the button as its own', () => {
    expect(layout('Button("Go") { }', 'Button')).toMatchObject({ width: { value: hug, state: 'absent' }, context: { inButton: true } })
    expect(layout('Button {\n        } label: {\n            Text("Go").frame(maxWidth: .infinity)\n        }', 'Button').width).toMatchObject({ value: { mode: 'fill' }, state: 'literal' })
    expect(layout('Button("Go") { }.frame(width: 120)', 'Button').width).toMatchObject({ value: { mode: 'fixed', size: 120 }, state: 'literal' })
  })
})

const written = (body: string, change: Omit<Layout, 'section'>, name = 'Text', declarations = TOKENS) => bodyOf(setLayer(files(body, declarations), name, [{ section: 'layout', ...change }]))
const fixed = (size: number): AxisSize => ({ mode: 'fixed', size })
const fill: AxisSize = { mode: 'fill' }

describe('writing size as the plainest frames', () => {
  it.each<[string, string, Omit<Layout, 'section'>, string]>([
    ['both axes Fixed in one frame', 'Text("A")', { width: fixed(120), height: fixed(44) }, 'Text("A").frame(width: 120, height: 44)'],
    ['one Fixed axis', 'Text("A")', { width: fixed(120) }, 'Text("A").frame(width: 120)'],
    ['Fill', 'Text("A")', { width: fill }, 'Text("A").frame(maxWidth: .infinity)'],
    ['Fill with a min and a max', 'Text("A")', { width: { mode: 'fill', min: 40, max: 320 } }, 'Text("A").frame(minWidth: 40, maxWidth: 320)'],
    ['both axes flexible in one frame', 'Text("A")', { width: fill, height: { mode: 'hug', min: 44 } }, 'Text("A").frame(maxWidth: .infinity, minHeight: 44)'],
    ['a Fixed and a Fill axis as two frames, the Fixed one first', 'Text("A")', { width: fixed(100), height: fill }, 'Text("A").frame(width: 100).frame(maxHeight: .infinity)'],
    ['an alignment inside a Fill', 'Text("A")', { width: fill, alignment: 'leading' }, 'Text("A").frame(maxWidth: .infinity, alignment: .leading)'],
    ['an alignment split across two frames, each along its axis', 'Text("A")', { width: fixed(100), height: fill, alignment: 'topLeading' }, 'Text("A").frame(width: 100, alignment: .leading).frame(maxHeight: .infinity, alignment: .top)'],
    ['Hug up to a max just outside the fill', 'Text("Hi").padding(12).background(Color.blue)', { width: { mode: 'hug', max: 260 }, alignment: 'leading' }, 'Text("Hi").padding(12).background(Color.blue).frame(maxWidth: 260, alignment: .leading)'],
    ['a size inside the fill, after the padding', 'Text("A").font(.title).padding(8).background(Color.blue).padding(4)', { width: fixed(80) }, 'Text("A").font(.title).padding(8).frame(width: 80).background(Color.blue).padding(4)'],
    ['a frame rewritten in its place', 'Text("A").frame(width: 100).background(Color.blue)', { width: fill }, 'Text("A").frame(maxWidth: .infinity).background(Color.blue)'],
    ['Hug, taking the frame away', 'Text("A").frame(width: 100).background(Color.blue)', { width: hug }, 'Text("A").background(Color.blue)'],
    ['a token kept linked', 'Text("A").frame(width: Layout.card)', { height: fixed(44) }, 'Text("A").frame(width: Layout.card, height: 44)'],
    ['a token it is given', 'Text("A")', { width: { mode: 'fixed', size: { token: 'Layout.card' } } }, 'Text("A").frame(width: Layout.card)'],
    ['Fill after Hug up to a max, moved inside the fill', 'Text("Hi").padding(12).background(Color.blue).frame(maxWidth: 260, alignment: .leading)', { width: { mode: 'fill', max: 260 } }, 'Text("Hi").padding(12).frame(maxWidth: 260, alignment: .leading).background(Color.blue)'],
  ])('writes %s', (_, body, change, expected) => {
    expect(written(body, change)).toBe(`        ${expected}`)
  })

  it('writes on lines of their own where the chain has them', () => {
    expect(written('Text("A")\n            .padding(8)\n            .background(Color.blue)', { width: fixed(100), height: fill }))
      .toBe('        Text("A")\n            .padding(8)\n            .frame(width: 100)\n            .frame(maxHeight: .infinity)\n            .background(Color.blue)')
  })

  it('starts Fixed from the size the preview measured, rounded to whole points', () => {
    expect(written('Text("A")', { width: { mode: 'fixed' }, measured: { width: 39.44, height: 20.33 } })).toBe('        Text("A").frame(width: 39)')
  })

  it('starts Fixed from the max or min it had when nothing was measured, and never from a made-up size', () => {
    expect(written('Text("A").frame(maxWidth: 260)', { width: { mode: 'fixed' } })).toBe('        Text("A").frame(width: 260)')
    expect(() => written('Text("A")', { width: { mode: 'fixed' } })).toThrow('Type a width in points. The preview hasn’t measured this view yet.')
  })

  it('writes nothing for a change that leaves the size as it was', () => {
    const plan = planLayer(files('Text("A").frame(maxHeight: .infinity).frame(width: 100)'), 'Text', [{ section: 'layout', width: fixed(100), height: fill }])
    expect(plan).toMatchObject({ ok: true, changes: [] })
  })

  it.each<[string, string, Omit<Layout, 'section'>, string | RegExp]>([
    ['Hug up to a max with no fill to hug', 'Text("A")', { width: { mode: 'hug', max: 260 } }, /no fill/],
    ['an alignment with nothing larger than the content', 'Text("A")', { alignment: 'leading' }, 'Alignment places the content in a size larger than it. Set Fill or Fixed first.'],
    ['a min larger than the max', 'Text("A")', { width: { mode: 'fill', min: 300, max: 200 } }, /minimum width is larger than the maximum/],
    ['a negative size', 'Text("A")', { width: fixed(-4) }, /0 or more/],
  ])('refuses %s, with the reason', (_, body, change, reason) => {
    expect(() => written(body, change)).toThrow(reason)
  })

  it('writes in order when one change sets padding, size, margin and offset', () => {
    expect(written('Text("A").background(Color.blue)', { padding: { top: 8, leading: 8, bottom: 8, trailing: 8 }, width: fixed(100), margin: { top: 4, leading: 4, bottom: 4, trailing: 4 }, offset: { x: 2, y: 0 } }))
      .toBe('        Text("A").padding(8).frame(width: 100).background(Color.blue).padding(4).offset(x: 2)')
    expect(written('Text("A").background(Color.blue)', { margin: { top: 4, leading: 4, bottom: 4, trailing: 4 }, width: { mode: 'hug', max: 260 } }))
      .toBe('        Text("A").background(Color.blue).padding(4).frame(maxWidth: 260)')
  })

  it('places nothing new in a chain with a modifier it does not know, but rewrites a frame that is there', () => {
    const glow = `${TOKENS}\nextension View {\n    func glow() -> some View { shadow(radius: 2) }\n}\n`
    expect(() => written('Text("A").glow()', { width: fill }, 'Text', glow)).toThrow(/does not know/)
    expect(written('Text("A").frame(width: 10).glow()', { width: fill }, 'Text', glow)).toBe('        Text("A").frame(maxWidth: .infinity).glow()')
  })
})

describe('writing a Button’s size on its label', () => {
  it('writes Fill into a titled button’s label, so a bordered button’s shape grows with it', () => {
    const body = 'Button("Go") { }.buttonStyle(.borderedProminent)'
    expect(written(body, { width: fill }, 'Button')).toBe('        Button { } label: {\n            Text("Go")\n                .frame(maxWidth: .infinity)\n        }.buttonStyle(.borderedProminent)')
  })

  it('writes two frames on lines of their own where the label has them', () => {
    expect(written('HStack {\n            Button("Go", role: .destructive) { }\n        }', { width: fixed(100), height: fill }, 'Button'))
      .toBe('        HStack {\n            Button(role: .destructive) { } label: {\n                Text("Go")\n                    .frame(width: 100)\n                    .frame(maxHeight: .infinity)\n            }\n        }')
  })

  it('rewrites the frame that ends a label in its place, and takes it away for Hug', () => {
    const body = 'Button {\n        } label: {\n            Text("Go")\n                .frame(maxWidth: .infinity)\n        }'
    expect(written(body, { width: fixed(120) }, 'Button')).toBe(`        ${body.replace('.frame(maxWidth: .infinity)', '.frame(width: 120)')}`)
    expect(written(body, { width: hug }, 'Button')).toBe(`        ${body.replace('\n                .frame(maxWidth: .infinity)', '')}`)
  })
})

describe('a Button’s padding, inside its style', () => {
  it('reads the label’s padding as the button’s, and a padding around the button as its margin', () => {
    expect(layout('Button {\n        } label: {\n            Text("Go").padding(8)\n        }', 'Button')).toMatchObject({ padding: { value: { top: 8, leading: 8, bottom: 8, trailing: 8 }, state: 'literal' }, margin: { value: null, state: 'absent' }, context: { surface: true } })
    expect(layout('Button("Go") { }.padding(20).buttonStyle(.bordered)', 'Button')).toMatchObject({ padding: { value: null, state: 'absent' }, margin: { value: { top: 20, leading: 20, bottom: 20, trailing: 20 }, state: 'literal' } })
  })

  it.each<[string, string, Omit<Layout, 'section'>, string]>([
    ['padding into a titled button’s label', 'Button("Go") { }.buttonStyle(.borderedProminent)', { padding: { top: 0, leading: 20, bottom: 0, trailing: 20 } }, 'Button { } label: {\n            Text("Go")\n                .padding(.horizontal, 20)\n        }.buttonStyle(.borderedProminent)'],
    ['padding and a size, in that order, into one label', 'Button("Go") { }.buttonStyle(.borderedProminent)', { width: fill, padding: { top: 8, leading: 8, bottom: 8, trailing: 8 } }, 'Button { } label: {\n            Text("Go")\n                .padding(8)\n                .frame(maxWidth: .infinity)\n        }.buttonStyle(.borderedProminent)'],
    ['padding inside the label’s fill', 'Button {\n        } label: {\n            Text("Go").background(Color.blue)\n        }', { padding: { top: 12, leading: 12, bottom: 12, trailing: 12 } }, 'Button {\n        } label: {\n            Text("Go").padding(12).background(Color.blue)\n        }'],
    ['a size inside the label’s fill, so the fill stretches', 'Button {\n        } label: {\n            Text("Go").padding(12).background(Color.blue)\n        }\n        .buttonStyle(.plain)', { width: fill }, 'Button {\n        } label: {\n            Text("Go").padding(12).frame(maxWidth: .infinity).background(Color.blue)\n        }\n        .buttonStyle(.plain)'],
    ['a margin around the button, outside its style', 'Button("Go") { }.buttonStyle(.bordered)', { margin: { top: 4, leading: 4, bottom: 4, trailing: 4 } }, 'Button("Go") { }.padding(4).buttonStyle(.bordered)'],
  ])('writes %s', (_, body, change, expected) => {
    expect(written(body, change, 'Button')).toBe(`        ${expected}`)
  })
})

describe('a Button’s margin, kept outside what paints it', () => {
  // A padding around a Button with nothing painting it is its margin. A fill, corners or a
  // stroke added later goes inside that margin, so the padding stays the space around it.
  const button = 'Button("Go") { }.padding(20).buttonStyle(.bordered)'
  it.each<[string, LayerChange, string]>([
    ['a fill', { section: 'fill', fill: { kind: 'color', color: { name: 'red' } } }, 'Button("Go") { }.background(.red).padding(20).buttonStyle(.bordered)'],
    ['corners', { section: 'corners', corners: { shape: 'rounded', radius: 8 } }, 'Button("Go") { }.clipShape(.rect(cornerRadius: 8)).padding(20).buttonStyle(.bordered)'],
    ['a stroke', { section: 'stroke', stroke: { color: { name: 'red' }, width: 1, position: 'inside' } }, 'Button("Go") { }.overlay(Rectangle().strokeBorder(.red, lineWidth: 1)).padding(20).buttonStyle(.bordered)'],
  ])('adds %s inside the margin', (_, change, expected) => {
    const after = setLayer(files(button), 'Button', [change])
    expect(bodyOf(after)).toBe(`        ${expected}`)
    expect(layerOf(after, 'Button').layout.margin).toMatchObject({ value: { top: 20, leading: 20, bottom: 20, trailing: 20 }, state: 'literal' })
  })

  it.skipIf(!XCODE)('builds in Xcode 27', () => {
    const changes: LayerChange[] = [
      { section: 'fill', fill: { kind: 'color', color: { name: 'red' } } },
      { section: 'corners', corners: { shape: 'rounded', radius: 8 } },
      { section: 'stroke', stroke: { color: { name: 'red' }, width: 1, position: 'inside' } },
    ]
    typecheckInXcode(changes.map(change => text(setLayer(files(button), 'Button', [change]))))
  }, 300_000)
})

describe('a shape’s margin, and no padding', () => {
  const circle = 'Circle().fill(Color.blue).frame(width: 56, height: 56)'
  it('reads a shape’s frame as its size and a padding around it as its margin, and offers no padding', () => {
    const read = layout(`${circle}.padding(16)`, 'Circle')
    expect(read).toMatchObject({ width: { value: fixed(56) }, margin: { value: { top: 16, leading: 16, bottom: 16, trailing: 16 }, state: 'literal' }, context: { surface: true } })
    expect(read.padding).toEqual({ value: null, state: 'absent', disabledReason: 'A shape fills its whole frame, so it has no padding. Use Margin for space around it.' })
  })

  it('writes a margin after the shape’s size, and a size before its margin', () => {
    expect(written(circle, { margin: { top: 16, leading: 16, bottom: 16, trailing: 16 } }, 'Circle')).toBe(`        ${circle}.padding(16)`)
    expect(written('Circle().fill(Color.blue).padding(16).opacity(0.5)', { width: fixed(56), height: fixed(56) }, 'Circle')).toBe(`        ${circle}.padding(16).opacity(0.5)`)
  })

  it('refuses padding on a shape, with the reason', () => {
    expect(() => written(circle, { padding: { top: 8, leading: 8, bottom: 8, trailing: 8 } }, 'Circle')).toThrow('A shape fills its whole frame, so it has no padding. Use Margin for space around it.')
  })
})

describe('writing offset and pin', () => {
  it.each<[string, string, Layout['offset'], string]>([
    ['an offset after the fill, before the effects', 'Text("A").background(Color.blue).opacity(0.5)', { x: 0, y: 6 }, 'Text("A").background(Color.blue).offset(y: 6).opacity(0.5)'],
    ['both axes', 'Text("A")', { x: 12, y: -4 }, 'Text("A").offset(x: 12, y: -4)'],
    ['an offset rewritten in its place', 'Text("A").offset(x: 4).padding(2)', { x: 4, y: 8 }, 'Text("A").offset(x: 4, y: 8).padding(2)'],
    ['zero, taking it away', 'Text("A").offset(x: 4)', { x: 0, y: 0 }, 'Text("A")'],
    ['a token kept linked', 'Text("A").offset(y: Layout.card)', { x: 3, y: { token: 'Layout.card' } }, 'Text("A").offset(x: 3, y: Layout.card)'],
  ])('writes %s', (_, body, offset, expected) => {
    expect(written(body, { offset })).toBe(`        ${expected}`)
  })

  const overlap = (child: string, size = '.frame(width: 300, height: 200)') => `ZStack {\n            Color.gray\n            ${child}\n        }${size}`
  it('pins a view in a sized Overlap with a frame after its fill, and unpins it', () => {
    const badge = 'Text("New").padding(4).background(Color.red)'
    const pinned = written(overlap(badge), { pin: 'bottomTrailing' })
    expect(pinned).toBe(`        ${overlap(`${badge}.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)`)}`)
    expect(bodyOf(setLayer(project(screen(pinned, TOKENS)), 'Text', [{ section: 'layout', pin: null }]))).toBe(`        ${overlap(badge)}`)
  })

  it('pins a view with no fill after its size, and keeps the two apart', () => {
    const pinned = written(overlap('Text("New").frame(width: 40)'), { pin: 'top' })
    expect(pinned).toBe(`        ${overlap('Text("New").frame(width: 40).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)')}`)
    const read = layerOf(project(screen(pinned, TOKENS)), 'Text').layout
    expect(read).toMatchObject({ width: { value: fixed(40) }, pin: { value: 'top' } })
    expect(bodyOf(setLayer(project(screen(pinned, TOKENS)), 'Text', [{ section: 'layout', width: fixed(60) }]))).toBe(pinned.replace('width: 40', 'width: 60'))
  })

  it('refuses a pin outside an Overlap, or in one with no size, with the reason', () => {
    expect(() => written('Text("A")', { pin: 'top' })).toThrow(/Group it in an Overlap/)
    expect(() => written(overlap('Text("A")', ''), { pin: 'top' })).toThrow(/Give the Overlap a Fixed or Fill width and height first/)
  })
})

describe('what is written draws as designed in the preview', () => {
  const drawn = (source: string) => {
    const result = compile({ projectId: 'layout', revision: 1, files: [{ id: APP, text: source }], canvas: { width: 402, height: 874 }, colorScheme: 'light' })
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
    return result.renderTree!.nodes
  }
  const filled = (nodes: ReturnType<typeof drawn>) => nodes.filter(node => node.id !== 'screen' && node.background)

  it('keeps a short chat bubble short when it hugs up to 260', () => {
    const source = text(setLayer(files('VStack {\n            Text("Hi").padding(12).background(Color.blue)\n        }'), 'Text', [{ section: 'layout', width: { mode: 'hug', max: 260 }, alignment: 'leading' }]))
    const [bubble] = filled(drawn(source))
    expect(bubble!.frame.width).toBeGreaterThan(24)
    expect(bubble!.frame.width).toBeLessThan(80)
  })

  it('shares a Row’s width between two buttons set to Fill', () => {
    let project = files('HStack(spacing: 8) {\n            Button("Cancel") { }.buttonStyle(.bordered)\n            Button("Save") { }.buttonStyle(.borderedProminent)\n        }.padding(16)')
    project = setLayer(project, 'Button', [{ section: 'layout', width: fill }], 0)
    project = setLayer(project, 'Button', [{ section: 'layout', width: fill }], 1)
    const shapes = drawn(text(project)).filter(node => /btnr-clip$/.test(node.id))
    expect(shapes).toHaveLength(2)
    expect(shapes[0]!.frame.width).toBeCloseTo(shapes[1]!.frame.width, 0)
    expect(shapes[0]!.frame.width + shapes[1]!.frame.width + 8).toBeCloseTo(402 - 32, 0)
  })

  const tappable = (title: string) => `Button {\n            } label: {\n                Text("${title}").padding(12).background(Color.blue)\n            }\n            .buttonStyle(.plain)`
  it('shares a Row’s width between two made-tappable buttons whose labels have a fill', () => {
    let project = files(`HStack(spacing: 8) {\n            ${tappable('Cancel')}\n            ${tappable('Save')}\n        }.padding(16)`)
    project = setLayer(project, 'Button', [{ section: 'layout', width: fill }], 0)
    project = setLayer(project, 'Button', [{ section: 'layout', width: fill }], 1)
    expect(bodyOf(project)).toContain('Text("Cancel").padding(12).frame(maxWidth: .infinity).background(Color.blue)')
    const fills = filled(drawn(text(project)))
    expect(fills).toHaveLength(2)
    expect(fills[0]!.frame.width).toBeCloseTo(fills[1]!.frame.width, 0)
    expect(fills[0]!.frame.width + fills[1]!.frame.width + 8).toBeCloseTo(402 - 32, 0)
  })

  it('grows a styled button’s shape by the padding, which goes on its label', () => {
    const body = 'VStack {\n            Button("Go") { }.buttonStyle(.borderedProminent)\n        }'
    const shape = (source: string) => drawn(source).find(node => /btnr-clip$/.test(node.id))!.frame
    const before = shape(text(files(body))), after = shape(text(setLayer(files(body), 'Button', [{ section: 'layout', padding: { top: 20, leading: 20, bottom: 20, trailing: 20 } }])))
    expect(after.width).toBeCloseTo(before.width + 40, 0)
    expect(after.height).toBeCloseTo(before.height + 40, 0)
  })

  it('keeps a shape its size and puts a margin around it', () => {
    const body = 'VStack(spacing: 0) {\n            Circle().fill(Color.blue).frame(width: 56, height: 56)\n            Text("B")\n        }'
    const nodes = drawn(text(setLayer(files(body), 'Circle', [{ section: 'layout', margin: { top: 16, leading: 16, bottom: 16, trailing: 16 } }])))
    const circle = nodes.find(node => node.kind === 'shape')!, b = nodes.find(node => node.text?.runs.some(run => run.text === 'B'))!
    expect(circle.frame.width).toBeCloseTo(56, 0)
    expect(b.frame.y - (circle.frame.y + circle.frame.height)).toBeCloseTo(16, 0)
  })

  it('puts padding inside the fill and a margin outside it', () => {
    const source = text(setLayer(files('VStack(spacing: 0) {\n            Text("A").background(Color.blue)\n            Text("B")\n        }'), 'Text', [{ section: 'layout', padding: { top: 10, leading: 10, bottom: 10, trailing: 10 }, margin: { top: 20, leading: 20, bottom: 20, trailing: 20 } }]))
    const nodes = drawn(source)
    const [fillNode] = filled(nodes), a = nodes.find(node => node.text?.runs.some(run => run.text === 'A'))!, b = nodes.find(node => node.text?.runs.some(run => run.text === 'B'))!
    expect(a.frame.x - fillNode!.frame.x).toBeCloseTo(10, 0)
    expect(b.frame.y - (fillNode!.frame.y + fillNode!.frame.height)).toBeCloseTo(20, 0)
  })
})

describe.skipIf(!XCODE)('what the layout writer writes builds in Xcode 27', () => {
  it('for every size, alignment, offset and pin form', () => {
    const bubble = 'Text("Hi")\n            .padding(12)\n            .background(Color.blue)'
    const forms: [string, Omit<Layout, 'section'>, string?][] = [
      [bubble, { width: fixed(120), height: fixed(44) }],
      [bubble, { width: fixed(120), alignment: 'trailing' }],
      [bubble, { width: fill }],
      [bubble, { width: { mode: 'fill', min: 40, max: 320 }, alignment: 'leading' }],
      [bubble, { width: fill, height: { mode: 'hug', min: 44 }, alignment: 'bottomTrailing' }],
      [bubble, { width: fixed(100), height: fill, alignment: 'topLeading' }],
      [bubble, { width: { mode: 'hug', max: 260 }, alignment: 'leading' }],
      [bubble, { width: { mode: 'hug', min: 80, max: { token: 'Layout.bubble' } }, height: { mode: 'hug', max: 120 }, alignment: 'trailing' }],
      [bubble, { width: { mode: 'fixed', size: { token: 'Layout.card' } }, height: { mode: 'fill', max: 200 } }],
      [bubble, { offset: { x: 12, y: -4 } }],
      [bubble, { offset: { x: 0, y: { token: 'Layout.card' } } }],
      ['ZStack {\n            Color.gray\n            Text("New").padding(4).background(Color.red)\n        }.frame(width: 300, height: 200)', { pin: 'bottomTrailing' }],
      ['ZStack {\n            Color.gray\n            Text("New").frame(width: 40)\n        }.frame(maxWidth: .infinity, maxHeight: .infinity)', { pin: 'top' }],
      ['Button("Go") { }.buttonStyle(.borderedProminent)', { width: fill }, 'Button'],
      ['HStack {\n            Button("Go", systemImage: "star", role: .destructive) { }\n        }', { width: fixed(100), height: fill }, 'Button'],
      ['Button {\n        } label: {\n            Image(systemName: "star")\n            Text("Go")\n        }', { width: { mode: 'fill', max: 320 }, alignment: 'leading' }, 'Button'],
      ['Button("Go") { }.buttonStyle(.borderedProminent)', { width: fill, padding: { top: 8, leading: 16, bottom: 8, trailing: 16 } }, 'Button'],
      ['Button {\n        } label: {\n            Text("Go").padding(12).background(Color.blue)\n        }\n        .buttonStyle(.plain)', { width: fill, padding: { top: 4, leading: 4, bottom: 4, trailing: 4 } }, 'Button'],
      ['Button {\n        } label: {\n            Image(systemName: "star")\n            Text("Go")\n        }', { padding: { top: 8, leading: 0, bottom: 0, trailing: 0 } }, 'Button'],
      ['Button("Go") { }.buttonStyle(.bordered)', { margin: { top: 4, leading: 4, bottom: 4, trailing: 4 } }, 'Button'],
      ['Circle().fill(Color.blue)', { width: fixed(56), height: fixed(56), margin: { top: 16, leading: 16, bottom: 16, trailing: 16 } }, 'Circle'],
      ['Capsule().stroke(Color.blue, lineWidth: 2).padding(4)', { width: fill, height: fixed(44) }, 'Capsule'],
    ]
    const sources = forms.map(([body, change, name]) => text(setLayer(files(body), name ?? 'Text', [{ section: 'layout', ...change }])))
    typecheckInXcode(sources)
    expect(sources).toHaveLength(forms.length)
  }, 300_000)
})
