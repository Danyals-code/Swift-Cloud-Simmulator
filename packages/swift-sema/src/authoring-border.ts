import { Parser, afterOffMarkers, forEachChild, hasHumanComment, offMarker, offMarkerText, offMarkersIn, type CallExpr, type Expr, type Node } from '@studio/swift-syntax'
import { CORNER_RADIUS_LABELS } from '@studio/shared'
import { viewCallChain } from './design-controls'
import { numberIn } from './layer/values'

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
  readonly kind: 'rectangle' | 'rounded' | 'uneven' | 'capsule' | 'circle' | 'ellipse'
  readonly radius?: string
  /** An uneven rectangle's corners as written: `topLeadingRadius` and its radius. */
  readonly radii?: readonly (readonly [string, string])[]
  readonly style?: string
}

export interface Border {
  /** The colour as written: `Color.gray`, `.red`, a token; null for none, which strokes in the foreground style. */
  readonly color: string | null
  readonly width: number
  readonly position: BorderPosition
  /** Lengths of dash and gap, written in a `StrokeStyle`. */
  readonly dash?: readonly number[]
}

/** A border found in a view's modifiers: what it looks like, and where its colour is written, when one is. */
export interface FoundBorder extends Border {
  readonly colorExpr: Expr | null
  /** Written as `.overlay(shape)` rather than `.overlay { shape }`, which a rewrite keeps. */
  readonly argument: boolean
}

/** A new border's look. */
export const NEW_BORDER: Border = { color: 'Color.gray', width: 1, position: 'inside' }

/** A modifier call's name, `padding` in `.padding(8)`. */
export const modifierName = (call: CallExpr) => call.callee.kind === 'memberAccess' ? call.callee.member : ''
const source = (expr: Expr, text: string) => text.slice(expr.span.start, expr.span.end)

/**
 * The corners a view has: the last of its clip, `.cornerRadius`, a rounded background
 * and glass, which is a capsule unless drawn `in:` a shape, else its own shape when it is
 * one, else square.
 */
export function cornersOf(chain: { readonly base: CallExpr; readonly modifiers: readonly CallExpr[] } | null | undefined, text: string): Corners {
  // A Circle's outline is a circle before any modifier says otherwise.
  let corners: Corners = (chain && shapeCorners(chain.base, text)) ?? { kind: 'rectangle' }
  for (const modifier of chain?.modifiers ?? []) {
    const name = modifierName(modifier)
    const only = modifier.args.length === 1 && modifier.args[0]!.label === null ? modifier.args[0]!.value : undefined
    const drawn = modifier.trailingClosure?.body.statements.length === 1 && modifier.trailingClosure.body.statements[0]!.kind === 'exprStmt' ? modifier.trailingClosure.body.statements[0]!.expression : undefined
    const shape = name === 'clipShape' && only ? shapeCorners(only, text)
      : name === 'cornerRadius' && only ? { kind: 'rounded' as const, radius: source(only, text) }
      : name === 'background' ? shapeCorners(modifier.args.find(arg => arg.label === 'in')?.value ?? only ?? drawn, text)
      : name === 'glassEffect' ? modifier.args.some(arg => arg.label === 'in') ? shapeCorners(modifier.args.find(arg => arg.label === 'in')!.value, text) : { kind: 'capsule' as const }
      : name === 'buttonBorderShape' && only ? shapeCorners(only, text)
      : undefined
    if (shape) corners = shape
  }
  return corners
}

/** The corners of a shape: `.rect(cornerRadius: 12)`, `Capsule()`, `.circle`, or a shape view drawn in a background. */
export function shapeCorners(shape: Expr | undefined, text: string): Corners | undefined {
  if (!shape) return undefined
  if (shape.kind === 'memberAccess' && !shape.base) return { rect: { kind: 'rectangle' as const }, capsule: { kind: 'capsule' as const }, circle: { kind: 'circle' as const } }[shape.member]
  const call = shape.kind === 'call' ? viewCallChain(shape)?.base : undefined
  if (!call || call.trailingClosure) return undefined
  const name = call.callee.kind === 'identifier' ? call.callee.name : call.callee.kind === 'memberAccess' && !call.callee.base ? `.${call.callee.member}` : ''
  if (['Rectangle', '.rect'].includes(name) && !call.args.length) return { kind: 'rectangle' }
  if (['Circle', '.circle'].includes(name) && !call.args.length) return { kind: 'circle' }
  if (['Ellipse', '.ellipse'].includes(name) && !call.args.length) return { kind: 'ellipse' }
  const style = call.args.find(arg => arg.label === 'style')
  const styled = style ? { style: source(style.value, text) } : {}
  if (['Capsule', '.capsule'].includes(name) && call.args.length === (style ? 1 : 0)) return { kind: 'capsule', ...styled }
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
  if (corners.kind === 'capsule') return `Capsule(${corners.style ? `style: ${corners.style}` : ''})`
  if (corners.kind === 'circle') return 'Circle()'
  if (corners.kind === 'ellipse') return 'Ellipse()'
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
  const value = numberIn(radius, false)
  return value !== undefined ? String(value ? value + width : 0) : `${radius} + ${width}`
}

