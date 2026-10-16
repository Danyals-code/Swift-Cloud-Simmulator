import { needsNewerIOS } from '@studio/shared'
import type { CallExpr, Expr } from '@studio/swift-syntax'
import type { AddControl } from './design-advanced-controls'
import { IN_CODE, ownSpan, setThere, type setAround } from './design-content-controls'
import { OWN_MODIFIER, modifierSetting } from './design-sheet-controls'
import { modifierName } from './authoring-border'
import { STYLE_TOKENS } from './builtins'

/**
 * Wave 6d's fields for controls and scrolling: a DatePicker's Style, written to
 * `.datePickerStyle`, and a sideways ScrollView's Peek, written to `.contentMargins`.
 */

type Around = ReturnType<typeof setAround>

/**
 * A field read from one modifier of the view's own, `name`, and written back to it: a select of
 * `options`, or a length in points from 0. `pattern` captures the value as the field writes
 * it, with no space; a select's capture is its option in lower case. Written once in that form,
 * it reads; written any other way, or with another of `also`, it's shown as written, read only,
 * with `unread`. None at all reads as `absent`. A view around it that sets it is read too, read
 * only. A new one goes after `after`, unless the view can't take one there; `args` writes a
 * value, null taking it away. `older` says why the deployment target can't have it at all, and
 * `newer` why it can't have one value.
 */
function modifierField(id: string, label: string, name: string, pattern: RegExp, options: readonly string[] | undefined, absent: string, description: string, unread: string,
  expr: Expr, modifiers: readonly CallExpr[], text: string, after: CallExpr, add: AddControl, around: Around | undefined,
  args: (v: string) => string | null, appendable: boolean, older?: string, newer?: (v: string) => string | undefined, also?: (m: CallExpr) => boolean): void {
  const calls = modifiers.filter(m => modifierName(m) === name || also?.(m)), call = calls[0]
  const none = () => ({ start: after.span.end, end: after.span.end, text: '' }), kind = options ? 'select' : 'pt', min = options ? undefined : 0
  const read = (written: string) => {
    const value = pattern.exec(written.replace(/\s/g, ''))?.[1]
    return options && value ? options.find(o => o.toLowerCase() === value) : value
  }
  if (!call && around) {
    const inherited = read(around.modifier.expression)
    return add(id, label, inherited ? kind : 'text', inherited ?? around.modifier.expression, none, inherited ? options : undefined, inherited ? min : undefined, undefined, inherited ? description : IN_CODE, around.modifier.source, setThere(around.view))
  }
  const at = call && ownSpan(call), current = !call ? absent : calls.length === 1 && modifierName(call) === name ? read(text.slice(at!.start, at!.end)) : undefined
  if (!current) return add(id, label, 'text', `.${text.slice(at!.start, at!.end)}`, none, undefined, undefined, undefined, IN_CODE, at, unread)
  const setting = modifierSetting(expr, text, name, call, after, none)
  add(id, label, kind, current, v => setting.write(args(v)), options, min, undefined, description, at, older ?? (!call && !appendable ? OWN_MODIFIER : undefined), v => newer?.(v) ?? setting.problem(args(v)))
}

/** Compact and Graphical, the styles iOS 14 brought; Wheel and Automatic are iOS 13's, as DatePicker is. */
const FROM_14: ReadonlySet<string> = new Set(['Compact', 'Graphical'])

/**
 * A DatePicker's Style (Wave 6d): Automatic, Compact, Graphical or Wheel, the styles the
 * preview draws, as `.datePickerStyle(.compact)` writes them, which Automatic takes away. A new
 * one goes after the view's last modifier. Compact and Graphical are iOS 14's. Any other
 * spelling, such as an iOS 13 style type, a style in a variable or a second one, is shown as
 * written, read only; so is a style a view around it sets, which the DatePicker takes unless
 * it sets its own.
 */
export function datePickerStyleControl(expr: Expr, base: CallExpr, modifiers: readonly CallExpr[], text: string, target: number, appendable: boolean, add: AddControl, around?: Around): void {
  const styles = [...STYLE_TOKENS.get('datePickerStyle')!].map(token => token[0]!.toUpperCase() + token.slice(1))
  modifierField('date:style', 'Style', 'datePickerStyle', /^\.?datePickerStyle\(\.(\w+)\)$/, styles, 'Automatic',
    'Compact shows the date and time as buttons, Graphical a calendar, and Wheel spinning columns.', 'This style is written in a way Style doesn’t set. Change it in Code.',
    expr, modifiers, text, modifiers.at(-1) ?? base, add, around, v => v === 'Automatic' ? null : `(.${v.toLowerCase()})`,
    appendable, undefined, v => target < 14 && FROM_14.has(v) ? needsNewerIOS(14, 'set') : undefined)
}

/** Whether a ScrollView scrolls sideways, written `ScrollView(.horizontal)`. */
export const scrollsSideways = (base: CallExpr): boolean => {
  const axis = base.args[0]?.label === null ? base.args[0].value : undefined
  return axis?.kind === 'memberAccess' && !axis.base && axis.member === 'horizontal'
}

/** Safe area padding that insets a view's content sideways: any but `.top`, `.bottom` or `.vertical`'s. */
const padsSideways = (m: CallExpr): boolean => {
  const edges = m.args[0]?.label === null ? m.args[0].value : undefined
  return modifierName(m) === 'safeAreaPadding' && !(edges?.kind === 'memberAccess' && !edges.base && ['top', 'bottom', 'vertical'].includes(edges.member))
}

/**
 * A sideways ScrollView's Peek (Wave 6d): margins before its first view and after its last,
 * so the next one shows at the edge, as `.contentMargins(.horizontal, 24, for: .scrollContent)`
 * writes them (iOS 17), which 0 takes away. A new one goes straight after the view's scroll
 * behaviour, which it goes with, or after its last modifier. Margins written any other way,
 * on other edges, for another placement, worked out in code or twice, are shown as written,
 * read only, and so is safe area padding that insets the content sideways too, and margins a
 * view around it sets, which reach the ScrollView too.
 */
export function peekControl(expr: Expr, base: CallExpr, modifiers: readonly CallExpr[], text: string, target: number, appendable: boolean, add: AddControl, around?: Around): void {
  const behaviour = modifiers.find(m => modifierName(m) === 'scrollTargetBehavior')
  modifierField('scroll:peek', 'Peek', 'contentMargins', /^\.?contentMargins\(\.horizontal,(\d+(?:\.\d+)?),for:\.scrollContent\)$/, undefined, '0',
    'Space before the first item and after the last, so the next one peeks in.', 'These margins are written in a way Peek doesn’t set. Change them in Code.',
    expr, modifiers, text, behaviour ?? modifiers.at(-1) ?? base, add, around, v => Number(v) === 0 ? null : `(.horizontal, ${Number(v)}, for: .scrollContent)`,
    // Straight after the scroll behaviour, one of Apple's, the margins go on a view whatever follows it.
    appendable || !!behaviour, target < 17 ? needsNewerIOS(17, 'set') : undefined, undefined, padsSideways)
}
