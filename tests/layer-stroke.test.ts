import { beforeEach, describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { LayerProperties, RenderNode, StrokeValue } from '@studio/shared'
import { XCODE, bodyOf, layerOf, planLayer, project, screen, setLayer, text, typecheckInXcode } from './helpers/layer-project'

/**
 * A view's Stroke (doc 18, Wave 2): on a view, the border Wave 1 writes, an overlay of the
 * view's own shape inside, on or outside its edge (D8); on a shape, its own `.stroke` or
 * `.strokeBorder`. Read as one colour, width, position and dash however it is spelled,
 * and written back as the plainest Swift for the project's iOS version.
 */
beforeEach(resetPipelineState)

const TOKENS = `
let isOn = true
enum Theme {
    static let line = Color.gray
}
enum Layout {
    static let hairline: CGFloat = 0.5
}
`

const files = (body: string) => project(screen(`        ${body}`, TOKENS))
const strokeOf = (body: string, name = 'Text', target?: string): NonNullable<LayerProperties['stroke']> => {
  const stroke = layerOf(files(body), name, 0, target).stroke
  if (!stroke) throw new Error(`${name} has no stroke section`)
  return stroke
}
const written = (body: string, stroke: StrokeValue | null, name = 'Text', target?: string) => bodyOf(setLayer(files(body), name, [{ section: 'stroke', stroke }], 0, target))
const refusal = (body: string, stroke: StrokeValue | null, name = 'Text', target?: string) => {
  const plan = planLayer(files(body), name, [{ section: 'stroke', stroke }], 0, target)
  return plan.ok ? 'written' : plan.reason
}
const line = (width: StrokeValue['width'], position: StrokeValue['position'] = 'inside', color: StrokeValue['color'] = { name: 'gray' }, dash?: number[]): StrokeValue => ({ color, width, position, ...dash ? { dash } : {} })

const CARD = 'Text("A")\n            .padding(8)\n            .background(.red)\n            .clipShape(.rect(cornerRadius: 12))'
/** A border overlay as Wave 1 writes it, under the card's modifiers. */
const border = (shape: string, stroke: string, after = '') => `\n            .overlay {\n                ${shape}\n                    ${stroke}\n${after}            }`

describe('reading a border', () => {
  it.each([
    ['inside the edge', border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(Color.gray, lineWidth: 1)'), line(1)],
    ['on the edge', border('RoundedRectangle(cornerRadius: 12)', '.stroke(.red, lineWidth: 2)'), line(2, 'center', { name: 'red' })],
    ['outside the edge', border('RoundedRectangle(cornerRadius: 13)', '.strokeBorder(Color.gray, lineWidth: 1)', '                    .padding(-1)\n'), line(1, 'outside')],
    ['dashed', border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(Color.gray, style: StrokeStyle(lineWidth: 2, dash: [4, 2]))'), line(2, 'inside', { name: 'gray' }, [4, 2])],
    ['on one line, with an opacity', '\n            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray.opacity(0.3), lineWidth: 2))', line(2, 'center', { name: 'gray', opacity: 0.3 })],
  ])('reads one drawn %s', (_, overlay, stroke) => {
    expect(strokeOf(`${CARD}${overlay}`)).toMatchObject({ value: stroke, state: 'literal' })
  })

  it('reads the old square border as a border inside the edge', () => {
    expect(strokeOf('Text("A").padding(8).border(Color.red, width: 2)')).toMatchObject({ value: line(2, 'inside', { name: 'red' }), state: 'literal' })
  })

  it('keeps a colour token linked', () => {
    expect(strokeOf(`${CARD}${border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(Theme.line, lineWidth: 1)')}`)).toMatchObject({ value: line(1, 'inside', { token: 'Theme.line' }), state: 'token' })
  })

  it('has no stroke when nothing draws one, and claims the border it read', () => {
    expect(strokeOf(CARD)).toMatchObject({ value: null, state: 'absent' })
    const layer = layerOf(files(`${CARD}${border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(Color.gray, lineWidth: 1)')}`), 'Text')
    expect(layer.stroke?.from).toHaveLength(1)
    expect(layer.claimed[layer.stroke!.from![0]!]).toBe('stroke')
  })
})

describe('reading a shape’s own stroke', () => {
  it.each([
    ['on the edge', 'Circle', 'Circle().stroke(.blue, lineWidth: 4)', line(4, 'center', { name: 'blue' }), 'literal'],
    ['inside it', 'Capsule', 'Capsule().fill(.white).strokeBorder(Color.red, lineWidth: 2)', line(2, 'inside', { name: 'red' }), 'literal'],
    ['dashed', 'Circle', 'Circle().stroke(.blue, style: StrokeStyle(lineWidth: 2, dash: [5]))', line(2, 'center', { name: 'blue' }, [5]), 'literal'],
    ['with tokens', 'Capsule', 'Capsule().strokeBorder(Theme.line, lineWidth: Layout.hairline)', line({ token: 'Layout.hairline' }, 'inside', { token: 'Theme.line' }), 'token'],
    ['one point wide when no width is written', 'Circle', 'Circle().stroke(.blue)', line(1, 'center', { name: 'blue' }), 'literal'],
  ])('reads one %s', (_, name, body, stroke, state) => {
    expect(strokeOf(body, name)).toMatchObject({ value: stroke, state })
  })
})

describe('a stroke with no colour written, drawn in the foreground style (Wave 3b)', () => {
  const foreground = (width: StrokeValue['width'], position: StrokeValue['position']): StrokeValue => ({ color: null, width, position })

  it.each([
    ['a border with nothing in its stroke', 'Text', `${CARD}\n            .overlay(RoundedRectangle(cornerRadius: 12).stroke())`, foreground(1, 'center')],
    ['a border with only its width', 'Text', `${CARD}${border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(lineWidth: 2)')}`, foreground(2, 'inside')],
    ['a shape’s own stroke', 'Circle', 'Circle().stroke(lineWidth: 2)', foreground(2, 'center')],
    ['a shape’s own stroke coloured by a style after it', 'Circle', 'Circle().stroke(lineWidth: 2).foregroundStyle(.red)', foreground(2, 'center')],
  ])('reads %s, its colour the foreground', (_, name, body, stroke) => {
    expect(strokeOf(body, name)).toMatchObject({ value: stroke, state: 'literal' })
  })

  it('keeps the colour left out while the width or position changes, and writes one chosen', () => {
    const body = `${CARD}\n            .overlay(RoundedRectangle(cornerRadius: 12).stroke())`
    expect(written(body, foreground(3, 'center'))).toBe(`        ${CARD}\n            .overlay(RoundedRectangle(cornerRadius: 12).stroke(lineWidth: 3))`)
    expect(written(body, foreground(1, 'inside'))).toBe(`        ${CARD}\n            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(lineWidth: 1))`)
    expect(written(body, line(1, 'center', { name: 'red' }))).toBe(`        ${CARD}\n            .overlay(RoundedRectangle(cornerRadius: 12).stroke(.red, lineWidth: 1))`)
    expect(written('Circle().stroke(lineWidth: 2)', foreground(2, 'center', ), 'Circle')).toBe('        Circle().stroke(lineWidth: 2)')
    expect(written('Circle().stroke(lineWidth: 2)', { ...foreground(2, 'center'), dash: [4] }, 'Circle')).toBe('        Circle().stroke(style: StrokeStyle(lineWidth: 2, dash: [4]))')
  })

  it.skipIf(!XCODE)('builds in Xcode 27, each form it writes with no colour', () => {
    const body = `${CARD}\n            .overlay(RoundedRectangle(cornerRadius: 12).stroke())`
    const sources = [
      text(setLayer(files(body), 'Text', [{ section: 'stroke', stroke: foreground(3, 'center') }])),
      text(setLayer(files(body), 'Text', [{ section: 'stroke', stroke: foreground(1, 'inside') }])),
      text(setLayer(files(body), 'Text', [{ section: 'stroke', stroke: foreground(2, 'outside') }])),
      text(setLayer(files(body), 'Text', [{ section: 'stroke', stroke: { ...foreground(1, 'inside'), dash: [4, 2] } }])),
      text(setLayer(files('Circle().stroke(lineWidth: 2)'), 'Circle', [{ section: 'stroke', stroke: { ...foreground(2, 'center'), dash: [4] } }])),
      text(setLayer(files('Capsule().strokeBorder(lineWidth: 2)'), 'Capsule', [{ section: 'stroke', stroke: foreground(3, 'inside') }])),
    ]
    typecheckInXcode(sources)
    expect(sources).toHaveLength(6)
  }, 600_000)

  it('shows one around a shape that isn’t the view’s, rather than no stroke', () => {
    const stroke = strokeOf('Text("A").padding(8).overlay(RoundedRectangle(cornerRadius: 8).stroke())')
    expect(stroke).toMatchObject({ state: 'code', value: foreground(1, 'center') })
    expect(stroke.disabledReason).toMatch(/isn’t this view’s shape/)
  })
})

describe('a border overlay the panel can’t read is still the view’s stroke (Wave 3b)', () => {
  it.each([
    ['a width a condition chooses', `${CARD}\n            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.gray, lineWidth: isOn ? 2 : 1))`],
    ['a width worked out in Swift', `${CARD}\n            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.gray, lineWidth: Layout.hairline * 2))`],
  ])('shows %s as Code, with why, and claims it', (_, body) => {
    const layer = layerOf(files(body), 'Text'), stroke = layer.stroke!
    expect(stroke.state).toBe('code')
    expect(stroke.disabledReason).toMatch(/Change it in Code/)
    expect(layer.claimed[stroke.from![0]!]).toBe('stroke')
  })
})

describe('what the Stroke section leaves to Code', () => {
  it.each([
    ['a colour worked out in Swift', 'Circle', 'Circle().stroke(isOn ? Color.red : Color.blue, lineWidth: 2)', /worked out in Swift/],
    ['a stroke style the panel does not show', 'Circle', 'Circle().stroke(.red, style: StrokeStyle(lineWidth: 2, lineCap: .round))', /can’t show/],
    ['a comment in the stroke', 'Circle', 'Circle().stroke(/* brand */ .red, lineWidth: 2)', /comment/],
    ['a stroke written twice', 'Circle', `Circle().stroke(.red, lineWidth: 2)${border('Circle()', '.strokeBorder(Color.gray, lineWidth: 1)')}`, /more than one place/],
  ])('shows %s and refuses to change it', (_, name, body, reason) => {
    const stroke = strokeOf(body, name)
    expect(stroke.state).toBe('code')
    expect(stroke.disabledReason).toMatch(reason)
    expect(refusal(body, line(3), name)).toMatch(reason)
  })
})

describe('adding a border to a view', () => {
  it('draws it inside the edge with the view’s own corners, on lines of their own', () => {
    expect(written(CARD, line(1))).toBe(`        ${CARD}${border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(.gray, lineWidth: 1)')}`)
  })

  it('goes before the shadow and inside the margin', () => {
    expect(written('Text("A").padding(8).background(.red).shadow(radius: 2).padding(4)', line(2, 'center', { name: 'blue' })))
      .toBe('        Text("A").padding(8).background(.red).overlay(Rectangle().stroke(.blue, lineWidth: 2)).shadow(radius: 2).padding(4)')
  })

  it('draws it outside the edge, on a shape as much larger as the line is wide', () => {
    expect(written(CARD, line(2, 'outside'))).toBe(`        ${CARD}${border('RoundedRectangle(cornerRadius: 14)', '.strokeBorder(.gray, lineWidth: 2)', '                    .padding(-2)\n')}`)
  })

  it('draws a dash', () => {
    expect(written(CARD, line(2, 'inside', { name: 'gray' }, [4, 2]))).toBe(`        ${CARD}${border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(.gray, style: StrokeStyle(lineWidth: 2, dash: [4, 2]))')}`)
  })

  it('writes it as the overlay’s argument, with Color, before iOS 15', () => {
    expect(written('Text("A")\n            .padding(8)\n            .background(Color.red)', line(1), 'Text', '14.0'))
      .toBe('        Text("A")\n            .padding(8)\n            .background(Color.red)\n            .overlay(Rectangle().strokeBorder(Color.gray, lineWidth: 1))')
  })

  it('follows the capsule that glass is drawn in', () => {
    expect(written('Text("A").padding(8).glassEffect()', line(1), 'Text', '26.0')).toBe('        Text("A").padding(8).glassEffect().overlay(Capsule().strokeBorder(.gray, lineWidth: 1))')
  })

  it('refuses a token for a border’s width', () => {
    expect(refusal(CARD, line({ token: 'Layout.hairline' }))).toMatch(/number of points/)
  })
})

describe('changing a border', () => {
  const BORDERED = `${CARD}${border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(Color.gray.opacity(0.3), lineWidth: 1)')}`

  it('keeps a colour it did not change as it was written', () => {
    expect(written(BORDERED, line(3, 'inside', { name: 'gray', opacity: 0.3 }))).toBe(`        ${BORDERED.replace('lineWidth: 1', 'lineWidth: 3')}`)
  })

  it('moves it on the edge and outside it', () => {
    expect(written(BORDERED, line(1, 'center', { name: 'red' }))).toBe(`        ${CARD}${border('RoundedRectangle(cornerRadius: 12)', '.stroke(.red, lineWidth: 1)')}`)
    expect(written(BORDERED, line(1, 'outside', { name: 'gray', opacity: 0.3 }))).toBe(`        ${CARD}${border('RoundedRectangle(cornerRadius: 13)', '.strokeBorder(Color.gray.opacity(0.3), lineWidth: 1)', '                    .padding(-1)\n')}`)
  })

  it('turns the old square border into one that follows the corners', () => {
    expect(written('Text("A").padding(8).clipShape(.capsule).border(Color.red, width: 2)', line(2, 'center', { name: 'red' })))
      .toBe('        Text("A").padding(8).clipShape(.capsule).overlay(Capsule().stroke(Color.red, lineWidth: 2))')
  })

  it('takes it away, and writes nothing when it is unchanged', () => {
    expect(written(BORDERED, null)).toBe(`        ${CARD}`)
    expect(planLayer(files(BORDERED), 'Text', [{ section: 'stroke', stroke: line(1, 'inside', { hex: '#8E8E9380' }) }])).toMatchObject({ ok: true })
    expect(planLayer(files(BORDERED), 'Text', [{ section: 'stroke', stroke: line(1, 'inside', { name: 'gray', opacity: 0.3 }) }])).toMatchObject({ ok: true, changes: [] })
  })

  it('places nothing new in a chain with a modifier it does not know, but changes the border that is there', () => {
    const declarations = '\nextension View {\n    func glow() -> some View { shadow(radius: 2) }\n}\n'
    const chain = (body: string) => project(screen(`        ${body}`, declarations))
    expect(planLayer(chain('Text("A").glow()'), 'Text', [{ section: 'stroke', stroke: line(1) }])).toMatchObject({ ok: false, reason: expect.stringMatching(/does not know/) })
    expect(bodyOf(setLayer(chain('Text("A").overlay(Rectangle().strokeBorder(Color.gray, lineWidth: 1)).glow()'), 'Text', [{ section: 'stroke', stroke: line(2) }])))
      .toBe('        Text("A").overlay(Rectangle().strokeBorder(Color.gray, lineWidth: 2)).glow()')
  })
})

describe('a shape’s own stroke', () => {
  it.each([
    ['an empty shape, first', 'Circle', 'Circle().frame(width: 40, height: 40)', line(2, 'inside', { name: 'blue' }), undefined, 'Circle().strokeBorder(.blue, lineWidth: 2).frame(width: 40, height: 40)'],
    ['a filled shape, after its fill, from iOS 17', 'Circle', 'Circle().fill(.red).frame(width: 40, height: 40)', line(2, 'center', { name: 'blue' }), undefined, 'Circle().fill(.red).stroke(.blue, lineWidth: 2).frame(width: 40, height: 40)'],
    ['a token width and a dash', 'Capsule', 'Capsule()', line({ token: 'Layout.hairline' }, 'center', { name: 'blue' }, [3]), undefined, 'Capsule().stroke(.blue, style: StrokeStyle(lineWidth: Layout.hairline, dash: [3]))'],
  ])('adds one to %s', (_, name, body, stroke, target, expected) => {
    expect(written(body, stroke, name, target)).toBe(`        ${expected}`)
  })

  it.each([
    ['a filled shape before iOS 17', 'Circle().fill(.red).frame(width: 40, height: 40)', line(2), '16.0', 'Circle().fill(.red).frame(width: 40, height: 40).overlay(Circle().strokeBorder(.gray, lineWidth: 2))'],
    ['a shape filled by its foreground', 'Capsule().foregroundStyle(.red)', line(1, 'center'), undefined, 'Capsule().foregroundStyle(.red).overlay(Capsule().stroke(.gray, lineWidth: 1))'],
    ['a filled shape, outside its edge', 'Circle().fill(.red)', line(1, 'outside'), undefined, 'Circle().fill(.red).overlay(Circle().strokeBorder(.gray, lineWidth: 1).padding(-1))'],
  ])('borders %s, which its own stroke would empty', (_, body, stroke, target, expected) => {
    expect(written(body, stroke, body.startsWith('Circle') ? 'Circle' : 'Capsule', target)).toBe(`        ${expected}`)
  })

  it('changes it in place, on the edge or inside it', () => {
    expect(written('Circle().stroke(.blue, lineWidth: 4)', line(4, 'inside', { name: 'blue' }), 'Circle')).toBe('        Circle().strokeBorder(.blue, lineWidth: 4)')
    expect(written('Circle().stroke(.blue, lineWidth: 4)', line(4, 'center', { name: 'blue' }, [2, 1]), 'Circle')).toBe('        Circle().stroke(.blue, style: StrokeStyle(lineWidth: 4, dash: [2, 1]))')
  })

  it.each([
    ['moving its own stroke outside its edge', 'Circle().stroke(.blue, lineWidth: 4)', line(4, 'outside', { name: 'blue' }), /inside or on its edge/],
    ['a stroke outside an empty shape', 'Circle()', line(1, 'outside'), /needs a fill/],
    ['taking away the stroke of an empty shape', 'Circle().stroke(.blue, lineWidth: 4)', null, /filled in/],
    ['a trimmed shape’s stroke inside its edge, which only an insettable shape draws', 'Circle().trim(from: 0, to: 0.5).stroke(.blue, lineWidth: 4)', line(4, 'inside', { name: 'blue' }), /Choose Center/],
  ])('refuses %s', (_, body, stroke, reason) => {
    expect(refusal(body, stroke, 'Circle')).toMatch(reason)
  })

  it('takes away the stroke of a filled shape', () => {
    expect(written('Circle().fill(.red).stroke(.blue, lineWidth: 4)', null, 'Circle')).toBe('        Circle().fill(.red)')
  })
})

describe('the preview draws what the Stroke section writes', () => {
  /** The render tree after one stroke change, compiled the way the canvas compiles it. */
  const drawn = (body: string, stroke: StrokeValue, name = 'Text'): readonly RenderNode[] => {
    const changed = setLayer(files(body), name, [{ section: 'stroke', stroke }])
    const result = compile({ files: changed.map(file => ({ id: file.id, text: file.text })), revision: 1, canvas: { width: 393, height: 852 }, colorScheme: 'light', safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } })
    expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
    return result.renderTree!.nodes
  }
  const strokes = (nodes: readonly RenderNode[]) => nodes.flatMap(node => node.shape?.stroke ? [node.shape.stroke] : [])

  it('a border inside the edge, with the view’s corners', () => {
    const nodes = drawn(CARD, line(2, 'inside', { name: 'red' }))
    expect(strokes(nodes)).toContainEqual(expect.objectContaining({ width: 2, placement: 'inside', color: { r: 255, g: 56, b: 60, a: 1 } }))
    expect(nodes.find(node => node.shape?.stroke)?.shape).toMatchObject({ shape: 'roundedRectangle', cornerRadius: 12 })
  })

  it('a dashed stroke on a shape', () => {
    expect(strokes(drawn('Circle().frame(width: 40, height: 40)', line(2, 'center', { name: 'blue' }, [4, 2]), 'Circle'))).toContainEqual(expect.objectContaining({ width: 2, placement: 'center', dash: [4, 2] }))
  })
})

describe.skipIf(!XCODE)('what the Stroke section writes builds in Xcode 27', () => {
  /** The whole file after one stroke change, at the iOS version given, which the type-check reads from its first line. */
  const source = (body: string, stroke: StrokeValue | null, name = 'Text', target = '27.0') =>
    text(setLayer(project(`// target: iOS ${target}\n` + screen(`        ${body}`, TOKENS)), name, [{ section: 'stroke', stroke }], 0, target))
  const views: readonly StrokeValue[] = [line(1), line(2, 'center', { name: 'blue' }), line(2, 'outside', { hex: '#FF000080' }), line(2, 'inside', { token: 'Theme.line' }, [4, 2]), line(1, 'outside', { name: 'gray' }, [3])]

  it('for every border and shape stroke, at every target that writes differently', () => {
    const sources = [
      ...views.map(stroke => source(CARD, stroke)),
      ...views.map(stroke => source('Text("A").padding(8).background(.red).shadow(radius: 2)', stroke)),
      ...views.map(stroke => source('Text("A")\n            .padding(8)\n            .background(Color.red)', stroke, 'Text', '14.0')),
      ...views.map(stroke => source('Text("A")\n            .padding(8)\n            .glassEffect()', stroke, 'Text', '26.0')),
      source('Text("A").padding(8).clipShape(.capsule).border(Color.red, width: 2)', line(2, 'center', { name: 'red' })),
      source(`${CARD}${border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(Color.gray.opacity(0.3), lineWidth: 1)')}`, line(3, 'outside', { name: 'gray', opacity: 0.3 })),
      source(`${CARD}${border('RoundedRectangle(cornerRadius: 12)', '.strokeBorder(Color.gray.opacity(0.3), lineWidth: 1)')}`, null),
      source('Circle().frame(width: 40, height: 40)', line(2, 'inside', { name: 'blue' }), 'Circle', '14.0'),
      source('Circle().fill(.red).frame(width: 40, height: 40)', line(2, 'center', { name: 'blue' }), 'Circle', '17.0'),
      source('Circle().fill(.red).frame(width: 40, height: 40)', line(2, 'inside', { name: 'blue' }, [4]), 'Circle', '16.0'),
      source('Capsule()', line({ token: 'Layout.hairline' }, 'center', { name: 'blue' }, [3]), 'Capsule', '15.0'),
      source('Capsule().foregroundStyle(.red)', line(1, 'center'), 'Capsule', '15.0'),
      source('Circle().fill(.red)', line(1, 'outside'), 'Circle', '15.0'),
      source('Circle().stroke(.blue, lineWidth: 4)', line(4, 'center', { name: 'blue' }, [2, 1]), 'Circle', '13.0'),
      source('Circle().fill(.red).stroke(.blue, lineWidth: 4)', null, 'Circle', '17.0'),
    ]
    typecheckInXcode(sources)
    expect(sources).toHaveLength(31)
  }, 600_000)
})
