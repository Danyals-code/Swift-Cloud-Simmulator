import { forEachChild, type Decl, type Expr, type IfStmt, type Node, type StructDecl, type TypeRef, type VarDecl } from '@studio/swift-syntax'
import type { AuthoringNode, DesignValue, PreviewInput, SourceSpan, StateChoice, StateInput, StateKind, SuggestedState } from '@studio/shared'
import { declarationsNamed, enumCases, extensionsNamed, layerById, literal, namedStruct, ownerOf, raw, scalarType, signature, type FeatureContext } from './authoring-context'

/**
 * The states a screen's conditions draw (Wave 3b): for each branch of an `if` the screen
 * shows, the values that draw it, named as a designer reads them, such as Loading, Empty,
 * Error and Has items. The values are the screen's own `@State`, and the members of a
 * model it reads through `@State`, `@StateObject`, `@Environment`, `@EnvironmentObject`
 * or `@Bindable`: a Bool, an optional, or a list that is empty or not. A condition the
 * preview can't set is listed with why, never offered as a state that does nothing.
 */

/** A value a condition reads, as a state sets it: its input, and how its type lets it change. */
interface Slot {
  readonly input: StateInput
  /** The member's own name, which names the states it draws. */
  readonly member: string
  readonly kind: StateKind
  /** The value that makes it present, not empty, or another case; or why there is none. */
  readonly sample: DesignValue | { readonly problem: string }
}
/**
 * One value a state gives, and the name it gives the state when it is what draws the
 * branch. `not` marks a value picked only for not being another: any other case will do.
 */
interface Fact { readonly slot: Slot; readonly value: DesignValue; readonly label: string; readonly not?: DesignValue }
/** A branch a state would draw, but for a value the preview has no sample of. */
interface Missing { readonly slot: Slot; readonly label: string; readonly problem: string }
/** The values that make a condition true or false: none it can be (null), or one missing. */
type Outcome = readonly Fact[] | Missing | null
type ConditionReading = { readonly when: (truth: boolean) => Outcome } | { readonly problem: string }
/** Whose members a name reads: the screen's own, or a model's it reaches through `via`. */
interface Scope {
  readonly decl: StructDecl
  readonly typeName: string
  readonly prefix: string
  readonly via?: VarDecl
  readonly screen: Screen
}
interface Screen {
  readonly ctx: FeatureContext
  readonly owner: string
  readonly plain: ReadonlyMap<string, StateInput>
  readonly slots: Map<string, Slot>
  readonly depth: number
}

/** Why the preview can't set what a condition reads, in a designer's words. */
const WHY = {
  runtime: (text: string) => `${text} is worked out when the app runs, not read from a value the screen or its model stores, so the preview can’t set it.`,
  argument: (name: string) => `${name} is given by the screen that shows this one, so the preview can’t set it here.`,
  local: (name: string) => `${name} is given where this part of the screen is used, so the preview can’t set it here.`,
  system: (name: string) => `${name} comes from the system, so the preview can’t set it.`,
  saved: (name: string) => `${name} is saved on the device, so the preview can’t set it.`,
  interaction: (name: string) => `${name} changes as people use the screen, so the preview can’t set it.`,
  fixed: (name: string) => `${name} is fixed when the model is made, so the preview can’t set it.`,
  reached: (text: string) => `${text} is reached through another object, which the preview can’t follow.`,
  computed: (name: string) => `${name} is worked out from other values, so the preview can’t set it.`,
  derived: (name: string, source: string) => `${name} is worked out from ${source}, so the preview can show it empty but can’t choose its items.`,
  type: (name: string, type: string) => `${name} holds ${article(type)}, which the preview can’t set.`,
  items: (name: string) => `${name} starts empty and is filled when the app runs, so the preview has no items to show.`,
  sample: (name: string, type: string) => `${name} holds ${article(type)}, and the preview has no sample one to show.`,
  error: (name: string, type: string) => `${name} holds ${article(type)}, and the preview can’t choose what one says. Store a message (a String) to preview it.`,
}
const article = (type: string) => (/^[AEIO]/.test(type) ? 'an ' : 'a ') + type

