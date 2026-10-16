import { nameInWords, type AuthoringNode, type AuthoringOperation, type DesignEditRequest, type InstanceSettings, type SourceFile } from '@studio/shared'
import { constantOf, forEachChild, type CallExpr, type Decl, type EnumDecl, type Expr, type Node, type Pattern, type StructDecl, type VarDecl } from '@studio/swift-syntax'
import { isAction, isComponent, ownInit, projectComponents, sampleOf } from './authoring-components'
import { callOf, enumCases, extensionsNamed, hasComments, namedStruct, ownerOf, raw, scalarType, shadowsMember, type FeatureContext } from './authoring-context'
// A type only: the writers themselves are imported when first used, below.
import type * as InstanceWriters from './authoring-instances'

/** The swap and detach writers, once loaded: kept out of the worker's first chunk, as a designer uses them rarely (Wave 5b). */
let writers: typeof InstanceWriters | undefined

/** Loads what an edit needs before it is planned: the swap and detach writers for those two. The planner itself stays synchronous. */
export async function prepareDesignEdit(request: Pick<DesignEditRequest, 'operation'>): Promise<void> {
  if (!writers && request.operation.kind.startsWith('instance-')) writers = await import('./authoring-instances')
}

/** A swap or a detach of the copy `node`, by the loaded writers. */
export function instanceEdit(ctx: FeatureContext, node: AuthoringNode, operation: Extract<AuthoringOperation, { kind: 'instance-swap' | 'instance-detach' }>): { files: SourceFile[]; offset: number } {
  if (!writers) throw new Error('Swap and Detach are still loading. Try again.')
  return operation.kind === 'instance-swap' ? writers.swapInstance(ctx, node, operation.component) : writers.detachInstance(ctx, node)
}

/** What a copy reads for Swap and Detach: each other component, and why it can't become one. */
export function instanceSettings(ctx: FeatureContext, node: AuthoringNode): InstanceSettings | undefined {
  const call = node.kind === 'component' && node.definitionId ? callOf(ctx, node) : undefined, decl = call && namedStruct(ctx, node.name)
  if (!call || !decl || !isComponent(ctx, node.name)) return undefined
  const detachDisabledReason = detachProblem(ctx, node)
  // The list depends on the copy's component, its screen and the labels and types of what it gives: copies alike share one.
  const given = givenInputs(ctx, decl, call), key = `${node.name}\0${node.owner}\0${given ? [...given].map(([name, value]) => `${name}:${value.type}${value.trailing ? '{}' : ''}`).join(',') : '?'}`
  let lists = swapCache.get(ctx)
  if (!lists) swapCache.set(ctx, lists = new Map())
  const commented = hasComments(ctx, call.span)
  let swap = commented ? undefined : lists.get(key)
  if (!swap) {
    const list: InstanceSettings['swap'][number][] = []
    for (const component of projectComponents(ctx)) if (component !== node.name) { const problem = swapProblem(ctx, node, component, given, commented); list.push(problem ? { component, disabledReason: problem } : { component }) }
    if (!commented) lists.set(key, list)
    swap = list
  }
  return detachDisabledReason ? { swap, detachDisabledReason } : { swap }
}
const swapCache = new WeakMap<FeatureContext, Map<string, InstanceSettings['swap']>>()

const COMMENTED = 'This copy has comments in it, which Swap and Detach would lose. Change it in Code.'
/** Why a screen placed as one, in the window, a tab or a destination, is neither swapped nor detached (Wave 5b). */
const screenCopy = (name: string) => `${name} is a screen, not a component, so it can’t be swapped or detached.`

