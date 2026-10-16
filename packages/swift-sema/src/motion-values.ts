import { ANIMATION_STYLES, takesDuration, type ActionAnimation, type ReadAnimation } from '@studio/shared'
import type { Expr } from '@studio/swift-syntax'

/**
 * The values motion is written with (Wave 5a): animations and transitions, read from the
 * Swift that writes them and written back with Apple's names. Shared by the Visibility
 * group, When tapped and the modifier cards.
 */

/** An animation as written, `.smooth` or `Animation.easeInOut(duration: 0.4)`: its style, or null for one Design doesn't name. */
export function animationOf(expr: Expr): Omit<ReadAnimation, 'written'> {
  const named = (callee: Expr) => callee.kind === 'memberAccess' && (!callee.base || callee.base.kind === 'identifier' && callee.base.name === 'Animation') ? callee.member : undefined
  const value = expr.kind === 'call' && expr.args.length === 1 && expr.args[0]!.label === 'duration' ? expr.args[0]!.value : undefined
  const duration = value?.kind === 'integerLiteral' || value?.kind === 'floatLiteral' ? value.value : undefined
  const style = ANIMATION_STYLES.find(s => s === (expr.kind === 'call' ? duration !== undefined ? named(expr.callee) : undefined : named(expr)))
  if (!style || duration !== undefined && !takesDuration(style)) return { style: null }
  return duration === undefined ? { style } : { style, duration }
}

/** The Swift of an animation, `.smooth` or `.easeInOut(duration: 0.4)`: empty for Default, which `withAnimation { … }` plays. */
export function animationSwift(animation: ActionAnimation): string {
  const { style, duration } = animation
  if (!ANIMATION_STYLES.includes(style) || duration !== undefined && (!takesDuration(style) || !Number.isFinite(duration) || duration <= 0 || duration > 10)) throw new Error('Choose Smooth, Snappy, Bouncy, Default, Ease in and out or Linear, and a duration of up to 10 seconds.')
  return style === 'default' ? '' : duration === undefined ? `.${style}` : `.${style}(duration: ${duration})`
}

/**
 * A view's transition (Wave 5a): one Design writes, none, or one it reads and leaves to Code,
 * different in and out (`.asymmetric`) or written another way.
 */
export type TransitionKind = WrittenTransition | 'none' | 'asymmetric' | 'written'
type WrittenTransition = 'fade' | 'slide' | 'scale' | 'move' | 'push' | 'blur'
export interface Transition { readonly kind: TransitionKind; readonly edge?: string; readonly fades: boolean }
export const NO_TRANSITION: Transition = { kind: 'none', fades: false }

/** Each transition in a designer's words, as the Transition select lists them: the one place they are worded. */
const TRANSITION_WORDS: Readonly<Record<TransitionKind, string>> = { none: 'None', fade: 'Fade', slide: 'Slide', scale: 'Scale', move: 'Move from edge', push: 'Push from edge', blur: 'Blur', asymmetric: 'Different in and out', written: 'Written in code' }
/** The transition SwiftUI names each one Design writes, and the iOS it needs: the one place their Swift is. */
const TRANSITION_SWIFT: Readonly<Record<WrittenTransition, { readonly name: string; readonly iOS: number }>> = {
  fade: { name: 'opacity', iOS: 13 }, slide: { name: 'slide', iOS: 13 }, scale: { name: 'scale', iOS: 13 }, move: { name: 'move', iOS: 13 }, push: { name: 'push', iOS: 16 }, blur: { name: 'blurReplace', iOS: 17 },
}
const WRITTEN = Object.keys(TRANSITION_SWIFT) as WrittenTransition[]
export const EDGES = ['top', 'bottom', 'leading', 'trailing']

const isWritten = (kind: TransitionKind): kind is WrittenTransition => kind in TRANSITION_SWIFT
/** Whether only Code changes a transition: one different in and out, or written another way. */
export const leftToCode = (transition: Transition) => transition.kind === 'asymmetric' || transition.kind === 'written'
/** The transition a select's words name, or undefined for words it doesn't list. */
export const transitionNamed = (words: string): TransitionKind | undefined => (Object.keys(TRANSITION_WORDS) as TransitionKind[]).find(kind => TRANSITION_WORDS[kind] === words)
/** Why a transition can't be written at the deployment target `target`, naming the iOS it needs; undefined when it can. */
export function transitionTooNew(kind: TransitionKind, target: number): string | undefined {
  const needs = isWritten(kind) ? TRANSITION_SWIFT[kind].iOS : 13
  return target < needs ? `${TRANSITION_WORDS[kind]} needs iOS ${needs} or newer.` : undefined
}

