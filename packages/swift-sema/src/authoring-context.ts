import { validDesignValue } from '@studio/shared'
import type { AuthoringNode, ComponentDescription, DesignValue, PreviewColorAsset, RecordField, SourceFile, SourceSpan } from '@studio/shared'
import { forEachChild, Lexer, type CallExpr, type Decl, type Expr, type ExtensionDecl, type Node, type SourceFileNode, type StructDecl, type TypeRef, type VarDecl } from '@studio/swift-syntax'
import { isViewBase, literalText, swiftString, viewCallChain } from './design-controls'

export interface SourcePatch { readonly file: string; readonly start: number; readonly end: number; readonly text: string }
export interface FeatureContext {
  readonly deploymentTarget?: string
  readonly files: readonly SourceFile[]
  readonly ast: readonly SourceFileNode[]
  readonly nodes: readonly AuthoringNode[]
  readonly descriptions?: readonly ComponentDescription[]
  /** The project's colour sets: colour tokens read their light and dark values here. */
  readonly colors?: readonly PreviewColorAsset[]
}
export const raw = (ctx: FeatureContext, span: SourceSpan): string => ctx.files.find(f => f.id === span.file)?.text.slice(span.start, span.end) ?? ''


/** The whitespace the line holding `offset` starts with, and one level of indent more: a tab where it uses tabs, or four spaces. */
export function lineIndent(ctx: FeatureContext, file: string, offset: number): { readonly indent: string; readonly unit: string } {
  return indentAt(ctx.files.find(f => f.id === file)?.text ?? '', offset)
}
/** `lineIndent` in a file's text: the whitespace the line holding `offset` starts with, and one level more. */
export function indentAt(text: string, offset: number): { readonly indent: string; readonly unit: string } {
  const indent = /^[\t ]*/.exec(text.slice(text.lastIndexOf('\n', offset - 1) + 1))![0]
  return { indent, unit: indent.includes('\t') ? '\t' : '    ' }
}
/**
 * Where a modifier added under a view starts its line: one step in from a view written on
 * one line, and level with the modifiers of one written over several, whose last line is
 * a `}` or a modifier at the view's own indent, as Xcode writes them.
 */
export function modifierIndent(ctx: FeatureContext, node: AuthoringNode): string {
  const { indent, unit } = lineIndent(ctx, node.source.file, node.source.start)
  const text = ctx.files.find(file => file.id === node.source.file)?.text ?? ''
  if (!text.slice(node.source.start, node.source.end).includes('\n')) return indent + unit
  return lineIndent(ctx, node.source.file, node.source.end).indent
}
const declarationCache = new WeakMap<FeatureContext, Decl[]>()
const expressionCache = new WeakMap<FeatureContext, Map<string, Expr>>()

export function allDeclarations(ctx: FeatureContext): Decl[] {
  const cached = declarationCache.get(ctx)
  if (cached) return cached
  const result: Decl[] = []
  // An `extension Color` adds to a type; it does not declare one. Counting it as a
  // declaration made every framework type a project extends look shadowed, and made
  // a struct with an extension look declared twice. Its members are still collected.
  function visit(node: Node) { if (node.kind.endsWith('Decl') && node.kind !== 'extensionDecl') result.push(node as Decl); forEachChild(node, visit) }
  ctx.ast.forEach(visit)
  declarationCache.set(ctx, result)
  return result
}
/**
 * What the settings of every view look up, worked out once for each context: the structs of
 * each file, the declarations by name, the layers by id, and the answers already given.
 * Each was a search of the whole project for every view that asked.
 */
interface ContextIndex {
  structs?: ReadonlyMap<string, readonly StructDecl[]>
  topStructs?: ReadonlyMap<string, readonly StructDecl[]>
  declared?: ReadonlyMap<unknown, readonly Decl[]>
  extensions?: ReadonlyMap<string, readonly ExtensionDecl[]>
  layers?: ReadonlyMap<string, AuthoringNode>
  calls?: ReadonlyMap<string, readonly AuthoringNode[]>
  readonly owners: Map<string, StructDecl | undefined>
  readonly named: Map<string, StructDecl | undefined>
  readonly containing: Map<string, readonly Node[]>
}
const indexCache = new WeakMap<FeatureContext, ContextIndex>()
function indexOf(ctx: FeatureContext): ContextIndex {
  let index = indexCache.get(ctx)
  if (!index) indexCache.set(ctx, index = { owners: new Map(), named: new Map(), containing: new Map() })
  return index
}
/** A span as a key: its offsets first, as a file name may hold any character. */
const spanKey = (span: SourceSpan) => `${span.start}:${span.end}:${span.file}`
/** Each value in `items` under its key, in their order. */
function grouped<K, T>(items: readonly T[], key: (item: T) => K | undefined): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const at = key(item)
    if (at === undefined) continue
    const group = groups.get(at)
    if (group) group.push(item)
    else groups.set(at, [item])
  }
  return groups
}

