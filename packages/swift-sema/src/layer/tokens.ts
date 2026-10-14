import type { SourceSpan, TokenDeclaration } from '@studio/shared'
import { forEachChild, type Condition, type Decl, type EnumDecl, type Expr, type ExtensionDecl, type Node, type Pattern, type ProtocolDecl, type SourceFileNode, type StructDecl, type VarDecl } from '@studio/swift-syntax'
import { declarationsNamed, extensionsNamed, type FeatureContext } from '../authoring-context'

/**
 * The constants a value is read through (Wave 3b): `rowSpacing`, `Self.gap`, `Layout.pad`,
 * `.space16` and `.heading`, found where they are declared, with what they are declared as
 * and how many places read them.
 *
 * Only a `let` with an initialiser is a constant here: a `var` may be given another value
 * where its view is made, and a computed property is worked out each time it is read. A
 * font token is the one exception: a static whose getter is one expression, `static var
 * heading: Font { .title2.bold() }`, is as constant as a `let` (`computed`).
 */

/** A constant as its declaration has it. */
export interface Constant {
  readonly decl: VarDecl
  /** Its initialiser, or the one expression its getter returns. */
  readonly initializer: Expr
  /** Its name from anywhere, as `style-edit` takes it: `ContentView.rowSpacing`, `Layout.pad`, `CGFloat.space16`. */
  readonly name: string
  /** The type a member belongs to, as `Type.member` names it from anywhere. */
  readonly host?: string
  readonly isStatic: boolean
}

type TypeDecl = StructDecl | EnumDecl
/** What a name can be declared in besides a file: a type, a protocol, or an extension of one. */
type Holder = TypeDecl | ExtensionDecl | ProtocolDecl

interface References {
  /** Each bare name read, by name. */
  readonly names: Map<string, SourceSpan[]>
  /** Each member read off nothing or a name, `.x` and `Type.x`, anywhere. */
  readonly members: Map<string, SourceSpan[]>
  /**
   * Each read inside a type or an extension of it, by the type's name and the name as read:
   * `ContentView inset`, `ContentView self.inset`, `ContentView Self.gap`. The innermost type
   * a read is in is the one `self` and `Self` mean there, and whose members a bare name reads.
   */
  readonly inTypes: Map<string, SourceSpan[]>
}

/**
 * What finding constants keeps for a project besides the declarations, which the authoring
 * context's indexes find (`declarationsNamed`, `extensionsNamed`): each file's tree, for the
 * syntax on the way to a read, and the reads, found once at the first constant whose uses
 * are counted.
 */
interface Reads {
  readonly files: Map<string, SourceFileNode>
  references?: References
  readonly uses: Map<VarDecl, number>
}

const reads = new WeakMap<FeatureContext, Reads>()

const push = <K, T>(map: Map<K, T[]>, key: K, value: T) => { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]) }

function readsOf(project: FeatureContext): Reads {
  let found = reads.get(project)
  if (!found) reads.set(project, found = { files: new Map(project.ast.map(tree => [tree.file, tree])), uses: new Map() })
  return found
}

/** Whether a declaration is one of its file's own, not a member or a local. */
const topLevel = (project: FeatureContext, decl: Decl) => { const tree = readsOf(project).files.get(decl.span.file); return !!tree && topLevelAt(tree, decl.span) === decl }

const isStatic = (decl: VarDecl) => decl.modifiers.some(modifier => modifier.name === 'static')

/** A `let` with an initialiser and nothing that changes it: no wrapper, no accessor. */
const constantDecl = (decl: Decl | undefined): decl is VarDecl & { initializer: Expr } =>
  decl?.kind === 'varDecl' && decl.isLet && !!decl.initializer && !decl.accessor && !decl.attributes.length

/** The one expression a computed property's getter gives, `.title2.bold()` in `{ .title2.bold() }` or `{ return .title2.bold() }`. */
function getterValue(decl: VarDecl): Expr | undefined {
  const statements = !decl.isLet && !decl.initializer && !decl.setter && !decl.observers && !decl.attributes.length ? decl.accessor?.statements : undefined
  const only = statements?.length === 1 ? statements[0]! : undefined
  return only?.kind === 'exprStmt' ? only.expression : only?.kind === 'returnStmt' ? only.value ?? undefined : undefined
}

/** A member's value, when it is a constant: its initialiser, or where `computed` is allowed the one expression its getter gives. */
const constantValue = (decl: VarDecl, computed: boolean): Expr | undefined => constantDecl(decl) ? decl.initializer : computed && isStatic(decl) ? getterValue(decl) : undefined

