import { Parser, afterOffMarkers, forEachChild, hasHumanComment, offMarker, offMarkerText, offMarkersIn, type CallExpr, type Expr, type Node } from '@studio/swift-syntax'
import { CORNER_RADIUS_LABELS } from '@studio/shared'
import { viewCallChain } from './design-controls'

/**
 * A view's border (D8): an outline over the view that follows its corners, drawn
 * inside its edge, on it or outside it, as Figma draws a stroke.
 *
 * SwiftUI's `.border` is always square, so a border is written as a stroke of the view's
 * own shape laid over it:
 *
 *     .overlay {
 *         RoundedRectangle(cornerRadius: 12)
 *             .strokeBorder(Color.gray, lineWidth: 1)
 *     }
 *
 * `.stroke` puts it on the edge, and outside is a shape as much larger as the line is
 * wide, stroked inside and pulled out by its width. The Design panel shows it as one
 * setting on the view, never as a layer of its own, and an overlay a person wrote that
 * way, with the view's own corners, is read as one too.
 */

export type BorderPosition = 'inside' | 'center' | 'outside'
export const BORDER_POSITIONS: readonly BorderPosition[] = ['inside', 'center', 'outside']

/**
 * The shape a view's corners give it, as written: `radius`, each corner's radius in
 * `radii` and `style` are source, a number or a token.
 */
export interface Corners {
  readonly kind: 'rectangle' | 'rounded' | 'uneven' | 'capsule' | 'circle'
  readonly radius?: string
  /** An uneven rectangle's corners as written: `topLeadingRadius` and its radius. */
  readonly radii?: readonly (readonly [string, string])[]
  readonly style?: string
}

export interface Border {
  /** The colour as written: `Color.gray`, `.red`, a token. */
  readonly color: string
  readonly width: number
  readonly position: BorderPosition
}

/** A border found in a view's modifiers: what it looks like, and where its colour is written. */
export interface FoundBorder extends Border {
  readonly colorExpr: Expr
  /** Written as `.overlay(shape)` rather than `.overlay { shape }`, which a rewrite keeps. */
  readonly argument: boolean
}

/** A new border's look. */
export const NEW_BORDER: Border = { color: 'Color.gray', width: 1, position: 'inside' }

const modifierName = (call: CallExpr) => call.callee.kind === 'memberAccess' ? call.callee.member : ''
const source = (expr: Expr, text: string) => text.slice(expr.span.start, expr.span.end)

/**
 * The corners a view's modifiers give it: the last of its clip, `.cornerRadius` and a
 * rounded background, else square.
 */
export function cornersOf(modifiers: readonly CallExpr[], text: string): Corners {
  let corners: Corners = { kind: 'rectangle' }
  for (const modifier of modifiers) {
    const name = modifierName(modifier)
    const only = modifier.args.length === 1 && modifier.args[0]!.label === null ? modifier.args[0]!.value : undefined
    const drawn = modifier.trailingClosure?.body.statements.length === 1 && modifier.trailingClosure.body.statements[0]!.kind === 'exprStmt' ? modifier.trailingClosure.body.statements[0]!.expression : undefined
    const shape = name === 'clipShape' && only ? shapeCorners(only, text)
      : name === 'cornerRadius' && only ? { kind: 'rounded' as const, radius: source(only, text) }
      : name === 'background' ? shapeCorners(modifier.args.find(arg => arg.label === 'in')?.value ?? only ?? drawn, text)
      : name === 'buttonBorderShape' && only ? shapeCorners(only, text)
      : undefined
    if (shape) corners = shape
  }
  return corners
}

/** The corners of a shape: `.rect(cornerRadius: 12)`, `Capsule()`, `.circle`, or a shape view drawn in a background. */
function shapeCorners(shape: Expr | undefined, text: string): Corners | undefined {
  if (!shape) return undefined
  if (shape.kind === 'memberAccess' && !shape.base) return { rect: { kind: 'rectangle' as const }, capsule: { kind: 'capsule' as const }, circle: { kind: 'circle' as const } }[shape.member]
  const call = shape.kind === 'call' ? viewCallChain(shape)?.base : undefined
  if (!call || call.trailingClosure) return undefined
  const name = call.callee.kind === 'identifier' ? call.callee.name : call.callee.kind === 'memberAccess' && !call.callee.base ? `.${call.callee.member}` : ''
  if (['Rectangle', '.rect'].includes(name) && !call.args.length) return { kind: 'rectangle' }
  if (['Capsule', '.capsule'].includes(name) && !call.args.length) return { kind: 'capsule' }
  if (['Circle', '.circle'].includes(name) && !call.args.length) return { kind: 'circle' }
  const style = call.args.find(arg => arg.label === 'style')
  const styled = style ? { style: source(style.value, text) } : {}
  const corners = call.args.filter(arg => CORNER_RADIUS_LABELS.includes(arg.label ?? ''))
  if (['UnevenRoundedRectangle', '.rect'].includes(name) && corners.length && call.args.length === corners.length + (style ? 1 : 0)) {
    return { kind: 'uneven', radii: corners.map(arg => [arg.label!, source(arg.value, text)] as const), ...styled }
  }
  // `.buttonBorderShape(.roundedRectangle(radius: 12))`, the one border shape with a radius written.
  const radius = call.args.find(arg => arg.label === (name === '.roundedRectangle' ? 'radius' : 'cornerRadius'))
  if (!['RoundedRectangle', '.rect', '.roundedRectangle'].includes(name) || !radius || call.args.length !== (style ? 2 : 1)) return undefined
  return { kind: 'rounded', radius: source(radius.value, text), ...styled }
}

