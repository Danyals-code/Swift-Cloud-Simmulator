import { beforeEach, describe, expect, it } from 'vitest'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { evenInsets } from '@studio/shared'
import { XCODE, bodyOf, layerOf, project, screen, setLayer, text, typecheckInXcode } from './helpers/layer-project'

/**
 * A view read as a layer (doc 18, Wave 2): one value per Figma property, however the
 * modifiers that make it are written, and where they sit says which property they are.
 */
beforeEach(resetPipelineState)

const layer = (body: string, name = 'Text') => layerOf(project(screen(`        ${body}`)), name)

describe('padding and margin', () => {
  it('reads a padding before the fill as padding and one after it as margin', () => {
    const { layout } = layer('Text("A").padding(16).background(Color.blue).padding(8)')
    expect(layout.padding).toMatchObject({ value: evenInsets(16), state: 'literal' })
    expect(layout.margin).toMatchObject({ value: evenInsets(8), state: 'literal' })
  })
})

describe('writing padding and margin', () => {
  const written = (body: string, change: Parameters<typeof setLayer>[2][number], name = 'Text') => bodyOf(setLayer(project(screen(`        ${body}`)), name, [change]))

  it('adds padding inside the fill, after the text styles', () => {
    expect(written('Text("A").font(.title).background(Color.blue)', { section: 'layout', padding: evenInsets(12) }))
      .toBe('        Text("A").font(.title).padding(12).background(Color.blue)')
  })

  const sides = (top: number, leading: number, bottom: number, trailing: number) => ({ top, leading, bottom, trailing })
  it.each([
    ['a pair of axes', 'Text("A")', sides(8, 16, 8, 16), 'Text("A").padding(.horizontal, 16).padding(.vertical, 8)'],
    ['one axis', 'Text("A")', sides(0, 16, 0, 16), 'Text("A").padding(.horizontal, 16)'],
    ['one side', 'Text("A")', sides(8, 0, 0, 0), 'Text("A").padding(.top, 8)'],
    ['every side apart', 'Text("A")', sides(1, 2, 3, 4), 'Text("A").padding(EdgeInsets(top: 1, leading: 2, bottom: 3, trailing: 4))'],
    ['a run, rewritten in its place', 'Text("A").padding(.horizontal, 16).padding(.vertical, 8).background(Color.blue)', sides(4, 4, 4, 4), 'Text("A").padding(4).background(Color.blue)'],
    ['nothing, taking it away', 'Text("A").padding(8).background(Color.blue)', sides(0, 0, 0, 0), 'Text("A").background(Color.blue)'],
  ])('writes %s as the plainest Swift', (_, body, insets, expected) => {
    expect(written(body, { section: 'layout', padding: insets })).toBe(`        ${expected}`)
  })

  it('writes on lines of their own where the chain has them', () => {
    expect(written('Text("A")\n            .font(.title)\n            .background(Color.blue)', { section: 'layout', padding: sides(8, 16, 8, 16) }))
      .toBe('        Text("A")\n            .font(.title)\n            .padding(.horizontal, 16)\n            .padding(.vertical, 8)\n            .background(Color.blue)')
    expect(written('VStack {\n            Text("A")\n        }', { section: 'layout', padding: evenInsets(20) }, 'VStack'))
      .toBe('        VStack {\n            Text("A")\n        }\n        .padding(20)')
  })

  it('keeps a shape’s own fill and an image’s own calls first, where only they apply', () => {
    // A shape fills its whole frame, so the space around it is its margin (Layout), after its own fill.
    expect(written('Circle().fill(Color.red)', { section: 'layout', margin: evenInsets(8) }, 'Circle')).toBe('        Circle().fill(Color.red).padding(8)')
    expect(written('Image("photo").resizable().scaledToFit()', { section: 'layout', padding: evenInsets(8) }, 'Image')).toBe('        Image("photo").resizable().scaledToFit().padding(8)')
    expect(bodyOf(setLayer(project(screen('        Capsule().stroke(Color.blue, lineWidth: 2)')), 'Capsule', [{ section: 'effects', opacity: 0.5 }]))).toBe('        Capsule().stroke(Color.blue, lineWidth: 2).opacity(0.5)')
  })

  it('adds a margin just outside the fill, before the shadow’s neighbours', () => {
    expect(written('Text("A").background(Color.blue).shadow(radius: 4).opacity(0.5)', { section: 'layout', margin: evenInsets(8) }))
      .toBe('        Text("A").background(Color.blue).shadow(radius: 4).padding(8).opacity(0.5)')
  })

  it('keeps a token where the panel read one, and writes a token it is given', () => {
    const tokens = '\nenum Layout {\n    static let gap: CGFloat = 12\n}\n'
    const files = project(screen('        Text("A").padding(Layout.gap).background(Color.blue)', tokens))
    expect(layerOf(files, 'Text').layout.padding).toMatchObject({ value: evenInsets({ token: 'Layout.gap' }), state: 'token' })
    expect(bodyOf(setLayer(files, 'Text', [{ section: 'layout', padding: { ...evenInsets({ token: 'Layout.gap' }), top: 0, bottom: 0 } }])))
      .toBe('        Text("A").padding(.horizontal, Layout.gap).background(Color.blue)')
  })
})

