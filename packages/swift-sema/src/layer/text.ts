import { DESIGN_NEEDS_SYSTEM, TEXT_STYLES, TEXT_STYLE_POINTS, isConditional, type ColorValue, type Conditional, type FontValue, type LayerChange, type LayerText, type LayerValue } from '@studio/shared'
import type { CallExpr, Expr, VarDecl } from '@studio/swift-syntax'
import { modifierName } from '../authoring-border'
import { SLOT } from '../authoring-modifiers'
import { keepsText } from '../builtins'
import { literalText, swiftString } from '../design-controls'
import { STYLE_OPTIONS } from '../design-advanced-controls'
import { insertCalls, insertionIndex, lineEnding, lineStart, replaceRun, type Patch } from './chain-edit'
import { colorSource, keptColor, readColor, sameColor } from './color'
import { callsNamed, type ChainSlots, type SlotRun } from './slots'
import { runRefusal, type LayerContext } from './context'
import { casesOf, isToken, keepCondition, numberOf, sourceOf } from './values'
import { FONT_HOSTS, declarationOf, literalNumber, resolveConstant } from './tokens'

/**
 * Text: the font, colour, alignment, spacing and case of a view that shows text.
 *
 * A font reads as one value however it is written: `.title2.bold()`, `.system(size:
 * weight:design:)`, or a style with `.fontWeight` and `.fontDesign` beside it. A size that
 * follows Dynamic Type is an `@ScaledMetric` property of the view, which is how SwiftUI
 * scales a size in points as the reader's text size changes.
 */

/** Views that draw text themselves, which a text section sets. */
export const TEXT_VIEWS: ReadonlySet<string> = new Set(['Text', 'Label', 'Button', 'TextField', 'SecureField', 'TextEditor', 'Link', 'Toggle', 'Menu', 'NavigationLink', 'Stepper', 'DatePicker', 'Picker', 'LabeledContent'])

const WEIGHTS = STYLE_OPTIONS.fontWeight!
const DESIGNS = STYLE_OPTIONS.fontDesign!

const CODE = 'Change it in Code.'

/** A contextual member's name, `.semibold` or `Font.Weight.semibold`, when it is one of `names`. */
function memberIn(value: Expr | undefined, names: readonly string[]): string | undefined {
  return value?.kind === 'memberAccess' && names.includes(value.member) ? value.member : undefined
}

/** An `@ScaledMetric` property of the view's struct: its size and the style whose curve it follows. */
export interface ScaledSize {
  readonly decl: VarDecl
  readonly size: number
  readonly relativeTo: string
}

export function scaledSize(name: string, ctx: LayerContext): ScaledSize | undefined {
  const decl = ctx.owner?.members.find((member): member is VarDecl => member.kind === 'varDecl' && member.name === name)
  const attribute = decl?.attributes.find(attribute => attribute.name === 'ScaledMetric')
  if (!decl || !attribute || !decl.initializer) return undefined
  const size = numberOf(decl.initializer, ctx)
  if (size === undefined) return undefined
  const relative = attribute.args.find(arg => arg.label === 'relativeTo')?.value
  const relativeTo = relative ? memberIn(relative, TEXT_STYLES) : 'body'
  return relativeTo ? { decl, size, relativeTo } : undefined
}

/**
 * A `Font` expression as the parts the panel sets, or undefined for one it cannot rewrite.
 * `declared` reads one where a constant is declared (Wave 3b), in a file whose text this
 * view's is not: its numbers off the syntax, and no `@ScaledMetric` of the view's.
 */
