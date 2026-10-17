import { beforeEach, describe, expect, it } from 'vitest'
import { resetPipelineState } from '@studio/swiftui-runtime'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { evenInsets, type AuthoringNode, type DesignEditRequest, type SourceFile } from '@studio/shared'
import { APP, XCODE, bodyOf, layerOf, node, planLayer, project, setLayer, text, typecheckInXcode } from './helpers/layer-project'

/**
 * Values in real code (doc 18, Concern 2, items 10 and 11): a constant shows its name and
 * value, is changed where it is declared or detached at one view, and a value a condition
 * chooses shows both cases, each changed on its own while the condition stays as written.
 */
beforeEach(resetPipelineState)

/** A screen whose struct declares `members`, with `declarations` after it. */
const app = (body: string, members = '', declarations = '') => `import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
${members}    var body: some View {
        ${body}
    }
}
${declarations}`

const MEMBERS = `    let rowSpacing: CGFloat = 12
    private let inset: CGFloat = 16
    static let gap: CGFloat = 8
    var wide: CGFloat = 200
    @State private var selected = false
    @State private var on = true
`
const DECLARATIONS = `
enum Layout {
    static let pad: CGFloat = 20
    static let card = 300.0
}

extension CGFloat {
    static let space12: CGFloat = 12
}

extension Font {
    static let heading = Font.title2.bold()
    static let caption3 = Font.system(size: 11, weight: .medium)
}
`
const files = (body: string, members = MEMBERS, declarations = DECLARATIONS) => project(app(body, members, declarations))
const layer = (body: string, name = 'Text', members?: string) => layerOf(files(body, members), name)

/** What the planner makes of `operation` on the `index`th view called `name`: the screen's file after it, or why it refused. */
function edit(source: readonly SourceFile[], name: string, operation: DesignEditRequest['operation'], index = 0): string {
  const target = node(source, name, index)
  const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: [...source], scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation })
  if (!plan.ok) throw new Error(plan.reason)
  return plan.changes.find(change => change.file === APP)?.after ?? text(source)
}

describe('a constant read as a token with its value', () => {
  it.each([
    ['a constant of the view’s struct', 'Text("A").padding(inset)', 'inset', 16, 'ContentView.inset', 1],
    ['a type’s static constant', 'Text("A").padding(Layout.pad)', 'Layout.pad', 20, 'Layout.pad', 1],
    ['a CGFloat token read with a dot', 'Text("A").padding(.space12)', '.space12', 12, 'CGFloat.space12', 1],
    ['a static constant of the view, as Self', 'Text("A").padding(Self.gap)', 'Self.gap', 8, 'ContentView.gap', 1],
  ])('reads %s', (_, body, token, value, name, uses) => {
    const read = layer(body), padding = read.layout.padding
    expect(padding.state).toBe('token')
    expect(padding.value!.top).toEqual({ token })
    expect(read.tokens?.[token]).toMatchObject({ value, declaration: { name, uses } })
  })

  it('says where it is declared: the initialiser, which Edit at declaration rewrites', () => {
    const source = app('Text("A").padding(inset)', MEMBERS, DECLARATIONS)
    const { span } = layerOf(project(source), 'Text').tokens!.inset!.declaration
    expect(source.slice(span.start, span.end)).toBe('16')
  })

  it('counts every place that reads it, this one among them', () => {
    const body = 'VStack(spacing: rowSpacing) {\n            Text("A").padding(rowSpacing)\n            Text("B").padding(.horizontal, self.rowSpacing)\n            Text("C").frame(width: rowSpacing)\n        }'
    expect(layerOf(files(body), 'Text').tokens?.rowSpacing).toMatchObject({ value: 12, declaration: { uses: 4 } })
    expect(layerOf(files('VStack {\n            Text("A").padding(.space12)\n            Text("B").padding(CGFloat.space12)\n        }'), 'Text').tokens?.['.space12']).toMatchObject({ declaration: { uses: 2 } })
  })

  it.each([
    ['a value that can be given where the view is made', 'Text("A").frame(width: wide)', 'wide'],
    ['a name a closure gives the views inside it', 'ForEach([1, 2], id: \\.self) { inset in\n            Text("A").padding(inset)\n        }', 'inset'],
  ])('keeps %s a token with no value', (_, body, token) => {
    const read = layer(body)
    expect(read.layout.width.value.size ?? read.layout.padding.value?.top).toEqual({ token })
    expect(read.tokens).toBeUndefined()
  })

  it('says a constant worked out in Swift is one, with the expression, and has no value to edit where it is declared', () => {
    const read = layer('Text("A").padding(double)', 'Text', `${MEMBERS}    let double: CGFloat = 8 * 2\n`)
    expect(read.layout.padding.value?.top).toEqual({ token: 'double' })
    expect(read.tokens?.double).toMatchObject({ expression: '8 * 2', declaration: { name: 'ContentView.double', uses: 1 } })
    expect(read.tokens?.double?.value).toBeUndefined()
  })

  it('shows the value of a corner radius and a size read through constants', () => {
    const corners = layer('Text("A").background(.red).clipShape(.rect(cornerRadius: Layout.pad))')
    expect(corners.corners?.value.radius).toEqual({ token: 'Layout.pad' })
    expect(corners.tokens?.['Layout.pad']).toMatchObject({ value: 20 })
    expect(layer('Text("A").frame(width: Layout.card)').tokens?.['Layout.card']).toMatchObject({ value: 300, declaration: { name: 'Layout.card' } })
  })
})