/** The one member called `name` of these declarations, when it is a constant, static or not as asked. */
function constantMember(holders: readonly Holder[], name: string, wantStatic: boolean, computed = false): { decl: VarDecl; initializer: Expr } | undefined {
  const named = holders.flatMap(holder => holder.members.filter((member): member is VarDecl => member.kind === 'varDecl' && member.name === name))
  const only = named.length === 1 ? named[0]! : undefined
  const initializer = only && isStatic(only) === wantStatic ? constantValue(only, computed) : undefined
  return initializer && { decl: only!, initializer }
}

/** The one top-level type with this name, as a legacy style finds one: nothing else may share it. */
function typeNamed(project: FeatureContext, name: string): TypeDecl | undefined {
  const named = declarationsNamed(project, name)
  const only = named.length === 1 ? named[0]! : undefined
  return (only?.kind === 'structDecl' || only?.kind === 'enumDecl') && topLevel(project, only) ? only : undefined
}

/** A type and its extensions, where its members are declared and read bare. */
const holdersOf = (project: FeatureContext, name: string, type?: TypeDecl): readonly Holder[] => [...type ? [type] : [], ...extensionsNamed(project, name)]

/** The `static let` called `name` of a type, or of a framework type's extensions: `Layout.pad`, `CGFloat.space16`. */
function staticIn(project: FeatureContext, typeName: string, name: string, computed: boolean): Constant | undefined {
  const holders = holdersOf(project, typeName, typeNamed(project, typeName))
  const found = constantMember(holders, name, true, computed)
  return found && { ...found, name: `${typeName}.${name}`, host: typeName, isStatic: true }
}

// ---------------------------------------------------------------- what a name is where it is read

const isHolder = (node: Node): node is Holder => node.kind === 'structDecl' || node.kind === 'enumDecl' || node.kind === 'extensionDecl' || node.kind === 'protocolDecl'
const contains = (node: Node, at: SourceSpan) => node.span.file === at.file && node.span.start <= at.start && node.span.end >= at.end

/** Whether a pattern binds `name`: `let x`, `.ready(let x)`, or either in a tuple. */
function patternBinds(pattern: Pattern, name: string): boolean {
  if (pattern.kind === 'binding') return pattern.name === name
  if (pattern.kind === 'enumCase') return pattern.bindings.some(binding => binding.name === name)
  return pattern.kind === 'tuplePattern' && pattern.elements.some(element => patternBinds(element, name))
}

const conditionsBind = (conditions: readonly Condition[], name: string) => conditions.some(condition =>
  condition.kind === 'optionalBinding' ? condition.name === name : condition.kind === 'caseMatch' && patternBinds(condition.pattern, name))

/** Whether a declaration, written in a block, gives a name: `let x`, `let (x, y)`, a local function or type. */
const declares = (decl: Decl, name: string) => 'name' in decl && decl.name === name || decl.kind === 'varDecl' && !!decl.destructured?.some(part => part.name === name)

/**
 * Whether `node`, on the way to `at`, gives the name there: a closure's or a function's
 * parameter or capture, a value declared before it in a block or bound by a `guard` above
 * it, one an `if`, a `while`, a loop, a `switch` case or a `catch` binds.
 */
function bindsOnTheWay(node: Node, at: SourceSpan, name: string): boolean {
  switch (node.kind) {
    case 'closure': return node.params.some(param => param.name.replace(/^\$/, '') === name) || !!node.captures?.some(capture => capture.name === name)
    case 'funcDecl': case 'initDecl': return node.params.some(param => param.internalName === name)
    case 'block': return node.statements.some(statement => statement.span.start < at.start && (statement.kind === 'declStmt' && declares(statement.declaration, name) || statement.kind === 'guardStmt' && conditionsBind(statement.conditions, name)))
    case 'ifStmt': return !(node.else && contains(node.else, at)) && conditionsBind(node.conditions, name)
    case 'whileStmt': return conditionsBind(node.conditions, name)
    case 'forInStmt': return node.variable === name || !!node.destructured?.some(part => part.name === name)
    case 'switchStmt': return node.cases.some(item => contains(item.body, at) || item.where && contains(item.where, at) ? item.patterns.some(pattern => patternBinds(pattern, name)) : false)
    case 'doCatchStmt': return node.catches.some(clause => contains(clause.body, at) && (clause.binding === name || !!clause.pattern && patternBinds(clause.pattern, name)))
    default: return false
  }
}

