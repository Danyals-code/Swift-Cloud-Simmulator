import { beforeEach, describe, expect, it } from 'vitest'
import { resetPipelineState } from '@studio/swiftui-runtime'
import type { LayerChange } from '@studio/shared'
import { XCODE, bodyOf, layerOf, planLayer, project, screen, setLayer, typecheckInXcode } from './helpers/layer-project'

/**
 * Text: a text's font, colour, alignment and spacing, as Figma's type controls set them.
 * However the font is written, as a style, a size or a style with its weight on it, it
 * reads as one value; a size that should follow Dynamic Type is an `@ScaledMetric`.
 */
beforeEach(resetPipelineState)

const text = (body: string, members = '') => layerOf(project(screen(`        ${body}`).replace('struct ContentView: View {\n', `struct ContentView: View {\n${members}`)), 'Text').text!

describe('reading a font', () => {
  it.each([
    ['no font, which is Body', 'Text("A")', { style: 'body' }, 'absent'],
    ['a text style', 'Text("A").font(.title3)', { style: 'title3' }, 'literal'],
    ['a style with its weight on it', 'Text("A").font(.title2.bold())', { style: 'title2', weight: 'bold' }, 'literal'],
    ['a style with a weight', 'Text("A").font(.headline.weight(.semibold))', { style: 'headline', weight: 'semibold' }, 'literal'],
    ['a system font at a size', 'Text("A").font(.system(size: 22, weight: .semibold, design: .rounded))', { style: null, size: 22, relativeTo: null, weight: 'semibold', design: 'rounded' }, 'literal'],
    ['a system font in a style', 'Text("A").font(.system(.title3, design: .serif))', { style: 'title3', design: 'serif' }, 'literal'],
    ['separate weight, design and italic modifiers', 'Text("A").font(.callout).fontWeight(.medium).fontDesign(.monospaced).italic()', { style: 'callout', weight: 'medium', design: 'monospaced', italic: true }, 'literal'],
    ['bold as a modifier', 'Text("A").bold()', { style: 'body', weight: 'bold' }, 'literal'],
  ])('reads %s', (_, body, font, state) => {
    expect(text(body).font).toMatchObject({ value: font, state })
  })

  it('reads a size that follows Dynamic Type from its @ScaledMetric', () => {
    const font = text('Text("A").font(.system(size: titleSize, weight: .bold))', '    @ScaledMetric(relativeTo: .title) private var titleSize: CGFloat = 28\n').font
    expect(font).toMatchObject({ value: { style: null, size: 28, relativeTo: 'title', weight: 'bold' }, state: 'literal' })
  })

  it('reads a plain @ScaledMetric as following Body', () => {
    expect(text('Text("A").font(.system(size: size))', '    @ScaledMetric var size = 15.0\n').font.value).toMatchObject({ size: 15, relativeTo: 'body' })
  })

  it.each([
    ['a custom font', 'Text("A").font(.custom("Avenir", size: 18))'],
    ['a font worked out at run time', 'Text("A").font(big ? .title : .body)'],
    ['a size from a property that is no @ScaledMetric', 'Text("A").font(.system(size: computed))'],
  ])('leaves %s to Code', (_, body) => {
    const font = text(body, '    var big = false\n    var computed: CGFloat { 12 }\n').font
    expect(font.state).toBe('code')
    expect(font.disabledReason).toMatch(/Change it in Code/)
  })
})

describe('reading the rest of the text', () => {
  it('reads alignment, letter and line spacing and case', () => {
    const value = text('Text("A").multilineTextAlignment(.center).tracking(1.5).lineSpacing(4).textCase(.uppercase)')
    expect(value.alignment).toMatchObject({ value: 'center', state: 'literal' })
    expect(value.tracking).toMatchObject({ value: 1.5, state: 'literal' })
    expect(value.lineSpacing).toMatchObject({ value: 4, state: 'literal' })
    expect(value.textCase).toMatchObject({ value: 'uppercase', state: 'literal' })
  })

  it('has no text section on a view that shows no text', () => {
    expect(layerOf(project(screen('        Rectangle().frame(width: 10)')), 'Rectangle').text).toBeUndefined()
  })
})