/** The shape a border in `position` is drawn as, on a view with these corners. */
function borderShape(corners: Corners, position: BorderPosition, width: number): string {
  if (corners.kind === 'capsule') return 'Capsule()'
  if (corners.kind === 'circle') return 'Circle()'
  if (corners.kind === 'rectangle') return 'Rectangle()'
  const radius = (written: string) => position === 'outside' ? grown(written, width) : written
  const style = corners.style ? `, style: ${corners.style}` : ''
  if (corners.kind === 'uneven') return `UnevenRoundedRectangle(${corners.radii!.map(([label, written]) => `${label}: ${radius(written)}`).join(', ')}${style})`
  return `RoundedRectangle(cornerRadius: ${radius(corners.radius!)}${style})`
}

/**
 * A radius as much larger as the line is wide, so an outside border's corners are
 * concentric; a square corner stays square.
 */
function grown(radius: string, width: number): string {
  const value = Number(radius)
  return /^\d+(?:\.\d+)?$/.test(radius) && Number.isFinite(value) ? String(value ? value + width : 0) : `${radius} + ${width}`
}

/** The border's own lines: its shape and the stroke that draws it. */
function borderLines(border: Border, corners: Corners): string[] {
  const stroke = border.position === 'center' ? 'stroke' : 'strokeBorder'
  return [
    borderShape(corners, border.position, border.width),
    `.${stroke}(${border.color}, lineWidth: ${border.width})`,
    ...(border.position === 'outside' ? [`.padding(-${border.width})`] : []),
  ]
}

/**
 * How a border is laid out: the overlay's closure on lines of its own under `indent`, the
 * indentation of the view's modifiers, its closure on one line, or its argument.
 */
export type BorderLayout = { readonly indent: string } | 'line' | 'argument'

/** The border written out. */
export function borderSource(border: Border, corners: Corners, layout: BorderLayout): string {
  const [shape, ...modifiers] = borderLines(border, corners)
  if (layout === 'argument') return `.overlay(${shape}${modifiers.join('')})`
  if (layout === 'line') return `.overlay { ${shape}${modifiers.join('')} }`
  return `.overlay {\n${layout.indent}    ${shape}\n${modifiers.map(line => `${layout.indent}        ${line}\n`).join('')}${layout.indent}}`
}

/** The layout a border was written in, which a rewrite keeps: `written` is its text, `lineIndent` its line's indentation. */
function layoutOf(found: FoundBorder, written: string, lineIndent: string): BorderLayout {
  return found.argument ? 'argument' : written.includes('\n') ? { indent: lineIndent } : 'line'
}

/** The indentation of the line `offset` is on. */
function lineIndentAt(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset))![0]
}

/** The border a modifier draws, when it is an overlay drawn the way a border is, with the view's own corners. */
export function borderOf(modifier: CallExpr, corners: Corners, text: string): FoundBorder | undefined {
  // A person's comment in it would be lost to a rewrite, so it stays an overlay of its own.
  if (modifierName(modifier) !== 'overlay' || hasHumanComment(text.slice(dotOf(modifier, text), modifier.span.end), 'border')) return undefined
  const closure = modifier.trailingClosure
  const content = closure && !modifier.args.length
    ? !closure.params.length && closure.body.statements.length === 1 && closure.body.statements[0]!.kind === 'exprStmt' ? closure.body.statements[0]!.expression : undefined
    : !closure && modifier.args.length === 1 && modifier.args[0]!.label === null ? modifier.args[0]!.value : undefined
  const chain = content && viewCallChain(content)
  if (!chain) return undefined
  const [stroke, padding, ...rest] = chain.modifiers
  if (!stroke || rest.length || !['stroke', 'strokeBorder'].includes(modifierName(stroke))) return undefined
  const color = stroke.args[0]
  const lineWidth = stroke.args.find(arg => arg.label === 'lineWidth')
  if (!color || color.label !== null || stroke.trailingClosure || stroke.args.length !== (lineWidth ? 2 : 1)) return undefined
  const width = lineWidth ? Number(source(lineWidth.value, text)) : 1
  if (!Number.isFinite(width) || width < 0) return undefined
  const outside = !!padding && modifierName(padding) === 'padding' && padding.args.length === 1 && padding.args[0]!.label === null && Number(source(padding.args[0]!.value, text)) === -width
  if (padding && !outside || outside && modifierName(stroke) !== 'strokeBorder') return undefined
  const position: BorderPosition = outside ? 'outside' : modifierName(stroke) === 'stroke' ? 'center' : 'inside'
  // Only the view's own corners: a stroke of some other shape is an overlay of its own.
  if (source(chain.base, text).replace(/\s+/g, '') !== borderShape(corners, position, width).replace(/\s+/g, '')) return undefined
  return { color: source(color.value, text), colorExpr: color.value, width, position, argument: !closure }
}

