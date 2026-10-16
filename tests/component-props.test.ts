import { describe, expect, it } from 'vitest'
import type { AuthoringNode, DesignEditRequest } from '@studio/shared'
import { buildAuthoringModel } from '@studio/swift-sema'
import { APP, XCODE, draw, edited, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Components' props and variants (Wave 5b): a value of a Main each copy can set, of each
 * kind a designer changes, and a variant property with values that differ by it. Read and
 * written through the authoring model and the edit planner, as the panel does, and drawn.
 */

/** A screen with two copies of `main`, the first written as `first`. */
const withCopies = (main: string, first = 'Badge()', second = 'Badge()') => screen(`        VStack {\n            ${first}\n            ${second}\n        }`, main)
/** The Main `Badge`, from its declaration to the end of the file. */
const mainOf = (source: string) => source.slice(source.indexOf('struct Badge'))
/** Every form written, for the Xcode check. */
const written: string[] = []
const draws = (source: string) => {
  expect(draw(project(source)).diagnostics.filter(d => d.severity === 'error')).toEqual([])
  written.push(source)
  return source
}
/** BADGE's Text, as written. */
const TEXT = 'Text(title)\n                .foregroundStyle(.red)\n                .padding(8)'
const expose = (source: string, view: string, as: NonNullable<Extract<DesignEditRequest['operation'], { kind: 'component-expose' }>['as']>, control: string, name = '') => edited(source, view, { kind: 'component-expose', control, name, as })

const BADGE = `
struct Badge: View {
    var title: String = "New"

    var body: some View {
        HStack {
            Image(systemName: "star")
            Image("hero")
            Text(title)
                .foregroundStyle(.red)
                .padding(8)
        }
    }
}
`

describe('Changeable per copy: each kind', () => {
  it('makes a symbol an input, used as the image’s system name', () => {
    const after = draws(expose(withCopies(BADGE), 'Image(systemName: "star")', 'symbol', 'image', 'icon'))
    expect(mainOf(after)).toContain('    var title: String = "New"\n    var icon: String = "star"\n\n    var body: some View {')
    expect(mainOf(after)).toContain('            Image(systemName: icon)\n')
  })
})

describe('Changeable per copy: each kind, continued', () => {
  const source = withCopies(BADGE, 'Badge(title: "Old")')

  it('makes an asset image an input, used as the image’s name', () => {
    const after = draws(expose(source, 'Image("hero")', 'image', 'image', 'artwork'))
    expect(mainOf(after)).toContain('    var title: String = "New"\n    var artwork: String = "hero"\n')
    expect(mainOf(after)).toContain('            Image(artwork)\n')
  })

  it('makes a colour an input, used where the colour was', () => {
    const after = draws(expose(source, 'Text(title)\n                .foregroundStyle(.red)\n                .padding(8)', 'color', 'modifier:0:0', 'tint'))
    expect(mainOf(after)).toContain('    var tint: Color = .red\n')
    expect(mainOf(after)).toContain('                .foregroundStyle(tint)\n')
  })

  it('makes a number an input, as a CGFloat', () => {
    const after = draws(expose(source, 'Text(title)\n                .foregroundStyle(.red)\n                .padding(8)', 'number', 'modifier:1:0', 'padding'))
    expect(mainOf(after)).toContain('    var padding: CGFloat = 8\n')
    expect(mainOf(after)).toContain('                .padding(padding)\n')
  })

  it('makes whether a view is shown an input, wrapping it in if', () => {
    const after = draws(expose(source, 'Image("hero")', 'shown', '', 'showsHero'))
    expect(mainOf(after)).toContain('    var title: String = "New"\n    var showsHero: Bool = true\n')
    expect(mainOf(after)).toContain('            if showsHero {\n                Image("hero")\n            }\n')
    expect(after).not.toContain('@State')
  })

  it('takes the kind’s own name, numbered past a taken one, when none is given', () => {
    const taken = withCopies(BADGE.replace('    var title: String = "New"\n', '    var title: String = "New"\n    var icon: String = "bolt"\n'))
    expect(mainOf(edited(taken, 'Image(systemName: "star")', { kind: 'component-expose', control: 'image', name: '', as: 'symbol' }))).toContain('    var icon2: String = "star"\n')
    // A number is named for what it sets, and Shown for the view it shows.
    expect(mainOf(expose(source, TEXT, 'number', 'modifier:1:0'))).toContain('    var padding: CGFloat = 8\n')
    expect(mainOf(expose(source, 'Image("hero")', 'shown', ''))).toContain('    var showsImage: Bool = true\n')
  })

  it('says on each value in the Main what it can become, and on nothing outside one', () => {
    const exposeAs = (view: string, id: string, from = source) => control(viewWritten(from, view), id)?.exposeAs
    expect(exposeAs('Image(systemName: "star")', 'image')).toBe('symbol')
    expect(exposeAs('Image("hero")', 'image')).toBe('image')
    expect(exposeAs(TEXT, 'modifier:0:0')).toBe('color')
    expect(exposeAs(TEXT, 'modifier:1:0')).toBe('number')
    expect(exposeAs('Text("A")\n                .padding(8)', 'modifier:0:0', screen('        VStack {\n            Text("A")\n                .padding(8)\n        }'))).toBeUndefined()
  })

  it('refuses what it can’t write, saying why', () => {
    expect(refusal(source, 'Image("hero")', { kind: 'component-expose', control: 'image', name: 'icon', as: 'symbol' })).toBe('Only a symbol written by its name can become a symbol input here. Change it in Code.')
    expect(refusal(source, 'Image(systemName: "star")', { kind: 'component-expose', control: 'image', name: 'title', as: 'symbol' })).toBe('Choose an unused input name on a component without a custom initializer.')
    const withInit = withCopies(BADGE.replace('    var body', '    init() {}\n\n    var body'))
    expect(refusal(withInit, 'Image(systemName: "star")', { kind: 'component-expose', control: 'image', name: 'icon', as: 'symbol' })).toBe('Badge has an init of its own, which every copy calls. Add the input in Code.')
  })
})

const PILL = `
struct Pill: View {
    var title: String
    var icon: String = "star"
    var artwork: String = "hero"
    var tint: Color = .blue

    var body: some View {
        HStack {
            Image(systemName: icon)
            Image(artwork)
            Label(title, systemImage: icon)
            Text(title)
        }
        .background(tint)
    }
}

extension Color {
    static let brand = Color.orange
}
`
/** A copy of Pill on the screen, as the panel receives it. */
const copy = (source: string, call: string) => viewWritten(source, call, '17.0')
const control = (node: AuthoringNode, id: string) => node.controls?.find(c => c.id === id)

describe('Shown when inside a Main', () => {
  const source = withCopies(BADGE)

  it('offers a new on/off property, which each copy sets, and none on a screen', () => {
    expect(viewWritten(source, 'Image("hero")').visibility).toMatchObject({ property: true, editable: true })
    expect(viewWritten(screen('        VStack {\n            Text("A")\n            Text("B")\n        }'), 'Text("A")').visibility?.property).toBeUndefined()
    const after = draws(edited(source, 'Image("hero")', { kind: 'visibility', when: { input: 'showsArt', is: false }, create: { name: 'showsArt', value: false } }))
    expect(mainOf(after)).toContain('    var title: String = "New"\n    var showsArt: Bool = false\n')
    expect(mainOf(after)).toContain('            if !showsArt {\n                Image("hero")\n            }\n')
  })
})

describe('Shown when on a screen placed in another view', () => {
  const view = (name: string, body: string) => `\nstruct ${name}: View {\n    var body: some View {\n${body}\n    }\n}\n`
  const stack = (first: string) => `        VStack {\n            Text("${first}")\n            Text("Two")\n        }`
  const source = `import SwiftUI\n\n@main\nstruct DemoApp: App {\n    var body: some Scene {\n        WindowGroup {\n            RootView()\n        }\n    }\n}\n`
    + view('RootView', '        MainTabs()\n            .tint(.indigo)')
    + view('MainTabs', '        TabView {\n            Group {\n                HomeView()\n            }\n            .tabItem { Label("Home", systemImage: "house") }\n            PlainTab()\n                .tabItem { Label("Plain", systemImage: "star") }\n        }')
    + view('HomeView', '        List {\n            NavigationLink("Go") { TitledDetail() }\n            NavigationLink { LabelledDetail() } label: { Text("More") }\n            NavigationLink(destination: ArgumentDetail()) { Text("Most") }\n            Badge()\n            Text("Sheet")\n                .sheet(isPresented: .constant(false)) { SheetView() }\n        }')
    + ['PlainTab', 'TitledDetail', 'LabelledDetail', 'ArgumentDetail', 'SheetView', 'Badge'].map(name => view(name, stack(name))).join('')

  it('keeps a new switch in the screen’s own @State, and makes one a property only in a component', () => {
    for (const screen of ['PlainTab', 'TitledDetail', 'LabelledDetail', 'ArgumentDetail', 'SheetView']) expect(viewWritten(source, `Text("${screen}")`).visibility?.property, screen).toBeUndefined()
    expect(viewWritten(source, 'Text("Badge")').visibility?.property).toBe(true)
    expect(viewWritten(source, 'Text("Sheet")\n                .sheet(isPresented: .constant(false)) { SheetView() }').visibility?.property).toBeUndefined()
    const after = draws(edited(source, 'Text("TitledDetail")', { kind: 'visibility', when: { input: 'showsNote', is: true }, create: { name: 'showsNote', value: true } }))
    expect(after).toContain('struct TitledDetail: View {\n    @State private var showsNote = true\n')
    // A tab written as iOS 18 writes it.
    const tabs = screen('        TabView {\n            Tab("Profile", systemImage: "person") {\n                ProfileView()\n            }\n        }', view('ProfileView', stack('Profile')))
    expect(viewWritten(tabs, 'Text("Profile")').visibility?.property).toBeUndefined()
  })
})

describe('A copy’s inputs, by what the Main uses them as', () => {
  const source = screen('        VStack {\n            Pill(title: "Ana", icon: "bolt", tint: Color(red: 1, green: 0, blue: 0, opacity: 0.5))\n            Pill(title: "Ben", tint: .brand)\n        }', PILL)

  it('marks a symbol, an image and a colour, so each gets its own picker', () => {
    const first = copy(source, 'Pill(title: "Ana", icon: "bolt", tint: Color(red: 1, green: 0, blue: 0, opacity: 0.5))')
    expect(control(first, 'component:icon')).toMatchObject({ value: 'bolt', inputKind: 'symbol' })
    expect(control(first, 'component:artwork')).toMatchObject({ value: 'hero', inputKind: 'image' })
    expect(control(first, 'component:tint')).toMatchObject({ value: '#FF000080', inputKind: 'color' })
    expect(control(first, 'component:title')?.inputKind).toBeUndefined()
    expect(control(copy(source, 'Pill(title: "Ben", tint: .brand)'), 'component:tint')).toMatchObject({ value: '.brand', inputKind: 'color' })
  })

  it('writes a colour input as a name, a hex or a token', () => {
    const ana = 'Pill(title: "Ana", icon: "bolt", tint: Color(red: 1, green: 0, blue: 0, opacity: 0.5))'
    const set = (value: string) => draws(edited(source, ana, { kind: 'property', control: 'component:tint', value }, '17.0'))
    expect(set('red')).toContain('Pill(title: "Ana", icon: "bolt", tint: Color.red)')
    expect(set('#0A84FF')).toContain('Pill(title: "Ana", icon: "bolt", tint: Color(red: 0.039, green: 0.518, blue: 1))')
    expect(set('.brand')).toContain('Pill(title: "Ana", icon: "bolt", tint: Color.brand)')
    expect(refusal(source, ana, { kind: 'property', control: 'component:tint', value: '#12' }, '17.0')).toBe('Use a hex color such as #0A84FF or #0A84FF80.')
  })
})

describe('A copy’s colour input, wherever its Main is and whatever it holds', () => {
  const MAIN = (tint: string) => `import SwiftUI\n\nstruct Pill: View {\n    var title: String\n    var tint: Color = ${tint}\n\n    var body: some View {\n        Text(title)\n            .background(tint)\n    }\n}\n\nextension Color {\n    static let brand = Color.orange\n}\n`
  /** The copy `call` on the screen, with Pill in a file of its own, as the panel receives it. */
  const tintOf = (call: string, tint: string, deploymentTarget?: string) => {
    const files = [{ id: APP, text: screen(`        ${call}`) }, { id: 'Sources/Pill.swift', text: MAIN(tint) }]
    const model = buildAuthoringModel({ projectId: 'layer', revision: 1, files, deploymentTarget })
    return model.nodes.find(n => n.kind === 'component' && n.name === 'Pill')?.controls?.find(c => c.id === 'component:tint')
  }

  it('reads a default from the Main’s own file', () => {
    expect(tintOf('Pill(title: "A")', '.brand')).toMatchObject({ value: '.brand', inputKind: 'color' })
    expect(tintOf('Pill(title: "A")', 'Color("Brand")')).toMatchObject({ value: 'Color("Brand")', inputKind: 'color' })
    expect(tintOf('Pill(title: "A")', '.brand')?.disabledReason).toBeUndefined()
  })

  it('shows a colour it can’t write here read only, with why', () => {
    expect(tintOf('Pill(title: "A", tint: .mint)', '.blue', '14.0')).toMatchObject({ value: 'mint', disabledReason: 'Mint needs iOS 15. Choose another color, or raise the deployment target.' })
    expect(tintOf('Pill(title: "A", tint: .blue.opacity(Double.random(in: 0...1)))', '.blue')).toMatchObject({ disabledReason: 'This color is worked out in Swift. Change it in Code.' })
  })
})

const CHIP = `
struct Chip: View {
    var title: String = "New"

    var body: some View {
        HStack {
            Image(systemName: "star")
            Text(title)
                .foregroundStyle(.red)
        }
        .padding(8)
    }
}
`
const chips = (main = CHIP, first = 'Chip()') => screen(`        VStack {\n            ${first}\n            Chip(title: "Old")\n        }`, main)
const ROW = 'HStack {\n            Image(systemName: "star")\n            Text(title)\n                .foregroundStyle(.red)\n        }\n        .padding(8)'
const addVariant = (source: string, view = ROW) => edited(source, view, { kind: 'component-variant-add', name: 'style', cases: ['primary', 'secondary'] })
const chipOf = (source: string) => source.slice(source.indexOf('struct Chip'))

describe('Variants: Add variant property', () => {
  it('writes a nested enum of two cases and a property of it, starting at the first', () => {
    const after = draws(addVariant(chips()))
    expect(chipOf(after)).toBe(`struct Chip: View {
    enum Style {
        case primary, secondary
    }

    var title: String = "New"
    var style: Style = .primary

    var body: some View {
        HStack {
            Image(systemName: "star")
            Text(title)
                .foregroundStyle(.red)
        }
        .padding(8)
    }
}
`)
    // Each copy picks its case with the select it already has.
    expect(control(viewWritten(after, 'Chip(title: "Old")'), 'component:style')).toMatchObject({ kind: 'select', value: 'primary', options: ['primary', 'secondary'] })
    // As `.secondary`, since a nested enum's name means nothing where the copy is.
    expect(draws(edited(after, 'Chip(title: "Old")', { kind: 'property', control: 'component:style', value: 'secondary' }))).toContain('            Chip(title: "Old", style: .secondary)\n')
  })

  it('carries the Main’s variant properties on it and the views inside it, and nowhere else', () => {
    const after = addVariant(chips())
    expect(viewWritten(after, 'Image(systemName: "star")').variants).toEqual([{ name: 'style', cases: ['primary', 'secondary'] }])
    expect(viewWritten(after, 'Chip(title: "Old")').variants).toBeUndefined()
    expect(viewWritten(chips(), 'Image(systemName: "star")').variants).toEqual([])
  })

  it('takes the cases as a designer types them, and refuses names it can’t use', () => {
    expect(chipOf(edited(chips(), ROW, { kind: 'component-variant-add', name: 'size', cases: ['Small', 'Large'] }))).toContain('    enum Size {\n        case small, large\n    }\n')
    const words = draws(edited(chips(), ROW, { kind: 'component-variant-add', name: 'Size class', cases: ['Extra large', 'Small'] }))
    expect(chipOf(words)).toContain('    enum SizeClass {\n        case extraLarge, small\n    }\n')
    expect(chipOf(words)).toContain('    var sizeClass: SizeClass = .extraLarge\n')
    expect(refusal(chips(), ROW, { kind: 'component-variant-add', name: '· ·', cases: ['a', 'b'] })).toBe('Name the variant with letters and numbers, starting with a letter.')
    expect(refusal(chips(), ROW, { kind: 'component-variant-add', name: 'title', cases: ['a', 'b'] })).toBe('Chip already has something called “title”. Choose another name.')
    expect(refusal(chips(), ROW, { kind: 'component-variant-add', name: 'style', cases: ['primary', 'primary'] })).toBe('Give the variant two different values, each a name of letters and numbers.')
    expect(refusal(addVariant(chips()), ROW, { kind: 'component-variant-add', name: 'style', cases: ['a', 'b'] })).toBe('Chip already has something called “style”. Choose another name.')
  })
})

describe('Variants: Differs by', () => {
  const styled = addVariant(chips())
  const differs = (source: string, view: string, id: string) => edited(source, view, { kind: 'component-differs', control: id, property: 'style' })

  it('turns a number into one for each case, both read and labelled by case', () => {
    const after = draws(differs(styled, ROW, 'modifier:0:0'))
    expect(after).toContain('        .padding(style == .primary ? 8 : 8)\n')
    const row = viewWritten(after, ROW.replace('.padding(8)', '.padding(style == .primary ? 8 : 8)'))
    expect(control(row, 'modifier:0:0:then')).toMatchObject({ label: 'padding · When Primary', value: '8', kind: 'number' })
    expect(control(row, 'modifier:0:0:else')).toMatchObject({ label: 'padding · When Secondary', value: '8', kind: 'number' })
    const secondary = draws(edited(after, ROW.replace('.padding(8)', '.padding(style == .primary ? 8 : 8)'), { kind: 'property', control: 'modifier:0:0:else', value: '16' }))
    expect(secondary).toContain('        .padding(style == .primary ? 8 : 16)\n')
  })

  it('turns a colour and a symbol into one for each case', () => {
    const colored = draws(differs(styled, 'Text(title)\n                .foregroundStyle(.red)', 'modifier:0:0'))
    expect(colored).toContain('                .foregroundStyle(style == .primary ? Color.red : Color.red)\n')
    expect(control(viewWritten(colored, 'Text(title)\n                .foregroundStyle(style == .primary ? Color.red : Color.red)'), 'modifier:0:0:else')).toMatchObject({ label: 'foregroundStyle · When Secondary', value: 'red' })
    // Either side takes a hex or a token as a copy's colour does, and reads it back.
    const sides = 'Text(title)\n                .foregroundStyle(style == .primary ? Color.red : Color.red)'
    const hex = draws(edited(colored, sides, { kind: 'property', control: 'modifier:0:0:else', value: '#0A84FF80' }))
    expect(hex).toContain('                .foregroundStyle(style == .primary ? Color.red : Color(red: 0.039, green: 0.518, blue: 1, opacity: 0.502))\n')
    expect(control(viewWritten(hex, 'Text(title)\n                .foregroundStyle(style == .primary ? Color.red : Color(red: 0.039, green: 0.518, blue: 1, opacity: 0.502))'), 'modifier:0:0:else')).toMatchObject({ value: '#0A84FF80', inputKind: 'color' })
    const token = draws(edited(colored.replace('struct Chip', 'extension Color {\n    static let brand = Color.orange\n}\n\nstruct Chip'), sides, { kind: 'property', control: 'modifier:0:0:then', value: '.brand' }))
    expect(token).toContain('                .foregroundStyle(style == .primary ? Color.brand : Color.red)\n')
    const symbol = draws(differs(styled, 'Image(systemName: "star")', 'image'))
    expect(symbol).toContain('            Image(systemName: style == .primary ? "star" : "star")\n')
    expect(control(viewWritten(symbol, 'Image(systemName: style == .primary ? "star" : "star")'), 'image:then')).toMatchObject({ label: 'System symbol · When Primary', value: 'star' })
  })

  it('reads a case that isn’t a literal, read only with why', () => {
    const main = CHIP.replace('    var title: String = "New"\n', '    enum Style {\n        case primary, secondary\n    }\n\n    var title: String = "New"\n    var tint: Color = .blue\n    var style: Style = .primary\n').replace('        .padding(8)\n', '        .padding(8)\n        .background(style == .primary ? tint : Color.gray)\n')
    const row = viewWritten(chips(main), ROW + '\n        .background(style == .primary ? tint : Color.gray)')
    expect(control(row, 'modifier:1:0:then')).toMatchObject({ label: 'background · When Primary', value: 'tint', disabledReason: 'This case is worked out in Swift. Change it in Code.' })
    expect(control(row, 'modifier:1:0:else')).toMatchObject({ label: 'background · When Secondary', value: 'gray' })
    expect(control(row, 'modifier:1:0:else')?.disabledReason).toBeUndefined()
  })

  it('reads a case named with its type, and only a variant property’s', () => {
    const main = (style: string) => CHIP.replace('    var title: String = "New"\n', `    enum Style {\n        case primary, secondary\n    }\n\n    var title: String = "New"\n${style}\n`).replace('        .padding(8)\n', '        .padding(style == Style.primary ? 8 : 12)\n')
    const row = (style: string) => viewWritten(chips(main(style)), ROW.replace('.padding(8)', '.padding(style == Style.primary ? 8 : 12)'))
    expect(control(row('    var style: Style = .primary'), 'modifier:0:0:then')).toMatchObject({ label: 'padding · When Primary', value: '8' })
    expect(control(row('    var style: Style = .primary'), 'modifier:0:0:else')).toMatchObject({ label: 'padding · When Secondary', value: '12' })
    // Its own state is no property a copy sets.
    expect(control(row('    @State private var style: Style = .primary'), 'modifier:0:0:then')?.label).toBe('padding · when style == Style.primary is true')
  })

  it('refuses what it can’t write, saying why', () => {
    expect(refusal(styled, ROW, { kind: 'component-differs', control: 'modifier:0:0', property: 'title' })).toBe('Choose a variant property of Chip: one with two values.')
    expect(refusal(styled, ROW, { kind: 'component-differs', control: 'add:padding', property: 'style' })).toBe('Only a value written plainly, a text, a number, an on/off or a color, can differ by a variant. Change it in Code.')
    const twice = differs(styled, ROW, 'modifier:0:0')
    expect(refusal(twice, ROW.replace('.padding(8)', '.padding(style == .primary ? 8 : 8)'), { kind: 'component-differs', control: 'modifier:0:0:then', property: 'style' })).toBe('Only a value written plainly, a text, a number, an on/off or a color, can differ by a variant. Change it in Code.')
  })
})

/** A Main with each number the panel offers, for its type as a copy's input: the table Xcode checks. */
const NUMBERS = `
struct Badge: View {
    var title: String = "New"

    var body: some View {
        VStack(spacing: 4) {
            Text(title)
                .lineLimit(2)
                .padding(8)
                .frame(width: 120, height: 40)
                .opacity(0.5)
                .cornerRadius(6)
                .offset(x: 2, y: 3)
                .blur(radius: 1)
                .lineSpacing(2)
                .scaleEffect(1.5)
                .shadow(color: .black, radius: 2, x: 1, y: 1)
                .rotationEffect(.degrees(15))
                .font(.system(size: 17))
                .border(Color.red, width: 2)
            Text("B")
                .minimumScaleFactor(0.5)
                .kerning(1)
                .baselineOffset(2)
                .layoutPriority(1)
                .saturation(0.5)
                .contrast(1)
                .grayscale(0.2)
                .brightness(0.1)
                .aspectRatio(1.5, contentMode: .fit)
                .lineLimit(2, reservesSpace: true)
                .tracking(1)
                .clipShape(.rect(cornerRadius: 12))
                .hueRotation(.degrees(10))
            ProgressView(value: 0.5)
            RoundedRectangle(cornerRadius: 8)
            Spacer(minLength: 10)
            Slider(value: .constant(0.5), in: 0...10, step: 0.5)
            Stepper("S", value: .constant(1), in: 0...10, step: 2)
            HStack(spacing: 6) {
                Text("C")
            }
        }
    }
}
`
/** Each number input written from NUMBERS, for the Xcode check at iOS 27, where all of them build. */
const numbers: string[] = []

describe('Changeable per copy: a number takes the type its modifier does', () => {
  const source = withCopies(NUMBERS)
  const model = buildAuthoringModel({ projectId: 'layer', revision: 1, files: project(source) })
  const inputs = new Map<string, string>()
  for (const view of model.nodes.filter(n => n.owner === 'Badge' && n.kind === 'view')) for (const number of view.controls ?? []) {
    if (number.exposeAs !== 'number') continue
    const after = expose(source, source.slice(view.source.start, view.source.end), 'number', number.id, 'amount')
    inputs.set(`${view.name} ${number.label}`, /var amount: (\w+) =/.exec(after)![1]!)
    numbers.push(after)
  }

  it('writes an Int for a line limit and a whole-number step, and a CGFloat for the rest', () => {
    expect(Object.fromEntries([...inputs].filter(([, type]) => type === 'Int'))).toEqual({ 'Text lineLimit': 'Int', 'Text Maximum lines': 'Int', 'Stepper Minimum': 'Int', 'Stepper Maximum': 'Int', 'Stepper Step': 'Int' })
    expect([...inputs.keys()]).toEqual(expect.arrayContaining(['Text padding', 'Text opacity', 'Text Font size', 'Text rotationEffect · degrees', 'Slider Step', 'ProgressView Progress', 'VStack Spacing']))
    expect(inputs.size).toBe(41)
  })
})

describe.skipIf(!XCODE)('in Xcode 27', () => {
  it('type-checks every form written', () => {
    expect(written.length).toBeGreaterThan(0)
    typecheckInXcode([...written, ...written.map(form => `// target: iOS 15\n${form}`)])
  }, 300_000)

  it('type-checks each number input', () => {
    expect(numbers.length).toBeGreaterThan(0)
    typecheckInXcode(numbers)
  }, 300_000)
})
