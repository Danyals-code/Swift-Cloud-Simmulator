import { validDesignValue } from '@studio/shared'
import type { AuthoringNode, ComponentDescription, DesignValue, RecordField, SourceFile, SourceSpan } from '@studio/shared'
import { forEachChild, Lexer, type CallExpr, type Decl, type Expr, type Node, type SourceFileNode, type StructDecl, type TypeRef, type VarDecl } from '@studio/swift-syntax'
import { swiftString, viewCallChain } from './design-controls'

export interface SourcePatch { readonly file: string; readonly start: number; readonly end: number; readonly text: string }
export interface FeatureContext {
  readonly deploymentTarget?: string
  readonly files: readonly SourceFile[]
  readonly ast: readonly SourceFileNode[]
  readonly nodes: readonly AuthoringNode[]
  readonly descriptions?: readonly ComponentDescription[]
}
export const raw = (ctx: FeatureContext, span: SourceSpan): string => ctx.files.find(f => f.id === span.file)?.text.slice(span.start, span.end) ?? ''
const declarationCache = new WeakMap<FeatureContext, Decl[]>()
const expressionCache = new WeakMap<FeatureContext, Map<string, Expr>>()

export function allDeclarations(ctx: FeatureContext): Decl[] {
  const cached = declarationCache.get(ctx)
  if (cached) return cached
  const result: Decl[] = []
  function visit(node: Node) { if (node.kind.endsWith('Decl')) result.push(node as Decl); forEachChild(node, visit) }
  ctx.ast.forEach(visit)
  declarationCache.set(ctx, result)
  return result
}
export function ownerOf(ctx: FeatureContext, node: AuthoringNode): StructDecl | undefined {
  const matches = allDeclarations(ctx).filter((d): d is StructDecl => d.kind === 'structDecl' && d.span.file === node.source.file && d.span.start <= node.source.start && d.span.end >= node.source.end)
  return matches.sort((a, b) => (a.span.end - a.span.start) - (b.span.end - b.span.start))[0]
}
export function expressionOf(ctx: FeatureContext, node: AuthoringNode): Expr | undefined {
  let expressions = expressionCache.get(ctx)
  const key = (span: SourceSpan) => JSON.stringify([span.file, span.start, span.end])
  if (!expressions) {
    expressions = new Map()
    const visit = (n: Node) => { if (n.kind === 'call') expressions!.set(key(n.span), n); forEachChild(n, visit) }
    ctx.ast.forEach(visit)
    expressionCache.set(ctx, expressions)
  }
  return expressions.get(key(node.source))
}
export function callOf(ctx: FeatureContext, node: AuthoringNode): CallExpr | undefined { const e = expressionOf(ctx, node); return e ? viewCallChain(e)?.base : undefined }
export function namedStruct(ctx: FeatureContext, name: string): StructDecl | undefined {
  // Nested or duplicate names require qualified resolution, outside this recipe.
  const declarations = ctx.ast.flatMap(f => f.declarations).filter((d): d is StructDecl => d.kind === 'structDecl' && d.name === name)
  return declarations.length === 1 && allDeclarations(ctx).filter(d => 'name' in d && d.name === name).length === 1 ? declarations[0] : undefined
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
  if (expr.kind === 'stringLiteral' && expr.segments.every(s => s.kind === 'text')) return expr.segments.map(s => s.kind === 'text' ? s.value : '').join('')
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
  let shadowed = false
  const visit = (item: Node) => {
    if (item.span.file !== node.source.file || item.span.start > node.source.start || item.span.end < node.source.end) return
    if (item.kind === 'closure' && item.params.some(p => p.name.replace(/^\$/, '') === name)) shadowed = true
    if (item.kind === 'block' && item.statements.some(s => s.span.start < node.source.start && s.kind === 'declStmt' && s.declaration.kind === 'varDecl' && s.declaration.name === name)) shadowed = true
    if (item.kind === 'ifStmt' && item.conditions.some(c => c.kind === 'optionalBinding' && c.name === name)) shadowed = true
    forEachChild(item, visit)
  }
  ctx.ast.forEach(visit)
  return shadowed
}
export function hasComments(ctx: FeatureContext, span: SourceSpan): boolean {
  // The lexer omits comments but token ranges still expose only trivia between tokens.
  const source = raw(ctx, span), tokens = Lexer.tokenize(source, span.file).tokens
  let at = 0
  for (const token of tokens) {
    if (/\/\/|\/\*/.test(source.slice(at, token.span.start))) return true
    at = token.span.end
  }
  return /\/\/|\/\*/.test(source.slice(at))
}