/** A colour token, and a flag a colour can be worked out from. */
const TOKENS = `
var on = false
enum Theme {
    static let accent = Color.blue
}
`
const colored = (body: string) => project(screen(`        ${body}`, TOKENS))

describe('reading the text colour', () => {
  it.each([
    ['no colour', 'Text("A")', null, 'absent'],
    ['a foreground style', 'Text("A").foregroundStyle(.red)', { name: 'red' }, 'literal'],
    ['the older foreground colour, with an opacity', 'Text("A").foregroundColor(Color.blue.opacity(0.5))', { name: 'blue', opacity: 0.5 }, 'literal'],
    ['a hex', 'Text("A").foregroundStyle(Color(red: 1, green: 0, blue: 0))', { hex: '#FF0000' }, 'literal'],
    ['a token, kept linked', 'Text("A").foregroundStyle(Theme.accent)', { token: 'Theme.accent' }, 'token'],
  ])('reads %s', (_, body, color, state) => {
    expect(layerOf(colored(body), 'Text').text!.color).toMatchObject({ value: color, state })
  })

  it('says which modifier it read, and the Text section shows it', () => {
    const layer = layerOf(colored('Text("A").padding().foregroundStyle(.red)'), 'Text')
    expect(layer.text!.color.from).toHaveLength(1)
    expect(layer.claimed[layer.text!.color.from![0]!]).toBe('text')
  })

  it.each([
    ['a colour set twice', 'Text("A").foregroundStyle(.red).foregroundColor(.blue)', /more than one place/],
    ['a colour worked out at run time', 'Text("A").foregroundStyle(on ? .red : .blue)', /worked out in Swift/],
    ['two levels of colour', 'Text("A").foregroundStyle(.red, .blue)', /Change it in Code/],
    ['a gradient', 'Text("A").foregroundStyle(.red.gradient)', /worked out in Swift/],
  ])('leaves %s to Code', (_, body, reason) => {
    const color = layerOf(colored(body), 'Text').text!.color
    expect(color.state).toBe('code')
    expect(color.disabledReason).toMatch(reason)
    expect(color.disabledReason).toMatch(/Change it in Code/)
  })

  it('reads a shape’s foreground style as its fill, which has no text section', () => {
    const shape = layerOf(colored('Circle().foregroundStyle(.red)'), 'Circle')
    expect(shape.text).toBeUndefined()
    expect(shape.fill).toMatchObject({ value: { kind: 'color', color: { name: 'red' } } })
    const label = layerOf(colored('Text("A").foregroundStyle(.red)'), 'Text')
    expect(label.fill?.value ?? null).toBeNull()
    expect(label.text!.color.value).toEqual({ name: 'red' })
  })
})

