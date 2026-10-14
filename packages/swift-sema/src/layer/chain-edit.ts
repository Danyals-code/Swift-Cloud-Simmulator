import { withoutOffMarkers } from '@studio/swift-syntax'
import { SLOT, dotOf, slotOf } from '../authoring-modifiers'
import { runsOf, type ChainSlots, type SlotRun } from './slots'

/**
 * Writing into a modifier chain the way it is already written: a new modifier on a line
 * of its own where the others are, on the same line where they are, and a run of calls
 * replaced without touching what is around it.
 */

export interface Patch {
  readonly start: number
  readonly end: number
  readonly text: string
  /** A property of the view's struct the change needs, such as an `@ScaledMetric` size: outside the chain, inside the struct. */
  readonly declaration?: true
}

/** A patch inside the view's own call, where a Button's label or a shape's own shape is written. */
export type LabelPatch = Patch & { readonly label: true }

/** Where the line with `offset` on it starts. */
export const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1
/** The line ending the file is written with. */
export const lineEnding = (text: string) => text.includes('\r\n') ? '\r\n' : '\n'

/** Where the text between a modifier and the one before it starts: the end of the one before. */
const gapStart = (slots: ChainSlots, index: number) => index === 0 ? slots.base.span.end : slots.modifiers[index - 1]!.span.end

/** The whitespace a new modifier is written after: the chain's own, or a line of its own under a block. */
export function modifierPrefix(slots: ChainSlots, text: string): string {
  for (let index = slots.modifiers.length - 1; index >= 0; index--) {
    const gap = text.slice(gapStart(slots, index), dotOf(slots.modifiers[index]!, text))
    if (/^\s*$/.test(gap) && gap.includes('\n')) return gap
  }
  if (slots.modifiers.length) return ''
  // A block on several lines takes its first modifier under its closing brace.
  const base = slots.base
  if (!text.slice(base.span.start, base.span.end).includes('\n')) return ''
  return lineEnding(text) + /^[ \t]*/.exec(text.slice(lineStart(text, base.span.start)))![0]
}

/**
 * Where a new call of a `SLOT` goes: after the last call of the same or an earlier slot,
 * so text styles come first, then padding, size, fill, corners, stroke, shadow, margin,
 * outer frame, offset, effects and behaviour. Nothing already there moves, and nothing
 * goes before the calls only the view's own type takes.
 *
 * The surface keeps each call on its side of it. Padding, size and fill go inside it,
 * before its first call; corners, stroke and shadow among its own calls. Neither goes past
 * a margin, which on a view that paints its own surface is where that surface ends. A
 * margin goes just after the surface, and an outer frame, offset or effect after it too.
 */
export function insertionIndex(slots: ChainSlots, slot: number): number {
  const { names, baseEnd, surface } = slots
  const boundary = surface ? surface.last + 1 : runsOf(slots, 'margin')[0]?.indices[0] ?? names.length
  const after = (end: number) => {
    let index = baseEnd
    for (let at = baseEnd; at < end; at++) if (slotOf(names[at]!) <= slot) index = at + 1
    return index
  }
  if (slot === SLOT.text) return after(names.length)
  if (slot < SLOT.clip) return Math.min(after(names.length), surface?.first ?? boundary)
  if (slot < SLOT.margin) return after(boundary)
  return slot === SLOT.margin && surface ? boundary : Math.max(after(names.length), surface ? boundary : 0)
}

/** New calls written before the modifier at `index`, or at the end of the chain. */
export function insertCalls(slots: ChainSlots, index: number, calls: readonly string[], text: string): Patch {
  const prefix = modifierPrefix(slots, text)
  const at = index < slots.modifiers.length ? gapStart(slots, index) : slots.expr.span.end
  return { start: at, end: at, text: calls.map(call => prefix + call).join('') }
}

/** A run of calls replaced by others, the first keeping the run's place; none takes the run away. */
export function replaceRun(slots: ChainSlots, run: SlotRun, calls: readonly string[], text: string): Patch {
  const first = run.indices[0]!, last = run.indices.at(-1)!
  const start = gapStart(slots, first), end = slots.modifiers[last]!.span.end
  if (!calls.length) return { start, end, text: '' }
  const gap = text.slice(start, dotOf(slots.modifiers[first]!, text))
  const prefix = /^\s*$/.test(gap) ? gap : modifierPrefix(slots, text)
  return { start, end, text: calls.map((call, index) => (index ? prefix : gap) + call).join('') }
}

/** Whether a run's own text has a comment in it, which a rewrite would lose. */
export function runHasComment(slots: ChainSlots, run: SlotRun, text: string): boolean {
  const start = dotOf(run.calls[0]!, text), end = slots.modifiers[run.indices.at(-1)!]!.span.end
  return /\/\/|\/\*/.test(withoutOffMarkers(text.slice(start, end)))
}

export function applyPatch(text: string, patch: Patch): string {
  return text.slice(0, patch.start) + patch.text + text.slice(patch.end)
}