export function ownerOf(ctx: FeatureContext, node: AuthoringNode): StructDecl | undefined {
  const index = indexOf(ctx), key = spanKey(node.source)
  if (index.owners.has(key)) return index.owners.get(key)
  const { file, start, end } = node.source
  index.structs ??= grouped(allDeclarations(ctx).filter((d): d is StructDecl => d.kind === 'structDecl'), d => d.span.file)
  const matches = (index.structs.get(file) ?? []).filter(d => d.span.start <= start && d.span.end >= end)
  let owner = matches.sort((a, b) => (a.span.end - a.span.start) - (b.span.end - b.span.start))[0]
  if (!owner) {
    // A helper in `private extension ContentView { … }` belongs to ContentView, wherever that is (Wave 3a).
    const extension = ctx.ast.flatMap(f => f.declarations).find((d): d is ExtensionDecl => d.kind === 'extensionDecl' && d.span.file === file && d.span.start <= start && d.span.end >= end)
    owner = extension ? namedStruct(ctx, extension.name) : undefined
  }
  index.owners.set(key, owner)
  return owner
}
export function expressionOf(ctx: FeatureContext, node: AuthoringNode): Expr | undefined {
  let expressions = expressionCache.get(ctx)
  if (!expressions) {
    expressions = new Map()
    // A helper read as a property is a view with no call of its own (Wave 3a).
    const visit = (n: Node) => { if (n.kind === 'call' || isViewBase(n as Expr)) expressions!.set(spanKey(n.span), n as Expr); forEachChild(n, visit) }
    ctx.ast.forEach(visit)
    expressionCache.set(ctx, expressions)
  }
  return expressions.get(spanKey(node.source))
}
export function callOf(ctx: FeatureContext, node: AuthoringNode): CallExpr | undefined { const e = expressionOf(ctx, node); return e ? viewCallChain(e)?.base : undefined }
export function namedStruct(ctx: FeatureContext, name: string): StructDecl | undefined {
  const index = indexOf(ctx)
  if (index.named.has(name)) return index.named.get(name)
  index.topStructs ??= grouped(ctx.ast.flatMap(f => f.declarations).filter((d): d is StructDecl => d.kind === 'structDecl'), d => d.name)
  // Nested or duplicate names require qualified resolution, outside this recipe.
  const declarations = index.topStructs.get(name) ?? []
  const found = declarations.length === 1 && declarationsNamed(ctx, name).length === 1 ? declarations[0] : undefined
  index.named.set(name, found)
  return found
}
/** Every declaration of a name in the project, nested ones included; extensions declare none. */
export function declarationsNamed(ctx: FeatureContext, name: string): readonly Decl[] {
  const index = indexOf(ctx)
  index.declared ??= grouped(allDeclarations(ctx), d => 'name' in d ? d.name as unknown : undefined)
  return index.declared.get(name) ?? []
}
/** The extensions of a type, from the files' top-level declarations. */
export function extensionsNamed(ctx: FeatureContext, name: string): readonly ExtensionDecl[] {
  const index = indexOf(ctx)
  index.extensions ??= grouped(ctx.ast.flatMap(file => file.declarations).filter((d): d is ExtensionDecl => d.kind === 'extensionDecl'), d => d.name)
  return index.extensions.get(name) ?? []
}
/** The cases of the one enum a name declares, when none carries a payload: values a control or a state can pick. */
export function enumCases(ctx: FeatureContext, type: string): readonly string[] | undefined {
  const matches = declarationsNamed(ctx, type)
  const decl = matches.length === 1 ? matches[0] : undefined
  return decl?.kind === 'enumDecl' && !decl.generics.length && decl.cases.length <= 32 && decl.cases.every(c => !c.associated.length) ? decl.cases.map(c => c.name) : undefined
}
/** The layer with an id, the first if more than one has it, as `find` gives it. */
export function layerById(ctx: FeatureContext, id: string | undefined): AuthoringNode | undefined {
  const index = indexOf(ctx)
  index.layers ??= new Map([...ctx.nodes].reverse().map(layer => [layer.id, layer]))
  return id === undefined ? undefined : index.layers.get(id)
}
/** The layers that call the definition with an id, in the order written: a component's copies, a helper's calls (Wave 4b). */
export function callsOf(ctx: FeatureContext, definitionId: string): readonly AuthoringNode[] {
  const index = indexOf(ctx)
  index.calls ??= grouped(ctx.nodes, layer => layer.definitionId)
  return index.calls.get(definitionId) ?? []
}
export function scalarType(type: TypeRef | null, initial?: Expr | null): { type: RecordField['type']; optional: boolean } | undefined {
  if (type?.kind === 'optionalType') { const inner = scalarType(type.wrapped); return inner && { ...inner, optional: true } }
  if (type?.kind === 'namedType' && ['String', 'Int', 'Double', 'Bool'].includes(type.name)) return { type: type.name as RecordField['type'], optional: false }
  if (type) return undefined
  if (initial?.kind === 'stringLiteral' && initial.segments.every(s => s.kind === 'text')) return { type: 'String', optional: false }
  if (initial?.kind === 'booleanLiteral') return { type: 'Bool', optional: false }
  if (initial?.kind === 'integerLiteral') return { type: 'Int', optional: false }
  if (initial?.kind === 'floatLiteral') return { type: 'Double', optional: false }
  return undefined
}
export function literal(ctx: FeatureContext, expr: Expr | null): DesignValue | undefined {
  if (!expr) return undefined
  const words = literalText(expr)
  if (words !== undefined) return words
  if (expr.kind === 'nilLiteral') return null
  const text = raw(ctx, expr.span)
  if (expr.kind === 'booleanLiteral') return text === 'true'
  if (['integerLiteral', 'floatLiteral', 'unary'].includes(expr.kind) && /^-?\d+(\.\d+)?$/.test(text) && Number.isFinite(Number(text))) return Number(text)
  return undefined
}
export const validScalar = validDesignValue