/** A project of `screen`, a `ContentView` and what follows it, under the app every test uses. */
const written = (screen: string) => project(`import SwiftUI

@main
struct DemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

${screen}`)

describe('a name declared on the way to a read, which hides a constant of that name', () => {
  it('is a parameter of a function in an extension of the view: its stack and text read the parameter, not the struct’s constant', () => {
    const source = written(`struct ContentView: View {
    let gap: CGFloat = 12
    var body: some View {
        row(gap: 4)
    }
}

extension ContentView {
    func row(gap: CGFloat) -> some View {
        VStack(spacing: gap) {
            Text("A").padding(gap)
        }
    }
}
`)
    const text = layerOf(source, 'Text')
    expect(text.layout.padding.value?.top).toEqual({ token: 'gap' })
    expect(text.tokens).toBeUndefined()
    const stack = node(source, 'VStack')
    expect(stack.controls?.some(control => control.id === 'spacing:detach' || control.id === 'spacing:declaration')).toBe(false)
    expect(stack.controls?.find(control => control.id === 'spacing')?.value).not.toBe('12')
  })

  it.each([
    ['a value declared before it in an extension’s computed property', `struct ContentView: View {
    let inset: CGFloat = 16
    var body: some View {
        card
    }
}

extension ContentView {
    var card: some View {
        let inset: CGFloat = 2
        return Text("A").padding(inset)
    }
}
`],
    ['a constant of a type the view is nested in, under one of its own', `struct ContentView: View {
    let inset: CGFloat = 16
    var body: some View {
        Row()
    }
    struct Row: View {
        let inset: CGFloat = 4
        var body: some View {
            Text("A").padding(inset)
        }
    }
}
`],
    ['a value a switch case binds', `enum Load { case ready(CGFloat) }

struct ContentView: View {
    let inset: CGFloat = 16
    let load = Load.ready(4)
    var body: some View {
        switch load {
        case .ready(let inset):
            Text("A").padding(inset)
        }
    }
}
`],
    ['a value a guard binds above it', `struct ContentView: View {
    let inset: CGFloat = 16
    let spare: CGFloat? = 4
    var body: some View {
        card
    }
    var card: some View {
        guard let inset = spare else { return Text("B").padding(0) }
        return Text("A").padding(inset)
    }
}
`],
  ])('is %s', (_, screen) => {
    const text = layerOf(written(screen), 'Text')
    expect(text.layout.padding.value?.top).toEqual({ token: 'inset' })
    expect(text.tokens).toBeUndefined()
  })

  it('still reads the constant in an extension of the view where nothing hides it, and counts each read', () => {
    const source = written(`struct ContentView: View {
    let inset: CGFloat = 16
    var body: some View {
        VStack {
            card
            Text("B").padding(inset)
        }
    }
}

extension ContentView {
    var card: some View {
        Text("A").padding(inset)
    }

    func row(inset: CGFloat) -> some View {
        Text("C").padding(inset)
    }
}
`)
    expect(layerOf(source, 'Text').tokens?.inset).toMatchObject({ value: 16, declaration: { name: 'ContentView.inset', uses: 2 } })
  })
})