describe('writing a font', () => {
  const struct = (body: string, members = '') => project(screen(`        ${body}`).replace('struct ContentView: View {\n', `struct ContentView: View {\n${members}`))
  const view = (files: ReturnType<typeof struct>) => {
    const source = files[0]!.text, start = source.indexOf('struct ContentView: View {\n') + 'struct ContentView: View {\n'.length
    return source.slice(start, source.indexOf('\n    }\n}\n', start) + 7)
  }
  const set = (body: string, font: Record<string, unknown>, target?: string, members = '') => view(setLayer(struct(body, members), 'Text', [{ section: 'text', font }], 0, target))

  it('writes a text style, and on iOS 16 and later its weight, design and italic beside it', () => {
    expect(set('Text("A")', { style: 'title3' })).toContain('        Text("A").font(.title3)\n')
    expect(set('Text("A").font(.title3)', { weight: 'semibold', design: 'rounded', italic: true }))
      .toContain('        Text("A").font(.title3).fontWeight(.semibold).fontDesign(.rounded).italic()\n')
  })

  it('writes a weight unless it is the style’s own, so a Headline can be regular', () => {
    expect(set('Text("A").font(.headline)', { weight: 'regular' })).toContain('        Text("A").font(.headline).fontWeight(.regular)\n')
    expect(set('Text("A").font(.headline).fontWeight(.bold)', { weight: 'semibold' })).toContain('        Text("A").font(.headline)\n')
    // Body is what the text has anyway, so nothing is left to write.
    expect(set('Text("A").font(.body).fontWeight(.bold)', { weight: 'regular' })).toContain('        Text("A")\n')
  })

  it('folds the weight, design and italic into the font below iOS 16', () => {
    expect(set('Text("A").font(.title3)', { weight: 'semibold', design: 'rounded', italic: true }, '15.0'))
      .toContain('        Text("A").font(.system(.title3, design: .rounded).weight(.semibold).italic())\n')
  })

  it('rewrites a font written across several modifiers as one', () => {
    expect(set('Text("A").font(.title2.bold()).padding()', { style: 'headline' }))
      .toContain('        Text("A").font(.headline).fontWeight(.bold).padding()\n')
  })

  it('writes a size that follows Dynamic Type as an @ScaledMetric of the view', () => {
    expect(set('Text("A")', { style: null, size: 22, relativeTo: 'title2' })).toBe(
      '    @ScaledMetric(relativeTo: .title2) private var textSize: CGFloat = 22\n' +
      '    var body: some View {\n        Text("A").font(.system(size: textSize))\n    }\n')
  })

  it('writes a fixed size in points when it should not follow Dynamic Type', () => {
    expect(set('Text("A")', { style: null, size: 22, relativeTo: null })).toContain('        Text("A").font(.system(size: 22))\n')
  })

  it('changes the size where the @ScaledMetric is declared, and takes it away with the size', () => {
    const members = '    @ScaledMetric(relativeTo: .title2) private var textSize: CGFloat = 22\n'
    expect(set('Text("A").font(.system(size: textSize))', { size: 26, relativeTo: 'body' }, undefined, members))
      .toContain('    @ScaledMetric(relativeTo: .body) private var textSize: CGFloat = 26\n')
    expect(set('Text("A").font(.system(size: textSize))', { style: 'title' }, undefined, members)).toBe(
      '    var body: some View {\n        Text("A").font(.title)\n    }\n')
  })

  it('keeps the text selected where it moved to when its @ScaledMetric comes or goes', () => {
    for (const [members, font] of [['', { style: null, size: 22, relativeTo: 'title2' }], ['    @ScaledMetric(relativeTo: .title2) private var textSize: CGFloat = 22\n', { style: 'title' }]] as const) {
      const files = struct(members ? 'Text("A").font(.system(size: textSize))' : 'Text("A")', members)
      const plan = planLayer(files, 'Text', [{ section: 'text', font }])
      if (!plan.ok) throw new Error(plan.reason)
      const after = plan.changes[0]!.after
      expect(plan.selection?.offset).toBe(after.indexOf('Text("A")'))
    }
  })

  it('names a new @ScaledMetric so it meets nothing the view already has', () => {
    expect(set('Text("A")', { style: null, size: 18, relativeTo: 'body' }, undefined, '    let textSize = 4\n'))
      .toContain('    @ScaledMetric(relativeTo: .body) private var textSize2: CGFloat = 18\n')
  })

  it('refuses a size that follows Dynamic Type below iOS 14, and one shared with other text', () => {
    expect(() => set('Text("A")', { style: null, size: 22, relativeTo: 'body' }, '13.0')).toThrow(/iOS 14/)
    const shared = '    @ScaledMetric private var textSize: CGFloat = 22\n'
    expect(() => set('VStack { Text("A").font(.system(size: textSize)); Text("B").font(.system(size: textSize)) }', { size: 30 }, undefined, shared)).toThrow(/shared/)
  })

  it('says before a change why a size can’t scale with text size below iOS 14', () => {
    const files = project(screen('        Text("A")'))
    expect(layerOf(files, 'Text', 0, '13.0').text!.scalingUnavailable).toMatch(/needs iOS 14/)
    expect(layerOf(files, 'Text', 0, '14.0').text!.scalingUnavailable).toBeUndefined()
  })
})