/** The declaration of a file that holds `at`: its declarations follow one another, so the last to begin at or before it. */
function topLevelAt(tree: SourceFileNode, at: SourceSpan): Decl | undefined {
  const declarations = tree.declarations
  let low = 0, high = declarations.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (declarations[middle]!.span.start <= at.start) low = middle + 1
    else high = middle
  }
  const found = declarations[low - 1]
  return found && contains(found, at) ? found : declarations.find(decl => contains(decl, at))
}

/**
 * What a bare name read at `at` can be, from the syntax on the way there: `hidden` when a
 * name declared on the way gives it; else `type`, the innermost type or extension the read
 * is in, and `member`, whether any type on the way, or that type's extensions, has a member
 * of that name, which a read inside it means rather than a global.
 */
function scopeAt(project: FeatureContext, at: SourceSpan, name: string): { readonly hidden: boolean; readonly type?: Holder; readonly member: boolean } {
  const tree = readsOf(project).files.get(at.file)
  let hidden = false, type: Holder | undefined, member = false
  const visit = (node: Node): void => {
    if (hidden || !contains(node, at)) return
    if (bindsOnTheWay(node, at, name)) { hidden = true; return }
    if (isHolder(node)) {
      type = node
      const holders = node.kind === 'protocolDecl' ? [node] : holdersOf(project, node.name, node.kind === 'extensionDecl' ? typeNamed(project, node.name) : node)
      member ||= holders.some(holder => holder.members.some(decl => declares(decl, name)) || holder.kind === 'enumDecl' && holder.cases.some(item => item.name === name))
    }
    forEachChild(node, visit)
  }
  const top = tree && topLevelAt(tree, at)
  // A read in no file of the project can't be told from one a name declared on the way gives.
  if (!top) return { hidden: true, member: false }
  visit(top)
  return { hidden, type, member }
}

/** Framework types whose static members are design tokens, read with contextual `.name`. */
export const TOKEN_HOSTS: ReadonlySet<string> = new Set(['Color', 'ShapeStyle', 'CGFloat', 'Double', 'Font', 'ShadowToken'])

/** Framework types whose static constants a contextual `.name` reads, by the kind of value it is: those of `TOKEN_HOSTS` that are lengths, and fonts. */
export const LENGTH_HOSTS: readonly string[] = ['CGFloat', 'Double']
export const FONT_HOSTS: readonly string[] = ['Font']

/**
 * The constant a token written as `written` reads where it is read, at `at`, or undefined for
 * one that is no constant, is ambiguous, or is hidden by a name declared on the way there.
 * `hosts` are the framework types a contextual `.name` can be a member of where it is read;
 * `computed` takes a static whose getter is one expression as a constant too, as a font's is.
 *
 * A bare name is a constant of the type it is read in, the view's struct or one of its
 * extensions, or a global no type on the way declares a member of that name.
 */
export function resolveConstant(project: FeatureContext, written: string, at: SourceSpan, hosts: readonly string[], computed = false): Constant | undefined {
  const parts = /^(?:(\.)|(\w+)\.)?([A-Za-z_]\w*)$/.exec(written)
  if (!parts) return undefined
  const [, dot, base, name] = parts as unknown as [string, string | undefined, string | undefined, string]
  if (dot) {
    const found = hosts.map(host => staticIn(project, host, name, computed)).filter(constant => !!constant)
    return found.length === 1 ? found[0] : undefined
  }
  if (base === 'Self') {
    const self = scopeAt(project, at, '').type?.name
    return self ? staticIn(project, self, name, computed) : undefined
  }
  if (base) return staticIn(project, base, name, computed)
  return bareConstant(project, at, name)
}

/** The constant a bare name read at `at` is: a `let` of the type it is read in, or a global. */
function bareConstant(project: FeatureContext, at: SourceSpan, name: string): Constant | undefined {
  const scope = scopeAt(project, at, name)
  if (scope.hidden) return undefined
  if (!scope.member) return globalNamed(project, name)
  const type = scope.type && typeNamed(project, scope.type.name)
  if (!type || scope.type!.kind !== 'extensionDecl' && scope.type !== type) return undefined
  const holders = holdersOf(project, type.name, type)
  const found = constantMember(holders, name, false)
  return found && type.members.includes(found.decl) ? { ...found, name: `${type.name}.${name}`, host: type.name, isStatic: false } : undefined
}

/** The one declaration of a name, when it is a constant of its file's own. */
function globalNamed(project: FeatureContext, name: string): Constant | undefined {
  const named = declarationsNamed(project, name)
  const decl = named.length === 1 ? named[0] : undefined
  return constantDecl(decl) && topLevel(project, decl) ? { decl, initializer: decl.initializer, name, isStatic: false } : undefined
}