describe('Edit at declaration', () => {
  const styleEdit = (body: string, name: string, value: string) => bodyOf(project(edit(files(body), 'Text', { kind: 'style-edit', name, value })))
  const whole = (body: string, name: string, value: string) => edit(files(body), 'Text', { kind: 'style-edit', name, value })

  it('writes the new value where the constant is declared, and leaves the view as it was', () => {
    const after = whole('Text("A").padding(inset)', 'ContentView.inset', '24')
    expect(after).toContain('    private let inset: CGFloat = 24\n')
    expect(bodyOf(project(after))).toBe('        Text("A").padding(inset)')
  })

  it.each([
    ['a type’s static constant', 'Text("A").padding(Layout.pad)', 'Layout.pad', '28', '    static let pad: CGFloat = 28\n'],
    ['a Double written without a type, which stays a Double', 'Text("A").frame(width: Layout.card)', 'Layout.card', '280', '    static let card = 280.0\n'],
    ['a token in an extension', 'Text("A").padding(.space12)', 'CGFloat.space12', '14', '    static let space12: CGFloat = 14\n'],
  ])('rewrites %s', (_, body, name, value, expected) => {
    expect(whole(body, name, value)).toContain(expected)
  })

  it('refuses a value that is no number, and writes nothing for the value it has', () => {
    expect(() => styleEdit('Text("A").padding(inset)', 'ContentView.inset', 'big')).toThrow(/number/)
    expect(whole('Text("A").padding(inset)', 'ContentView.inset', '16')).toBe(app('Text("A").padding(inset)', MEMBERS, DECLARATIONS))
  })

  it('edits a token of Tokens.swift as its own row in the token list does', () => {
    const source = [...files('Text("A").padding(.space16)', MEMBERS, ''), { id: 'Sources/DesignSystem/Tokens.swift', text: 'import SwiftUI\n\n// MARK: - Spacing\nextension CGFloat {\n    static let space16: CGFloat = 16\n}\n' }]
    const target = node(source, 'Text')
    const plan = planDesignEdit({ projectId: 'layer', baseRevision: 1, files: source, scope: target.owner, target: target.source, fingerprint: target.fingerprint, operation: { kind: 'style-edit', name: 'CGFloat.space16', value: '18' } })
    expect(plan.ok && plan.changes.find(change => change.file.endsWith('Tokens.swift'))?.after).toContain('static let space16: CGFloat = 18')
  })
})

describe('Detach', () => {
  it('writes the token’s value in its place at this view only', () => {
    expect(bodyOf(setLayer(files('Text("A").padding(inset)'), 'Text', [{ section: 'layout', padding: evenInsets(16) }]))).toBe('        Text("A").padding(16)')
  })
})

describe('a stack’s spacing through a constant', () => {
  const stack = (body: string, name = 'VStack') => node(files(body), name)
  const control = (view: AuthoringNode, id: string) => view.controls?.find(item => item.id === id)

  it.each([
    ['a constant of the view', 'VStack(spacing: rowSpacing) {\n            Text("A")\n        }', 'VStack', 'rowSpacing', '12'],
    ['a static constant read as Self', 'HStack(spacing: Self.gap) {\n            Text("A")\n        }', 'HStack', 'Self.gap', '8'],
  ])('has a Spacing field for %s, showing its value and the token', (_, body, name, token, value) => {
    const spacing = control(stack(body, name), 'spacing')
    expect(spacing).toMatchObject({ kind: 'number', value, unit: 'pt' })
    expect(spacing!.options).toEqual(['auto', token])
  })

  it('writes a number typed in its place, the constant where it is declared, and its value on Detach', () => {
    const body = 'VStack(spacing: rowSpacing) {\n            Text("A")\n        }'
    const change = (control: string, value: string) => edit(files(body), 'VStack', { kind: 'property', control, value })
    expect(change('spacing', '20')).toContain('VStack(spacing: 20) {')
    expect(change('spacing:declaration', '20')).toContain('    let rowSpacing: CGFloat = 20\n')
    expect(change('spacing:declaration', '20')).toContain('VStack(spacing: rowSpacing) {')
    expect(change('spacing:detach', 'true')).toContain('VStack(spacing: 12) {')
  })
})

