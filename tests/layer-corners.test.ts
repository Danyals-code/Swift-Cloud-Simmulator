import { beforeEach, describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { CornersValue, LayerProperties, RenderNode } from '@studio/shared'
import { XCODE, bodyOf, layerOf, planLayer, project, screen, setLayer, text, typecheckInXcode } from './helpers/layer-project'

/**
 * A view's Corners (doc 18, Wave 2): the shape the layer is drawn in, read from a shape
 * view itself or from the clip, the old `.cornerRadius` and the shape a background or
 * glass is drawn `in:`, and written back in place, in the spelling it had, for the
 * project's iOS version.
 */
beforeEach(resetPipelineState)

const TOKENS = `
let isOn = true
enum Layout {
    static let radius: CGFloat = 12
}
`

const files = (body: string) => project(screen(`        ${body}`, TOKENS))
const cornersOf = (body: string, name = 'Text', target?: string): NonNullable<LayerProperties['corners']> => {
  const corners = layerOf(files(body), name, 0, target).corners
  if (!corners) throw new Error(`${name} has no corners section`)
  return corners
}
const written = (body: string, corners: CornersValue, name = 'Text', target?: string) => bodyOf(setLayer(files(body), name, [{ section: 'corners', corners }], 0, target))
const refusal = (body: string, corners: CornersValue, name = 'Text', target?: string) => {
  const plan = planLayer(files(body), name, [{ section: 'corners', corners }], 0, target)
  return plan.ok ? 'written' : plan.reason
}
const rounded = (radius: CornersValue['radius'], continuous = true): CornersValue => ({ shape: 'rounded', radius, continuous })

describe('reading the corners', () => {
  it.each([
    ['a clip to a rounded rectangle', 'Text("A").padding(8).background(.red).clipShape(.rect(cornerRadius: 12))', rounded(12)],
    ['a clip to a RoundedRectangle', 'Text("A").clipShape(RoundedRectangle(cornerRadius: 12))', rounded(12)],
    ['circular corners', 'Text("A").clipShape(RoundedRectangle(cornerRadius: 12, style: .circular))', rounded(12, false)],
    ['continuous corners written out', 'Text("A").clipShape(.rect(cornerRadius: 12, style: .continuous))', rounded(12)],
    ['a capsule', 'Text("A").clipShape(.capsule)', { shape: 'capsule', continuous: true }],
    ['a Capsule', 'Text("A").clipShape(Capsule())', { shape: 'capsule', continuous: true }],
    ['a circle', 'Text("A").clipShape(Circle())', { shape: 'circle' }],
    ['a rectangle', 'Text("A").clipShape(.rect)', { shape: 'rect' }],
    ['each corner', 'Text("A").clipShape(.rect(topLeadingRadius: 20, bottomTrailingRadius: 8))', { shape: 'uneven', radii: { topLeading: 20, topTrailing: 0, bottomTrailing: 8, bottomLeading: 0 }, continuous: true }],
    ['each corner of an UnevenRoundedRectangle', 'Text("A").clipShape(UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 3, bottomTrailingRadius: 2, topTrailingRadius: 1))', { shape: 'uneven', radii: { topLeading: 4, topTrailing: 1, bottomTrailing: 2, bottomLeading: 3 }, continuous: true }],
    ['the old corner radius', 'Text("A").background(.red).cornerRadius(8)', rounded(8)],
    ['the shape a background is drawn in', 'Text("A").background(.red, in: .rect(cornerRadius: 16))', rounded(16)],
    ['the shape glass is drawn in', 'Text("A").glassEffect(.regular, in: RoundedRectangle(cornerRadius: 16))', rounded(16)],
    ['glass with no shape of its own, a capsule', 'Text("A").glassEffect()', { shape: 'capsule', continuous: true }],
  ])('reads %s', (_, body, corners) => {
    expect(cornersOf(body)).toMatchObject({ value: corners, state: 'literal' })
  })

  it.each([
    ['RoundedRectangle', 'RoundedRectangle(cornerRadius: 10).fill(.red)', rounded(10)],
    ['Capsule', 'Capsule(style: .circular).fill(.red)', { shape: 'capsule', continuous: false }],
    ['Circle', 'Circle().fill(.red)', { shape: 'circle' }],
    ['Rectangle', 'Rectangle().fill(.red)', { shape: 'rect' }],
  ])('reads a %s as its own shape', (name, body, corners) => {
    expect(cornersOf(body, name)).toMatchObject({ value: corners, state: 'literal' })
  })

  it('reads square corners when nothing shapes the layer', () => {
    expect(cornersOf('Text("A").padding(8).background(.red)')).toMatchObject({ value: { shape: 'rect' }, state: 'absent' })
  })

  it('keeps a token linked', () => {
    expect(cornersOf('Text("A").clipShape(.rect(cornerRadius: Layout.radius))')).toMatchObject({ value: rounded({ token: 'Layout.radius' }), state: 'token' })
  })

  it('claims the clip it read for the Corners section, and leaves the background to Fill', () => {
    const layer = layerOf(files('Text("A").background(.red, in: .rect(cornerRadius: 8)).clipShape(.rect(cornerRadius: 8))'), 'Text')
    expect(layer.corners?.from).toHaveLength(2)
    expect(Object.values(layer.claimed).sort()).toEqual(['corners', 'fill'])
  })
})

describe('what the Corners section leaves to Code', () => {
  it.each([
    ['corners written two ways', 'Text("A").background(.red, in: .rect(cornerRadius: 8)).clipShape(.rect(cornerRadius: 12))', /more than one place/],
    ['a radius worked out in Swift', 'Text("A").clipShape(.rect(cornerRadius: isOn ? 8 : 0))', /worked out in Swift/],
    ['a shape the panel does not know', 'Text("A").clipShape(.rect(cornerRadii: RectangleCornerRadii(topLeading: 4)))', /can’t show/],
    ['an ellipse', 'Text("A").clipShape(Ellipse())', /ellipse/],
    ['a comment in the clip', 'Text("A").clipShape(/* soft */ .rect(cornerRadius: 8))', /comment/],
    ['a button’s own border shape', 'Button("Go") { }.buttonStyle(.bordered).buttonBorderShape(.capsule)', /button style/],
  ])('shows %s and refuses to change it', (_, body, reason) => {
    const name = body.startsWith('Button') ? 'Button' : 'Text'
    const corners = cornersOf(body, name)
    expect(corners.state).toBe('code')
    expect(corners.disabledReason).toMatch(reason)
    expect(refusal(body, rounded(4), name)).toMatch(reason)
  })
})

describe('writing the corners', () => {
  it.each([
    ['a clip after the fill, inside the margin', 'Text("A").padding(8).background(.red).padding(4)', rounded(12), 'Text("A").padding(8).background(.red).clipShape(.rect(cornerRadius: 12)).padding(4)'],
    ['a clip before the shadow and the effects', 'Text("A").padding(8).background(.red).shadow(radius: 2).opacity(0.5)', rounded(12), 'Text("A").padding(8).background(.red).clipShape(.rect(cornerRadius: 12)).shadow(radius: 2).opacity(0.5)'],
    ['a capsule', 'Text("A").padding(8).background(.red)', { shape: 'capsule' }, 'Text("A").padding(8).background(.red).clipShape(.capsule)'],
    ['a circle', 'Text("A").padding(8).background(.red)', { shape: 'circle' }, 'Text("A").padding(8).background(.red).clipShape(.circle)'],
    ['circular corners, which are not the default', 'Text("A").background(.red)', rounded(12, false), 'Text("A").background(.red).clipShape(.rect(cornerRadius: 12, style: .circular))'],
    ['each corner, in the order SwiftUI declares them', 'Text("A").background(.red)', { shape: 'uneven', radii: { topLeading: 20, topTrailing: 4, bottomTrailing: 0, bottomLeading: 8 } }, 'Text("A").background(.red).clipShape(.rect(topLeadingRadius: 20, bottomLeadingRadius: 8, topTrailingRadius: 4))'],
    ['four equal corners as one radius', 'Text("A").background(.red)', { shape: 'uneven', radii: { topLeading: 6, topTrailing: 6, bottomTrailing: 6, bottomLeading: 6 } }, 'Text("A").background(.red).clipShape(.rect(cornerRadius: 6))'],
    ['a token, as written', 'Text("A").background(.red)', rounded({ token: 'Layout.radius' }), 'Text("A").background(.red).clipShape(.rect(cornerRadius: Layout.radius))'],
  ])('adds %s', (_, body, corners, expected) => {
    expect(written(body, corners as CornersValue)).toBe(`        ${expected}`)
  })

  it('adds a clip after an Image’s own calls', () => {
    expect(written('Image("logo").resizable()', rounded(8), 'Image')).toBe('        Image("logo").resizable().clipShape(.rect(cornerRadius: 8))')
  })

  it('writes on a line of its own where the chain has them', () => {
    expect(written('Text("A")\n            .padding(8)\n            .background(.red)', rounded(12)))
      .toBe('        Text("A")\n            .padding(8)\n            .background(.red)\n            .clipShape(.rect(cornerRadius: 12))')
  })

  it.each([
    ['a clip, as a member', 'Text("A").clipShape(.rect(cornerRadius: 8))', { shape: 'capsule' }, 'Text("A").clipShape(.capsule)'],
    ['a clip, as a type', 'Text("A").clipShape(RoundedRectangle(cornerRadius: 8))', rounded(20), 'Text("A").clipShape(RoundedRectangle(cornerRadius: 20))'],
    ['a clip to a Capsule, as a type', 'Text("A").clipShape(Capsule())', rounded(8), 'Text("A").clipShape(RoundedRectangle(cornerRadius: 8))'],
    ['the shape a background is drawn in', 'Text("A").background(.red, in: .rect(cornerRadius: 8))', { shape: 'capsule' }, 'Text("A").background(.red, in: .capsule)'],
    ['the shape glass is drawn in', 'Text("A").glassEffect(.regular, in: .rect(cornerRadius: 8))', rounded(16), 'Text("A").glassEffect(.regular, in: .rect(cornerRadius: 16))'],
    ['glass with its own capsule', 'Text("A").glassEffect(.regular)', rounded(16), 'Text("A").glassEffect(.regular, in: .rect(cornerRadius: 16))'],
    ['plain glass', 'Text("A").glassEffect()', rounded(16), 'Text("A").glassEffect(in: .rect(cornerRadius: 16))'],
    ['the old corner radius, as a clip', 'Text("A").background(.red).cornerRadius(8)', rounded(12), 'Text("A").background(.red).clipShape(.rect(cornerRadius: 12))'],
    ['a background and its clip together', 'Text("A").background(.red, in: .rect(cornerRadius: 8)).clipShape(.rect(cornerRadius: 8))', rounded(4), 'Text("A").background(.red, in: .rect(cornerRadius: 4)).clipShape(.rect(cornerRadius: 4))'],
    ['a shape view drawn as the background', 'Text("A").background(RoundedRectangle(cornerRadius: 8).fill(.white))', { shape: 'capsule' }, 'Text("A").background(Capsule().fill(.white))'],
    ['a linked radius, only when it is replaced', 'Text("A").clipShape(.rect(cornerRadius: Layout.radius))', rounded({ token: 'Layout.radius' }, false), 'Text("A").clipShape(.rect(cornerRadius: Layout.radius, style: .circular))'],
    ['a square clip, kept', 'Text("A").clipShape(.rect(cornerRadius: 8))', { shape: 'rect' }, 'Text("A").clipShape(.rect)'],
  ])('rewrites %s in place', (_, body, corners, expected) => {
    expect(written(body, corners as CornersValue)).toBe(`        ${expected}`)
  })

  it.each([
    ['RoundedRectangle', 'RoundedRectangle(cornerRadius: 8)\n            .fill(.red)\n            .strokeBorder(.blue, lineWidth: 2)', { shape: 'capsule' }, 'Capsule()\n            .fill(.red)\n            .strokeBorder(.blue, lineWidth: 2)'],
    ['Rectangle', 'Rectangle().fill(.red).frame(width: 40, height: 40)', rounded(8), 'RoundedRectangle(cornerRadius: 8).fill(.red).frame(width: 40, height: 40)'],
    ['Circle', 'Circle().fill(.red)', { shape: 'uneven', radii: { topLeading: 8, topTrailing: 8, bottomTrailing: 0, bottomLeading: 0 } }, 'UnevenRoundedRectangle(topLeadingRadius: 8, topTrailingRadius: 8).fill(.red)'],
  ])('turns a %s into another shape, keeping its fill and stroke', (name, body, corners, expected) => {
    expect(written(body, corners as CornersValue, name)).toBe(`        ${expected}`)
  })

  it('writes nothing when the shape is unchanged, however it was spelled', () => {
    expect(planLayer(files('Text("A").clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))'), 'Text', [{ section: 'corners', corners: rounded(12) }])).toMatchObject({ ok: true, changes: [] })
    expect(planLayer(files('Text("A").background(.red)'), 'Text', [{ section: 'corners', corners: { shape: 'rect' } }])).toMatchObject({ ok: true, changes: [] })
  })

  it('places nothing new in a chain with a modifier it does not know, but changes the corners that are there', () => {
    const declarations = '\nextension View {\n    func glow() -> some View { shadow(radius: 2) }\n}\n'
    const chain = (body: string) => project(screen(`        ${body}`, declarations))
    expect(planLayer(chain('Text("A").glow()'), 'Text', [{ section: 'corners', corners: rounded(8) }])).toMatchObject({ ok: false, reason: expect.stringMatching(/does not know/) })
    expect(bodyOf(setLayer(chain('Text("A").clipShape(.capsule).glow()'), 'Text', [{ section: 'corners', corners: rounded(8) }]))).toBe('        Text("A").clipShape(.rect(cornerRadius: 8)).glow()')
  })

  it.each([
    ['a negative radius', rounded(-2), undefined, /0 or more/],
    ['a token that is no token', rounded({ token: '8); fatalError(' }), undefined, /0 or more/],
    ['three corners', { shape: 'uneven', radii: { topLeading: 1, topTrailing: 2, bottomTrailing: 3 } }, undefined, /four corners/],
  ])('refuses %s', (_, corners, target, reason) => {
    expect(refusal('Text("A").background(.red)', corners as CornersValue, 'Text', target)).toMatch(reason)
  })
})

describe('the deployment target', () => {
  it('writes the shape types before iOS 17', () => {
    expect(written('Text("A").background(.red)', rounded(12), 'Text', '16.0')).toBe('        Text("A").background(.red).clipShape(RoundedRectangle(cornerRadius: 12))')
    expect(written('Text("A").background(.red)', { shape: 'capsule', continuous: false }, 'Text', '16.0')).toBe('        Text("A").background(.red).clipShape(Capsule(style: .circular))')
    expect(written('Text("A").background(.red)', { shape: 'uneven', radii: { topLeading: 8, topTrailing: 8, bottomTrailing: 0, bottomLeading: 0 } }, 'Text', '16.0')).toBe('        Text("A").background(.red).clipShape(UnevenRoundedRectangle(topLeadingRadius: 8, topTrailingRadius: 8))')
    expect(written('Text("A").background(.red).cornerRadius(4)', { shape: 'circle' }, 'Text', '15.0')).toBe('        Text("A").background(.red).clipShape(Circle())')
  })

  it('refuses corners with different radii before iOS 16', () => {
    expect(refusal('Text("A").background(.red)', { shape: 'uneven', radii: { topLeading: 8, topTrailing: 8, bottomTrailing: 0, bottomLeading: 0 } }, 'Text', '15.0')).toMatch(/iOS 16/)
  })
})

describe('a border follows the corners (D8)', () => {
  const BORDER = (shape: string) => `\n            .overlay {\n                ${shape}\n                    .strokeBorder(Color.gray, lineWidth: 1)\n            }`
  const CARD = 'Text("A")\n            .padding(8)\n            .background(.red)'

  it('takes the new corners in the same step', () => {
    expect(written(`${CARD}\n            .clipShape(.rect(cornerRadius: 8))${BORDER('RoundedRectangle(cornerRadius: 8)')}`, { shape: 'capsule' }))
      .toBe(`        ${CARD}\n            .clipShape(.capsule)${BORDER('Capsule()')}`)
  })

  it('rounds with a square view’s border when its corners are added', () => {
    expect(written(`${CARD}${BORDER('Rectangle()')}`, rounded(12)))
      .toBe(`        ${CARD}\n            .clipShape(.rect(cornerRadius: 12))${BORDER('RoundedRectangle(cornerRadius: 12)')}`)
  })

  it('follows a shape view turned into another shape', () => {
    expect(written(`Circle()\n            .fill(.red)${BORDER('Circle()')}`, rounded(10), 'Circle'))
      .toBe(`        RoundedRectangle(cornerRadius: 10)\n            .fill(.red)${BORDER('RoundedRectangle(cornerRadius: 10)')}`)
  })
})

describe('the preview draws what the Corners section writes', () => {
  /** The render tree after one corners change, compiled the way the canvas compiles it. */
  const drawn = (body: string, corners: CornersValue, name = 'Text', target?: string): readonly RenderNode[] => {
    const changed = setLayer(files(body), name, [{ section: 'corners', corners }], 0, target)
    const result = compile({ files: changed.map(file => ({ id: file.id, text: file.text })), revision: 1, canvas: { width: 393, height: 852 }, colorScheme: 'light', safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } })
    expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
    return result.renderTree!.nodes
  }
  const clip = (nodes: readonly RenderNode[]) => nodes.find(node => node.clipShape)?.clipShape

  it('continuous corners by default, and circular ones when asked', () => {
    expect(clip(drawn('Text("A").padding(8).background(.red)', rounded(12)))).toMatchObject({ kind: 'roundedRectangle', cornerStyle: 'continuous' })
    expect(clip(drawn('Text("A").padding(8).background(.red)', rounded(12, false)))).toMatchObject({ kind: 'roundedRectangle', cornerStyle: 'circular' })
  })

  it('each corner its own radius, before iOS 17 too', () => {
    const radii = { topLeading: 20, topTrailing: 4, bottomTrailing: 0, bottomLeading: 8 }
    for (const target of [undefined, '16.0']) expect(clip(drawn('Text("A").padding(8).background(.red)', { shape: 'uneven', radii }, 'Text', target))?.cornerRadii).toEqual(radii)
  })

  it('a shape view turned into a capsule', () => {
    expect(drawn('RoundedRectangle(cornerRadius: 4).fill(.red).frame(width: 80, height: 40)', { shape: 'capsule' }, 'RoundedRectangle').find(node => node.shape)?.shape).toMatchObject({ shape: 'capsule' })
  })
})