/**
 * A border written again with a new look, or for new corners: from its dot to its end,
 * laid out as it was written, on its own lines under its line's indentation, on one line,
 * or as the overlay's argument.
 */
export function rewriteBorder(modifier: CallExpr, found: FoundBorder, corners: Corners, text: string, next: Border): { start: number; end: number; text: string } {
  const start = dotOf(modifier, text)
  return { start, end: modifier.span.end, text: borderSource(next, corners, layoutOf(found, text.slice(start, modifier.span.end), lineIndentAt(text, start))) }
}

/** Where a modifier's own text begins: its dot. */
function dotOf(modifier: CallExpr, text: string): number {
  const member = modifier.callee.kind === 'memberAccess' ? modifier.callee.memberSpan.start : modifier.span.start
  const dot = text.lastIndexOf('.', member)
  return dot >= 0 && dot >= (modifier.callee.kind === 'memberAccess' ? modifier.callee.base?.span.end ?? 0 : 0) ? dot : member
}

/**
 * Fits a view's borders to its corners again after an edit changed them, in the same
 * step: a border that fitted the view before and is still written the same is written
 * for the new corners, switched off or not. `viewStart` is where the view's call begins,
 * before and after.
 */
export function followCorners(before: string, after: string, file: string, viewStart: number): string {
  const old = chainAt(before, file, viewStart), next = chainAt(after, file, viewStart)
  if (!old || !next) return after
  const oldCorners = cornersOf(old.modifiers, before)
  // What the view's borders were, as written: the ones on, and the ones switched off.
  const were = new Set([
    ...old.modifiers.filter(modifier => borderOf(modifier, oldCorners, before)).map(modifier => before.slice(dotOf(modifier, before), modifier.span.end)),
    ...switchedOff(before, old).filter(off => borderOf(off.call, oldCorners, off.text)).map(off => off.original),
  ])
  if (!were.size) return after
  const corners = cornersOf(next.modifiers, after)
  const patches = [
    ...next.modifiers.flatMap(modifier => {
      const found = were.has(after.slice(dotOf(modifier, after), modifier.span.end)) && !borderOf(modifier, corners, after) ? borderOf(modifier, oldCorners, after) : undefined
      return found ? [rewriteBorder(modifier, found, corners, after, found)] : []
    }),
    ...switchedOff(after, next).flatMap(off => {
      const found = were.has(off.original) && !borderOf(off.call, corners, off.text) ? borderOf(off.call, oldCorners, off.text) : undefined
      return found ? [{ start: off.start, end: off.end, text: offMarker(borderSource(found, corners, layoutOf(found, off.original, lineIndentAt(after, off.start)))) }] : []
    }),
  ]
  return patches.sort((a, b) => b.start - a.start).reduce((text, patch) => text.slice(0, patch.start) + patch.text + text.slice(patch.end), after)
}

/**
 * The modifiers switched off in a view's chain, each parsed on its own: its marker's
 * place, the text it keeps, and that text as a modifier of a view. Only the gaps between
 * the chain's own modifiers are read, never a view written inside one.
 */
function switchedOff(text: string, chain: { base: CallExpr; modifiers: readonly CallExpr[] }): { start: number; end: number; original: string; call: CallExpr; text: string }[] {
  const last = chain.modifiers.at(-1)?.span.end ?? chain.base.span.end
  const gaps = [...chain.modifiers.map((modifier, index) => [index ? chain.modifiers[index - 1]!.span.end : chain.base.span.end, dotOf(modifier, text)] as const), [last, afterOffMarkers(text, last)] as const]
  return gaps.flatMap(([from, to]) => [...offMarkersIn(text.slice(from, to))].flatMap(match => {
    const original = offMarkerText(match[0])
    const parsed = original === undefined ? undefined : offModifier(original)
    return parsed ? [{ start: from + match.index!, end: from + match.index! + match[0].length, original: original!, ...parsed }] : []
  }))
}

/** A switched-off modifier's text as a modifier of a view, with the text its spans are in. */
function offModifier(original: string): { call: CallExpr; text: string } | undefined {
  const text = `let __off = Color.clear${original}`
  const parsed = Parser.parse(text, '__off.swift')
  const declaration = parsed.sourceFile.declarations[0]
  return !parsed.diagnostics.some(d => d.severity === 'error') && declaration?.kind === 'varDecl' && declaration.initializer?.kind === 'call' ? { call: declaration.initializer, text } : undefined
}

/** The whole modifier chain of the view whose call begins at `start`. */
function chainAt(text: string, file: string, start: number): { base: CallExpr; modifiers: CallExpr[] } | null {
  let found: CallExpr | undefined
  const visit = (node: Node): void => {
    if (node.kind === 'call' && node.span.start === start && (!found || node.span.end > found.span.end)) found = node
    forEachChild(node, visit)
  }
  visit(Parser.parse(text, file).sourceFile)
  return found ? viewCallChain(found) : null
}