/** The constant `style-edit` names, `ContentView.rowSpacing`, `Layout.pad`, `CGFloat.space16` or a global's name. */
export function constantNamed(project: FeatureContext, name: string): Constant | undefined {
  const parts = /^(?:(\w+)\.)?([A-Za-z_]\w*)$/.exec(name)
  if (!parts) return undefined
  const [, base, member] = parts as unknown as [string, string | undefined, string]
  if (!base) return globalNamed(project, member)
  const type = typeNamed(project, base)
  const instance = type?.kind === 'structDecl' ? constantMember([type], member, false) : undefined
  if (instance) return { ...instance, name, host: base, isStatic: false }
  return staticIn(project, base, member, false)
}

/** Every name and member read in the project, found once, the first time a constant's uses are counted. */
function referencesOf(project: FeatureContext): References {
  const found = readsOf(project)
  if (found.references) return found.references
  const names = new Map<string, SourceSpan[]>(), members = new Map<string, SourceSpan[]>(), inTypes = new Map<string, SourceSpan[]>()
  const visit = (node: Node, type: string | undefined): void => {
    const inner = isHolder(node) ? node.name : type
    if (node.kind === 'identifier') {
      push(names, node.name, node.span)
      if (inner !== undefined) push(inTypes, `${inner} ${node.name}`, node.span)
    } else if (node.kind === 'memberAccess') {
      const base = node.base
      if (!base) push(members, `.${node.member}`, node.span)
      else if (base.kind === 'identifier' && base.name !== 'Self') push(members, `${base.name}.${node.member}`, node.span)
      else if (inner !== undefined && (base.kind === 'identifier' || base.kind === 'selfExpr')) push(inTypes, `${inner} ${base.kind === 'selfExpr' ? 'self' : 'Self'}.${node.member}`, node.span)
    }
    forEachChild(node, child => visit(child, inner))
  }
  for (const tree of project.ast) visit(tree, undefined)
  return found.references = { names, members, inTypes }
}

/**
 * How many places read a constant: by its type's name anywhere, and inside its type as
 * `self.` or `Self.`, or bare where nothing on the way hides it; a framework type's constant
 * as `.name` too, and a global by its name wherever nothing hides it. Its own declaration is
 * not one of them. A member's bare reads are looked for only in its own type.
 */
export function usesOf(project: FeatureContext, constant: Constant): number {
  const { uses } = readsOf(project)
  const known = uses.get(constant.decl)
  if (known !== undefined) return known
  const { names, members, inTypes } = referencesOf(project)
  const name = constant.decl.name, host = constant.host
  const bare = (spans: readonly SourceSpan[] | undefined) => (spans ?? []).filter(span => bareConstant(project, span, name)?.decl === constant.decl)
  const spans = !host ? bare(names.get(name))
    : constant.isStatic ? [...members.get(`${host}.${name}`) ?? [], ...inTypes.get(`${host} Self.${name}`) ?? [], ...TOKEN_HOSTS.has(host) ? members.get(`.${name}`) ?? [] : []]
    : [...bare(inTypes.get(`${host} ${name}`)), ...inTypes.get(`${host} self.${name}`) ?? []]
  const count = spans.filter(span => !contains(constant.decl, span)).length
  uses.set(constant.decl, count)
  return count
}

/** A number literal, `12`, `0.5` or `-4`, read off the syntax, so a constant in any file can be read without its text. */
export function literalNumber(expr: Expr): number | undefined {
  if (expr.kind === 'integerLiteral' || expr.kind === 'floatLiteral') return expr.value
  if (expr.kind === 'unary' && expr.operator === '-' && (expr.operand.kind === 'integerLiteral' || expr.operand.kind === 'floatLiteral')) return -expr.operand.value
  return undefined
}

/** A constant as the panel shows where it is declared. */
export function declarationOf(project: FeatureContext, constant: Constant): TokenDeclaration {
  return { span: constant.initializer.span, name: constant.name, uses: usesOf(project, constant) }
}

/**
 * A number as a constant's initialiser takes it: one written as a `Double` with no type
 * keeps a decimal point, so it stays a `Double` (`280.0`), and any other is written plainly.
 */
export function constantNumber(constant: Constant, next: number): string {
  const literal = constant.initializer.kind === 'unary' ? constant.initializer.operand : constant.initializer
  return !constant.decl.typeAnnotation && literal.kind === 'floatLiteral' && Number.isInteger(next) ? next.toFixed(1) : String(next)
}
