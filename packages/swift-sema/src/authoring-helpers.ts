import { helperPlaces, type AuthoringNode, type AuthoringProperty, type SourceSpan } from '@studio/shared'
import { bindArguments, callParameter, chainBase, fitsParameters, forEachChild, isSomeView, isStatic, memberwiseParameter, memberwiseProperties, writtenArguments, type Block, type CallExpr, type CallParameter, type Decl, type Expr, type FuncDecl, type GenericParam, type InitDecl, type Node, type Param, type SourceFileNode, type StructDecl, type TypeRef, type VarDecl } from '@studio/swift-syntax'

/** A node of the authoring model while it is built. */
export type MutableNode = Omit<AuthoringNode, 'children' | 'properties'> & { children: string[]; properties: AuthoringProperty[] }

/**
 * A view written in a helper rather than in `body`: a computed `some View` property, or a
 * function that returns one (doc 18, Concern 2, item 1). AI-written screens are mostly
 * made of these, so Design reads each one once, where it is declared, and every place
 * that calls it points at those views, as a component's copies point at its Main.
 */
export interface ViewHelper {
  /** The view it is a member of, as the authoring model names owners: `ContentView`, `Outer.Inner`. */
  readonly owner: string
  readonly name: string
  readonly decl: VarDecl | FuncDecl
  readonly body: Block
  /** A function's parameters; none for a property, which is read rather than called. */
  readonly params: readonly Param[]
}

/** A helper called where a view is written: `header`, `self.header`, `stats(count: 3)`. */
export interface HelperCall {
  readonly helper: ViewHelper
  /** The function call, or null for a property. */
  readonly call: CallExpr | null
  /** Where the chain starts: the call, or what reads the property, `header` or `self.header`. */
  readonly base: Expr
  /** Whether modifiers are chained after it: `header.padding()`. */
  readonly modified: boolean
}

/** The helper a member declares, if it is one: `body` is the view itself, and a static member belongs to no instance. */
function helperOf(owner: string, decl: Decl): ViewHelper | null {
  if (decl.kind === 'varDecl' && decl.name !== 'body' && decl.accessor && isSomeView(decl.typeAnnotation) && !isStatic(decl)) return { owner, name: decl.name, decl, body: decl.accessor, params: [] }
  if (decl.kind === 'funcDecl' && decl.body && isSomeView(decl.returnType) && !isStatic(decl)) return { owner, name: decl.name, decl, body: decl.body, params: decl.params }
  return null
}

/**
 * Every view's helpers, by owner: those in its own braces, and those in an extension of
 * it, `private extension ContentView { … }` included, in whichever file. `views` holds
 * each View struct by the owner name the model gives it.
 */
export function viewHelpers(views: ReadonlyMap<string, StructDecl>, files: readonly SourceFileNode[]): ReadonlyMap<string, readonly ViewHelper[]> {
  const helpers = new Map<string, ViewHelper[]>()
  const add = (owner: string, members: readonly Decl[]) => {
    for (const member of members) {
      const helper = helperOf(owner, member)
      if (helper) helpers.set(owner, [...(helpers.get(owner) ?? []), helper])
    }
  }
  // An extension names its type as written, which is the owner for a top-level view and its plain name otherwise.
  const owners = new Map<string, string[]>()
  for (const [owner, decl] of views) {
    add(owner, decl.members)
    for (const name of new Set([owner, decl.name])) owners.set(name, [...(owners.get(name) ?? []), owner])
  }
  for (const file of files) for (const decl of file.declarations) {
    if (decl.kind !== 'extensionDecl') continue
    const owner = owners.get(decl.name)
    if (owner?.length === 1) add(owner[0]!, decl.members)
  }
  return helpers
}

/** The name an expression reads or calls a member by: `header` or `self.header`. */
function memberName(expr: Expr): string | null {
  if (expr.kind === 'identifier') return expr.name
  if (expr.kind === 'memberAccess' && expr.base?.kind === 'selfExpr') return expr.member
  return null
}

/**
 * The helper an expression calls, or null when it calls none or when which one it calls
 * is uncertain: a name a local value hides (`shadowed`), or a call that fits none or
 * several of a helper's overloads. Never a guess.
 */