/** The words of a Swift name: `isURLValid` is is, URL, valid. */
const words = (name: string) => (name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [name]).map(word => word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase())
/** A member's name as a designer reads it: `isSignedIn` is "Signed in", `errorMessage` "Error message". */
function prettyName(name: string): string {
  const parts = words(name)
  if (parts.length > 1 && parts[0] === 'is') parts.shift()
  const text = parts.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
const lower = (text: string) => /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text
/** The other side of a flag: "Hasn't seen intro", "Not signed in". */
function negated(text: string): string {
  const verb = /^(Has|Can|Should|Does) (.*)$/.exec(text)
  return verb ? `${verb[1]}n’t ${verb[2]}` : `Not ${lower(text)}`
}
/** An optional with nothing in it: "No selected article", "Not selected". */
const absent = (text: string) => /ed$/.test(text) ? `Not ${lower(text)}` : `No ${lower(text)}`
const ERRORISH = /error|fail|alert|problem|warning/i
const LOADINGISH = /load|fetch/i
const SAMPLE_ERROR = 'Something went wrong.'
/**
 * The error a state shows for a model's `Error?`: one that says the sample message, which
 * `localizedDescription` reads. A preview state declares it beside the app, never in it.
 */
export const PREVIEW_ERROR = 'StudioPreviewError'
export const PREVIEW_ERROR_DECLARATION = `struct ${PREVIEW_ERROR}: LocalizedError {\n    var errorDescription: String?\n}`

const conditionCache = new WeakMap<FeatureContext, Map<string, AuthoringNode[]>>()
/** Each screen's `if` branches, in source order: found in one pass over the layers for every screen. */
function conditionsOf(ctx: FeatureContext, owner: string): readonly AuthoringNode[] {
  let byOwner = conditionCache.get(ctx)
  if (!byOwner) {
    conditionCache.set(ctx, byOwner = new Map())
    for (const node of ctx.nodes) {
      if (node.kind !== 'branch' || node.name !== 'Condition') continue
      const owned = byOwner.get(node.owner)
      if (owned) owned.push(node)
      else byOwner.set(node.owner, [node])
    }
  }
  return byOwner.get(owner) ?? []
}
/** A span as a key: its offsets first, as a file name may hold any character. */
const spanKey = (span: SourceSpan) => `${span.start}:${span.end}:${span.file}`

/** Every member and statement of a type's own code, and its extensions'. */
const codeOf = (ctx: FeatureContext, decl: StructDecl, name: string): readonly Decl[] => [...decl.members, ...extensionsNamed(ctx, name).flatMap(e => e.members)]
/** The member `name` or `self.name` reads, written in the type's own code. */
const ownMember = (expr: Expr): string | undefined => expr.kind === 'identifier' ? expr.name : expr.kind === 'memberAccess' && expr.base?.kind === 'selfExpr' ? expr.member : undefined

/** By context, as a type's code includes the extensions that context has. */
const assignmentCache = new WeakMap<FeatureContext, Map<StructDecl, Map<string, Expr[]>>>()
/** What a type's own code assigns to each of its members, `items = …` or `self.items = …`, in order. */
function assignments(ctx: FeatureContext, decl: StructDecl, name: string): ReadonlyMap<string, readonly Expr[]> {
  let byType = assignmentCache.get(ctx)
  if (!byType) assignmentCache.set(ctx, byType = new Map())
  let found = byType.get(decl)
  if (found) return found
  const assigned = found = new Map<string, Expr[]>()
  byType.set(decl, assigned)
  const visit = (node: Node) => {
    const member = node.kind === 'assign' && node.operator === '=' ? ownMember(node.target) : undefined
    if (member && node.kind === 'assign') {
      const values = assigned.get(member)
      if (values) values.push(node.value)
      else assigned.set(member, [node.value])
    }
    forEachChild(node, visit)
  }
  for (const member of codeOf(ctx, decl, name)) if (member.kind !== 'varDecl' || member.accessor) visit(member)
  return assigned
}

/**
 * Swift that means the same wherever it is written: literals, and types' initialisers and
 * cases made of them, as `Article(id: 1, title: "Hello")` and `Plan.free` are. Records a
 * model's own code fills a list with are copied only when they are.
 */
function selfContained(expr: Expr): boolean {
  switch (expr.kind) {
    case 'integerLiteral': case 'floatLiteral': case 'booleanLiteral': case 'nilLiteral': return true
    case 'stringLiteral': return expr.segments.every(s => s.kind === 'text')
    case 'unary': return expr.operator === '-' && selfContained(expr.operand)
    case 'arrayLiteral': return expr.elements.every(selfContained)
    case 'dictionaryLiteral': return expr.entries.every(e => selfContained(e.key) && selfContained(e.value))
    case 'memberAccess': return !expr.base || expr.base.kind === 'identifier' && /^[A-Z]/.test(expr.base.name)
    case 'call': return !expr.trailingClosure && (expr.callee.kind === 'identifier' ? /^[A-Z]/.test(expr.callee.name) : expr.callee.kind === 'memberAccess' && selfContained(expr.callee)) && expr.args.every(a => selfContained(a.value))
    default: return false
  }
}

/** A member's type, as written or as its initial value says: `[Article]`, `String?`, `Plan`. */
function typeOf(ctx: FeatureContext, decl: VarDecl): { readonly name: string; readonly optional: boolean; readonly element?: string; readonly text: string } | undefined {
  const scalar = scalarType(decl.typeAnnotation, decl.initializer)
  if (scalar) return { name: scalar.type, optional: scalar.optional, text: scalar.type }
  const named = (type: TypeRef | null | undefined): string | undefined => type?.kind === 'namedType' && !type.generics.length ? type.name : undefined
  const annotation = decl.typeAnnotation
  if (annotation) {
    const optional = annotation.kind === 'optionalType', inner = annotation.kind === 'optionalType' ? annotation.wrapped : annotation
    const text = raw(ctx, inner.span).replace(/\s+/g, ' ').trim()
    if (inner.kind === 'arrayType') return { name: 'Array', optional, element: named(inner.element), text }
    return { name: named(inner) ?? text, optional, text }
  }
  const value = decl.initializer
  if (!value) return undefined
  if (value.kind === 'arrayLiteral' && value.elements.length) {
    const first = value.elements[0]!
    const element = first.kind === 'stringLiteral' ? 'String' : first.kind === 'call' && first.callee.kind === 'identifier' ? first.callee.name : undefined
    if (element && value.elements.every(e => element === 'String' ? e.kind === 'stringLiteral' : e.kind === 'call' && e.callee.kind === 'identifier' && e.callee.name === element)) return { name: 'Array', optional: false, element, text: `[${element}]` }
  }
  if (value.kind === 'call' && value.callee.kind === 'identifier' && /^[A-Z]/.test(value.callee.name)) return { name: value.callee.name, optional: false, text: value.callee.name }
  // `Phase.idle`, a case of the type it names.
  if (value.kind === 'memberAccess' && value.base?.kind === 'identifier' && /^[A-Z]/.test(value.base.name)) return { name: value.base.name, optional: false, text: value.base.name }
  return undefined
}

/** The Swift for a list's items a state can show: its own, or what its type's code fills it with. */
function itemsOf(ctx: FeatureContext, scope: Scope, decl: VarDecl, element: string | undefined): string | undefined {
  const initial = decl.initializer
  if (initial && (initial.kind === 'arrayLiteral' ? initial.elements.length > 0 : selfContained(initial))) return raw(ctx, initial.span)
  const assigned = assignments(ctx, scope.decl, scope.typeName).get(decl.name)?.find(value => value.kind === 'arrayLiteral' ? value.elements.length > 0 && selfContained(value) : value.kind === 'memberAccess' && selfContained(value))
  if (assigned) return raw(ctx, assigned.span)
  const samples = element && staticSamples(ctx, element).find(s => s.list)
  return samples ? `${element}.${samples.name}` : undefined
}
/** A type's static values of itself or of a list of it, `static let samples: [Article]`, `static let preview = Article(…)`. */
type StaticSample = { readonly name: string; readonly list: boolean; readonly value: Expr | null }
function staticSamples(ctx: FeatureContext, type: string): StaticSample[] {
  const decl = namedStruct(ctx, type)
  const members = [...(decl?.members ?? []), ...extensionsNamed(ctx, type).flatMap(e => e.members)]
  return members.flatMap((member): StaticSample[] => {
    if (member.kind !== 'varDecl' || member.accessor || !member.modifiers.some(m => m.name === 'static')) return []
    const annotation = member.typeAnnotation, value = member.initializer
    const named = (t: TypeRef | null | undefined) => t?.kind === 'namedType' && (t.name === type || t.name === 'Self')
    const made = (e: Expr | null | undefined) => e?.kind === 'call' && (e.callee.kind === 'identifier' && e.callee.name === type || e.callee.kind === 'memberAccess' && !e.callee.base && e.callee.member === 'init')
    if (annotation?.kind === 'arrayType' ? named(annotation.element) : !annotation && value?.kind === 'arrayLiteral' && value.elements.length > 0 && value.elements.every(made)) return [{ name: member.name, list: true, value }]
    if (named(annotation) || !annotation && made(value)) return [{ name: member.name, list: false, value }]
    return []
  })
}
/**
 * A sample value of a project type, for an optional `member` of it: a case, a static
 * sample, the one the model's own code gives it, a first record, or one made with no values.
 */
function sampleOf(ctx: FeatureContext, scope: Scope, type: string, member: string): string | undefined {
  const cases = enumCases(ctx, type)
  if (cases?.length) return `${type}.${cases[0]}`
  const statics = staticSamples(ctx, type)
  const single = statics.find(s => !s.list)
  if (single) return `${type}.${single.name}`
  const given = assignments(ctx, scope.decl, scope.typeName).get(member)?.find(value => value.kind === 'call' && value.callee.kind === 'identifier' && value.callee.name === type && selfContained(value))
  if (given) return raw(ctx, given.span)
  // The first record of a list of the type the screen's code holds.
  const lists = [...scope.decl.members.flatMap(m => m.kind === 'varDecl' && !m.accessor && m.initializer ? [m.initializer] : []), ...[...assignments(ctx, scope.decl, scope.typeName).values()].flat(), ...statics.flatMap(s => s.list && s.value ? [s.value] : [])]
  const first = lists.flatMap(value => value.kind === 'arrayLiteral' ? value.elements.slice(0, 1) : []).find(e => e.kind === 'call' && e.callee.kind === 'identifier' && e.callee.name === type && selfContained(e))
  if (first) return raw(ctx, first.span)
  const decl = namedStruct(ctx, type)
  const plain = decl && !decl.generics.length && !decl.members.some(m => m.kind === 'initDecl') && decl.members.every(m => m.kind !== 'varDecl' || !!m.accessor || m.modifiers.some(x => x.name === 'static') || !!m.initializer || m.typeAnnotation?.kind === 'optionalType')
  return plain ? `${type}()` : undefined
}

/** A stored member a condition reads, as a slot a state sets: or why it can't be. */
function slotOf(scope: Scope, decl: VarDecl): Slot | { readonly problem: string } {
  const { ctx, slots, plain } = scope.screen
  const path = scope.prefix + decl.name
  const known = slots.get(path)
  if (known) return known
  const onScreen = !scope.via, attributes = decl.attributes.map(a => a.name)
  if (attributes.some(a => a === 'Environment')) return { problem: WHY.system(decl.name) }
  if (attributes.some(a => ['AppStorage', 'SceneStorage', 'Query', 'FetchRequest'].includes(a))) return { problem: WHY.saved(decl.name) }
  if (attributes.some(a => ['FocusState', 'GestureState', 'AccessibilityFocusState', 'Namespace'].includes(a))) return { problem: WHY.interaction(decl.name) }
  if (decl.modifiers.some(m => m.name === 'static')) return { problem: WHY.runtime(path) }
  if (onScreen ? attributes.some(a => a !== 'State') || !decl.initializer : attributes.some(a => !['Published', 'ObservationIgnored'].includes(a))) return { problem: onScreen ? WHY.argument(decl.name) : WHY.runtime(path) }
  if (!onScreen && decl.isLet && !decl.initializer) return { problem: WHY.fixed(decl.name) }
  const type = typeOf(ctx, decl)
  if (!type) return { problem: WHY.runtime(path) }
  const scalar = ['Bool', 'String', 'Int', 'Double'].includes(type.name)
  const cases = !scalar ? enumCases(ctx, type.name) : undefined
  const kind: Slot['kind'] | undefined = type.name === 'Array' ? 'list' : type.optional ? scalar ? 'scalar' : 'optional' : type.name === 'Bool' ? 'flag' : type.name === 'String' ? 'text' : scalar ? 'scalar' : cases?.length ? 'case' : undefined
  if (!kind) return { problem: WHY.type(decl.name, type.text) }
  const initial = decl.initializer
  const sig = onScreen ? signature(ctx, decl) : JSON.stringify([signature(ctx, scope.via!), scope.typeName, signature(ctx, decl)])
  const base = { owner: scope.screen.owner, name: path, signature: sig, source: initial?.span ?? decl.nameSpan, held: { type: scope.typeName, member: decl.name }, kind }
  let input: StateInput, sample: Slot['sample']
  const reused = onScreen ? plain.get(decl.name) : undefined
  if (kind === 'list') {
    const items = itemsOf(ctx, scope, decl, type.element)
    const choices: StateChoice[] = [{ value: 'empty', label: 'No items', swift: '[]' }, ...(items ? [{ value: 'items', label: 'With items', swift: items }] : [])]
    input = { ...base, type: type.text, value: initial?.kind === 'arrayLiteral' ? initial.elements.length ? 'items' : 'empty' : null, choices }
    sample = items ? 'items' : { problem: WHY.items(decl.name) }
  } else if (kind === 'optional') {
    // Any error is shown as the preview's own, which says the sample message. A project's
    // own error type says what its code says, which the preview can't choose.
    const declared = declarationsNamed(ctx, type.name)
    const anyError = /^\(?\s*(?:any\s+)?(?:Error|LocalizedError)\s*\)?$/.test(type.text)
    const ownError = !anyError && declared.length === 1 && 'inherits' in declared[0]! && declared[0].inherits.some(t => /Error$/.test(t.name))
    const swift = anyError ? !declarationsNamed(ctx, PREVIEW_ERROR).length ? `${PREVIEW_ERROR}(errorDescription: "${SAMPLE_ERROR}")` : undefined
      : ownError ? undefined : sampleOf(ctx, scope, type.name, decl.name)
    input = { ...base, type: type.text, optional: true, value: !initial || initial.kind === 'nilLiteral' ? 'none' : null, choices: [{ value: 'none', label: 'None', swift: 'nil' }, ...(swift ? [{ value: 'sample', label: 'A sample', swift }] : [])] }
    sample = swift ? 'sample' : { problem: anyError || ownError ? WHY.error(decl.name, anyError ? 'Error' : type.text) : WHY.sample(decl.name, type.text) }
  } else if (kind === 'case') {
    // Written with its type, as a model's member may have none to give a bare `.loading` one.
    input = reused ?? { ...base, type: type.text, value: initial?.kind === 'memberAccess' && cases!.includes(initial.member) ? initial.member : null, choices: cases!.map(name => ({ value: name, label: prettyName(name), swift: `${type.name}.${name}` })) }
    sample = cases![0]!
  } else {
    input = reused ?? { ...base, type: type.name, value: initial ? literal(ctx, initial) ?? null : null, ...(type.optional ? { optional: true } : {}) }
    const said = assignments(ctx, scope.decl, scope.typeName).get(decl.name)?.map(value => literal(ctx, value)).find((value): value is string => typeof value === 'string' && value.length > 0)
    const current = typeof input.value === 'string' && input.value ? input.value : undefined
    sample = kind === 'flag' ? true : type.name === 'String' ? current ?? said ?? (ERRORISH.test(decl.name) ? SAMPLE_ERROR : prettyName(decl.name)) : type.name === 'Bool' ? true : 1
  }
  const slot: Slot = { input: reused ? { ...reused, held: base.held, kind } : input, member: decl.name, kind, sample }
  slots.set(path, slot)
  return slot
}

/** The stored or computed member a name reads in a scope: a slot, a reading of its body, or why neither. */
function scopeMember(scope: Scope, name: string, text: string): { readonly slot: Slot } | { readonly computed: Expr; readonly decl: VarDecl } | { readonly problem: string } {
  const decl = codeOf(scope.screen.ctx, scope.decl, scope.typeName).find((m): m is VarDecl => m.kind === 'varDecl' && m.name === name)
  // A name the screen does not declare is a parameter or a local of the code around the condition.
  if (!decl) return { problem: !scope.via && /^[a-z_]/.test(name) && name === text ? WHY.local(name) : WHY.runtime(text) }
  if (decl.accessor) {
    const statements = decl.accessor.statements, only = statements.length === 1 ? statements[0] : undefined
    const value = only?.kind === 'returnStmt' ? only.value : only?.kind === 'exprStmt' ? only.expression : null
    return value ? { computed: value, decl } : { problem: WHY.computed(name) }
  }
  const slot = slotOf(scope, decl)
  return 'problem' in slot ? slot : { slot }
}
/** The model a screen's member holds, read through `@State`, `@StateObject`, `@Environment`, `@EnvironmentObject`, `@Bindable` or a plain property. */
function modelScope(scope: Scope, name: string, text: string): Scope | { readonly problem: string } {
  const ctx = scope.screen.ctx
  const member = scope.decl.members.find((m): m is VarDecl => m.kind === 'varDecl' && m.name === name && !m.accessor)
  if (!member) return { problem: /^[a-z_]/.test(name) ? WHY.local(name) : WHY.runtime(text) }
  const environment = member.attributes.find(a => a.name === 'Environment')?.args[0]?.value
  if (environment && !(environment.kind === 'memberAccess' && environment.member === 'self')) return { problem: WHY.system(name) }
  if (member.attributes.some(a => !['State', 'StateObject', 'ObservedObject', 'Environment', 'EnvironmentObject', 'Bindable'].includes(a.name))) return { problem: WHY.reached(text) }
  const annotation = member.typeAnnotation, value = member.initializer
  const type = annotation?.kind === 'namedType' ? annotation.name
    : environment?.kind === 'memberAccess' && environment.base?.kind === 'identifier' ? environment.base.name
      : !annotation && value?.kind === 'call' && value.callee.kind === 'identifier' ? value.callee.name : undefined
  const decl = type ? namedStruct(ctx, type) : undefined
  if (!type || !decl || decl.inherits.some(t => t.name === 'View')) return { problem: WHY.reached(text) }
  // A value is set where it is made: only one the screen makes with no values starts from its type's own.
  if (!decl.isReference && !(value?.kind === 'call' && !value.args.length && !value.trailingClosure)) return { problem: value ? WHY.reached(text) : WHY.argument(name) }
  return { decl, typeName: type, prefix: `${name}.`, via: member, screen: scope.screen }
}

/** The values that make `expr` true or false, read in `scope`. */
function read(scope: Scope, expr: Expr): ConditionReading {
  const ctx = scope.screen.ctx, text = raw(ctx, expr.span)
  if (expr.kind === 'tuple' && expr.elements.length === 1 && !expr.labels[0]) return read(scope, expr.elements[0]!)
  if (expr.kind === 'unary' && expr.operator === '!') return not(read(scope, expr.operand))
  if (expr.kind === 'binary') {
    if (expr.operator === '&&') return both(read(scope, expr.left), read(scope, expr.right))
    if (expr.operator === '||') return not(both(not(read(scope, expr.left)), not(read(scope, expr.right))))
    if (expr.operator === '==' || expr.operator === '!=') {
      const flip = (r: ConditionReading) => expr.operator === '==' ? r : not(r)
      const [side, other] = expr.right.kind === 'nilLiteral' || expr.right.kind === 'memberAccess' && !expr.right.base || expr.right.kind === 'integerLiteral' ? [expr.left, expr.right] : [expr.right, expr.left]
      if (other.kind === 'nilLiteral') return flip(not(present(scope, side)))
      if (other.kind === 'memberAccess' && !other.base) return flip(isCase(scope, side, other.member))
      if (other.kind === 'integerLiteral' && other.value === 0 && side.kind === 'memberAccess' && side.member === 'count' && side.base) return flip(empty(scope, side.base))
    }
    if ((expr.operator === '>' || expr.operator === '>=') && expr.left.kind === 'memberAccess' && expr.left.member === 'count' && expr.left.base && expr.right.kind === 'integerLiteral' && expr.right.value === (expr.operator === '>' ? 0 : 1)) return not(empty(scope, expr.left.base))
    // Another comparison: why the value it reads can't be set, when that is the reason.
    const unset = [expr.left, expr.right].filter(side => side.kind === 'identifier' || side.kind === 'memberAccess' && !!side.base).map(side => resolve(scope, side)).find(found => 'problem' in found)
    return unset && 'problem' in unset ? unset : { problem: WHY.runtime(text) }
  }
  const found = resolve(scope, expr)
  // `items.isEmpty` of a list, unless the model has an `isEmpty` of its own.
  if (expr.kind === 'memberAccess' && expr.member === 'isEmpty' && expr.base && 'problem' in found) return empty(scope, expr.base)
  if ('problem' in found) return found
  if ('computed' in found) return found.scope.screen.depth > 4 ? { problem: WHY.computed(text) } : read({ ...found.scope, screen: { ...found.scope.screen, depth: found.scope.screen.depth + 1 } }, found.computed)
  const slot = found.slot
  if (slot.kind !== 'flag') return { problem: WHY.runtime(text) }
  const loading = LOADINGISH.test(slot.member), name = prettyName(slot.member)
  return { when: truth => [{ slot, value: truth, label: truth ? loading ? 'Loading' : name : loading ? 'Loaded' : negated(name) }] }
}
/** A name, `self.name` or `model.name`: what it reads. */
function resolve(scope: Scope, expr: Expr): { readonly slot: Slot } | { readonly computed: Expr; readonly scope: Scope } | { readonly problem: string } {
  const text = raw(scope.screen.ctx, expr.span)
  let name = ownMember(expr), at = scope
  if (name === undefined && expr.kind === 'memberAccess' && expr.base && !scope.via) {
    const base = ownMember(expr.base)
    if (!base) return { problem: WHY.reached(text) }
    const model = modelScope(scope, base, text)
    if ('problem' in model) return model
    at = model; name = expr.member
  } else if (name === undefined) return { problem: expr.kind === 'memberAccess' && expr.base ? WHY.reached(text) : WHY.runtime(text) }
  const found = scopeMember(at, name, text)
  return 'computed' in found ? { computed: found.computed, scope: at } : found
}
/** `value != nil`, or `if let x = value`. */
function present(scope: Scope, expr: Expr): ConditionReading {
  const found = resolve(scope, expr)
  if ('problem' in found) return found
  if ('computed' in found || found.slot.kind !== 'optional' && !(found.slot.kind === 'scalar' && found.slot.input.optional)) return { problem: WHY.computed(raw(scope.screen.ctx, expr.span)) }
  const slot = found.slot, errorish = ERRORISH.test(slot.member) || ERRORISH.test(slot.input.type), name = prettyName(slot.member)
  const label = errorish ? 'Error' : name
  return { when: truth => truth
    ? typeof slot.sample === 'object' && slot.sample ? { slot, label, problem: slot.sample.problem } : [{ slot, value: slot.sample as DesignValue, label }]
    : [{ slot, value: slot.kind === 'optional' ? 'none' : null, label: errorish ? 'No error' : absent(name) }] }
}
/** Calls that leave an empty list empty: filtering, sorting or mapping one gives one as empty. */
const KEEPS_EMPTY: ReadonlySet<string> = new Set(['filter', 'sorted', 'map', 'compactMap', 'flatMap', 'prefix', 'suffix', 'reversed', 'shuffled', 'dropFirst', 'dropLast'])
/** The stored list a list is, or is worked out from by filtering, sorting or mapping it: `derived` then. */
function listOf(scope: Scope, expr: Expr, depth = 0): { readonly slot: Slot; readonly derived: boolean } | { readonly problem: string } {
  const text = raw(scope.screen.ctx, expr.span)
  if (depth > 4) return { problem: WHY.computed(text) }
  const derived = (found: ReturnType<typeof listOf>) => 'slot' in found ? { slot: found.slot, derived: true } : found
  if (expr.kind === 'call' && expr.callee.kind === 'memberAccess' && expr.callee.base && KEEPS_EMPTY.has(expr.callee.member)) return derived(listOf(scope, expr.callee.base, depth + 1))
  if (expr.kind === 'ternary') {
    const a = listOf(scope, expr.then, depth + 1), b = listOf(scope, expr.else, depth + 1)
    return 'slot' in a && 'slot' in b && a.slot === b.slot ? { slot: a.slot, derived: true } : { problem: WHY.computed(text) }
  }
  const found = resolve(scope, expr)
  if ('problem' in found) return found
  if ('computed' in found) return derived(listOf(found.scope, found.computed, depth + 1))
  return found.slot.kind === 'list' ? { slot: found.slot, derived: false } : { problem: WHY.computed(text) }
}
/** `value.isEmpty`, of a list, one worked out from a list, or a String. */
function empty(scope: Scope, expr: Expr): ConditionReading {
  const found = resolve(scope, expr)
  if ('slot' in found && found.slot.kind === 'text') {
    const slot = found.slot, name = prettyName(slot.member)
    return { when: truth => [{ slot, value: truth ? '' : slot.sample as string, label: truth ? absent(name) : name }] }
  }
  const list = listOf(scope, expr)
  if ('problem' in list) return list
  const slot = list.slot, text = raw(scope.screen.ctx, expr.span)
  // Emptying the list a filtered one is worked out from empties it too; which items it shows is the code's.
  const items = list.derived ? { problem: WHY.derived(text.length > 32 ? slot.member : text, slot.member) } : typeof slot.sample === 'object' && slot.sample ? slot.sample : undefined
  return { when: truth => truth ? [{ slot, value: 'empty', label: 'Empty' }]
    : items ? { slot, label: 'Has items', problem: items.problem } : [{ slot, value: 'items', label: 'Has items' }] }
}
/** `value == .case`, of a project enum without payloads. */
function isCase(scope: Scope, expr: Expr, name: string): ConditionReading {
  const found = resolve(scope, expr)
  if ('problem' in found) return found
  const slot = 'slot' in found ? found.slot : undefined, options = slot?.input.options ?? slot?.input.choices?.map(c => c.value)
  if (!slot || slot.kind !== 'case' || !options?.includes(name)) return { problem: WHY.computed(raw(scope.screen.ctx, expr.span)) }
  const other = options.find(option => option !== name)
  return { when: truth => truth ? [{ slot, value: name, label: prettyName(name) }] : other ? [{ slot, value: other, label: prettyName(other), not: name }] : null }
}

/** A condition that asks nothing, as the start of a list of them. */
const ALWAYS: ConditionReading = { when: truth => truth ? [] : null }
function not(reading: ConditionReading): ConditionReading {
  return 'problem' in reading ? reading : { when: truth => reading.when(!truth) }
}
function both(a: ConditionReading, b: ConditionReading): ConditionReading {
  if ('problem' in a) return a
  if ('problem' in b) return b
  return { when: truth => truth ? joined(a.when(true), b.when(true)) : firstOf(a.when(false), b.when(false)) }
}
/** One way to make it false: the first that can be drawn. */
const firstOf = (a: Outcome, b: Outcome): Outcome => Array.isArray(a) ? a : Array.isArray(b) ? b : a ?? b
/** Both at once: null when they ask one value for two things. */
function joined(a: Outcome, b: Outcome): Outcome {
  if (!Array.isArray(a)) return a
  if (!Array.isArray(b)) return b
  const facts = [...a]
  for (const fact of b) {
    const at = facts.findIndex(f => f.slot === fact.slot), same = facts[at]
    if (!same) facts.push(fact)
    // A case picked for not being another gives way to one that is asked for.
    else if (same.not !== undefined && fact.not === undefined && fact.value !== same.not) facts[at] = fact
    else if (same.value !== fact.value && !(fact.not !== undefined && same.value !== fact.not)) return null
  }
  return facts
}

/** What an `if` asks: each of its conditions, `if let` as a value being there. */
function readIf(scope: Scope, stmt: IfStmt): ConditionReading {
  return stmt.conditions.map((condition): ConditionReading => condition.kind === 'expr' ? read(scope, condition.expr) : condition.kind === 'optionalBinding' ? present(scope, condition.value) : { problem: WHY.runtime(raw(scope.screen.ctx, condition.value.span)) }).reduce(both, ALWAYS)
}

/**
 * The inputs a screen's States offer: `plain`, the screen's own `@State` values, with the
 * values its conditions read added, each carrying the states it draws; and a condition
 * the preview can't set, with why.
 */
export function screenStateInputs(ctx: FeatureContext, definition: AuthoringNode, plain: readonly StateInput[]): StateInput[] {
  const conditions = conditionsOf(ctx, definition.owner), decl = conditions.length ? ownerOf(ctx, definition) : undefined
  if (!decl) return [...plain]
  const screen: Screen = { ctx, owner: definition.owner, plain: new Map(plain.map(input => [input.name, input])), slots: new Map(), depth: 0 }
  const scope: Scope = { decl, typeName: definition.owner, prefix: '', screen }
  // The `if`s of the screen's own code and its extensions, by where they are written.
  const ifs = new Map<string, IfStmt>()
  const visit = (node: Node) => { if (node.kind === 'ifStmt') ifs.set(spanKey(node.span), node); forEachChild(node, visit) }
  ;[decl, ...extensionsNamed(ctx, decl.name)].forEach(visit)
  const readings = new Map<string, ConditionReading | undefined>()
  const readingOf = (node: AuthoringNode) => {
    if (!readings.has(node.id)) { const stmt = ifs.get(spanKey(node.source)); readings.set(node.id, stmt && readIf(scope, stmt)) }
    return readings.get(node.id)
  }
  const states: { readonly slot: Slot; readonly state: SuggestedState; readonly key: string }[] = [], problems = new Map<string, StateInput>()
  for (const node of conditions) {
    const stmt = ifs.get(spanKey(node.source))
    if (!stmt) continue
    // What the branches around it ask, as each must be drawn for this one to be. One in a
    // row of a list changes with the row, and one in a switch with what it switches on.
    const around: Outcome[] = []
    let child = node, parent = layerById(ctx, node.parentId), skipped = false
    for (; parent && parent.kind !== 'definition'; child = parent, parent = layerById(ctx, parent.parentId)) {
      if (parent.kind === 'template' || parent.kind === 'branch' && (parent.name === 'Switch' || parent.name.startsWith('Case '))) { skipped = true; break }
      if (parent.kind !== 'branch' || parent.name !== 'Condition') continue
      const outer = readingOf(parent)
      if (!outer || 'problem' in outer) { skipped = true; break }
      around.push(outer.when(!(child.kind === 'branch' && child.name === 'Otherwise')))
    }
    const own = readingOf(node)
    if (skipped || !own) continue
    if ('problem' in own) {
      const text = raw(ctx, { file: stmt.span.file, start: stmt.span.start, end: stmt.then.span.start }).replace(/^if\s+/, '').trim()
      if (!problems.has(text)) problems.set(text, { owner: definition.owner, name: text, signature: '', type: 'Bool', value: null, source: stmt.span, problem: own.problem })
      continue
    }
    // Outermost first, as the code reads.
    const context = around.reduceRight<Outcome>((all, outcome) => joined(all, outcome), [])
    if (!Array.isArray(context)) continue
    for (const truth of stmt.else?.kind === 'block' ? [true, false] : [true]) {
      const outcome = own.when(truth)
      if (!outcome) continue
      if (!Array.isArray(outcome)) {
        const missing = outcome as Missing
        states.push({ slot: missing.slot, state: { name: missing.label, inputs: [], problem: missing.problem }, key: JSON.stringify(['missing', missing.slot.input.name, missing.label]) })
        continue
      }
      // What draws this branch first, then what the branches around it ask.
      const facts = joined(outcome, context)
      if (!Array.isArray(facts) || !outcome.length) continue
      const last = outcome[outcome.length - 1]!
      const inputs: PreviewInput[] = facts.map(f => ({ owner: f.slot.input.owner, name: f.slot.input.name, signature: f.slot.input.signature, value: f.value }))
      states.push({ slot: last.slot, state: { name: last.label, inputs }, key: JSON.stringify(inputs.map(i => [i.name, i.value]).sort()) })
    }
  }
  // One state for each set of values, numbered where two sets share a name.
  const seen = new Set<string>(), names = new Map<string, number>(), attached = new Map<Slot, SuggestedState[]>()
  for (const { slot, state, key } of states) {
    if (seen.has(key)) continue
    seen.add(key)
    const count = (names.get(state.name) ?? 0) + 1
    names.set(state.name, count)
    const named = count > 1 ? { ...state, name: `${state.name} ${count}` } : state, list = attached.get(slot)
    if (list) list.push(named)
    else attached.set(slot, [named])
  }
  const values = [...screen.slots.values()].map(slot => { const states = attached.get(slot); return states ? { ...slot.input, states } : slot.input })
  const byName = new Map(values.map(input => [input.name, input]))
  return [...plain.map(input => byName.get(input.name) ?? input), ...values.filter(input => !screen.plain.has(input.name)), ...problems.values()]
}