/** Why the copy `node` can't become the plain views it shows, or undefined when it can. */
export function detachProblem(ctx: FeatureContext, node: AuthoringNode): string | undefined {
  const decl = namedStruct(ctx, node.name), call = callOf(ctx, node)
  if (!decl || !call) return 'This copy changed. Select it again.'
  if (!isComponent(ctx, node.name)) return screenCopy(node.name)
  if (hasComments(ctx, call.span)) return COMMENTED
  const main = mainViews(ctx, decl)
  if ('problem' in main) return main.problem
  const given = givenInputs(ctx, decl, call)
  if (!given) return 'This copy’s inputs are written in a way Detach can’t follow. Change it in Code.'
  // `.b` outside the Main is written with its type, `Untyped.Style.b`, which must be known.
  for (const [name, value] of given) { const bare = implicitStart(value.expr); if (bare && !namedOf(value.type)) return `Detach can’t tell which type ${name} is, to write ${raw(ctx, bare.span)} in full. Change it in Code.` }
  // What the Main reads from its own file must be seen from the copy's: an import, and nothing private to it.
  if (call.span.file !== decl.span.file) {
    const own = fileScope(ctx, decl.span.file), there = fileScope(ctx, call.span.file)
    const missing = [...own.imports].find(m => !there.imports.has(m) && !(m === 'Foundation' && there.imports.has('SwiftUI')))
    if (missing) return `${decl.name}’s file imports ${missing}, which this copy’s file doesn’t. Change it in Code.`
    const hidden = main.outside.find(name => own.hidden.has(name))
    if (hidden) return `${decl.name} uses ${hidden}, which only ${decl.span.file.slice(decl.span.file.lastIndexOf('/') + 1)} can see. Change it in Code.`
  }
  for (const field of main.checked) { const value = given.get(field.name)?.expr ?? field.initializer; if (value && constantOf(value) === undefined) return `Detach can fold whether ${field.name} is set only when this copy writes it out. Change it in Code.` }
  // A name the copy gives the Main must mean the same inside it, and one the Main reads from outside it the same where the copy is.
  let captured: string | undefined
  const visit = (n: Node) => { if (n.kind === 'identifier' && main.bound.has(n.name)) captured ??= n.name; forEachChild(n, visit) }
  for (const value of given.values()) visit(value.expr)
  if (captured) return `${captured} means something else inside ${decl.name}. Change it in Code.`
  const owner = ownerOf(ctx, node), local = owner && boundIn(ctx, owner)
  const shadowed = main.free.find(name => owner?.members.some(m => 'name' in m && m.name === name) || local?.has(name) && shadowsMember(ctx, node, name))
  return shadowed && `${shadowed} means something else where this copy is. Change it in Code.`
}

const detachCache = new WeakMap<FeatureContext, Map<StructDecl, MainViews>>()
type MainViews = { problem: string } | { free: readonly string[]; outside: readonly string[]; bound: ReadonlySet<string>; checked: ReadonlySet<VarDecl> }
/**
 * Why a Main's views can't stand on their own, worked out once for each Main: state, a
 * binding, the environment or a model it keeps; a helper or an input its body calls; an init
 * or generics of its own; a name its body gives a value that an input has. Or the names its
 * body reads from outside it, which must mean the same where a copy is, and the names it
 * gives values, which a copy's inputs must not read.
 */