describe.skipIf(!XCODE)('what the Corners section writes builds in Xcode 27', () => {
  /** The whole file after one corners change, at the iOS version given, which the type-check reads from its first line. */
  const source = (body: string, corners: CornersValue, name = 'Text', target = '27.0') =>
    text(setLayer(project(`// target: iOS ${target}\n` + screen(`        ${body}`, TOKENS)), name, [{ section: 'corners', corners }], 0, target))
  const uneven: CornersValue = { shape: 'uneven', radii: { topLeading: 20, topTrailing: 4, bottomTrailing: 0, bottomLeading: 8 } }
  const shapes: readonly CornersValue[] = [rounded(12), rounded(12, false), rounded({ token: 'Layout.radius' }), { shape: 'capsule' }, { shape: 'capsule', continuous: false }, { shape: 'circle' }, uneven, { ...uneven, continuous: false }]

  it('for every shape, in every place and spelling, at every target that writes differently', () => {
    const sources = [
      ...shapes.map(corners => source('Text("A").padding(8).background(.red)', corners)),
      ...shapes.map(corners => source('Text("A").padding(8).background(.red)', corners, 'Text', '16.0')),
      ...shapes.filter(corners => corners.shape !== 'uneven').map(corners => source('Text("A").padding(8).background(.red)', corners, 'Text', '15.0')),
      ...shapes.map(corners => source('Text("A").clipShape(RoundedRectangle(cornerRadius: 8))', corners, 'Text', '17.0')),
      source('Text("A").clipShape(.rect)', { shape: 'rect' }, 'Text', '17.0'),
      source('Text("A").background(.red, in: .rect(cornerRadius: 8))', { shape: 'capsule' }),
      source('Text("A").background(.red, in: RoundedRectangle(cornerRadius: 8))', uneven, 'Text', '16.0'),
      source('Text("A").background(RoundedRectangle(cornerRadius: 8).fill(.white))', uneven, 'Text', '16.0'),
      source('Text("A").glassEffect()', rounded(16), 'Text', '26.0'),
      source('Text("A").glassEffect(.clear)', uneven, 'Text', '26.0'),
      source('Text("A").background(.red).cornerRadius(8)', rounded(12), 'Text', '15.0'),
      source('Image(systemName: "star").resizable()', rounded(8), 'Image'),
      ...shapes.map(corners => source('Circle()\n            .fill(.red)\n            .frame(width: 40, height: 40)', corners, 'Circle', '16.0')),
      source('RoundedRectangle(cornerRadius: 8)\n            .fill(.red)\n            .strokeBorder(.blue, lineWidth: 2)', { shape: 'capsule' }, 'RoundedRectangle', '17.0'),
      source('Text("A")\n            .padding(8)\n            .background(.red)\n            .clipShape(.rect(cornerRadius: 8))\n            .overlay {\n                RoundedRectangle(cornerRadius: 8)\n                    .strokeBorder(Color.gray, lineWidth: 1)\n            }', uneven, 'Text', '17.0'),
    ]
    typecheckInXcode(sources)
    expect(sources).toHaveLength(48)
  }, 600_000)
})
