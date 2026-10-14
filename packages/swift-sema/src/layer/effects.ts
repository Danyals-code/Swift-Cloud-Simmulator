import type { LayerChange, LayerProperties, LayerValue } from '@studio/shared'
import { SLOT } from '../authoring-modifiers'
import { insertCalls, insertionIndex, replaceRun, type Patch } from './chain-edit'
import { callsNamed, type ChainSlots, type SlotRun } from './slots'
import { inSwift, setTwice, type LayerContext } from './context'
import { numberOf } from './values'

/**
 * Effects: the layer's opacity and its blur. Each is one modifier, near the end of the
 * chain with the other effects, and a layer at full opacity with no blur has neither.
 */

type Effect = 'opacity' | 'blur'

/** The number an effect is set to, when the panel can say. */
function amountOf(run: SlotRun, name: Effect, ctx: LayerContext): number | undefined {
  const call = run.calls[0]!
  const labels = call.args.map(arg => arg.label).join()
  if (call.trailingClosure || labels !== (name === 'opacity' ? '' : 'radius')) return undefined
  return numberOf(call.args[0]!.value, ctx)
}

function readEffect(slots: ChainSlots, name: Effect, ctx: LayerContext): LayerValue<number | null> {
  const runs = callsNamed(slots, [name])
  const none = name === 'opacity' ? 1 : null
  if (!runs.length) return { value: none, state: 'absent' }
  const from = runs.map(run => ctx.ids[run.indices[0]!]!)
  if (runs.length > 1) return { value: none, state: 'code', from, disabledReason: setTwice(name) }
  const amount = amountOf(runs[0]!, name, ctx)
  if (amount === undefined) return { value: none, state: 'code', from, disabledReason: inSwift(name) }
  return { value: amount, state: 'literal', from }
}

export function readEffects(slots: ChainSlots, ctx: LayerContext): LayerProperties['effects'] {
  return { opacity: readEffect(slots, 'opacity', ctx) as LayerValue<number>, blur: readEffect(slots, 'blur', ctx) }
}

function writeEffect(slots: ChainSlots, name: Effect, amount: number | null, ctx: LayerContext): Patch | null {
  const current = readEffect(slots, name, ctx)
  if (current.disabledReason) throw new Error(current.disabledReason)
  const rounded = amount === null ? null : Number(amount.toFixed(3))
  // The value it already has writes nothing, however it is spelled: `.opacity(0.50)` stays.
  if (current.state !== 'absent' && (rounded ?? (name === 'opacity' ? 1 : null)) === current.value) return null
  const call = name === 'opacity' ? (rounded === 1 ? null : `.opacity(${rounded})`) : (rounded === null || rounded === 0 ? null : `.blur(radius: ${rounded})`)
  const run = callsNamed(slots, [name])[0]
  if (run) return replaceRun(slots, run, call ? [call] : [], ctx.text)
  if (!call) return null
  if (ctx.locked) throw new Error(ctx.locked)
  return insertCalls(slots, insertionIndex(slots, SLOT.effects), [call], ctx.text)
}

export function writeEffects(slots: ChainSlots, change: Extract<LayerChange, { section: 'effects' }>, ctx: LayerContext): Patch[] {
  if (change.opacity !== undefined && !(change.opacity >= 0 && change.opacity <= 1)) throw new Error('Opacity is between 0 and 100%.')
  if (change.blur !== undefined && change.blur !== null && !(change.blur >= 0)) throw new Error('A blur radius is 0 or more.')
  const patches: Patch[] = []
  for (const [name, amount] of [['opacity', change.opacity], ['blur', change.blur]] as const) {
    if (amount === undefined) continue
    const patch = writeEffect(slots, name, amount, ctx)
    if (patch) patches.push(patch)
  }
  return patches
}