function fontOf(value: Expr, ctx: LayerContext, declared = false): FontValue | undefined {
  // `.title2.bold()`, `.headline.weight(.semibold)`, `.body.italic()`, `.title.monospaced()`; `Font.system(…)` is read below.
  const onFont = (expr: Expr | null) => expr?.kind === 'identifier' && expr.name === 'Font'
  if (value.kind === 'call' && value.callee.kind === 'memberAccess' && value.callee.base && !onFont(value.callee.base) && !value.trailingClosure) {
    const base = fontOf(value.callee.base, ctx, declared)
    if (!base) return undefined
    const member = value.callee.member, args = value.args
    if (member === 'bold' && !args.length) return { ...base, weight: 'bold' }
    if (member === 'italic' && !args.length) return { ...base, italic: true }
    if (member === 'monospaced' && !args.length) return { ...base, design: 'monospaced' }
    const weight = member === 'weight' && args.length === 1 && args[0]!.label === null ? memberIn(args[0]!.value, WEIGHTS) : undefined
    if (weight) return { ...base, weight }
    if (value.callee.base.kind !== 'memberAccess' || value.callee.base.base) return undefined
  }
  if (value.kind === 'memberAccess') {
    const style = memberIn(value, TEXT_STYLES)
    const onFont = !value.base || value.base.kind === 'identifier' && value.base.name === 'Font'
    return style && onFont ? { style } : undefined
  }
  if (value.kind !== 'call' || value.trailingClosure || value.callee.kind !== 'memberAccess') return undefined
  const base = value.callee.base
  if (base && !onFont(base)) return undefined
  if (value.callee.member === 'custom') return familyOf(value, ctx, declared)
  if (value.callee.member !== 'system') return undefined
  const labels = value.args.map(arg => arg.label)
  const arg = (label: string | null) => value.args.find(item => item.label === label)?.value
  const weight = arg('weight'), design = arg('design')
  const parts: Partial<FontValue> = {
    ...(weight ? { weight: memberIn(weight, WEIGHTS) ?? '?' } : {}),
    ...(design ? { design: memberIn(design, DESIGNS) ?? '?' } : {}),
  }
  if (parts.weight === '?' || parts.design === '?') return undefined
  // `.system(.title3, design: .serif, weight: .bold)`.
  if (labels[0] === null) {
    const style = memberIn(arg(null), TEXT_STYLES)
    return style && labels.slice(1).every(label => label === 'design' || label === 'weight') ? { style, ...parts } : undefined
  }
  // `.system(size: 22, weight: .semibold, design: .rounded)`, the size a number or an `@ScaledMetric`.
  const size = arg('size')
  if (!size || labels.some(label => !['size', 'weight', 'design'].includes(label ?? ''))) return undefined
  const fixed = declared ? literalNumber(size) : numberOf(size, ctx)
  if (fixed !== undefined) return { style: null, size: fixed, relativeTo: null, ...parts }
  const scaled = size.kind === 'identifier' && !declared ? scaledSize(size.name, ctx) : undefined
  return scaled ? { style: null, size: scaled.size, relativeTo: scaled.relativeTo, ...parts } : undefined
}

/**
 * `.custom("Brand", size: 28, relativeTo: .title)` (Wave 6f): its family, in the style whose
 * own size it has or at a size that follows one. A plain `size:` follows Body from iOS 14 and
 * stays fixed below it, where a size a style has reads as that style; `fixedSize:` is fixed.
 */
function familyOf(value: CallExpr, ctx: LayerContext, declared: boolean): FontValue | undefined {
  const [name, size, relative, more] = value.args
  const face = name?.label === null ? literalText(name.value) : undefined
  const points = size && (declared ? literalNumber(size.value) : numberOf(size.value, ctx))
  if (face === undefined || points === undefined || more || !(size!.label === 'size' || size!.label === 'fixedSize' && !relative)) return undefined
  const follows = relative ? relative.label === 'relativeTo' ? memberIn(relative.value, TEXT_STYLES) : undefined : size!.label === 'size' && ctx.target >= 14 ? 'body' : null
  if (follows === undefined) return undefined
  const style = follows ? TEXT_STYLE_POINTS[follows] === points && follows : size!.label === 'size' && TEXT_STYLES.find(style => style !== 'headline' && TEXT_STYLE_POINTS[style] === points)
  return style ? { style, face } : { style: null, size: points, relativeTo: follows, face }
}

