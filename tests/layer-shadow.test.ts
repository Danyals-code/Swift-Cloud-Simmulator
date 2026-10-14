import { beforeEach, describe, expect, it } from 'vitest'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { authoringCapability, type ShadowValue } from '@studio/shared'
import { XCODE, bodyOf, layerOf, node, planLayer, project, screen, setLayer, text, typecheckInXcode } from './helpers/layer-project'

/**
 * Common spellings of a shadow and a stroke (doc 18, Concern 2, item 4, Wave 3b).
 *
 * A layer's drop shadow is in Effects, as Figma has it: its colour, blur and offset,
 * however `.shadow` is written, written back as the plainest form with SwiftUI's defaults
 * left out. A shadow token stays linked, and two shadows are left to Code.
 *
 * A stroke overlay whose shape is written in its own way is the layer's stroke where that
 * shape agrees with the layer's corners, and is rewritten in its own spelling; around any
 * other shape it is shown, with why it is left to Code.
 */
beforeEach(resetPipelineState)

const TOKENS = `
enum Theme {
    static let shade = Color.black.opacity(0.3)
}

struct ShadowToken {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
}

extension ShadowToken {
    static let card = ShadowToken(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
}

extension View {
    func shadow(_ token: ShadowToken) -> some View {
        shadow(color: token.color, radius: token.radius, x: token.x, y: token.y)
    }
}
`
const files = (body: string) => project(screen(`        ${body}`, TOKENS))
const shadowOf = (body: string) => layerOf(files(body), 'Text').effects.shadow!
const written = (body: string, shadow: ShadowValue | null) => bodyOf(setLayer(files(body), 'Text', [{ section: 'effects', shadow }]))
const refusal = (body: string, shadow: ShadowValue | null) => {
  const plan = planLayer(files(body), 'Text', [{ section: 'effects', shadow }])
  return plan.ok ? 'written' : plan.reason
}
const drop = (radius: number, x = 0, y = 0, color: Extract<ShadowValue, { radius: number }>['color'] = null): ShadowValue => ({ color, radius, x, y })
const CARD = 'Text("A").padding(8).background(Color.white)'

describe('the forms of .shadow the panel knows', () => {
  it.each([
    [['radius']], [['color', 'radius']], [['radius', 'x']], [['radius', 'y']], [['radius', 'x', 'y']], [['color', 'radius', 'x']], [['color', 'radius', 'y']], [['color', 'radius', 'x', 'y']], [[null]],
  ])('takes %j', labels => {
    expect(authoringCapability('shadow', 'modifier', labels)).toBeDefined()
  })

  it('gives the card of a shadow with a colour, a blur and a drop its fields', () => {
    const view = node(files(`${CARD}.shadow(color: .black.opacity(0.2), radius: 4, y: 2)`), 'Text')
    expect(view.properties.filter(property => property.name.startsWith('shadow')).map(property => property.valueKind)).not.toContain('unsupported')
    expect(view.modifiers?.find(modifier => modifier.name === 'shadow')?.controls.length).toBeGreaterThan(1)
  })
})

describe('reading a shadow', () => {
  it('has none when nothing casts one', () => {
    expect(shadowOf(CARD)).toEqual({ value: null, state: 'absent' })
  })

  it.each([
    ['a blur alone, in SwiftUI’s own colour', '.shadow(radius: 4)', drop(4)],
    ['a colour, a blur and a drop', '.shadow(color: .black.opacity(0.2), radius: 4, y: 2)', drop(4, 0, 2, { name: 'black', opacity: 0.2 })],
    ['each argument', '.shadow(color: Color(red: 0, green: 0, blue: 0.5), radius: 6, x: -2, y: 3)', drop(6, -2, 3, { hex: '#000080' })],
  ])('reads %s', (_, shadow, value) => {
    expect(shadowOf(`${CARD}${shadow}`)).toMatchObject({ value, state: 'literal' })
  })

  it('keeps a colour token and a shadow token linked', () => {
    expect(shadowOf(`${CARD}.shadow(color: Theme.shade, radius: 8, y: 4)`)).toMatchObject({ value: drop(8, 0, 4, { token: 'Theme.shade' }), state: 'token' })
    expect(shadowOf(`${CARD}.shadow(.card)`)).toMatchObject({ value: { token: '.card' }, state: 'token' })
  })

  it.each([
    ['two shadows', '.shadow(radius: 2).shadow(radius: 8)', /more than one place/],
    ['a blur worked out in Swift', '.shadow(radius: isOn ? 2 : 8)', /worked out in Swift/],
    ['a comment', '.shadow(radius: 4 /* soft */)', /comment/],
  ])('leaves %s to Code', (_, shadow, reason) => {
    const read = shadowOf(`${CARD}${shadow}`)
    expect(read.state).toBe('code')
    expect(read.disabledReason).toMatch(reason)
  })

  it('claims the shadow for Effects', () => {
    const layer = layerOf(files(`${CARD}.shadow(radius: 4)`), 'Text')
    expect(layer.effects.shadow!.from).toHaveLength(1)
    expect(layer.claimed[layer.effects.shadow!.from![0]!]).toBe('effects')
  })
})

