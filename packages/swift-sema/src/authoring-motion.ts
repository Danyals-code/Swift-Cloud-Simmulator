import { MOTION_CONTROLS, deploymentVersion, isHelperDefinition, isNonView, type ActionAnimation, type AuthoringNode, type DesignControl, type ReadAnimation, type SourceSpan } from '@studio/shared'
import { afterOffMarkers, forEachChild, type CallExpr, type ClosureExpr, type Expr, type Node, type StructDecl } from '@studio/swift-syntax'
import { callOf, expressionOf, extensionsNamed, ifStatementOf, insertStoredMember, layerById, lineIndent, modifierIndent, ownerOf, patch, raw, scalarType, type FeatureContext, type SourcePatch } from './authoring-context'
import { modifierSegment } from './authoring-modifiers'
import { literalText, validateControlValue } from './design-controls'
import { NO_TRANSITION, animationOf, animationSwift, readTransition, transitionNamed, transitionSettings, transitionSwift, transitionTooNew, type Transition } from './motion-values'

/**
 * Motion in Design (Wave 5a): a tap that animates what it changes, `withAnimation(.smooth)
 * { … }`; a view's transition as it comes and goes; digits that roll; and a view that moves
 * with another between states. Each is read from the code as written, and written with
 * Apple's names.
 */

/** The `withAnimation(…) { … }` an action is, when it is that and nothing else. */
export function animatedAction(closure: ClosureExpr): CallExpr | undefined {
  const [only, more] = closure.body.statements
  const call = !more && only?.kind === 'exprStmt' && only.expression.kind === 'call' ? only.expression : undefined
  return call?.callee.kind === 'identifier' && call.callee.name === 'withAnimation' && call.trailingClosure && !call.trailingClosure.params.length && (!call.args.length || call.args.length === 1 && call.args[0]!.label === null) ? call : undefined
}

/** How a Button's action animates, read when it is `withAnimation(…) { … }` alone. */
export function readAnimation(ctx: FeatureContext, closure: ClosureExpr): ReadAnimation | undefined {
  const call = animatedAction(closure), argument = call?.args[0]?.value
  if (!call) return undefined
  return argument ? { ...animationOf(argument), written: raw(ctx, argument.span) } : { style: 'default', written: '' }
}

/** A closure's lines between its braces, each taken back to the indent of the first: one line for one written on one line. */
function insideOf(ctx: FeatureContext, closure: ClosureExpr): string[] {
  const text = raw(ctx, closure.span).slice(1, -1), lines = text.split(/\r?\n/)
  if (lines.length === 1) return text.trim() ? [text.trim()] : []
  const body = lines.slice(lines[0]!.trim() ? 0 : 1, lines.at(-1)!.trim() ? undefined : -1)
  const base = /^[ \t]*/.exec(body.find(line => line.trim()) ?? '')![0]
  return body.map(line => line.startsWith(base) ? line.slice(base.length) : line.trimStart())
}
/**
 * A closure holding `lines`, one step in from `indent`: on one line when it is one line of
 * code, unless `overLines` keeps it over the lines the closure it replaces is written on,
 * as taking an animation away does (Wave 5a).
 */
function closureOf(ctx: FeatureContext, closure: ClosureExpr, lines: readonly string[], overLines = false): string {
  const { indent, unit } = lineIndent(ctx, closure.span.file, closure.span.start), eol = ctx.files.find(f => f.id === closure.span.file)?.text.includes('\r\n') ? '\r\n' : '\n'
  const oneLine = lines.length === 1 && !/\/\/|\/\*/.test(lines[0]!) && !(overLines && /\r?\n/.test(raw(ctx, closure.span)))
  return oneLine ? `{ ${lines[0]} }` : `{${eol}${lines.map(line => line ? indent + unit + line : line).join(eol)}${eol}${indent}}`
}
/** `lines` in `withAnimation(…) { … }`, opened as `opening` writes it, `withAnimation(.smooth)`, one step in by the file's own step (Wave 5a). */
function animated(ctx: FeatureContext, closure: ClosureExpr, opening: string, lines: readonly string[]): string[] {
  const { unit } = lineIndent(ctx, closure.span.file, closure.span.start)
  return [`${opening} {`, ...lines.map(line => line ? unit + line : line), '}']
}
/** How `withAnimation` opens for an animation's Swift, `.smooth`, or `''` for Default. */
const opening = (swift: string) => swift ? `withAnimation(${swift})` : 'withAnimation'