describe('writing the rest of the text', () => {
  const set = (body: string, change: Record<string, unknown>) => bodyOf(setLayer(project(screen(`        ${body}`)), 'Text', [{ section: 'text', ...change }]))

  it('adds, changes and takes away alignment, spacing and case', () => {
    expect(set('Text("A").font(.title)', { alignment: 'center', tracking: 1.5, lineSpacing: 4, textCase: 'uppercase' }))
      .toBe('        Text("A").font(.title).tracking(1.5).multilineTextAlignment(.center).lineSpacing(4).textCase(.uppercase)')
    expect(set('Text("A").tracking(1).lineSpacing(2)', { tracking: 2, lineSpacing: null })).toBe('        Text("A").tracking(2)')
  })

  it('puts letter spacing where a Text still is below iOS 16, which only a Text takes it on', () => {
    const files = project(screen('        Text("A").multilineTextAlignment(.center)'))
    expect(bodyOf(setLayer(files, 'Text', [{ section: 'text', tracking: 1 }], 0, '15.0'))).toBe('        Text("A").tracking(1).multilineTextAlignment(.center)')
  })
})

describe('writing the text colour', () => {
  const plan = (body: string, color: unknown, target?: string) => planLayer(colored(body), 'Text', [{ section: 'text', color } as LayerChange], 0, target)
  const set = (body: string, color: unknown, target?: string) => bodyOf(setLayer(colored(body), 'Text', [{ section: 'text', color } as LayerChange], 0, target))

  it('adds a foreground style with the text styles, before the padding', () => {
    expect(set('Text("A").font(.title).padding()', { name: 'red' })).toBe('        Text("A").font(.title).foregroundStyle(.red).padding()')
  })

  it('writes the older foreground colour below iOS 15, where a colour has to say it is one', () => {
    expect(set('Text("A").padding()', { name: 'red' }, '14.0')).toBe('        Text("A").foregroundColor(Color.red).padding()')
  })

  it('changes a colour in place, as a foreground style from iOS 15', () => {
    expect(set('Text("A").foregroundColor(.red).padding()', { hex: '#FF0000', opacity: 0.5 })).toBe('        Text("A").foregroundStyle(Color(red: 1, green: 0, blue: 0, opacity: 0.5)).padding()')
    expect(set('Text("A").foregroundStyle(.red).padding()', { name: 'secondary' })).toBe('        Text("A").foregroundStyle(.secondary).padding()')
  })

  it('takes the colour away', () => {
    expect(set('Text("A").foregroundStyle(.red).padding()', null)).toBe('        Text("A").padding()')
  })

  it('keeps a token linked, with an opacity on it', () => {
    expect(set('Text("A").foregroundStyle(Theme.accent)', { token: 'Theme.accent', opacity: 0.5 })).toBe('        Text("A").foregroundStyle(Theme.accent.opacity(0.5))')
  })

  it('writes nothing for the colour it already has, however it is spelled', () => {
    const same = plan('Text("A").foregroundColor(Color.red)', { name: 'red' })
    expect(same.ok && same.changes).toEqual([])
  })

  it('keeps a Text a Text below iOS 16, for the modifiers only a Text has', () => {
    // A foreground colour in the Text's own run stays one, so the letter spacing after it still applies.
    expect(set('Text("A").foregroundColor(.red).tracking(1)', { name: 'blue' }, '15.0')).toBe('        Text("A").foregroundColor(Color.blue).tracking(1)')
    // Letter spacing added with the colour goes before the style, where the view is still a Text.
    expect(bodyOf(setLayer(colored('Text("A")'), 'Text', [{ section: 'text', color: { name: 'red' }, tracking: 1 }], 0, '15.0'))).toBe('        Text("A").tracking(1).foregroundStyle(.red)')
  })

  it('refuses a colour newer than the deployment target, and one worked out in Swift', () => {
    expect(() => set('Text("A")', { name: 'tertiary' }, '14.0')).toThrow(/iOS 15/)
    expect(() => set('Text("A").foregroundStyle(on ? .red : .blue)', { name: 'red' })).toThrow(/Change it in Code/)
  })
})

