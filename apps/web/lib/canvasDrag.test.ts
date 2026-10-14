import { describe, expect, it } from 'vitest'
import type { Alignment9, AuthoringModifier, DesignControl, Insets, LayerLayout, LayerProperties, LayerValue, ModifierBox, Rect, ViewInstance } from '@studio/shared'
import { arrowFor, changeFor, dragged, dragStartFor, ghostFor, handleLayout, hugFor, moveBlocked, type DragStart } from './canvasDrag'

/**
 * What a drag on the canvas's handles writes (Wave 2b): the live draft the worker lays out
 * while the pointer moves, and the one `layer-set` change, or the stack's spacing, that
 * letting go writes. Each layout below is a worked example: a view drawn at known points.
 */

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height })
const absent = <T,>(value: T): LayerValue<T> => ({ value, state: 'absent' })
const literal = <T,>(value: T, from: readonly string[]): LayerValue<T> => ({ value, state: 'literal', from })

/** A layer that reads as nothing set: Hug both ways, no padding, no offset, in a Column. */
function layer(layout: Partial<LayerLayout> = {}, rest: Partial<LayerProperties> = {}): LayerProperties {
  return {
    layout: {
      width: absent({ mode: 'hug' }), height: absent({ mode: 'hug' }), alignment: absent(null),
      padding: absent(null), margin: absent(null), offset: absent(null), pin: absent(null),
      context: { parent: 'column', inButton: false, surface: false },
      ...layout,
    },
    effects: { opacity: absent(1), blur: absent(null) },
    claimed: {},
    ...rest,
  }
}

/** One drawn copy: the view at `content`, its boxes inside out, its anchor the outermost box. */
function drawn(content: Rect, boxes: readonly ModifierBox[] = [], extra: Partial<ViewInstance> = {}): ViewInstance {
  const outer = boxes.at(-1)?.rect ?? content
  return { anchor: 'v-0', anchorFrame: outer, content, boxes, ...extra }
}

const even = (points: number): Insets => ({ top: points, leading: points, bottom: points, trailing: points })
const start = (instance: ViewInstance, properties: LayerProperties, chain: readonly string[] = []): DragStart => ({ instance, layer: properties, chain })

