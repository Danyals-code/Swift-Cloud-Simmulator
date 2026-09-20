import type { AuthoringNode, CopyMatch, CopyValue, SourceFile, SourceSpan } from '@studio/shared'
import { forEachChild, Lexer, Parser, type CallExpr, type Expr, type Node } from '@studio/swift-syntax'
import { buildAuthoringModel } from './authoring'
import { Checker } from './checker'
import { viewCallChain } from './design-controls'
import { allDeclarations, expressionOf, hasComments, identifier, ownerOf, patch, raw, sourceRoot, type FeatureContext, type SourcePatch } from './authoring-context'

/**
 * Finding the copies a designer already made.
 *
 * Designers copy first and think about components later, so the tool has to do the
 * thinking: two views are copies when they have the same *shape* - the same views
 * nested the same way, with the same modifiers in the same order - and differ only
 * in *values*. Shape is compared exactly. Nothing is linked because it merely looks
 * similar, because being wrong here rewrites somebody's screens.
 */

/** Modifiers whose number is a length, so a parameter for one is a `CGFloat`. */
const LENGTHS = new Set(['padding', 'spacing', 'cornerRadius', 'radius', 'width', 'height', 'size', 'offset', 'blur', 'lineSpacing', 'tracking'])
/** Where an implicit member such as `.accent` is a colour rather than part of the shape. */
const COLOR_PROPERTIES = new Set(['foregroundStyle', 'foregroundColor', 'background', 'tint', 'fill', 'stroke', 'strokeBorder', 'accentColor', 'shadow', 'border'])
const SYMBOL_LABELS = new Set(['systemName', 'systemImage'])
/** Views whose first unlabeled string is what a person reads on screen. */
const TITLED = new Set(['Text', 'Label', 'Button', 'NavigationLink', 'Toggle', 'TextField', 'SecureField', 'Section'])

interface Shape {
  /** The canonical shape; two views are copies when these match exactly. */
  readonly key: string
  readonly values: readonly CopyValue[]
  /** How many modifiers the outermost chain has, for the trailing-modifier rule. */
  readonly modifiers: readonly string[]
  /** The value sites of each modifier, in the same order. */
  readonly modifierValues: readonly (readonly CopyValue[])[]
}

function valueOf(ctx: FeatureContext, expr: Expr, context: { owner: string; label: string | null; index: number }, values: CopyValue[]): string | null {
  switch (expr.kind) {
    case 'stringLiteral': {
      if (expr.segments?.some(segment => segment.kind !== 'text')) return null
      const kind = context.label && SYMBOL_LABELS.has(context.label) ? 'symbol' : 'text'
      const role = kind === 'symbol' ? 'icon' : TITLED.has(context.owner) && context.label === null && context.index === 0 ? 'title' : 'text'
      values.push({ kind, role, span: expr.span, text: raw(ctx, expr.span) })
      return '«s»'
    }
    case 'integerLiteral': case 'floatLiteral': {
      const role = LENGTHS.has(context.owner) ? context.owner : context.label ?? context.owner
      values.push({ kind: 'number', role, span: expr.span, text: raw(ctx, expr.span).trim(), unit: LENGTHS.has(context.owner) || context.label && LENGTHS.has(context.label) ? 'CGFloat' : 'Double' })
      return '«n»'
    }
    case 'memberAccess': {
      // `.accent` in a colour position is a value; `.center` in an alignment is shape.
      if (!expr.base && COLOR_PROPERTIES.has(context.owner)) {
        values.push({ kind: 'color', role: context.owner === 'background' ? 'background' : context.owner === 'tint' ? 'tint' : 'color', span: expr.span, text: raw(ctx, expr.span) })
        return '«c»'
      }
      if (expr.base?.kind === 'identifier' && expr.base.name === 'Color' && COLOR_PROPERTIES.has(context.owner)) {
        values.push({ kind: 'color', role: context.owner === 'background' ? 'background' : 'color', span: expr.span, text: raw(ctx, expr.span) })
        return '«c»'
      }
      return null
    }
    default: return null
  }
}