export function helperCall(expr: Expr, helpers: readonly ViewHelper[], shadowed: (name: string, declared: SourceSpan) => boolean): HelperCall | null {
  if (!helpers.length) return null
  // `header.padding().opacity(0.5)`: modifiers are calls of members of the view before them.
  const base = chainBase(expr)
  const call = base.kind === 'call' ? base : null
  const name = memberName(call ? call.callee : base)
  if (!name) return null
  const candidates = helpers.filter(helper => helper.name === name && (helper.decl.kind === 'funcDecl') === !!call && (!call || fitsParameters(helper.params.map(callParameter), call)))
  const helper = candidates.length === 1 ? candidates[0]! : undefined
  return helper && !shadowed(name, helper.decl.nameSpan) ? { helper, call, base, modified: base !== expr } : null
}

/** Whether a type is a generic one the declaration constrains to View, or `some View`. */
function viewType(generics: readonly GenericParam[], type: TypeRef | null): boolean {
  if (isSomeView(type)) return true
  return type?.kind === 'namedType' && generics.some(generic => generic.name === type.name && generic.constraint?.kind === 'namedType' && ['View', 'SwiftUI.View'].includes(generic.constraint.name))
}

/** A parameter of a call, as its arguments are bound to it: the property or parameter it fills, and whether it takes views. */
interface ViewParameter extends CallParameter {
  readonly name: string
  /** What it is given is views: built by `@ViewBuilder`, or a `() -> Content` of a view type. */
  readonly views: boolean
}

/** A parameter as a call gives it views, named `name`; `generics` are the type parameters its type may name. */
function viewParameter(shape: CallParameter, name: string, type: TypeRef | null, attributes: readonly { readonly name: string }[], generics: readonly GenericParam[]): ViewParameter {
  const result = type?.kind === 'functionType' && !type.params.length ? type.result : type
  return { ...shape, name, views: attributes.some(attribute => attribute.name === 'ViewBuilder') || viewType(generics, result) }
}

/** The views a call gives to the parameters that hold them, bound as Swift binds them (`bindArguments`). */
function givenViews(parameters: readonly ViewParameter[], call: CallExpr): { readonly property: string; readonly value: Expr }[] {
  const args = writtenArguments(call)
  return bindArguments(parameters, args).flatMap((at, index) => at >= 0 && parameters[at]!.views ? [{ property: parameters[at]!.name, value: args[index]!.value }] : [])
}

/**
 * The views a call of a container of the project's own gives it, by the property that
 * holds them: `Card { … }`, `Card(content: { … })`. Bound as its memberwise initialiser
 * binds them, or by the one `init` of its own the call fits, named for the argument label
 * that gives them; a call that fits none or several of those is left as written.
 */
export function containerContent(decl: StructDecl, call: CallExpr): { readonly property: string; readonly value: Expr }[] {
  const inits = decl.members.filter((member): member is InitDecl => member.kind === 'initDecl')
  if (inits.length) {
    const fitting = inits.filter(init => fitsParameters(init.params.map(callParameter), call))
    if (fitting.length !== 1) return []
    return givenViews(fitting[0]!.params.map(param => {
      const shape = callParameter(param)
      return viewParameter(shape, shape.label ?? param.internalName, param.type, param.attributes, decl.generics)
    }), call)
  }
  return givenViews(memberwiseProperties(decl.members).map(property => viewParameter(memberwiseParameter(property), property.name, property.typeAnnotation, property.attributes, decl.generics)), call)
}

/** The views a call of a helper function gives it, `card { … }`, by the parameter that takes them (Wave 3a). */
export function helperContent(helper: ViewHelper, call: CallExpr): { readonly property: string; readonly value: Expr }[] {
  const generics = helper.decl.kind === 'funcDecl' ? helper.decl.generics : []
  return givenViews(helper.params.map(param => viewParameter(callParameter(param), param.internalName, param.type, param.attributes, generics)), call)
}

/**
 * Whether every `init` of a view sets a property to one of its own parameters, as written,
 * `self.title = title`: what it holds is then given where the view is used.
 */