/**
 * A Button's action with `body` as what it does (Wave 5a), animated as `animation` says: in
 * `withAnimation` by a style, with none for null, and as the action was for undefined, so
 * Replace keeps an animation. Only a change of a value, a list or a call is animated.
 */
export function actionClosure(ctx: FeatureContext, closure: ClosureExpr, body: string, animates: boolean, animation: ActionAnimation | null | undefined): string {
  const swift = animation === undefined ? readAnimation(ctx, closure)?.written : animation && animationSwift(animation)
  if (animation && !animates) throw new Error('This opens or shows something, which has an animation of its own. Animate a change of a value instead.')
  return closureOf(ctx, closure, swift === undefined || swift === null || !animates ? [body] : animated(ctx, closure, opening(swift), [body]))
}

/**
 * Animate this change (Wave 5a): the action of the Button `node` wrapped in `withAnimation`,
 * restyled, or with null unwrapped, keeping what it does. Wrapping it takes away the
 * animation a transition added for a value it changes, so the style chosen here plays.
 */
export function animateAction(ctx: FeatureContext, node: AuthoringNode, closure: ClosureExpr, animation: ActionAnimation | null): SourcePatch[] {
  if (!closure.body.statements.length) throw new Error('Choose what a tap does first, then animate it.')
  const call = animatedAction(closure), swift = animation && animationSwift(animation)
  if (!call) {
    if (closure.body.statements.some(s => s.kind === 'exprStmt' && s.expression.kind === 'call' && s.expression.callee.kind === 'identifier' && s.expression.callee.name === 'withAnimation')) throw new Error('This action animates in a way written in code. Change it in Code.')
    if (swift === null) return []
    const changed = changedBy(closure), added = ctx.nodes.flatMap(n => n.owner === node.owner ? addedAnimations(ctx, n).filter(a => changed.has(rootOf(a.value) ?? '')).flatMap(a => tidied(ctx, n, a.call)) : [])
    return [patch(closure.span, closureOf(ctx, closure, animated(ctx, closure, opening(swift), insideOf(ctx, closure)))), ...added]
  }
  if (swift === null) return [patch(closure.span, closureOf(ctx, closure, insideOf(ctx, call.trailingClosure!), true))]
  return [{ file: call.span.file, start: call.callee.span.end, end: call.trailingClosure!.span.start, text: swift ? `(${swift}) ` : ' ' }]
}

/**
 * How a view comes and goes, which is when a transition plays (Wave 5a): as the only view of
 * a branch of an `if` or a `switch`, or as a row a changing collection adds. `owner` is the view
 * around it that stays while it does, where an animation goes, and `value` the change it
 * animates on: the `if`'s condition, or the collection's count.
 */
export function appearSite(ctx: FeatureContext, node: AuthoringNode): { by: 'branch' | 'row'; owner?: AuthoringNode; value?: string } | { problem: string } {
  const inserted = layerById(ctx, node.parentId)
  const branch = inserted?.kind === 'branch' && (inserted.name === 'Condition' || inserted.name === 'Otherwise' || inserted.name.startsWith('Case '))
  if (!inserted || !branch && inserted.kind !== 'template') return { problem: APPEAR_ALWAYS_SHOWN }
  let owner = layerById(ctx, inserted.parentId)
  // A ForEach lays nothing out, so a modifier on it would land on every row.
  while (owner && owner.kind !== 'definition' && (owner.kind === 'branch' || owner.kind === 'template' || owner.name === 'ForEach' || !expressionOf(ctx, owner))) owner = layerById(ctx, owner.parentId)
  const stays = owner?.kind === 'definition' || isHelperDefinition(owner ?? node) ? undefined : owner
  if (branch) {
    const condition = inserted.name === 'Otherwise' ? layerById(ctx, inserted.parentId) : inserted, stmt = condition && ifStatementOf(ctx, condition)
    const only = stmt?.conditions.length === 1 && stmt.conditions[0]!.kind === 'expr' ? stmt.conditions[0]!.expr : undefined
    return { by: 'branch', owner: stays, value: only && raw(ctx, only.span) }
  }
  // Rows come and go as their collection does: its count changes with every row added or removed.
  const collection = layerById(ctx, inserted.parentId), data = collection && callOf(ctx, collection)?.args[0]?.value
  const name = data && /^\$?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(raw(ctx, data.span)) ? raw(ctx, data.span).replace(/^\$/, '') : undefined
  const fixed = data?.kind === 'identifier' && ownerOf(ctx, node)?.members.some(m => m.kind === 'varDecl' && m.name === name && m.isLet && !!m.initializer)
  if (!name || fixed) return { problem: 'An appear animation on rows plays as rows are added or removed, and these rows are fixed in the code rather than read from a collection that changes, such as ForEach(items). Add it in Code.' }
  return { by: 'row', owner: stays, value: `${name}.count` }
}
/** Why an appear animation does not apply to a view that is always there. */
const APPEAR_ALWAYS_SHOWN = 'An appear animation plays when a view is added or removed, and this view is always shown. Use it on a view inside an if or a switch, or on the rows of a collection.'

