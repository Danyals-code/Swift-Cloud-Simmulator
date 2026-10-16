import { CONTAINER_WORDS, SYMBOL_RENDERING_MODES, isContainerLayout, isSymbolRenderingMode, needsNewerIOS, stackLayoutOf, symbolDefinition, type AuthoringNode, type SourceSpan } from '@studio/shared'
import { Parser, type CallExpr, type Expr } from '@studio/swift-syntax'
import type { AddControl } from './design-advanced-controls'
import { CHANGE_IN_CODE, SYSTEM_COLORS, literalText, memberChain, merged, type ControlKind, type ControlRecipe } from './design-controls'
import { HELD, OWN_MODIFIER, writeAfter } from './design-sheet-controls'
import { setAround } from './design-content-controls'
import { modifierName } from './authoring-border'
import { dotOf, modifierSegment } from './authoring-modifiers'
import type { Patch } from './layer/chain-edit'

/**
 * Wave 6b's fields for a symbol Image: its Rendering, `.symbolRenderingMode`, with Palette's
 * two colours in `.foregroundStyle(a, b)`, and Filled, `.symbolVariant(.fill)`. Both are
 * iOS 15's.
 */

/** A mode as Rendering names it, Palette for `.palette`. */
const titled = (mode: string) => mode[0]!.toUpperCase() + mode.slice(1)
/** Each mode, and Automatic, which is no mode written: iOS's own choice for the symbol. */
const RENDERING_OPTIONS = ['Automatic', ...SYMBOL_RENDERING_MODES.map(titled)]
/** The modifiers that return an Image, which a modifier returning a view can't come before. */
const IMAGE_MODIFIERS: ReadonlySet<string> = new Set(['resizable', 'renderingMode', 'interpolation', 'antialiased', 'symbolRenderingMode'])
/** The two spellings of the style a symbol is painted in, which the preview reads alike. */
const STYLE_MODIFIERS: readonly string[] = ['foregroundStyle', 'foregroundColor']
/** Palette's second colour, where only one is written: a grey that reads as a symbol's backing. */
const SECOND_COLOR = 'Color.gray'
const IN_CODE = 'Shown as the code writes it.'
const RENDERING_DESCRIPTION = 'Hierarchical shades the symbol’s layers from one color, and Palette gives them a color each. Multicolor draws the symbol’s own colors. Automatic is what iOS picks.'
const FILL_DESCRIPTION = 'Draws the filled version of the symbol, where it has one.'

/** What `symbolControls` reads a symbol Image from, and writes its controls with. */
export interface SymbolControlsInput {
  readonly node: AuthoringNode
  /** The Image's whole chain, and the `Image(systemName:)` call it starts at. */
  readonly expr: Expr
  readonly base: CallExpr
  readonly modifiers: readonly CallExpr[]
  readonly text: string
  readonly target: number
  /** Whether a modifier returning a view can be written after the Image's own: not after one of the project's own. */
  readonly appendable: boolean
  readonly colors: readonly string[]
  readonly add: AddControl
  readonly byId?: (id: string | undefined) => AuthoringNode | undefined
}

/** A control's fields beyond its value, by name. */
interface ControlFields {
  readonly options?: readonly string[]
  readonly description?: string
  readonly origin?: SourceSpan
  readonly disabledReason?: string
  readonly problem?: ControlRecipe['problem']
}

/** How many styles a style modifier gives a symbol, as the preview counts them: its arguments with no label. */
const styleCount = (call: CallExpr) => call.args.filter(arg => arg.label === null).length

/** The same, for a style modifier set on a view around the Image, read from its Swift, `.foregroundStyle(.red, .blue)`. */
function writtenStyleCount(expression: string): number {
  const value = Parser.parse(`let __style = __view${expression}\n`, '__style.swift').sourceFile.declarations[0]
  const call = value?.kind === 'varDecl' ? value.initializer : null
  return call?.kind === 'call' ? styleCount(call) : 0
}

/** Why a control is read only where a view around the Image sets what it shows. */
function aroundReason(view: AuthoringNode): string {
  const layout = stackLayoutOf(view.name) ?? view.name
  return `Set on the ${isContainerLayout(layout) ? CONTAINER_WORDS[layout] : view.name} around it. Change it there.`
}

