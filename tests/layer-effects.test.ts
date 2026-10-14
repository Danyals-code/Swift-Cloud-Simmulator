import { beforeEach, describe, expect, it } from 'vitest'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { XCODE, bodyOf, layerOf, planLayer, project, screen, setLayer, text, typecheckInXcode } from './helpers/layer-project'

/**
 * Effects: the layer's opacity and blur, as Figma's Layer and Effects sections set them.
 * A layer at full opacity and with no blur has no modifier for either.
 */
beforeEach(resetPipelineState)

const files = (body: string) => project(screen(`        ${body}`))
const effects = (body: string) => layerOf(files(body), 'Text').effects
const written = (body: string, change: { opacity?: number; blur?: number | null }) => bodyOf(setLayer(files(body), 'Text', [{ section: 'effects', ...change }]))

describe('reading effects', () => {
  it('reads a layer with neither as fully opaque and sharp', () => {
    expect(effects('Text("A")')).toMatchObject({ opacity: { value: 1, state: 'absent' }, blur: { value: null, state: 'absent' } })
  })

  it('reads an opacity and a blur radius written as numbers', () => {
    expect(effects('Text("A").background(Color.blue).opacity(0.4).blur(radius: 3)')).toMatchObject({ opacity: { value: 0.4, state: 'literal' }, blur: { value: 3, state: 'literal' } })
  })

  it.each([
    ['an opacity worked out at run time', 'Text("A").opacity(faded ? 0.5 : level)', 'opacity'],
    ['two opacities', 'Text("A").opacity(0.5).padding().opacity(0.5)', 'opacity'],
    ['a blur that keeps its edges', 'Text("A").blur(radius: 2, opaque: true)', 'blur'],
  ])('leaves %s to Code', (_, body, effect) => {
    const value = effects(body)[effect as 'opacity' | 'blur']
    expect(value.state).toBe('code')
    expect(value.disabledReason).toMatch(/Change it in Code/)
  })
})

describe('writing effects', () => {
  it('adds an opacity after the layer’s looks and before what it does', () => {
    expect(written('Text("A").background(Color.blue).offset(x: 4).accessibilityLabel("A")', { opacity: 0.5 }))
      .toBe('        Text("A").background(Color.blue).offset(x: 4).opacity(0.5).accessibilityLabel("A")')
  })

  it('changes an opacity in place, and full opacity takes it away', () => {
    expect(written('Text("A").opacity(0.4).padding()', { opacity: 0.8 })).toBe('        Text("A").opacity(0.8).padding()')
    expect(written('Text("A").opacity(0.4).padding()', { opacity: 1 })).toBe('        Text("A").padding()')
  })

  it('adds, changes and takes away a blur', () => {
    expect(written('Text("A")', { blur: 4 })).toBe('        Text("A").blur(radius: 4)')
    expect(written('Text("A").blur(radius: 4)', { blur: 8 })).toBe('        Text("A").blur(radius: 8)')
    expect(written('Text("A").blur(radius: 4)', { blur: null })).toBe('        Text("A")')
  })

  it('writes nothing for a value it already has, however it is spelled', () => {
    const files = project(screen('        Text("A").opacity(0.50).blur(radius: 4.0)'))
    const plan = planLayer(files, 'Text', [{ section: 'effects', opacity: 0.5, blur: 4 }])
    expect(plan.ok && plan.changes).toEqual([])
  })

  it('refuses an opacity outside 0 to 100%', () => {
    expect(() => written('Text("A")', { opacity: 1.5 })).toThrow(/between 0 and 100%/)
  })
})

describe.skipIf(!XCODE)('what the effects writer writes builds in Xcode 27', () => {
  it('for opacity and blur', () => {
    const sources = [{ opacity: 0.5 }, { blur: 6 }, { opacity: 0, blur: 0.5 }].map(change => text(setLayer(files('Text("A")\n            .background(Color.blue)'), 'Text', [{ section: 'effects', ...change }])))
    typecheckInXcode(sources)
    expect(sources).toHaveLength(3)
  }, 300_000)
})
