import { isConditional, type ColorValue, type Conditional, type LayerChange, type LayerProperties, type LayerValue, type ShadowValue } from '@studio/shared'
import { SLOT } from '../authoring-modifiers'
import { insertCalls, insertionIndex, replaceRun, runHasComment, type Patch } from './chain-edit'
import { colorSource, readColor, sameColor } from './color'
import { callsNamed, type ChainSlots, type SlotRun } from './slots'
import { commented, inSwift, setTwice, type LayerContext } from './context'
import { amount, amountOf, isToken, keepCondition, numberOf, sourceOf } from './values'

/**
 * Effects: the layer's opacity, its drop shadow and its blur. Each is one modifier, the
 * shadow with the surface it is cast by and the others near the end of the chain, and a
 * layer at full opacity with no shadow or blur has none of them.
 */

type Effect = 'opacity' | 'blur'
type Amount = number | Conditional<number>

/** The amount an effect is set to, when the panel can say: an opacity may be two a condition chooses between (Wave 3b). */
function amountIn(run: SlotRun, name: Effect, ctx: LayerContext): Amount | undefined {
  const call = run.calls[0]!
  const labels = call.args.map(arg => arg.label).join()
  if (call.trailingClosure || labels !== (name === 'opacity' ? '' : 'radius')) return undefined
  return name === 'opacity' ? amountOf(call.args[0]!.value, ctx) : numberOf(call.args[0]!.value, ctx)
}

function readEffect(slots: ChainSlots, name: Effect, ctx: LayerContext): LayerValue<Amount | null> {
  const runs = callsNamed(slots, [name])
  const none = name === 'opacity' ? 1 : null
  if (!runs.length) return { value: none, state: 'absent' }
  const from = runs.map(run => ctx.ids[run.indices[0]!]!)
  if (runs.length > 1) return { value: none, state: 'code', from, disabledReason: setTwice(name) }
  const amount = amountIn(runs[0]!, name, ctx)
  if (amount === undefined) return { value: none, state: 'code', from, disabledReason: inSwift(name) }
  return { value: amount, state: 'literal', from }
}

// ---------------------------------------------------------------- shadow

/** The arguments `.shadow` takes, in the order Swift has them; only the radius has no default. */
const SHADOW_LABELS = ['color', 'radius', 'x', 'y'] as const
const SHADOW_SWIFT = inSwift('shadow')

/** The shadow as read, and its colour as written, which a change that keeps the colour keeps. */
interface ShadowRead { readonly value: LayerValue<ShadowValue | null>; readonly run?: SlotRun; readonly color?: string }

function shadowOf(slots: ChainSlots, ctx: LayerContext): ShadowRead {
  const runs = callsNamed(slots, ['shadow'])
  if (!runs.length) return { value: { value: null, state: 'absent' } }
  const from = runs.map(run => ctx.ids[run.indices[0]!]!)
  const code = (disabledReason: string): ShadowRead => ({ value: { value: null, state: 'code', from, disabledReason } })
  if (runs.length > 1) return code(setTwice('shadow'))
  const run = runs[0]!, call = run.calls[0]!
  if (runHasComment(slots, run, ctx.text)) return code(commented('shadow'))
  if (call.trailingClosure) return code(SHADOW_SWIFT)
  // A shadow token, `.shadow(.card)`, which `Save as token` writes: kept linked.
  if (call.args.length === 1 && call.args[0]!.label === null) {
    const written = sourceOf(ctx, call.args[0]!.value)
    return isToken(written) ? { value: { value: { token: written }, state: 'token', from }, run } : code(SHADOW_SWIFT)
  }
  const labels = call.args.map(arg => arg.label ?? '')
  const ordered = labels.every((label, index) => SHADOW_LABELS.includes(label as typeof SHADOW_LABELS[number]) && (index === 0 || SHADOW_LABELS.indexOf(label as never) > SHADOW_LABELS.indexOf(labels[index - 1] as never)))
  if (!ordered || !labels.includes('radius')) return code(SHADOW_SWIFT)
  const arg = (label: string) => call.args.find(item => item.label === label)?.value
  const radius = numberOf(arg('radius')!, ctx, false)
  const [x, y] = (['x', 'y'] as const).map(axis => { const value = arg(axis); return value ? numberOf(value, ctx) : 0 })
  if (radius === undefined || x === undefined || y === undefined) return code(SHADOW_SWIFT)
  const colorExpr = arg('color')
  const color = colorExpr ? readColor(colorExpr, ctx) : undefined
  if (color?.state === 'code') return code(SHADOW_SWIFT)
  return { value: { value: { color: color?.value ?? null, radius, x, y }, state: color?.state === 'token' ? 'token' : 'literal', from }, run, ...colorExpr ? { color: sourceOf(ctx, colorExpr) } : {} }
}

export function readEffects(slots: ChainSlots, ctx: LayerContext): LayerProperties['effects'] {
  return { opacity: readEffect(slots, 'opacity', ctx) as LayerValue<Amount>, blur: readEffect(slots, 'blur', ctx) as LayerValue<number | null>, shadow: shadowOf(slots, ctx).value }
}

