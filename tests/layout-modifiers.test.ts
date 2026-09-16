import { describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Layout - defect register 9.4.
 *
 * `.alignmentGuide` is the one that needed the engine changed rather than extended.
 * A stack was offsetting children by their alignment, which is the *answer* rather
 * than the rule: SwiftUI lines up each child's alignment **guide**, and where the
 * default guides sit is what makes `.leading` and `.center` behave as they do. The
 * engine now does that, so the default cases come out identical - which is the first
 * thing tested here - and a guide can be replaced.
 *
 * `.safeAreaInset` is not an overlay. The child is offered the space that is left,
 * which is the whole point: a bar drawn this way does not cover the last row.
 */

const device = DEVICES['iphone-15']
let revision = 1

function run(source: string): CompileResult {
  resetPipelineState()
  return compile({
    files: [{ id: 'Sources/App.swift', text: source }],
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  } satisfies CompileRequest)
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

/**
 * The view's own fill, skipping the screen's.
 *
 * Every screen has a background node called `screen` behind everything else, and a
 * test that picks "the first node with a background" picks that one - which is the
 * same size whatever the modifier under test did, so the assertion always passes.
 */
function filled(r: CompileResult): RenderNode {
  const found = nodes(r).find((n) => n.id !== 'screen' && n.background)
  expect(found, 'expected the view to paint a fill of its own').toBeDefined()
  return found!
}

const warnings = (r: CompileResult): string[] =>
  r.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)

function node(r: CompileResult, label: string): RenderNode {
  const found = nodes(r).find(
    (n) => n.kind === 'text' && n.text?.runs.map((x) => x.text).join('') === label,
  )
  expect(found, `expected to draw "${label}"`).toBeDefined()
  return found!
}

describe('the general alignment rule', () => {
  // Two texts of very different widths, so an alignment that is wrong is obvious.
  const stack = (alignment: string, guides = '') =>
    view(`VStack(alignment: ${alignment}) { Text("a")${guides} ; Text("a much longer line") }`)

  it('leading still puts both left edges together', () => {
    const result = run(stack('.leading'))
    expect(node(result, 'a').frame.x).toBeCloseTo(node(result, 'a much longer line').frame.x, 1)
  })

  it('trailing still puts both right edges together', () => {
    const result = run(stack('.trailing'))
    const short = node(result, 'a')
    const long = node(result, 'a much longer line')
    expect(short.frame.x + short.frame.width).toBeCloseTo(long.frame.x + long.frame.width, 1)
  })

  it('center still puts both centres together', () => {
    const result = run(stack('.center'))
    const short = node(result, 'a')
    const long = node(result, 'a much longer line')
    expect(short.frame.x + short.frame.width / 2).toBeCloseTo(
      long.frame.x + long.frame.width / 2,
      1,
    )
  })
})

describe('.alignmentGuide', () => {
  it('moves the view by the constant it returns', () => {
    const plain = run(view('VStack(alignment: .leading) { Text("a") ; Text("bbbbbbbb") }'))
    const nudged = run(
      view(
        'VStack(alignment: .leading) { Text("a").alignmentGuide(.leading) { _ in -20 } ; Text("bbbbbbbb") }',
      ),
    )
    expect(warnings(nudged)).toEqual([])
    // A guide 20 points *before* the view's leading edge pushes the view right by 20.
    expect(node(nudged, 'a').frame.x - node(plain, 'a').frame.x).toBeCloseTo(20, 1)
  })

  it('reads the view dimensions it is handed', () => {
    // `d[.trailing]` is the view's own width, so aligning the leading guide on it
    // lines the trailing edges up instead - the canonical example.
    const result = run(
      view(
        'VStack(alignment: .leading) { Text("a").alignmentGuide(.leading) { d in d[.trailing] } ; Text("bbbbbbbb") }',
      ),
    )
    const short = node(result, 'a')
    const long = node(result, 'bbbbbbbb')
    expect(short.frame.x + short.frame.width).toBeCloseTo(long.frame.x, 1)
  })

  it('reads d.width the same way', () => {
    const viaWidth = run(
      view(
        'VStack(alignment: .leading) { Text("a").alignmentGuide(.leading) { d in d.width } ; Text("bbbbbbbb") }',
      ),
    )
    const viaGuide = run(
      view(
        'VStack(alignment: .leading) { Text("a").alignmentGuide(.leading) { d in d[.trailing] } ; Text("bbbbbbbb") }',
      ),
    )
    expect(node(viaWidth, 'a').frame.x).toBeCloseTo(node(viaGuide, 'a').frame.x, 3)
  })

  it('is found through the modifiers wrapped around it', () => {
    const inner = run(
      view(
        'VStack(alignment: .leading) { Text("a").alignmentGuide(.leading) { _ in -20 }.padding(0) ; Text("bbbbbbbb") }',
      ),
    )
    const outer = run(
      view(
        'VStack(alignment: .leading) { Text("a").padding(0).alignmentGuide(.leading) { _ in -20 } ; Text("bbbbbbbb") }',
      ),
    )
    expect(node(inner, 'a').frame.x).toBeCloseTo(node(outer, 'a').frame.x, 1)
  })

  it('ignores a guide for an alignment the stack is not using', () => {
    const plain = run(view('VStack(alignment: .leading) { Text("a") ; Text("bbbbbbbb") }'))
    const other = run(
      view(
        'VStack(alignment: .leading) { Text("a").alignmentGuide(.trailing) { _ in -50 } ; Text("bbbbbbbb") }',
      ),
    )
    expect(node(other, 'a').frame.x).toBeCloseTo(node(plain, 'a').frame.x, 1)
  })
})

describe('.safeAreaInset', () => {
  const inset = (edge: string) =>
    view(
      `Color.blue.safeAreaInset(edge: ${edge}) { Text("bar").frame(height: 40) }`,
    )

  it('draws the inset content', () => {
    const result = run(inset('.bottom'))
    expect(warnings(result)).toEqual([])
    expect(nodes(result).some((n) => n.kind === 'text')).toBe(true)
  })

  it('pins it to the edge it names', () => {
    const bottom = node(run(inset('.bottom')), 'bar')
    const top = node(run(inset('.top')), 'bar')
    expect(top.frame.y).toBeLessThan(bottom.frame.y)
  })

  it('takes the space from the content rather than covering it', () => {
    // The difference from `.overlay`, and the reason this exists: an inset toolbar
    // must not sit on top of the last row. A `Spacer` pushes `last` as far down as
    // the content is allowed to go, so where it lands *is* the space that was left.
    const column = 'VStack { Text("first") ; Spacer() ; Text("last") }'
    const plain = node(run(view(column)), 'last')
    const withBar = node(
      run(view(`${column}.safeAreaInset(edge: .bottom) { Text("bar").frame(height: 40) }`)),
      'last',
    )
    expect(withBar.frame.y).toBeLessThan(plain.frame.y)
  })

  it('a leading inset takes width instead of height', () => {
    const row = 'HStack { Text("first") ; Spacer() ; Text("last") }'
    const plain = node(run(view(row)), 'last')
    const withBar = node(
      run(view(`${row}.safeAreaInset(edge: .leading) { Text("side").frame(width: 60) }`)),
      'last',
    )
    // A leading inset moves the content's *leading* edge in and narrows it, so the
    // trailing edge stays where it was. The first text is the one that has to move.
    const plainFirst = node(run(view(row)), 'first')
    const insetFirst = node(
      run(view(`${row}.safeAreaInset(edge: .leading) { Text("side").frame(width: 60) }`)),
      'first',
    )
    expect(insetFirst.frame.x - plainFirst.frame.x).toBeCloseTo(60, 1)
    expect(withBar.frame.y).toBeCloseTo(plain.frame.y, 1)
  })
})

describe('a view that is only a colour', () => {
  it('draws, rather than leaving the screen blank', () => {
    // `var body: some View { Color.blue }` is the one-liner for filling a screen, and
    // it drew nothing. Three builders each kept only the values that were already
    // views, and a `Color` is a view without being one - so it was dropped at the
    // root while the same colour inside a `VStack` drew fine.
    const result = run(view('Color.blue'))
    expect(filled(result).frame.width).toBeCloseTo(device.width, 1)
  })

  it('draws when it is the whole of a #Preview too', () => {
    const result = run(
      ['import SwiftUI', '#Preview { Color.blue }'].join('\n'),
    )
    expect(filled(result).frame.width).toBeCloseTo(device.width, 1)
  })
})

describe('.containerRelativeFrame', () => {
  it('takes the container width', () => {
    const result = run(view('Text("a").containerRelativeFrame(.horizontal).background(Color.red)'))
    expect(warnings(result)).toEqual([])
    expect(filled(result).frame.width).toBeCloseTo(device.width, 1)
  })

  it('divides it by count', () => {
    const result = run(
      view('Text("a").containerRelativeFrame(.horizontal, count: 3, spacing: 0).background(Color.red)'),
    )
    expect(filled(result).frame.width).toBeCloseTo(device.width / 3, 1)
  })

  it('leaves the other axis to the content', () => {
    const plain = node(run(view('Text("a").fixedSize()')), 'a')
    const framed = node(run(view('Text("a").containerRelativeFrame(.horizontal)')), 'a')
    expect(framed.frame.height).toBeCloseTo(plain.frame.height, 1)
  })
})
