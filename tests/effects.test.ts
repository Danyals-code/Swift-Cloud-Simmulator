import { describe, expect, it } from 'vitest'
import { rotationProjection } from '@studio/shared'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Effects and animation - defect register 9.5.
 *
 * Most of these are CSS operations with the same definition as the SwiftUI ones, so
 * the work was plumbing rather than approximation: a hue rotation is a hue rotation.
 * Pixel multiplication preserves alpha; 3D rotation uses an axis-angle projection.
 *
 * `.animation(_:value:)` is the interesting one. The gate needs the *previous*
 * render's value to compare against, which no stage but the resolver has - so a
 * version that read only the current frame could not honour it at all, and the
 * modifier animated its whole subtree on every render.
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

const view = (expr: string, extra = ''): string => app(`    var body: some View { ${expr} }`, extra)

const nodes = (r: CompileResult): readonly RenderNode[] => r.renderTree?.nodes ?? []

const warnings = (r: CompileResult): string[] =>
  r.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)

describe('colour effects', () => {
  it('hueRotation reaches the filter', () => {
    const result = run(view('Color.red.hueRotation(.degrees(90))'))
    expect(warnings(result)).toEqual([])
    expect(nodes(result).some((n) => n.filter?.hueRotate === 90)).toBe(true)
  })

  it('colorMultiply carries the colour, not a filter function', () => {
    // There is no CSS filter that multiplies by an arbitrary colour, so this is an
    // overlay in multiply blend mode - the same operation, drawn differently.
    const result = run(view('Color.white.colorMultiply(.red)'))
    expect(warnings(result)).toEqual([])
    const multiplied = nodes(result).find((n) => n.filter?.multiply)
    expect(multiplied?.filter?.multiply?.r).toBeGreaterThan(200)
  })

  it('blendMode maps to the CSS mode of the same name', () => {
    const result = run(view('Color.red.blendMode(.multiply)'))
    expect(warnings(result)).toEqual([])
    expect(nodes(result).some((n) => n.blendMode === 'multiply')).toBe(true)

    expect(nodes(run(view('Color.red.blendMode(.colorDodge)'))).some((n) => n.blendMode === 'color-dodge')).toBe(true)
  })

  it('a blend mode CSS has no equivalent for warns rather than drawing the nearest one', () => {
    // Drawing `.plusLighter` as `screen` would put something plausible on screen that
    // the device does not draw, which is the failure mode the whole project refuses.
    expect(warnings(run(view('Text("a").blendMode(.plusLighter)')))[0]).toContain('blendMode')
    expect(warnings(run(view('Text("a").blendMode(.plusLighter)')))[0]).toContain('plusLighter')
  })

  it('blend mode is inherited, so it applies to the content and not a box round it', () => {
    const result = run(view('VStack { Text("a") ; Text("b") }.blendMode(.screen)'))
    expect(nodes(result).filter((n) => n.kind === 'text' && n.blendMode === 'screen')).toHaveLength(2)
  })
})

