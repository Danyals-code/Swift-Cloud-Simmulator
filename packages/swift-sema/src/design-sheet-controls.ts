import type { AuthoringNode } from '@studio/shared'
import { forEachChild, type CallExpr, type Expr, type Node, type Stmt, type StructDecl } from '@studio/swift-syntax'
import { SYSTEM_COLORS, viewCallChain, type ControlKind } from './design-controls'
import { MATERIALS, materialThickness, type AddControl } from './design-advanced-controls'
import { modifierSegment } from './authoring-modifiers'

/** What a sheet's settings are read from and written to (Wave 4b): the view a sheet shows, as `node.presented` says. */
export interface SheetContext {
  readonly node: AuthoringNode
  /** The view's whole expression, its call and its modifiers in its file's `text`. */
  readonly expr: Expr
  readonly base: CallExpr
  readonly modifiers: readonly CallExpr[]
  readonly text: string
  readonly target: number
  readonly colors: readonly string[]
  /** Whether a modifier can be added after the view's last, which a modifier of the project's own may not take. */
  readonly appendable: boolean
  /** The project's own view of a name, whose body is drawn where it is called. */
  readonly structNamed: (name: string) => StructDecl | undefined
  /** A file's text, where a view of the project's own is written. */
  readonly textOf: (file: string) => string
}

/** Each Height, as `.presentationDetents` writes it. */
const HEIGHTS: Readonly<Record<string, string>> = { Large: '[.large]', Medium: '[.medium]', 'Medium and large': '[.medium, .large]', 'Fixed height': '[.height(300)]' }
const GRABBERS = ['Automatic', 'Visible', 'Hidden']
/** The modifiers that open a page of their own, whose views set that page's settings, not this one's. */
const OTHER_PAGES: ReadonlySet<string> = new Set(['sheet', 'popover', 'fullScreenCover', 'navigationDestination', 'alert', 'confirmationDialog'])

const memberOf = (call: CallExpr) => call.callee.kind === 'memberAccess' ? call.callee.member : ''

/** A sheet setting's modifier written further in than the shown view's call, and whether the canvas certainly draws what it sets. */
interface Inside { readonly call: CallExpr; readonly own: boolean; readonly certain: boolean }

/** The modifiers a sheet's settings are written with. */
const SHEET_MODIFIERS: ReadonlySet<string> = new Set(['presentationDetents', 'presentationDragIndicator', 'presentationBackground', 'presentationCornerRadius', 'interactiveDismissDisabled'])

/**
 * Each sheet setting's modifier the sheet's views write besides the shown view's call, by its
 * name (Wave 4b): in its content, and in the body of a view of the project's own it shows (`own`
 * for the shown view's own). The canvas reads the first it draws, so one is `certain` where it
 * is drawn whatever the code works out: not in a condition, a row, a helper, or a modifier's own
 * views. The pages the sheet opens set their own.
 */
function writtenInside(context: SheetContext): ReadonlyMap<string, readonly Inside[]> {
  const found = new Map<string, Inside[]>(), seen = new Set<string>()
  const record = (call: CallExpr, own: boolean, certain: boolean) => {
    const name = memberOf(call)
    if (!SHEET_MODIFIERS.has(name)) return
    const calls = found.get(name)
    if (calls) calls.push({ call, own, certain })
    else found.set(name, [{ call, own, certain }])
  }
  /** A view's struct: its body drawn as its content, anything else it declares only maybe. */
  const declared = (struct: StructDecl, own: boolean, certain: boolean) => {
    if (seen.has(struct.name)) return
    seen.add(struct.name)
    for (const member of struct.members) {
      if (member.kind === 'varDecl' && member.name === 'body' && member.accessor) statements(member.accessor.statements, own, certain)
      else loose(member, own)
    }
  }
  /** What a view's call draws besides its modifiers: a view of the project's own's body, and its content. */
  const content = (base: CallExpr, own: boolean, certain: boolean) => {
    record(base, own, certain)
    const struct = base.callee.kind === 'identifier' ? context.structNamed(base.callee.name) : undefined
    if (struct) declared(struct, own, certain)
    for (const arg of base.args) loose(arg.value, own)
    const closure = base.trailingClosure
    if (closure) statements(closure.body.statements, own, certain && !closure.params.length)
  }
  const statements = (written: readonly Stmt[], own: boolean, certain: boolean) => {
    for (const stmt of written) {
      const value = stmt.kind === 'exprStmt' ? stmt.expression : stmt.kind === 'returnStmt' ? stmt.value : undefined
      if (value) view(value, own, certain)
      else loose(stmt, own)
    }
  }
  /** What a modifier holds: its own views, as a background's, which the canvas doesn't read a sheet's settings from. */
  const held = (call: CallExpr, own: boolean) => {
    if (OTHER_PAGES.has(memberOf(call))) return
    for (const arg of call.args) loose(arg.value, own)
    if (call.trailingClosure) loose(call.trailingClosure, own)
  }
  const view = (expr: Expr, own: boolean, certain: boolean) => {
    const chain = viewCallChain(expr)
    if (!chain) return loose(expr, own)
    for (const call of chain.modifiers) { record(call, own, certain); held(call, own) }
    content(chain.base, own, certain)
  }
  /** Anything else, where a setting found is only maybe drawn. */
  const loose = (node: Node, own: boolean): void => {
    if (node.kind === 'call') {
      record(node, own, false)
      if (OTHER_PAGES.has(memberOf(node))) { if (node.callee.kind === 'memberAccess' && node.callee.base) loose(node.callee.base, own); return }
      const struct = node.callee.kind === 'identifier' ? context.structNamed(node.callee.name) : undefined
      if (struct) declared(struct, own, false)
    }
    forEachChild(node, child => loose(child, own))
  }
  // The shown view's own call is the sheet's; what is inside it, and in its own code, is further in.
  for (const call of context.modifiers) held(call, false)
  const struct = context.base.callee.kind === 'identifier' ? context.structNamed(context.base.callee.name) : undefined
  if (struct) declared(struct, true, true)
  for (const arg of context.base.args) loose(arg.value, false)
  const closure = context.base.trailingClosure
  if (closure) statements(closure.body.statements, false, !closure.params.length)
  return found
}