/** The font a text inherits from the views around it, when it is a plain style; Body otherwise. */
function inheritedFont(ctx: LayerContext): FontValue {
  const written = ctx.node.properties.find(property => property.id.endsWith(':inherited-font'))?.expression ?? ''
  const style = /^(?:Font)?\.(\w+)$/.exec(written.trim())?.[1]
  return { style: style && TEXT_STYLES.includes(style) ? style : 'body' }
}

function readFont(slots: ChainSlots, ctx: LayerContext): LayerValue<FontValue> {
  const fonts = callsNamed(slots, ['font'])
  const weights = callsNamed(slots, ['fontWeight', 'bold'])
  const designs = callsNamed(slots, ['fontDesign'])
  const italics = callsNamed(slots, ['italic'])
  const from = [...fonts, ...weights, ...designs, ...italics].sort((a, b) => a.indices[0]! - b.indices[0]!).map(run => ctx.ids[run.indices[0]!]!)
  const fallback = inheritedFont(ctx)
  if (!from.length) return { value: fallback, state: 'absent' }
  const code = (reason: string): LayerValue<FontValue> => ({ value: fallback, state: 'code', from, disabledReason: `${reason} ${CODE}` })
  if (fonts.length > 1) return code('This text’s font is set in more than one place.')
  const written = fonts[0]?.calls[0]
  const argument = written && written.args.length === 1 && written.args[0]!.label === null && !written.trailingClosure ? written.args[0]!.value : undefined
  const font = !written ? { style: fallback.style } : argument && (fontOf(argument, ctx) ?? fontToken(argument, ctx))
  if (!font) return code(familyWorkedOut(argument) ? 'This text’s font family is worked out in Swift.' : 'This text’s font is worked out in Swift.')
  // A family behind a token is shown as it is, with its name (Wave 3b): the token writers set no family, so the panel can't edit it there (Wave 6f).
  if (font.face && font.token) return { value: font, state: 'code', from, disabledReason: `This text’s font, ${font.token}, is in the ${font.face} family, which a text style token doesn’t set. ${CODE}` }
  const one = (runs: SlotRun[], read: (call: CallExpr) => string | boolean | undefined, field: 'weight' | 'design' | 'italic') => {
    if (!runs.length) return undefined
    if (runs.length > 1 || font[field] !== undefined) return null
    const value = read(runs[0]!.calls[0]!)
    return value === undefined ? null : value
  }
  const weight = one(weights, call => modifierName(call) === 'bold' ? (call.args.length ? undefined : 'bold') : call.args.length === 1 ? memberIn(call.args[0]!.value, WEIGHTS) : undefined, 'weight')
  const design = one(designs, call => call.args.length === 1 ? memberIn(call.args[0]!.value, DESIGNS) : undefined, 'design')
  const italic = one(italics, call => call.args.length ? undefined : true, 'italic')
  if (weight === null || design === null || italic === null) return code('This text’s weight, design or italic is set in more than one place, or worked out in Swift.')
  // A design on or beside a family is one the panel doesn't show, and an edit would take it away (Wave 6f).
  if (font.face && (font.design !== undefined || design !== undefined)) return code('This text sets a design beside its font family, which the panel doesn’t show.')
  return {
    value: { ...font, ...(weight !== undefined ? { weight: weight as string } : {}), ...(design !== undefined ? { design: design as string } : {}), ...(italic !== undefined ? { italic: true } : {}) },
    state: font.token ? 'token' : 'literal', from,
  }
}

/**
 * Whether a font is `.custom(…)` whose family is not a plain string, `.custom(family, size:
 * 17)` or `.custom("Brand\(name)", …)`, under any modifiers on it (Wave 6f).
 */
function familyWorkedOut(value: Expr | undefined): boolean {
  while (value?.kind === 'call' && value.callee.kind === 'memberAccess' && value.callee.member !== 'custom' && value.callee.base) value = value.callee.base
  if (value?.kind !== 'call' || value.callee.kind !== 'memberAccess' || value.callee.member !== 'custom') return false
  const base = value.callee.base, name = value.args[0]
  return (!base || base.kind === 'identifier' && base.name === 'Font') && name?.label === null && literalText(name.value) === undefined
}