/**
 * The stroke that draws a border, or a shape's own: `.strokeBorder` inside the edge,
 * `.stroke` on it, with a dash in a `StrokeStyle`. `width` is written as given.
 */
export function strokeCall(color: string | null, width: number | string, position: BorderPosition, dash?: readonly number[]): string {
  const line = dash?.length ? `style: StrokeStyle(lineWidth: ${width}, dash: [${dash.join(', ')}])` : `lineWidth: ${width}`
  return `.${position === 'center' ? 'stroke' : 'strokeBorder'}(${color === null ? line : `${color}, ${line}`})`
}

/** `StrokeStyle(lineWidth: 2, dash: [4, 2])` with literal numbers, as its width and dash; undefined for anything else. */
export function strokeStyleOf(value: Expr, text: string): { width: number; dash?: number[] } | undefined {
  if (value.kind !== 'call' || value.trailingClosure || source(value.callee, text) !== 'StrokeStyle' || !['', 'lineWidth', 'dash', 'lineWidth,dash'].includes(value.args.map(arg => arg.label).join())) return undefined
  const number = (expr: Expr) => numberIn(source(expr, text), false) ?? NaN
  const width = value.args.find(arg => arg.label === 'lineWidth'), dash = value.args.find(arg => arg.label === 'dash')?.value
  const lengths = !dash ? [] : dash.kind === 'arrayLiteral' ? dash.elements.map(number) : [NaN]
  const lineWidth = width ? number(width.value) : 1
  return [lineWidth, ...lengths].some(Number.isNaN) ? undefined : { width: lineWidth, ...lengths.length ? { dash: lengths } : {} }
}