describe('a font read through a constant', () => {
  it('reads `.font(.heading)` as the font it is declared as, linked to its name', () => {
    const read = layer('Text("A").font(.heading)')
    expect(read.text!.font).toMatchObject({ state: 'token', value: { style: 'title2', weight: 'bold', token: '.heading' } })
    expect(read.tokens?.['.heading']).toMatchObject({ declaration: { name: 'Font.heading', uses: 1 } })
    expect(layer('Text("A").font(.caption3)').text!.font.value).toMatchObject({ style: null, size: 11, weight: 'medium', token: '.caption3' })
  })

  it('writes the font itself on Detach, and a change of it as the font with that change', () => {
    expect(bodyOf(setLayer(files('Text("A").font(.heading)'), 'Text', [{ section: 'text', font: {} }]))).toBe('        Text("A").font(.title2).fontWeight(.bold)')
    expect(bodyOf(setLayer(files('Text("A").font(.heading)'), 'Text', [{ section: 'text', font: { style: 'title' } }]))).toBe('        Text("A").font(.title).fontWeight(.bold)')
  })
})

/** Font tokens worked out by a getter, and one in a custom face. */
const FONTS = `
extension Font {
    static var heading: Font { .system(size: 20, weight: .semibold) }
    static var subheading: Font {
        return .title3.bold()
    }
    static let brand = Font.custom("Avenir", size: 20)
}
`

describe('a font token worked out by a getter, or in a custom face', () => {
  const fonts = (body: string) => files(body, MEMBERS, FONTS)

  it.each([
    ['one expression', '.heading', { style: null, size: 20, weight: 'semibold' }, 'Font.heading'],
    ['a return', '.subheading', { style: 'title3', weight: 'bold' }, 'Font.subheading'],
  ])('reads a static whose getter is %s as the `static let` form: linked, with its name and what it is', (_, token, font, name) => {
    const read = layerOf(fonts(`Text("A").font(${token})`), 'Text')
    expect(read.text!.font).toMatchObject({ state: 'token', value: { ...font, token } })
    expect(read.tokens?.[token]).toMatchObject({ declaration: { name, uses: 1 } })
  })

  it('writes the font itself on Detach', () => {
    expect(bodyOf(setLayer(fonts('Text("A").font(.heading)'), 'Text', [{ section: 'text', font: {} }]))).toBe('        Text("A").font(.system(size: 20, weight: .semibold))')
  })

  it('shows a family behind a token with its name and size, read only, with why', () => {
    const read = layerOf(fonts('Text("A").font(.brand)'), 'Text')
    expect(read.text!.font).toMatchObject({ state: 'code', value: { style: null, size: 20, face: 'Avenir', token: '.brand' } })
    expect(read.text!.font.disabledReason).toBe('This text’s font, .brand, is in the Avenir family, which a text style token doesn’t set. Change it in Code.')
    expect(read.tokens?.['.brand']).toMatchObject({ declaration: { name: 'Font.brand' } })
    expect(planLayer(fonts('Text("A").font(.brand)'), 'Text', [{ section: 'text', font: { style: 'title' } }])).toMatchObject({ ok: false })
  })
})