/** The shape of one call - a view or a modifier - with its value sites collected. */
function callShape(ctx: FeatureContext, call: CallExpr, values: CopyValue[]): string | null {
  const name = call.callee.kind === 'identifier' ? call.callee.name : call.callee.kind === 'memberAccess' ? call.callee.member : null
  if (!name) return null
  let key = name + '('
  for (const [index, argument] of call.args.entries()) {
    const value = valueOf(ctx, argument.value, { owner: name, label: argument.label, index }, values)
    key += `${argument.label ?? '_'}:${value ?? literal(ctx, argument.value)},`
  }
  key += ')'
  if (call.trailingClosure) {
    const closure = call.trailingClosure
    if (closure.params.length) return null
    const views = closure.body.statements.every(statement => statement.kind === 'exprStmt')
    if (!views) return null
    const expressions = closure.body.statements.map(statement => statement.kind === 'exprStmt' ? statement.expression : null)
    // A `Button`'s trailing closure runs an action rather than drawing: its body is a
    // value, so two buttons that do different things are still the same shape.
    if (ACTIONS.has(name)) {
      values.push({ kind: 'action', role: 'action', span: closure.span, text: raw(ctx, closure.span) })
      key += '{«a»}'
      return key
    }
    key += '{'
    for (const expression of expressions) {
      if (!expression) return null
      const inner = shapeOf(ctx, expression, values)
      if (!inner) return null
      key += inner.key + ';'
    }
    key += '}'
  }
  return key
}

/** Anything that is not a value is part of the shape, written out as it stands. */
function literal(ctx: FeatureContext, expr: Expr): string {
  return raw(ctx, expr.span).replace(/\s+/g, ' ')
}

/** The shape of a view expression, or null when it cannot be compared safely. */
function shapeOf(ctx: FeatureContext, expr: Expr, values: CopyValue[]): Shape | null {
  const chain = viewCallChain(expr)
  if (!chain) return null
  const base = callShape(ctx, chain.base, values as CopyValue[])
  if (!base) return null
  const modifiers: string[] = [], modifierValues: CopyValue[][] = []
  for (const modifier of chain.modifiers) {
    const own: CopyValue[] = []
    const shape = callShape(ctx, modifier, own)
    if (!shape) return null
    modifiers.push(shape); modifierValues.push(own); values.push(...own)
  }
  return { key: base + modifiers.join(''), values, modifiers, modifierValues }
}

/**
 * The shape of a view, and every value inside it a copy is allowed to differ in.
 *
 * Returns null for anything version 1 refuses to compare: comments a person wrote,
 * local declarations, closures with parameters, string interpolation.
 */
export function copyShape(ctx: FeatureContext, node: AuthoringNode): Shape | null {
  if (node.kind !== 'view' && node.kind !== 'collection') return null
  const expr = expressionOf(ctx, node)
  if (!expr || hasComments(ctx, node.source)) return null
  let unsafe = false
  forEachChild(expr, function visit(child: Node) {
    if (child.kind === 'selfExpr' || child.kind === 'declStmt' || child.kind === 'closure' && child.params.length) unsafe = true
    forEachChild(child, visit)
  })
  if (unsafe) return null
  const values: CopyValue[] = []
  return shapeOf(ctx, expr, values)
}

/** Views whose trailing closure runs an action instead of drawing children. */
const ACTIONS = new Set(['Button', 'onTapGesture', 'onChange'])

/** Big enough to be worth a component: two children, or one view with two modifiers. */
export function worthExtracting(ctx: FeatureContext, node: AuthoringNode): boolean {
  const expr = expressionOf(ctx, node)
  if (!expr) return false
  const chain = viewCallChain(expr)
  if (!chain) return false
  const name = chain.base.callee.kind === 'identifier' ? chain.base.callee.name : ''
  const children = ACTIONS.has(name) ? 0 : chain.base.trailingClosure?.body.statements.length ?? 0
  return children >= 2 || chain.modifiers.length >= 2
}

/**
 * Every other view in the project with the same shape as this one.
 *
 * Copies inside a component definition are left alone - they already follow a Main -
 * and so is anything nested inside another match, because replacing an outer copy
 * takes its inner views with it.
 */
export function findCopies(ctx: FeatureContext, node: AuthoringNode, screens: readonly string[] = []): readonly CopyMatch[] {
  const shape = copyShape(ctx, node)
  if (!shape || !worthExtracting(ctx, node)) return []
  // A view inside a component already follows a Main; linking it would fight that.
  // Everything else - every screen - is searched.
  const components = new Set(ctx.nodes.filter(n => n.kind === 'definition' && !screens.includes(n.name) && ctx.nodes.some(other => other.definitionId === n.id)).map(n => n.name))
  const matches: CopyMatch[] = []
  for (const candidate of ctx.nodes) {
    if (candidate.id === node.id || candidate.source.file === node.source.file && candidate.source.start < node.source.end && candidate.source.end > node.source.start) continue
    if (components.has(candidate.owner.split('.')[0]!)) continue
    const own = copyShape(ctx, candidate)
    if (!own) continue
    // The trailing-modifier exception: a copy may end with extra modifiers, which
    // stay on the call rather than moving into the component.
    if (own.modifiers.length < shape.modifiers.length) continue
    const prefix = own.modifiers.slice(0, shape.modifiers.length)
    const base = own.key.slice(0, own.key.length - own.modifiers.slice(shape.modifiers.length).join('').length)
    if (base !== shape.key || prefix.join('') !== shape.modifiers.join('')) continue
    const kept = own.modifiers.length - shape.modifiers.length
    const values = own.values.slice(0, shape.values.length)
    matches.push({
      id: candidate.id,
      owner: candidate.owner,
      source: candidate.source,
      values,
      differences: values.filter((value, index) => value.text !== shape.values[index]?.text).length,
      ...(kept ? { extraModifiers: kept } : {}),
    })
  }
  // An outer match already carries its inner views; listing both would double-count.
  return matches.filter(match => !matches.some(other => other !== match && other.source.file === match.source.file && other.source.start <= match.source.start && other.source.end >= match.source.end && (other.source.end - other.source.start) > (match.source.end - match.source.start)))
}