/**
 * A symbol Image's Rendering and Filled (Wave 6b), on `Image(systemName:)`. A mode or variant
 * is written straight after the Image and the modifiers on it that return an Image, so the
 * rest of the chain takes it as it took the Image. Palette writes its two colours with it,
 * keeping a colour already written as the first, and the other modes keep only that first.
 * Each reads what the preview draws: a mode or styles set on a view around the Image, or
 * styles written more than once, are shown read only, with the reason, as is anything else
 * Design can't rewrite as written.
 */
export function symbolControls(input: SymbolControlsInput): void {
  const { node, expr, base, modifiers, text, target, appendable, colors, add, byId } = input
  const raw = (span: SourceSpan) => text.slice(span.start, span.end)
  const safe = (span: SourceSpan) => !/\/\/|\/\*/.test(raw(span))
  const gate = target < 15 ? needsNewerIOS(15, 'set') : undefined
  const control = (id: string, label: string, kind: ControlKind, value: string, patch: ControlRecipe['patch'], fields: ControlFields = {}) =>
    add(id, label, kind, value, patch, fields.options, undefined, undefined, fields.description, fields.origin, fields.disabledReason, fields.problem)
  /** A control shown read only, with `reason`, that writes back what is at `at` unchanged. */
  const readOnly = (id: string, label: string, kind: ControlKind, value: string, at: SourceSpan, reason: string, fields: ControlFields = {}) =>
    control(id, label, kind, value, () => ({ ...at, text: raw(at) }), { origin: at, ...fields, disabledReason: reason })
  let lead = 0
  while (lead < modifiers.length && IMAGE_MODIFIERS.has(modifierName(modifiers[lead]!))) lead++
  const after = modifiers[lead - 1] ?? base, next = modifiers[lead]
  // On a line of its own where the modifier after it is on one, lined up with it.
  const dot = next && dotOf(next, text), indent = dot !== undefined && text.slice(after.span.end, dot).includes('\n') ? /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', dot) + 1, dot))![0] : undefined
  const insert = indent !== undefined ? (modifier: string): Patch => ({ start: after.span.end, end: after.span.end, text: `\n${indent}${modifier}` }) : writeAfter(text, after)
  /** What is written after the Image's own modifiers, one modifier after another. */
  const inserted = (written: readonly string[]): Patch[] => written.length ? [{ start: after.span.end, end: after.span.end, text: written.map(insert).map(patch => patch.text).join('') }] : []
  /** Whether a modifier can be written there: one of the project's own after it may need the Image itself. */
  const viewable = appendable || lead === modifiers.length
  const removal = (call: CallExpr) => modifierSegment(expr, text, call)

  // Rendering.
  const modes = modifiers.filter(m => modifierName(m) === 'symbolRenderingMode'), mode = modes[0]
  const styles = modifiers.filter(m => STYLE_MODIFIERS.includes(modifierName(m))), style = styles[0]
  // The styles as Palette rewrites them: plain arguments with no comment among them.
  const styleArgs = styles.length === 1 && !style!.trailingClosure && style!.args.every(a => a.label === null) && safe(style!.span) ? style!.args.map(a => a.value) : undefined
  const chain = mode && mode.args.length === 1 && mode.args[0]!.label === null && !mode.trailingClosure ? memberChain(mode.args[0]!.value, 'SymbolRenderingMode') : undefined
  const written = chain?.length === 1 && isSymbolRenderingMode(chain[0]) ? chain[0] : undefined
  const modeAround = !mode && byId ? setAround(node, byId, 'symbolRenderingMode') : undefined
  const styleAround = !mode && !modeAround && !style && byId ? setAround(node, byId, STYLE_MODIFIERS) : undefined
  /** Rendering shown read only, as the preview draws it. */
  const renderingShown = (value: string, at: SourceSpan, reason: string) => readOnly('symbol:rendering', 'Rendering', 'select', value, at, reason, { options: RENDERING_OPTIONS, description: RENDERING_DESCRIPTION })
  if (mode && (modes.length > 1 || !written)) {
    const at = mode.args[0]?.value.span ?? mode.span
    readOnly('symbol:rendering', 'Rendering', 'text', raw(at), at, `This symbol’s rendering is set in a way Design doesn’t write. ${CHANGE_IN_CODE}`, { description: IN_CODE })
  } else if (modeAround) {
    // A mode written around the Image is drawn, whatever its styles.
    const around = /^\.symbolRenderingMode\((?:SymbolRenderingMode)?\.(\w+)\)$/.exec(modeAround.modifier.expression.replace(/\s/g, ''))?.[1]
    if (isSymbolRenderingMode(around)) renderingShown(titled(around), modeAround.modifier.source, aroundReason(modeAround.view))
    else readOnly('symbol:rendering', 'Rendering', 'text', modeAround.modifier.expression, modeAround.modifier.source, aroundReason(modeAround.view), { description: IN_CODE })
  } else if (!mode && styles.length > 1) {
    // The style nearest the Image is the one drawn, and two or more of them in it are Palette.
    renderingShown(styleCount(style!) > 1 ? 'Palette' : 'Automatic', style!.span, `This symbol’s color is set more than once, and the one nearest it is drawn. ${CHANGE_IN_CODE}`)
  } else if (!mode && style && styleCount(style) > 2) {
    renderingShown('Palette', style.span, `This symbol’s three colors are set in a way Design doesn’t write. ${CHANGE_IN_CODE}`)
  } else if (!mode && style && styleCount(style) === 2 && !styleArgs) {
    renderingShown('Palette', style.span, `This symbol’s colors are set in a way Design doesn’t write. ${CHANGE_IN_CODE}`)
  } else if (styleAround && writtenStyleCount(styleAround.modifier.expression) > 1) {
    renderingShown('Palette', styleAround.modifier.source, aroundReason(styleAround.view))
  } else {
    // Two styles with no mode are Palette, as iOS draws them.
    const current = written ? titled(written) : styleArgs?.length === 2 && modifierName(style!) === 'foregroundStyle' ? 'Palette' : 'Automatic'
    /** Why `value` can't be written, beyond the gate. */
    const problem = (value: string): string | null => {
      if (value === 'Automatic' && mode && !removal(mode)) return HELD
      if (value === 'Palette' && current !== 'Palette' && style && (!styleArgs || !styleArgs.length || styleArgs.length > 2)) return `This symbol’s color is set in a way Palette doesn’t rewrite. ${CHANGE_IN_CODE}`
      if (value === 'Palette' && !style && !viewable) return OWN_MODIFIER
      return null
    }
    const patch = (value: string): Patch => {
      const patches: Patch[] = [], adding: string[] = []
      const chosen = value === 'Automatic' ? undefined : value.toLowerCase()
      if (mode && !chosen) { const at = removal(mode); if (at) patches.push({ ...at, text: '' }) }
      else if (mode) patches.push({ ...mode.args[0]!.value.span, text: `.${chosen}` })
      else if (chosen) adding.push(`.symbolRenderingMode(.${chosen})`)
      if (value === 'Palette' && current !== 'Palette') {
        if (!style) adding.push(`.foregroundStyle(Color.blue, ${SECOND_COLOR})`)
        else if (styleArgs?.length === 1) patches.push({ start: style.callee.kind === 'memberAccess' ? style.callee.memberSpan.start : style.span.start, end: style.span.end, text: `foregroundStyle(${raw(styleArgs[0]!.span)}, ${SECOND_COLOR})` })
      }
      // The other modes draw one colour: the second goes, so the code says what is drawn.
      if (value !== 'Palette' && current === 'Palette' && styleArgs?.length === 2) patches.push({ start: styleArgs[0]!.span.end, end: styleArgs[1]!.span.end, text: '' })
      return merged(text, [...patches, ...inserted(adding)])
    }
    control('symbol:rendering', 'Rendering', 'select', current, patch, { options: RENDERING_OPTIONS, description: RENDERING_DESCRIPTION, origin: mode?.span, disabledReason: gate, problem })
    // Palette's colours, where two are written as plain arguments.
    if (current === 'Palette' && styleArgs?.length === 2 && modifierName(style!) === 'foregroundStyle') styleArgs.forEach((color, index) => {
      const id = `symbol:palette:${index}`, label = index ? 'Secondary color' : 'Primary color'
      const named = /^(?:(?:SwiftUI\.)?Color)?\.(\w+)$|^(?:SwiftUI\.)?Color\(\.(\w+)\)$/.exec(raw(color.span).replace(/\s/g, '')), name = named?.[1] ?? named?.[2]
      if (name && colors.includes(name)) control(id, label, 'select', name, v => ({ ...color.span, text: SYSTEM_COLORS.includes(v) ? `Color(.${v})` : `Color.${v}` }), { options: colors, description: index ? 'The color of the symbol’s second layer, such as its circle.' : 'The color of the symbol’s main layer.', origin: color.span, disabledReason: gate })
      else readOnly(id, label, 'text', raw(color.span), color.span, `This color is worked out in Swift. ${CHANGE_IN_CODE}`, { description: IN_CODE })
    })
  }

  // Filled.
  const variants = modifiers.filter(m => modifierName(m) === 'symbolVariant'), variant = variants[0]
  const environment = modifiers.find(m => modifierName(m) === 'environment' && /^\\\.symbolVariants\b/.test(raw(m.args[0]?.value.span ?? m.span).replace(/\s/g, '')))
  const name = literalText(base.args[0]?.value)
  const parts = variants.length === 1 && variant!.args.length === 1 && !variant!.trailingClosure && safe(variant!.args[0]!.value.span) ? memberChain(variant!.args[0]!.value, 'SymbolVariants') : undefined
  /** Filled shown read only as a switch, on or off, with `reason`. */
  const fillShown = (on: boolean, reason: string, at: SourceSpan = node.source) => readOnly('symbol:fill', 'Filled', 'toggle', String(on), at, reason, { description: FILL_DESCRIPTION })
  // A name with fill among its parts is filled, person.crop.circle.fill.badge.checkmark too: its outline is another name.
  if (name?.split('.').includes('fill')) {
    const outline = name.split('.').filter(part => part !== 'fill').join('.')
    return fillShown(true, `‘${name}’ is the filled symbol. To switch Filled off, choose ${symbolDefinition(outline) ? `‘${outline}’` : 'its outline'} as the symbol.`)
  }
  if (environment || variants.length && !parts) {
    const set = environment ?? variant!
    const at = { ...set.span, start: set.callee.kind === 'memberAccess' ? set.callee.memberSpan.start : set.span.start }
    return readOnly('symbol:fill', 'Filled', 'text', raw(at), at, `This symbol’s variant is set in a way Filled doesn’t write. ${CHANGE_IN_CODE}`, { description: IN_CODE })
  }
  if (!variant) {
    const around = byId && setAround(node, byId, 'symbolVariant')
    if (around) return fillShown(/^\.symbolVariant\((?:SymbolVariants)?(?:\.\w+)*\.fill(?:\.\w+)*\)$/.test(around.modifier.expression.replace(/\s/g, '')), aroundReason(around.view), around.modifier.source)
    if (!viewable) return fillShown(false, OWN_MODIFIER)
    return control('symbol:fill', 'Filled', 'toggle', 'false', value => merged(text, inserted(value === 'true' ? ['.symbolVariant(.fill)'] : [])), { description: FILL_DESCRIPTION, disabledReason: gate })
  }
  const on = parts!.includes('fill'), at = variant.args[0]!.value.span
  control('symbol:fill', 'Filled', 'toggle', String(on), value => {
    const chosen = value === 'true' ? [...parts!.filter(part => part !== 'none'), 'fill'] : parts!.filter(part => part !== 'fill')
    const gone = !chosen.length && removal(variant)
    return gone ? { ...gone, text: '' } : { ...at, text: `.${chosen.join('.')}` }
  }, { description: FILL_DESCRIPTION, origin: variant.span, disabledReason: gate, problem: value => value === 'false' && parts!.every(part => part === 'fill') && !removal(variant) ? HELD : null })
}