describe('a value a condition chooses', () => {
  const choice = <T>(then: T, otherwise: T, condition = 'selected') => ({ condition, then, otherwise })

  it.each([
    ['a padding', 'Text("A").padding(selected ? 16 : 8)', (view: ReturnType<typeof layer>) => view.layout.padding.value?.top, choice(16, 8)],
    ['a width', 'Text("A").frame(width: selected ? 200 : 100)', (view: ReturnType<typeof layer>) => view.layout.width.value.size, choice(200, 100)],
    ['an opacity', 'Text("A").opacity(on ? 1 : 0.4)', (view: ReturnType<typeof layer>) => view.effects.opacity.value, choice(1, 0.4, 'on')],
    ['a token in one case', 'Text("A").padding(selected ? Layout.pad : 8)', (view: ReturnType<typeof layer>) => view.layout.padding.value?.top, choice<number | { token: string }>({ token: 'Layout.pad' }, 8)],
  ])('reads %s as both cases', (_, body, read, expected) => {
    expect(read(layer(body))).toMatchObject(expected)
  })

  it.each([
    ['a padding', 'Text("A").padding(selected ? 16 : 8)', { section: 'layout', padding: evenInsets(choice(16, 12)) }, 'Text("A").padding(selected ? 16 : 12)'],
    ['a width', 'Text("A").frame(width: selected ? 200 : 100)', { section: 'layout', width: { mode: 'fixed', size: choice(240, 100) } }, 'Text("A").frame(width: selected ? 240 : 100)'],
    ['an opacity', 'Text("A").opacity(on ? 1 : 0.4)', { section: 'effects', opacity: choice(1, 0.6, 'on') }, 'Text("A").opacity(on ? 1 : 0.6)'],
    ['an offset', 'Text("A").offset(y: selected ? -4 : 0)', { section: 'layout', offset: { x: 0, y: choice(-8, 0) } }, 'Text("A").offset(y: selected ? -8 : 0)'],
  ] as const)('writes one case of %s in place, the condition as written', (_, body, change, expected) => {
    expect(bodyOf(setLayer(files(body), 'Text', [change]))).toBe(`        ${expected}`)
  })

  it('refuses one plain value in place of the two, as a drag on the canvas would write', () => {
    expect(planLayer(files('Text("A").padding(selected ? 16 : 8)'), 'Text', [{ section: 'layout', padding: evenInsets(20) }])).toMatchObject({ ok: false, reason: expect.stringMatching(/depends on selected/) })
    expect(planLayer(files('Text("A").frame(width: selected ? 200 : 100)'), 'Text', [{ section: 'layout', width: { mode: 'fixed', size: 150 } }])).toMatchObject({ ok: false, reason: expect.stringMatching(/depends on selected/) })
    expect(planLayer(files('Text("A").opacity(on ? 1 : 0.4)'), 'Text', [{ section: 'effects', opacity: 0.5 }])).toMatchObject({ ok: false })
  })

  it.each([
    ['Fill', 'Text("A").frame(width: selected ? 200 : 100, height: 40)', { mode: 'fill' }],
    ['Hug', 'Text("A").frame(width: selected ? 200 : 100, height: 40)', { mode: 'hug' }],
    ['Fixed, from a minimum', 'Text("A").frame(minWidth: selected ? 200 : 100)', { mode: 'fixed', size: 120 }],
    ['Fill, without the minimum', 'Text("A").frame(minWidth: selected ? 200 : 100)', { mode: 'fill' }],
  ] as const)('refuses a switch to %s over a size a condition chooses, which would drop the condition', (_, body, width) => {
    const plan = planLayer(files(body), 'Text', [{ section: 'layout', width }])
    expect(plan).toMatchObject({ ok: false, reason: 'This view’s width depends on selected: change each case in the panel. Change it in Code to give it one value.' })
  })

  it('keeps a size a condition chooses through a change of the other axis, and a minimum through a switch to Fill', () => {
    expect(bodyOf(setLayer(files('Text("A").frame(width: selected ? 200 : 100, height: 40)'), 'Text', [{ section: 'layout', height: { mode: 'fixed', size: 48 } }]))).toBe('        Text("A").frame(width: selected ? 200 : 100, height: 48)')
    expect(bodyOf(setLayer(files('Text("A").frame(minWidth: selected ? 200 : 100)'), 'Text', [{ section: 'layout', width: { mode: 'fill', min: choice(200, 100) } }]))).toBe('        Text("A").frame(minWidth: selected ? 200 : 100, maxWidth: .infinity)')
  })

  it('refuses a condition the code does not have', () => {
    expect(planLayer(files('Text("A").padding(8)'), 'Text', [{ section: 'layout', padding: evenInsets(choice(16, 8, 'true); fatalError(')) }])).toMatchObject({ ok: false })
  })

  it('reads and writes both colours of a fill and of a text', () => {
    const fill = layer('Text("A").background(selected ? Color.blue : Color.gray)').fill
    expect(fill).toMatchObject({ state: 'literal', value: { kind: 'color', color: { name: 'blue' }, when: { condition: 'selected', otherwise: { name: 'gray' } } } })
    expect(bodyOf(setLayer(files('Text("A").background(selected ? Color.blue : Color.gray)'), 'Text', [{ section: 'fill', fill: { kind: 'color', color: { name: 'red' }, when: { condition: 'selected', otherwise: { name: 'gray' } } } }])))
      .toBe('        Text("A").background(selected ? Color.red : Color.gray)')
    expect(layer('Text("A").foregroundStyle(on ? Color.red : .secondary)').text!.color).toMatchObject({ value: choice({ name: 'red' }, { name: 'secondary' }, 'on') })
    expect(bodyOf(setLayer(files('Text("A").foregroundStyle(on ? Color.red : Color.blue)'), 'Text', [{ section: 'text', color: choice({ name: 'red' }, { hex: '#0A84FF' }, 'on') }])))
      .toBe('        Text("A").foregroundStyle(on ? Color.red : Color(red: 0.039, green: 0.518, blue: 1))')
  })

  it('refuses one colour in place of the two', () => {
    expect(planLayer(files('Text("A").foregroundStyle(on ? Color.red : Color.blue)'), 'Text', [{ section: 'text', color: { name: 'green' } }])).toMatchObject({ ok: false, reason: expect.stringMatching(/depends on on/) })
    expect(planLayer(files('Text("A").background(selected ? Color.blue : Color.gray)'), 'Text', [{ section: 'fill', fill: { kind: 'color', color: { name: 'red' } } }])).toMatchObject({ ok: false })
  })
})

