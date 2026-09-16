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

describe('what the renderer is handed', () => {
  it('leaves single-run text as one line box with no span inside it', () => {
    // The shape the DOM ends up with follows from this: a line with no slices is
    // painted by the line element itself, which is what keeps the painted colour on
    // the element the line *is* rather than on a child of it. Making every line a
    // span broke a dark-mode gate that reads the line's own computed colour, and
    // cost a DOM node per line of every label in every app.
    const payload = firstText(run(view('Text("one two three four").frame(width: 90)')))
    expect(payload.runs).toHaveLength(1)
    expect((payload.lines ?? []).every((l) => l.slices === undefined)).toBe(true)
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

describe('the half that asks measurement to answer back', () => {
  const long = 'Text("one two three four five six seven eight")'

  it('minimumScaleFactor shrinks the text until it fits its line limit', () => {
    const clipped = firstText(run(view(`${long}.lineLimit(1).frame(width: 120)`)))
    const shrunk = firstText(
      run(view(`${long}.lineLimit(1).minimumScaleFactor(0.5).frame(width: 120)`)),
    )

    expect(shrunk.runs[0]!.font.size).toBeLessThan(clipped.runs[0]!.font.size)
    // And it does not shrink past the floor it was given.
    expect(shrunk.runs[0]!.font.size).toBeGreaterThanOrEqual(clipped.runs[0]!.font.size * 0.5)
  })

  it('leaves text that already fits at full size', () => {
    const plain = firstText(run(view('Text("ok").lineLimit(1).fixedSize()')))
    const scalable = firstText(
      run(view('Text("ok").lineLimit(1).minimumScaleFactor(0.5).fixedSize()')),
    )
    expect(scalable.runs[0]!.font.size).toBe(plain.runs[0]!.font.size)
  })

  it('truncates at the tail by default', () => {
    const payload = firstText(run(view(`${long}.lineLimit(1).frame(width: 120)`)))
    const line = payload.lines?.[0]?.text ?? ''
    expect(line.endsWith('…')).toBe(true)
    expect(line.startsWith('one')).toBe(true)
  })

  it('.head keeps the end and marks the start', () => {
    const payload = firstText(
      run(view(`${long}.lineLimit(1).truncationMode(.head).frame(width: 120)`)),
    )
    const line = payload.lines?.[0]?.text ?? ''
    expect(line.startsWith('…')).toBe(true)
    expect(line.endsWith('eight')).toBe(true)
  })

  it('.middle keeps both ends', () => {
    const payload = firstText(
      run(view(`${long}.lineLimit(1).truncationMode(.middle).frame(width: 120)`)),
    )
    const line = payload.lines?.[0]?.text ?? ''
    expect(line.startsWith('one')).toBe(true)
    expect(line.endsWith('eight')).toBe(true)
    expect(line).toContain('…')
  })

  it('never reports a line wider than the box it was measured in', () => {
    // The point of doing this in measurement rather than in CSS: whatever is drawn,
    // the frame the engine reported has to be one the text actually occupies.
    for (const mode of ['.head', '.middle', '.tail']) {
      const node = textNodes(
        run(view(`${long}.lineLimit(1).truncationMode(${mode}).frame(width: 120)`)),
      )[0]!
      for (const line of node.text?.lines ?? []) {
        expect(line.width, mode).toBeLessThanOrEqual(120.05)
      }
    }
  })

  it('neither warns any more', () => {
    for (const modifier of ['minimumScaleFactor(0.5)', 'truncationMode(.middle)']) {
      expect(warnings(run(view(`Text("a").${modifier}`))), modifier).toEqual([])
    }
  })
})

describe('the last three, which are all measurement', () => {
  it('monospacedDigit reaches the painted run, so the font agrees', () => {
    const payload = firstText(run(view('Text("123").monospacedDigit()')))
    expect(payload.runs[0]?.tabularNumbers).toBe(true)
  })

  it('allowsTightening draws the letters closer rather than breaking', () => {
    const line = 'Text("tightening avoids a break").lineLimit(1)'
    const loose = textNodes(run(view(`${line}.frame(width: 190)`)))[0]!
    const tight = textNodes(run(view(`${line}.allowsTightening(true).frame(width: 190)`)))[0]!

    // The loose one has to shorten; the tightened one fits what the loose one cut.
    const textOf = (node: (typeof loose)) => node.text?.lines?.[0]?.text ?? ''
    expect(textOf(loose)).toContain('…')
    expect(textOf(tight).length).toBeGreaterThan(textOf(loose).length)
  })

  it('allowsTightening does nothing to text that already fits', () => {
    const plain = textNodes(run(view('Text("short").lineLimit(1).fixedSize()')))[0]!
    const tight = textNodes(
      run(view('Text("short").lineLimit(1).allowsTightening(true).fixedSize()')),
    )[0]!
    expect(tight.frame.width).toBeCloseTo(plain.frame.width, 3)
  })

  it('lineLimit(2...4) reserves the floor even when the text is shorter', () => {
    // The point of the range form: a list whose rows change height as their text
    // changes is exactly what the lower bound prevents.
    const one = textNodes(run(view('Text("one line").frame(width: 300)')))[0]!
    const floored = textNodes(run(view('Text("one line").lineLimit(2...4).frame(width: 300)')))[0]!
    expect(floored.frame.height).toBeCloseTo(one.frame.height * 2, 1)
  })

  it('lineLimit(2...4) still truncates past its ceiling', () => {
    const long = 'Text("one two three four five six seven eight nine ten eleven twelve")'
    const payload = firstText(run(view(`${long}.lineLimit(2...4).frame(width: 90)`)))
    expect(payload.lines?.length).toBe(4)
    expect(payload.lines?.at(-1)?.text.endsWith('…')).toBe(true)
  })

  it('none of the three warns any more', () => {
    for (const modifier of ['monospacedDigit()', 'allowsTightening(true)', 'lineLimit(2...4)']) {
      expect(warnings(run(view(`Text("a").${modifier}`))), modifier).toEqual([])
    }
  })
})