function mainViews(ctx: FeatureContext, decl: StructDecl): MainViews {
  let byMain = detachCache.get(ctx)
  if (!byMain) detachCache.set(ctx, byMain = new Map())
  let found = byMain.get(decl)
  if (!found) byMain.set(decl, found = readMain(ctx, decl))
  return found
}
function readMain(ctx: FeatureContext, decl: StructDecl): MainViews {
  const name = decl.name
  if (decl.generics.length) return { problem: `${name} takes views of its own, so its copies can’t be detached. Change it in Code.` }
  if (ownInit(decl)) return { problem: `${name} has an init of its own, so Detach can’t tell what each input holds. Change it in Code.` }
  const members = [...decl.members, ...extensionsNamed(ctx, name).flatMap(e => e.members)]
  const body = members.find((m): m is VarDecl => m.kind === 'varDecl' && m.name === 'body' && !!m.accessor)?.accessor
  if (!body || !body.statements.every(s => ['exprStmt', 'ifStmt', 'switchStmt', 'returnStmt'].includes(s.kind))) return { problem: `${name}’s body does more than show views. Change it in Code.` }
  const stored = new Map<string, VarDecl>()
  for (const member of decl.members) {
    if (member.kind !== 'varDecl' || member.accessor || member.modifiers.some(m => m.name === 'static')) continue
    const attribute = member.attributes[0]
    if (attribute) return { problem: `${name} keeps @${attribute.name} ${member.name}, which plain views can’t keep. Change it in Code.` }
    const type = member.typeAnnotation?.kind === 'namedType' ? member.typeAnnotation.name : member.initializer?.kind === 'call' && member.initializer.callee.kind === 'identifier' ? member.initializer.callee.name : undefined
    if (type && namedStruct(ctx, type)?.isReference) return { problem: `${name} watches ${member.name}, a ${type}, which plain views can’t. Change it in Code.` }
    stored.set(member.name, member)
  }
  // A type declared in the Main is written in full where a copy is, `Pill.Style`, which it can't be when private to it.
  const nested = decl.members.filter((m): m is StructDecl | EnumDecl => m.kind === 'enumDecl' || m.kind === 'structDecl')
  const hidden = nested.find(m => m.modifiers.some(x => ['private', 'fileprivate'].includes(x.name)))
  if (hidden) return { problem: `${name}’s ${hidden.name} is private to it, so its copies can’t be detached. Change it in Code.` }
  // What else the Main declares, which a body reading it takes along: a method, a computed or static value, a type alias.
  const helpers = new Set(members.flatMap(m => m.kind === 'varDecl' ? (m.name !== 'body' && !stored.has(m.name) ? [m.name] : []) : 'name' in m && m.kind !== 'enumDecl' && m.kind !== 'structDecl' ? [m.name as string] : []))
  const bound = namesBound(body), read = new Set<string>(), pairs = new Set<string>(), checked = new Set<VarDecl>()
  let problem: string | undefined
  /** The input `n` reads, if it reads one: `title` or `self.title`. */
  const input = (n: Node) => n.kind === 'identifier' ? stored.get(n.name) : n.kind === 'memberAccess' && n.base?.kind === 'selfExpr' ? stored.get(n.member) : undefined
  const reads = (named: string) => {
    if (helpers.has(named)) problem ??= `${name}’s body uses ${named}, a helper of its own. Change it in Code.`
    else if (!stored.has(named)) read.add(named)
  }
  const visit = (n: Node, parent?: Node) => {
    switch (n.kind) {
      case 'call': {
        const callee = n.callee.kind === 'identifier' ? n.callee.name : n.callee.kind === 'memberAccess' && n.callee.base?.kind === 'selfExpr' ? n.callee.member : undefined
        if (callee && stored.get(callee)?.typeAnnotation?.kind === 'functionType') problem ??= `${name} calls its ${callee} input, so its copies can’t be detached. Change it in Code.`
        break
      }
      // Whether an input is set folds only for a value written out: `subtitle ?? "none"`, `subtitle != nil`.
      case 'binary': for (const [side, other] of [[n.left, n.right], [n.right, n.left]] as const) { const field = input(side); if (field && (n.operator === '??' && side === n.left || ['==', '!='].includes(n.operator) && other.kind === 'nilLiteral')) checked.add(field) } break
      case 'optionalChain': case 'forceUnwrap': { const field = input(n.operand); if (field) problem ??= `${name} unwraps ${field.name}, which Detach can’t write plainly. Change it in Code.`; break }
      case 'identifier': reads(n.name); break
      case 'memberAccess': if (n.base?.kind === 'selfExpr') { reads(n.member); return } if (n.base?.kind === 'identifier' || n.base?.kind === 'memberAccess') pairs.add(`${n.base.kind === 'identifier' ? n.base.name : n.base.member}.${n.member}`); break
      case 'namedType': n.name.split('.').forEach((part, i, parts) => i ? pairs.add(`${parts[i - 1]}.${part}`) : reads(part)); break
      case 'selfExpr': if (parent?.kind !== 'memberAccess') problem ??= `${name}’s body uses itself as a value. Change it in Code.`; break
    }
    forEachChild(n, child => visit(child, n))
  }
  visit(body)
  const shadow = [...bound].find(b => stored.has(b))
  if (shadow) problem ??= `${name}’s body names a value ${shadow}, as one of its inputs is named. Change it in Code.`
  if (problem) return { problem }
  const free = [...read].filter(r => !bound.has(r) && !nested.some(m => m.name === r))
  return { free, outside: [...free, ...pairs], bound, checked }
}

/** A component's input: its declaration, and its type as Swift reads it when that can be worked out. */
export interface Input { readonly field: VarDecl; readonly type?: string }
const inputCache = new WeakMap<FeatureContext, Map<StructDecl, readonly Input[]>>()
/**
 * The values a call of a component gives it, by the memberwise initialiser: its stored
 * inputs, in order, each with its type, a binding marked, so two inputs fit when their types
 * are known and equal. Worked out once for each component.
 */
export function inputsOf(ctx: FeatureContext, decl: StructDecl): readonly Input[] {
  let byDecl = inputCache.get(ctx)
  if (!byDecl) inputCache.set(ctx, byDecl = new Map())
  let found = byDecl.get(decl)
  if (!found) byDecl.set(decl, found = decl.members.filter((m): m is VarDecl => m.kind === 'varDecl' && !m.accessor && !m.modifiers.some(x => ['static', 'private', 'fileprivate'].includes(x.name)) && !(m.isLet && m.initializer) && m.attributes.every(a => a.name === 'Binding'))
    .map(field => { const type = typeOf(ctx, decl, field); return { field, type: type && (field.attributes.length ? '@Binding ' : '') + type } }))
  return found
}