/**
 * A font read through a constant, `.font(.heading)` where `extension Font { static let
 * heading = Font.title2.bold() }`, or a static whose getter gives one, `static var heading:
 * Font { .title2.bold() }` (Wave 3b): what it is declared as, with its name and where it is
 * declared, when its declaration is a font the panel reads or a custom face it shows.
 */
function fontToken(value: Expr, ctx: LayerContext): FontValue | undefined {
  const written = sourceOf(ctx, value)
  if (!isToken(written)) return undefined
  const constant = resolveConstant(ctx.project, written, value.span, FONT_HOSTS, true)
  const font = constant && (fontOf(constant.initializer, ctx, true) ?? customFace(constant.initializer))
  if (font) ctx.linked.set(written, { declaration: declarationOf(ctx.project, constant!) })
  return font && { ...font, token: written }
}

/** `Font.custom("Avenir", size: 20)`, with `relativeTo:` or as `fixedSize:`: its face, and its size where it is a number. */
function customFace(value: Expr): FontValue | undefined {
  if (value.kind !== 'call' || value.trailingClosure || value.callee.kind !== 'memberAccess' || value.callee.member !== 'custom') return undefined
  const base = value.callee.base, [name, size] = value.args
  const face = name?.label === null ? literalText(name.value) : undefined
  if (base && !(base.kind === 'identifier' && base.name === 'Font') || face === undefined) return undefined
  const points = size && (size.label === 'size' || size.label === 'fixedSize') ? literalNumber(size.value) : undefined
  return { style: null, ...points !== undefined ? { size: points } : {}, face }
}

/** A text modifier that takes one value: `.tracking(1)`, `.textCase(.uppercase)`. */
function readOne<T>(slots: ChainSlots, names: readonly string[], ctx: LayerContext, read: (value: Expr) => T | undefined, word: string): LayerValue<T | null> {
  const runs = callsNamed(slots, names)
  if (!runs.length) return { value: null, state: 'absent' }
  const from = runs.map(run => ctx.ids[run.indices[0]!]!)
  const call = runs[0]!.calls[0]!
  const value = runs.length === 1 && call.args.length === 1 && call.args[0]!.label === null && !call.trailingClosure && modifierName(call) === names[0] ? read(call.args[0]!.value) : undefined
  if (value === undefined) return { value: null, state: 'code', from, disabledReason: `This text’s ${word} is set in more than one place or worked out in Swift. ${CODE}` }
  return { value, state: 'literal', from }
}

const number = (ctx: LayerContext) => (value: Expr) => numberOf(value, ctx)

/** The modifiers that colour text: `.foregroundStyle` from iOS 15, and the older `.foregroundColor`. */
const COLOR_CALLS = ['foregroundStyle', 'foregroundColor']

/** The text's colour, from its one foreground style or colour, however the colour is spelled. */
function readTextColor(slots: ChainSlots, ctx: LayerContext): LayerValue<ColorValue | Conditional<ColorValue> | null> {
  const runs = callsNamed(slots, COLOR_CALLS)
  if (!runs.length) return { value: null, state: 'absent' }
  const from = runs.map(run => ctx.ids[run.indices[0]!]!)
  const call = runs[0]!.calls[0]!
  if (runs.length > 1) return { value: null, state: 'code', from, disabledReason: `This text’s color is set in more than one place. ${CODE}` }
  if (call.args.length !== 1 || call.args[0]!.label !== null || call.trailingClosure) return { value: null, state: 'code', from, disabledReason: `This text’s color has more than one level. ${CODE}` }
  const value = call.args[0]!.value
  if (value.kind !== 'ternary') return { ...readColor(value, ctx), from }
  // Two colours a condition chooses between (Wave 3b), each read as one is.
  const { condition, then, otherwise } = casesOf(value, ctx, branch => readColor(branch, ctx))!
  if (then.state === 'code' || otherwise.state === 'code') return { value: null, state: 'code', from, disabledReason: then.disabledReason ?? otherwise.disabledReason }
  return { value: { condition, then: then.value, otherwise: otherwise.value }, state: then.state === 'token' || otherwise.state === 'token' ? 'token' : 'literal', from }
}

