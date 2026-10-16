import { describe, expect, it } from 'vitest'
import { checkSourceFiles } from '@studio/swift-sema'
import { Parser } from '@studio/swift-syntax'
import { XCODE, bodyOf, editWritten, edited, project, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Wave 6d: a DatePicker's Style (Automatic, Compact, Graphical, Wheel), written to
 * `.datePickerStyle`, and a sideways ScrollView's Peek, written to
 * `.contentMargins(.horizontal, n, for: .scrollContent)`.
 */

const control = (source: string, view: string, id: string, target?: string) => viewWritten(source, view, target).controls?.find(c => c.id === id)
const set = (source: string, view: string, id: string, value: string, target?: string) => bodyOf(project(edited(source, view, { kind: 'property', control: id, value }, target)))
const refused = (source: string, view: string, id: string, value: string, target?: string) => {
  const result = editWritten(source, view, { kind: 'property', control: id, value }, target)
  return 'refused' in result ? result.refused : undefined
}

const PICKER = 'DatePicker("When", selection: $date)'
const STATE = '    @State private var date = Date()\n'
/** A screen with a date in state and `body` as its body. */
const dated = (body: string) => screen(body).replace('struct ContentView: View {\n', `struct ContentView: View {\n${STATE}`)
/** A DatePicker in a column, with `more` after its call. */
const picker = (more = '') => dated(`        VStack {\n            ${PICKER}${more}\n        }`)

describe('a DatePicker’s Style', () => {
  it('reads no style as Automatic, and offers the four iOS draws', () => {
    expect(control(picker(), PICKER, 'date:style')).toMatchObject({ label: 'Style', kind: 'select', value: 'Automatic', options: ['Automatic', 'Compact', 'Graphical', 'Wheel'], disabledReason: undefined })
  })

  it('reads each written style as its option, `.automatic` as Automatic', () => {
    for (const [style, option] of [['automatic', 'Automatic'], ['compact', 'Compact'], ['graphical', 'Graphical'], ['wheel', 'Wheel']]) {
      const more = `\n                .datePickerStyle(.${style})`
      expect(control(picker(more), PICKER + more, 'date:style')?.value, style).toBe(option)
    }
  })

  it('writes a style after the view’s last modifier, changes it in place, and takes it away at Automatic', () => {
    const labelled = '\n                .labelsHidden()'
    expect(set(picker(labelled), PICKER + labelled, 'date:style', 'Graphical')).toBe(`        VStack {\n            ${PICKER}\n                .labelsHidden()\n                .datePickerStyle(.graphical)\n        }`)
    const wheel = '\n                .datePickerStyle(.wheel)\n                .labelsHidden()'
    expect(set(picker(wheel), PICKER + wheel, 'date:style', 'Compact')).toBe(`        VStack {\n            ${PICKER}\n                .datePickerStyle(.compact)\n                .labelsHidden()\n        }`)
    expect(set(picker(wheel), PICKER + wheel, 'date:style', 'Automatic')).toBe(`        VStack {\n            ${PICKER}\n                .labelsHidden()\n        }`)
    const automatic = '\n                .datePickerStyle(.automatic)'
    expect(set(picker(automatic), PICKER + automatic, 'date:style', 'Wheel')).toBe(`        VStack {\n            ${PICKER}\n                .datePickerStyle(.wheel)\n        }`)
  })

  it('writes nothing when the style is already the one chosen', () => {
    expect(set(picker(), PICKER, 'date:style', 'Automatic')).toBe(`        VStack {\n            ${PICKER}\n        }`)
  })

  it('sets Compact and Graphical from iOS 14, and Wheel and Automatic before it', () => {
    expect(control(picker(), PICKER, 'date:style', '13.0')?.disabledReason).toBeUndefined()
    expect(refused(picker(), PICKER, 'date:style', 'Graphical', '13.0')).toBe('Needs iOS 14 or newer. Change the deployment target to set it.')
    expect(refused(picker(), PICKER, 'date:style', 'Compact', '13.0')).toBe('Needs iOS 14 or newer. Change the deployment target to set it.')
    // Written on the call's own line when it has no modifiers, as every setting is.
    expect(set(picker(), PICKER, 'date:style', 'Wheel', '13.0')).toContain(`${PICKER}.datePickerStyle(.wheel)\n`)
  })

  it('shows a style written another way as written, read only', () => {
    for (const more of ['\n                .datePickerStyle(GraphicalDatePickerStyle())', '\n                .datePickerStyle(style)', '\n                .datePickerStyle(.wheel)\n                .datePickerStyle(.compact)', '\n                .datePickerStyle(.wheel /* for now */)']) {
      const source = dated(`        VStack {\n            ${PICKER}${more}\n        }`).replace(STATE, `${STATE}    let style = WheelDatePickerStyle()\n`)
      expect(control(source, PICKER + more, 'date:style'), more).toMatchObject({ kind: 'text', disabledReason: 'This style is written in a way Style doesn’t set. Change it in Code.' })
    }
    const legacy = '\n                .datePickerStyle(GraphicalDatePickerStyle())'
    expect(control(picker(legacy), PICKER + legacy, 'date:style')?.value).toBe('.datePickerStyle(GraphicalDatePickerStyle())')
  })

  it('reads a style set on a view around it, read only, and writes no second one', () => {
    const form = dated(`        Form {\n            ${PICKER}\n        }\n        .datePickerStyle(.graphical)`)
    expect(control(form, PICKER, 'date:style')).toMatchObject({ kind: 'select', value: 'Graphical', disabledReason: 'Set on the Form around it. Change it there.' })
    expect(refused(form, PICKER, 'date:style', 'Wheel')).toBe('Set on the Form around it. Change it there.')
    const column = dated(`        VStack {\n            ${PICKER}\n        }\n        .datePickerStyle(DefaultDatePickerStyle())`)
    expect(control(column, PICKER, 'date:style')).toMatchObject({ kind: 'text', value: '.datePickerStyle(DefaultDatePickerStyle())', disabledReason: 'Set on the Column around it. Change it there.' })
  })

  it('adds no style after a modifier of the project’s own', () => {
    const own = '\n                .card()'
    const source = dated(`        VStack {\n            ${PICKER}${own}\n        }`).concat('\nextension View {\n    func card() -> some View { padding() }\n}\n')
    expect(control(source, PICKER + own, 'date:style')?.disabledReason).toBe('This view has a modifier of the project’s own. Add this in Code.')
  })
})

const ROW = 'ScrollView(.horizontal) {\n                HStack {\n                    Text("A")\n                    Text("B")\n                }\n            }'
/** A sideways ScrollView in a column, with `more` after its call. */
const row = (more = '', around = '') => screen(`        VStack {\n            ${ROW}${more}\n        }${around}`)

describe('a sideways ScrollView’s Peek', () => {
  it('reads no margins as 0, in points, set from iOS 17', () => {
    expect(control(row(), ROW, 'scroll:peek')).toMatchObject({ label: 'Peek', kind: 'number', unit: 'pt', value: '0', min: 0, disabledReason: undefined })
    expect(control(row(), ROW, 'scroll:peek', '16.0')?.disabledReason).toBe('Needs iOS 17 or newer. Change the deployment target to set it.')
  })

  it('is on a sideways ScrollView only', () => {
    const down = 'ScrollView {\n                Text("A")\n            }'
    expect(control(screen(`        VStack {\n            ${down}\n        }`), down, 'scroll:peek')).toBeUndefined()
  })

  it('writes the margins after the view’s last modifier, or straight after its scroll behaviour', () => {
    const framed = '\n            .frame(height: 120)'
    expect(set(row(framed), ROW + framed, 'scroll:peek', '24')).toBe(`        VStack {\n            ${ROW}\n            .frame(height: 120)\n            .contentMargins(.horizontal, 24, for: .scrollContent)\n        }`)
    const paging = '\n            .scrollTargetBehavior(.paging)\n            .frame(height: 120)'
    expect(set(row(paging), ROW + paging, 'scroll:peek', '24')).toBe(`        VStack {\n            ${ROW}\n            .scrollTargetBehavior(.paging)\n            .contentMargins(.horizontal, 24, for: .scrollContent)\n            .frame(height: 120)\n        }`)
  })

  it('reads its own margins, changes them in place, and takes them away at 0', () => {
    const margins = '\n            .contentMargins(.horizontal, 24, for: .scrollContent)'
    expect(control(row(margins), ROW + margins, 'scroll:peek')?.value).toBe('24')
    expect(set(row(margins), ROW + margins, 'scroll:peek', '40')).toBe(`        VStack {\n            ${ROW}\n            .contentMargins(.horizontal, 40, for: .scrollContent)\n        }`)
    expect(set(row(margins), ROW + margins, 'scroll:peek', '0')).toBe(`        VStack {\n            ${ROW}\n        }`)
    expect(set(row(), ROW, 'scroll:peek', '0')).toBe(`        VStack {\n            ${ROW}\n        }`)
  })

  it('shows margins written another way as written, read only', () => {
    for (const more of ['\n            .contentMargins(24, for: .scrollContent)', '\n            .contentMargins(.horizontal, 24)', '\n            .contentMargins(.horizontal, 24, for: .scrollIndicators)', '\n            .contentMargins(.vertical, 24, for: .scrollContent)', '\n            .contentMargins(.horizontal, inset, for: .scrollContent)', '\n            .contentMargins(.horizontal, 24, for: .scrollContent)\n            .contentMargins(.top, 8)']) {
      const source = row(more).replace('struct ContentView: View {\n', 'struct ContentView: View {\n    let inset: CGFloat = 24\n')
      expect(control(source, ROW + more, 'scroll:peek'), more).toMatchObject({ kind: 'text', disabledReason: 'These margins are written in a way Peek doesn’t set. Change them in Code.' })
    }
    const all = '\n            .contentMargins(24, for: .scrollContent)'
    expect(control(row(all), ROW + all, 'scroll:peek')?.value).toBe('.contentMargins(24, for: .scrollContent)')
  })

  it('shows safe area padding that insets the content sideways as written, read only, as the inset isn’t Peek’s', () => {
    for (const more of ['\n            .safeAreaPadding(.horizontal, 24)', '\n            .safeAreaPadding()', '\n            .safeAreaPadding(.leading, 24)', '\n            .contentMargins(.horizontal, 24, for: .scrollContent)\n            .safeAreaPadding(.horizontal, 8)']) {
      expect(control(row(more), ROW + more, 'scroll:peek'), more).toMatchObject({ kind: 'text', disabledReason: 'These margins are written in a way Peek doesn’t set. Change them in Code.' })
    }
    const padded = '\n            .safeAreaPadding(.horizontal, 24)'
    expect(control(row(padded), ROW + padded, 'scroll:peek')?.value).toBe('.safeAreaPadding(.horizontal, 24)')
    // Padding above and below insets nothing sideways, so Peek still reads and writes.
    const vertical = '\n            .safeAreaPadding(.vertical, 8)'
    expect(control(row(vertical), ROW + vertical, 'scroll:peek')).toMatchObject({ kind: 'number', value: '0', disabledReason: undefined })
    expect(set(row(vertical), ROW + vertical, 'scroll:peek', '24')).toBe(`        VStack {\n            ${ROW}\n            .safeAreaPadding(.vertical, 8)\n            .contentMargins(.horizontal, 24, for: .scrollContent)\n        }`)
  })

  it('reads margins set on a view around it, read only', () => {
    const around = row('', '\n        .contentMargins(.horizontal, 24, for: .scrollContent)')
    expect(control(around, ROW, 'scroll:peek')).toMatchObject({ value: '24', disabledReason: 'Set on the Column around it. Change it there.' })
    expect(refused(around, ROW, 'scroll:peek', '0')).toBe('Set on the Column around it. Change it there.')
  })
})

/** The checker's warnings for a screen whose body is `body`, by their text. */
const diagnostics = (body: string) => checkSourceFiles([Parser.parse(dated(body), 'App.swift').sourceFile]).diagnostics
const warnings = (body: string) => diagnostics(body).filter(d => d.severity === 'warning').map(d => d.message)

describe('what the checker says of what 6d draws', () => {
  it('says nothing of the date picker styles iOS draws, nor of a colour picker', () => {
    for (const style of ['automatic', 'compact', 'graphical', 'wheel']) expect(warnings(`        ${PICKER}.datePickerStyle(.${style})`), style).toEqual([])
    expect(warnings('        ColorPicker("Tint", selection: .constant(Color.blue))')).toEqual([])
  })

  it('says nothing of content margins, safe area padding, the scroll target marker or a scroll aligned to its views', () => {
    const scroll = (more: string) => warnings(`        ScrollView(.horizontal) {\n            LazyHStack {\n                Text("A")\n            }\n            .scrollTargetLayout()\n        }${more}`)
    for (const more of ['.scrollTargetBehavior(.viewAligned)', '.contentMargins(.horizontal, 24, for: .scrollContent)', '.contentMargins(24)', '.contentMargins(.top, 8, for: .scrollIndicators)', '.safeAreaPadding(.horizontal, 24)', '.safeAreaPadding()']) expect(scroll(more), more).toEqual([])
    expect(warnings('        List {\n            Text("Row")\n        }\n        .contentMargins(.top, 40)')).toEqual([])
  })

  it('says nothing of a mesh of colours', () => {
    expect(warnings('        MeshGradient(width: 2, height: 2, points: [[0, 0], [1, 0], [0, 1], [1, 1]], colors: [.red, .blue, .green, .yellow])')).toEqual([])
    expect(warnings('        MeshGradient(width: 2, height: 2, points: [[0, 0], [1, 0], [0, 1], [1, 1]], colors: [.red, .blue, .green, .yellow], smoothsColors: false)\n            .frame(height: 300)')).toEqual([])
  })

  it('reads a point written as SIMD2, which the preview draws', () => {
    expect(diagnostics('        MeshGradient(width: 2, height: 2, points: [SIMD2<Float>(0, 0), SIMD2<Float>(1, 0), [0, 1], [1, 1]], colors: [.red, .blue, .green, .yellow])').map(d => d.message)).toEqual([])
  })

  it('says so of a mesh written in a form the preview draws nothing for', () => {
    const mesh = (args: string) => warnings(`        MeshGradient(${args})`)
    expect(mesh('width: 2, height: 2, points: [.init(0, 0), .init(1, 0), .init(0, 1), .init(1, 1)], colors: [.red, .blue, .green, .yellow]')).toEqual(['The preview draws no mesh with points written as .init. Write each as [x, y].'])
    expect(mesh('width: 2, height: 2, locations: .points([[0, 0], [1, 0], [0, 1], [1, 1]]), colors: .colors([.red, .blue, .green, .yellow])')).toEqual(['The preview draws no mesh written with locations:. Write points: and colors: as arrays.'])
    expect(mesh('width: 3, height: 3, points: [[0, 0], [1, 0], [0, 1], [1, 1]], colors: [.red, .blue, .green, .yellow]')).toEqual(['A 3 by 3 mesh needs 9 points and 9 colors, so nothing draws.'])
  })

  it('says so of a mesh’s background and colour space, which the preview leaves out', () => {
    expect(warnings('        MeshGradient(width: 2, height: 2, points: [[0, 0], [1, 0], [0, 1], [1, 1]], colors: [.red, .blue, .green, .yellow], background: .black, colorSpace: .perceptual)')).toEqual([
      'The preview leaves out a mesh’s background:.',
      'The preview leaves out a mesh’s colorSpace:.',
    ])
  })

  it('says so of a mesh as the foreground of text or a symbol, a stroke or a border, which the preview paints in one colour', () => {
    const mesh = 'MeshGradient(width: 2, height: 2, points: [[0, 0], [1, 0], [0, 1], [1, 1]], colors: [.red, .blue, .green, .yellow])'
    const uses = [
      `Text("Hi").foregroundStyle(${mesh})`, `Image(systemName: "star.fill").foregroundStyle(${mesh})`, `Label("Hi", systemImage: "star").foregroundStyle(${mesh})`,
      `VStack {\n            Text("Hi")\n            Circle()\n        }\n        .foregroundStyle(${mesh})`,
      `Circle().stroke(${mesh}, lineWidth: 4)`, `Circle().strokeBorder(${mesh})`, `Text("Hi").border(${mesh})`,
    ]
    for (const use of uses) expect(warnings(`        ${use}`), use).toEqual(['The preview paints this mesh in one color.'])
  })

  it('says nothing of a mesh a shape fills, as its foreground or its own, which the preview paints in full', () => {
    const mesh = 'MeshGradient(width: 2, height: 2, points: [[0, 0], [1, 0], [0, 1], [1, 1]], colors: [.red, .blue, .green, .yellow])'
    const uses = [
      `Circle().fill(${mesh})`, `Text("Hi").background(${mesh})`, `Circle().foregroundStyle(${mesh})`,
      `RoundedRectangle(cornerRadius: 12).frame(height: 80).foregroundStyle(${mesh}.opacity(0.5))`,
      `HStack {\n            Circle()\n            Rectangle()\n        }\n        .foregroundStyle(${mesh})`,
    ]
    for (const use of uses) expect(warnings(`        ${use}`), use).toEqual([])
  })

  it('says so of a view-aligned limit and a nil content margin, which the preview doesn’t measure', () => {
    const scroll = (more: string) => warnings(`        ScrollView(.horizontal) {\n            Text("A")\n        }${more}`)
    expect(scroll('.scrollTargetBehavior(.viewAligned(limitBehavior: .always))')).toEqual(['The preview snaps to the nearest view, without this limit.'])
    expect(scroll('.contentMargins(.horizontal, nil)')).toEqual(['The preview estimates a nil margin as 16 pt.'])
  })

  it('still says so of a style iOS has no drawing for here', () => {
    expect(warnings(`        ${PICKER}.datePickerStyle(.field)`)).toEqual([expect.stringContaining('.datePickerStyle(.field)')])
  })
})

describe.skipIf(!XCODE)('the forms 6d’s fields write, in Xcode 27', () => {
  it('type-check at their lowest iOS with warnings as errors', () => {
    const forms: [string, string][] = []
    for (const style of ['Compact', 'Graphical', 'Wheel']) forms.push(['14.0', dated(set(picker(), PICKER, 'date:style', style, '14.0'))])
    forms.push(['13.0', dated(set(picker(), PICKER, 'date:style', 'Wheel', '13.0'))])
    const paging = '\n            .scrollTargetBehavior(.paging)'
    forms.push(['17.0', screen(set(row(paging), ROW + paging, 'scroll:peek', '24', '17.0'))])
    forms.push(['17.0', screen(set(row(), ROW, 'scroll:peek', '16', '17.0'))])
    const vertical = '\n            .safeAreaPadding(.vertical, 8)'
    forms.push(['17.0', screen(set(row(vertical), ROW + vertical, 'scroll:peek', '24', '17.0'))])
    expect(forms.map(([, text]) => text).join('\n')).toContain('.contentMargins(.horizontal, 24, for: .scrollContent)')
    expect(forms.map(([, text]) => text).join('\n')).toContain('.datePickerStyle(.graphical)')
    typecheckInXcode(forms.map(([version, text]) => `// target: iOS ${version}\n${text}`))
  }, 300_000)
})
