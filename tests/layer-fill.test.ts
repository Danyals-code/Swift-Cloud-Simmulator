import { beforeEach, describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import type { ColorValue, Fill, FillValue, LayerProperties, RenderNode } from '@studio/shared'
import { XCODE, bodyOf, layerOf, planLayer, project, screen, setLayer, text, typecheckInXcode } from './helpers/layer-project'

/**
 * A view's Fill (doc 18, Wave 2): its first background, or a shape's own fill, read as one
 * colour, gradient, material or Liquid Glass however it is spelled, and written back as
 * the plainest Swift for the project's iOS version.
 */
beforeEach(resetPipelineState)

const TOKENS = `
let isOn = true
enum Theme {
    static let accent = Color.blue
}
extension Color {
    static let brand = Color(red: 0.2, green: 0.4, blue: 0.6)
}
extension ShapeStyle where Self == Color {
    static var brand: Color { Color(red: 0.2, green: 0.4, blue: 0.6) }
}
`

const fillOf = (body: string, name = 'Text', target?: string): NonNullable<LayerProperties['fill']> => {
  const fill = layerOf(project(screen(`        ${body}`, TOKENS)), name, 0, target).fill
  if (!fill) throw new Error(`${name} has no fill section`)
  return fill
}
const solid = (color: Extract<FillValue, { kind: 'color' }>['color']): FillValue => ({ kind: 'color', color })

describe('reading a colour fill', () => {
  it.each([
    ['a system name', 'Text("A").background(.red)', { name: 'red' }],
    ['a system name on Color', 'Text("A").background(Color.red)', { name: 'red' }],
    ['a UIKit colour', 'Text("A").background(Color(.systemGray6))', { name: 'systemGray6' }],
    ['the accent colour', 'Text("A").background(Color.accentColor)', { name: 'accentColor' }],
    ['a hierarchical style', 'Text("A").background(.tertiary)', { name: 'tertiary' }],
    ['red, green and blue with an opacity', 'Text("A").background(Color(red: 1, green: 0.5, blue: 0, opacity: 0.5))', { hex: '#FF8000', opacity: 0.5 }],
    ['red, green and blue', 'Text("A").background(Color(red: 0.039, green: 0.518, blue: 1))', { hex: '#0A84FF' }],
    ['a name with an opacity', 'Text("A").background(.blue.opacity(0.5))', { name: 'blue', opacity: 0.5 }],
  ])('reads %s', (_, body, color) => {
    expect(fillOf(body)).toMatchObject({ value: solid(color), state: 'literal' })
  })

  it.each([
    ['an asset colour', 'Text("A").background(Color("Brand"))', 'Color("Brand")'],
    ['a constant', 'Text("A").background(Theme.accent)', 'Theme.accent'],
    ['a Color extension member', 'Text("A").background(.brand)', '.brand'],
    ['a Color extension member on Color', 'Text("A").background(Color.brand)', 'Color.brand'],
  ])('keeps %s linked, as written', (_, body, token) => {
    expect(fillOf(body)).toMatchObject({ value: solid({ token }), state: 'token' })
  })

  it('keeps a token linked under an opacity', () => {
    expect(fillOf('Text("A").background(Theme.accent.opacity(0.3))')).toMatchObject({ value: solid({ token: 'Theme.accent', opacity: 0.3 }), state: 'token' })
  })

  it('has no fill when nothing paints one', () => {
    expect(fillOf('Text("A").padding(8)')).toMatchObject({ value: null, state: 'absent' })
  })

  it('claims the background it read for the Fill section', () => {
    const layer = layerOf(project(screen('        Text("A").padding(8).background(.red)')), 'Text')
    expect(Object.entries(layer.claimed).filter(([, section]) => section === 'fill')).toHaveLength(1)
    expect(layer.fill?.from).toHaveLength(1)
    expect(layer.claimed[layer.fill!.from![0]!]).toBe('fill')
  })
})

const written = (body: string, fill: FillValue | null, name = 'Text', target?: string) =>
  bodyOf(setLayer(project(screen(`        ${body}`, TOKENS)), name, [{ section: 'fill', fill }], 0, target))
const refusal = (body: string, fill: FillValue | null, name = 'Text', target?: string) => {
  const plan = planLayer(project(screen(`        ${body}`, TOKENS)), name, [{ section: 'fill', fill }], 0, target)
  return plan.ok ? 'written' : plan.reason
}

describe('writing a colour', () => {
  it.each([
    ['a system name, as a ShapeStyle names it', { name: 'red' }, '.red'],
    ['a UIKit colour', { name: 'systemGray6' }, 'Color(.systemGray6)'],
    ['the accent colour, which only Color has', { name: 'accentColor' }, 'Color.accentColor'],
    ['a hierarchical style', { name: 'tertiary' }, '.tertiary'],
    ['a name with an opacity', { name: 'blue', opacity: 0.5 }, '.blue.opacity(0.5)'],
    ['a hex', { hex: '#0A84FF' }, 'Color(red: 0.039, green: 0.518, blue: 1)'],
    ['a hex with its alpha', { hex: '#FF000080' }, 'Color(red: 1, green: 0, blue: 0, opacity: 0.502)'],
    ['a hex with an opacity', { hex: '#0A84FF', opacity: 0.5 }, 'Color(red: 0.039, green: 0.518, blue: 1, opacity: 0.5)'],
    ['a token, as it is written', { token: 'Theme.accent' }, 'Theme.accent'],
    ['a token with an opacity', { token: '.brand', opacity: 0.25 }, '.brand.opacity(0.25)'],
  ])('writes %s in the background it changes', (_, color, expected) => {
    expect(written('Text("A").padding(8).background(Color.blue)', solid(color))).toBe(`        Text("A").padding(8).background(${expected})`)
  })

  it('writes Color where a view is taken, below iOS 15', () => {
    expect(written('Text("A").background(Color.blue)', solid({ name: 'red' }), 'Text', '14.0')).toBe('        Text("A").background(Color.red)')
    expect(written('Text("A").background(Color.blue)', solid({ token: '.brand' }), 'Text', '14.0')).toBe('        Text("A").background(Color.brand)')
  })

  it.each([
    ['a colour newer than the project', 'Text("A").background(Color.blue)', solid({ name: 'mint' }), '14.0', /Mint needs iOS 15/],
    ['a style below iOS 15', 'Text("A").background(Color.blue)', solid({ name: 'tertiary' }), '14.0', /Tertiary needs iOS 15/],
    ['a hex that is not one', 'Text("A").background(Color.blue)', solid({ hex: '#12' }), undefined, /hex color such as/],
    ['an opacity over 100%', 'Text("A").background(Color.blue)', solid({ name: 'red', opacity: 2 }), undefined, /between 0 and 100%/],
    ['a token that is no token', 'Text("A").background(Color.blue)', solid({ token: 'red); fatalError(' }), undefined, /Choose it from the list/],
  ])('refuses %s', (_, body, fill, target, reason) => {
    expect(refusal(body, fill, 'Text', target)).toMatch(reason)
  })

  it('writes nothing when the value is unchanged, however it was spelled', () => {
    const plan = planLayer(project(screen('        Text("A").background(Color(red: 1, green: 0, blue: 0, opacity: 0.5))')), 'Text', [{ section: 'fill', fill: solid({ hex: '#FF0000', opacity: 0.5 }) }])
    expect(plan).toMatchObject({ ok: true, changes: [] })
  })
})

describe('adding and removing a fill', () => {
  it.each([
    ['after the padding, as a background', 'Text("A").font(.title).padding(8)', 'Text("A").font(.title).padding(8).background(.red)'],
    ['inside the clip and the margin', 'Text("A").padding(8).clipShape(.rect(cornerRadius: 8)).padding(4)', 'Text("A").padding(8).background(.red).clipShape(.rect(cornerRadius: 8)).padding(4)'],
    ['before the effects', 'Text("A").padding(8).opacity(0.5)', 'Text("A").padding(8).background(.red).opacity(0.5)'],
  ])('adds one %s', (_, body, expected) => {
    expect(written(body, solid({ name: 'red' }))).toBe(`        ${expected}`)
  })

  it('adds an Image’s background after its own calls', () => {
    expect(written('Image("logo").resizable()', solid({ name: 'red' }), 'Image')).toBe('        Image("logo").resizable().background(.red)')
  })

  it('writes on a line of its own where the chain has them', () => {
    expect(written('Text("A")\n            .padding(8)\n            .opacity(0.5)', solid({ name: 'red' })))
      .toBe('        Text("A")\n            .padding(8)\n            .background(.red)\n            .opacity(0.5)')
  })

  it.each([
    ['a plain shape', 'Circle()', 'Circle().fill(.red)'],
    ['a shape with a size', 'Circle().frame(width: 40, height: 40)', 'Circle().fill(.red).frame(width: 40, height: 40)'],
    ['a stroked shape', 'Circle().stroke(.blue, lineWidth: 2)', 'Circle().fill(.red).stroke(.blue, lineWidth: 2)'],
  ])('fills %s with its own .fill', (_, body, expected) => {
    expect(written(body, solid({ name: 'red' }), 'Circle')).toBe(`        ${expected}`)
  })

  it('refuses a fill under a stroke before iOS 17', () => {
    expect(refusal('Circle().stroke(.blue, lineWidth: 2)', solid({ name: 'red' }), 'Circle', '16.0')).toMatch(/iOS 17/)
  })

  it('changes the foreground a shape is filled with, where it is', () => {
    expect(written('Capsule().frame(height: 4).foregroundStyle(.gray)', solid({ name: 'red' }), 'Capsule')).toBe('        Capsule().frame(height: 4).foregroundStyle(.red)')
    expect(fillOf('Capsule().stroke(lineWidth: 2).foregroundStyle(.gray)', 'Capsule')).toMatchObject({ value: null, state: 'absent' })
  })

  it.each([
    ['a background', 'Text("A").padding(8).background(.red).opacity(0.5)', 'Text', 'Text("A").padding(8).opacity(0.5)'],
    ['a shape’s fill', 'Circle().fill(.red).frame(width: 40)', 'Circle', 'Circle().frame(width: 40)'],
  ])('takes away %s', (_, body, name, expected) => {
    expect(written(body, null, name)).toBe(`        ${expected}`)
  })

  it('places nothing new in a chain with a modifier it does not know, but changes the fill that is there', () => {
    const declarations = '\nextension View {\n    func glow() -> some View { shadow(radius: 2) }\n}\n'
    const files = (body: string) => project(screen(`        ${body}`, declarations))
    const refused = planLayer(files('Text("A").glow()'), 'Text', [{ section: 'fill', fill: solid({ name: 'red' }) }])
    expect(refused).toMatchObject({ ok: false, reason: expect.stringMatching(/does not know/) })
    expect(bodyOf(setLayer(files('Text("A").background(.blue).glow()'), 'Text', [{ section: 'fill', fill: solid({ name: 'red' }) }]))).toBe('        Text("A").background(.red).glow()')
  })
})

type Gradient = Extract<FillValue, { kind: 'gradient' }>
const RED: ColorValue = { name: 'red' }, BLUE: ColorValue = { name: 'blue' }
const linear = (angle: number, stops: Gradient['stops'] = [{ color: RED, location: 0 }, { color: BLUE, location: 1 }]): Gradient => ({ kind: 'gradient', type: 'linear', stops, angle })

describe('gradients', () => {
  it.each([
    ['colors and points', 'LinearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .bottom)', linear(0)],
    ['a Gradient of colors', 'LinearGradient(gradient: Gradient(colors: [.red, .blue]), startPoint: .leading, endPoint: .trailing)', linear(270)],
    ['stops', 'LinearGradient(stops: [Gradient.Stop(color: .red, location: 0), .init(color: .blue, location: 0.7)], startPoint: .topLeading, endPoint: .bottomTrailing)', linear(315, [{ color: RED, location: 0 }, { color: BLUE, location: 0.7 }])],
    ['a Gradient of stops', 'LinearGradient(gradient: Gradient(stops: [.init(color: .red, location: 0.2), .init(color: .blue, location: 1)]), startPoint: .trailing, endPoint: .leading)', linear(90, [{ color: RED, location: 0.2 }, { color: BLUE, location: 1 }])],
    ['the ShapeStyle spelling', '.linearGradient(colors: [.red, .blue], startPoint: .bottom, endPoint: .top)', linear(180)],
    ['points between the named ones', 'LinearGradient(colors: [.red, .blue], startPoint: UnitPoint(x: 0.75, y: 0), endPoint: UnitPoint(x: 0.25, y: 1))', linear(26.565051)],
    ['a radial gradient', 'RadialGradient(colors: [.red, .blue], center: .center, startRadius: 0, endRadius: 80)', { kind: 'gradient', type: 'radial', stops: linear(0).stops, center: { x: 0.5, y: 0.5 }, startRadius: 0, endRadius: 80 }],
    ['an angular gradient', 'AngularGradient(colors: [.red, .blue], center: .top)', { kind: 'gradient', type: 'angular', stops: linear(0).stops, center: { x: 0.5, y: 0 } }],
    ['a colour’s own gradient', '.red.gradient', { kind: 'gradient', type: 'linear', stops: [{ color: RED, location: 0 }], angle: 0, automatic: true }],
  ])('reads %s', (_, style, fill) => {
    expect(fillOf(`Text("A").background(${style})`)).toMatchObject({ value: fill, state: 'literal' })
  })

  it.each([
    ['points that are not opposite each other', 'LinearGradient(colors: [.red, .blue], startPoint: .top, endPoint: .center)'],
    ['a computed colour', 'LinearGradient(colors: [.red, isOn ? .blue : .green], startPoint: .top, endPoint: .bottom)'],
    ['an elliptical gradient', 'EllipticalGradient(colors: [.red, .blue])'],
  ])('leaves %s to Code', (_, style) => {
    expect(fillOf(`Text("A").background(${style})`)).toMatchObject({ value: null, state: 'code', disabledReason: expect.stringMatching(/Change it in Code/) })
  })

  it.each([
    [0, '.top', '.bottom'], [45, '.topTrailing', '.bottomLeading'], [90, '.trailing', '.leading'], [135, '.bottomTrailing', '.topLeading'],
    [180, '.bottom', '.top'], [225, '.bottomLeading', '.topTrailing'], [270, '.leading', '.trailing'], [315, '.topLeading', '.bottomTrailing'],
    [-90, '.leading', '.trailing'], [30, 'UnitPoint(x: 0.789, y: 0)', 'UnitPoint(x: 0.211, y: 1)'], [100, 'UnitPoint(x: 1, y: 0.588)', 'UnitPoint(x: 0, y: 0.412)'],
  ])('writes %d degrees as the points it runs between', (angle, start, end) => {
    expect(written('Text("A").background(.red)', linear(angle))).toBe(`        Text("A").background(LinearGradient(colors: [Color.red, Color.blue], startPoint: ${start}, endPoint: ${end}))`)
  })

  it('writes stops where they are not evenly spaced', () => {
    expect(written('Text("A").background(.red)', linear(0, [{ color: RED, location: 0 }, { color: { hex: '#0A84FF' }, location: 0.7 }])))
      .toBe('        Text("A").background(LinearGradient(stops: [Gradient.Stop(color: Color.red, location: 0), Gradient.Stop(color: Color(red: 0.039, green: 0.518, blue: 1), location: 0.7)], startPoint: .top, endPoint: .bottom))')
  })

  it.each([
    ['radial', { kind: 'gradient', type: 'radial', stops: linear(0).stops, center: { x: 0.5, y: 0.5 }, startRadius: 0, endRadius: 80 }, 'RadialGradient(colors: [Color.red, Color.blue], center: .center, startRadius: 0, endRadius: 80)'],
    ['angular', { kind: 'gradient', type: 'angular', stops: linear(0).stops, center: { x: 0.25, y: 0.5 } }, 'AngularGradient(colors: [Color.red, Color.blue], center: UnitPoint(x: 0.25, y: 0.5))'],
    ['a colour’s own', { kind: 'gradient', type: 'linear', stops: [{ color: BLUE, location: 0 }], angle: 0, automatic: true }, '.blue.gradient'],
  ] as const)('writes a %s gradient', (_, fill, expected) => {
    expect(written('Text("A").background(.red)', fill as FillValue)).toBe(`        Text("A").background(${expected})`)
  })

  it('keeps the colours it did not change as they were written', () => {
    expect(written('Text("A").background(LinearGradient(colors: [Theme.accent, .blue], startPoint: .top, endPoint: .bottom))', linear(0, [{ color: { token: 'Theme.accent' }, location: 0 }, { color: { name: 'green' }, location: 1 }])))
      .toBe('        Text("A").background(LinearGradient(colors: [Theme.accent, Color.green], startPoint: .top, endPoint: .bottom))')
  })

  it.each([
    [linear(0), linear(30), linear(30, [{ color: RED, location: 0 }, { color: BLUE, location: 0.4 }, { color: { hex: '#FFCC00', opacity: 0.5 }, location: 1 }])],
  ])('reads back what it writes', (...fills) => {
    for (const fill of fills) {
      const files = setLayer(project(screen('        Text("A").background(.red)')), 'Text', [{ section: 'fill', fill }])
      expect(layerOf(files, 'Text').fill?.value).toMatchObject({ ...fill, angle: expect.closeTo((fill as { angle: number }).angle, 1) })
    }
  })

  it.each([
    ['one stop', linear(0, [{ color: RED, location: 0 }]), undefined, /two or more stops/],
    ['a stop past the end', linear(0, [{ color: RED, location: 0 }, { color: BLUE, location: 1.5 }]), undefined, /between 0 and 100%/],
    ['a style among the colours', linear(0, [{ color: { name: 'tertiary' }, location: 0 }, { color: BLUE, location: 1 }]), undefined, /can’t go here/],
    ['a colour’s own gradient before iOS 16', { kind: 'gradient', type: 'linear', stops: [{ color: BLUE, location: 0 }], angle: 0, automatic: true }, '15.0', /iOS 16/],
  ] as const)('refuses %s', (_, fill, target, reason) => {
    expect(refusal('Text("A").background(.red)', fill as FillValue, 'Text', target)).toMatch(reason)
  })
})

describe('materials', () => {
  it.each([
    ['.ultraThinMaterial', 'ultraThin'],
    ['Material.thick', 'thick'],
  ])('reads %s', (style, thickness) => {
    expect(fillOf(`Text("A").background(${style})`)).toMatchObject({ value: { kind: 'material', thickness }, state: 'literal' })
  })

  it('writes a material as the background’s style, in the spelling it had', () => {
    expect(written('Text("A").padding(8).background(.red)', { kind: 'material', thickness: 'regular' })).toBe('        Text("A").padding(8).background(.regularMaterial)')
    expect(written('Text("A").background(Material.thin)', { kind: 'material', thickness: 'thick' })).toBe('        Text("A").background(Material.thick)')
  })

  it('keeps the shape a background is drawn in when the kind changes', () => {
    expect(written('Text("A").background(.red, in: RoundedRectangle(cornerRadius: 8))', { kind: 'material', thickness: 'ultraThin' }))
      .toBe('        Text("A").background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))')
  })

  it('offers no material below iOS 15', () => {
    expect(fillOf('Text("A")', 'Text', '14.0').unavailable?.material).toMatch(/Materials need iOS 15/)
    expect(refusal('Text("A").background(Color.red)', { kind: 'material', thickness: 'regular' }, 'Text', '14.0')).toMatch(/Materials need iOS 15/)
  })
})

describe('Liquid Glass', () => {
  it.each([
    ['plain glass', '.glassEffect()', { kind: 'glass', variant: 'regular' }],
    ['clear glass in a shape', '.glassEffect(.clear, in: Circle())', { kind: 'glass', variant: 'clear' }],
    ['tinted, interactive glass', '.glassEffect(.regular.tint(.blue).interactive())', { kind: 'glass', variant: 'regular', tint: BLUE, interactive: true }],
  ])('reads %s', (_, call, fill) => {
    expect(fillOf(`Text("A").padding(8)${call}`)).toMatchObject({ value: fill, state: 'literal' })
  })

  it('turns a background into glass, keeping the shape it is drawn in', () => {
    expect(written('Text("A").padding(8).background(.red, in: RoundedRectangle(cornerRadius: 12))', { kind: 'glass', variant: 'regular' }))
      .toBe('        Text("A").padding(8).glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))')
    expect(written('Text("A").padding(8).background(.red)', { kind: 'glass', variant: 'clear', tint: BLUE, interactive: true }))
      .toBe('        Text("A").padding(8).glassEffect(.clear.tint(Color.blue).interactive(), in: .rect)')
  })

  it('adds glass in the layer’s rectangle', () => {
    expect(written('Text("A").padding(8)', { kind: 'glass', variant: 'regular' })).toBe('        Text("A").padding(8).glassEffect(.regular, in: .rect)')
  })

  it('changes glass in place, and turns it back into a background in its shape', () => {
    expect(written('Text("A").padding(8).glassEffect()', { kind: 'glass', variant: 'clear' })).toBe('        Text("A").padding(8).glassEffect(.clear)')
    expect(written('Text("A").padding(8).glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))', { kind: 'material', thickness: 'thin' }))
      .toBe('        Text("A").padding(8).background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))')
    expect(written('Text("A").padding(8).glassEffect()', solid(RED))).toBe('        Text("A").padding(8).background(.red, in: .capsule)')
  })

  it('offers glass only from iOS 26, and never as a shape’s fill', () => {
    expect(fillOf('Text("A")', 'Text', '18.0').unavailable?.glass).toBe('Glass needs iOS 26. Use a Material, or raise the deployment target.')
    expect(fillOf('Text("A")', 'Text', '18.0').unavailable?.material).toBeUndefined()
    expect(refusal('Text("A").background(.red)', { kind: 'glass', variant: 'regular' }, 'Text', '18.0')).toBe('Glass needs iOS 26. Use a Material, or raise the deployment target.')
    expect(fillOf('Circle()', 'Circle').unavailable?.glass).toMatch(/shape can’t be filled with Liquid Glass/)
  })
})

describe('what the Fill section leaves to Code', () => {
  it.each([
    ['a background written as a view', 'Text("A").background { Color.red }', /view written in Swift/],
    ['a comment in the fill', 'Text("A").background(/* brand */ .red)', /comment/],
    ['a computed colour', 'Text("A").background(isOn ? Color.red : Color.blue)', /worked out in Swift/],
    ['glass the panel does not offer', 'Text("A").glassEffect(.identity)', /worked out in Swift/],
    ['a background and glass both', 'Text("A").background(.red).glassEffect()', /background and Liquid Glass/],
  ])('shows %s and refuses to change it', (_, body, reason) => {
    const fill = fillOf(body)
    expect(fill.state).toBe('code')
    expect(fill.disabledReason).toMatch(reason)
    expect(refusal(body, solid(BLUE))).toMatch(reason)
  })

  it('shows a colour a view is given as data, and leaves it to Code', () => {
    const files = project(screen('        Badge(color: .green)', '\nstruct Badge: View {\n    let color: Color\n    var body: some View { Text("New").background(color) }\n}\n'))
    expect(layerOf(files, 'Text').fill).toMatchObject({ value: null, state: 'code', disabledReason: expect.stringMatching(/worked out in Swift/) })
  })

  it('leaves a Card’s own fill to the card', () => {
    expect(refusal('GroupBox("Club") {\n            Text("A")\n        }', solid(BLUE), 'GroupBox')).toMatch(/Card draws its own fill/)
  })
})

describe('the preview draws what the Fill section writes', () => {
  /** The render tree after one fill change, compiled the way the canvas compiles it. */
  const drawn = (body: string, fill: FillValue, name = 'Text'): readonly RenderNode[] => {
    const files = setLayer(project(screen(`        ${body}`, TOKENS)), name, [{ section: 'fill', fill }])
    const result = compile({ files: files.map(file => ({ id: file.id, text: file.text })), revision: 1, canvas: { width: 393, height: 852 }, colorScheme: 'light', safeArea: { top: 0, bottom: 0, leading: 0, trailing: 0 } })
    expect(result.diagnostics.filter(d => d.severity === 'error').map(d => d.message)).toEqual([])
    return result.renderTree!.nodes
  }
  const backgrounds = (nodes: readonly RenderNode[]): Fill[] => nodes.flatMap(node => node.background ? [node.background] : node.shape?.fill ? [node.shape.fill] : [])

  it('a hex with its alpha, translucent', () => {
    expect(backgrounds(drawn('Text("A").padding(8)', solid({ hex: '#FF000080' })))).toContainEqual({ kind: 'solid', color: { r: 255, g: 0, b: 0, a: expect.closeTo(0.502, 3) } })
  })

  it('a gradient at an angle between the named points, as the points it runs between', () => {
    const fills = backgrounds(drawn('Text("A").padding(8)', linear(30)))
    expect(fills).toContainEqual(expect.objectContaining({ kind: 'linearGradient', start: { x: 0.789, y: 0 }, end: { x: 0.211, y: 1 } }))
  })

  it('stops where they were placed', () => {
    const fill = backgrounds(drawn('Circle()', linear(0, [{ color: RED, location: 0 }, { color: BLUE, location: 0.7 }]), 'Circle')).find(fill => fill.kind === 'linearGradient')
    expect(fill && 'stops' in fill ? fill.stops.map(stop => stop.location) : []).toEqual([0, 0.7])
  })

  it('a material, as a translucent backdrop', () => {
    expect(drawn('Text("A").padding(8)', { kind: 'material', thickness: 'thin' }).some(node => !!node.material)).toBe(true)
  })
})

describe.skipIf(!XCODE)('what the Fill section writes builds in Xcode 27', () => {
  /** The whole file after one fill change, at the iOS version given, which the type-check reads from its first line. */
  const source = (body: string, fill: FillValue | null, name = 'Text', target = '27.0') =>
    text(setLayer(project(`// target: iOS ${target}\n` + screen(`        ${body}`, TOKENS)), name, [{ section: 'fill', fill }], 0, target))
  const glass = (fill: Partial<Extract<FillValue, { kind: 'glass' }>>): FillValue => ({ kind: 'glass', variant: 'regular', ...fill })

  it('for every colour, gradient, material and glass form', () => {
    const sources = [
      ...[RED, { name: 'systemGray6' }, { name: 'accentColor' }, { name: 'tertiary' }, { name: 'blue', opacity: 0.5 }, { hex: '#0A84FF' }, { hex: '#FF000080' }, { hex: '#0A84FF', opacity: 0.5 }, { token: 'Theme.accent' }, { token: '.brand', opacity: 0.25 }, { token: 'Color.brand' }]
        .map(color => source('Text("A").padding(8).background(Color.blue)', solid(color))),
      source('Text("A").background(Color.blue)', solid(RED), 'Text', '14.0'),
      source('Text("A").background(Color.blue)', solid({ token: '.brand' }), 'Text', '14.0'),
      source('Text("A").background(Color.blue)', solid({ name: 'tertiary' }), 'Text', '15.0'),
      source('Text("A").padding(8)', solid(RED)),
      source('Text("A")\n            .padding(8)\n            .opacity(0.5)', solid(RED)),
      source('Image(systemName: "star").resizable()', solid(RED), 'Image'),
      source('Circle().frame(width: 40, height: 40)', solid(RED), 'Circle'),
      source('Circle().frame(width: 40, height: 40)', solid(RED), 'Circle', '14.0'),
      source('Circle().stroke(.blue, lineWidth: 2)', solid(RED), 'Circle', '17.0'),
      source('Capsule().frame(height: 4).foregroundStyle(.gray)', solid(RED), 'Capsule', '15.0'),
      source('Capsule().frame(height: 4).foregroundColor(.gray)', linear(0), 'Capsule', '15.0'),
      ...[linear(0), linear(30), linear(100, [{ color: RED, location: 0 }, { color: { hex: '#0A84FF' }, location: 0.7 }])]
        .map(fill => source('Text("A").background(.red)', fill)),
      source('Text("A").background(Color.red)', linear(45), 'Text', '13.0'),
      source('Text("A").background(.red)', { kind: 'gradient', type: 'radial', stops: linear(0).stops, center: { x: 0.5, y: 0.5 }, startRadius: 0, endRadius: 80 }),
      source('Text("A").background(.red)', { kind: 'gradient', type: 'angular', stops: linear(0).stops, center: { x: 0.25, y: 0.5 } }),
      source('Text("A").background(.red)', { kind: 'gradient', type: 'linear', stops: [{ color: BLUE, location: 0 }], angle: 0, automatic: true }, 'Text', '16.0'),
      source('Circle()', linear(0), 'Circle', '13.0'),
      source('Text("A").background(.red)', { kind: 'material', thickness: 'regular' }, 'Text', '15.0'),
      source('Text("A").background(Material.thin)', { kind: 'material', thickness: 'thick' }, 'Text', '15.0'),
      source('Text("A").background(.red, in: RoundedRectangle(cornerRadius: 8))', { kind: 'material', thickness: 'ultraThin' }, 'Text', '15.0'),
      source('Text("A").padding(8).background(.red, in: RoundedRectangle(cornerRadius: 12))', glass({}), 'Text', '26.0'),
      source('Text("A").padding(8).background(.red)', glass({ variant: 'clear', tint: BLUE, interactive: true }), 'Text', '26.0'),
      source('Text("A").padding(8)', glass({}), 'Text', '26.0'),
      source('Text("A").padding(8).glassEffect()', glass({ variant: 'clear' }), 'Text', '26.0'),
      source('Text("A").padding(8).glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12))', { kind: 'material', thickness: 'thin' }, 'Text', '26.0'),
      source('Text("A").padding(8).glassEffect()', solid(RED), 'Text', '26.0'),
    ]
    typecheckInXcode(sources)
    expect(sources).toHaveLength(39)
  }, 600_000)
})