/** Each branch's colour as written, which a change that keeps it keeps. */
function branchesWritten(slots: ChainSlots, ctx: LayerContext): { then: string; otherwise: string } | undefined {
  const value = callsNamed(slots, COLOR_CALLS)[0]?.calls[0]?.args[0]?.value
  return value?.kind === 'ternary' ? { then: sourceOf(ctx, value.then), otherwise: sourceOf(ctx, value.else) } : undefined
}

export function readText(slots: ChainSlots, ctx: LayerContext): LayerText | undefined {
  if (!TEXT_VIEWS.has(ctx.node.name)) return undefined
  // A run of joined text is part of a paragraph: its alignment, spacing and case are the whole text's (Wave 3a).
  const paragraph = <T>(value: LayerValue<T | null>, word: string): LayerValue<T | null> => ctx.run ? { ...value, disabledReason: runRefusal(`Set its ${word} on the whole text, in parentheses, in Code.`) } : value
  return {
    font: readFont(slots, ctx),
    color: readTextColor(slots, ctx),
    alignment: paragraph(readOne(slots, ['multilineTextAlignment'], ctx, value => memberIn(value, ['leading', 'center', 'trailing']) as 'leading' | 'center' | 'trailing' | undefined, 'alignment'), 'alignment'),
    tracking: readOne(slots, ['tracking', 'kerning'], ctx, number(ctx), 'letter spacing'),
    lineSpacing: paragraph(readOne(slots, ['lineSpacing'], ctx, number(ctx), 'line spacing'), 'line spacing'),
    textCase: paragraph(readOne(slots, ['textCase'], ctx, value => memberIn(value, STYLE_OPTIONS.textCase!) as 'uppercase' | 'lowercase' | undefined, 'case'), 'case'),
    ...(ctx.target < 14 ? { scalingUnavailable: 'Scaling with text size needs iOS 14. Raise the deployment target to use it.' } : {}),
  }
}

// ---------------------------------------------------------------- writing

/** The calls that write a font: the font itself, and on iOS 16 and later its weight, design and italic beside it. */
export function fontCalls(font: FontValue, inherited: string, size: string | null, ctx: LayerContext): string[] {
  const separate = ctx.target >= 16, separateDesign = ctx.target >= 16.1
  // A weight is written unless it is the one the style already has: Headline's is semibold, and a family's regular.
  const weight = font.weight && font.weight !== (font.style === 'headline' && !font.face ? 'semibold' : 'regular') ? font.weight : undefined
  const design = font.design && font.design !== 'default' ? font.design : undefined
  if (font.face) {
    // A family keeps the style as the size it follows from iOS 14 (Wave 6f); below it a custom font's size is fixed.
    const name = swiftString(font.face), follows = font.style ?? font.relativeTo, points = font.style ? TEXT_STYLE_POINTS[font.style] : size
    const base = `.custom(${name}, ${ctx.target < 14 ? `size: ${points}` : follows ? `size: ${points}, relativeTo: .${follows}` : `fixedSize: ${points}`})`
    return [`.font(${base}${separate ? '' : `${weight ? `.weight(.${weight})` : ''}${font.italic ? '.italic()' : ''}`})`, ...separate && weight ? [`.fontWeight(.${weight})`] : [], ...separate && font.italic ? ['.italic()'] : []]
  }
  if (font.style !== null) {
    const folded = !separate && (weight || font.italic) || !separateDesign && design
    let base = design && !separateDesign ? `.system(.${font.style}, design: .${design})` : `.${font.style}`
    if (!separate) base += `${weight ? `.weight(.${weight})` : ''}${font.italic ? '.italic()' : ''}`
    const calls = font.style === inherited && !folded ? [] : [`.font(${base})`]
    if (separate && weight) calls.push(`.fontWeight(.${weight})`)
    if (separateDesign && design) calls.push(`.fontDesign(.${design})`)
    if (separate && font.italic) calls.push('.italic()')
    return calls
  }
  // A size in points takes its weight and design as the system font's own arguments, as old as the font.
  const parts = [`size: ${size}`, ...weight ? [`weight: .${weight}`] : [], ...design ? [`design: .${design}`] : []]
  return [`.font(.system(${parts.join(', ')})${!separate && font.italic ? '.italic()' : ''})`, ...separate && font.italic ? ['.italic()'] : []]
}