/** The names a view can read from the screen around it: its values and actions. */
function ownedNames(ctx: FeatureContext, node: AuthoringNode): ReadonlySet<string> {
  const owner = ownerOf(ctx, node)
  return new Set((owner?.members ?? []).flatMap(member => 'name' in member && typeof member.name === 'string' && member.name !== 'body' ? [member.name] : []))
}

const mentions = (text: string, names: ReadonlySet<string>) => Lexer.tokenize(text, 'value').tokens.some(token => token.kind === 'identifier' && names.has(token.text))

/** Readable parameter names from each differing value's role, made unique. */
export function parameterNames(values: readonly CopyValue[], differing: readonly number[]): Map<number, string> {
  const used = new Set<string>()
  const names = new Map<number, string>()
  for (const index of differing) {
    const value = values[index]
    if (!value) continue
    const base = value.role === 'title' && used.has('title') ? 'subtitle' : value.role
    let name = base, n = 2
    while (used.has(name)) name = `${base}${n++}`
    used.add(name); names.set(index, name)
  }
  return names
}

const typeOf = (value: CopyValue): string =>
  value.kind === 'text' || value.kind === 'symbol' ? 'String' : value.kind === 'color' ? 'Color' : value.kind === 'action' ? '() -> Void' : value.unit ?? 'Double'

/**
 * Make one view the Main, and every ticked copy a call to it.
 *
 * The Main keeps every value the copies agree on and takes a parameter for each one
 * they differ in, which is exactly the "Changeable per copy" set. The whole thing -
 * the new file and every replaced copy - is one edit, so one undo puts it back.
 */
export function makeComponent(
  ctx: FeatureContext,
  node: AuthoringNode,
  name: string,
  copies: readonly AuthoringNode[],
  rename: Readonly<Record<string, string>> = {},
  screens: readonly string[] = [],
): { patches: SourcePatch[]; files: SourceFile[]; parameters: readonly { name: string; type: string }[] } {
  if (!identifier(name) || allDeclarations(ctx).some(d => 'name' in d && d.name === name)) throw new Error('Choose an unused component name.')
  const shape = copyShape(ctx, node)
  if (!shape) throw new Error('This view cannot become a component yet. It uses code the studio does not rewrite.')
  if (!ownerOf(ctx, node)) throw new Error('Select a view inside a screen.')
  const matches = findCopies(ctx, node, screens)
  const chosen = copies.map(copy => {
    const match = matches.find(item => item.id === copy.id)
    if (!match) throw new Error('One of the copies changed. Find the copies again.')
    return { node: copy, match }
  })
  /**
   * A value becomes a parameter when the copies disagree about it - and also when it
   * reads something from the screen it sits on, because the component has no screen.
   * Two identical `{ saved = true }` actions are the same *value*, and still have to
   * travel with each copy.
   */
  const owned = ownedNames(ctx, node)
  const differing = shape.values.map((value, index) =>
    chosen.some(({ match }) => match.values[index]?.text !== value.text) || mentions(value.text, owned) ? index : -1,
  ).filter(index => index >= 0)
  // Renames arrive by the suggested name - `title` becomes `label` - because that is
  // what the designer is looking at in the dialog.
  const names = parameterNames(shape.values, differing)
  for (const [index, suggested] of [...names]) {
    const chosenName = rename[suggested]
    if (!chosenName || chosenName === suggested) continue
    if (!identifier(chosenName) || [...names.values()].includes(chosenName)) throw new Error(`Choose a unique parameter name instead of “${chosenName}”.`)
    names.set(index, chosenName)
  }
  const parameters = differing.map(index => ({ name: names.get(index)!, type: typeOf(shape.values[index]!), kind: shape.values[index]!.kind }))

  // The Main is this view's own source with each parameter site swapped for its name.
  const text = ctx.files.find(file => file.id === node.source.file)?.text ?? ''
  let body = ''
  let cursor = node.source.start
  for (const index of differing) {
    const value = shape.values[index]!
    body += text.slice(cursor, value.span.start) + (value.kind === 'action' ? `{ ${names.get(index)}() }` : names.get(index)!)
    cursor = value.span.end
  }
  body += text.slice(cursor, node.source.end)
  // Whatever is left of the view has to stand on its own in another file.
  const left = Lexer.tokenize(body, node.source.file).tokens.filter(token => token.kind === 'identifier' && owned.has(token.text))
  if (left.length) throw new Error(`This view uses “${left[0]!.text}” from its screen, which a component cannot see. Make it a component in Swift, or keep it here.`)
  const declarations = parameters.map(parameter => `    let ${parameter.name}: ${parameter.type}`)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const file = `${sourceRoot(ctx)}DesignSystem/Components/${name}.swift`
  // The copy is written where it stands, so its lines carry the screen's indent.
  // The Main reads as if it had always been its own file.
  const indent = /^[\t ]*/.exec(text.slice(text.lastIndexOf('\n', node.source.start - 1) + 1, node.source.start))?.[0] ?? ''
  const lines = body.split('\n').map((line, index) => index === 0 ? line : line.startsWith(indent) ? line.slice(indent.length) : line.replace(/^[\t ]+/, ''))
  const source = `import SwiftUI\n\nstruct ${name}: View {\n${declarations.join('\n')}${declarations.length ? '\n' : ''}    var body: some View {\n        ${lines.join('\n        ')}\n    }\n}\n`.replace(/\r?\n/g, eol)

  /** One call, passing the values this copy wrote. */
  const callFor = (values: readonly CopyValue[]) => {
    const written = differing.map(index => {
      const value = values[index]
      if (!value) throw new Error('One of the copies changed. Find the copies again.')
      return `${names.get(index)}: ${value.text}`
    })
    return `${name}(${written.join(', ')})`
  }
  const patches: SourcePatch[] = [patch(node.source, callFor(shape.values))]
  for (const { node: copy, match } of chosen) {
    const own = ctx.files.find(f => f.id === copy.source.file)?.text ?? ''
    const kept = match.extraModifiers ? own.slice(trailingStart(ctx, copy, match.extraModifiers), copy.source.end) : ''
    patches.push(patch(copy.source, callFor(match.values) + kept))
  }
  return { patches, files: [{ id: file, text: source }], parameters: parameters.map(({ name, type }) => ({ name, type })) }
}