/**
 * A modifier added at the end of `node`'s chain: on a line of its own under a view written on
 * lines of its own, as Xcode writes it, and straight after one that shares its line.
 */
function appended(ctx: FeatureContext, node: AuthoringNode, modifier: string): SourcePatch {
  const text = ctx.files.find(f => f.id === node.source.file)?.text ?? '', { start, end, file } = node.source
  const after = text.slice(afterOffMarkers(text, end)), own = !text.slice(text.lastIndexOf('\n', start - 1) + 1, start).trim() && /^[ \t;]*(?:\r?\n|$)/.test(after)
  return { file, start: end, end, text: own ? `${text.includes('\r\n') ? '\r\n' : '\n'}${modifierIndent(ctx, node)}${modifier}` : modifier }
}
/** The view's last `.name(…)` modifier, found from the end of its chain. */
function modifierNamed(ctx: FeatureContext, node: AuthoringNode, name: string): CallExpr | undefined {
  for (let call = expressionOf(ctx, node); call?.kind === 'call' && call.callee.kind === 'memberAccess' && call.callee.base; call = call.callee.base) if (call.callee.member === name) return call
  return undefined
}
/** The patch taking a modifier out of a view's chain, with the line it is on. */
function removed(ctx: FeatureContext, node: AuthoringNode, call: CallExpr): SourcePatch {
  const [taken] = tidied(ctx, node, call)
  if (!taken) throw new Error('A note in this view’s modifiers keeps them where they are. Change it in Code.')
  return taken
}
/** The same, as a tidy-up beside another change (Wave 5a): none when a note keeps the modifier where it is. */
function tidied(ctx: FeatureContext, node: AuthoringNode, call: CallExpr): SourcePatch[] {
  const text = ctx.files.find(f => f.id === node.source.file)?.text ?? '', segment = modifierSegment(expressionOf(ctx, node)!, text, call)
  return segment ? [{ file: node.source.file, start: segment.start, end: segment.end, text: '' }] : []
}

/**
 * The animation a new transition needs to play, on the view around it that stays: none when
 * one there animates the same value already, or a tap that changes it animates it.
 */
