import { objectControls } from './design-object-controls'
import { ANIMATION_STYLES, ANIMATION_STYLE_WORDS, authoringCapability, takesDuration, type AnimationStyle, type AuthoringNode, type SourceSpan } from '@studio/shared'
import { Lexer, type CallExpr, type Expr } from '@studio/swift-syntax'
import { controlKind, type ControlKind, type ControlRecipe } from './design-controls'
import { EDGE_SET_MEMBERS } from './structural-check'
import { isAppleCall } from './builtins'
import { animationOf, animationSwift, leftToCode, readTransition, transitionNamed, transitionSettings, transitionSwift, type Transition } from './motion-values'

const anchors = ['center', 'topLeading', 'top', 'topTrailing', 'leading', 'trailing', 'bottomLeading', 'bottom', 'bottomTrailing']
const edges = EDGE_SET_MEMBERS
export const STYLE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  toggleStyle: ['automatic', 'switch', 'button'], pickerStyle: ['automatic', 'menu', 'segmented', 'inline', 'wheel'],
  labelStyle: ['automatic', 'titleAndIcon', 'titleOnly', 'iconOnly'], progressViewStyle: ['automatic', 'linear', 'circular'],
  gaugeStyle: ['automatic', 'linearCapacity', 'accessoryLinear', 'accessoryLinearCapacity', 'accessoryCircular', 'accessoryCircularCapacity'],
  textFieldStyle: ['automatic', 'plain', 'roundedBorder'], imageScale: ['small', 'medium', 'large'],
  fontWeight: ['ultraLight', 'thin', 'light', 'regular', 'medium', 'semibold', 'bold', 'heavy', 'black'],
  fontDesign: ['default', 'serif', 'rounded', 'monospaced'], textCase: ['uppercase', 'lowercase'], truncationMode: ['head', 'middle', 'tail'],
  scrollIndicators: ['automatic', 'visible', 'hidden'], scrollContentBackground: ['visible', 'hidden'], listRowSeparator: ['visible', 'hidden'],
  blendMode: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colorDodge', 'colorBurn', 'softLight', 'hardLight', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'],
}
/** Apple's five material thicknesses, thinnest first. */
export const MATERIALS: readonly string[] = ['ultraThin', 'thin', 'regular', 'thick', 'ultraThick']
/** The thickness of `.ultraThinMaterial` or `Material.ultraThin`, which are the same value. */
export function materialThickness(value: Expr): string | undefined {
  if (value.kind !== 'memberAccess') return undefined
  if (!value.base) return MATERIALS.find(thickness => value.member === thickness + 'Material')
  return value.base.kind === 'identifier' && value.base.name === 'Material' && MATERIALS.includes(value.member) ? value.member : undefined
}
export type AddControl = (id: string, label: string, kind: ControlKind, value: string, patch: ControlRecipe['patch'], options?: readonly string[], min?: number, max?: number, description?: string, origin?: SourceSpan, disabledReason?: string, problem?: ControlRecipe['problem'], placeholder?: string) => void
export type ReplaceControl = (id: string, label: string, value: Expr, kind: ControlKind, options?: readonly string[], min?: number, max?: number, prefix?: string) => void
/** Literal-only editors. Existing expressions, comments, bindings and linked tokens remain owned by their source. */
export function advancedControls(node: AuthoringNode, base: CallExpr, modifiers: readonly CallExpr[], text: string, target: number, colors: readonly string[], add: AddControl, replace: ReplaceControl, byId?: (id: string | undefined) => AuthoringNode | undefined): void {
  const raw = (span: SourceSpan) => text.slice(span.start, span.end)
  const nameOf = (call: CallExpr) => call.callee.kind === 'memberAccess' ? call.callee.member : ''
  const safe = (span: SourceSpan) => !/\/\/|\/\*/.test(raw(span))
  const simple = (value: Expr): boolean => ['integerLiteral', 'floatLiteral', 'booleanLiteral', 'nilLiteral'].includes(value.kind) || value.kind === 'unary' && simple(value.operand) || value.kind === 'memberAccess' && (!value.base || value.base.kind === 'identifier' && ['Color', 'UnitPoint'].includes(value.base.name)) || value.kind === 'arrayLiteral' && value.elements.every(simple) || value.kind === 'call' && !value.trailingClosure && (value.callee.kind === 'identifier' && ['Color', 'GridItem', 'UnitPoint', 'LinearGradient', 'RadialGradient', 'AngularGradient'].includes(value.callee.name) || value.callee.kind === 'memberAccess' && !value.callee.base) && value.args.every(a => simple(a.value))
  function insert(call: CallExpr, label: string | null, value: string, order?: readonly (string | null)[]) {
    const later = order && call.args.find(a => order.indexOf(a.label) > order.indexOf(label))
    const prefix = label ? `${label}: ` : ''
    if (later) return { start: later.span.start, end: later.span.start, text: `${prefix}${value}, ` }
    const last = call.args.at(-1)
    if (last) return { start: last.span.end, end: last.span.end, text: `, ${prefix}${value}` }
    const close = Lexer.tokenize(text.slice(call.callee.span.end, call.trailingClosure?.span.start ?? call.span.end), call.span.file).tokens.filter(t => t.text === ')').at(-1)
    const at = close ? call.callee.span.end + close.span.start : call.callee.span.end
    return { start: at, end: at, text: close ? `${prefix}${value}` : `(${prefix}${value})` }
  }
  function param(call: CallExpr, id: string, title: string, label: string | null, kind: ControlKind, fallback: string, options?: readonly string[], min?: number, max?: number, prefix = '.', order?: readonly (string | null)[]) {
    const arg = call.args.find(a => a.label === label)
    if (arg?.value.kind === 'memberAccess' && !arg.value.base && arg.value.member === 'infinity' && controlKind(kind).kind === 'number') add(id, title, kind, '', v => ({ ...arg.value.span, text: v }), undefined, min, max)
    else if (arg) replace(id, title, arg.value, kind, options, min, max, prefix)
    else add(id, title, kind, fallback, v => insert(call, label, kind === 'select' ? prefix + v : v, order), options, min, max)
  }
  objectControls(node, base, modifiers, text, target, colors, add, replace, param, insert, byId)
  if (node.kind !== 'component' && node.name === 'ScrollView' && authoringCapability(node.name, 'view', base.args.map(a => a.label)) && !base.args.some(a => a.label === 'showsIndicators')) param(base, 'scroll:indicators', 'Show indicators', 'showsIndicators', 'toggle', 'true')
  if (node.kind !== 'component' && node.name === 'Image') {
    // `.aspectRatio(contentMode: .fit)` is `.scaledToFit()` spelled out. One with a ratio of its own sets
    // something else, edited on its card: sizing written beside it would scale the image twice.
    const contentMode = (m: CallExpr) => nameOf(m) === 'aspectRatio' && m.args.length === 1 && m.args[0]!.label === 'contentMode' ? /^(?:ContentMode)?\.(fit|fill)$/.exec(raw(m.args[0]!.value.span).replace(/\s/g, ''))?.[1] : undefined
    const resizing = modifiers.filter(m => ['resizable', 'scaledToFit', 'scaledToFill'].includes(nameOf(m)) || contentMode(m))
    const ratio = modifiers.some(m => nameOf(m) === 'aspectRatio' && !contentMode(m))
    const span = { ...base.span, start: base.span.end, end: modifiers.at(-1)?.span.end ?? base.span.end }
    // The rest of the chain is kept as written after the sizing; a project's own modifier may need the Image itself.
    if (safe(span) && !ratio && resizing.every(m => m.args.length === 0 || contentMode(m)) && modifiers.every(m => isAppleCall(nameOf(m)))) {
      const mode = resizing.some(m => nameOf(m) === 'scaledToFill' || contentMode(m) === 'fill') ? 'Fill' : resizing.some(m => nameOf(m) === 'scaledToFit' || contentMode(m) === 'fit') ? 'Fit' : resizing.some(m => nameOf(m) === 'resizable') ? 'Stretch' : 'Intrinsic'
      add('image:sizing', 'Image sizing', 'select', mode, value => {
        const retained = modifiers.filter(m => !resizing.includes(m)).map(m => text.slice(m.callee.kind === 'memberAccess' ? m.callee.base!.span.end : m.span.start, m.span.end)).join('')
        return { ...span, text: (value === 'Intrinsic' ? '' : '.resizable()' + (value === 'Fit' ? '.scaledToFit()' : value === 'Fill' ? '.scaledToFill()' : '')) + retained }
      }, ['Intrinsic', 'Fit', 'Fill', 'Stretch'], undefined, undefined, 'Fit keeps the entire image visible. Fill preserves its aspect ratio and may overflow; add Clip to crop it to its frame.')
    }
  }
  if (node.kind !== 'component' && ['LazyVGrid', 'LazyHGrid'].includes(node.name)) {
    const axis = node.name === 'LazyVGrid' ? 'columns' : 'rows'
    const tracks = base.args.find(a => a.label === axis)?.value
    if (tracks?.kind === 'arrayLiteral') {
      if (safe(tracks.span) && tracks.elements.every(simple)) add('grid:count', axis === 'columns' ? 'Column count' : 'Row count', 'number', String(tracks.elements.length), v => ({ ...tracks.span, text: '[' + Array.from({ length: Number(v) }, (_, i) => tracks.elements[i] ? raw(tracks.elements[i]!.span) : 'GridItem(.flexible())').join(', ') + ']' }), undefined, 1, 24)
      tracks.elements.forEach((track, i) => {
        if (track.kind !== 'call' || track.callee.kind !== 'identifier' || track.callee.name !== 'GridItem') return
        const size = track.args[0]?.value
        if (!size || size.kind !== 'call' || size.callee.kind !== 'memberAccess' || size.callee.base) return
        const mode = size.callee.member, prefix = `grid:${i}`, title = `${axis === 'columns' ? 'Column' : 'Row'} ${i + 1}`
        if (!['fixed', 'flexible', 'adaptive'].includes(mode)) return
        if (safe(size.span) && simple(size)) add(prefix + ':type', title + ' sizing', 'select', mode, v => ({ ...size.span, text: v === 'fixed' ? '.fixed(100)' : v === 'adaptive' ? '.adaptive(minimum: 80)' : '.flexible()' }), ['fixed', 'flexible', 'adaptive'])
        if (mode === 'fixed' && size.args[0]) replace(prefix + ':size', title + ' size', size.args[0].value, 'pt', undefined, 0)
        else if (mode !== 'fixed') {
          param(size, prefix + ':min', title + ' minimum', 'minimum', 'pt', mode === 'adaptive' ? '80' : '10', undefined, 0, undefined, '.', ['minimum', 'maximum'])
          param(size, prefix + ':max', title + ' maximum', 'maximum', 'pt', '', undefined, 0)
        }
        param(track, prefix + ':spacing', title + ' spacing', 'spacing', 'pt', '', undefined, 0, undefined, '.', [null, 'spacing', 'alignment'])
        param(track, prefix + ':alignment', title + ' alignment', 'alignment', 'select', 'center', anchors)
      })
    }
    param(base, 'grid:spacing', 'Grid spacing', 'spacing', 'pt', '', undefined, 0, undefined, '.', [axis, 'alignment', 'spacing', 'pinnedViews'])
    param(base, 'grid:alignment', 'Grid alignment', 'alignment', 'select', 'center', node.name === 'LazyVGrid' ? ['leading', 'center', 'trailing'] : ['top', 'center', 'bottom'], undefined, undefined, '.', [axis, 'alignment', 'spacing', 'pinnedViews'])
  }
  /** A fill's kind, and what that kind has to edit: a gradient's stops and points, a material's thickness. */
  function fill(name: string, value: Expr, key: string) {
    const gradient = value.kind === 'call' && value.callee.kind === 'identifier' && ['LinearGradient', 'RadialGradient', 'AngularGradient'].includes(value.callee.name) ? value : undefined
    const material = materialThickness(value)
    // Materials are ShapeStyles from iOS 15; a background is where a designer reaches for one.
    const kinds = material || name === 'background' && target >= 15 ? ['Solid', 'Gradient', 'Material'] : ['Solid', 'Gradient']
    if (!safe(value.span)) return
    if (simple(value) || material) add(key + ':fillType', 'Fill type', 'select', material ? 'Material' : gradient ? 'Gradient' : 'Solid', v => ({ ...value.span, text: v === 'Solid' ? 'Color.blue' : v === 'Material' ? '.regularMaterial' : 'LinearGradient(colors: [Color.red, Color.blue], startPoint: .leading, endPoint: .trailing)' }), kinds)
    if (material) add(key + ':material', 'Thickness', 'select', material, v => ({ ...value.span, text: value.kind === 'memberAccess' && value.base ? `Material.${v}` : `.${v}Material` }), MATERIALS)
    if (gradient) for (const field of gradient.args) {
      if (field.label === 'colors' && field.value.kind === 'arrayLiteral') field.value.elements.forEach((color, stop) => replace(key + ':stop:' + stop, `Color ${stop + 1}`, color, 'select', colors, undefined, undefined, 'Color.'))
      if (['startPoint', 'endPoint', 'center'].includes(field.label ?? '')) replace(key + ':' + field.label, field.label === 'startPoint' ? 'Start point' : field.label === 'endPoint' ? 'End point' : field.label === 'startRadius' ? 'Start radius' : field.label === 'endRadius' ? 'End radius' : 'Center', field.value, 'select', anchors)
      if (['startRadius', 'endRadius'].includes(field.label ?? '')) replace(key + ':' + field.label, field.label === 'startPoint' ? 'Start point' : field.label === 'endPoint' ? 'End point' : field.label === 'startRadius' ? 'Start radius' : field.label === 'endRadius' ? 'End radius' : 'Center', field.value, 'pt', undefined, 0)
    }
  }
  for (const [i, m] of modifiers.entries()) {
    const name = nameOf(m), capability = authoringCapability(name, 'modifier', m.args.map(a => a.label)), id = `modifier:${i}:advanced`
    // `.background(style, in: shape)` (iOS 15) is outside the read forms, but its style is a fill like any other.
    if (name === 'background' && target >= 15 && !m.trailingClosure && m.args.length === 2 && m.args[0]!.label === null && m.args[1]!.label === 'in') {
      const style = m.args[0]!.value, named = /^(?:Color)?\.(\w+)$|^Color\(\.(\w+)\)$/.exec(raw(style.span).replace(/\s/g, ''))
      const color = named?.[1] ?? named?.[2]
      // Its values read as unsupported, so the colour is offered here rather than by `replace`.
      if (color && colors.includes(color) && safe(style.span)) add(id + ':0:color', 'background', 'select', color, v => ({ ...style.span, text: /^(?:secondary|tertiary)?system/i.test(v) ? `Color(.${v})` : `Color.${v}` }), colors)
      fill(name, style, id + ':0')
    }
    if (!capability || target < Number.parseFloat(capability.minimumIOS)) continue
    // A transition's and an animation's cards (Wave 5a): their style, edge, Fades too and duration, as the Visibility group and When tapped name them.
    const motion = m.args[0]?.value
    if (name === 'transition' && motion && safe(motion.span)) {
      const current = readTransition(motion), write = (next: Partial<Transition>) => ({ ...motion.span, text: transitionSwift({ ...current, ...next }) })
      const change = { transition: (words: string) => write({ kind: transitionNamed(words) }), edge: (edge: string) => write({ edge }), fades: (fades: string) => write({ fades: fades === 'true' }) }
      if (!leftToCode(current)) for (const setting of transitionSettings(current, target, false)) add(`${id}:${setting.part}`, setting.label, setting.kind, setting.value, change[setting.part], setting.options, undefined, undefined, setting.description)
    }
    if (name === 'animation' && motion && safe(motion.span)) {
      const { style, duration } = animationOf(motion), words = ANIMATION_STYLE_WORDS
      const write = (next: AnimationStyle | undefined, seconds?: number) => {
        if (!next) throw new Error('Choose an animation this card offers.')
        return { ...motion.span, text: animationSwift(seconds === undefined ? { style: next } : { style: next, duration: seconds }) || '.default' }
      }
      if (style) {
        add(id + ':animation', 'Animation', 'select', words[style], word => write(ANIMATION_STYLES.find(s => words[s] === word)), ANIMATION_STYLES.map(s => words[s]))
        if (takesDuration(style)) add(id + ':duration', 'Duration', 'number', duration === undefined ? '' : String(duration), seconds => write(style, Number(seconds)), undefined, 0.01, 10, 'In seconds.')
      }
    }
    if (name === 'padding') {
      const first = m.args[0]?.value
      // Only `Edge.Set`'s own members are edges: `.space16` or `Layout.padding` there is the amount, a token or constant.
      const edgeSet = first?.kind === 'memberAccess' && edges.includes(first.member) && (!first.base || /^(?:SwiftUI\.)?Edge\.Set$/.test(raw(first.base.span).replace(/\s/g, '')))
      if (edgeSet || first?.kind === 'arrayLiteral') {
        // Every edge is a padding's own default, so `.all` is written as no edge at all: `.padding(8)`.
        const amount = m.args[1], edge = first.kind === 'memberAccess' ? { ...first.span, end: amount?.span.start ?? first.span.end } : undefined
        if (first.kind === 'memberAccess') add(id + ':edges', 'Padding edges', 'select', first.member, v => v === 'all' && safe(edge!) ? { ...edge!, text: '' } : { ...first.span, text: `${first.base ? raw(first.base.span) : ''}.${v}` }, edges, undefined, undefined, undefined, first.span)
        else if (safe(first.span) && first.elements.every(e => e.kind === 'memberAccess' && !e.base && edges.includes(e.member))) {
          for (const edge of ['top', 'leading', 'bottom', 'trailing']) add(id + ':' + edge, `Pad ${edge}`, 'toggle', String(first.elements.some(e => e.kind === 'memberAccess' && (e.member === edge || e.member === 'all' || e.member === 'horizontal' && ['leading', 'trailing'].includes(edge) || e.member === 'vertical' && ['top', 'bottom'].includes(edge)))), value => {
            const selected = new Set(first.elements.flatMap(e => e.kind !== 'memberAccess' ? [] : e.member === 'all' ? ['top', 'leading', 'bottom', 'trailing'] : e.member === 'horizontal' ? ['leading', 'trailing'] : e.member === 'vertical' ? ['top', 'bottom'] : [e.member]))
            if (value === 'true') selected.add(edge); else selected.delete(edge)
            return { ...first.span, text: '[' + [...selected].map(e => '.' + e).join(', ') + ']' }
          })
        }
        if (!m.args[1]) add(id + ':amount', 'Padding amount', 'pt', '', v => first.kind === 'memberAccess' && first.member === 'all' ? { ...first.span, text: v } : { start: first.span.end, end: first.span.end, text: ', ' + v })
      } else if (!first || ['integerLiteral', 'floatLiteral', 'unary'].includes(first.kind)) add(id + ':edges', 'Padding edges', 'select', 'all', v => v === 'all' ? { start: m.span.end, end: m.span.end, text: '' } : first ? { start: first.span.start, end: first.span.start, text: `.${v}, ` } : insert(m, null, `.${v}, 16`), edges)
    }
    if (name === 'frame' && !m.args.some(a => a.label === 'width' || a.label === 'height')) {
      const order = ['minWidth', 'idealWidth', 'maxWidth', 'minHeight', 'idealHeight', 'maxHeight', 'alignment']
      for (const field of order.slice(0, -1)) if (!m.args.some(a => a.label === field)) param(m, id + ':' + field, field.replace(/([A-Z])/g, ' $1'), field, 'pt', '', undefined, 0, undefined, '.', order)
    }
    if (['scaleEffect', 'rotationEffect', 'rotation3DEffect'].includes(name)) {
      param(m, id + ':anchor', 'Transform anchor', 'anchor', 'select', 'center', anchors, undefined, undefined, '.', [null, 'x', 'y', 'axis', 'anchor', 'anchorZ', 'perspective'])
      const anchor = m.args.find(a => a.label === 'anchor')?.value
      if (anchor?.kind === 'call' && anchor.callee.kind === 'identifier' && anchor.callee.name === 'UnitPoint') for (const a of anchor.args) if (['x', 'y'].includes(a.label ?? '')) replace(id + ':anchor:' + a.label, `Anchor ${a.label}`, a.value, 'number')
    }
    if (name === 'rotation3DEffect') {
      const axis = m.args.find(a => a.label === 'axis')?.value
      if (axis?.kind === 'tuple') axis.elements.forEach((e, j) => replace(`${id}:axis:${j}`, `Axis ${axis.labels[j] ?? ['x', 'y', 'z'][j]}`, e, 'number'))
      param(m, id + ':anchorZ', 'Anchor depth', 'anchorZ', 'number', '0', undefined, undefined, undefined, '.', [null, 'axis', 'anchor', 'anchorZ', 'perspective'])
      param(m, id + ':perspective', 'Perspective', 'perspective', 'number', '1')
    }
    for (const [j, arg] of m.args.entries()) {
      const key = `${id}:${j}`, title = name.replace(/([A-Z])/g, ' $1') + (arg.label ? ' · ' + arg.label : '')
      if (STYLE_OPTIONS[name] && !arg.label) replace(key, title, arg.value, 'select', STYLE_OPTIONS[name])
      if (['saturation', 'contrast', 'grayscale', 'minimumScaleFactor', 'trim'].includes(name)) replace(key, title, arg.value, 'number', undefined, 0, ['grayscale', 'minimumScaleFactor', 'trim'].includes(name) ? 1 : undefined)
      if (['brightness', 'layoutPriority'].includes(name)) replace(key, title, arg.value, 'number')
      if (['kerning', 'baselineOffset', 'listRowSpacing', 'listSectionSpacing', 'position'].includes(name)) replace(key, title, arg.value, 'pt')
      if (['allowsHitTesting', 'accessibilityHidden', 'allowsTightening', 'fixedSize'].includes(name)) replace(key, title, arg.value, 'toggle')
      if (['accessibilityValue', 'accessibilityHint'].includes(name)) replace(key, title, arg.value, 'text')
      // An inset bar's edge (Wave 4c): top or bottom, or leading or trailing, as its alignment takes one of them.
      if (name === 'safeAreaInset' && arg.label === 'edge') replace(key, title, arg.value, 'select', arg.value.kind === 'memberAccess' && ['leading', 'trailing'].includes(arg.value.member) ? ['leading', 'trailing'] : ['top', 'bottom'])
      if (name === 'frame' && ['maxWidth', 'maxHeight'].includes(arg.label ?? '') && arg.value.kind === 'memberAccess' && !arg.value.base && arg.value.member === 'infinity') add(key + ':bound', title, 'pt', '', v => ({ ...arg.value.span, text: v }), undefined, 0)
      if (name === 'colorMultiply') replace(key, 'Multiply color', arg.value, 'select', colors, undefined, undefined, 'Color.')
      if (name === 'scaleEffect') replace(key, arg.label ? `Scale ${arg.label}` : 'Scale', arg.value, 'number')
      if (name === 'aspectRatio') { if (arg.label === 'contentMode') replace(key, 'Content mode', arg.value, 'select', ['fit', 'fill']); else replace(key, 'Aspect ratio', arg.value, 'number', undefined, 0.001) }
      if (name === 'scaleEffect' && arg.value.kind === 'call' && arg.value.callee.kind === 'identifier' && arg.value.callee.name === 'CGSize') for (const dimension of arg.value.args) if (['width', 'height'].includes(dimension.label ?? '')) replace(key + ':' + dimension.label, dimension.label === 'width' ? 'Horizontal scale' : 'Vertical scale', dimension.value, 'number')
      if (['rotation3DEffect', 'hueRotation', 'rotationEffect'].includes(name) && arg.value.kind === 'call' && arg.value.callee.kind === 'identifier' && arg.value.callee.name === 'Angle') for (const angle of arg.value.args) if (['degrees', 'radians'].includes(angle.label ?? '')) replace(key + ':angle', `Angle (${angle.label})`, angle.value, angle.label === 'degrees' ? '°' : 'number')
      if (['rotation3DEffect', 'hueRotation', 'rotationEffect'].includes(name) && arg.value.kind === 'call' && arg.value.callee.kind === 'memberAccess' && ['degrees', 'radians'].includes(arg.value.callee.member) && arg.value.args[0]) replace(key + ':angle', 'Angle (' + arg.value.callee.member + ')', arg.value.args[0].value, arg.value.callee.member === 'degrees' ? '°' : 'number')
      if (['foregroundStyle', 'background', 'fill'].includes(name) && !arg.label && m.args.length === 1 && !m.trailingClosure) fill(name, arg.value, key)
    }
    if (name === 'fixedSize' && !m.args.length) for (const axis of ['horizontal', 'vertical']) add(id + ':' + axis, `Ideal ${axis} size`, 'toggle', 'true', v => ({ start: m.callee.span.end, end: m.span.end, text: `(horizontal: ${axis === 'horizontal' ? v : 'true'}, vertical: ${axis === 'vertical' ? v : 'true'})` }))
  }
}
