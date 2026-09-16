import { describe, expect, it } from 'vitest'
import type { CompileRequest, CompileResult, RenderNode, TextPayload } from '@studio/shared'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Text beyond size, weight and colour - defect register 9.2, and the `Text + Text`
 * row of 9.6, which are one piece of work rather than two.
 *
 * `TextRun` carried only text, font and colour, so there was nowhere to put an
 * underline; and the painter read `runs[0]` and dropped the rest, so even the runs
 * that did exist could not be drawn. Concatenation needed both halves of that fixed,
 * which is why it lived in the same change.
 *
 * The measurement half is what makes these more than CSS: `.tracking` widens every
 * cluster and `.lineSpacing` grows the box, so the *frame the engine reports* has to
 * change too. A test that only checked the paint attributes would pass against a
 * version that draws the right letters in the wrong place.
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

function textNodes(result: CompileResult): RenderNode[] {
  return (result.renderTree?.nodes ?? []).filter((n) => n.kind === 'text')
}

function firstText(result: CompileResult): TextPayload {
  const node = textNodes(result)[0]
  expect(node, 'expected a text node').toBeDefined()
  return node!.text!
}

const errors = (result: CompileResult): string[] =>
  result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)

const warnings = (result: CompileResult): string[] =>
  result.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)

describe('text attributes', () => {
  it('underlines and strikes through', () => {
    const under = firstText(run(view('Text("a").underline()')))
    expect(under.runs[0]?.underline).toBe(true)
    expect(under.runs[0]?.strikethrough).toBeUndefined()

    const struck = firstText(run(view('Text("a").strikethrough()')))
    expect(struck.runs[0]?.strikethrough).toBe(true)

    const both = firstText(run(view('Text("a").underline().strikethrough()')))
    expect(both.runs[0]?.underline).toBe(true)
    expect(both.runs[0]?.strikethrough).toBe(true)
  })

  it('reads the Bool argument, so a binding can turn one off', () => {
    const off = firstText(run(view('Text("a").underline(false)')))
    expect(off.runs[0]?.underline).toBeFalsy()
  })

  it('inherits down the tree, because these are View modifiers', () => {
    const payload = firstText(run(view('VStack { Text("a") }.underline()')))
    expect(payload.runs[0]?.underline).toBe(true)
  })

  it('carries the baseline offset', () => {
    const payload = firstText(run(view('Text("a").baselineOffset(4)')))
    expect(payload.runs[0]?.baselineOffset).toBe(4)
  })

  it('none of them warns any more', () => {
    for (const modifier of [
      'underline()',
      'strikethrough()',
      'kerning(2)',
      'tracking(2)',
      'baselineOffset(3)',
      'lineSpacing(6)',
    ]) {
      const result = run(view(`Text("a").${modifier}`))
      expect(warnings(result), modifier).toEqual([])
    }
  })

  describe('the measured half', () => {
    it('tracking widens the text it is applied to', () => {
      const plain = textNodes(run(view('Text("hello").fixedSize()')))[0]!
      const tracked = textNodes(run(view('Text("hello").tracking(4).fixedSize()')))[0]!

      // Five clusters, four points each.
      expect(tracked.frame.width).toBeCloseTo(plain.frame.width + 5 * 4, 1)
      expect(tracked.text?.runs[0]?.tracking).toBe(4)
    })

    it('kerning is measured the same way', () => {
      const tracked = textNodes(run(view('Text("hello").tracking(4).fixedSize()')))[0]!
      const kerned = textNodes(run(view('Text("hello").kerning(4).fixedSize()')))[0]!
      expect(kerned.frame.width).toBeCloseTo(tracked.frame.width, 5)
    })

    it('lineSpacing grows the box by one gap per break, not per line', () => {
      const wrapped = 'Text("one two three four five six seven eight nine ten")'
      const plain = textNodes(run(view(`${wrapped}.frame(width: 120)`)))[0]!
      const spaced = textNodes(run(view(`${wrapped}.lineSpacing(10).frame(width: 120)`)))[0]!

      const lines = plain.text?.lines?.length ?? 0
      expect(lines).toBeGreaterThan(1)
      expect(spaced.frame.height).toBeCloseTo(plain.frame.height + (lines - 1) * 10, 1)
    })

    it('a single line is unaffected by lineSpacing', () => {
      const plain = textNodes(run(view('Text("a").fixedSize()')))[0]!
      const spaced = textNodes(run(view('Text("a").lineSpacing(10).fixedSize()')))[0]!
      expect(spaced.frame.height).toBeCloseTo(plain.frame.height, 5)
    })

    it('spaces the painted lines apart by the same amount', () => {
      const wrapped = 'Text("one two three four five six seven eight nine ten")'
      const payload = firstText(run(view(`${wrapped}.lineSpacing(10).frame(width: 120)`)))
      const [first, second] = payload.lines ?? []
      expect(first && second).toBeTruthy()
      expect(second!.origin.y - first!.origin.y).toBeCloseTo(
        payload.runs[0]!.font.lineHeight + 10,
        3,
      )
    })
  })
})

