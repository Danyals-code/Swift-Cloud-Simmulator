import { describe, expect, it } from 'vitest'
import type { ResolvedFont, Rect, RGBA } from '@studio/shared'
import { LayoutEngine, type PlacedNode } from './engine'
import {
  CENTER,
  uniformInsets,
  type Alignment,
  type LayoutElement,
  type LayoutEnvironment,
  type LayoutModifier,
} from './elements'
import { FontMetricsTable } from './metrics'
import type { ProposedDimension } from './proposal'

/**
 * Golden layout tests.
 *
 * The architecture doc calls these the load-bearing suite, and they are: every
 * layout bug found in the wild becomes a case here *before* it is fixed. They run
 * against the built-in metric estimates rather than browser-measured fonts, which
 * makes them deterministic - assertions are on geometry (this is centred, this fills
 * the row, this sits below that), not on exact glyph widths.
 */

const FONT: ResolvedFont = {
  family: 'Test',
  size: 10,
  weight: 400,
  italic: false,
  lineHeight: 12,
}

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 }

const ENV: LayoutEnvironment = {
  font: FONT,
  foregroundColor: BLACK,
  opacity: 1,
  cornerRadius: 0,
}

const SCREEN: Rect = { x: 0, y: 0, width: 300, height: 200 }

let nextId = 0
function id(): string {
  return `n${nextId++}`
}

// -------------------------------------------------------------- builders

function text(value: string): LayoutElement {
  return { kind: 'text', id: id(), text: value }
}

function spacer(axis: 'vertical' | 'horizontal', minLength = 0): LayoutElement {
  return { kind: 'spacer', id: id(), axis, minLength }
}

function box(): LayoutElement {
  return { kind: 'fill', id: id(), fill: { kind: 'solid', color: BLACK } }
}

function vstack(children: LayoutElement[], spacing = 0, alignment: Alignment = CENTER): LayoutElement {
  return { kind: 'stack', id: id(), axis: 'vertical', spacing, alignment, children }
}

function hstack(children: LayoutElement[], spacing = 0, alignment: Alignment = CENTER): LayoutElement {
  return { kind: 'stack', id: id(), axis: 'horizontal', spacing, alignment, children }
}

function modified(child: LayoutElement, modifier: LayoutModifier): LayoutElement {
  return { kind: 'modified', id: id(), modifier, child }
}

function layout(element: LayoutElement, bounds: Rect = SCREEN): PlacedNode[] {
  return new LayoutEngine(new FontMetricsTable()).layout(element, bounds, ENV)
}

function frames(nodes: PlacedNode[]): Rect[] {
  return nodes.map((n) => round(n.frame))
}

