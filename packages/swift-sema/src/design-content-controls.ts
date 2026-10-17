import { CONTAINER_WORDS, DOTS_BACKGROUND, isContainerLayout, needsNewerIOS, stackLayoutOf, type AuthoringModifier, type AuthoringNode, type SourceSpan } from '@studio/shared'
import type { CallExpr, Expr } from '@studio/swift-syntax'
import type { AddControl } from './design-advanced-controls'
import { OWN_MODIFIER, modifierSetting } from './design-sheet-controls'
import { modifierName } from './authoring-border'
import { isPageStyle } from './page-style'

/**
 * Wave 4c's fields for content that reaches past the screen: a view's Safe area, read from and
 * written to `.ignoresSafeArea`, and a carousel's Page dots and Dots background.
 */

/** A modifier's own text, from its name to its end, rather than the chain it ends. */
export const ownSpan = (call: CallExpr): SourceSpan => ({ file: call.span.file, start: call.callee.kind === 'memberAccess' ? call.callee.memberSpan.start : call.span.start, end: call.span.end })
/** Why a field is shown as the code writes it: a value Design reads but can't set as written. */
export const IN_CODE = 'Shown as the code writes it.'

/** Each Safe area option but Respect, and the parentheses of `.ignoresSafeArea` that write it, regions `.all` and edges `.all` being its defaults. */
const SAFE_AREAS: Readonly<Record<string, string>> = { 'Extend to top': '(edges: .top)', 'Extend to bottom': '(edges: .bottom)', 'Extend all': '()' }
const SAFE_AREA_OPTIONS = ['Respect', ...Object.keys(SAFE_AREAS)]
/** The edges each of SwiftUI's edge sets names, as a mask (Wave 4c): top 1, bottom 2, leading 4, trailing 8. */
const EDGES: Readonly<Record<string, number>> = { top: 1, bottom: 2, leading: 4, trailing: 8, vertical: 3, horizontal: 12, all: 15 }
/** The option each mask of edges is, where Safe area has one. */
const EDGE_OPTIONS: Readonly<Record<number, string>> = { 1: 'Extend to top', 2: 'Extend to bottom', 15: 'Extend all' }

/** The edges one of `Edge.Set`'s members names, written as the preview reads it, `.top`, as a mask; 0 for anything else. */
const edgeMask = (expr: Expr): number => expr.kind === 'memberAccess' && !expr.base && Object.hasOwn(EDGES, expr.member) ? EDGES[expr.member]! : 0

/**
 * The Safe area option `.ignoresSafeArea`'s arguments are (Wave 4c), however they spell its
 * edges: `(.all, edges: .all)` is `()`, and `[.top]` is `.top`. Undefined for a region other
 * than `.all`, such as the keyboard, for edges no option is, such as `.vertical`, and for
 * any value worked out in code.
 */
function safeAreaOf(call: CallExpr): string | undefined {
  if (call.trailingClosure) return undefined
  let mask = 15, at = 0
  const region = call.args[0]?.label === null ? call.args[at++]!.value : undefined
  if (region && !(region.kind === 'memberAccess' && !region.base && region.member === 'all')) return undefined
  const edges = call.args[at]?.label === 'edges' ? call.args[at++]!.value : undefined
  if (at !== call.args.length) return undefined
  if (edges) {
    const masks = edges.kind === 'arrayLiteral' ? edges.elements.map(edgeMask) : [edgeMask(edges)]
    if (!masks.length || masks.includes(0)) return undefined
    mask = masks.reduce((all, one) => all | one, 0)
  }
  return EDGE_OPTIONS[mask]
}

/**
 * A view's Safe area (Wave 4c): Respect, or Extend to top, to bottom or all, under the status
 * bar and the home indicator, as `.ignoresSafeArea` writes it, which Respect takes away. A new
 * one goes after the view's last modifier, so the view as it is drawn extends. Any other way
 * of writing it, a region such as the keyboard, edges no option is or the older
 * `.edgesIgnoringSafeArea`, is shown as written, read only.
 */
export function safeAreaControl(expr: Expr, base: CallExpr, modifiers: readonly CallExpr[], text: string, target: number, appendable: boolean, add: AddControl): void {
  const calls = modifiers.filter(m => modifierName(m) === 'ignoresSafeArea' || modifierName(m) === 'edgesIgnoringSafeArea'), call = calls[0]
  const end = modifiers.at(-1)?.span.end ?? base.span.end, none = () => ({ start: end, end, text: '' })
  const at = call && ownSpan(call)
  const current = !call ? 'Respect' : calls.length === 1 && modifierName(call) === 'ignoresSafeArea' ? safeAreaOf(call) : undefined
  if (!current) return add('safeArea', 'Safe area', 'text', `.${text.slice(at!.start, at!.end)}`, none, undefined, undefined, undefined, IN_CODE, at, 'This view reaches under the bars in a way Safe area doesn’t set. Change it in Code.')
  const setting = modifierSetting(expr, text, 'ignoresSafeArea', call, modifiers.at(-1) ?? base, none)
  add('safeArea', 'Safe area', 'select', current, v => setting.write(SAFE_AREAS[v] ?? null), SAFE_AREA_OPTIONS, undefined, undefined, 'Extend reaches under the status bar or the home indicator, to the screen’s edge.', at,
    target < 14 ? needsNewerIOS(14, 'set') : !call && !appendable ? OWN_MODIFIER : undefined, v => setting.problem(SAFE_AREAS[v] ?? null))
}