/** How often a name is read in the struct, besides where it is declared. */
function readsOf(name: string, ctx: LayerContext): number {
  const owner = ctx.owner
  if (!owner) return 0
  const body = ctx.text.slice(owner.span.start, owner.span.end)
  return (body.match(new RegExp(`\\b${name}\\b`, 'g'))?.length ?? 0) - 1
}

/** A name for a new `@ScaledMetric` that nothing in the struct already uses. */
function freshName(ctx: LayerContext): string {
  const body = ctx.owner ? ctx.text.slice(ctx.owner.span.start, ctx.owner.span.end) : ''
  for (let index = 1; ; index++) {
    const name = index === 1 ? 'textSize' : `textSize${index}`
    if (!new RegExp(`\\b${name}\\b`).test(body)) return name
  }
}

/** The `@ScaledMetric` a font's size reads, when it reads one. */
function scaledIn(slots: ChainSlots, ctx: LayerContext): (ScaledSize & { name: string }) | undefined {
  const font = callsNamed(slots, ['font'])[0]?.calls[0]?.args[0]?.value
  const size = font?.kind === 'call' ? font.args.find(arg => arg.label === 'size')?.value : undefined
  const scaled = size?.kind === 'identifier' ? scaledSize(size.name, ctx) : undefined
  return scaled && size?.kind === 'identifier' ? { ...scaled, name: size.name } : undefined
}