export function swiftValue(value: DesignValue): string { return value === null ? 'nil' : typeof value === 'string' ? swiftString(value) : String(value) }
export function identifier(value: string): boolean { return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value) && !new Set(['self', 'Self', 'body', 'init', 'deinit', 'class', 'struct', 'enum', 'var', 'let', 'func', 'if', 'else', 'return', 'true', 'false', 'nil', 'switch', 'case', 'default', 'in', 'for', 'while', 'import', 'some', 'any', 'Type', 'where', 'extension', 'protocol', 'private', 'public', 'static', 'repeat', 'try', 'throw', 'throws', 'async', 'await']).has(value) }
export function signature(ctx: FeatureContext, decl: StructDecl | VarDecl): string {
  const text = decl.kind === 'structDecl' ? decl.members.filter((m): m is VarDecl => m.kind === 'varDecl' && !m.accessor).map(m => [m.name, m.isLet, m.typeAnnotation && raw(ctx, m.typeAnnotation.span), m.attributes.map(a => a.name), m.initializer && raw(ctx, m.initializer.span)]) : [decl.name, decl.typeAnnotation && raw(ctx, decl.typeAnnotation.span), decl.attributes.map(a => a.name)]
  return JSON.stringify(text)
}
export function patch(span: SourceSpan, text: string): SourcePatch { return { ...span, text } }

/** The folders a project made here is laid out in. */
const SHAPE_DIRS = new Set(['App', 'Features', 'DesignSystem'])

/**
 * Where a project's Swift lives: the folder the shape sits in, or the one every
 * file already shares.
 *
 * New files the studio writes - a screen, a component, `Tokens.swift` - go beside
 * the ones already there rather than in a folder of their own invention. Taken from
 * the shape when there is one, so a `Tests/` folder listed first cannot move the
 * whole design system into it.
 */
export function sourceRoot(ctx: FeatureContext): string {
  for (const file of ctx.files) {
    const parts = file.id.split('/')
    const index = parts.findIndex((part, at) => at < parts.length - 1 && SHAPE_DIRS.has(part))
    if (index >= 0) return parts.slice(0, index).map(part => part + '/').join('')
  }
  // No shape yet: the deepest folder every file is inside.
  let common: string[] | undefined
  for (const file of ctx.files) {
    const dir = file.id.split('/').slice(0, -1)
    if (!common) { common = dir; continue }
    let shared = 0
    while (shared < common.length && common[shared] === dir[shared]) shared++
    common = common.slice(0, shared)
  }
  return common?.length ? common.map(part => part + '/').join('') : ''
}