const DOTS = ['Automatic', 'Always', 'Never']
/** A Dots background as it is written, with no space (Wave 4c): `DOTS_BACKGROUND`'s own. */
const BACKGROUND_WRITTEN = DOTS_BACKGROUND.slice(1).replace(/\s/g, '')

/**
 * The nearest view around `node`, in the body it is written in, with `modifier` switched on
 * (Wave 4c): an environment value such as `.indexViewStyle`, which the views inside it take
 * unless they set their own. Several names are one value written either way, as
 * `foregroundStyle` and `foregroundColor` are.
 */
export function setAround(node: AuthoringNode, byId: (id: string | undefined) => AuthoringNode | undefined, modifier: string | readonly string[]): { readonly view: AuthoringNode; readonly modifier: AuthoringModifier } | undefined {
  const names: readonly string[] = typeof modifier === 'string' ? [modifier] : modifier
  for (let at = byId(node.parentId); at && at.kind !== 'definition'; at = byId(at.parentId)) {
    const found = at.modifiers?.find(m => names.includes(m.name) && m.enabled !== false)
    if (found) return { view: at, modifier: found }
  }
  return undefined
}

/** Why a field shows what a view around it sets, read only, naming it as Layers does: a VStack is a Column. */
export function setThere(view: AuthoringNode): string {
  const name = stackLayoutOf(view.name) ?? view.name
  return `Set on the ${isContainerLayout(name) ? CONTAINER_WORDS[name] : name} around it. Change it there.`
}

/**
 * A carousel's Page dots and Dots background (Wave 4c), on a TabView whose pages are swiped
 * through: `.tabViewStyle(.page)`, with `indexDisplayMode:` saying when its dots show, and
 * `.indexViewStyle(.page(backgroundDisplayMode: .always))` putting a background behind them.
 * Automatic is the style with nothing in its parentheses. A TabView of tabs has neither, and
 * any other spelling is shown as written, read only. A background it takes from a view around
 * it (`around`) is shown as that view sets it, read only, so none is written over it.
 */
export function pagerControls(expr: Expr, modifiers: readonly CallExpr[], text: string, target: number, add: AddControl, around?: ReturnType<typeof setAround>): void {
  const styles = modifiers.filter(m => modifierName(m) === 'tabViewStyle'), style = styles[0]
  if (!style || !isPageStyle(style.args)) return
  const value = style.args[0]!.value, written = text.slice(value.span.start, value.span.end), plain = written.replace(/\s/g, '')
  const gate = target < 14 ? needsNewerIOS(14, 'set') : undefined
  const mode = styles.length === 1 ? plain === '.page' ? 'automatic' : /^\.page\(indexDisplayMode:\.(automatic|always|never)\)$/.exec(plain)?.[1] : undefined
  if (!mode) add('pager:dots', 'Page dots', 'text', written, () => ({ start: value.span.start, end: value.span.end, text: written }), undefined, undefined, undefined, IN_CODE, value.span, 'These dots are set in a way Page dots doesn’t write. Change them in Code.')
  else add('pager:dots', 'Page dots', 'select', mode[0]!.toUpperCase() + mode.slice(1), v => ({ start: value.span.start, end: value.span.end, text: v === 'Automatic' ? '.page' : `.page(indexDisplayMode: .${v.toLowerCase()})` }), DOTS, undefined, undefined, 'Automatic shows them when there is more than one page.', value.span, gate)
  const backgrounds = modifiers.filter(m => modifierName(m) === 'indexViewStyle'), background = backgrounds[0]
  const description = 'A rounded backing behind the dots, so they show over any page.', none = () => ({ start: style.span.end, end: style.span.end, text: '' })
  if (!background && around) {
    const inherited = around.modifier.expression.replace(/^\./, '').replace(/\s/g, '') === BACKGROUND_WRITTEN
    const reason = setThere(around.view)
    return add('pager:background', 'Dots background', inherited ? 'toggle' : 'text', inherited ? 'true' : around.modifier.expression, none, undefined, undefined, undefined, inherited ? description : IN_CODE, around.modifier.source, reason)
  }
  const at = background && ownSpan(background), own = at ? text.slice(at.start, at.end) : ''
  if (backgrounds.length > 1 || at && own.replace(/\s/g, '') !== BACKGROUND_WRITTEN) return add('pager:background', 'Dots background', 'text', `.${own}`, none, undefined, undefined, undefined, IN_CODE, at, 'This background is set in a way Dots background doesn’t write. Change it in Code.')
  // Written straight after the style, which it goes with, rather than after the view's last modifier.
  const setting = modifierSetting(expr, text, 'indexViewStyle', background, style, none)
  const args = (v: string) => v === 'true' ? DOTS_BACKGROUND.slice('.indexViewStyle'.length) : null
  add('pager:background', 'Dots background', 'toggle', String(!!background), v => setting.write(args(v)), undefined, undefined, undefined, description, at, gate, v => setting.problem(args(v)))
}