function writeFont(slots: ChainSlots, change: Partial<FontValue>, ctx: LayerContext): Patch[] {
  const current = readFont(slots, ctx)
  if (current.disabledReason) throw new Error(current.disabledReason)
  // A font read through a constant is written as the font itself, at this text only (Detach, Wave 3b).
  const { token: _token, face: wasFace, ...was } = current.value, { token: _asked, face: askedFace, ...asked } = change
  // A family (Wave 6f): System, null, takes it away, and a font file has its own design, which the font is written without.
  const face = askedFace === undefined ? wasFace : askedFace
  if (face !== null && face !== undefined && !face.trim()) throw new Error('Choose a font family.')
  if (face && asked.design && asked.design !== 'default') throw new Error(DESIGN_NEEDS_SYSTEM)
  const next: FontValue = { ...was, ...asked, ...face ? { face } : {} }
  if (next.style !== null && next.style !== undefined && !TEXT_STYLES.includes(next.style)) throw new Error('Choose one of the text styles.')
  if (next.style === null && !(typeof next.size === 'number' && next.size > 0)) throw new Error('A font size is more than 0 points.')
  if (next.style === null && next.relativeTo && !TEXT_STYLES.includes(next.relativeTo)) throw new Error('Choose the text style the size follows.')
  const scaled = scaledIn(slots, ctx)
  const shared = scaled && readsOf(scaled.name, ctx) > 1
  const patches: Patch[] = []
  let size: string | null = null
  if (next.style === null && next.relativeTo && ctx.target < 14) throw new Error('A size that follows Dynamic Type needs iOS 14. Choose a text style, or a fixed size.')
  if (next.style === null && next.relativeTo && !next.face) {
    const declaration = `@ScaledMetric(relativeTo: .${next.relativeTo}) private var `
    if (scaled) {
      if (shared && (scaled.size !== next.size || scaled.relativeTo !== next.relativeTo)) throw new Error('This size is shared with other text in this view. Change it in Code.')
      size = scaled.name
      const start = scaled.decl.attributes[0]?.span.start ?? scaled.decl.span.start
      patches.push({ start, end: scaled.decl.span.end, text: `${declaration}${scaled.name}: CGFloat = ${next.size}`, declaration: true })
    } else {
      const owner = ctx.owner, body = owner?.members.find((member): member is VarDecl => member.kind === 'varDecl' && member.name === 'body')
      if (!owner || !body) throw new Error('A size that follows Dynamic Type is a property of the view. Choose a fixed size, or a text style.')
      size = freshName(ctx)
      const at = lineStart(ctx.text, body.attributes[0]?.span.start ?? body.span.start)
      const indent = /^[ \t]*/.exec(ctx.text.slice(at))![0], eol = lineEnding(ctx.text)
      patches.push({ start: at, end: at, text: `${indent}${declaration}${size}: CGFloat = ${next.size}${eol}`, declaration: true })
    }
  } else {
    if (next.style === null) size = String(next.size)
    // The size no longer reads its @ScaledMetric: one nothing else reads goes with it.
    if (scaled && !shared) {
      const start = lineStart(ctx.text, scaled.decl.attributes[0]?.span.start ?? scaled.decl.span.start)
      const end = ctx.text.indexOf('\n', scaled.decl.span.end) + 1
      patches.push({ start, end: end || scaled.decl.span.end, text: '', declaration: true })
    }
  }
  const calls = fontCalls(next, inheritedFont(ctx).style ?? 'body', size, ctx)
  const runs = [...callsNamed(slots, ['font']), ...callsNamed(slots, ['fontWeight', 'bold']), ...callsNamed(slots, ['fontDesign']), ...callsNamed(slots, ['italic'])].sort((a, b) => a.indices[0]! - b.indices[0]!)
  if (!runs.length) {
    if (!calls.length) return patches
    if (ctx.locked) throw new Error(ctx.locked)
    return [...patches, insertCalls(slots, insertionIndex(slots, SLOT.text), calls, ctx.text)]
  }
  return [...patches, replaceRun(slots, runs[0]!, calls, ctx.text), ...runs.slice(1).map(run => replaceRun(slots, run, [], ctx.text))]
}

/** Where a new Text-only modifier goes below iOS 16: while the chain is still a `Text` (`keepsText`). */
function textOnlyIndex(slots: ChainSlots, target: number): number {
  let index = 0
  while (index < slots.names.length && keepsText(slots.names[index]!, target)) index++
  return index
}

type TextChange = Extract<LayerChange, { section: 'text' }>
const SIMPLE: readonly { readonly field: 'tracking' | 'alignment' | 'lineSpacing' | 'textCase'; readonly names: readonly string[]; readonly call: (value: string | number) => string; readonly textOnly?: true }[] = [
  { field: 'tracking', names: ['tracking', 'kerning'], call: value => `.tracking(${value})`, textOnly: true },
  { field: 'alignment', names: ['multilineTextAlignment'], call: value => `.multilineTextAlignment(.${value})` },
  { field: 'lineSpacing', names: ['lineSpacing'], call: value => `.lineSpacing(${value})` },
  { field: 'textCase', names: ['textCase'], call: value => `.textCase(.${value})` },
]

/**
 * The call that colours the text: `.foregroundStyle(.red)` from iOS 15, and `.foregroundColor(Color.red)`
 * before it. Below iOS 16 a `foregroundColor` in a Text's own run stays one: it keeps the
 * Text a Text, for the Text-only modifiers after it and any written with it.
 */