describe.skipIf(!XCODE)('what values and conditions write builds in Xcode 27', () => {
  it('for constants, detached values, fonts and both cases of a condition', () => {
    const changed = (body: string, change: Parameters<typeof setLayer>[2][number]) => text(setLayer(files(body), 'Text', [change]))
    const sources = [
      edit(files('Text("A").padding(inset)'), 'Text', { kind: 'style-edit', name: 'ContentView.inset', value: '24' }),
      edit(files('Text("A").frame(width: Layout.card)'), 'Text', { kind: 'style-edit', name: 'Layout.card', value: '280' }),
      edit(files('VStack(spacing: rowSpacing) {\n            Text("A")\n        }'), 'VStack', { kind: 'property', control: 'spacing:detach', value: 'true' }),
      edit(files('HStack(spacing: Self.gap) {\n            Text("A")\n        }'), 'HStack', { kind: 'property', control: 'spacing:declaration', value: '10' }),
      changed('Text("A").font(.heading)', { section: 'text', font: {} }),
      changed('Text("A").padding(selected ? 16 : 8)', { section: 'layout', padding: evenInsets({ condition: 'selected', then: 20, otherwise: 8 }) }),
      changed('Text("A").opacity(on ? 1 : 0.4)', { section: 'effects', opacity: { condition: 'on', then: 0.9, otherwise: 0.4 } }),
      changed('Text("A").background(selected ? Color.blue : Color.gray)', { section: 'fill', fill: { kind: 'color', color: { hex: '#FF0000' }, when: { condition: 'selected', otherwise: { name: 'mint' } } } }),
      changed('Text("A").foregroundStyle(on ? Color.red : Color.blue)', { section: 'text', color: { condition: 'on', then: { name: 'secondary' }, otherwise: { name: 'blue', opacity: 0.5 } } }),
      text(setLayer(files('Text("A").font(.heading)', MEMBERS, FONTS), 'Text', [{ section: 'text', font: {} }])),
    ]
    typecheckInXcode(sources)
    expect(sources).toHaveLength(10)
  }, 600_000)
})

/** Forty views reading the same constants: each one's layer gives their values. */
it('gives every view that reads a constant its value, in a project where many views read it', () => {
  const body = Array.from({ length: 40 }, (_, index) => `Text("${index}").padding(inset).frame(width: Layout.card)`).join('\n        ')
  const snapshot = buildAuthoringModel({ projectId: 'layer', revision: 1, files: files(`VStack {\n        ${body}\n        }`) })
  expect(snapshot.nodes.filter(view => view.name === 'Text').every(view => view.layer?.tokens?.inset?.value === 16)).toBe(true)
})