/**
 * Where a copy's extra trailing modifiers start, so they can stay on the call.
 *
 * Measured from the end of the last modifier the component takes, so the line break
 * and indent in front of `.opacity(0.5)` come with it and the call still reads as
 * the designer wrote it.
 */
function trailingStart(ctx: FeatureContext, node: AuthoringNode, extra: number): number {
  const expr = expressionOf(ctx, node)
  const chain = expr ? viewCallChain(expr) : null
  if (!chain) return node.source.end
  const kept = chain.modifiers.length - extra
  return (kept > 0 ? chain.modifiers[kept - 1]?.span.end : chain.base.span.end) ?? node.source.end
}

/**
 * The copies of one view, asked for by source position.
 *
 * The panel asks only when a designer is looking at a view, rather than every
 * compile computing every shape in the project: finding copies is a search, and a
 * search that runs on each keystroke is a search nobody can afford.
 */
export function findViewCopies(files: readonly SourceFile[], target: SourceSpan, options: { deploymentTarget?: string; screens?: readonly string[] } = {}): { copies: readonly CopyMatch[]; values: readonly CopyValue[]; eligible: boolean; reason?: string } {
  const { deploymentTarget, screens = [] } = options
  const parsed = files.map(file => Parser.parse(file.text, file.id))
  if (parsed.some(p => p.diagnostics.some(d => d.severity === 'error'))) return { copies: [], values: [], eligible: false, reason: 'Resolve the syntax errors first.' }
  const ast = parsed.map(p => p.sourceFile)
  const snapshot = buildAuthoringModel({ projectId: '', revision: 0, files, parsed: ast, diagnostics: Checker.check(ast).diagnostics, deploymentTarget })
  const ctx: FeatureContext = { files, ast, nodes: snapshot.nodes, deploymentTarget }
  const node = snapshot.nodes.find(n => n.kind !== 'definition' && n.source.file === target.file && n.source.start === target.start && n.source.end === target.end)
  if (!node) return { copies: [], values: [], eligible: false, reason: 'Select a view first.' }
  if (!worthExtracting(ctx, node)) return { copies: [], values: [], eligible: false, reason: 'This view is too small to be worth a component on its own.' }
  const shape = copyShape(ctx, node)
  if (!shape) return { copies: [], values: [], eligible: false, reason: 'This view uses code the studio does not rewrite. Make it a component in Swift.' }
  return { copies: findCopies(ctx, node, screens), values: shape.values, eligible: true }
}