describe.skipIf(!XCODE)('what the text writer writes builds in Xcode 27', () => {
  it('for every font form, at the targets that write it differently', () => {
    const sources: string[] = []
    const write = (font: Record<string, unknown>, target?: string, change: Record<string, unknown> = {}) =>
      sources.push(`// target: iOS ${target ?? '27.0'}\n` + layerText(setLayer(project(screen('        Text("A")\n            .padding()')), 'Text', [{ section: 'text', font, ...change }], 0, target)))
    const layerText = (files: ReturnType<typeof project>) => files[0]!.text
    write({ style: 'title3', weight: 'semibold', design: 'rounded', italic: true })
    write({ style: 'title3', weight: 'semibold', design: 'rounded', italic: true }, '15.0')
    write({ style: 'title3', weight: 'semibold', design: 'rounded', italic: true }, '16.0')
    write({ style: null, size: 22, relativeTo: 'title2', weight: 'bold' })
    write({ style: null, size: 22, relativeTo: 'title2', weight: 'bold', italic: true }, '14.0')
    write({ style: null, size: 22, relativeTo: null, design: 'serif' }, '13.0')
    write({ style: 'body' }, undefined, { alignment: 'center', tracking: 1.5, lineSpacing: 4, textCase: 'uppercase' })
    write({ style: 'body' }, '15.0', { alignment: 'trailing', tracking: 1, lineSpacing: 2, textCase: 'lowercase' })
    sources.push('// target: iOS 15.0\n' + setLayer(project(screen('        Text("A").multilineTextAlignment(.center)')), 'Text', [{ section: 'text', tracking: 1 }], 0, '15.0')[0]!.text)
    typecheckInXcode(sources)
    expect(sources).toHaveLength(9)
  }, 300_000)

  it('for every colour form, at iOS 27, 15 and below', () => {
    const theme = '\nenum Theme {\n    static let accent = Color.blue\n}\n'
    const write = (body: string, change: Record<string, unknown>, target = '27.0') =>
      `// target: iOS ${target}\n` + setLayer(project(screen(`        ${body}`, theme)), 'Text', [{ section: 'text', ...change } as LayerChange], 0, target)[0]!.text
    const sources = [
      write('Text("A")\n            .padding()', { color: { name: 'red' } }),
      write('Text("A").foregroundColor(.red)', { color: { hex: '#0A84FF', opacity: 0.5 } }),
      write('Text("A")', { color: { token: 'Theme.accent', opacity: 0.5 } }),
      write('Text("A")', { color: { name: 'secondary' } }, '15.0'),
      write('Text("A").foregroundColor(.red).tracking(1)', { color: { name: 'blue' } }, '15.0'),
      write('Text("A")', { color: { name: 'red' }, tracking: 1 }, '15.0'),
      write('Text("A").bold()', { color: { name: 'systemGray' } }, '14.0'),
      write('Text("A")', { color: { name: 'red' }, tracking: 1 }, '13.0'),
    ]
    expect(sources[5]).toContain('Text("A").tracking(1).foregroundStyle(.red)')
    typecheckInXcode(sources)
    expect(sources).toHaveLength(8)
  }, 300_000)
})
