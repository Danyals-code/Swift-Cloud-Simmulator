import { describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Control styles that all drew the same - defect register 9.3.
 *
 * `.toggleStyle`, `.pickerStyle` and `.labelStyle` were "recognised" and inert, which
 * is the quietest kind of wrong: no warning, and a control that looks like the
 * default whatever was asked for. `.controlSize`, `.buttonBorderShape`,
 * `.progressViewStyle` and `.gaugeStyle` did warn, so at least they were honest.
 *
 * A style is only worth anything if it changes the drawing, so each case here
 * compares against the *default* rendering rather than asserting a shape in the
 * abstract. The segmented picker additionally has to stay operable: an inline control
 * whose segments cannot be pressed is the lie the controls pass existed to remove.
 */

const device = DEVICES['iphone-15']
let revision = 1

function request(source: string): CompileRequest {
  return {
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  }
}

function run(source: string): CompileResult {
  resetPipelineState()
  return compile(request(source))
}

function app(body: string, extra = ''): string {
  return [
    'import SwiftUI',
    '@main',
    'struct DemoApp: App { var body: some Scene { WindowGroup { ContentView() } } }',
    'struct ContentView: View {',
    body,
    '}',
    extra,
  ].join('\n')
}

const nodes = (r: CompileResult): readonly RenderNode[] => r.renderTree?.nodes ?? []

const texts = (r: CompileResult): string[] =>
  nodes(r)
    .filter((n) => n.kind === 'text')
    .map((n) => n.text!.runs.map((x) => x.text).join(''))

const warnings = (r: CompileResult): string[] =>
  r.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)

const buttons = (r: CompileResult): readonly RenderNode[] =>
  nodes(r).filter((n) => n.hitTarget?.role === 'button')

function node(r: CompileResult, label: string): RenderNode {
  const found = nodes(r).find(
    (n) => n.kind === 'text' && n.text?.runs.map((x) => x.text).join('') === label,
  )
  expect(found, `expected to draw "${label}"`).toBeDefined()
  return found!
}

const toggle = (style = '') =>
  app(
    `    @State private var on = true\n    var body: some View { Toggle("Wi-Fi", isOn: $on)${style} }`,
  )

const picker = (style = '') =>
  app(
    [
      '    @State private var choice = 1',
      '    var body: some View {',
      '        Picker("Mode", selection: $choice) {',
      '            Text("One").tag(1)',
      '            Text("Two").tag(2)',
      '        }' + style,
      '    }',
    ].join('\n'),
  )

describe('.toggleStyle', () => {
  it('draws a track by default', () => {
    // The switch is the only style with a capsule wider than it is tall beside the label.
    const shapes = nodes(run(toggle())).filter((n) => n.cornerRadius === 15.5 || n.kind === 'shape')
    expect(shapes.length).toBeGreaterThan(0)
  })

  it('.button drops the track and tints the label instead', () => {
    const result = run(toggle('.toggleStyle(.button)'))
    expect(warnings(result)).toEqual([])
    expect(texts(result)).toContain('Wi-Fi')

    // No circular knob: a button toggle has no switch at all.
    expect(nodes(result).some((n) => n.shape?.shape === 'circle')).toBe(false)
  })

  it('.button tints differently on and off', () => {
    const on = node(run(toggle('.toggleStyle(.button)')), 'Wi-Fi')
    const off = node(
      run(
        app(
          '    @State private var on = false\n    var body: some View { Toggle("Wi-Fi", isOn: $on).toggleStyle(.button) }',
        ),
      ),
      'Wi-Fi',
    )
    expect(on.text?.runs[0]?.color).not.toEqual(off.text?.runs[0]?.color)
  })

  it('.checkbox leads with a box rather than trailing with a switch', () => {
    const result = run(toggle('.toggleStyle(.checkbox)'))
    const box = nodes(result).find((n) => n.kind === 'image')
    expect(box, 'expected a checkbox glyph').toBeDefined()
    expect(box!.frame.x).toBeLessThan(node(result, 'Wi-Fi').frame.x)
  })

  it('stays pressable in every style', () => {
    for (const style of ['', '.toggleStyle(.button)', '.toggleStyle(.checkbox)']) {
      expect(nodes(run(toggle(style))).some((n) => n.hitTarget), style).toBe(true)
    }
  })

  it('is inherited, so a Form can set it for every toggle inside', () => {
    const result = run(
      app(
        '    @State private var on = true\n    var body: some View { Form { Toggle("Wi-Fi", isOn: $on) }.toggleStyle(.checkbox) }',
      ),
    )
    expect(nodes(result).some((n) => n.kind === 'image')).toBe(true)
  })
})