const sameShadow = (a: ShadowValue, b: ShadowValue) => 'token' in a || 'token' in b ? 'token' in a && 'token' in b && a.token === b.token
  : (a.color && b.color ? sameColor(a.color, b.color) : !a.color && !b.color) && a.radius === b.radius && a.x === b.x && a.y === b.y

/** A shadow's colour as `color:` takes a `Color`: `.black.opacity(0.25)`, the plainest spelling that is one. */
function shadowColor(color: ColorValue, ctx: LayerContext): string {
  const written = colorSource(color, 'Color', ctx)
  return /^Color\.[a-z]/.test(written) ? written.slice('Color'.length) : written
}

function writeShadow(slots: ChainSlots, next: ShadowValue | null, ctx: LayerContext): Patch | null {
  const current = shadowOf(slots, ctx), before = current.value.value
  if (current.value.disabledReason) throw new Error(current.value.disabledReason)
  if (next === null ? before === null : before !== null && sameShadow(before, next)) return null
  let call: string | null = null
  if (next && 'token' in next) {
    // A token is kept as it was read: the panel offers no other.
    if (!before || !('token' in before) || before.token !== next.token) throw new Error('Choose a shadow token where its shadow is made. Change it in Code.')
  } else if (next) {
    const { radius, x, y } = next
    if (![radius, x, y].every(Number.isFinite) || radius < 0) throw new Error('A shadow’s blur is 0 or more points, and its offset a number of points.')
    // A colour left as it was keeps its spelling, a token or `Color.black.opacity(0.2)`.
    const color = next.color && (before && !('token' in before) && before.color && current.color && sameColor(before.color, next.color) ? current.color : shadowColor(next.color, ctx))
    // The plainest form: SwiftUI's own colour and no offset are left out.
    const args = [...color ? [`color: ${color}`] : [], `radius: ${amount(radius)}`, ...x ? [`x: ${amount(x)}`] : [], ...y ? [`y: ${amount(y)}`] : []]
    call = `.shadow(${args.join(', ')})`
  }
  if (current.run) return replaceRun(slots, current.run, call ? [call] : [], ctx.text)
  if (!call) return null
  if (ctx.locked) throw new Error(ctx.locked)
  return insertCalls(slots, insertionIndex(slots, SLOT.shadow), [call], ctx.text)
}

// ---------------------------------------------------------------- opacity and blur

const opacityCall = (value: Amount): string | null => isConditional(value)
  ? `.opacity(${value.condition} ? ${amount(value.then)} : ${amount(value.otherwise)})`
  : value === 1 ? null : `.opacity(${amount(value)})`

function writeEffect(slots: ChainSlots, name: Effect, next: Amount | null, ctx: LayerContext): Patch | null {
  const current = readEffect(slots, name, ctx)
  if (current.disabledReason) throw new Error(current.disabledReason)
  const before = current.value
  keepCondition(before, next, name)
  const round = (value: number) => Number(value.toFixed(3))
  const rounded: Amount | null = next === null ? null : isConditional(next) ? { ...next, then: round(next.then), otherwise: round(next.otherwise) } : round(next)
  // The value it already has writes nothing, however it is spelled: `.opacity(0.50)` stays.
  const same = (a: Amount | null, b: Amount | null) => isConditional(a) || isConditional(b) ? isConditional(a) && isConditional(b) && a.then === b.then && a.otherwise === b.otherwise : a === b
  if (current.state !== 'absent' && same(rounded ?? (name === 'opacity' ? 1 : null), before)) return null
  const call = name === 'opacity' ? opacityCall(rounded ?? 1) : (rounded === null || rounded === 0 ? null : `.blur(radius: ${rounded})`)
  const run = callsNamed(slots, [name])[0]
  if (run) return replaceRun(slots, run, call ? [call] : [], ctx.text)
  if (!call) return null
  if (ctx.locked) throw new Error(ctx.locked)
  return insertCalls(slots, insertionIndex(slots, SLOT.effects), [call], ctx.text)
}

export function writeEffects(slots: ChainSlots, change: Extract<LayerChange, { section: 'effects' }>, ctx: LayerContext): Patch[] {
  const opacity = change.opacity, opacities = opacity === undefined ? [] : isConditional(opacity) ? [opacity.then, opacity.otherwise] : [opacity]
  if (opacities.some(value => !(value >= 0 && value <= 1))) throw new Error('Opacity is between 0 and 100%.')
  if (change.blur !== undefined && change.blur !== null && !(change.blur >= 0)) throw new Error('A blur radius is 0 or more.')
  const patches: Patch[] = []
  for (const [name, value] of [['opacity', opacity], ['blur', change.blur]] as const) {
    if (value === undefined) continue
    const patch = writeEffect(slots, name, value, ctx)
    if (patch) patches.push(patch)
  }
  // Last, so where both are added at the end of the chain the shadow lands before the effects after it.
  const shadow = change.shadow === undefined ? null : writeShadow(slots, change.shadow, ctx)
  return shadow ? [...patches, shadow] : patches
}