describe('writing a shadow', () => {
  it('adds one with the surface it is cast by, before the margin', () => {
    expect(written(`${CARD}.padding(8)`, drop(4, 0, 4, { name: 'black', opacity: 0.25 })))
      .toBe('        Text("A").padding(8).background(Color.white).shadow(color: .black.opacity(0.25), radius: 4, y: 4).padding(8)')
  })

  it.each([
    ['a blur alone', drop(4), '.shadow(radius: 4)'],
    ['a sideways drop', drop(2, 3), '.shadow(radius: 2, x: 3)'],
    ['a hex colour', drop(6, 1, 2, { hex: '#336699' }), '.shadow(color: Color(red: 0.2, green: 0.4, blue: 0.6), radius: 6, x: 1, y: 2)'],
    ['a system colour in its own spelling', drop(3, 0, 1, { name: 'systemGray' }), '.shadow(color: Color(.systemGray), radius: 3, y: 1)'],
  ])('writes %s as the plainest form, leaving out the defaults', (_, shadow, call) => {
    expect(written(CARD, shadow)).toBe(`        ${CARD}${call}`)
  })

  it('changes one in place, keeping a colour it leaves as it was spelled', () => {
    expect(written(`${CARD}.shadow(color: Color.black.opacity(0.2), radius: 4, y: 2).opacity(0.5)`, drop(8, 0, 2, { name: 'black', opacity: 0.2 })))
      .toBe(`        ${CARD}.shadow(color: Color.black.opacity(0.2), radius: 8, y: 2).opacity(0.5)`)
  })

  it('takes one away, and writes nothing for the shadow it has', () => {
    expect(written(`${CARD}.shadow(radius: 4)`, null)).toBe(`        ${CARD}`)
    const plan = planLayer(files(`${CARD}.shadow(radius: 4.0, x: 0)`), 'Text', [{ section: 'effects', shadow: drop(4) }])
    expect(plan.ok && plan.changes).toEqual([])
  })

  it('keeps a shadow token as it is, and writes its values in its place on Detach', () => {
    const plan = planLayer(files(`${CARD}.shadow(.card)`), 'Text', [{ section: 'effects', shadow: { token: '.card' } }])
    expect(plan.ok && plan.changes).toEqual([])
    expect(written(`${CARD}.shadow(.card)`, drop(8, 0, 4, { name: 'black', opacity: 0.2 }))).toBe(`        ${CARD}.shadow(color: .black.opacity(0.2), radius: 8, y: 4)`)
    expect(refusal(CARD, { token: '.card' })).toMatch(/Change it in Code/)
  })

  it('refuses a negative blur, two shadows and a style that is not a colour', () => {
    expect(refusal(CARD, drop(-1))).toMatch(/0 or more/)
    expect(refusal(`${CARD}.shadow(radius: 2).shadow(radius: 8)`, drop(4))).toMatch(/more than one place/)
    expect(refusal(CARD, drop(4, 0, 0, { name: 'tertiary' }))).toMatch(/not a color/)
  })
})