/**
 * The type of `field`, a stored property of `decl`, as Swift reads it, each type nested in
 * `decl` named in full (Wave 5b): `Style` in Badge is `Badge.Style`, never Chip's. With no
 * written type, a plain literal's, or the enum or the Color or Font of a case it starts as;
 * otherwise undefined, as it can't be worked out here.
 */
export function typeOf(ctx: FeatureContext, decl: StructDecl, field: VarDecl): string | undefined {
  const nested = new Set([decl, ...extensionsNamed(ctx, decl.name)].flatMap(d => d.members.flatMap(m => ['enumDecl', 'structDecl', 'typealiasDecl'].includes(m.kind) ? [(m as { name: string }).name] : [])))
  const full = (written: string) => written.replace(/\s/g, '').replace(/(^|[^\w.])([A-Z]\w*)/g, (whole, before: string, name: string) => nested.has(name) ? `${before}${decl.name}.${name}` : whole)
  if (field.typeAnnotation) return full(raw(ctx, field.typeAnnotation.span))
  const start = field.initializer, scalar = scalarType(null, start)?.type
  if (scalar || start?.kind !== 'memberAccess' || !start.base || !/^[A-Z][\w.]*$/.test(raw(ctx, start.base.span))) return scalar
  const type = full(raw(ctx, start.base.span)), inside = type.startsWith(`${decl.name}.`) ? type.slice(decl.name.length + 1) : undefined
  const cases = inside ? [decl, ...extensionsNamed(ctx, decl.name)].flatMap(d => d.members).find((m): m is EnumDecl => m.kind === 'enumDecl' && m.name === inside)?.cases.map(c => c.name) : enumCases(ctx, type)
  return type === 'Color' || type === 'Font' || cases?.includes(start.member) ? type : undefined
}

const usesCache = new WeakMap<FeatureContext, ReadonlyMap<string, ReadonlySet<string>>>()
/** Which components each view shows, by name: worked out once a context (Wave 5b). */
function uses(ctx: FeatureContext): ReadonlyMap<string, ReadonlySet<string>> {
  let found = usesCache.get(ctx)
  if (found) return found
  const byOwner = new Map<string, Set<string>>()
  for (const n of ctx.nodes) if (n.kind === 'component' && n.definitionId) { let set = byOwner.get(n.owner); if (!set) byOwner.set(n.owner, set = new Set()); set.add(n.name) }
  usesCache.set(ctx, found = byOwner)
  return found
}
/** Whether `name` shows `owner`, itself or through what it shows. */
function shows(ctx: FeatureContext, name: string, owner: string, seen = new Set<string>()): boolean {
  if (name === owner) return true
  if (seen.has(name)) return false
  seen.add(name)
  for (const next of uses(ctx).get(name) ?? []) if (shows(ctx, next, owner, seen)) return true
  return false
}

/**
 * Why the copy `node` can't become a copy of `component`, or undefined when it can: each
 * input the target has is kept when the copy gives it with the same type, has a default, is
 * an action, or takes a sample, as a new copy does. `given` and `commented` are the copy's,
 * worked out once for every target (Wave 5b).
 */
export function swapProblem(ctx: FeatureContext, node: AuthoringNode, component: string, given: ReadonlyMap<string, Given> | undefined, commented: boolean): string | undefined {
  const decl = namedStruct(ctx, component)
  if (!isComponent(ctx, node.name)) return screenCopy(node.name)
  if (!decl || !isComponent(ctx, component)) return `${component} is no longer a component here. Select the copy again.`
  if (decl.generics.length) return `${component} takes views of its own, so a copy can’t become it. Change it in Code.`
  if (ownInit(decl)) return `${component} has an init of its own, so its inputs can’t be matched. Change it in Code.`
  if (shows(ctx, component, node.owner)) return `${component} shows ${node.owner}, so it can’t go inside it.`
  if (commented) return COMMENTED
  if (!given) return 'This copy’s inputs are written in a way Swap can’t follow. Change it in Code.'
  for (const { field, type } of inputsOf(ctx, decl)) {
    if (fits(given.get(field.name), type) || field.initializer || isAction(field.typeAnnotation)) continue
    if (sampleOf(ctx, field.typeAnnotation, field.name) === undefined) return `${component} needs a ${nameInWords(field.name).toLowerCase()} this copy doesn’t have. Change it in Code.`
  }
  return undefined
}
/** A type written as a name alone, as a case read from it is: `Pill.Style` for `Pill.Style?` (Wave 5b). */
export const namedOf = (type: string | undefined) => type?.replace(/[?!]$/, '').match(/^[\w.]+$/)?.[0]
/** The case an expression starts with when it is written with no type, `.orange` in `.orange.opacity(0.5)`. */
export function implicitStart(expr: Expr): Expr | undefined {
  let start: Node = expr
  while (start.kind === 'memberAccess' && start.base || start.kind === 'call') start = start.kind === 'call' ? start.callee : start.base!
  return start.kind === 'memberAccess' ? start : undefined
}
/** Whether a value the copy gives goes to an input of `type`: both types known, and the same. */
export const fits = (value: Given | undefined, type: string | undefined): value is Given => !!value && value.type !== undefined && value.type === type