export function setByEveryInit(decl: StructDecl, property: string): boolean {
  const inits = decl.members.filter((member): member is InitDecl => member.kind === 'initDecl')
  return inits.length > 0 && inits.every(init => init.body?.statements.some(statement => {
    if (statement.kind !== 'exprStmt' || statement.expression.kind !== 'assign' || statement.expression.operator !== '=') return false
    const { target, value } = statement.expression
    const named = target.kind === 'memberAccess' && target.base?.kind === 'selfExpr' ? target.member === property : target.kind === 'identifier' && target.name === property && !init.params.some(param => param.internalName === property)
    return named && value.kind === 'identifier' && init.params.some(param => param.internalName === value.name)
  }))
}

/** A value written out in the code: words with no values in them, a number, `true` or `false`, or a case, `.title`. */
function writtenOut(expr: Expr): boolean {
  switch (expr.kind) {
    case 'stringLiteral': return expr.segments.every(segment => segment.kind === 'text')
    case 'integerLiteral': case 'floatLiteral': case 'booleanLiteral': return true
    case 'unary': return ['+', '-'].includes(expr.operator) && ['integerLiteral', 'floatLiteral'].includes(expr.operand.kind)
    case 'memberAccess': return !expr.base
    default: return false
  }
}

/**
 * The parameters every call of a helper gives a value written out in the code,
 * `label("Hello")`, rather than one from data, `row(for: item)`: text that reads one is
 * set where the helper is used. The calls are read in the view's `body` and in its helpers.
 */
export function writtenParameters(helpers: ReadonlyMap<string, readonly ViewHelper[]>, views: ReadonlyMap<string, StructDecl>): ReadonlySet<Param> {
  const given = new Map<Param, boolean>()
  for (const [owner, own] of helpers) {
    const body = views.get(owner)?.members.find((member): member is VarDecl => member.kind === 'varDecl' && member.name === 'body')?.accessor
    const visit = (node: Node): void => {
      const found = node.kind === 'call' ? helperCall(node, own, () => false) : null
      if (found?.call === node) {
        const params = found.helper.params
        const args = writtenArguments(node)
        const bound = bindArguments(params.map(callParameter), args)
        params.forEach((param, index) => {
          const at = bound.indexOf(index)
          given.set(param, (given.get(param) ?? true) && at >= 0 && writtenOut(args[at]!.value))
        })
      }
      forEachChild(node, visit)
    }
    for (const block of [...body ? [body] : [], ...own.map(helper => helper.body)]) visit(block)
  }
  return new Set([...given].flatMap(([param, written]) => written ? [param] : []))
}

/**
 * What a change to a helper's views reaches, said on each of their controls: every row
 * where a call of it is in a row design, or each place it is drawn from. A helper called
 * from another one is drawn wherever that one is, so each helper's node says in how many
 * places its views are drawn (`places`). A text's font inherited from around the one place
 * a helper is used is read from there.
 */