describe('what the panel leaves to Code', () => {
  it.each([
    ['padding written in two places', 'Text("A").padding(8).frame(width: 100).padding(4).background(Color.blue)', /more than one place/],
    ['a comment inside the padding', 'Text("A").padding(.horizontal, 8) /* wide */ .padding(.vertical, 4)', /comment/],
    ['a padding worked out at run time', 'Text("A").padding(size * 2)', /worked out in Swift/],
    ['an Edge.Set only the project knows', 'Text("A").padding(.sides, 8)', /worked out in Swift/],
  ])('shows %s and refuses to change it', (_, body, reason) => {
    const declarations = '\nlet size: CGFloat = 4\nextension Edge.Set {\n    static let sides: Edge.Set = [.leading, .trailing]\n}\n'
    const files = project(screen(`        ${body}`, declarations))
    const padding = layerOf(files, 'Text').layout.padding
    expect(padding.state).toBe('code')
    expect(padding.disabledReason).toMatch(reason)
    expect(() => setLayer(files, 'Text', [{ section: 'layout', padding: evenInsets(2) }])).toThrow(reason)
  })

  it('places nothing new in a chain with a modifier it does not know, but edits what is there', () => {
    const files = project(screen('        Text("A").padding(8).glow()', '\nextension View {\n    func glow() -> some View { shadow(radius: 2) }\n}\n'))
    expect(layerOf(files, 'Text').locked).toMatch(/does not know/)
    expect(bodyOf(setLayer(files, 'Text', [{ section: 'layout', padding: evenInsets(4) }]))).toBe('        Text("A").padding(4).glow()')
  })
})

describe.skipIf(!XCODE)('what the layout writer writes builds in Xcode 27', () => {
  it('for every padding and margin form', () => {
    const tokens = '\nenum Layout {\n    static let gap: CGFloat = 12\n}\n'
    const sources = [
      evenInsets(12), { top: 8, leading: 16, bottom: 8, trailing: 16 }, { top: 0, leading: 16, bottom: 0, trailing: 16 },
      { top: 8, leading: 0, bottom: 0, trailing: 0 }, { top: 1, leading: 2, bottom: 3, trailing: 4 }, evenInsets({ token: 'Layout.gap' }),
      { top: 0, leading: { token: 'Layout.gap' }, bottom: 0, trailing: { token: 'Layout.gap' } },
    ].flatMap(insets => [
      text(setLayer(project(screen('        Text("A")\n            .background(Color.blue)', tokens)), 'Text', [{ section: 'layout', padding: insets }])),
      text(setLayer(project(screen('        Text("A")\n            .background(Color.blue)', tokens)), 'Text', [{ section: 'layout', margin: insets }])),
    ])
    typecheckInXcode(sources)
    expect(sources).toHaveLength(14)
  }, 300_000)
})
