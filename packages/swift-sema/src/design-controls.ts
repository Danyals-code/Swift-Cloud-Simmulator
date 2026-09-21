import { authoringCapability, type AuthoringNode, type DesignControl, type SourceSpan } from '@studio/shared'
import { advancedControls } from './design-advanced-controls'
import { authoringViewMinimum } from './authoring-view'
import { Lexer, type CallExpr, type Expr } from '@studio/swift-syntax'

interface Patch { readonly start: number; readonly end: number; readonly text: string }
export interface ControlRecipe { readonly control: DesignControl; readonly patch: (value: string) => Patch }
export function viewCallChain(expr: Expr): { base: CallExpr; modifiers: CallExpr[] } | null {
  if (expr.kind !== 'call') return null
  if (expr.callee.kind === 'memberAccess' && expr.callee.base?.kind === 'call') {
    const inner = viewCallChain(expr.callee.base)
    if (inner) return { base: inner.base, modifiers: [...inner.modifiers, expr] }
  }
  return { base: expr, modifiers: [] }
}
export const AUTHORING_COLORS = ['primary', 'secondary', 'black', 'white', 'gray', 'red', 'orange', 'yellow', 'green', 'mint', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown', 'clear']
export const AUTHORING_FONTS = ['largeTitle', 'title', 'title2', 'title3', 'headline', 'subheadline', 'body', 'callout', 'footnote', 'caption', 'caption2']
export const SYSTEM_COLORS = ['systemBackground', 'secondarySystemBackground', 'tertiarySystemBackground', 'systemGroupedBackground', 'secondarySystemGroupedBackground', 'tertiarySystemGroupedBackground']
/** Only the color's opacity wrapper; the returned spans leave its expression intact. */
export function colorOpacityParts(value: Expr): { color: Expr; opacity: Expr } | undefined {
  if (value.kind !== 'call' || value.trailingClosure || value.callee.kind !== 'memberAccess' || value.callee.member !== 'opacity' || !value.callee.base || value.args.length !== 1 || value.args[0]!.label !== null) return undefined
  const color = value.callee.base
  if (color.kind !== 'memberAccess' && !(color.kind === 'call' && color.callee.kind === 'identifier' && color.callee.name === 'Color')) return undefined
  return { color, opacity: value.args[0]!.value }
}
const ALIGNMENTS = ['center', 'leading', 'trailing', 'top', 'bottom', 'topLeading', 'topTrailing', 'bottomLeading', 'bottomTrailing']
/** Swift escaping, including interpolation introducers and control characters. */
export function swiftString(value: string): string {
  return '"' + Array.from(value, c => c === '\\' ? '\\\\' : c === '"' ? '\\"' : c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : c.codePointAt(0)! < 32 || c.codePointAt(0) === 127 ? `\\u{${c.codePointAt(0)!.toString(16)}}` : c).join('') + '"'
}

/** Recipes are reconstructed from syntax on every request; the UI never supplies offsets. */
export function designControlRecipes(node: AuthoringNode, expr: Expr, text: string, deploymentTarget = '17.0'): ControlRecipe[] {
  if (!['view', 'collection', 'component'].includes(node.kind) || node.name === 'WindowGroup') return []
  const chain = viewCallChain(expr)
  if (!chain || node.properties.some(p => p.name === 'Source')) return []
  const { base, modifiers } = chain
  const targetVersion = Number.parseFloat(deploymentTarget)
  const constructor = authoringCapability(node.name, 'view', base.args.map(a => a.label))
  const constructorEditable = !!constructor && targetVersion >= Number.parseFloat(constructor.minimumIOS)
  const minimum = authoringViewMinimum(node)
  if (!Number.isFinite(targetVersion) || minimum === undefined || targetVersion < minimum) return []
  const colors = [...AUTHORING_COLORS.filter(c => targetVersion >= 15 || !['mint', 'teal', 'cyan', 'indigo', 'brown'].includes(c)), 'accentColor', ...SYSTEM_COLORS]
  const listStyles = targetVersion >= 14 ? ['plain', 'inset', 'grouped', 'insetGrouped', 'sidebar'] : ['plain', 'grouped']
  const recipes: ControlRecipe[] = []
  const scope = node.properties.some(p => p.scope === 'template') ? 'All rows in this template' : `Defined in ${node.owner}`
  const raw = (span: SourceSpan) => text.slice(span.start, span.end)
  const modName = (m: CallExpr) => m.callee.kind === 'memberAccess' ? m.callee.member : ''
  function add(id: string, label: string, kind: DesignControl['kind'], value: string, patch: ControlRecipe['patch'], options?: readonly string[], min?: number, max?: number, description = 'Changes this source value; existing modifier order is preserved.', origin = node.source): void {
    recipes.push({ control: { id, label, kind, value, options, min, max, scope, description, source: origin }, patch })
  }
  function replace(id: string, label: string, value: Expr, kind: DesignControl['kind'], options?: readonly string[], min?: number, max?: number, prefix = '.'): void {
    // Edit the literal branches, never erase the condition or replace linked data.
    if (value.kind === 'ternary' && ['text', 'select'].includes(kind)) {
      const condition = raw(value.condition.span)
      replace(id + ':then', `${label} · when ${condition} is true`, value.then, kind, options, min, max, prefix)
      replace(id + ':else', `${label} · otherwise`, value.else, kind, options, min, max, prefix)
      return
    }
    const property = node.properties.find(p => p.source?.start === value.span.start && p.source?.end === value.span.end)
    if (property?.declaration || property && ['unsupported', 'data-binding', 'component-argument', 'token'].includes(property.valueKind)) return
    if (kind === 'text') {
      if (value.kind !== 'stringLiteral' || value.segments.some(s => s.kind !== 'text')) return
      add(id, label, kind, value.segments.map(s => s.kind === 'text' ? s.value : '').join(''), v => ({ ...value.span, text: swiftString(v) }), undefined, undefined, undefined, undefined, value.span)
    } else if (kind === 'number') {
      if (!['integerLiteral', 'floatLiteral', 'unary'].includes(value.kind) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw(value.span))) return
      add(id, label, kind, String(Number(raw(value.span))), v => ({ ...value.span, text: String(Number(v)) }), undefined, min, max, undefined, value.span)
    } else {
      const expression = raw(value.span)
      const semantic = prefix === 'Color.' ? /^(?:SwiftUI\.)?Color\(\.(\w+)\)$/.exec(expression.replace(/\s/g, ''))?.[1] : undefined
      const current = semantic ?? expression.replace(/^(?:SwiftUI\.)?(?:Color|Font|Alignment|HorizontalAlignment|VerticalAlignment|TextAlignment)?\./, '')
      if (!options?.includes(current)) return
      add(id, label, kind, current, v => ({ ...value.span, text: prefix === 'Color.' && SYSTEM_COLORS.includes(v) ? `Color(.${v})` : prefix + v }), options, undefined, undefined, undefined, value.span)
    }
  }
  function append(id: string, label: string, kind: DesignControl['kind'], value: string, format: (v: string) => string, options?: readonly string[], min?: number, max?: number): void {
    if (modifiers.some(m => !authoringCapability(modName(m), 'modifier', m.args.map(a => a.label)))) return
    add(id, label, kind, value, v => ({ start: expr.span.end, end: expr.span.end, text: format(v) }), options, min, max, 'Adds a local modifier at the end of this view’s modifier chain. Earlier styles keep their order.')
  }
  function argument(id: string, label: string, name: string | null, kind: DesignControl['kind'], value: string, options?: readonly string[], min?: number): void {
    const found = base.args.find(a => a.label === name)
    if (found) { replace(id, label, found.value, kind, options, min); return }
    const end = base.trailingClosure?.span.start ?? base.span.end
    const tokens = Lexer.tokenize(text.slice(base.callee.span.end, end), node.source.file).tokens.filter(t => t.kind !== 'endOfFile')
    const closing = tokens.at(-1)
    if (tokens.length && closing?.text !== ')') return
    add(id, label, kind, value, v => {
      const formatted = kind === 'select' ? '.' + v : String(Number(v))
      const label = name ? name + ': ' : ''
      if (!closing) return { start: base.callee.span.end, end: base.callee.span.end, text: `(${label}${formatted})` }
      const at = base.callee.span.end + closing.span.start
      // Insert after the last argument, ahead of trailing comments/trivia.
      const first = base.args[0]
      if ((name === 'alignment' || name === null) && first) return { start: first.span.start, end: first.span.start, text: `${label}${formatted}, ` }
      const last = base.args.at(-1)
      return last ? { start: last.span.end, end: last.span.end, text: `, ${label}${formatted}` } : { start: at, end: at, text: `${label}${formatted}` }
    }, options, min, undefined, 'Sets a constructor argument without changing its children.')
  }
  if (node.kind !== 'component' && constructorEditable && ['HStack', 'VStack', 'ZStack'].includes(node.name)) {
    const alignment = base.args.find(a => a.label === 'alignment')
    const centered = !alignment || /^(?:(?:SwiftUI\.)?(?:Alignment|HorizontalAlignment|VerticalAlignment))?\.center$/.test(raw(alignment.value.span).trim())
    const choices = base.args.some(a => a.label === 'spacing') ? ['Row', 'Column'] : ['Row', 'Column', 'Stack']
    const names: Record<string, string> = { Row: 'HStack', Column: 'VStack', Stack: 'ZStack' }
    const span = base.callee.kind === 'memberAccess' ? base.callee.memberSpan : base.callee.span
    add('layout', 'Layout', 'select', node.name === 'HStack' ? 'Row' : node.name === 'VStack' ? 'Column' : 'Stack', v => alignment
      ? { start: span.start, end: alignment.value.span.end, text: names[v]! + text.slice(span.end, alignment.value.span.start) + '.center' }
      : { ...span, text: names[v]! }, choices)
    if (!centered) {
      const recipe = recipes.at(-1)!
      recipes[recipes.length - 1] = { ...recipe, control: { ...recipe.control, disabledReason: 'Set Alignment to Center to change the layout.' } }
    }
    if (node.name !== 'ZStack') argument('spacing', 'Spacing', 'spacing', 'number', '', undefined, 0)
    argument('alignment', 'Alignment', 'alignment', 'select', 'center', node.name === 'HStack' ? ['center', 'top', 'bottom', 'firstTextBaseline', 'lastTextBaseline'] : node.name === 'VStack' ? ['center', 'leading', 'trailing'] : ALIGNMENTS)
  }
  if (node.kind !== 'component' && constructorEditable && ['LazyHStack', 'LazyVStack'].includes(node.name)) {
    argument('spacing', 'Spacing', 'spacing', 'number', '', undefined, 0)
    argument('alignment', 'Alignment', 'alignment', 'select', 'center', node.name === 'LazyHStack' ? ['center', 'top', 'bottom', 'firstTextBaseline', 'lastTextBaseline'] : ['center', 'leading', 'trailing'])
  }
  if (node.kind !== 'component' && constructorEditable && node.name === 'ScrollView') {
    argument('scroll:axis', 'Scroll direction', null, 'select', 'vertical', ['vertical', 'horizontal'])
    const indicators = base.args.find(a => a.label === 'showsIndicators')
    if (indicators) replace('scroll:indicators', 'Show indicators', indicators.value, 'select', ['true', 'false'], undefined, undefined, '')
  }
  if (node.kind !== 'component' && constructorEditable && node.name === 'List' && !modifiers.some(m => modName(m) === 'listStyle')) append('add:listStyle', 'List style', 'select', '', v => `.listStyle(.${v})`, listStyles)
  if (node.kind !== 'component' && constructorEditable && node.name === 'RoundedRectangle') argument('shape:radius', 'Shape corner radius', 'cornerRadius', 'number', '', undefined, 0)
  if (node.kind !== 'component' && constructorEditable && node.name === 'Spacer') argument('spacer:minLength', 'Minimum spacing', 'minLength', 'number', '', undefined, 0)
  if (node.kind !== 'component' && constructorEditable && node.name === 'Text' && base.args[0]) replace('content', 'Text', base.args[0].value, 'text')
  if (node.kind !== 'component' && constructorEditable && ['SecureField', 'Menu', 'DisclosureGroup', 'ContentUnavailableView', 'ProgressView', 'TextField', 'Toggle', 'Button', 'NavigationLink', 'Label', 'LabeledContent', 'Link', 'GroupBox', 'Section', 'Stepper', 'Picker', 'DatePicker', 'ColorPicker'].includes(node.name) && base.args[0]?.label === null) replace('title', 'Title', base.args[0].value, 'text')
  if (node.kind !== 'component' && constructorEditable && node.name === 'Image' && base.args[0]) replace('image', base.args[0].label === 'systemName' ? 'System symbol' : 'Asset name', base.args[0].value, 'text')
  if (node.kind !== 'component' && constructorEditable) {
    const symbol = node.name === 'Label' && base.args.find(arg => arg.label === 'systemImage')
    if (symbol) replace('image', 'System symbol', symbol.value, 'text')
    const value = base.args.find(arg => arg.label === 'value')
    if (value && node.name === 'LabeledContent') replace('value', 'Value', value.value, 'text')
    if (value && node.name === 'ProgressView') {
      const total = base.args.find(a => a.label === 'total')?.value
      const maximum = total ? Number(raw(total.span)) : 1
      replace('progress', 'Progress', value.value, 'number', undefined, 0, Number.isFinite(maximum) ? maximum : undefined)
    }
  }
  for (const [i, m] of modifiers.entries()) {
    const name = modName(m)
    const capability = authoringCapability(name, 'modifier', m.args.map(a => a.label))
    if (!capability || targetVersion < Number.parseFloat(capability.minimumIOS)) continue
    if (name === 'padding' && !m.args.length && !m.trailingClosure) {
      const close = Lexer.tokenize(raw(m.span), node.source.file).tokens.filter(t => t.text === ')').at(-1)
      if (close) add(`modifier:${i}:default`, 'Padding', 'number', '', v => ({ start: m.span.start + close.span.start, end: m.span.start + close.span.start, text: String(Number(v)) }), undefined, 0)
    }
    for (const [j, arg] of m.args.entries()) {
      const id = `modifier:${i}:${j}`
      const label = `${name}${arg.label ? ' · ' + arg.label : ''}${modifiers.filter(v => modName(v) === name).length > 1 ? ' · ' + (i + 1) : ''}`
      if (['opacity', 'cornerRadius', 'lineLimit'].includes(name) && m.args.length === 1 && !arg.label) replace(id, label, arg.value, 'number', undefined, 0, name === 'opacity' ? 1 : undefined)
      if (name === 'padding' && !arg.label && (m.args.length === 1 || j === 1)) replace(id, label, arg.value, 'number', undefined, 0)
      if (name === 'frame' && ['width', 'height', 'minWidth', 'idealWidth', 'maxWidth', 'minHeight', 'idealHeight', 'maxHeight'].includes(arg.label ?? '')) replace(id, label, arg.value, 'number', undefined, 0)
      if (name === 'frame' && arg.label === 'alignment') replace(id, label, arg.value, 'select', ALIGNMENTS)
      if (['accessibilityLabel', 'accessibilityIdentifier', 'navigationTitle'].includes(name) && !arg.label && m.args.length === 1) replace(id, label, arg.value, 'text')
      if (['foregroundColor', 'foregroundStyle', 'background', 'fill', 'tint'].includes(name) && !arg.label && m.args.length === 1 && !m.trailingClosure) replace(id, label, arg.value, 'select', colors, undefined, undefined, 'Color.')
      const colorArgument = ['foregroundColor', 'foregroundStyle', 'background', 'fill', 'tint', 'border'].includes(name) && j === 0 && !arg.label || name === 'shadow' && arg.label === 'color'
      const translucent = colorArgument && colorOpacityParts(arg.value)
      if (translucent) {
        replace(id + ':color', `${name} · color`, translucent.color, 'select', colors, undefined, undefined, 'Color.')
        replace(id + ':opacity', `${name} · opacity`, translucent.opacity, 'number', undefined, 0, 1)
      } else if (name === 'shadow' && arg.label === 'color') replace(id, label, arg.value, 'select', colors, undefined, undefined, 'Color.')
      // The v1 catalog's values: each card edits exactly the arguments it wrote.
      if (name === 'offset' && ['x', 'y'].includes(arg.label ?? '')) replace(id, label, arg.value, 'number')
      if (name === 'blur' && arg.label === 'radius') replace(id, label, arg.value, 'number', undefined, 0)
      if (['tracking', 'lineSpacing'].includes(name) && !arg.label && m.args.length === 1) replace(id, label, arg.value, 'number')
      if (name === 'scaleEffect' && !arg.label && m.args.length === 1) replace(id, label, arg.value, 'number')
      if (name === 'disabled' && !arg.label && m.args.length === 1) replace(id, label, arg.value, 'select', ['true', 'false'], undefined, undefined, '')
      if (name === 'navigationBarTitleDisplayMode' && !arg.label && m.args.length === 1) replace(id, 'Title size', arg.value, 'select', ['automatic', 'large', 'inline'])
      if (name === 'border' && !arg.label && j === 0) replace(id, label, arg.value, 'select', colors, undefined, undefined, 'Color.')
      if (name === 'border' && arg.label === 'width') replace(id, label, arg.value, 'number', undefined, 0)
      if (name === 'shadow' && ['radius', 'x', 'y'].includes(arg.label ?? '')) replace(id, label, arg.value, 'number', arg.label === 'radius' ? undefined : undefined, arg.label === 'radius' ? 0 : undefined)
      // `.rotationEffect(.degrees(15))` and `.clipShape(.rect(cornerRadius: 12))` carry their
      // number one call deeper; the control edits that number and nothing around it.
      const inner = arg.value.kind === 'call' && !arg.value.trailingClosure ? arg.value : undefined
      if (name === 'rotationEffect' && inner?.callee.kind === 'memberAccess' && !inner.callee.base && inner.callee.member === 'degrees' && inner.args.length === 1 && inner.args[0]!.label === null) replace(id + ':degrees', 'rotationEffect · degrees', inner.args[0]!.value, 'number')
      const corner = name === 'clipShape' && inner && (inner.callee.kind === 'memberAccess' && !inner.callee.base && inner.callee.member === 'rect' || inner.callee.kind === 'identifier' && inner.callee.name === 'RoundedRectangle') ? inner.args.find(a => a.label === 'cornerRadius') : undefined
      if (corner && inner!.args.every(argument => ['cornerRadius', 'style'].includes(argument.label ?? ''))) replace(id + ':cornerRadius', 'clipShape · cornerRadius', corner.value, 'number', undefined, 0)
      if (name === 'buttonStyle') replace(id, 'Button style', arg.value, 'select', targetVersion >= 15 ? ['automatic', 'plain', 'borderless', 'bordered', 'borderedProminent'] : ['automatic', 'plain', 'borderless'])
      if (name === 'buttonBorderShape') replace(id, 'Button shape', arg.value, 'select', ['automatic', 'capsule', 'roundedRectangle'])
      if (name === 'controlSize') replace(id, 'Control size', arg.value, 'select', ['mini', 'small', 'regular', 'large'])
      if (name === 'listStyle') replace(id, 'List style', arg.value, 'select', listStyles)
      if (name === 'multilineTextAlignment') replace(id, label, arg.value, 'select', ['leading', 'center', 'trailing'])
      if (name === 'font' && m.args.length === 1 && !arg.label) {
        replace(id, 'Typography', arg.value, 'select', AUTHORING_FONTS)
        const font = arg.value
        if (font.kind === 'call' && font.callee.kind === 'memberAccess' && !font.callee.base && font.callee.member === 'system') {
          for (const a of font.args) {
            if (a.label === 'size') replace(id + ':size', 'Font size', a.value, 'number', undefined, 1, 1000)
            if (a.label === 'weight') replace(id + ':weight', 'Font weight', a.value, 'select', ['ultraLight', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black'])
            if (a.label === 'design') replace(id + ':design', 'Font design', a.value, 'select', ['default', 'serif', 'rounded', 'monospaced'])
          }
        }
      }
    }
  }
  advancedControls(node, base, modifiers, text, targetVersion, colors, add, replace)
  const has = (name: string) => modifiers.some(m => modName(m) === name)
  if (!has('font')) append('add:font', 'Font size', 'number', '', v => `.font(.system(size: ${Number(v)}))`, undefined, 1, 1000)
  if (!has('foregroundColor') && !has('foregroundStyle')) append('add:foreground', 'Text color', 'select', '', v => `.foregroundColor(${SYSTEM_COLORS.includes(v) ? `Color(.${v})` : `Color.${v}`})`, colors)
  if (!has('padding')) append('add:padding', 'Padding', 'number', '', v => `.padding(${Number(v)})`, undefined, 0)
  if (!has('background')) append('add:background', 'Background', 'select', '', v => `.background(${SYSTEM_COLORS.includes(v) ? `Color(.${v})` : `Color.${v}`})`, colors)
  if (!has('cornerRadius')) append('add:cornerRadius', 'Corner radius', 'number', '', v => `.cornerRadius(${Number(v)})`, undefined, 0)
  if (!has('opacity')) append('add:opacity', 'Opacity', 'number', '', v => `.opacity(${Number(v)})`, undefined, 0, 1)
  if (!has('accessibilityLabel')) append('add:accessibilityLabel', 'Accessibility label', 'text', '', v => `.accessibilityLabel(${swiftString(v)})`)
  if (targetVersion >= 14 && !has('accessibilityIdentifier')) append('add:accessibilityIdentifier', 'Accessibility identifier', 'text', '', v => `.accessibilityIdentifier(${swiftString(v)})`)
  for (const axis of ['width', 'height'] as const) {
    const max = axis === 'width' ? 'maxWidth' : 'maxHeight'
    const minimum = axis === 'width' ? 'minWidth' : 'minHeight'
    const axisTitle = axis === 'width' ? 'Width' : 'Height'
    const frames = modifiers.filter(m => modName(m) === 'frame' && m.args.some(a => [axis, max, minimum].includes(a.label ?? '')))
    if (!frames.length) {
      append('add:' + axis, 'Fixed ' + axis, 'number', '', v => `.frame(${axis}: ${Number(v)})`, undefined, 0)
      append('fill:' + axis, axisTitle + ' sizing', 'select', 'Content', v => v === 'Fill' ? `.frame(${max}: .infinity)` : `.frame(${axis}: 100)`, ['Content', 'Fill', 'Fixed'])
    } else if (frames.length === 1) {
      if (!authoringCapability('frame', 'modifier', frames[0]!.args.map(a => a.label))) continue
      const frame = frames[0]!
      const args = frame.args.filter(a => [axis, max, minimum].includes(a.label ?? ''))
      if (args.length !== 1 || frame.callee.kind !== 'memberAccess' || !frame.callee.base) continue
      const arg = args[0]!
      const alignment = frame.args.find(a => a.label === 'alignment')
      if (alignment && !recipes.some(r => r.control.source.start === alignment.value.span.start && r.control.source.end === alignment.value.span.end)) continue
      const current = arg.label === max && raw(arg.value.span) === '.infinity' ? 'Fill' : arg.label === axis && /^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw(arg.value.span)) ? 'Fixed' : undefined
      if (!current) continue
      const from = frame.callee.base.span.end
      const suffix = text.slice(from, frame.span.end)
      // A frame containing comments remains numerically editable. Structural conversion
      // cannot decide whether a comment belongs to a removed constraint, so it is withheld.
      if (/\/\/|\/\*/.test(suffix)) continue
      const position = frame.args.indexOf(arg)
      const before = frame.args[position - 1], after = frame.args[position + 1]
      const removeStart = before ? before.span.end : arg.span.start
      const removeEnd = before ? arg.span.end : after ? after.span.start : arg.span.end
      const remaining = frame.args.length === 1 ? '' : suffix.slice(0, removeStart - from) + suffix.slice(removeEnd - from)
      add('fill:' + axis, axisTitle + ' sizing', 'select', current, v => {
        const align = alignment ? `, alignment: ${raw(alignment.value.span)}` : ''
        const added = v === 'Content' ? '' : v === 'Fill' ? `.frame(${max}: .infinity${align})` : `.frame(${axis}: 100${align})`
        const retained = v !== 'Content' && frame.args.every(a => a === arg || a === alignment) ? '' : remaining
        // One explicit frame per changed axis avoids invalid mixed Swift overloads
        // such as frame(width:maxHeight:). Other constraints retain their order.
        return { start: from, end: frame.span.end, text: retained + added }
      }, ['Content', 'Fill', 'Fixed'], undefined, undefined, 'Content removes this axis constraint. Fill accepts the parent’s available size. Fixed starts at 100 points; edit the dimension to choose another size. Other frame arguments and surrounding modifiers are preserved.')
    }
  }
  return recipes.map(recipe => ({ ...recipe, control: constrainNumericControl(recipe.control, node.name, node.behavior?.binding?.type) })).filter((recipe, index) => !recipes.slice(0, index).some(prior => prior.control.source.start === recipe.control.source.start && prior.control.source.end === recipe.control.source.end && prior.control.kind === recipe.control.kind && prior.control.value === recipe.control.value && prior.control.source !== node.source))
}

export function constrainNumericControl(control: DesignControl, view: string, type?: string): DesignControl {
  return view === 'Stepper' && ['stepper:min', 'stepper:max', 'range:step'].includes(control.id)
    ? { ...control, integer: !type || type === 'Int' } : control
}

export function validateControlValue(control: DesignControl, value: string): string | null {
  if (control.disabledReason) return control.disabledReason
  if (/^date:(from|through)$/.test(control.id)) {
    const seconds = Date.parse(value + 'Z') / 1000
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value) || !Number.isFinite(seconds)) return 'Choose a valid date and time.'
    if (control.min !== undefined && seconds < control.min || control.max !== undefined && seconds > control.max) return 'The earliest date must not be after the latest date.'
  }
  if (control.id.endsWith(':detail:dash') && value.trim() && (!/^\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\s*$/.test(value) || !value.split(',').some(n => Number(n) > 0) || value.split(',').some(n => Number(n) > 1000000))) return 'Enter positive dash and gap lengths separated by commas.'
  if (control.kind === 'number') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return 'Enter a finite number.'
    const number = Number(value)
    if (!Number.isFinite(number) || Math.abs(number) > 1_000_000 || control.min !== undefined && number < control.min || control.max !== undefined && number > control.max) return `Value is outside the supported range${control.min !== undefined ? ' (minimum ' + control.min + ')' : ''}${control.max !== undefined ? ' (maximum ' + control.max + ')' : ''}.`
    if ((control.integer || control.label.startsWith('lineLimit') || control.id.endsWith(':detail:limit') || control.id === 'grid:count') && !Number.isInteger(number)) return 'Enter a whole number.'
  }
  if (control.kind === 'select' && !control.options?.includes(value)) return 'Choose a supported value.'
  if (value.length > 16_384) return 'This value is too long.'
  return null
}