/**
 * A sheet's settings (Wave 4b), on the view it shows (`node.presented`): Height, Grabber,
 * Background, Corner radius and Swipe to close, each read from its modifier on that view's
 * call and written there, never in the view's own code. One missing reads as iOS draws the
 * sheet without it, and is added at the end of the chain; Default and Swipe to close take
 * theirs away, as `modifier-remove` does. A full-screen cover has a Background alone.
 *
 * A value worked out in code is shown as written, read only. One set further in, by a view
 * inside it or in the view's own code, is shown as the canvas draws it, read only: as written
 * there when that is the one place, and with no value where the canvas's can't be read exactly.
 */
export function sheetControls(context: SheetContext, add: AddControl): void {
  const { node, expr, base, modifiers, text, target, colors, appendable } = context
  const written = (value: Expr) => (value.span.file === node.source.file ? text : context.textOf(value.span.file)).slice(value.span.start, value.span.end)
  const last = modifiers.at(-1), end = last?.span.end ?? base.span.end
  // On a line of its own where the view's last modifier is on one.
  const lined = last?.callee.kind === 'memberAccess' && text.slice(last.callee.base?.span.end ?? end, text.lastIndexOf('.', last.callee.memberSpan.start)).includes('\n')
  const append = (modifier: string) => ({ start: end, end, text: lined ? `\n${/^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', last!.callee.kind === 'memberAccess' ? last!.callee.memberSpan.start : end) + 1))![0]}${modifier}` : modifier })
  const none = () => ({ start: end, end, text: '' })
  const insideAll = writtenInside(context)
  /** The value a call writes, by `read` from its one unlabelled argument; undefined for anything else. */
  const valueOf = (call: CallExpr, read: (arg: Expr | undefined) => string | undefined) => call.args.length <= 1 && !call.args[0]?.label ? read(call.args[0]?.value) : undefined
  /** What a call writes, as the code writes it. */
  const asWritten = (call: CallExpr) => { const arg = call.args[0]?.value; return arg ? written(arg) : '' }
  /**
   * One setting: its modifier `modifier`, read by `read` from its one argument, or its absence,
   * as `none`; `write` gives the modifier's Swift for a value, or null to take it away. Gives
   * the call the canvas draws its value from, when it can be read exactly.
   */
  const setting = (id: string, label: string, modifier: string, minimum: number, what: string, kind: ControlKind, absent: string, read: (arg: Expr | undefined) => string | undefined, write: (value: string) => string | null, options?: readonly string[], description?: string): { call: CallExpr; reason?: string } | undefined => {
    const calls = modifiers.filter(m => memberOf(m) === modifier), call = calls[0]
    const inside = insideAll.get(modifier)
    if (inside) {
      const one = !call && inside.length === 1 && inside[0]!.certain ? inside[0]! : undefined
      if (!one) return void add(id, label, 'text', '', none, undefined, undefined, undefined, description, undefined, `This sheet’s ${what} is set inside it where it can’t be read exactly. Change it in Code.`)
      const reason = one.own ? `${node.name} sets this in its own code. Change it there, in Code.` : 'A view inside it sets this. Change it there.'
      const shown = valueOf(one.call, read)
      add(id, label, shown === undefined ? 'text' : kind, shown ?? asWritten(one.call), none, shown === undefined ? undefined : options, undefined, undefined, description, one.call.span, reason)
      return { call: one.call, reason }
    }
    const shown = !call ? absent : calls.length === 1 ? valueOf(call, read) : undefined
    const gate = target < minimum ? `Needs iOS ${minimum} or newer. Change the deployment target to set it.` : undefined
    if (shown === undefined) return void add(id, label, 'text', asWritten(call!) || written(call!), none, undefined, undefined, undefined, 'Shown as the code writes it.', call!.span, `This sheet’s ${what} is set in code. Change it in Code.`)
    const removal = call && modifierSegment(expr, text, call)
    add(id, label, kind, shown, v => {
      const swift = write(v)
      // One that can't be taken away cleanly is refused by `problem` below, so this writes nothing.
      if (swift === null) return removal ? { ...removal, text: '' } : none()
      return call ? { start: call.callee.kind === 'memberAccess' ? call.callee.memberSpan.end : call.span.start, end: call.span.end, text: swift.slice(modifier.length + 1) } : append(swift)
    }, options, kind === 'pt' ? 0 : undefined, undefined, description, call?.span, gate ?? (!call && !appendable ? 'This view has a modifier of the project’s own. Add this in Code.' : undefined),
    v => write(v) === null && call && !removal ? 'A note or an #if in this view’s modifiers keeps this setting where it is. Change it in Code.' : null)
    return call && { call }
  }
  if (node.presented === 'sheet') {
    const height = (arg: Expr | undefined) => {
      if (!arg) return 'Large'
      const detents = arg.kind === 'arrayLiteral' ? arg.elements.map(e => written(e).replace(/\s|PresentationDetent/g, '')).sort().join() : ''
      return detents === '.large' ? 'Large' : detents === '.medium' ? 'Medium' : detents === '.large,.medium' ? 'Medium and large' : /^\.height\(\d+(?:\.\d+)?\)$/.test(detents) ? 'Fixed height' : undefined
    }
    const drawn = setting('sheet:height', 'Height', 'presentationDetents', 16, 'height', 'select', 'Large', height, v => `.presentationDetents(${HEIGHTS[v]})`, Object.keys(HEIGHTS), 'Medium is about half the screen. Large covers it, leaving the screen behind just showing.')
    const fixed = drawn?.call.args[0]?.value
    const amount = fixed?.kind === 'arrayLiteral' && fixed.elements.length === 1 && fixed.elements[0]!.kind === 'call' ? fixed.elements[0]!.args[0]?.value : undefined
    if (amount && valueOf(drawn!.call, height) === 'Fixed height') add('sheet:fixedHeight', 'Fixed height', 'pt', written(amount), v => ({ ...amount.span, text: String(Number(v)) }), undefined, 1, undefined, undefined, amount.span, drawn!.reason)
    setting('sheet:grabber', 'Grabber', 'presentationDragIndicator', 16, 'grabber', 'select', 'Automatic', arg => GRABBERS.find(g => arg && written(arg).replace(/\s|Visibility/g, '') === `.${g.toLowerCase()}`), v => `.presentationDragIndicator(.${v.toLowerCase()})`, GRABBERS, 'Automatic shows it when the sheet has more than one height.')
  }
  const materials = MATERIALS.map(thickness => `${thickness}Material`)
  setting('sheet:background', 'Background', 'presentationBackground', 16.4, 'background', 'select', 'Default', arg => {
    const thickness = arg && materialThickness(arg)
    if (thickness) return `${thickness}Material`
    const color = arg && /^(?:Color)?\.(\w+)$|^Color\(\.(\w+)\)$/.exec(written(arg).replace(/\s/g, ''))
    const value = color?.[1] ?? color?.[2]
    return value && colors.includes(value) ? value : undefined
  }, v => v === 'Default' ? null : `.presentationBackground(${materials.includes(v) ? `.${v}` : SYSTEM_COLORS.includes(v) ? `Color(.${v})` : `Color.${v}`})`, ['Default', ...colors, ...materials])
  if (node.presented === 'cover') return
  setting('sheet:radius', 'Corner radius', 'presentationCornerRadius', 16.4, 'corner radius', 'pt', '', arg => arg && /^\d+(?:\.\d+)?$/.test(written(arg)) ? written(arg) : undefined, v => `.presentationCornerRadius(${Number(v)})`)
  setting('sheet:swipe', 'Swipe to close', 'interactiveDismissDisabled', 15, 'swipe to close', 'toggle', 'true', arg => !arg || written(arg) === 'true' ? 'false' : written(arg) === 'false' ? 'true' : undefined, v => v === 'true' ? null : '.interactiveDismissDisabled()', undefined, 'Off keeps the sheet open when it is swiped down.')
}