function colorCall(slots: ChainSlots, color: ColorValue | Conditional<ColorValue>, ctx: LayerContext, before: LayerValue<ColorValue | Conditional<ColorValue> | null>): string {
  const at = callsNamed(slots, COLOR_CALLS)[0]?.indices[0]
  const staysText = ctx.target < 16 && ctx.node.name === 'Text' && at !== undefined && slots.names[at] === 'foregroundColor' && at < textOnlyIndex(slots, ctx.target)
  // A run of joined text must stay a Text, which `foregroundStyle` keeps it only from iOS 17 (Wave 3a).
  const style = ctx.run ? keepsText('foregroundStyle', ctx.target) : ctx.target >= 15 && !staysText
  if (isConditional(color)) {
    // Both cases as `Color`, which a generic style can take from a condition; a case left as it was keeps its spelling.
    const was = isConditional(before.value) ? before.value : undefined, written = branchesWritten(slots, ctx)
    const choice = `${color.condition} ? ${keptColor(color.then, was?.then, written?.then, 'Color', ctx)} : ${keptColor(color.otherwise, was?.otherwise, written?.otherwise, 'Color', ctx)}`
    return style ? `.foregroundStyle(${choice})` : `.foregroundColor(${choice})`
  }
  return style ? `.foregroundStyle(${colorSource(color, 'ShapeStyle', ctx)})` : `.foregroundColor(${colorSource(color, 'Color', ctx)})`
}

/** Whether two text colours are the same, each case of a condition included. */
const sameTextColor = (a: ColorValue | Conditional<ColorValue>, b: ColorValue | Conditional<ColorValue>) => isConditional(a) || isConditional(b)
  ? isConditional(a) && isConditional(b) && a.condition === b.condition && sameColor(a.then, b.then) && sameColor(a.otherwise, b.otherwise)
  : sameColor(a, b)

export function writeText(slots: ChainSlots, change: TextChange, ctx: LayerContext): Patch[] {
  const current = readText(slots, ctx)
  if (!current) throw new Error('This view shows no text of its own.')
  const patches: Patch[] = change.font ? writeFont(slots, change.font, ctx) : []
  const added: string[] = [], textOnly: string[] = []
  if (change.color !== undefined) {
    const now = current.color
    if (now.disabledReason) throw new Error(now.disabledReason)
    const next = change.color
    // A condition stays as written: only each case changes (Wave 3b).
    keepCondition(now.value, next, 'color')
    const same = next === null ? now.value === null : now.value !== null && sameTextColor(now.value, next)
    const written = same ? undefined : next === null ? [] : [colorCall(slots, next, ctx, now)]
    const run = callsNamed(slots, COLOR_CALLS)[0]
    if (written && run) patches.push(replaceRun(slots, run, written, ctx.text))
    else if (written) added.push(...written)
  }
  for (const { field, names, call, textOnly: onlyText } of SIMPLE) {
    const value = change[field]
    if (value === undefined) continue
    const now = current[field]
    if (now.disabledReason) throw new Error(now.disabledReason)
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Enter a number.')
    const written = value === null ? [] : [call(typeof value === 'number' ? Number(value.toFixed(2)) : value)]
    const run = callsNamed(slots, names)[0]
    if (run) patches.push(replaceRun(slots, run, written, ctx.text))
    else if (written.length) (onlyText && ctx.target < 16 ? textOnly : added).push(...written)
  }
  if ((added.length || textOnly.length) && ctx.locked) throw new Error(ctx.locked)
  if (textOnly.length && ctx.node.name !== 'Text') throw new Error('Letter spacing on this view needs iOS 16. Set it on its Text, or raise the deployment target.')
  if (textOnly.length) patches.push(insertCalls(slots, textOnlyIndex(slots, ctx.target), textOnly, ctx.text))
  if (added.length) patches.push(insertCalls(slots, insertionIndex(slots, SLOT.text), added, ctx.text))
  return mergeInserts(patches)
}

/** Insertions at one place written as one, in the order they were made. */
function mergeInserts(patches: readonly Patch[]): Patch[] {
  const out: Patch[] = []
  for (const patch of patches) {
    const same = out.find(other => other.start === patch.start && other.end === patch.start && patch.start === patch.end && !other.declaration && !patch.declaration)
    if (same) out[out.indexOf(same)] = { ...same, text: same.text + patch.text }
    else out.push(patch)
  }
  return out
}