function containerAnimation(ctx: FeatureContext, node: AuthoringNode, site: { owner?: AuthoringNode; value?: string }, curve = '.default'): SourcePatch[] {
  const { owner, value } = site, root = value && /[A-Za-z_]\w*/.exec(value)?.[0]
  if (!owner || !value || !root) return []
  const same = modifierNamed(ctx, owner, 'animation')?.args.some(a => a.label === 'value' && raw(ctx, a.value.span) === value)
  return same || animatedOnTap(ctx, node.owner, root) ? [] : [appended(ctx, owner, `.animation(${curve}, value: ${value})`)]
}
/** Whether a Button of the screen `owner` changes the value `name` in `withAnimation`, read from its syntax (Wave 5a). */
function animatedOnTap(ctx: FeatureContext, owner: string, name: string): boolean {
  return ctx.nodes.some(n => {
    const closure = n.owner === owner && n.name === 'Button' ? callOf(ctx, n)?.trailingClosure : undefined, call = closure && animatedAction(closure)
    return !!call && changedBy(call.trailingClosure!).has(name)
  })
}
/** The calls that change the list or the value they are called on. */
const CHANGING: ReadonlySet<string> = new Set(['toggle', 'append', 'insert', 'remove', 'removeAll', 'removeFirst', 'removeLast', 'move', 'sort', 'shuffle', 'reverse'])
/** The value an expression reads first: `items` of `items.count`, `showBanner` of `!self.showBanner`. */
function rootOf(expr: Expr): string | undefined {
  if (expr.kind === 'identifier') return expr.name
  if (expr.kind === 'memberAccess') return expr.base?.kind === 'selfExpr' ? expr.member : expr.base ? rootOf(expr.base) : undefined
  if (expr.kind === 'unary' || expr.kind === 'forceUnwrap' || expr.kind === 'optionalChain') return rootOf(expr.operand)
  if (expr.kind === 'subscript') return rootOf(expr.base)
  return expr.kind === 'binary' ? rootOf(expr.left) : undefined
}
/** The values an action changes (Wave 5a): `x = …`, `x += 1`, `x.toggle()`, `items.append(…)`, read from its syntax. */
function changedBy(closure: ClosureExpr): Set<string> {
  const names = new Set<string>()
  const visit = (node: Node) => {
    const target = node.kind === 'assign' ? node.target : node.kind === 'call' && node.callee.kind === 'memberAccess' && node.callee.base && CHANGING.has(node.callee.member) ? node.callee.base : undefined
    const name = target && rootOf(target)
    if (name) names.add(name)
    forEachChild(node, visit)
  }
  visit(closure.body)
  return names
}
/** The animations Design adds for a transition on a view, `.animation(.default, value: …)`, with the value each animates on. */
function addedAnimations(ctx: FeatureContext, node: AuthoringNode): { readonly call: CallExpr; readonly value: Expr }[] {
  const found: { call: CallExpr; value: Expr }[] = []
  for (let call = expressionOf(ctx, node); call?.kind === 'call' && call.callee.kind === 'memberAccess' && call.callee.base; call = call.callee.base) {
    const [curve, value] = call.args
    if (call.callee.member === 'animation' && call.args.length === 2 && curve!.label === null && raw(ctx, curve!.value.span) === '.default' && value!.label === 'value') found.push({ call, value: value!.value })
  }
  return found
}
/**
 * The animation Design added on the view around `node` for its transition (Wave 5a), taken away
 * with the last transition there that plays by it.
 */
function unusedAnimation(ctx: FeatureContext, node: AuthoringNode, site: { owner?: AuthoringNode; value?: string }): SourcePatch[] {
  const { owner, value } = site, added = owner && value ? addedAnimations(ctx, owner).find(a => raw(ctx, a.value.span) === value) : undefined
  if (!added) return []
  const another = ctx.nodes.some(n => n !== node && n.owner === node.owner && n.source.file === node.source.file && !!modifierNamed(ctx, n, 'transition') && (other => 'by' in other && other.owner === owner && other.value === value)(appearSite(ctx, n)))
  return another ? [] : tidied(ctx, owner!, added.call)
}

/** A view's transition as written (Wave 5a): none, one Design writes, or one only Code changes. */
function transitionOf(ctx: FeatureContext, node: AuthoringNode): Transition {
  const call = modifierNamed(ctx, node, 'transition')
  return !call ? NO_TRANSITION : call.args.length === 1 ? readTransition(call.args[0]!.value) : { kind: 'written', fades: false }
}

/** A select or a switch of the Visibility group. */
function motionControl(id: string, label: string, kind: 'select' | 'toggle', value: string, source: SourceSpan, description: string, options?: readonly string[], disabledReason?: string): DesignControl {
  return { id, label, kind, value, source, group: 'Visibility', scope: 'This view', description, options, disabledReason }
}