/** True when the project follows the shape new projects are created in. */
export function shapedProject(ctx: FeatureContext): boolean {
  const root = sourceRoot(ctx)
  return ctx.files.some(file => file.id.startsWith(`${root}Features/`) || file.id.startsWith(`${root}App/`))
}
export function insertMember(ctx: FeatureContext, owner: StructDecl, text: string): SourcePatch {
  const member = owner.members.find(m => m.kind === 'varDecl' && m.name === 'body') ?? owner.members[0]
  const at = member?.span.start ?? owner.span.end - 1
  const eol = ctx.files.find(f => f.id === owner.span.file)?.text.includes('\r\n') ? '\r\n' : '\n'
  return { file: owner.span.file, start: at, end: at, text: text.replaceAll('\n', eol) + eol + '    ' }
}
export function insertArgument(ctx: FeatureContext, call: CallExpr, label: string, value: string, order: readonly string[]): SourcePatch | undefined {
  const existing = call.args.find(a => a.label === label)
  if (existing) return patch(existing.value.span, value)
  const next = call.args.find(a => order.indexOf(a.label ?? '') > order.indexOf(label))
  if (next) return { ...next.span, end: next.span.start, text: `${label}: ${value}, ` }
  const last = call.args.at(-1)
  if (last) return { ...last.span, start: last.span.end, text: `, ${label}: ${value}` }
  const end = call.trailingClosure?.span.start ?? call.span.end
  const tokens = Lexer.tokenize(raw(ctx, { ...call.span, start: call.callee.span.end, end }), call.span.file).tokens.filter(t => t.kind !== 'endOfFile')
  if (!tokens.length) return { ...call.callee.span, start: call.callee.span.end, text: `(${label}: ${value})` }
  const closing = tokens.at(-1)
  if (closing?.text !== ')') return undefined
  const at = call.callee.span.end + closing.span.start
  return { file: call.span.file, start: at, end: at, text: `${label}: ${value}` }
}
export function applyPatches(ctx: FeatureContext, patches: readonly SourcePatch[], created: readonly SourceFile[] = []): SourceFile[] {
  const result = ctx.files.map(file => {
    const edits = patches.filter(p => p.file === file.id).sort((a, b) => b.start - a.start || b.end - a.end)
    let end = file.text.length, text = file.text
    for (const p of edits) {
      if (p.start < 0 || p.end < p.start || p.end > end) throw new Error('Overlapping source edits cannot be applied.')
      text = text.slice(0, p.start) + p.text + text.slice(p.end); end = p.start
    }
    return { ...file, text }
  })
  for (const file of created) {
    if (result.some(f => f.id === file.id)) throw new Error('The new component file already exists.')
    result.push(file)
  }
  return result
}

/** A local binding must never be mistaken for an owner's stored property. */
export function shadowsMember(ctx: FeatureContext, node: AuthoringNode, name: string): boolean {
  const start = node.source.start
  return around(ctx, node.source).some(item =>
    item.kind === 'closure' && item.params.some(p => p.name.replace(/^\$/, '') === name)
    || item.kind === 'block' && item.statements.some(s => s.span.start < start && s.kind === 'declStmt' && s.declaration.kind === 'varDecl' && s.declaration.name === name)
    || item.kind === 'ifStmt' && item.conditions.some(c => c.kind === 'optionalBinding' && c.name === name))
}
/** The syntax around a span, outermost first: found once for each span, as each of its names is asked about. */
function around(ctx: FeatureContext, span: SourceSpan): readonly Node[] {
  const index = indexOf(ctx), key = spanKey(span)
  let found = index.containing.get(key)
  if (found) return found
  const items: Node[] = []
  const visit = (item: Node) => {
    if (item.span.file !== span.file || item.span.start > span.start || item.span.end < span.end) return
    items.push(item)
    if (item.kind === 'sourceFile') topLevelAround(item, span).forEach(visit)
    else forEachChild(item, visit)
  }
  ctx.ast.forEach(visit)
  index.containing.set(key, found = items)
  return found
}
/** Whether a file's declarations follow one another, each ending before the next begins. */
const inOrder = new WeakMap<SourceFileNode, boolean>()
/**
 * The declarations of a file that can hold a span, in their order. In a file whose
 * declarations follow one another, only those ending at or after its start can, and they
 * are the last to begin at or before it; any other file's are all looked at.
 */
function topLevelAround(file: SourceFileNode, span: SourceSpan): readonly Decl[] {
  const declarations = file.declarations
  let ordered = inOrder.get(file)
  if (ordered === undefined) inOrder.set(file, ordered = declarations.every((d, i) => d.span.start <= d.span.end && (i === 0 || declarations[i - 1]!.span.end <= d.span.start)))
  if (!ordered) return declarations
  let low = 0, high = declarations.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (declarations[middle]!.span.start <= span.start) low = middle + 1
    else high = middle
  }
  let first = low
  while (first > 0 && declarations[first - 1]!.span.end >= span.start) first--
  return declarations.slice(first, low)
}
export function hasComments(ctx: FeatureContext, span: SourceSpan): boolean {
  // The lexer omits comments but token ranges still expose only trivia between tokens.
  const source = raw(ctx, span)
  // A comment between tokens is in the source too, so source without one has none to find.
  if (!/\/\/|\/\*/.test(source)) return false
  const tokens = Lexer.tokenize(source, span.file).tokens
  let at = 0
  for (const token of tokens) {
    if (/\/\/|\/\*/.test(source.slice(at, token.span.start))) return true
    at = token.span.end
  }
  return /\/\/|\/\*/.test(source.slice(at))
}