describe('.pickerStyle', () => {
  it('draws the label and value behind a press by default', () => {
    const result = run(picker())
    expect(texts(result)).toContain('Mode')
    // The options are not on screen until it is opened.
    expect(texts(result)).not.toContain('Two')
  })

  it('.segmented puts every option on screen in a row', () => {
    const result = run(picker('.pickerStyle(.segmented)'))
    expect(warnings(result)).toEqual([])
    expect(texts(result)).toContain('One')
    expect(texts(result)).toContain('Two')
    expect(node(result, 'One').frame.x).toBeLessThan(node(result, 'Two').frame.x)
    expect(node(result, 'One').frame.y).toBeCloseTo(node(result, 'Two').frame.y, 1)
  })

  it('.segmented gives every segment a target of its own', () => {
    expect(buttons(run(picker('.pickerStyle(.segmented)'))).length).toBeGreaterThanOrEqual(2)
  })

  it('.segmented writes the binding when a segment is pressed', () => {
    resetPipelineState()
    const source = app(
      [
        '    @State private var choice = 1',
        '    var body: some View {',
        '        VStack {',
        '            Text("picked \\(choice)")',
        '            Picker("Mode", selection: $choice) {',
        '                Text("One").tag(1)',
        '                Text("Two").tag(2)',
        '            }.pickerStyle(.segmented)',
        '        }',
        '    }',
      ].join('\n'),
    )
    const before = compile(request(source))
    expect(texts(before)).toContain('picked 1')

    const two = nodes(before).find(
      (n) => n.hitTarget && n.a11y?.label === 'Two',
    )
    expect(two, 'expected a target on the second segment').toBeDefined()

    applyEvent({ kind: 'tap', handlerId: two!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    expect(texts(rerender(revision++))).toContain('picked 2')
  })

  it('.inline lists the options and ticks the chosen one', () => {
    const result = run(picker('.pickerStyle(.inline)'))
    expect(texts(result)).toContain('One')
    expect(texts(result)).toContain('Two')
    expect(node(result, 'One').frame.y).toBeLessThan(node(result, 'Two').frame.y)
    expect(nodes(result).some((n) => n.image?.symbol === 'checkmark')).toBe(true)
  })

  it('.wheel dims what is not selected', () => {
    const result = run(picker('.pickerStyle(.wheel)'))
    expect(texts(result)).toContain('One')
    expect(nodes(result).some((n) => n.opacity > 0 && n.opacity < 1)).toBe(true)
  })

  it('is inherited from the Form it is written on', () => {
    const result = run(
      app(
        [
          '    @State private var choice = 1',
          '    var body: some View {',
          '        Form {',
          '            Picker("Mode", selection: $choice) {',
          '                Text("One").tag(1)',
          '                Text("Two").tag(2)',
          '            }',
          '        }.pickerStyle(.segmented)',
          '    }',
        ].join('\n'),
      ),
    )
    expect(texts(result)).toContain('Two')
  })

  /**
   * `Picker { ForEach(options) { … } }` - how a picker over a collection is written.
   *
   * Its options are a level down inside the `ForEach`, and nothing flattened them: the
   * segmented drawing rendered a placeholder for a container it did not recognise, and
   * the popup had a list with nothing in it to tick. A template caught this, but only
   * as "the Settings template has a placeholder", which names the symptom and not the
   * cause - so it is pinned here, beside the style that exposed it.
   */
  const overForEach = (style: string) =>
    app(
      [
        '    @State private var choice = "b"',
        '    var body: some View {',
        '        Picker("Pick", selection: $choice) {',
        '            ForEach(["a", "b", "c"], id: \\.self) { option in',
        '                Text(option).tag(option)',
        '            }',
        '        }' + style,
        '    }',
      ].join('\n'),
    )

  it('takes its options from a ForEach, drawn inline', () => {
    const result = run(overForEach('.pickerStyle(.segmented)'))
    expect(warnings(result)).toEqual([])
    expect(nodes(result).filter((n) => n.kind === 'placeholder')).toEqual([])
    expect(texts(result)).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect(buttons(result).length).toBeGreaterThanOrEqual(3)
  })

  it('takes them from a ForEach when it opens onto them too', () => {
    resetPipelineState()
    const first = compile(request(overForEach('')))
    const control = nodes(first).find((n) => n.hitTarget && n.a11y?.label === 'Pick')
    expect(control, 'expected the picker to be pressable').toBeDefined()
    applyEvent({ kind: 'tap', handlerId: control!.hitTarget!.handlerId, location: { x: 0, y: 0 } })

    const opened = rerender(revision++)
    expect(nodes(opened).filter((n) => n.kind === 'placeholder')).toEqual([])
    expect(texts(opened)).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    // The one currently chosen is ticked, which is the only thing on screen that
    // reports the value once the list is up.
    expect(nodes(opened).some((n) => n.image?.symbol === 'checkmark')).toBe(true)
  })
})

describe('.labelStyle', () => {
  const label = (style = '') =>
    app(`    var body: some View { Label("Files", systemImage: "folder")${style} }`)

  it('draws both halves by default', () => {
    const result = run(label())
    expect(texts(result)).toContain('Files')
    expect(nodes(result).some((n) => n.kind === 'image')).toBe(true)
  })

  it('.iconOnly drops the title', () => {
    const result = run(label('.labelStyle(.iconOnly)'))
    expect(texts(result)).not.toContain('Files')
    expect(nodes(result).some((n) => n.kind === 'image')).toBe(true)
  })

  it('.titleOnly drops the icon', () => {
    const result = run(label('.labelStyle(.titleOnly)'))
    expect(texts(result)).toContain('Files')
    expect(nodes(result).some((n) => n.kind === 'image')).toBe(false)
  })

  it('reaches a Label inside the button that set it', () => {
    const result = run(
      app(
        '    var body: some View { Button { } label: { Label("Files", systemImage: "folder") }.labelStyle(.iconOnly) }',
      ),
    )
    expect(texts(result)).not.toContain('Files')
  })
})

describe('.progressViewStyle and .gaugeStyle', () => {
  it('a determinate ProgressView is a bar by default', () => {
    const result = run(app('    var body: some View { ProgressView(value: 0.5) }'))
    expect(nodes(result).some((n) => n.shape?.shape === 'spinner')).toBe(false)
  })

  // The indeterminate drawing is the activity indicator now, not a filled circle.
  it('.circular is a spinner even with a value in hand', () => {
    const result = run(
      app('    var body: some View { ProgressView(value: 0.5).progressViewStyle(.circular) }'),
    )
    expect(warnings(result)).toEqual([])
    expect(nodes(result).some((n) => n.shape?.shape === 'spinner')).toBe(true)
  })

  it('an accessoryCircular gauge uses a value marker and never a loading spinner', () => {
    const circular = run(
      app(
        '    var body: some View { Gauge(value: 0.5) { Text("g") }.gaugeStyle(.accessoryCircular) }',
      ),
    )
    const linear = run(
      app(
        '    var body: some View { Gauge(value: 0.5) { Text("g") }.gaugeStyle(.accessoryLinear) }',
      ),
    )
    expect(nodes(circular).some((n) => n.shape?.shape === 'spinner')).toBe(false)
    expect(nodes(circular).some((n) => n.id.endsWith('-marker'))).toBe(true)
    expect(nodes(circular).some((n) => n.path)).toBe(true)
    expect(nodes(linear).some((n) => n.shape?.shape === 'spinner')).toBe(false)
  })
})

describe('.controlSize and .buttonBorderShape', () => {
  const button = (style: string) =>
    app(`    var body: some View { Button("Go") { }.buttonStyle(.bordered)${style} }`)

  it('.small draws a smaller button than .large', () => {
    const small = buttons(run(button('.controlSize(.small)')))[0]!
    const large = buttons(run(button('.controlSize(.large)')))[0]!
    expect(small.frame.width).toBeLessThan(large.frame.width)
    expect(small.frame.height).toBeLessThan(large.frame.height)
  })

  it('neither warns any more', () => {
    expect(warnings(run(button('.controlSize(.small)')))).toEqual([])
    expect(warnings(run(button('.buttonBorderShape(.capsule)')))).toEqual([])
  })

  it('uses a capsule by default and honors roundedRectangle', () => {
    const plain = nodes(run(button('.buttonBorderShape(.roundedRectangle)'))).find((n) => n.cornerRadius === 8)
    const capsule = nodes(run(button('.buttonBorderShape(.capsule)'))).find(
      (n) => (n.cornerRadius ?? 0) > 8,
    )
    expect(plain, 'an explicit rounded rectangle retains its corners').toBeDefined()
    expect(capsule, 'a capsule button rounds further').toBeDefined()
    expect(nodes(run(button(''))).some((n) => n.cornerRadius === capsule!.cornerRadius)).toBe(true)
  })

  it('a bordered button is rounded at all', () => {
    // It was not. The radius was applied *inside* the background rather than around
    // it, and a fill only takes a radius from the inherited environment - so every
    // bordered button drew square corners, which nothing asserted either way.
    const filled = nodes(run(button(''))).filter((n) => n.background)
    expect(filled.some((n) => (n.cornerRadius ?? 0) > 0)).toBe(true)
  })
})
