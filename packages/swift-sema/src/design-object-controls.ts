import { authoringCapability, type AuthoringNode, type DesignControl } from '@studio/shared'
import type { CallExpr, Expr } from '@studio/swift-syntax'
import { swiftString, type ControlRecipe } from './design-controls'
import type { AddControl, ReplaceControl } from './design-advanced-controls'

type Insert = (call: CallExpr, label: string | null, value: string, order?: readonly (string | null)[]) => ReturnType<ControlRecipe['patch']>
type Param = (call: CallExpr, id: string, title: string, label: string | null, kind: DesignControl['kind'], fallback: string, options?: readonly string[], min?: number, max?: number, prefix?: string, order?: readonly (string | null)[]) => void
const anchors = ['center', 'topLeading', 'top', 'topTrailing', 'leading', 'trailing', 'bottomLeading', 'bottom', 'bottomTrailing']
const vertical = ['top', 'center', 'bottom', 'firstTextBaseline', 'lastTextBaseline']
const gradients = ['LinearGradient', 'RadialGradient', 'AngularGradient']
const literalNumber = (expr: Expr, text: string) => ['integerLiteral', 'floatLiteral', 'unary'].includes(expr.kind) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.slice(expr.span.start, expr.span.end)) ? Number(text.slice(expr.span.start, expr.span.end)) : undefined

/** Constructor and overload controls edit literal leaves, preserving their bindings and neighbors. */
export function objectControls(node: AuthoringNode, base: CallExpr, modifiers: readonly CallExpr[], text: string, target: number, colors: readonly string[], add: AddControl, replace: ReplaceControl, param: Param, insert: Insert): void {
  const named = (call: CallExpr, label: string | null) => call.args.find(a => a.label === label)?.value
  const uncommented = (expr: Expr) => !/\/\/|\/\*/.test(text.slice(expr.span.start, expr.span.end))
  const name = (call: CallExpr) => call.callee.kind === 'identifier' ? call.callee.name : call.callee.kind === 'memberAccess' ? call.callee.member : ''
  const boolOptions = ['true', 'false']
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
      if (all && ['startRadius', 'endRadius'].includes(arg.label ?? '')) replace(`${id}:${arg.label}`, arg.label === 'startRadius' ? 'Start radius' : 'End radius', arg.value, 'number', undefined, 0)
      if (['angle', 'startAngle', 'endAngle'].includes(arg.label ?? '') && arg.value.kind === 'call' && ['degrees', 'radians', 'Angle'].includes(name(arg.value))) {
        const angle = arg.value.args[0]
        if (angle) replace(`${id}:${arg.label}`, `${arg.label === 'startAngle' ? 'Start angle' : arg.label === 'endAngle' ? 'End angle' : 'Angle'} (${angle.label ?? name(arg.value)})`, angle.value, 'number')
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
      param(base, 'grid:horizontalSpacing', 'Horizontal spacing', 'horizontalSpacing', 'number', '', undefined, 0, undefined, '.', order)
      param(base, 'grid:verticalSpacing', 'Vertical spacing', 'verticalSpacing', 'number', '', undefined, 0, undefined, '.', order)
    }
    if (node.name === 'GridRow') param(base, 'gridrow:alignment', 'Vertical alignment', 'alignment', 'select', 'center', vertical)
    if (node.name === 'ColorPicker') param(base, 'color:opacity', 'Supports opacity', 'supportsOpacity', 'select', 'true', boolOptions, undefined, undefined, '')
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
  }
  for (const [i, m] of modifiers.entries()) {
    const modifier = name(m), id = `modifier:${i}:detail`
    const cap = authoringCapability(modifier, 'modifier', m.args.map(a => a.label))
    if (!cap || target < Number.parseFloat(cap.minimumIOS)) continue
    if (modifier === 'lineLimit') {
      const limit = named(m, null)
      if (limit && literalNumber(limit, text) !== undefined) {
        if (m.args.length > 1) replace(id + ':limit', 'Maximum lines', limit, 'number', undefined, 0)
        if (target >= 16) param(m, id + ':reserve', 'Reserve line space', 'reservesSpace', 'select', 'false', boolOptions, undefined, undefined, '')
      }
    }
    if (['underline', 'strikethrough'].includes(modifier)) {
      param(m, id + ':active', 'Enabled', null, 'select', 'true', boolOptions, undefined, undefined, '', [null, 'color'])
      param(m, id + ':color', 'Decoration color', 'color', 'select', '', colors, undefined, undefined, 'Color.')
    }
    if (['stroke', 'strokeBorder'].includes(modifier)) {
      const style = named(m, 'style'), color = named(m, null)
      if (color) replace(id + ':color', 'Stroke color', color, 'select', colors, undefined, undefined, 'Color.')
      if (style?.kind === 'call' && name(style) === 'StrokeStyle') {
        const order = ['lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'dash', 'dashPhase']
        param(style, id + ':width', 'Stroke width', 'lineWidth', 'number', '1', undefined, 0, undefined, '.', order)
        param(style, id + ':cap', 'Line cap', 'lineCap', 'select', 'butt', ['butt', 'round', 'square'], undefined, undefined, '.', order)
        param(style, id + ':join', 'Line join', 'lineJoin', 'select', 'miter', ['miter', 'round', 'bevel'], undefined, undefined, '.', order)
        param(style, id + ':miter', 'Miter limit', 'miterLimit', 'number', '10', undefined, 0, undefined, '.', order)
        param(style, id + ':phase', 'Dash phase', 'dashPhase', 'number', '0', undefined, undefined, undefined, '.', order)
        const dash = named(style, 'dash')
        if (!dash || uncommented(dash) && dash.kind === 'arrayLiteral' && dash.elements.every(e => literalNumber(e, text) !== undefined)) add(id + ':dash', 'Dash lengths', 'text', dash?.kind === 'arrayLiteral' ? dash.elements.map(e => literalNumber(e, text)).join(', ') : '', v => {
          const array = '[' + v.split(',').map(x => x.trim()).filter(Boolean).join(', ') + ']'
          return dash ? { ...dash.span, text: array } : insert(style, 'dash', array, order)
        }, undefined, undefined, undefined, 'Alternating dash and gap lengths in points, separated by commas. Leave empty for a solid line.')
      } else if (!style) param(m, id + ':width', 'Stroke width', 'lineWidth', 'number', '1', undefined, 0, undefined, '.', [null, 'lineWidth', 'antialiased'])
    }
    for (const arg of m.args) if (arg.value.kind === 'call' && gradients.includes(name(arg.value))) gradientControls(arg.value, `${id}:gradient`, false)
  }
}