describe('Text + Text', () => {
  it('renders both halves instead of stopping the preview', () => {
    const result = run(view('Text("Hello, ") + Text("world")'))
    expect(errors(result)).toEqual([])

    const payload = firstText(result)
    expect(payload.runs.map((r) => r.text)).toEqual(['Hello, ', 'world'])
  })

  it('keeps each half its own weight', () => {
    const payload = firstText(run(view('Text("a").bold() + Text("b")')))
    expect(payload.runs[0]?.font.weight).toBe(700)
    expect(payload.runs[1]?.font.weight).not.toBe(700)
  })

  it('keeps each half its own colour', () => {
    const payload = firstText(run(view('Text("a").foregroundColor(.red) + Text("b")')))
    expect(payload.runs[0]?.color).not.toEqual(payload.runs[1]?.color)
  })

  it('lets a half carry an attribute of its own', () => {
    const payload = firstText(run(view('Text("a") + Text("b").underline()')))
    expect(payload.runs[0]?.underline).toBeUndefined()
    expect(payload.runs[1]?.underline).toBe(true)
  })

  it('chains left-associatively into one flat list', () => {
    const payload = firstText(run(view('Text("a") + Text("b") + Text("c")')))
    expect(payload.runs.map((r) => r.text)).toEqual(['a', 'b', 'c'])
  })

  it('lets the whole expression be styled, reaching every span', () => {
    const payload = firstText(run(view('(Text("a") + Text("b")).font(.largeTitle)')))
    expect(payload.runs).toHaveLength(2)
    const sizes = payload.runs.map((r) => r.font.size)
    expect(sizes[0]).toBe(sizes[1])
    expect(sizes[0]).toBeGreaterThan(20)
  })

  it('a span that set its own face keeps it when the whole is styled', () => {
    const payload = firstText(run(view('(Text("a").bold() + Text("b")).font(.title)')))
    expect(payload.runs[0]?.font.weight).toBe(700)
    expect(payload.runs[1]?.font.weight).not.toBe(700)
    expect(payload.runs[0]?.font.size).toBe(payload.runs[1]?.font.size)
  })

  it('measures as the sum of its spans', () => {
    const joined = textNodes(run(view('(Text("ab") + Text("cd")).fixedSize()')))[0]!
    const whole = textNodes(run(view('Text("abcd").fixedSize()')))[0]!
    expect(joined.frame.width).toBeCloseTo(whole.frame.width, 3)
  })

  it('reports the whole string as one accessible label', () => {
    const node = textNodes(run(view('Text("Hello, ") + Text("world")')))[0]!
    expect(node.a11y?.label).toBe('Hello, world')
  })

  it('keeps the two spans apart on a line that contains both', () => {
    const payload = firstText(run(view('Text("ab") + Text("cd")')))
    const [line] = payload.lines ?? []
    expect(line?.slices?.map((s) => [s.run, s.text])).toEqual([
      [0, 'ab'],
      [1, 'cd'],
    ])
  })

  it('attributes each line to the spans it came from when it wraps mid-word', () => {
    // The seam falls inside "three", so a line has to be attributable to both spans -
    // which is exactly what could not be recovered from the line's text alone.
    const payload = firstText(
      run(view('(Text("one two thr") + Text("ee four five")).frame(width: 90)')),
    )
    const lines = payload.lines ?? []
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.slices, 'every line of multi-run text carries slices').toBeDefined()
      expect(line.slices!.map((s) => s.text).join('')).toBe(line.text)
    }
    expect(lines.some((l) => new Set(l.slices!.map((s) => s.run)).size > 1)).toBe(true)
  })

  it('leaves single-run text with no per-line slices to carry', () => {
    const payload = firstText(run(view('Text("one two three four").frame(width: 90)')))
    expect((payload.lines ?? []).every((l) => l.slices === undefined)).toBe(true)
  })

  it('declines to concatenate anything that is not a Text', () => {
    // Reported rather than drawn as an empty span: SwiftUI has no such operator, and
    // inventing one would draw nothing where the user expects something.
    const result = run(view('Text("a") + VStack { Text("b") }'))
    expect(errors(result).length).toBeGreaterThan(0)
  })
})