describe('a stroke overlay written in its own way', () => {
  const strokeOf = (body: string) => layerOf(files(body), 'Text').stroke!
  const stroke = (width: number, position: 'inside' | 'center' | 'outside', color: { name: string } = { name: 'gray' }) => ({ color, width, position })
  const strokeWritten = (body: string, next: ReturnType<typeof stroke>) => bodyOf(setLayer(files(body), 'Text', [{ section: 'stroke', stroke: next }]))

  it.each([
    ['a radius and the style SwiftUI draws by default, left out', 'Text("A").clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray, lineWidth: 1))', stroke(1, 'center')],
    ['a radius written with a decimal point, in a closure', 'Text("A").clipShape(.rect(cornerRadius: 12)).overlay { RoundedRectangle(cornerRadius: 12.0).strokeBorder(Color.gray, lineWidth: 1) }', stroke(1, 'inside')],
    ['a shape as much larger as an outside line is wide', 'Text("A").clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Color.gray, lineWidth: 1).padding(-1))', stroke(1, 'outside')],
  ])('reads one whose shape agrees with the corners: %s', (_, body, value) => {
    expect(strokeOf(body)).toMatchObject({ value, state: 'literal' })
  })

  it('rewrites one in its own spelling', () => {
    expect(strokeWritten('Text("A").clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray, lineWidth: 1))', stroke(2, 'center')))
      .toBe('        Text("A").clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray, lineWidth: 2))')
    expect(strokeWritten('Text("A").clipShape(.rect(cornerRadius: 12)).overlay { RoundedRectangle(cornerRadius: 12.0).strokeBorder(Color.gray, lineWidth: 1) }', stroke(1, 'center', { name: 'red' })))
      .toBe('        Text("A").clipShape(.rect(cornerRadius: 12)).overlay { RoundedRectangle(cornerRadius: 12.0).stroke(.red, lineWidth: 1) }')
  })

  it.each([
    ['a rounded rectangle on a square view', 'Text("A").padding(8).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray, lineWidth: 1))', /a rounded rectangle with a radius of 8, which isn’t this view’s shape/],
    ['a circle on a rounded view', 'Text("A").background(.red).clipShape(.rect(cornerRadius: 12)).overlay { Circle().stroke(Color.gray, lineWidth: 1) }', /a circle, which isn’t this view’s shape/],
  ])('shows one around another shape as it is, left to Code: %s', (_, body, reason) => {
    const read = strokeOf(body)
    expect(read).toMatchObject({ state: 'code', value: stroke(1, 'center') })
    expect(read.disabledReason).toMatch(reason)
    expect(planLayer(files(body), 'Text', [{ section: 'stroke', stroke: stroke(2, 'center') }])).toMatchObject({ ok: false, reason: expect.stringMatching(/Give the view the same corners/) })
  })

  it('leaves an overlay that is no stroke where it is', () => {
    expect(strokeOf('Text("A").overlay(Circle().fill(Color.red).frame(width: 8, height: 8), alignment: .topTrailing)')).toEqual({ value: null, state: 'absent' })
  })
})

describe.skipIf(!XCODE)('what the shadow writer writes builds in Xcode 27', () => {
  it('for each form it writes', () => {
    const shadows = [drop(4), drop(2, 3), drop(4, 0, 4, { name: 'black', opacity: 0.25 }), drop(6, 1, 2, { hex: '#336699' }), drop(3, -1, 1, { name: 'systemGray' }), drop(5, 0, 2, { token: 'Theme.shade' }), drop(8, 2, 0, { name: 'accentColor', opacity: 0.5 })]
    const sources = [
      ...shadows.map(shadow => text(setLayer(files(CARD), 'Text', [{ section: 'effects', shadow }]))),
      text(setLayer(files(`${CARD}.shadow(.card)`), 'Text', [{ section: 'effects', shadow: drop(8, 0, 4, { name: 'black', opacity: 0.2 }) }])),
      `// target: iOS 15\n${text(setLayer(files(CARD), 'Text', [{ section: 'effects', shadow: drop(4, 0, 2, { name: 'mint' }) }]))}`,
      text(setLayer(files('Text("A").clipShape(.rect(cornerRadius: 12)).overlay { RoundedRectangle(cornerRadius: 12.0).strokeBorder(Color.gray, lineWidth: 1) }'), 'Text', [{ section: 'stroke', stroke: { color: { name: 'red' }, width: 2, position: 'outside' } }])),
      text(setLayer(files('Text("A").clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.gray, lineWidth: 1))'), 'Text', [{ section: 'stroke', stroke: { color: { name: 'gray' }, width: 2, position: 'inside', dash: [4, 2] } }])),
    ]
    typecheckInXcode(sources)
    expect(sources).toHaveLength(11)
  }, 600_000)
})