const NONE: DesignControl[] = []
/** The Visibility group's motion settings for `node` (Wave 5a): its transition, as it comes and goes. */
export function motionControls(ctx: FeatureContext, node: AuthoringNode): DesignControl[] {
  if (node.argument || node.textRun || !node.controls || node.kind !== 'view' && node.kind !== 'component' && node.kind !== 'collection' || isNonView(node)) return NONE
  // Only a view that comes and goes, or a text, has any.
  const parent = layerById(ctx, node.parentId), text = node.name === 'Text' && node.kind === 'view' && numberShown(node)
  if (parent?.kind !== 'branch' && parent?.kind !== 'template' && !text) return NONE
  const controls: DesignControl[] = [], site = appearSite(ctx, node), partners = partnersOf(ctx, node)
  const target = deploymentVersion(ctx.deploymentTarget)
  if ('by' in site) {
    const call = modifierNamed(ctx, node, 'transition')
    for (const setting of transitionSettings(transitionOf(ctx, node), target, true)) controls.push(motionControl(MOTION_CONTROLS[setting.part], setting.label, setting.kind, setting.value, call?.span ?? node.source, setting.description, setting.options, setting.disabledReason))
  }
  if (text) {
    const call = modifierNamed(ctx, node, 'contentTransition'), argument = call?.args[0]?.value
    const rolls = !!call && argument?.kind === 'call' && argument.callee.kind === 'memberAccess' && !argument.callee.base && argument.callee.member === 'numericText'
    controls.push(motionControl(MOTION_CONTROLS.rollsDigits, 'Rolls digits', 'toggle', String(rolls), call?.span ?? node.source, 'Its digits roll when the number changes, when the change is animated.', undefined, target < 16 ? 'Rolling digits needs iOS 16 or newer.' : call && !rolls ? 'This text changes in a way Design doesn’t write. Change it in Code.' : undefined))
  }
  if (partners) {
    const own = matchOf(ctx, node), partner = own && partners.find(p => sameMatch(matchOf(ctx, p.node), own))
    const options = ['None', ...partners.map(p => p.label)]
    controls.push(motionControl(MOTION_CONTROLS.movesWith, 'Moves with', 'select', partner?.label ?? 'None', own?.call.span ?? node.source, 'Marks it as the same thing as a view of another state, so it moves and changes shape into it.', options, target < 14 ? 'Moving between states needs iOS 14 or newer.' : own && !partner ? 'This view moves with another in a way Design doesn’t write. Change it in Code.' : undefined))
  }
  return controls
}

/** Whether a Text shows a value, as a number is: words with values in them, or a value with a `format:`, as its properties read them. */
function numberShown(node: AuthoringNode): boolean {
  const first = node.properties[0]
  return !!first && (first.name === 'content' || first.name === 'verbatim') && first.expression.startsWith('"') && first.expression.includes('\\(') || node.properties.some(p => p.name === 'format')
}
/**
 * `.numericText(value: …)` where iOS 17 can take the one value a Text shows, an Int or a Double
 * property of its view's, as `"\(count)"` or `Text(price, format: …)` shows it (Wave 5a);
 * `.numericText()` otherwise.
 */
function numericSwift(ctx: FeatureContext, node: AuthoringNode): string {
  const call = callOf(ctx, node), first = call?.args[0], values = first?.value.kind === 'stringLiteral' ? first.value.segments.filter(s => s.kind !== 'text' || s.value) : []
  const formatted = first && first.label === null && call!.args.some(a => a.label === 'format') ? first.value : undefined
  const only = values.length === 1 && values[0]!.kind === 'interpolation' ? values[0]!.expression : formatted
  const member = only?.kind === 'identifier' ? ownerOf(ctx, node)?.members.find(m => m.kind === 'varDecl' && m.name === only.name) : undefined
  const scalar = member?.kind === 'varDecl' ? scalarType(member.typeAnnotation, member.initializer) : undefined
  if (!only || !scalar || scalar.optional || scalar.type !== 'Int' && scalar.type !== 'Double' || deploymentVersion(ctx.deploymentTarget) < 17) return '.numericText()'
  return `.numericText(value: ${scalar.type === 'Int' ? `Double(${raw(ctx, only.span)})` : raw(ctx, only.span)})`
}