/** The border's own lines: its shape and the stroke that draws it. */
function borderLines(border: Border, corners: Corners): string[] {
  return [
    borderShape(corners, border.position, border.width),
    strokeCall(border.color, border.width, border.position, border.dash),
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

/**
 * An overlay that strokes one shape and draws nothing else, as a border is drawn: the shape,
 * its stroke, and the padding that pulls one outside the edge. A person's comment in it
 * would be lost to a rewrite, so an overlay with one is not read as one.
 */
interface StrokedOverlay {
  readonly shape: CallExpr
  readonly stroke: CallExpr
  readonly padding?: CallExpr
  readonly argument: boolean
}

export function strokedOverlay(modifier: CallExpr, text: string): StrokedOverlay | undefined {
  if (modifierName(modifier) !== 'overlay' || hasHumanComment(text.slice(dotOf(modifier, text), modifier.span.end), 'border')) return undefined
  const closure = modifier.trailingClosure
  const content = closure && !modifier.args.length
    ? !closure.params.length && closure.body.statements.length === 1 && closure.body.statements[0]!.kind === 'exprStmt' ? closure.body.statements[0]!.expression : undefined
    : !closure && modifier.args.length === 1 && modifier.args[0]!.label === null ? modifier.args[0]!.value : undefined
  const chain = content && viewCallChain(content)
  const [stroke, padding, ...rest] = chain?.modifiers ?? []
  if (!stroke || rest.length || !['stroke', 'strokeBorder'].includes(modifierName(stroke)) || padding && modifierName(padding) !== 'padding') return undefined
  return { shape: chain!.base, stroke, ...padding ? { padding } : {}, argument: !closure }
}

/**
 * What a stroked overlay looks like, when the panel can say: its colour, or none for the
 * foreground style; a width that is a number; and where it sits, outside the edge only when
 * an inside stroke is pulled out by its own width.
 */
function strokeLook(overlay: StrokedOverlay, text: string): FoundBorder | undefined {
  const { stroke, padding } = overlay
  const first = stroke.args[0]
  const colorExpr = first?.label === null ? first.value : null
  const lineWidth = stroke.args.find(arg => arg.label === 'lineWidth'), style = stroke.args.find(arg => arg.label === 'style')
  const dashed = style && strokeStyleOf(style.value, text)
  if (stroke.trailingClosure || stroke.args.length !== (colorExpr ? 1 : 0) + (lineWidth || style ? 1 : 0) || lineWidth && style || style && !dashed) return undefined
  const width = dashed ? dashed.width : lineWidth ? numberIn(source(lineWidth.value, text), false) : 1
  if (width === undefined) return undefined
  const outside = !!padding && padding.args.length === 1 && padding.args[0]!.label === null && !padding.trailingClosure && numberIn(source(padding.args[0]!.value, text)) === -width
  if (padding && !outside || outside && modifierName(stroke) !== 'strokeBorder') return undefined
  const position: BorderPosition = outside ? 'outside' : modifierName(stroke) === 'stroke' ? 'center' : 'inside'
  return { color: colorExpr && source(colorExpr, text), colorExpr, width, position, ...dashed?.dash ? { dash: dashed.dash } : {}, argument: overlay.argument }
}

/** Whether a stroked overlay's shape is written exactly as a border of `corners` is, `RoundedRectangle(cornerRadius: 12)` for 12. */
const drawnAs = (overlay: StrokedOverlay, look: Border, corners: Corners, text: string) => source(overlay.shape, text).replace(/\s+/g, '') === borderShape(corners, look.position, look.width).replace(/\s+/g, '')

/** The border a modifier draws, when it is an overlay drawn the way a border is, with the view's own corners and a colour of its own. */
export function borderOf(modifier: CallExpr, corners: Corners, text: string): (FoundBorder & { readonly colorExpr: Expr; readonly color: string }) | undefined {
  const overlay = strokedOverlay(modifier, text), look = overlay && strokeLook(overlay, text)
  // Only the view's own corners: a stroke of some other shape is an overlay of its own.
  return look?.colorExpr && drawnAs(overlay!, look, corners, text) ? look as FoundBorder & { colorExpr: Expr; color: string } : undefined
}

/** A corner style as it draws: none written is SwiftUI's own, continuous in the Xcode 27 SDK. */
export const cornerStyle = (style: string | undefined) => (style ?? '.continuous').replace(/\s/g, '').replace(/^RoundedCornerStyle/, '')

/** Two radii as written that are the same: the same number, or the same token. */
function sameRadius(a = '0', b = '0'): boolean {
  const number = numberIn(a.trim(), false)
  return a.replace(/\s/g, '') === b.replace(/\s/g, '') || number !== undefined && number === numberIn(b.trim(), false)
}

/** Whether two shapes are the same however each is written: a radius of `12` and `12.0`, or a style left to its default. */
export function sameShape(a: Corners, b: Corners): boolean {
  if (a.kind !== b.kind || a.kind !== 'rectangle' && a.kind !== 'circle' && a.kind !== 'ellipse' && cornerStyle(a.style) !== cornerStyle(b.style)) return false
  if (a.kind === 'rounded') return sameRadius(a.radius, b.radius)
  if (a.kind !== 'uneven') return true
  const labels = new Set([...a.radii!, ...b.radii!].map(([label]) => label))
  return [...labels].every(label => sameRadius(a.radii!.find(([at]) => at === label)?.[1], b.radii!.find(([at]) => at === label)?.[1]))
}

/** The shape an outside border's overlay strokes, as much smaller as its line is wide: the view's own corners. */
function inner(corners: Corners, width: number): Corners | undefined {
  const shrink = (radius: string) => {
    const value = numberIn(radius.trim(), false)
    return value !== undefined ? String(value ? value - width : 0) : radius.endsWith(` + ${width}`) ? radius.slice(0, -` + ${width}`.length) : undefined
  }
  if (corners.kind === 'rounded') { const radius = shrink(corners.radius!); return radius === undefined ? undefined : { ...corners, radius } }
  if (corners.kind !== 'uneven') return corners
  const radii = corners.radii!.map(([label, radius]) => [label, shrink(radius)] as const)
  return radii.every(([, radius]) => radius !== undefined) ? { ...corners, radii: radii as [string, string][] } : undefined
}

/** A border written in its own spelling of a shape, which its rewrites keep. */
export interface OwnBorder {
  readonly found: FoundBorder
  /** The shape it outlines as written: the view's own size, for one outside the edge, `12` where `13` is written for a line 1 wide. */
  readonly shape: Corners
  /** Where that shape is written, which a change of the view's corners rewrites. */
  readonly at: CallExpr
  /** Whether that shape is the view's, however each is written. */
  readonly agrees: boolean
}

/**
 * An overlay that strokes a shape as a border does, whose shape is written in its own way,
 * or whose stroke has no colour of its own (Wave 3b): `.overlay(RoundedRectangle(cornerRadius:
 * 8).stroke(.gray))` beside a `.clipShape(.rect(cornerRadius: 8))`, or the same in a closure.
 * It is the view's border where its shape agrees with `corners`, the view's.
 */
export function ownBorderOf(modifier: CallExpr, corners: Corners, text: string): OwnBorder | undefined {
  const overlay = strokedOverlay(modifier, text), found = overlay && strokeLook(overlay, text)
  const drawn = found && shapeCorners(overlay!.shape, text)
  const shape = drawn && (found!.position === 'outside' ? inner(drawn, found!.width) : drawn)
  // Only a shape a rewrite writes back as it was: `RoundedRectangle(cornerRadius: 12.0)` is, `RoundedRectangle(cornerRadius: 12).inset(by: 1)` is not.
  if (!shape || !drawnAs(overlay!, found!, shape, text)) return undefined
  return { found: found!, shape, at: overlay!.shape, agrees: sameShape(shape, corners) }
}

/**
 * The shape an own-spelling border outlines, for a view's new corners: the new shape, in the
 * style the overlay wrote while it draws the same, as a border of its position and width.
 */
function ownShapeFor(border: OwnBorder, corners: Corners): string {
  const style = cornerStyle(border.shape.style) === cornerStyle(corners.style) ? border.shape.style : corners.style
  return borderShape({ ...corners, style }, border.found.position, border.found.width)
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
 * step: a border that fitted the view before and is still written the same outlines the
 * new corners, switched off or not. Only its shape is written again, in the style it had
 * while it draws the same, so its stroke stays as written, however it is spelled (Wave 3b).
 * `viewStart` is where the view's call begins before the edit, and `nextStart` after it,
 * when a property declared above it moved it.
 */
export function followCorners(before: string, after: string, file: string, viewStart: number, nextStart = viewStart): string {
  const old = chainAt(before, file, viewStart), next = chainAt(after, file, nextStart)
  if (!old || !next) return after
  const oldCorners = cornersOf(old, before)
  /** A border of the old corners: an overlay that strokes their shape, however it is spelled. */
  const fitted = (modifier: CallExpr, text: string) => !!ownBorderOf(modifier, oldCorners, text)?.agrees
  /** A modifier's own text, from its dot, by which one is found again after the edit. */
  const written = (modifier: CallExpr, text: string) => text.slice(dotOf(modifier, text), modifier.span.end)
  // What the view's borders were, as written: the ones on, and the ones switched off.
  const were = new Set([
    ...old.modifiers.filter(modifier => fitted(modifier, before)).map(modifier => written(modifier, before)),
    ...switchedOff(before, old).filter(off => fitted(off.call, off.text)).map(off => off.original),
  ])
  if (!were.size) return after
  const corners = cornersOf(next, after)
  /** The border's shape for the new corners, in `text`, or undefined where it already outlines them. */
  const fit = (modifier: CallExpr, text: string) => {
    const border = ownBorderOf(modifier, oldCorners, text)
    return border?.agrees && !ownBorderOf(modifier, corners, text)?.agrees ? { start: border.at.span.start, end: border.at.span.end, text: ownShapeFor(border, corners) } : undefined
  }
  const patches = [
    ...next.modifiers.flatMap(modifier => {
      const patch = were.has(written(modifier, after)) ? fit(modifier, after) : undefined
      return patch ? [patch] : []
    }),
    ...switchedOff(after, next).flatMap(off => {
      const patch = were.has(off.original) ? fit(off.call, off.text) : undefined
      // The switched-off modifier is parsed after a line of its own, which `from` is as long as.
      const from = off.text.length - off.original.length
      return patch ? [{ start: off.start, end: off.end, text: offMarker(off.original.slice(0, patch.start - from) + patch.text + off.original.slice(patch.end - from)) }] : []
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