describe('resizing by an edge or a corner', () => {
  // Text("Hello") drawn 52.4 by 20.3 points, hugging.
  const text = start(drawn(rect(100, 200, 52.4, 20.3)), layer())

  it('gives a Fixed width from the trailing edge, rounded to whole points', () => {
    const change = changeFor({ kind: 'resize', edge: 'trailing' }, text, { x: 20.2, y: 7 })
    expect(change?.draft).toEqual({ width: 73 })
    expect(change?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', width: { mode: 'fixed', size: 73 } }] })
  })

  it('grows from the leading and top edges as the pointer moves away from the view', () => {
    expect(changeFor({ kind: 'resize', edge: 'leading' }, text, { x: -10, y: 0 })?.draft).toEqual({ width: 62 })
    expect(changeFor({ kind: 'resize', edge: 'top' }, text, { x: 4, y: -9.6 })?.draft).toEqual({ height: 30 })
    expect(changeFor({ kind: 'resize', edge: 'bottom' }, text, { x: 0, y: 4.2 })?.draft).toEqual({ height: 25 })
  })

  it('gives both a Fixed width and height from a corner, as one change', () => {
    const change = changeFor({ kind: 'resize', edge: 'bottomTrailing' }, text, { x: 7.6, y: 9.7 })
    expect(change?.draft).toEqual({ width: 60, height: 30 })
    expect(change?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', width: { mode: 'fixed', size: 60 }, height: { mode: 'fixed', size: 30 } }] })
    expect(changeFor({ kind: 'resize', edge: 'topLeading' }, text, { x: 12.4, y: 0.3 })?.draft).toEqual({ width: 40, height: 20 })
  })

  it('never goes below nothing', () => {
    expect(changeFor({ kind: 'resize', edge: 'trailing' }, text, { x: -80, y: 0 })?.draft).toEqual({ width: 0 })
  })

  it('keeps the proportions with Shift, following the axis that moved most', () => {
    // 100 by 50: a corner dragged 20 across and 4 down is 120 by 60.
    const card = start(drawn(rect(0, 0, 100, 50)), layer())
    expect(changeFor({ kind: 'resize', edge: 'bottomTrailing' }, card, { x: 20, y: 4 }, { shift: true })?.draft).toEqual({ width: 120, height: 60 })
    expect(changeFor({ kind: 'resize', edge: 'bottomTrailing' }, card, { x: 2, y: 25 }, { shift: true })?.draft).toEqual({ width: 150, height: 75 })
    // An edge with Shift brings the other axis along.
    expect(changeFor({ kind: 'resize', edge: 'trailing' }, card, { x: -40, y: 0 }, { shift: true })?.draft).toEqual({ width: 60, height: 30 })
  })

  it('sits on the fill, with its padding and size inside it and its margin and offset outside', () => {
    // Text("Card").padding(12).background(.blue).padding(20).offset(x: 5): the text 50 by 20.
    const card = start(drawn(rect(105, 100, 50, 20), [
      { index: 0, kind: 'padding', rect: rect(93, 88, 74, 44) },
      { index: 2, kind: 'padding', rect: rect(73, 68, 114, 84) },
      { index: 3, kind: 'offset', rect: rect(68, 68, 114, 84) },
    ]), layer({
      padding: literal(even(12), ['p']), margin: literal(even(20), ['m']), offset: literal({ x: 5, y: 0 }, ['o']),
      context: { parent: 'column', inButton: false, surface: true },
    }, { claimed: { p: 'layout', b: 'fill', m: 'layout', o: 'layout' } }), ['p', 'b', 'm', 'o'])
    expect(handleLayout(card).bounds).toEqual(rect(93, 88, 74, 44))
    expect(changeFor({ kind: 'resize', edge: 'trailing' }, card, { x: 6, y: 0 })?.draft).toEqual({ width: 80 })
  })

  it('sits on a frame that fills the room, where there is no fill', () => {
    // Text("Wide").frame(maxWidth: .infinity) in a 402 point column.
    const wide = start(drawn(rect(180, 100, 42, 20), [{ index: 0, kind: 'frame', rect: rect(0, 100, 402, 20) }]),
      layer({ width: literal({ mode: 'fill' }, ['f']) }, { claimed: { f: 'layout' } }), ['f'])
    expect(handleLayout(wide).bounds).toEqual(rect(0, 100, 402, 20))
    expect(changeFor({ kind: 'resize', edge: 'trailing' }, wide, { x: -102, y: 0 })?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', width: { mode: 'fixed', size: 300 } }] })
  })

  describe('in an Overlap', () => {
    const overlap = { parent: 'overlap' as const, inButton: false, surface: false }

    it('writes only the size, as the Width and Height fields do, so a centred view grows on both sides', () => {
      // A 100 by 50 view the Overlap centres, already moved 60 points to the right.
      const moved = start(drawn(rect(160, 125, 100, 50), [{ index: 0, kind: 'offset', rect: rect(160, 125, 100, 50) }], { parent: { kind: 'overlap', rect: rect(0, 0, 300, 300) } }),
        layer({ context: overlap, offset: literal({ x: 60, y: 0 }, ['o']) }), ['o'])
      const change = changeFor({ kind: 'resize', edge: 'leading' }, moved, { x: -20, y: 0 })
      expect(change?.draft).toEqual({ width: 120 })
      expect(change?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', width: { mode: 'fixed', size: 120 } }] })
      expect(changeFor({ kind: 'resize', edge: 'topTrailing' }, moved, { x: 10, y: -10 })?.draft).toEqual({ width: 110, height: 60 })
    })
  })

  it('leaves an axis the panel can’t change here, and offers no handle for it', () => {
    const computed = start(drawn(rect(0, 0, 100, 50)), layer({ width: { value: { mode: 'fixed', size: 100 }, state: 'code', from: ['f'], disabledReason: 'This view’s size is worked out in Swift. Change it in Code.' } }), ['f'])
    expect(handleLayout(computed).resize).toEqual({ width: false, height: true })
    expect(changeFor({ kind: 'resize', edge: 'bottomTrailing' }, computed, { x: 10, y: 10 }, { shift: true })?.draft).toEqual({ height: 60 })
    expect(changeFor({ kind: 'resize', edge: 'trailing' }, computed, { x: 10, y: 0 })).toBeNull()
    expect(hugFor('trailing', computed)).toBeNull()
  })

  it('follows a draft: a frame or margin drawn before it is written, by where it will be written', () => {
    // Text("Card").padding(12).background(.blue), drafted at 120 by 60 with a 10 point margin.
    const drafted = start(drawn(rect(105, 100, 50, 20), [
      { index: 0, kind: 'padding', rect: rect(93, 88, 74, 44) },
      { index: 1, kind: 'frame', rect: rect(70, 80, 120, 60), draft: true },
      { index: 2, kind: 'padding', rect: rect(60, 70, 140, 80), draft: true },
    ]), layer({ padding: literal(even(12), ['p']), context: { parent: 'column', inButton: false, surface: true } }, { claimed: { p: 'layout', b: 'fill' } }), ['p', 'b'])
    expect(handleLayout(drafted).bounds).toEqual(rect(70, 80, 120, 60))
  })

  it('sits on a Button’s label, where its padding and size are written', () => {
    // Button { Text("Save").padding(8).frame(width: 120) }.buttonStyle(.bordered), its label's boxes counted in the label's chain.
    const button = start(drawn(rect(40, 10, 40, 20), [
      { index: 0, kind: 'padding', rect: rect(32, 2, 56, 36), label: true },
      { index: 1, kind: 'frame', rect: rect(0, 2, 120, 36), label: true },
    ], { label: rect(40, 10, 40, 20) }), layer({ context: { parent: 'column', inButton: true, surface: false } }), ['style'])
    expect(handleLayout(button).bounds).toEqual(rect(0, 2, 120, 36))
  })

  it('writes nothing when the drag ends at the size it started from', () => {
    const card = start(drawn(rect(0, 0, 100, 50)), layer({ width: literal({ mode: 'fixed', size: 100 }, ['m0']) }), ['m0'])
    expect(changeFor({ kind: 'resize', edge: 'trailing' }, card, { x: 0.3, y: 0 })).toBeNull()
  })
})

describe('double-clicking a handle', () => {
  const fixed = start(drawn(rect(0, 0, 120, 40), [{ index: 0, kind: 'frame', rect: rect(0, 0, 120, 40) }]),
    layer({ width: literal({ mode: 'fixed', size: 120 }, ['f']), height: literal({ mode: 'fixed', size: 40 }, ['f']) }), ['f'])

  it('sets that axis back to Hug', () => {
    expect(hugFor('trailing', fixed)).toEqual({ kind: 'layer', changes: [{ section: 'layout', width: { mode: 'hug' } }] })
    expect(hugFor('top', fixed)).toEqual({ kind: 'layer', changes: [{ section: 'layout', height: { mode: 'hug' } }] })
  })

  it('sets both axes from a corner, leaving one that already hugs', () => {
    expect(hugFor('bottomLeading', fixed)).toEqual({ kind: 'layer', changes: [{ section: 'layout', width: { mode: 'hug' }, height: { mode: 'hug' } }] })
    const wide = start(fixed.instance, layer({ width: literal({ mode: 'fixed', size: 120 }, ['f']) }), ['f'])
    expect(hugFor('topTrailing', wide)).toEqual({ kind: 'layer', changes: [{ section: 'layout', width: { mode: 'hug' } }] })
    expect(hugFor('top', wide)).toBeNull()
  })

  it('keeps a Fill’s minimum, and its maximum only where a fill can hug up to it, as the Layout section does', () => {
    const fill = { mode: 'fill' as const, min: 80, max: 300 }
    expect(hugFor('leading', start(fixed.instance, layer({ width: literal(fill, ['f']) }), ['f']))).toEqual({ kind: 'layer', changes: [{ section: 'layout', width: { mode: 'hug', min: 80 } }] })
    expect(hugFor('leading', start(fixed.instance, layer({ width: literal(fill, ['f']), context: { parent: 'column', inButton: false, surface: true } }), ['f'])))
      .toEqual({ kind: 'layer', changes: [{ section: 'layout', width: { mode: 'hug', min: 80, max: 300 } }] })
  })
})

describe('dragging a padding band', () => {
  // Text("Pad").padding(.horizontal, 16).padding(.vertical, 8): the text 40 by 20.
  const boxes: readonly ModifierBox[] = [
    { index: 0, kind: 'padding', rect: rect(100, 108, 72, 20) },
    { index: 1, kind: 'padding', rect: rect(100, 100, 72, 36) },
  ]
  const padded = (padding: LayerValue<Insets | null>) => start(drawn(rect(116, 108, 40, 20), boxes), layer({ padding }), ['h', 'v'])
  const pad = padded(literal({ top: 8, leading: 16, bottom: 8, trailing: 16 }, ['h', 'v']))
  const insets = (top: number, leading: number, bottom: number, trailing: number) => ({ top, leading, bottom, trailing })

  it('shows each side’s band between the content and the padding’s edge', () => {
    expect(handleLayout(pad).padding).toEqual({ top: rect(100, 100, 72, 8), bottom: rect(100, 128, 72, 8), leading: rect(100, 108, 16, 20), trailing: rect(156, 108, 16, 20) })
  })

  it('gives that side more padding as the band is dragged in, in whole points', () => {
    const change = changeFor({ kind: 'padding', side: 'top' }, pad, { x: 3, y: 4.4 })
    expect(change?.draft).toEqual({ padding: insets(12, 16, 8, 16) })
    expect(change?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', padding: insets(12, 16, 8, 16) }] })
    expect(changeFor({ kind: 'padding', side: 'trailing' }, pad, { x: 6, y: 0 })?.draft).toEqual({ padding: insets(8, 16, 8, 10) })
    expect(changeFor({ kind: 'padding', side: 'bottom' }, pad, { x: 0, y: -3 })?.draft).toEqual({ padding: insets(8, 16, 11, 16) })
  })

  it('changes the opposite side too with Alt, and all four with Shift', () => {
    expect(changeFor({ kind: 'padding', side: 'top' }, pad, { x: 0, y: 4 }, { alt: true })?.draft).toEqual({ padding: insets(12, 16, 12, 16) })
    expect(changeFor({ kind: 'padding', side: 'leading' }, pad, { x: 4, y: 0 }, { shift: true })?.draft).toEqual({ padding: insets(20, 20, 20, 20) })
  })

  it('never goes below nothing', () => {
    expect(changeFor({ kind: 'padding', side: 'top' }, pad, { x: 0, y: -20 })?.draft).toEqual({ padding: insets(0, 16, 8, 16) })
  })

  it('turns a token into a number only on the sides that are dragged', () => {
    const space = { token: '.space16' }, tight = { token: '.space8' }
    const tokens = padded({ value: { top: tight, leading: space, bottom: tight, trailing: space }, state: 'token', from: ['h', 'v'] })
    const change = changeFor({ kind: 'padding', side: 'leading' }, tokens, { x: 4, y: 0 })
    expect(change?.draft).toEqual({ padding: insets(8, 20, 8, 16) })
    expect(change?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', padding: { top: tight, leading: 20, bottom: tight, trailing: space } }] })
  })

  it('adds padding to a view with none, from grips at its content’s edges', () => {
    const bare = start(drawn(rect(116, 108, 40, 20)), layer())
    expect(handleLayout(bare).padding).toEqual({ top: rect(116, 108, 40, 0), bottom: rect(116, 128, 40, 0), leading: rect(116, 108, 0, 20), trailing: rect(156, 108, 0, 20) })
    const change = changeFor({ kind: 'padding', side: 'leading' }, bare, { x: 6.4, y: 0 })
    expect(change?.draft).toEqual({ padding: insets(0, 6, 0, 0) })
    expect(change?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', padding: insets(0, 6, 0, 0) }] })
  })

  it('gives a padding on two sides grips on the other two, at nothing', () => {
    // Text("Pad").padding(.horizontal, 16): its top and bottom bands are as thin as can be.
    const sides = start(drawn(rect(116, 108, 40, 20), [{ index: 0, kind: 'padding', rect: rect(100, 108, 72, 20) }]), layer({ padding: literal({ top: 0, leading: 16, bottom: 0, trailing: 16 }, ['h']) }), ['h'])
    expect(handleLayout(sides).padding?.top).toEqual(rect(100, 108, 72, 0))
    expect(changeFor({ kind: 'padding', side: 'top' }, sides, { x: 0, y: 4 })?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', padding: insets(4, 16, 0, 16) }] })
  })

  it('offers no band where the view can’t take padding', () => {
    const shape = start(drawn(rect(0, 0, 40, 40)), layer({ padding: { value: null, state: 'absent', disabledReason: 'A shape is sized by its frame. Give it a size instead.' } }))
    expect(handleLayout(shape).padding).toBeUndefined()
    expect(changeFor({ kind: 'padding', side: 'top' }, shape, { x: 0, y: 4 })).toBeNull()
  })

  it('offers no band for a padding left to Code, and writes nothing where the value stays', () => {
    const code = padded({ value: { top: 8, leading: 16, bottom: 8, trailing: 16 }, state: 'code', from: ['h', 'v'], disabledReason: 'Change it in Code.' })
    expect(handleLayout(code).padding).toBeUndefined()
    expect(changeFor({ kind: 'padding', side: 'top' }, code, { x: 0, y: 4 })).toBeNull()
    expect(changeFor({ kind: 'padding', side: 'top' }, pad, { x: 0, y: 0.4 })).toBeNull()
  })
})

describe('dragging the gap between a stack’s views', () => {
  // VStack(spacing: 8) of three 20 point rows, 100 points wide.
  const column = { ...start(drawn(rect(150, 100, 100, 76), [], { children: [rect(150, 100, 100, 20), rect(150, 128, 100, 20), rect(150, 156, 100, 20)] }), layer()), stack: 'vertical' as const }
  // HStack(spacing: 12) of two 30 point squares.
  const row = { ...start(drawn(rect(0, 0, 72, 30), [], { children: [rect(0, 0, 30, 30), rect(42, 0, 30, 30)] }), layer()), stack: 'horizontal' as const }

  it('shows a bar in each gap, across the stack', () => {
    expect(handleLayout(column).gaps).toEqual([rect(150, 120, 100, 8), rect(150, 148, 100, 8)])
    expect(handleLayout(row).gaps).toEqual([rect(30, 0, 12, 30)])
  })

  it('sets the stack’s spacing along its axis, in whole points', () => {
    const change = changeFor({ kind: 'spacing', gap: 1 }, column, { x: 30, y: 4.4 })
    expect(change).toEqual({ draft: { spacing: 12 }, commit: { kind: 'spacing', value: 12 } })
    expect(changeFor({ kind: 'spacing', gap: 0 }, row, { x: -5, y: 9 })).toEqual({ draft: { spacing: 7 }, commit: { kind: 'spacing', value: 7 } })
  })

  it('never goes below nothing, and writes nothing where the gap stays', () => {
    expect(changeFor({ kind: 'spacing', gap: 0 }, column, { x: 0, y: -30 })?.commit).toEqual({ kind: 'spacing', value: 0 })
    expect(changeFor({ kind: 'spacing', gap: 0 }, column, { x: 0, y: 0.2 })).toBeNull()
  })

  it('has no bars where the spacing cannot be dragged', () => {
    const fixed = start(column.instance, layer())
    expect(handleLayout(fixed).gaps).toBeUndefined()
    expect(changeFor({ kind: 'spacing', gap: 0 }, fixed, { x: 0, y: 4 })).toBeNull()
  })
})

describe('dragging a view’s body inside an Overlap', () => {
  const overlap = { parent: 'overlap' as const, inButton: false, surface: false }
  const square = { kind: 'overlap' as const, rect: rect(0, 0, 300, 300) }

  it('writes an offset, in whole points', () => {
    const plain = start(drawn(rect(100, 125, 100, 50), [], { parent: square }), layer({ context: overlap }))
    expect(handleLayout(plain).move).toBe(true)
    const change = changeFor({ kind: 'move' }, plain, { x: 12.4, y: -7.6 })
    expect(change?.draft).toEqual({ offset: { x: 12, y: -8 } })
    expect(change?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', offset: { x: 12, y: -8 } }] })
  })

  it('adds to the offset it has', () => {
    const moved = start(drawn(rect(105, 128, 100, 50), [{ index: 0, kind: 'offset', rect: rect(105, 128, 100, 50) }], { parent: square }),
      layer({ context: overlap, offset: literal({ x: 5, y: 3 }, ['o']) }), ['o'])
    const change = changeFor({ kind: 'move' }, moved, { x: 0.2, y: 6 })
    expect(change?.draft).toEqual({ offset: { x: 5, y: 9 } })
    expect(change?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', offset: { x: 5, y: 9 } }] })
    expect(changeFor({ kind: 'move' }, moved, { x: 0.3, y: -0.4 })).toBeNull()
  })

  it('leaves an offset written with a token, whose points it can’t read, to the Layout section', () => {
    const token = start(drawn(rect(105, 128, 100, 50), [{ index: 0, kind: 'offset', rect: rect(105, 128, 100, 50) }], { parent: square }),
      layer({ context: overlap, offset: { value: { x: { token: 'Layout.nudge' }, y: 3 }, state: 'token', from: ['o'] } }), ['o'])
    expect(handleLayout(token).move).toBe(false)
    expect(changeFor({ kind: 'move' }, token, { x: 4, y: 6 })).toBeNull()
  })

  it('says why an offset written with a token can’t be dragged or nudged here', () => {
    const token = start(drawn(rect(105, 128, 100, 50), [{ index: 0, kind: 'offset', rect: rect(105, 128, 100, 50) }], { parent: square }),
      layer({ context: overlap, offset: { value: { x: { token: 'Layout.nudge' }, y: 3 }, state: 'token', from: ['o'] } }), ['o'])
    expect(moveBlocked(token)).toBe('This view’s offset is a token. Change it in the Layout section or in Code.')
    const code = start(drawn(rect(100, 125, 100, 50), [], { parent: square }), layer({ context: overlap, offset: { value: null, state: 'code', disabledReason: 'This view’s offset is worked out in Swift. Change it in Code.' } }))
    expect(moveBlocked(code)).toBe('This view’s offset is worked out in Swift. Change it in Code.')
    expect(moveBlocked(start(drawn(rect(100, 125, 100, 50), [], { parent: square }), layer({ context: overlap })))).toBeNull()
    expect(moveBlocked(start(drawn(rect(100, 125, 100, 50)), layer()))).toBeNull()
  })

  it('does nothing outside an Overlap, or to an offset left to Code', () => {
    const column = start(drawn(rect(100, 125, 100, 50)), layer())
    expect(handleLayout(column).move).toBe(false)
    expect(changeFor({ kind: 'move' }, column, { x: 12, y: 0 })).toBeNull()
    const code = start(drawn(rect(100, 125, 100, 50), [], { parent: square }), layer({ context: overlap, offset: { value: null, state: 'code', disabledReason: 'Change it in Code.' } }))
    expect(changeFor({ kind: 'move' }, code, { x: 12, y: 0 })).toBeNull()
  })

  describe('pinned to a corner or an edge', () => {
    // Text("Badge").padding(8).background(.red).padding(16), pinned in the 300 point square.
    const badge = (pin: Alignment9) => start(drawn(rect(24, 24, 40, 20), [
      { index: 0, kind: 'padding', rect: rect(16, 16, 56, 36) },
      { index: 2, kind: 'padding', rect: rect(0, 0, 88, 68) },
      { index: 3, kind: 'frame', rect: rect(0, 0, 300, 300) },
    ], { parent: square }), layer({
      context: { ...overlap, surface: true }, pin: literal(pin, ['pin']),
      padding: literal(even(8), ['p']), margin: literal(even(16), ['m']),
    }, { claimed: { p: 'layout', b: 'fill', m: 'layout', pin: 'layout' } }), ['p', 'b', 'm', 'pin'])
    const insets = (top: number, leading: number, bottom: number, trailing: number) => ({ top, leading, bottom, trailing })

    it('writes the margin on the sides it is pinned to', () => {
      const change = changeFor({ kind: 'move' }, badge('topLeading'), { x: 10, y: 5 })
      expect(change?.draft).toEqual({ margin: insets(21, 26, 16, 16) })
      expect(change?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', margin: insets(21, 26, 16, 16) }] })
      expect(changeFor({ kind: 'move' }, badge('bottomTrailing'), { x: 10, y: 5 })?.draft).toEqual({ margin: insets(16, 16, 11, 6) })
      expect(changeFor({ kind: 'move' }, badge('top'), { x: 10, y: 5 })?.draft).toEqual({ margin: insets(21, 16, 16, 16) })
      expect(changeFor({ kind: 'move' }, badge('topLeading'), { x: -30, y: 0 })?.draft).toEqual({ margin: insets(16, 0, 16, 16) })
    })

    it('writes the padding of a view with no fill, which has no margin', () => {
      // Text("Note").padding(16), pinned: its padding is the room to the Overlap's edges.
      const note = start(drawn(rect(16, 16, 40, 20), [
        { index: 0, kind: 'padding', rect: rect(0, 0, 72, 52) },
        { index: 1, kind: 'frame', rect: rect(0, 0, 300, 300) },
      ], { parent: square }), layer({
        context: overlap, pin: literal('topLeading' as const, ['pin']), padding: literal(even(16), ['p']),
        margin: { value: null, state: 'absent', disabledReason: 'Margin is the space outside a fill. Add a fill to give this view one.' },
      }), ['p', 'pin'])
      expect(changeFor({ kind: 'move' }, note, { x: 4, y: 0 })?.commit).toEqual({ kind: 'layer', changes: [{ section: 'layout', padding: insets(16, 20, 16, 16) }] })
    })
  })
})

describe('starting a drag on a selected view', () => {
  const modifier = (id: string, enabled = true) => ({ id, enabled }) as unknown as AuthoringModifier
  const spacing = (value: string, disabledReason?: string) => ({ id: 'spacing', value, ...disabledReason ? { disabledReason } : {} }) as unknown as DesignControl
  const instance = drawn(rect(0, 0, 100, 60), [], { children: [rect(0, 0, 100, 20), rect(0, 40, 100, 20)] })

  it('counts the chain’s calls as the boxes do, leaving out one that is switched off', () => {
    const node = { name: 'Text', modifiers: [modifier('a'), modifier('off', false), modifier('b')], layer: layer() }
    expect(dragStartFor(node, instance)?.chain).toEqual(['a', 'b'])
  })

  it('gives a Column or Row its axis where its spacing can be dragged', () => {
    expect(dragStartFor({ name: 'VStack', controls: [spacing('8')], layer: layer() }, instance)?.stack).toBe('vertical')
    expect(dragStartFor({ name: 'LazyHStack', controls: [spacing('')], layer: layer() }, instance)?.stack).toBe('horizontal')
    // Spread out with Spacers, or worked out in Swift: the bars would rewrite more than a number.
    expect(dragStartFor({ name: 'VStack', controls: [spacing('auto')], layer: layer() }, instance)?.stack).toBeUndefined()
    expect(dragStartFor({ name: 'VStack', controls: [spacing('gap * 2', 'Change it in Code.')], layer: layer() }, instance)?.stack).toBeUndefined()
    expect(dragStartFor({ name: 'ZStack', controls: [], layer: layer() }, instance)?.stack).toBeUndefined()
  })

  it('has nothing to start from without a layer', () => {
    expect(dragStartFor({ name: 'Text' }, instance)).toBeNull()
  })
})

describe('the arrow keys on a selected view', () => {
  it('nudge it inside an Overlap, a point at a time and ten with Shift', () => {
    expect(arrowFor('ArrowRight', false, 'overlap')).toEqual({ nudge: { x: 1, y: 0 } })
    expect(arrowFor('ArrowUp', true, 'overlap')).toEqual({ nudge: { x: 0, y: -10 } })
  })

  it('move it earlier or later along a Column or a Row, and do nothing across it', () => {
    expect(arrowFor('ArrowUp', false, 'column')).toEqual({ reorder: -1 })
    expect(arrowFor('ArrowDown', true, 'column')).toEqual({ reorder: 1 })
    expect(arrowFor('ArrowLeft', false, 'column')).toBeNull()
    expect(arrowFor('ArrowLeft', false, 'row')).toEqual({ reorder: -1 })
    expect(arrowFor('ArrowRight', false, 'row')).toEqual({ reorder: 1 })
    expect(arrowFor('ArrowDown', false, 'row')).toBeNull()
    expect(arrowFor('ArrowDown', false, 'other')).toBeNull()
    expect(arrowFor('Enter', false, 'overlap')).toBeNull()
  })
})

describe('telling a press from a drag', () => {
  it('is a click until the pointer has moved 3 pixels, whichever way', () => {
    expect(dragged({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false)
    expect(dragged({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(true)
    expect(dragged({ x: 10, y: 10 }, { x: 10, y: 7 })).toBe(true)
  })
})

describe('the ghost a slow screen shows while its drafts catch up', () => {
  const overlap = { parent: 'overlap' as const, inButton: false, surface: false }
  const square = { kind: 'overlap' as const, rect: rect(0, 0, 300, 300) }

  it('is the box at its dragged size, its far edge kept from a leading or top handle', () => {
    const view = start(drawn(rect(100, 200, 50, 20)), layer())
    const handle = { kind: 'resize' as const, edge: 'topLeading' as const }
    expect(ghostFor(handle, view, changeFor(handle, view, { x: -10, y: -6 }))).toEqual(rect(90, 194, 60, 26))
    const corner = { kind: 'resize' as const, edge: 'bottomTrailing' as const }
    expect(ghostFor(corner, view, changeFor(corner, view, { x: 10, y: 6 }))).toEqual(rect(100, 200, 60, 26))
  })

  it('moves with the offset, or with the room on the sides a pinned view is pinned to', () => {
    const plain = start(drawn(rect(100, 125, 100, 50), [], { parent: square }), layer({ context: overlap }))
    expect(ghostFor({ kind: 'move' }, plain, changeFor({ kind: 'move' }, plain, { x: 12, y: -8 }))).toEqual(rect(112, 117, 100, 50))
    const pinned = start(drawn(rect(16, 16, 40, 20), [{ index: 0, kind: 'padding', rect: rect(0, 0, 72, 52) }], { parent: square }),
      layer({ context: overlap, pin: literal('bottomTrailing' as const, ['pin']), padding: literal(even(16), ['p']) }), ['p'])
    expect(ghostFor({ kind: 'move' }, pinned, changeFor({ kind: 'move' }, pinned, { x: -6, y: -4 }))).toEqual(rect(-6, -4, 72, 52))
  })

  it('is the box as it is when nothing changes, and none for a drag a box can’t show', () => {
    const view = start(drawn(rect(100, 200, 50, 20)), layer())
    expect(ghostFor({ kind: 'resize', edge: 'trailing' }, view, null)).toEqual(rect(100, 200, 50, 20))
    const padded = start(drawn(rect(116, 108, 40, 20), [{ index: 0, kind: 'padding', rect: rect(100, 100, 72, 36) }]), layer({ padding: literal({ top: 8, leading: 16, bottom: 8, trailing: 16 }, ['p']) }), ['p'])
    expect(ghostFor({ kind: 'padding', side: 'top' }, padded, changeFor({ kind: 'padding', side: 'top' }, padded, { x: 0, y: 4 }))).toBeNull()
  })
})