/** A view's `.matchedGeometryEffect(id:in:)`, with its id and namespace as written. */
interface Match { readonly call: CallExpr; readonly id: string; readonly space: string }
function matchOf(ctx: FeatureContext, node: AuthoringNode): Match | undefined {
  const call = modifierNamed(ctx, node, 'matchedGeometryEffect')
  return call && call.args.length === 2 && call.args[0]!.label === 'id' && call.args[1]!.label === 'in' ? { call, id: raw(ctx, call.args[0]!.value.span), space: raw(ctx, call.args[1]!.value.span) } : call && { call, id: '', space: '' }
}
const sameMatch = (a: Match | undefined, b: Match) => !!a && !!b.id && a.id === b.id && a.space === b.space
/** A view's name in a designer's words: a text's own words, or `RoundedRectangle` as "Rounded rectangle". */
function labelOf(ctx: FeatureContext, node: AuthoringNode): string {
  const words = node.name === 'Text' || node.name === 'Button' || node.name === 'Label' ? literalText(callOf(ctx, node)?.args[0]?.value) : undefined
  return words || node.name.replace(/([a-z])([A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`)
}
/**
 * The views a view in one branch of an `if` or a `switch` can move with: those of its other
 * branches, each named once. Undefined for a view in no branch.
 */
function partnersOf(ctx: FeatureContext, node: AuthoringNode): { node: AuthoringNode; label: string }[] | undefined {
  const branch = layerById(ctx, node.parentId)
  if (branch?.kind !== 'branch') return undefined
  const condition = branch.name === 'Condition' ? branch : branch.name === 'Otherwise' && layerById(ctx, branch.parentId)?.name === 'Condition' ? layerById(ctx, branch.parentId) : undefined
  const switched = !condition && (branch.name.startsWith('Case ') || branch.name === 'Otherwise') ? layerById(ctx, branch.parentId) : undefined
  const others = condition ? [condition, ...condition.children.map(id => layerById(ctx, id)!)].filter(b => b && b !== branch && b.kind === 'branch' && (b === condition || b.name === 'Otherwise')) : switched?.name === 'Switch' ? switched.children.map(id => layerById(ctx, id)!).filter(b => b && b !== branch) : []
  const views = others.flatMap(b => b.children.map(id => layerById(ctx, id)!).filter(v => v && v.kind !== 'branch' && v.kind !== 'opaque' && !v.argument))
  if (!views.length) return undefined
  const seen = new Map<string, number>()
  return views.map(view => { const label = labelOf(ctx, view), count = (seen.get(label) ?? 0) + 1; seen.set(label, count); return { node: view, label: count > 1 ? `${label} ${count}` : label } })
}

/** Whether the code of `struct` and its extensions names `name` anywhere but in what `away` takes out (Wave 5a): read from syntax, so no note or string counts. */
function usedBesides(ctx: FeatureContext, struct: StructDecl, name: string, away: readonly SourcePatch[]): boolean {
  let used = false
  const visit = (node: Node) => {
    if (used) return
    const named = node.kind === 'identifier' && node.name === name || node.kind === 'memberAccess' && node.base?.kind === 'selfExpr' && node.member === name
    if (named && !away.some(p => p.file === node.span.file && p.start <= node.span.start && node.span.end <= p.end)) used = true
    else forEachChild(node, visit)
  }
  for (const member of [...struct.members, ...extensionsNamed(ctx, struct.name).flatMap(e => e.members)]) visit(member)
  return used
}

/** Moves with, written: both views in one `@Namespace`, by one id, or with None neither, and the namespace gone once nothing uses it. */
function movesWith(ctx: FeatureContext, node: AuthoringNode, value: string): SourcePatch[] {
  const partners = partnersOf(ctx, node)!, own = matchOf(ctx, node), struct = ownerOf(ctx, node)
  const current = own && partners.find(p => sameMatch(matchOf(ctx, p.node), own))
  const patches = own ? [removed(ctx, node, own.call), ...current ? [removed(ctx, current.node, matchOf(ctx, current.node)!.call)] : []] : []
  const target = partners.find(p => p.label === value)
  const spaces = struct?.members.filter(m => m.kind === 'varDecl' && m.attributes.some(a => a.name === 'Namespace')) ?? []
  const text = struct ? raw(ctx, struct.span) : ''
  if (!target) {
    const space = own && spaces.find(m => 'name' in m && m.name === own.space)
    // The namespace goes with the last effect that uses it, and stays while anything else does, as a view it is given to.
    if (space && struct && !usedBesides(ctx, struct, own.space, patches)) {
      const file = ctx.files.find(f => f.id === space.span.file)!.text, start = file.lastIndexOf('\n', space.span.start - 1) + 1
      patches.push({ file: space.span.file, start, end: file.indexOf('\n', space.span.end) + 1, text: '' })
    }
    return patches
  }
  if (matchOf(ctx, target.node) && target.node !== current?.node) throw new Error(`${target.label} moves with another view already. Set it to None first.`)
  if (!struct || target.node.source.file !== node.source.file) throw new Error('Both views must be in the same view’s code.')
  const space = spaces[0] && 'name' in spaces[0] ? spaces[0].name as string : undefined
  let name = space ?? 'namespace', id = node.name.charAt(0).toLowerCase() + node.name.slice(1)
  for (let n = 2; !space && struct.members.some(m => 'name' in m && m.name === name); n++) name = `namespace${n}`
  for (let n = 2; text.includes(`id: "${id}"`); n++) id = `${node.name.charAt(0).toLowerCase() + node.name.slice(1)}${n}`
  const effect = `.matchedGeometryEffect(id: "${id}", in: ${name})`
  return [...patches, ...space ? [] : [insertStoredMember(ctx, struct, `@Namespace private var ${name}`)], appended(ctx, node, effect), appended(ctx, target.node, effect)]
}

/** A Visibility group setting written (Wave 5a): the transition, its edge, Fades too. */
export function motionEdit(ctx: FeatureContext, node: AuthoringNode, id: string, value: string): SourcePatch[] {
  const control = motionControls(ctx, node).find(c => c.id === id)
  if (!control) throw new Error('This setting isn’t offered on this view. Select it again.')
  const named = id === MOTION_CONTROLS.transition ? transitionNamed(value) : undefined, tooNew = named && transitionTooNew(named, deploymentVersion(ctx.deploymentTarget))
  if (tooNew) throw new Error(tooNew)
  const problem = validateControlValue(control, value)
  if (problem) throw new Error(problem)
  if (value === control.value) return []
  if (id === MOTION_CONTROLS.movesWith) return movesWith(ctx, node, value)
  if (id === MOTION_CONTROLS.rollsDigits) {
    const written = modifierNamed(ctx, node, 'contentTransition')
    return value === 'true' ? [appended(ctx, node, `.contentTransition(${numericSwift(ctx, node)})`)] : written ? [removed(ctx, node, written)] : []
  }
  const call = modifierNamed(ctx, node, 'transition'), site = appearSite(ctx, node) as Exclude<ReturnType<typeof appearSite>, { problem: string }>
  const current = transitionOf(ctx, node)
  if (id === MOTION_CONTROLS.transition && !named) throw new Error('Choose a transition this view offers.')
  const next: Transition = named ? { ...current, kind: named } : id === MOTION_CONTROLS.edge ? { ...current, edge: value } : { ...current, fades: value === 'true' }
  if (next.kind === 'none') return call ? [removed(ctx, node, call), ...unusedAnimation(ctx, node, site)] : []
  if (call) return [patch(call.args[0]!.value.span, transitionSwift(next))]
  return [appended(ctx, node, `.transition(${transitionSwift(next)})`), ...containerAnimation(ctx, node, site)]
}

/**
 * Appear animation, as the Advanced section wrote it before Wave 5a: a new opacity, slide or
 * scale transition, and an ease in and out of `duration` on the view around it that stays.
 */
export function configureTransition(ctx: FeatureContext, node: AuthoringNode, state: string, style: 'opacity' | 'slide' | 'scale', duration: number): SourcePatch[] {
  if (!['opacity', 'slide', 'scale'].includes(style) || !Number.isFinite(duration) || duration < 0 || duration > 2) throw new Error('Use a supported transition and a duration from 0 to 2 seconds.')
  const site = appearSite(ctx, node)
  if ('problem' in site) throw new Error(site.problem)
  if (modifierNamed(ctx, node, 'transition')) throw new Error('This view has a transition already. Change it under Transition.')
  if (!site.owner) throw new Error('An appear animation needs a container that stays while this view comes and goes. Put it in a stack first.')
  return [appended(ctx, node, `.transition(.${style})`), ...containerAnimation(ctx, node, { owner: site.owner, value: site.value ?? (state || undefined) }, `.easeInOut(duration: ${duration})`)]
}
