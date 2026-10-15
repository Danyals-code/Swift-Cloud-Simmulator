import { MODIFIER_SLOTS, PRESENTATION_PARTS, TOOLBAR_PLACEMENT_WORDS, authoringCapability, type AuthoringNode, type ToolbarPlacement } from '@studio/shared'
import { Lexer, type CallExpr, type Expr } from '@studio/swift-syntax'
import { buttonLabel, buttonRole, literalText, swiftString, symbolNameProblem, viewCallChain, type ControlKind, type ControlRecipe } from './design-controls'
import { type AddControl, type ReplaceControl } from './design-advanced-controls'
import { indentAt } from './authoring-context'

type Insert = (call: CallExpr, label: string | null, value: string, order?: readonly (string | null)[]) => ReturnType<ControlRecipe['patch']>
type Param = (call: CallExpr, id: string, title: string, label: string | null, kind: ControlKind, fallback: string, options?: readonly string[], min?: number, max?: number, prefix?: string, order?: readonly (string | null)[]) => void
const anchors = ['center', 'topLeading', 'top', 'topTrailing', 'leading', 'trailing', 'bottomLeading', 'bottom', 'bottomTrailing']
const vertical = ['top', 'center', 'bottom', 'firstTextBaseline', 'lastTextBaseline']
const gradients = ['LinearGradient', 'RadialGradient', 'AngularGradient']
const literalNumber = (expr: Expr, text: string) => ['integerLiteral', 'floatLiteral', 'unary'].includes(expr.kind) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.slice(expr.span.start, expr.span.end)) ? Number(text.slice(expr.span.start, expr.span.end)) : undefined

/** Each placement Bars sets, as Swift writes it (Wave 4b). `navigationBarLeading` and its pair are older names for the bar's sides. */
export const TOOLBAR_PLACEMENTS: Readonly<Record<ToolbarPlacement, string>> = { leading: 'topBarLeading', trailing: 'topBarTrailing', principal: 'principal', bottom: 'bottomBar', automatic: 'automatic' }
const PLACEMENT_NAMES = Object.keys(TOOLBAR_PLACEMENTS) as ToolbarPlacement[]

/** A toolbar item's placement from the Swift of its `placement:`, Automatic when it has none; null for one Bars doesn't set. */
export function toolbarPlacement(written: string | undefined): ToolbarPlacement | null {
  if (written === undefined) return 'automatic'
  const member = /^(?:ToolbarItemPlacement)?\.(\w+)$/.exec(written.replace(/\s/g, ''))?.[1]?.replace(/^navigationBar(?=Leading$|Trailing$)/, 'topBar')
  return PLACEMENT_NAMES.find(placement => TOOLBAR_PLACEMENTS[placement] === member) ?? null
}

/**
 * A toolbar item's Placement (Wave 4b): Leading, Trailing, Title, Bottom or Automatic, written
 * as its `placement:`, which Automatic takes away when it is all its parentheses hold. Any
 * other placement is shown as written, read only.
 */
export function toolbarItemControls(base: CallExpr, text: string, target: number, add: AddControl): void {
  const content = base.trailingClosure
  if (target < 14 || !content || base.args.some(a => a.label !== 'id' && a.label !== 'placement')) return
  const arg = base.args.find(a => a.label === 'placement'), written = arg && text.slice(arg.value.span.start, arg.value.span.end)
  const current = toolbarPlacement(written)
  if (!current) return add('toolbar:placement', 'Placement', 'text', written!, () => ({ ...arg!.value.span, text: written! }), undefined, undefined, undefined, 'Shown as the code writes it.', arg!.value.span, 'Bars sets Leading, Trailing, Title, Bottom and Automatic. Change this placement in Code.')
  const close = Lexer.tokenize(text.slice(base.callee.span.end, content.span.start), base.span.file).tokens.filter(t => t.text === ')').at(-1)
  const parens = close && base.callee.span.end + close.span.start
  add('toolbar:placement', 'Placement', 'select', TOOLBAR_PLACEMENT_WORDS[current], v => {
    const value = `.${TOOLBAR_PLACEMENTS[PLACEMENT_NAMES.find(placement => TOOLBAR_PLACEMENT_WORDS[placement] === v)!]}`
    if (arg && v === 'Automatic' && base.args.length === 1 && parens !== undefined) return { start: base.callee.span.end, end: parens + 1, text: '' }
    if (arg) return { ...arg.value.span, text: value }
    const last = base.args.at(-1)
    if (last) return { start: last.span.end, end: last.span.end, text: `, placement: ${value}` }
    return parens === undefined ? { start: base.callee.span.end, end: base.callee.span.end, text: `(placement: ${value})` } : { start: parens, end: parens, text: `placement: ${value}` }
  }, PLACEMENT_NAMES.map(placement => TOOLBAR_PLACEMENT_WORDS[placement]), undefined, undefined, 'Title puts it in place of the screen’s title; Bottom, in a bar at the foot of the screen.', arg?.value.span)
}