/** `.opacity` or `AnyTransition.opacity`: the name of a transition SwiftUI has. */
const transitionName = (expr: Expr) => expr.kind === 'memberAccess' && (!expr.base || expr.base.kind === 'identifier' && expr.base.name === 'AnyTransition') ? expr.member : undefined

/** A transition as written: a kind Design writes, with its edge and Fades too, or one only Code changes. */
export function readTransition(expr: Expr): Transition {
  let value = expr, fades = false
  const also = value.kind === 'call' && value.callee.kind === 'memberAccess' && value.callee.member === 'combined' && value.args.length === 1 && value.args[0]!.label === 'with' ? value : undefined
  if (also && also.callee.kind === 'memberAccess' && also.callee.base && transitionName(also.args[0]!.value) === 'opacity') { fades = true; value = also.callee.base }
  const name = value.kind === 'call' ? transitionName(value.callee) : transitionName(value), kind = WRITTEN.find(k => TRANSITION_SWIFT[k].name === name)
  const arg = value.kind === 'call' && value.args.length === 1 ? value.args[0]! : undefined
  const edge = arg && arg.label === (kind === 'move' ? 'edge' : 'from') && arg.value.kind === 'memberAccess' && !arg.value.base && EDGES.includes(arg.value.member) ? arg.value.member : undefined
  if (kind && (value.kind === 'call' ? !!edge : kind !== 'move' && kind !== 'push')) return edge ? { kind, edge, fades } : { kind, fades }
  return { kind: name === 'asymmetric' ? 'asymmetric' : 'written', fades }
}
/** The Swift of a transition Design writes: `.move(edge: .top).combined(with: .opacity)`. */
export function transitionSwift({ kind, edge, fades }: Transition): string {
  if (!isWritten(kind)) throw new Error('Choose a transition this view offers.')
  const { name } = TRANSITION_SWIFT[kind]
  const base = kind === 'move' ? `.move(edge: .${edge ?? 'top'})` : kind === 'push' ? `.push(from: .${edge ?? 'trailing'})` : `.${name}`
  return fades && kind !== 'fade' ? `${base}.combined(with: .opacity)` : base
}

/** One of the settings of a transition: its Transition select, its Edge, or Fades too. */
export interface TransitionSetting {
  readonly part: 'transition' | 'edge' | 'fades'
  readonly label: string
  readonly kind: 'select' | 'toggle'
  readonly value: string
  readonly options?: readonly string[]
  readonly description: string
  readonly disabledReason?: string
}
/**
 * The Transition, Edge and Fades too settings of `current` (Wave 5a), as the Visibility group
 * and a transition's card both show them: the transitions `target` has, with None where it is
 * offered, an edge for one that comes in from one, and Fades too for one that moves.
 */
export function transitionSettings(current: Transition, target: number, none: boolean): TransitionSetting[] {
  const offered = WRITTEN.filter(kind => !transitionTooNew(kind, target)).map(kind => TRANSITION_WORDS[kind]), code = leftToCode(current), words = TRANSITION_WORDS[current.kind]
  const settings: TransitionSetting[] = [{ part: 'transition', label: 'Transition', kind: 'select', value: words, options: [...none ? [TRANSITION_WORDS.none] : [], ...offered, ...code ? [words] : []], description: 'How it comes and goes. It plays when the change is animated.', ...code ? { disabledReason: 'This transition is one Design doesn’t write. Change it in Code.' } : {} }]
  if (current.edge) settings.push({ part: 'edge', label: 'Edge', kind: 'select', value: current.edge, options: EDGES, description: 'The edge it comes in from and leaves by.' })
  if (!code && current.kind !== 'none' && current.kind !== 'fade') settings.push({ part: 'fades', label: 'Fades too', kind: 'toggle', value: String(current.fades), description: 'It fades as well as it moves.' })
  return settings
}
