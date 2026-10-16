import { beforeEach, describe, expect, it } from 'vitest'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { XCODE, bodyOf, draw, edited, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 6b, symbols: a symbol Image's Rendering and Fill in Design, each written as SwiftUI
 * writes it from iOS 15, and the checker's word on what the preview draws of a symbol's
 * rendering mode, effects and variable value.
 */
beforeEach(resetPipelineState)

const ON_15 = '15.0'
/** The control `id` of the view written as `view`, in a screen whose body is that view, `declarations` after it. */
function control(view: string, id: string, target = ON_15, declarations = '', body = `        ${view}`) {
  return viewWritten(screen(body, declarations), view, target).controls?.find(c => c.id === id)
}
/** The body after setting `id` to `value` on the view written as `view`, the screen's whole body. */
const set = (view: string, id: string, value: string, target = ON_15, declarations = '') =>
  bodyOf(project(edited(screen(`        ${view}`, declarations), view, { kind: 'property', control: id, value }, target)))
const refused = (view: string, id: string, value: string, target = ON_15) => refusal(screen(`        ${view}`), view, { kind: 'property', control: id, value }, target)

const MODES = ['Automatic', 'Monochrome', 'Hierarchical', 'Palette', 'Multicolor']

describe('a symbol’s Rendering', () => {
  it('reads Automatic with no mode written, and offers the four modes and Automatic', () => {
    expect(control('Image(systemName: "person.crop.circle.fill")', 'symbol:rendering')).toMatchObject({ label: 'Rendering', kind: 'select', value: 'Automatic', options: MODES })
    expect(control('Image(systemName: "star").symbolRenderingMode(.hierarchical)', 'symbol:rendering')).toMatchObject({ value: 'Hierarchical' })
    expect(control('Image(systemName: "star").symbolRenderingMode(SymbolRenderingMode.multicolor)', 'symbol:rendering')).toMatchObject({ value: 'Multicolor' })
    expect(control('Image(systemName: "wifi", variableValue: 0.5).symbolRenderingMode(.monochrome)', 'symbol:rendering')).toMatchObject({ value: 'Monochrome' })
  })

  it('is on a symbol only: an asset image and a Label have none', () => {
    expect(control('Image("photo")', 'symbol:rendering')).toBeUndefined()
    expect(control('Label("Inbox", systemImage: "tray")', 'symbol:rendering')).toBeUndefined()
  })

  it('writes a new mode straight after the Image and the image-only modifiers on it, which return an Image', () => {
    expect(set('Image(systemName: "person.crop.circle.fill")', 'symbol:rendering', 'Hierarchical')).toBe('        Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.hierarchical)')
    expect(set('Image(systemName: "star").resizable().frame(width: 40, height: 40)', 'symbol:rendering', 'Multicolor'))
      .toBe('        Image(systemName: "star").resizable().symbolRenderingMode(.multicolor).frame(width: 40, height: 40)')
  })

  it('writes a new mode on a line of its own in a chain written a modifier a line', () => {
    const lined = 'Image(systemName: "checkmark.circle.fill")\n            .font(.largeTitle)\n            .foregroundStyle(.blue)'
    expect(set(lined, 'symbol:rendering', 'Palette')).toBe('        Image(systemName: "checkmark.circle.fill")\n            .symbolRenderingMode(.palette)\n            .font(.largeTitle)\n            .foregroundStyle(.blue, Color.gray)')
    expect(set('Image(systemName: "heart")\n            .resizable()\n            .frame(width: 40, height: 40)', 'symbol:fill', 'true')).toBe('        Image(systemName: "heart")\n            .resizable()\n            .symbolVariant(.fill)\n            .frame(width: 40, height: 40)')
    expect(set('Image(systemName: "heart")\n            .frame(width: 40, height: 40)', 'symbol:rendering', 'Palette')).toBe('        Image(systemName: "heart")\n            .symbolRenderingMode(.palette)\n            .foregroundStyle(Color.blue, Color.gray)\n            .frame(width: 40, height: 40)')
  })

  it('rewrites a written mode in place, and Automatic takes it away', () => {
    expect(set('Image(systemName: "star").font(.title).symbolRenderingMode(.hierarchical)', 'symbol:rendering', 'Monochrome')).toBe('        Image(systemName: "star").font(.title).symbolRenderingMode(.monochrome)')
    expect(set('Image(systemName: "star").symbolRenderingMode(SymbolRenderingMode.hierarchical).font(.title)', 'symbol:rendering', 'Automatic')).toBe('        Image(systemName: "star").font(.title)')
  })

  it('writes Palette with two colors, keeping a color already written as the first', () => {
    expect(set('Image(systemName: "person.crop.circle.fill")', 'symbol:rendering', 'Palette'))
      .toBe('        Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(Color.blue, Color.gray)')
    expect(set('Image(systemName: "person.crop.circle.fill").font(.title).foregroundStyle(.red)', 'symbol:rendering', 'Palette'))
      .toBe('        Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).font(.title).foregroundStyle(.red, Color.gray)')
    expect(set('Image(systemName: "person.crop.circle.fill").foregroundColor(.red)', 'symbol:rendering', 'Palette'))
      .toBe('        Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, Color.gray)')
    expect(set('Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.hierarchical).foregroundStyle(.red, .blue)', 'symbol:rendering', 'Palette'))
      .toBe('        Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, .blue)')
  })

  it('reads Palette’s two colors, and sets each', () => {
    const view = 'Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, Color.gray)'
    expect(control(view, 'symbol:palette:0')).toMatchObject({ label: 'Primary color', kind: 'select', value: 'red' })
    expect(control(view, 'symbol:palette:1')).toMatchObject({ label: 'Secondary color', kind: 'select', value: 'gray' })
    expect(set(view, 'symbol:palette:1', 'green')).toBe('        Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, Color.green)')
    expect(set(view, 'symbol:palette:0', 'secondarySystemBackground')).toBe('        Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(Color(.secondarySystemBackground), Color.gray)')
    // A colour worked out in Swift is shown as written.
    const worked = control('Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(theme.tint, .gray)', 'symbol:palette:0', ON_15, '\nlet theme = (tint: Color.red, x: 1)\n')
    expect(worked).toMatchObject({ kind: 'text', value: 'theme.tint' })
    expect(worked?.disabledReason).toMatch(/Change it in Code\.$/)
    // Two styles and no mode are Palette on iOS too.
    const implied = 'Image(systemName: "person.crop.circle.fill").foregroundStyle(.red, .blue)'
    expect(control(implied, 'symbol:rendering')).toMatchObject({ value: 'Palette' })
    expect(control(implied, 'symbol:palette:1')).toMatchObject({ value: 'blue' })
    expect(set(implied, 'symbol:rendering', 'Hierarchical')).toBe('        Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.hierarchical).foregroundStyle(.red)')
    // Only Palette has them.
    expect(control('Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.hierarchical)', 'symbol:palette:0')).toBeUndefined()
  })

  it('leaves Palette with its first color only, as the other modes draw one', () => {
    expect(set('Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, .gray)', 'symbol:rendering', 'Hierarchical'))
      .toBe('        Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.hierarchical).foregroundStyle(.red)')
    expect(set('Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, .gray)', 'symbol:rendering', 'Automatic'))
      .toBe('        Image(systemName: "person.crop.circle.fill").foregroundStyle(.red)')
  })

  it('shows a mode Design can’t read as written, read only', () => {
    const worked = control('Image(systemName: "star").symbolRenderingMode(mode)', 'symbol:rendering', ON_15, '\nlet mode = SymbolRenderingMode.palette\n')
    expect(worked).toMatchObject({ kind: 'text', value: 'mode' })
    expect(worked?.disabledReason).toMatch(/Change it in Code\.$/)
    const twice = control('Image(systemName: "star").symbolRenderingMode(.palette).symbolRenderingMode(.hierarchical)', 'symbol:rendering')
    expect(twice?.disabledReason).toMatch(/Change it in Code\.$/)
  })

  it('refuses Palette where the color is set in two places', () => {
    expect(refused('Image(systemName: "star").foregroundStyle(.red).foregroundColor(.blue)', 'symbol:rendering', 'Palette')).toMatch(/Change it in Code\.$/)
  })
})

/** The mode the preview paints the first symbol in `body` with, as Rendering names it: Automatic and Monochrome paint alike. */
function drawnIn(body: string): string {
  const mode = draw(project(screen(body))).renderTree!.nodes.find(node => node.image?.symbol)?.image!.symbolPaint?.mode
  return mode ? mode[0]!.toUpperCase() + mode.slice(1) : 'one color'
}
const asDrawn = (value: string | undefined) => value === 'Automatic' || value === 'Monochrome' ? 'one color' : value

describe('a symbol’s Rendering, as the preview draws it', () => {
  const symbol = 'Image(systemName: "person.crop.circle.fill")'
  /** Rendering on the Image written as `view` in `body`, checked against what the preview draws. */
  function rendering(body: string, view = symbol) {
    const read = viewWritten(screen(body), view, ON_15).controls?.find(c => c.id === 'symbol:rendering')
    expect(asDrawn(read?.value)).toBe(drawnIn(body))
    return read
  }

  it('reads a mode set on a container around the Image, read only', () => {
    const around = rendering(`        VStack {\n            ${symbol}\n        }\n        .symbolRenderingMode(.hierarchical)`)
    expect(around).toMatchObject({ value: 'Hierarchical' })
    expect(around?.disabledReason).toBe('Set on the Column around it. Change it there.')
    // The Image's own mode is the one drawn.
    expect(rendering(`        VStack {\n            ${symbol}.symbolRenderingMode(.multicolor)\n        }\n        .symbolRenderingMode(.hierarchical)`, `${symbol}.symbolRenderingMode(.multicolor)`)).toMatchObject({ value: 'Multicolor', disabledReason: undefined })
    const worked = viewWritten(screen(`        HStack {\n            ${symbol}\n        }\n        .symbolRenderingMode(mode)`, '\nlet mode = SymbolRenderingMode.palette\n'), symbol, ON_15).controls?.find(c => c.id === 'symbol:rendering')
    expect(worked).toMatchObject({ kind: 'text', value: '.symbolRenderingMode(mode)' })
    expect(worked?.disabledReason).toBe('Set on the Row around it. Change it there.')
  })

  it('reads two styles set on a container around the Image as Palette, read only', () => {
    const around = rendering(`        VStack {\n            ${symbol}\n        }\n        .foregroundStyle(.red, .blue)`)
    expect(around).toMatchObject({ value: 'Palette' })
    expect(around?.disabledReason).toBe('Set on the Column around it. Change it there.')
    expect(around && viewWritten(screen(`        VStack {\n            ${symbol}\n        }\n        .foregroundStyle(.red, .blue)`), symbol, ON_15).controls?.find(c => c.id === 'symbol:palette:0')).toBeUndefined()
    // One style around it, or one nearer it, draws in one colour, and Rendering stays editable.
    expect(rendering(`        VStack {\n            ${symbol}\n        }\n        .foregroundStyle(.red)`)).toMatchObject({ value: 'Automatic', disabledReason: undefined })
    expect(rendering(`        VStack {\n            VStack {\n                ${symbol}\n            }\n            .foregroundColor(.green)\n        }\n        .foregroundStyle(.red, .blue)`)).toMatchObject({ value: 'Automatic', disabledReason: undefined })
    expect(rendering(`        VStack {\n            ${symbol}.foregroundStyle(.green)\n        }\n        .foregroundStyle(.red, .blue)`, `${symbol}.foregroundStyle(.green)`)).toMatchObject({ value: 'Automatic', disabledReason: undefined })
  })

  it('reads three styles as Palette, read only', () => {
    const three = rendering(`        ${symbol}.foregroundStyle(.red, .blue, .green)`, `${symbol}.foregroundStyle(.red, .blue, .green)`)
    expect(three).toMatchObject({ value: 'Palette' })
    expect(three?.disabledReason).toMatch(/three colors.*Change it in Code\.$/)
  })

  it('reads the style nearest the Image where two are written, read only', () => {
    const nearest = rendering(`        ${symbol}.foregroundStyle(.red, .blue).foregroundStyle(.green)`, `${symbol}.foregroundStyle(.red, .blue).foregroundStyle(.green)`)
    expect(nearest).toMatchObject({ value: 'Palette' })
    expect(nearest?.disabledReason).toMatch(/Change it in Code\.$/)
    const one = rendering(`        ${symbol}.foregroundStyle(.green).foregroundStyle(.red, .blue)`, `${symbol}.foregroundStyle(.green).foregroundStyle(.red, .blue)`)
    expect(one).toMatchObject({ value: 'Automatic' })
    expect(one?.disabledReason).toMatch(/Change it in Code\.$/)
    // Two styles with a comment in them are still Palette.
    expect(rendering(`        ${symbol}.foregroundStyle(.red, /* back */ .blue)`, `${symbol}.foregroundStyle(.red, /* back */ .blue)`)).toMatchObject({ value: 'Palette' })
  })

  it('writes Palette over a gradient, which the preview paints the main layer in', () => {
    const gradient = 'LinearGradient(colors: [.blue, .green], startPoint: .top, endPoint: .bottom)'
    const palette = `Image(systemName: "checkmark.circle.fill").symbolRenderingMode(.palette).foregroundStyle(${gradient}, Color.gray)`
    expect(set(`Image(systemName: "checkmark.circle.fill").foregroundStyle(${gradient})`, 'symbol:rendering', 'Palette')).toBe(`        ${palette}`)
    expect(rendering(`        ${palette}`, palette)).toMatchObject({ value: 'Palette', disabledReason: undefined })
    // A gradient is no colour in the list, so it is shown as written.
    expect(control(palette, 'symbol:palette:0')).toMatchObject({ kind: 'text', value: gradient })
    expect(control(palette, 'symbol:palette:1')).toMatchObject({ kind: 'select', value: 'gray' })
  })
})

describe('a symbol’s Filled switch', () => {
  it('reads off, and on writes .symbolVariant(.fill) after the image-only modifiers', () => {
    expect(control('Image(systemName: "heart")', 'symbol:fill')).toMatchObject({ label: 'Filled', kind: 'toggle', value: 'false' })
    expect(set('Image(systemName: "heart")', 'symbol:fill', 'true')).toBe('        Image(systemName: "heart").symbolVariant(.fill)')
    expect(set('Image(systemName: "heart").resizable().scaledToFit()', 'symbol:fill', 'true')).toBe('        Image(systemName: "heart").resizable().symbolVariant(.fill).scaledToFit()')
  })

  it('adds and takes fill out of a variant chain, and off takes a lone .fill away', () => {
    expect(control('Image(systemName: "star").symbolVariant(.fill.circle)', 'symbol:fill')).toMatchObject({ value: 'true' })
    expect(set('Image(systemName: "star").symbolVariant(.circle)', 'symbol:fill', 'true')).toBe('        Image(systemName: "star").symbolVariant(.circle.fill)')
    expect(set('Image(systemName: "star").symbolVariant(.fill.circle)', 'symbol:fill', 'false')).toBe('        Image(systemName: "star").symbolVariant(.circle)')
    expect(set('Image(systemName: "star").symbolVariant(.none)', 'symbol:fill', 'true')).toBe('        Image(systemName: "star").symbolVariant(.fill)')
    expect(set('Image(systemName: "star").font(.title).symbolVariant(.fill)', 'symbol:fill', 'false')).toBe('        Image(systemName: "star").font(.title)')
  })

  it('is read only on a filled name, on a variant set around it, and on one worked out in Swift', () => {
    const named = control('Image(systemName: "heart.fill")', 'symbol:fill')
    expect(named).toMatchObject({ value: 'true' })
    expect(named?.disabledReason).toMatch(/heart/)
    const view = 'Image(systemName: "heart")'
    const around = viewWritten(screen(`        VStack {\n            ${view}\n        }\n        .symbolVariant(.fill)`), view, ON_15).controls?.find(c => c.id === 'symbol:fill')
    expect(around).toMatchObject({ value: 'true' })
    expect(around?.disabledReason).toMatch(/around it/)
    // A name filled before its badge is filled too, and its outline is the name without it.
    const badged = control('Image(systemName: "person.crop.circle.fill.badge.checkmark")', 'symbol:fill')
    expect(badged).toMatchObject({ value: 'true' })
    expect(badged?.disabledReason).toBe('‘person.crop.circle.fill.badge.checkmark’ is the filled symbol. To switch Filled off, choose ‘person.crop.circle.badge.checkmark’ as the symbol.')
    expect(control('Image(systemName: "photo.fill.on.rectangle.fill")', 'symbol:fill')?.disabledReason).toMatch(/choose ‘photo.on.rectangle’/)
    const worked = control('Image(systemName: "heart").symbolVariant(liked ? .fill : .none)', 'symbol:fill', ON_15, '\nlet liked = true\n')
    expect(worked?.disabledReason).toMatch(/Change it in Code\.$/)
  })

  it('is left to Code after an image modifier of the project’s own', () => {
    const own = control('Image(systemName: "heart").tinted()', 'symbol:fill', ON_15, '\nextension Image {\n    func tinted() -> Image { renderingMode(.template) }\n}\n')
    expect(own?.disabledReason).toMatch(/own/)
  })
})

describe('below iOS 15', () => {
  it('shows Rendering and Fill read only, and writes neither', () => {
    for (const id of ['symbol:rendering', 'symbol:fill']) expect(control('Image(systemName: "heart")', id, '14.0')?.disabledReason).toBe('Needs iOS 15 or newer. Change the deployment target to set it.')
    expect(refused('Image(systemName: "heart")', 'symbol:fill', 'true', '14.0')).toMatch(/iOS 15/)
    expect(refused('Image(systemName: "heart")', 'symbol:rendering', 'Hierarchical', '14.0')).toMatch(/iOS 15/)
  })
})

/** Every form Rendering and Fill write, from the cases above, at the oldest iOS they write for. */
const WRITTEN = [
  set('Image(systemName: "star").resizable().frame(width: 40, height: 40)', 'symbol:rendering', 'Multicolor'),
  set('Image(systemName: "person.crop.circle.fill")', 'symbol:rendering', 'Palette'),
  set('Image(systemName: "person.crop.circle.fill").font(.title).foregroundStyle(.red)', 'symbol:rendering', 'Palette'),
  set('Image(systemName: "person.crop.circle.fill").foregroundColor(.red)', 'symbol:rendering', 'Palette'),
  set('Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, Color.gray)', 'symbol:palette:0', 'secondarySystemBackground'),
  set('Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, .gray)', 'symbol:rendering', 'Hierarchical'),
  set('Image(systemName: "heart").resizable().scaledToFit()', 'symbol:fill', 'true'),
  set('Image(systemName: "star").symbolVariant(.circle)', 'symbol:fill', 'true'),
  set('Image(systemName: "star").symbolVariant(.fill.circle)', 'symbol:fill', 'false'),
  set('Image(systemName: "checkmark.circle.fill").foregroundStyle(LinearGradient(colors: [.blue, .green], startPoint: .top, endPoint: .bottom))', 'symbol:rendering', 'Palette'),
]

describe.skipIf(!XCODE)('in Xcode 27', () => {
  it('builds every form written, at iOS 15', () => {
    typecheckInXcode([screen(`        VStack {\n${WRITTEN.map(line => `    ${line}`).join('\n')}\n        }`).replace('import SwiftUI', '// target: iOS 15\nimport SwiftUI')])
  }, 300_000)

  it('refuses each of them at iOS 14, which is why Design gates them at 15', () => {
    for (const line of [WRITTEN[0]!, WRITTEN[1]!, WRITTEN[6]!]) expect(() => typecheckInXcode([screen(line).replace('import SwiftUI', '// target: iOS 14\nimport SwiftUI')])).toThrow(/iOS 15/)
  }, 300_000)
})

/** The checker's word on a one-screen body, as the Problems pane lists it. */
const said = (body: string) => draw(project(screen(body))).diagnostics.filter(d => d.code !== 'runtime_trap').map(d => `${d.severity}: ${d.message}`)

describe('what the checker says of a symbol’s rendering', () => {
  it('says nothing of what is drawn: effects, monochrome and the modes on a symbol drawn in two layers', () => {
    expect(said(`        VStack {
            Image(systemName: "heart").symbolEffect(.bounce, value: 1)
            Image(systemName: "heart").symbolEffect(.disappear)
            Image(systemName: "heart").symbolEffect(.appear.down)
            Image(systemName: "heart").symbolEffect(.scale.up, isActive: false)
            Image(systemName: "heart").symbolEffectsRemoved().symbolEffect(.disappear)
            Image(systemName: "speaker.wave.3.fill").symbolRenderingMode(.hierarchical)
            Image(systemName: "heart").symbolEffectsRemoved()
            Image(systemName: "heart").symbolRenderingMode(.monochrome)
            Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.hierarchical)
            Image(systemName: "person.crop.circle.fill").symbolRenderingMode(.palette).foregroundStyle(.red, .blue)
            Image(systemName: "wifi", variableValue: 0.5)
        }`)).toEqual([])
  })

  it('says plainly where a symbol of one layer stays one color', () => {
    expect(said('        Image(systemName: "heart").symbolRenderingMode(.hierarchical)')).toEqual([
      "warning: The preview draws 'heart' in one color, as its drawing here has one layer. The app draws any layers it has.",
    ])
  })

  it('checks the symbol a variant draws, as the preview draws it', () => {
    expect(said(`        VStack {
            Image(systemName: "heart").symbolVariant(.circle).symbolRenderingMode(.hierarchical)
            Image(systemName: "checkmark").symbolVariant(.circle.fill).symbolRenderingMode(.hierarchical)
            Image(systemName: "heart").symbolRenderingMode(.palette).symbolVariant(.circle)
            VStack { Image(systemName: "checkmark") }.symbolVariant(.circle).symbolRenderingMode(.hierarchical)
        }`)).toEqual([])
    // A variant drawn in one layer is still said.
    expect(said('        Image(systemName: "heart").symbolVariant(.fill).symbolRenderingMode(.hierarchical)')).toEqual([
      "warning: The preview draws 'heart.fill' in one color, as its drawing here has one layer. The app draws any layers it has.",
    ])
  })

  it('says where an effect scales the symbol, which the preview draws at its own size', () => {
    expect(said('        Image(systemName: "heart").symbolEffect(.scale.up)')).toEqual([
      'warning: The preview draws this symbol at its own size. The app scales it while the effect is active.',
    ])
  })

  it('says where the preview has no multicolor drawing, or draws a variable value full', () => {
    expect(said('        Image(systemName: "person").symbolRenderingMode(.multicolor)')).toEqual([
      "warning: The preview has no multicolor drawing for 'person', so it draws it in one color. The app draws any colors of its own.",
    ])
    expect(said('        Image(systemName: "star", variableValue: 0.5)')).toEqual([
      "warning: The preview draws 'star' in full, whatever its variable value. The app fills it part way where the symbol can be.",
    ])
  })
})

describe('an unknown symbol’s name', () => {
  it('still suggests the nearest drawn name, from the larger set', () => {
    expect(said('        Image(systemName: "trophx")')).toEqual([
      "warning: The preview has no drawing for the symbol 'trophx' and shows a question mark. Did you mean 'trophy'? If 'trophx' is right, it still shows in the app.",
    ])
  })
})