describe('.rotation3DEffect', () => {
  it('retains the supplied axis and angle for a single axis-angle projection', () => {
    const result = run(view('Text("a").rotation3DEffect(.degrees(60), axis: (x: 0, y: 1, z: 0))'))
    expect(nodes(result).find(n => n.transform)?.transform?.rotation3D).toMatchObject({ degrees: 60, x: 0, y: 1, z: 0 })
  })
  it('a z axis has the same projected corners as a flat rotation', () => {
    const result = run(view('Text("a").rotation3DEffect(.degrees(45), axis: (x: 0, y: 0, z: 1), anchor: .topLeading)'))
    const node = nodes(result).find(n => n.transform)!
    const [a,b,c,d,e,f] = rotationProjection(node.transform!, node.frame)
    expect([a,b,c,d,e,f]).toEqual([Math.SQRT1_2, Math.sin(Math.PI/4), -0, -Math.sin(Math.PI/4), Math.SQRT1_2, -0])
  })
  it('normalises arbitrary axes without converting them to Euler angles', () => {
    const projection = (axis: string) => { const n = nodes(run(view(`Text("a").rotation3DEffect(.degrees(90), axis: ${axis}, perspective: 0)`))).find(n => n.transform)!; return rotationProjection(n.transform!, {width:100,height:100}) }
    const a = projection('(x: 1, y: 1, z: 0)'), b = projection('(x: 10, y: 10, z: 0)')
    a.forEach((value,i) => expect(value).toBeCloseTo(b[i]!, 10))
    expect(a[0]).toBeCloseTo(0.5)
    expect(a[1]).toBeCloseTo(0.5)
  })

  it('does not change layout, because it is paint-time', () => {
    const plain = nodes(run(view('Text("hello").fixedSize()'))).find((n) => n.kind === 'text')!
    const turned = nodes(
      run(view('Text("hello").rotation3DEffect(.degrees(45), axis: (x: 0, y: 1, z: 0)).fixedSize()')),
    ).find((n) => n.kind === 'text')!
    expect(turned.frame.width).toBeCloseTo(plain.frame.width, 3)
  })
})

describe('.redacted', () => {
  it('marks the content rather than removing it', () => {
    // The frame is what the bar occupies, so the text has to still be laid out. A
    // version that dropped the subtree would draw bars of the wrong size.
    const result = run(view('Text("secret").redacted(reason: .placeholder)'))
    expect(warnings(result)).toEqual([])

    const text = nodes(result).find((n) => n.kind === 'text')
    expect(text, 'the text is still laid out').toBeDefined()
    expect(text!.redacted).toBe(true)
  })

  it('applies to a whole subtree', () => {
    const result = run(view('VStack { Text("a") ; Text("b") }.redacted(reason: .placeholder)'))
    expect(nodes(result).filter((n) => n.kind === 'text' && n.redacted)).toHaveLength(2)
  })

  it('.unredacted turns it back off inside', () => {
    const result = run(
      view('VStack { Text("a") ; Text("b").unredacted() }.redacted(reason: .placeholder)'),
    )
    const texts = nodes(result).filter((n) => n.kind === 'text')
    expect(texts.filter((n) => n.redacted)).toHaveLength(1)
  })
})

describe('.animation(_:value:)', () => {
  const source = app(
    [
      '    @State private var n = 0',
      '    @State private var other = 0',
      '    var body: some View {',
      '        VStack {',
      '            Text("n \\(n)").animation(.easeInOut, value: n)',
      '            Button("bump n") { n += 1 }',
      '            Button("bump other") { other += 1 }',
      '        }',
      '    }',
    ].join('\n'),
  )

  const animated = (r: CompileResult): boolean => nodes(r).some((n) => n.animation)

  function press(r: CompileResult, label: string): CompileResult {
    const target = nodes(r).find((n) => n.hitTarget && n.a11y?.label === label)
    expect(target, `no control called "${label}"`).toBeDefined()
    applyEvent({ kind: 'tap', handlerId: target!.hitTarget!.handlerId, location: { x: 0, y: 0 } })
    return rerender(revision++)
  }

  it('does not animate the first render', () => {
    // A view is not animated in because it appeared. That is what `.transition` is for.
    resetPipelineState()
    expect(animated(compile(request(source)))).toBe(false)
  })

  it('animates when the gated value changes', () => {
    resetPipelineState()
    const first = compile(request(source))
    expect(animated(press(first, 'bump n'))).toBe(true)
  })

  it('does not animate when something else changes', () => {
    // The whole point of the gate. Without it the subtree animated on every render,
    // so a view slid around because an unrelated piece of state moved.
    resetPipelineState()
    const first = compile(request(source))
    expect(animated(press(first, 'bump other'))).toBe(false)
  })

  it('the ungated form still animates its subtree', () => {
    const plain = run(view('Text("a").animation(.easeInOut)'))
    expect(nodes(plain).some((n) => n.animation)).toBe(true)
  })
})