function round(rect: Rect): Rect {
  return {
    x: Math.round(rect.x * 100) / 100,
    y: Math.round(rect.y * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
  }
}

function sizeOf(element: LayoutElement, width: ProposedDimension, height: ProposedDimension) {
  const engine = new LayoutEngine(new FontMetricsTable())
  return engine.measureElement(element, { width, height }, ENV)
}

// ===========================================================================

describe('leaf sizing', () => {
  it('sizes text to its content, one line high', () => {
    const size = sizeOf(text('hello'), null, null)
    expect(size.height).toBe(FONT.lineHeight)
    expect(size.width).toBeGreaterThan(0)
    expect(size.width).toBeLessThan(60)
  })

  it('wraps text at the proposed width and grows taller', () => {
    const long = text('the quick brown fox jumps over the lazy dog')
    const wide = sizeOf(long, 1000, null)
    const narrow = sizeOf(long, 60, null)

    expect(wide.height).toBe(FONT.lineHeight)
    expect(narrow.height).toBeGreaterThan(FONT.lineHeight)
    expect(narrow.width).toBeLessThanOrEqual(60)
  })

  it('makes a colour greedy in both axes', () => {
    expect(sizeOf(box(), 120, 80)).toEqual({ width: 120, height: 80 })
  })

  it('makes a vertical spacer greedy down and zero across', () => {
    expect(sizeOf(spacer('vertical'), 100, 50)).toEqual({ width: 0, height: 50 })
  })

  it('makes a horizontal spacer greedy across and zero down', () => {
    expect(sizeOf(spacer('horizontal'), 100, 50)).toEqual({ width: 100, height: 0 })
  })

  it('respects a spacer minimum length', () => {
    expect(sizeOf(spacer('vertical', 20), 100, 0).height).toBe(20)
  })
})

describe('stacks', () => {
  it('stacks children vertically in source order', () => {
    const placed = layout(vstack([text('a'), text('b')]))
    const [first, second] = frames(placed)
    expect(first!.y).toBe(0)
    expect(second!.y).toBe(FONT.lineHeight)
  })

  it('inserts spacing between children but not around them', () => {
    const placed = layout(vstack([text('a'), text('b'), text('c')], 10))
    const ys = frames(placed).map((f) => f.y)
    expect(ys).toEqual([0, FONT.lineHeight + 10, (FONT.lineHeight + 10) * 2])
  })

  it('sums heights and takes the widest child', () => {
    const size = sizeOf(vstack([text('a'), text('wide text here')], 4), 300, null)
    expect(size.height).toBe(FONT.lineHeight * 2 + 4)
  })

  it('aligns narrower children by the stack alignment', () => {
    const leading = layout(
      vstack([text('a')], 0, { horizontal: 'leading', vertical: 'top' }),
      { x: 0, y: 0, width: 300, height: 200 },
    )
    // The stack hugs its content, so alignment inside it is a no-op - the meaningful
    // case is a child narrower than a stack forced wide, below.
    expect(frames(leading)[0]!.x).toBe(0)
  })

  it('centres a narrow child inside a widened stack', () => {
    const stack = modified(vstack([text('a')], 0, CENTER), {
      kind: 'frame',
      maxWidth: Number.POSITIVE_INFINITY,
      alignment: CENTER,
    })
    const placed = layout(stack)
    const frame = frames(placed)[0]!
    expect(frame.x).toBeGreaterThan(100)
    expect(frame.x + frame.width / 2).toBeCloseTo(150, 0)
  })
})

describe('Spacer - the case that exposes a wrong engine', () => {
  it('pushes two texts to opposite ends of an HStack', () => {
    // Phase 3 gate 2. If children were measured in source order rather than by
    // flexibility, the Spacer would swallow the row and the second Text would be
    // squeezed to nothing.
    const row = modified(hstack([text('a'), spacer('horizontal'), text('b')]), {
      kind: 'frame',
      maxWidth: Number.POSITIVE_INFINITY,
      alignment: CENTER,
    })
    const placed = layout(row, { x: 0, y: 0, width: 300, height: 50 })
    const [left, right] = frames(placed)

    expect(left!.x).toBe(0)
    expect(left!.width).toBeGreaterThan(0)
    expect(right!.width).toBeGreaterThan(0)
    // The right text ends flush with the row's trailing edge.
    expect(right!.x + right!.width).toBeCloseTo(300, 1)
  })

  it('gives each text its natural width, not an equal share', () => {
    const row = modified(hstack([text('a'), spacer('horizontal'), text('bbbbbbbbbb')]), {
      kind: 'frame',
      maxWidth: Number.POSITIVE_INFINITY,
      alignment: CENTER,
    })
    const [left, right] = frames(layout(row, { x: 0, y: 0, width: 300, height: 50 }))
    expect(right!.width).toBeGreaterThan(left!.width * 3)
  })

  it('splits remaining space between two spacers', () => {
    const row = modified(
      hstack([spacer('horizontal'), text('mid'), spacer('horizontal')]),
      { kind: 'frame', maxWidth: Number.POSITIVE_INFINITY, alignment: CENTER },
    )
    const [middle] = frames(layout(row, { x: 0, y: 0, width: 300, height: 50 }))
    // Equal spacers centre the content.
    expect(middle!.x + middle!.width / 2).toBeCloseTo(150, 0)
  })

  it('pushes content to the bottom of a VStack', () => {
    const column = modified(vstack([spacer('vertical'), text('bottom')]), {
      kind: 'frame',
      maxHeight: Number.POSITIVE_INFINITY,
      alignment: CENTER,
    })
    const [content] = frames(layout(column, { x: 0, y: 0, width: 300, height: 200 }))
    expect(content!.y + content!.height).toBeCloseTo(200, 1)
  })
})

describe('frame', () => {
  it('takes a fixed size and centres its child', () => {
    const element = modified(text('a'), { kind: 'frame', width: 100, height: 40, alignment: CENTER })
    expect(sizeOf(element, 300, 200)).toEqual({ width: 100, height: 40 })

    const [child] = frames(layout(element))
    expect(child!.y).toBeCloseTo((40 - FONT.lineHeight) / 2, 1)
  })

  it('fills the proposal with maxWidth infinity', () => {
    const element = modified(text('a'), {
      kind: 'frame',
      maxWidth: Number.POSITIVE_INFINITY,
      alignment: CENTER,
    })
    expect(sizeOf(element, 300, 200).width).toBe(300)
  })

  it('clamps to a finite maxWidth', () => {
    const element = modified(box(), { kind: 'frame', maxWidth: 120, alignment: CENTER })
    expect(sizeOf(element, 300, 50).width).toBe(120)
  })

  it('does not stretch past the proposal when maxWidth exceeds it', () => {
    const element = modified(text('a'), { kind: 'frame', maxWidth: 500, alignment: CENTER })
    expect(sizeOf(element, 200, 50).width).toBe(200)
  })

  it('honours minWidth on a small child', () => {
    const element = modified(text('a'), { kind: 'frame', minWidth: 80, alignment: CENTER })
    expect(sizeOf(element, 300, 50).width).toBe(80)
  })

  it('aligns a child to leading when asked', () => {
    const element = modified(text('a'), {
      kind: 'frame',
      width: 100,
      height: 40,
      alignment: { horizontal: 'leading', vertical: 'top' },
    })
    const [child] = frames(layout(element))
    expect(child!.x).toBe(0)
    expect(child!.y).toBe(0)
  })
})

describe('padding', () => {
  it('grows the element by its insets', () => {
    const inner = sizeOf(text('hello'), null, null)
    const padded = sizeOf(modified(text('hello'), { kind: 'padding', insets: uniformInsets(8) }), null, null)

    expect(padded.width).toBeCloseTo(inner.width + 16, 5)
    expect(padded.height).toBeCloseTo(inner.height + 16, 5)
  })

  it('insets the child when placing', () => {
    const element = modified(text('a'), { kind: 'padding', insets: uniformInsets(8) })
    const [child] = frames(layout(element))
    expect(child!.x).toBe(8)
    expect(child!.y).toBe(8)
  })

  it('shrinks the proposal passed to the child', () => {
    const element = modified(box(), { kind: 'padding', insets: uniformInsets(10) })
    const [child] = frames(layout(element, { x: 0, y: 0, width: 100, height: 100 }))
    expect(child!.width).toBe(80)
    expect(child!.height).toBe(80)
  })
})

describe('modifier order (Phase 3 gate 3)', () => {
  /**
   * `.padding().background()` and `.background().padding()` must differ. This is the
   * single clearest test that modifiers nest rather than merge - a flat modifier list
   * cannot represent the difference at all.
   */
  const content = () => text('hi')

  it('padding then background covers the padded area', () => {
    const element = modified(
      modified(content(), { kind: 'padding', insets: uniformInsets(10) }),
      { kind: 'background', content: box() },
    )
    const placed = layout(element)
    const background = placed.find((n) => n.paint.kind === 'fill')!
    const label = placed.find((n) => n.paint.kind === 'text')!

    // Background is the outer frame; the text sits inset by the padding.
    expect(background.frame.width).toBeCloseTo(label.frame.width + 20, 5)
    expect(background.frame.x).toBeCloseTo(label.frame.x - 10, 5)
  })

  it('background then padding covers only the content', () => {
    const element = modified(
      modified(content(), { kind: 'background', content: box() }),
      { kind: 'padding', insets: uniformInsets(10) },
    )
    const placed = layout(element)
    const background = placed.find((n) => n.paint.kind === 'fill')!
    const label = placed.find((n) => n.paint.kind === 'text')!

    // Background exactly matches the text's frame.
    expect(background.frame).toEqual(label.frame)
  })

  it('paints the background beneath its content', () => {
    const element = modified(content(), { kind: 'background', content: box() })
    const placed = layout(element)
    const background = placed.find((n) => n.paint.kind === 'fill')!
    const label = placed.find((n) => n.paint.kind === 'text')!
    expect(background.z).toBeLessThan(label.z)
  })

  it('leaves the size unchanged by a background', () => {
    const plain = sizeOf(content(), null, null)
    const backed = sizeOf(modified(content(), { kind: 'background', content: box() }), null, null)
    expect(backed).toEqual(plain)
  })
})

describe('inherited environment', () => {
  it('makes text measured with the font set above it', () => {
    const big: ResolvedFont = { ...FONT, size: 30, lineHeight: 36 }
    const small = sizeOf(text('hello'), null, null)
    const large = sizeOf(modified(text('hello'), { kind: 'font', font: big }), null, null)

    expect(large.width).toBeGreaterThan(small.width * 2.5)
    expect(large.height).toBe(36)
  })

  it('applies a font set on an enclosing stack', () => {
    const big: ResolvedFont = { ...FONT, size: 30, lineHeight: 36 }
    const plain = sizeOf(vstack([text('hello')]), null, null)
    const styled = sizeOf(modified(vstack([text('hello')]), { kind: 'font', font: big }), null, null)
    expect(styled.height).toBeGreaterThan(plain.height)
  })

  it('carries foreground colour down to text', () => {
    const red: RGBA = { r: 255, g: 0, b: 0, a: 1 }
    const placed = layout(modified(text('a'), { kind: 'foregroundStyle', color: red }))
    const label = placed.find((n) => n.paint.kind === 'text')!
    expect(label.paint.kind === 'text' && label.paint.color).toEqual(red)
  })

  it('multiplies nested opacity', () => {
    const element = modified(modified(text('a'), { kind: 'opacity', value: 0.5 }), {
      kind: 'opacity',
      value: 0.5,
    })
    expect(layout(element)[0]!.opacity).toBeCloseTo(0.25, 5)
  })
})

describe('the reference app layout', () => {
  /**
   * The structure of the vertical-slice counter, built directly rather than through
   * the interpreter, so a failure here is unambiguously the engine's.
   */
  function counter(): LayoutElement {
    const title = modified(text('Hello, World!'), {
      kind: 'font',
      font: { ...FONT, size: 20, lineHeight: 24 },
    })
    const count = text('Count: 0')

    const button = (label: string) =>
      modified(modified(text(label), { kind: 'padding', insets: uniformInsets(8) }), {
        kind: 'background',
        content: box(),
      })

    const row = modified(
      modified(hstack([button('Minus'), spacer('horizontal'), button('Plus')], 12), {
        kind: 'frame',
        maxWidth: Number.POSITIVE_INFINITY,
        alignment: CENTER,
      }),
      { kind: 'padding', insets: { top: 0, leading: 24, bottom: 0, trailing: 24 } },
    )

    return modified(vstack([title, count, row], 16), { kind: 'padding', insets: uniformInsets(16) })
  }

  it('stacks the three rows in order with correct spacing', () => {
    const placed = layout(counter(), { x: 0, y: 0, width: 393, height: 500 })
    const texts = placed.filter((n) => n.paint.kind === 'text')

    const title = texts.find((n) => n.paint.kind === 'text' && n.paint.text.startsWith('Hello'))!
    const count = texts.find((n) => n.paint.kind === 'text' && n.paint.text.startsWith('Count'))!

    expect(title.frame.y).toBe(16)
    expect(count.frame.y).toBeCloseTo(16 + 24 + 16, 1)
  })

  it('pushes the two buttons to opposite ends of the row', () => {
    const placed = layout(counter(), { x: 0, y: 0, width: 393, height: 500 })
    const backgrounds = placed
      .filter((n) => n.paint.kind === 'fill')
      .sort((a, b) => a.frame.x - b.frame.x)

    expect(backgrounds).toHaveLength(2)
    const [minus, plus] = backgrounds
    // Padding of 16 outside plus 24 inside leaves the row spanning 40..353.
    expect(minus!.frame.x).toBeCloseTo(40, 1)
    expect(plus!.frame.x + plus!.frame.width).toBeCloseTo(353, 1)
  })

  it('makes each button background wrap its label plus padding', () => {
    const placed = layout(counter(), { x: 0, y: 0, width: 393, height: 500 })
    const background = placed.filter((n) => n.paint.kind === 'fill')[0]!
    const label = placed.find((n) => n.paint.kind === 'text' && n.paint.text === 'Minus')!

    expect(background.frame.width).toBeCloseTo(label.frame.width + 16, 1)
    expect(background.frame.height).toBeCloseTo(label.frame.height + 16, 1)
  })
})

describe('robustness', () => {
  it('produces finite frames for deeply nested stacks', () => {
    let element: LayoutElement = text('deep')
    for (let i = 0; i < 40; i++) element = vstack([element], 2)

    for (const node of layout(element)) {
      expect(Number.isFinite(node.frame.x)).toBe(true)
      expect(Number.isFinite(node.frame.y)).toBe(true)
      expect(Number.isFinite(node.frame.width)).toBe(true)
      expect(Number.isFinite(node.frame.height)).toBe(true)
    }
  })

  it('never produces NaN when a greedy child meets an unbounded proposal', () => {
    // `Infinity` in the share arithmetic would yield NaN, and one NaN silently
    // poisons every frame downstream.
    const element = vstack([spacer('vertical'), spacer('vertical')])
    const size = sizeOf(element, null, 'infinity')
    expect(Number.isNaN(size.height)).toBe(false)
    expect(Number.isFinite(size.height)).toBe(true)
  })

  it('handles an empty stack', () => {
    expect(sizeOf(vstack([]), 100, 100)).toEqual({ width: 0, height: 0 })
    expect(layout(vstack([]))).toEqual([])
  })

  it('handles zero-size bounds', () => {
    expect(() => layout(vstack([text('a')]), { x: 0, y: 0, width: 0, height: 0 })).not.toThrow()
  })
})

describe('root placement', () => {
  it('centres a root view that does not fill the screen', () => {
    // SwiftUI centres root content in its window: a VStack hugging its content sits
    // in the middle of the screen, not pinned to the top-left.
    const content = vstack([text('a')], 0)
    const [placed] = frames(
      new LayoutEngine(new FontMetricsTable()).layout(
        content,
        { x: 0, y: 0, width: 300, height: 200 },
        ENV,
        CENTER,
      ),
    )

    expect(placed!.y + placed!.height / 2).toBeCloseTo(100, 0)
    expect(placed!.x + placed!.width / 2).toBeCloseTo(150, 0)
  })

  it('leaves a filling root alone', () => {
    const filling = modified(box(), {
      kind: 'frame',
      maxWidth: Number.POSITIVE_INFINITY,
      maxHeight: Number.POSITIVE_INFINITY,
      alignment: CENTER,
    })
    const [placed] = frames(
      new LayoutEngine(new FontMetricsTable()).layout(
        filling,
        { x: 0, y: 0, width: 300, height: 200 },
        ENV,
        CENTER,
      ),
    )
    expect(placed).toEqual({ x: 0, y: 0, width: 300, height: 200 })
  })

  it('offsets by the safe area origin', () => {
    const content = vstack([text('a')], 0)
    const [placed] = frames(layout(content, { x: 0, y: 59, width: 393, height: 759 }))
    expect(placed!.y).toBe(59)
  })
})