export function helperReach(nodes: readonly MutableNode[], helpers: readonly MutableNode[]): void {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const calls = new Map<string, MutableNode[]>()
  for (const node of nodes) if (node.definitionId) calls.set(node.definitionId, [...(calls.get(node.definitionId) ?? []), node])
  const helperIds = new Set(helpers.map(node => node.id))
  /** `node` and the layers above it, nearest first, each once. */
  const upFrom = (node: MutableNode): MutableNode[] => {
    const path: MutableNode[] = []
    for (let layer: MutableNode | undefined = node; layer && !path.includes(layer); layer = layer.parentId ? byId.get(layer.parentId) : undefined) path.push(layer)
    return path
  }
  /** The nearest row design or helper a call is written in. */
  const surrounding = (node: MutableNode) => upFrom(node).find(layer => layer.kind === 'template' || helperIds.has(layer.id))
  const inRows = (definition: MutableNode, seen: ReadonlySet<string>): boolean => (calls.get(definition.id) ?? []).some(call => {
    const around = surrounding(call)
    return around?.kind === 'template' || !!around && !seen.has(around.id) && inRows(around, new Set([...seen, around.id]))
  })
  const places = (definition: MutableNode, seen: ReadonlySet<string>): number => (calls.get(definition.id) ?? []).reduce((sum, call) => {
    const around = surrounding(call)
    return sum + (around && around.kind !== 'template' && !seen.has(around.id) ? places(around, new Set([...seen, around.id])) : 1)
  }, 0)
  // A text's font, written around the one place its helper is used, is inherited there too.
  const fontAround = (node: MutableNode, seen: ReadonlySet<string>): AuthoringProperty | undefined => {
    for (const layer of upFrom(node)) {
      const font = [...layer.properties].reverse().find(property => property.name === 'font' && property.valueKind !== 'inherited')
      if (font) return font
      const uses = helperIds.has(layer.id) && !seen.has(layer.id) ? calls.get(layer.id) ?? [] : []
      if (uses.length === 1) return fontAround(uses[0]!, new Set([...seen, layer.id]))
    }
    return undefined
  }
  for (const node of nodes) {
    const inherited = node.properties.findIndex(property => property.id === `${node.id}:inherited-font` && !property.source)
    const origin = inherited >= 0 && upFrom(node).some(layer => helperIds.has(layer.id)) ? fontAround(node, new Set()) : undefined
    if (origin) node.properties[inherited] = { ...node.properties[inherited]!, expression: origin.expression, source: origin.source, ownerId: origin.ownerId, reason: 'Inherited from the view around the one place this helper is used; it affects its descendants.' }
  }
  for (const definition of helpers) {
    const rows = inRows(definition, new Set([definition.id])), count = places(definition, new Set([definition.id]))
    Object.assign(definition, { places: count })
    if (!rows && count < 2) continue
    const scope = rows ? 'All rows in this template' : helperPlaces(count)
    const visit = (id: string) => {
      const node = byId.get(id)
      if (!node) return
      if (rows) node.properties = node.properties.map(property => property.scope === 'definition' ? { ...property, scope: 'template' } : property)
      if (node.controls) Object.assign(node, { controls: node.controls.map(control => control.scope === 'All rows in this template' ? control : { ...control, scope }) })
      node.children.forEach(visit)
    }
    definition.children.forEach(visit)
  }
}

/**
 * The file with a helper nothing calls taken out of it (Wave 3a): its whole declaration,
 * with its attributes, its modifiers and the `///` lines that document it, and the blank
 * line beside it. Throws the reason, in the panel's words, while a place calls it, or
 * while anything else in the code reads its name, which only Code can follow.
 */
export function removeHelper(text: string, files: readonly SourceFileNode[], helper: Pick<AuthoringNode, 'name' | 'source'>, calls: number): { text: string; offset: number } {
  if (calls) throw new Error(`${helper.name} is still used. Delete the places that use it first, or remove it in Code.`)
  let decl: VarDecl | FuncDecl | undefined
  let reads = 0
  const visit = (node: Node): void => {
    if ((node.kind === 'varDecl' || node.kind === 'funcDecl') && node.span.file === helper.source.file && node.span.start === helper.source.start && node.span.end === helper.source.end) decl = node
    if (node.kind === 'identifier' && node.name === helper.name || node.kind === 'memberAccess' && node.member === helper.name || node.kind === 'keyPath' && node.components.includes(helper.name)) reads++
    forEachChild(node, visit)
  }
  files.forEach(visit)
  if (!decl) throw new Error('This helper changed. Select it again.')
  if (reads) throw new Error(`Something else in the code reads ${helper.name}. Remove it in Code.`)
  const lineStart = (at: number) => text.lastIndexOf('\n', at - 1) + 1
  const lineEnd = (at: number) => { const end = text.indexOf('\n', at); return end < 0 ? text.length : end + 1 }
  const blank = (start: number, end: number) => start < end && !text.slice(start, end).trim()
  let start = lineStart(Math.min(decl.span.start, ...decl.attributes.map(attribute => attribute.span.start), ...decl.modifiers.map(modifier => modifier.span.start)))
  while (start > 0 && text.slice(lineStart(start - 1), start).trimStart().startsWith('///')) start = lineStart(start - 1)
  let end = lineEnd(decl.span.end)
  if (start > 0 && blank(lineStart(start - 1), start)) start = lineStart(start - 1)
  else if (blank(end, lineEnd(end))) end = lineEnd(end)
  return { text: text.slice(0, start) + text.slice(end), offset: start }
}