/** A value a copy gives an input: as written, the input's type, and whether it is the closure after the call. */
export interface Given { readonly expr: Expr; readonly type?: string; readonly trailing?: true }
/** The inputs a call gives its component, by label: the closure after it as the component's last input. Undefined when an argument has no label the component has. */
export function givenInputs(ctx: FeatureContext, decl: StructDecl, call: CallExpr): Map<string, Given> | undefined {
  const fields = inputsOf(ctx, decl), result = new Map<string, Given>()
  for (const argument of call.args) {
    const input = fields.find(f => f.field.name === argument.label)
    if (!input) return undefined
    result.set(input.field.name, { expr: argument.value, type: input.type })
  }
  const last = fields.at(-1)
  if (call.trailingClosure) {
    if (!last || last.field.typeAnnotation?.kind !== 'functionType' || result.has(last.field.name)) return undefined
    result.set(last.field.name, { expr: call.trailingClosure, type: last.type, trailing: true })
  }
  return result
}

const scopeCache = new WeakMap<FeatureContext, Map<string, { imports: ReadonlySet<string>; hidden: ReadonlySet<string> }>>()
/**
 * What a file imports, and what it declares that only it can see: a `private` or `fileprivate`
 * declaration at its top level by name, and one inside a type or an extension as `Theme.corner`.
 * Found once for each file (Wave 5b).
 */
function fileScope(ctx: FeatureContext, file: string) {
  let byFile = scopeCache.get(ctx)
  if (!byFile) scopeCache.set(ctx, byFile = new Map())
  let found = byFile.get(file)
  if (found) return found
  const imports = new Set<string>(), hidden = new Set<string>()
  const visit = (decl: Decl, owner?: string) => {
    if (decl.kind === 'importDecl') imports.add(decl.module)
    const name = 'name' in decl ? decl.name as string : undefined
    if (name && 'modifiers' in decl && decl.modifiers.some(m => m.name === 'private' || m.name === 'fileprivate')) hidden.add(owner ? `${owner}.${name}` : name)
    if ('members' in decl) for (const member of decl.members) visit(member, name)
  }
  for (const source of ctx.ast) if (source.span.file === file) source.declarations.forEach(d => visit(d))
  byFile.set(file, found = { imports, hidden })
  return found
}

/** Every name given a value inside `root`: a closure's parameters, a local, an `if let`, a loop's, a pattern's. */
function namesBound(root: Node): Set<string> {
  const bound = new Set<string>()
  const bind = (pattern: Pattern) => { if (pattern.kind === 'binding') bound.add(pattern.name); if (pattern.kind === 'enumCase') pattern.bindings.forEach(b => bound.add(b.name)); if (pattern.kind === 'tuplePattern') pattern.elements.forEach(bind) }
  const visit = (n: Node) => {
    switch (n.kind) {
      case 'closure': n.params.forEach(p => bound.add(p.name)); break
      case 'declStmt': if ('name' in n.declaration) bound.add(n.declaration.name as string); break
      case 'ifStmt': case 'guardStmt': case 'whileStmt': n.conditions.forEach(c => { if (c.kind === 'optionalBinding') bound.add(c.name); if (c.kind === 'caseMatch') bind(c.pattern) }); break
      case 'forInStmt': bound.add(n.variable); n.destructured?.forEach(d => bound.add(d.name)); break
      case 'switchStmt': n.cases.forEach(c => c.patterns.forEach(bind)); break
    }
    forEachChild(n, visit)
  }
  visit(root)
  return bound
}
const boundCache = new WeakMap<FeatureContext, Map<StructDecl, Set<string>>>()
/** The names given values anywhere in a screen, found once: only these can be shadowed where a copy is. */
function boundIn(ctx: FeatureContext, owner: StructDecl): Set<string> {
  let byOwner = boundCache.get(ctx)
  if (!byOwner) boundCache.set(ctx, byOwner = new Map())
  let found = byOwner.get(owner)
  if (!found) byOwner.set(owner, found = namesBound(owner))
  return found
}