/** A Button's Icon takes a well-formed symbol name, or nothing, which takes it away (Wave 4a). */
const iconProblem = (value: string) => value ? symbolNameProblem(value) : null

/**
 * Whether a Button is one of an alert's or a dialog's actions (Wave 4a), which iOS draws as
 * its words alone. `byId` finds a layer.
 */
function presentationAction(node: AuthoringNode, byId: (id: string | undefined) => AuthoringNode | undefined): boolean {
  const slot = byId(node.parentId), presentation = slot?.kind === 'branch' && slot.name === PRESENTATION_PARTS.actions ? byId(slot.parentId) : undefined
  return presentation?.kind === 'branch' && (presentation.name === MODIFIER_SLOTS.alert || presentation.name === MODIFIER_SLOTS.confirmationDialog)
}

/**
 * Constructor and overload controls edit literal leaves, preserving their bindings and neighbors.
 * `byId` finds the layers around the view, which say whether a Button is an alert's.
 */
export function objectControls(node: AuthoringNode, base: CallExpr, modifiers: readonly CallExpr[], text: string, target: number, colors: readonly string[], add: AddControl, replace: ReplaceControl, param: Param, insert: Insert, byId?: (id: string | undefined) => AuthoringNode | undefined): void {
  const named = (call: CallExpr, label: string | null) => call.args.find(a => a.label === label)?.value
  const uncommented = (expr: Expr) => !/\/\/|\/\*/.test(text.slice(expr.span.start, expr.span.end))
  const name = (call: CallExpr) => call.callee.kind === 'identifier' ? call.callee.name : call.callee.kind === 'memberAccess' ? call.callee.member : ''
  function bounds(call: CallExpr, id: string, fallbackMax = 1) {
    const range = named(call, 'in')
    if (range?.kind === 'binary' && range.operator === '...') {
      const lower = literalNumber(range.left, text), upper = literalNumber(range.right, text)
      replace(`${id}:min`, 'Minimum', range.left, 'number', undefined, undefined, upper)
      replace(`${id}:max`, 'Maximum', range.right, 'number', undefined, lower)
    } else if (!range) {
      add(`${id}:min`, 'Minimum', 'number', '0', v => insert(call, 'in', `${v}...${fallbackMax}`, [null, 'value', 'in', 'step']), undefined, undefined, fallbackMax)
      add(`${id}:max`, 'Maximum', 'number', String(fallbackMax), v => insert(call, 'in', `0...${v}`, [null, 'value', 'in', 'step']), undefined, 0)
    }
  }
  function gradientControls(call: CallExpr, id: string, all: boolean) {
    for (const arg of call.args) {
      if (arg.label === 'gradient' && arg.value.kind === 'call' && name(arg.value) === 'Gradient') gradientControls(arg.value, id + ':gradient', true)
      if (arg.label === 'colors' && arg.value.kind === 'arrayLiteral' && all) arg.value.elements.forEach((color, index) => replace(`${id}:color:${index}`, `Color ${index + 1}`, color, 'select', colors, undefined, undefined, 'Color.'))
      if (arg.label === 'stops' && arg.value.kind === 'arrayLiteral') arg.value.elements.forEach((stop, index) => {
        if (stop.kind !== 'call' || !['init', 'Stop'].includes(name(stop))) return
        const color = named(stop, 'color'), location = named(stop, 'location')
        if (color) replace(`${id}:stop:${index}:color`, `Stop ${index + 1} color`, color, 'select', colors, undefined, undefined, 'Color.')
        if (location) {
          const stops = arg.value.kind === 'arrayLiteral' ? arg.value.elements : []
          const neighbor = (i: number) => { const item = stops[i]; const value = item?.kind === 'call' ? named(item, 'location') : undefined; return value ? literalNumber(value, text) : undefined }
          replace(`${id}:stop:${index}:location`, `Stop ${index + 1} position`, location, 'number', undefined, neighbor(index - 1) ?? 0, neighbor(index + 1) ?? 1)
        }
      })
      if (['startPoint', 'endPoint', 'center'].includes(arg.label ?? '')) {
        const title = arg.label === 'startPoint' ? 'Start point' : arg.label === 'endPoint' ? 'End point' : 'Center'
        if (all) replace(`${id}:${arg.label}`, title, arg.value, 'select', anchors)
        if (arg.value.kind === 'call' && ['UnitPoint', 'init'].includes(name(arg.value))) for (const dimension of arg.value.args) {
          if (['x', 'y'].includes(dimension.label ?? '')) replace(`${id}:${arg.label}:${dimension.label}`, `${title} ${dimension.label}`, dimension.value, 'number')
        }
      }
      if (all && ['startRadius', 'endRadius'].includes(arg.label ?? '')) replace(`${id}:${arg.label}`, arg.label === 'startRadius' ? 'Start radius' : 'End radius', arg.value, 'pt', undefined, 0)
      if (['angle', 'startAngle', 'endAngle'].includes(arg.label ?? '') && arg.value.kind === 'call' && ['degrees', 'radians', 'Angle'].includes(name(arg.value))) {
        const angle = arg.value.args[0]
        const unit = angle?.label ?? name(arg.value)
        if (angle) replace(`${id}:${arg.label}`, `${arg.label === 'startAngle' ? 'Start angle' : arg.label === 'endAngle' ? 'End angle' : 'Angle'} (${unit})`, angle.value, unit === 'degrees' ? '°' : 'number')
      }
    }
  }
  function dateEndpoint(expr: Expr | undefined, side: 'from' | 'through', other: Expr | undefined, range: Expr | undefined) {
    const timestamp = (e: Expr | undefined): number | undefined => e?.kind === 'call' && name(e) === 'Date' && named(e, 'timeIntervalSince1970') ? literalNumber(named(e, 'timeIntervalSince1970')!, text) : undefined
    const seconds = timestamp(expr), opposite = timestamp(other)
    if (expr && (seconds === undefined || seconds < -62135596800 || seconds > 253402300799)) return
    const initial = seconds === undefined ? '' : new Date(seconds * 1000).toISOString().slice(0, 19)
    add(`date:${side}`, side === 'from' ? 'Earliest date (UTC)' : 'Latest date (UTC)', 'text', initial, value => {
      const swift = `Date(timeIntervalSince1970: ${Date.parse(value + 'Z') / 1000})`
      if (expr?.kind === 'call') return { ...named(expr, 'timeIntervalSince1970')!.span, text: String(Date.parse(value + 'Z') / 1000) }
      if (range?.kind === 'unary') return { ...range.span, text: side === 'from' ? `${swift}...${text.slice(range.operand.span.start, range.operand.span.end)}` : `${text.slice(range.operand.span.start, range.operand.span.end)}...${swift}` }
      return insert(base, 'in', side === 'from' ? `${swift}...` : `...${swift}`, [null, 'selection', 'in', 'displayedComponents'])
    }, undefined, side === 'through' ? opposite : undefined, side === 'from' ? opposite : undefined, 'Choose a fixed boundary in UTC. Dynamic date expressions remain controlled by code.')
  }
  const capability = authoringCapability(node.name, 'view', base.args.map(a => a.label))
  if (node.kind !== 'component' && capability && target >= Number.parseFloat(capability.minimumIOS)) {
    if (['Slider', 'Stepper', 'Gauge'].includes(node.name)) bounds(base, node.name.toLowerCase(), node.name === 'Stepper' ? 10 : 1)
    if (node.name === 'Slider' && !named(base, 'in')) add('range:step', 'Step', 'number', '', v => insert(base, 'in', `0...1, step: ${v}`, ['value', 'in', 'step']), undefined, 0.000001)
    else if (['Slider', 'Stepper'].includes(node.name)) param(base, 'range:step', 'Step', 'step', 'number', node.name === 'Stepper' ? '1' : '', undefined, 0.000001, undefined, '.', [null, 'value', 'in', 'step'])
    if (node.name === 'ProgressView' && named(base, 'value')) {
      const current = literalNumber(named(base, 'value')!, text)
      param(base, 'progress:total', 'Total', 'total', 'number', '1', undefined, Math.max(0.000001, current ?? 0))
    }
    if (node.name === 'Gauge' && named(base, 'value')) {
      const range = named(base, 'in')
      replace('gauge:value', 'Value', named(base, 'value')!, 'number', undefined, range?.kind === 'binary' ? literalNumber(range.left, text) : 0, range?.kind === 'binary' ? literalNumber(range.right, text) : 1)
    }
    if (node.name === 'Grid') {
      const order = ['alignment', 'horizontalSpacing', 'verticalSpacing']
      param(base, 'grid:alignment', 'Alignment', 'alignment', 'select', 'center', anchors, undefined, undefined, '.', order)
      param(base, 'grid:horizontalSpacing', 'Horizontal spacing', 'horizontalSpacing', 'pt', '', undefined, 0, undefined, '.', order)
      param(base, 'grid:verticalSpacing', 'Vertical spacing', 'verticalSpacing', 'pt', '', undefined, 0, undefined, '.', order)
    }
    if (node.name === 'GridRow') param(base, 'gridrow:alignment', 'Vertical alignment', 'alignment', 'select', 'center', vertical)
    if (node.name === 'ColorPicker') param(base, 'color:opacity', 'Supports opacity', 'supportsOpacity', 'toggle', 'true')
    if (node.name === 'DatePicker') {
      const components = named(base, 'displayedComponents')
      const componentName = (e: Expr) => e.kind === 'memberAccess' && (!e.base || e.base.kind === 'identifier' && e.base.name === 'DatePickerComponents') ? e.member : ''
      const choices = components ? (components.kind === 'arrayLiteral' ? components.elements : [components]).map(componentName) : ['date', 'hourAndMinute']
      if ((!components || uncommented(components)) && choices.length && choices.every(c => ['date', 'hourAndMinute'].includes(c))) add('date:components', 'Components', 'select', choices.includes('date') ? choices.includes('hourAndMinute') ? 'Date and time' : 'Date' : 'Time', v => {
        const value = v === 'Date' ? '.date' : v === 'Time' ? '.hourAndMinute' : '[.date, .hourAndMinute]'
        return components ? { ...components.span, text: value } : insert(base, 'displayedComponents', value)
      }, ['Date', 'Time', 'Date and time'])
      const range = named(base, 'in')
      if (!range || range.kind === 'binary' && range.operator === '...' || range.kind === 'unary' && ['...', 'partialFrom'].includes(range.operator)) {
        const from = range?.kind === 'binary' ? range.left : range?.kind === 'unary' && range.operator === 'partialFrom' ? range.operand : undefined
        const through = range?.kind === 'binary' ? range.right : range?.kind === 'unary' && range.operator === '...' ? range.operand : undefined
        dateEndpoint(from, 'from', through, range); dateEndpoint(through, 'through', from, range)
      }
    }
    if (node.name === 'ContentUnavailableView') {
      const symbol = named(base, 'systemImage'), description = named(base, 'description')
      if (symbol) replace('empty:symbol', 'System symbol', symbol, 'text')
      if (description?.kind === 'call' && name(description) === 'Text' && description.args[0]) replace('empty:description', 'Description', description.args[0].value, 'text')
      else if (!description) add('empty:description', 'Description', 'text', '', v => insert(base, 'description', `Text(${swiftString(v)})`))
    }
    if (gradients.includes(node.name)) gradientControls(base, 'gradient', true)
    if (node.name === 'Button') buttonControls()
    if (node.name === 'Section') sectionControls()
  }
  /** The words of a string with no values or comments in it. */
  function wordsOf(e: Expr): string | undefined {
    return uncommented(e) ? literalText(e) : undefined
  }
  /** A value worked out in code, shown as the code writes it, read only. */
  function shownAsWritten(id: string, label: string, value: Expr): void {
    const written = text.slice(value.span.start, value.span.end)
    add(id, label, 'text', written, () => ({ ...value.span, text: written }), undefined, undefined, undefined, 'Shown as the code writes it.', value.span, 'This value is worked out in code. Change it in Code.')
  }
  /** Takes an argument out of a call with what joins it to the others: its parentheses, when it is the only one in them. */
  function dropArgument(call: CallExpr, arg: CallExpr['args'][number]): ReturnType<ControlRecipe['patch']> {
    const action = call.trailingClosure?.span.start ?? call.span.end, after = arg.span.start > action
    const list = call.args.filter(a => a.span.start > action === after), at = list.indexOf(arg)
    if (after || at > 0) return { start: at > 0 ? list[at - 1]!.span.end : call.trailingClosure!.span.end, end: arg.span.end, text: '' }
    if (list[at + 1]) return { start: arg.span.start, end: list[at + 1]!.span.start, text: '' }
    return { start: call.callee.span.end, end: text.indexOf(')', arg.span.end) + 1, text: '' }
  }
  /**
   * A Section's Header and Footer as text (Wave 4a): its title, or a header or footer that is one
   * Text, as an argument or a closure, edited in place, and taken away when emptied. A title
   * chosen by a condition offers each of its words, as any title does. One that is more than a
   * Text is shown read only. There is no initializer for a title and a footer, so a footer added
   * to a titled section writes both as closures.
   */
  function sectionControls() {
    const content = base.trailingClosure
    if (!content) return
    const { indent, unit } = indentAt(text, base.span.start)
    const closure = (view: string) => `{\n${indent}${unit}${view}\n${indent}}`
    const title = base.args[0]?.label === null ? base.args[0] : undefined
    const header = base.args.find(a => a.label === 'header'), footer = base.args.find(a => a.label === 'footer')
    /** The one Text a part is, written as a view or as a closure that returns it, and its words; undefined for anything else. */
    const single = (part: Expr) => {
      const [only, more] = part.kind === 'closure' ? part.body.statements : []
      const view = part.kind !== 'closure' ? part : !more && only?.kind === 'exprStmt' ? only.expression : undefined
      const call = view && viewCallChain(view)?.base
      const literal = call && name(call) === 'Text' && call.args.length === 1 && call.args[0]!.label === null ? call.args[0]!.value : undefined
      const words = literal && wordsOf(literal)
      return words !== undefined ? { literal: literal!, words } : undefined
    }
    const part = (id: string, label: string, written: CallExpr['args'][number] | undefined, added: (words: string) => ReturnType<ControlRecipe['patch']>) => {
      const chosen = written && written === title && written.value.kind === 'ternary' ? written.value : undefined
      if (chosen && (literalText(chosen.then) !== undefined || literalText(chosen.else) !== undefined)) return replace(id, label, chosen, 'text')
      const found = written && (written === title ? wordsOf(written.value) !== undefined ? { literal: written.value, words: wordsOf(written.value)! } : undefined : single(written.value))
      if (written && !found) return add(id, label, 'text', '', () => ({ ...written.span, text: text.slice(written.span.start, written.span.end) }), undefined, undefined, undefined, undefined, written.span, written === title ? 'This header is worked out in code. Change it in Code.' : `This ${label.toLowerCase()} is more than a text. Change it in Code.`)
      add(id, label, 'text', found?.words ?? '', v => !found ? added(v) : v ? { ...found.literal.span, text: swiftString(v) } : dropArgument(base, written!), undefined, undefined, undefined, 'Empty takes it away.', found?.literal.span)
    }
    part('title', 'Header', title ?? header, v => target >= 15 && !footer ? { start: base.callee.span.end, end: base.callee.span.end, text: `(${swiftString(v)})` }
      : footer && footer.value.kind !== 'closure' ? insert(base, 'header', `Text(${swiftString(v)})`, ['header', 'footer'])
        : { start: content.span.end, end: content.span.end, text: ` header: ${closure(`Text(${swiftString(v)})`)}` })
    part('section:footer', 'Footer', footer, v => title ? { start: base.callee.span.end, end: content.span.end, text: ` ${text.slice(content.span.start, content.span.end)} header: ${closure(`Text(${text.slice(title.value.span.start, title.value.span.end)})`)} footer: ${closure(`Text(${swiftString(v)})`)}` }
      : header && header.value.kind !== 'closure' ? insert(base, 'footer', `Text(${swiftString(v)})`, ['header', 'footer'])
        : { start: (header ?? { span: content.span }).span.end, end: (header ?? { span: content.span }).span.end, text: ` footer: ${closure(`Text(${swiftString(v)})`)}` })
  }
  /**
   * A Button's Icon and Role (Wave 4a). The icon is a titled button's `systemImage:`, or the
   * symbol of the Label a button with a label shows, which a label of one Text becomes; the
   * role is written in its parentheses. A button whose action is an argument keeps both as
   * written, and an alert's or a dialog's has no Icon, as iOS draws none there.
   */
  function buttonControls() {
    const action = base.trailingClosure?.span.start ?? base.span.end, inParens = base.args.filter(a => a.span.start < action)
    const title = inParens[0]?.label === null ? inParens[0] : undefined, symbol = named(base, 'systemImage'), role = named(base, 'role')
    if (named(base, 'action') || !base.trailingClosure) return
    if (!byId || !presentationAction(node, byId)) buttonIcon(title, symbol)
    const current = buttonRole(role && text.slice(role.span.start, role.span.end))
    if (target < 15 || !current || !title && inParens.some(a => a.label !== 'role')) return
    const roleArg = base.args.find(a => a.label === 'role')
    add('role', 'Role', 'select', current[0]!.toUpperCase() + current.slice(1), v => {
      const value = '.' + v.toLowerCase()
      if (v !== 'None') return roleArg ? { ...roleArg.value.span, text: value } : inParens.length ? { start: inParens.at(-1)!.span.end, end: inParens.at(-1)!.span.end, text: `, role: ${value}` } : { start: base.callee.span.end, end: base.callee.span.end, text: `(role: ${value})` }
      return roleArg ? dropArgument(base, roleArg) : { start: base.callee.span.end, end: base.callee.span.end, text: '' }
    }, ['None', 'Destructive', 'Cancel'], undefined, undefined, 'Destructive draws it in red; Cancel puts it where iOS puts a way out.', roleArg?.span)
  }
  /** A Button's Icon, from its `systemImage:` or its label's: `title` and `symbol` are its own arguments. */
  function buttonIcon(title: CallExpr['args'][number] | undefined, symbol: Expr | undefined) {
    const label = !title ? buttonLabel(base, text)?.view : undefined, labelled = label && viewCallChain(label), shown = labelled?.base
    const labelSymbol = shown && name(shown) === 'Label' && shown.args.length === 2 && shown.args[0]!.label === null ? named(shown, 'systemImage') : undefined
    const written = (expr: Expr) => text.slice(expr.span.start, expr.span.end)
    if (title && !symbol && target >= 14) add('icon', 'Icon', 'text', '', v => insert(base, 'systemImage', swiftString(v), [null, 'systemImage', 'role']), undefined, undefined, undefined, undefined, undefined, undefined, iconProblem)
    else if (title && symbol && wordsOf(symbol) !== undefined) add('icon', 'Icon', 'text', wordsOf(symbol)!, v => v ? { ...symbol.span, text: swiftString(v) } : { start: title.span.end, end: symbol.span.end, text: '' }, undefined, undefined, undefined, undefined, symbol.span, undefined, iconProblem)
    // A Label with no symbol is its title alone, which is a Text.
    else if (labelSymbol && wordsOf(labelSymbol) !== undefined) add('icon', 'Icon', 'text', wordsOf(labelSymbol)!, v => v ? { ...labelSymbol.span, text: swiftString(v) } : { ...shown!.span, text: `Text(${written(shown!.args[0]!.value)})` }, undefined, undefined, undefined, undefined, labelSymbol.span, undefined, iconProblem)
    // And a label of one Text with nothing else becomes a Label to take one, with the same words.
    else if (shown && name(shown) === 'Text' && !labelled!.modifiers.length && shown.args.length === 1 && shown.args[0]!.label === null && shown.args[0]!.value.kind === 'stringLiteral' && !shown.trailingClosure && uncommented(shown) && target >= 14) {
      const words = shown.args[0]!.value
      add('icon', 'Icon', 'text', '', v => ({ ...shown.span, text: v ? `Label(${written(words)}, systemImage: ${swiftString(v)})` : written(shown) }), undefined, undefined, undefined, undefined, shown.span, undefined, iconProblem)
    }
  }
  for (const [i, m] of modifiers.entries()) {
    const modifier = name(m), id = `modifier:${i}:detail`
    const cap = authoringCapability(modifier, 'modifier', m.args.map(a => a.label))
    if (!cap || target < Number.parseFloat(cap.minimumIOS)) continue
    // A search field's Prompt and Placement (Wave 4b): automatic, at the foot of an iPhone screen, or under the title.
    if (modifier === 'searchable') {
      const prompt = named(m, 'prompt'), placement = named(m, 'placement'), order = ['text', 'isPresented', 'placement', 'prompt']
      const words = prompt && wordsOf(prompt)
      if (prompt && words === undefined) shownAsWritten(id + ':prompt', 'Prompt', prompt)
      else add(id + ':prompt', 'Prompt', 'text', words ?? '', v => !prompt ? insert(m, 'prompt', swiftString(v), order) : v ? { ...prompt.span, text: swiftString(v) } : dropArgument(m, m.args.find(a => a.value === prompt)!), undefined, undefined, undefined, 'Shown in the empty field. Empty shows “Search”.', prompt?.span, undefined, undefined, 'Search')
      const where = placement && /^(?:SearchFieldPlacement)?\.(automatic|navigationBarDrawer)\b/.exec(text.slice(placement.span.start, placement.span.end).replace(/\s/g, ''))?.[1]
      if (placement && !where) shownAsWritten(id + ':placement', 'Placement', placement)
      else add(id + ':placement', 'Placement', 'select', where === 'navigationBarDrawer' ? 'Under the title' : 'Automatic', v => {
        const value = v === 'Automatic' ? '.automatic' : '.navigationBarDrawer(displayMode: .always)'
        return placement ? { ...placement.span, text: value } : insert(m, 'placement', value, order)
      }, ['Automatic', 'Under the title'], undefined, undefined, 'Automatic puts it where iOS does: at the foot of an iPhone screen.', placement?.span)
    }
    // Which side of a row its swipe actions are on, and whether a full swipe runs the first (Wave 4a).
    if (modifier === 'swipeActions') {
      param(m, id + ':edge', 'Edge', 'edge', 'select', 'trailing', ['leading', 'trailing'], undefined, undefined, '.', ['edge', 'allowsFullSwipe'])
      param(m, id + ':fullSwipe', 'Full swipe', 'allowsFullSwipe', 'toggle', 'true', undefined, undefined, undefined, '', ['edge', 'allowsFullSwipe'])
    }
    // A row's insets, each edge a field of its own, `EdgeInsets(…)` or `.init(…)` (Wave 4a).
    // An edge, or insets, worked out in code is shown as written, read only.
    const insets = modifier === 'listRowInsets' ? named(m, null) : undefined
    const edges = insets?.kind === 'call' && !insets.trailingClosure && (name(insets) === 'EdgeInsets' || insets.callee.kind === 'memberAccess' && !insets.callee.base && insets.callee.member === 'init') && insets.args.map(a => a.label).join() === 'top,leading,bottom,trailing' ? insets.args : undefined
    for (const edge of edges ?? []) {
      const label = edge.label![0]!.toUpperCase() + edge.label!.slice(1)
      if (literalNumber(edge.value, text) !== undefined) replace(`${id}:${edge.label}`, label, edge.value, 'pt')
      else shownAsWritten(`${id}:${edge.label}`, label, edge.value)
    }
    if (insets && !edges) shownAsWritten(`${id}:value`, 'Row insets', insets)
    if (modifier === 'lineLimit') {
      const limit = named(m, null)
      if (limit && literalNumber(limit, text) !== undefined) {
        if (m.args.length > 1) replace(id + ':limit', 'Maximum lines', limit, 'number', undefined, 0)
        if (target >= 16) param(m, id + ':reserve', 'Reserve line space', 'reservesSpace', 'toggle', 'false')
      }
    }
    if (['underline', 'strikethrough'].includes(modifier)) {
      param(m, id + ':active', 'Enabled', null, 'toggle', 'true', undefined, undefined, undefined, '', [null, 'color'])
      param(m, id + ':color', 'Decoration color', 'color', 'select', '', colors, undefined, undefined, 'Color.')
    }
    if (['stroke', 'strokeBorder'].includes(modifier)) {
      const style = named(m, 'style'), color = named(m, null)
      if (color) replace(id + ':color', 'Stroke color', color, 'select', colors, undefined, undefined, 'Color.')
      if (style?.kind === 'call' && name(style) === 'StrokeStyle') {
        const order = ['lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'dash', 'dashPhase']
        param(style, id + ':width', 'Stroke width', 'lineWidth', 'pt', '1', undefined, 0, undefined, '.', order)
        param(style, id + ':cap', 'Line cap', 'lineCap', 'select', 'butt', ['butt', 'round', 'square'], undefined, undefined, '.', order)
        param(style, id + ':join', 'Line join', 'lineJoin', 'select', 'miter', ['miter', 'round', 'bevel'], undefined, undefined, '.', order)
        param(style, id + ':miter', 'Miter limit', 'miterLimit', 'number', '10', undefined, 0, undefined, '.', order)
        param(style, id + ':phase', 'Dash phase', 'dashPhase', 'pt', '0', undefined, undefined, undefined, '.', order)
        const dash = named(style, 'dash')
        if (!dash || uncommented(dash) && dash.kind === 'arrayLiteral' && dash.elements.every(e => literalNumber(e, text) !== undefined)) add(id + ':dash', 'Dash lengths', 'text', dash?.kind === 'arrayLiteral' ? dash.elements.map(e => literalNumber(e, text)).join(', ') : '', v => {
          const array = '[' + v.split(',').map(x => x.trim()).filter(Boolean).join(', ') + ']'
          return dash ? { ...dash.span, text: array } : insert(style, 'dash', array, order)
        }, undefined, undefined, undefined, 'Alternating dash and gap lengths in points, separated by commas. Leave empty for a solid line.')
      } else if (!style) param(m, id + ':width', 'Stroke width', 'lineWidth', 'pt', '1', undefined, 0, undefined, '.', [null, 'lineWidth', 'antialiased'])
    }
    for (const arg of m.args) if (arg.value.kind === 'call' && gradients.includes(name(arg.value))) gradientControls(arg.value, `${id}:gradient`, false)
  }
}
