import type { AuthoringNode, CopiedView, FileId } from '@studio/shared'
import { copyView, forEachChild, Lexer, Parser, type Expr, type Node, type StructDecl, type VarDecl } from '@studio/swift-syntax'
import { insertMember, ownerOf, scalarType, type FeatureContext, type SourcePatch } from './authoring-context'

/**
 * Whether code means the same on any screen: it reads no value, only literals, types
 * and their members - `"Starred"`, `12`, `.red`, `Tone.loud`, `"Live".uppercased()`.
 * A name that starts in lower case is a value of somewhere, and so are `self` and `super`.
 */
export function readsNoValue(code: Node): boolean {
  let free = true
  const visit = (node: Node) => {
    if (node.kind === 'selfExpr' || node.kind === 'superExpr' || node.kind === 'identifier' && /^[a-z_$]/.test(node.name)) free = false
    else forEachChild(node, visit)
  }
  visit(code)
  return free
}

/**
 * A stored value that means the same on any screen: a literal, kept as it is or in
 * `@State`, made of nothing its own screen declares inside it, such as a nested enum.
 */
function standsAlone(value: VarDecl, text: string, nested: ReadonlySet<string>): boolean {
  if (value.accessor || value.setter || value.observers || value.destructured || !value.initializer) return false
  if (!value.attributes.every(attribute => attribute.name === 'State') || !readsNoValue(value.initializer)) return false
  const written = text.slice(value.nameSpan.end, value.span.end)
  return !Lexer.tokenize(written, '__value.swift').tokens.some(token => token.kind === 'identifier' && nested.has(token.text))
}

/** A declaration as it is written, from its attributes and modifiers on: `@State private var count = 0`. */
function declarationOf(text: string, value: VarDecl): string {
  const start = Math.min(value.span.start, ...value.attributes.map(a => a.span.start), ...value.modifiers.map(m => m.span.start))
  return text.slice(start, value.span.end)
}

/** Every name a piece of view code reads, a binding's `$` taken off. */
function namesRead(snippet: string): ReadonlySet<string> {
  const { sourceFile } = Parser.parse(`struct __Copy: View {\n    var body: some View {\n${snippet}\n    }\n}\n`, '__copy.swift')
  const names = new Set<string>()
  const visit = (node: Node) => { if (node.kind === 'identifier') names.add(node.name.replace(/^\$/, '')); forEachChild(node, visit) }
  visit(sourceFile)
  return names
}

/**
 * A view as Copy keeps it (D6): the Swift that draws it, and the values of its screen it
 * reads, for a paste onto another screen to bring along - each stored value of the struct
 * around it that it names, as that struct wrote it. A value tied to something else, such
 * as the environment, a binding or other values, stays behind. Or why it can't be copied.
 */
export function copiedView(text: string, file: FileId, offset: number): CopiedView | { readonly refused: string } {
  let refusal = ''
  const snippet = copyView(text, file, offset, reason => { refusal = reason })
  if (snippet === null) return { refused: refusal }
  let owner: StructDecl | undefined
  const visit = (node: Node) => {
    if (node.kind === 'structDecl' && node.span.start <= offset && offset < node.span.end) owner = node
    forEachChild(node, visit)
  }
  visit(Parser.parse(text, file).sourceFile)
  const read = namesRead(snippet)
  const members = (owner as StructDecl | undefined)?.members ?? []
  // A type declared inside the screen, which only the screen can see.
  const nested = new Set(members.flatMap(member => ['structDecl', 'enumDecl', 'protocolDecl', 'typealiasDecl'].includes(member.kind) && 'name' in member && typeof member.name === 'string' ? [member.name] : []))
  const values = members.flatMap(member => member.kind === 'varDecl' && read.has(member.name) && standsAlone(member, text, nested) ? [declarationOf(text, member)] : [])
  return { snippet, values }
}

/**
 * What a value is made from, as far as its declaration says: a number or words, the type
 * it is written with, the type it is made by - `Date()`, `Sort.name`, `[Item(...)]` - or
 * failing all of those, exactly how it is written.
 */
function madeFrom(value: VarDecl, text: string): string {
  const scalar = scalarType(value.typeAnnotation, value.initializer)?.type
  if (scalar) return scalar
  if (value.typeAnnotation) return text.slice(value.typeAnnotation.span.start, value.typeAnnotation.span.end).replace(/\s/g, '')
  const typeOf = (expr: Expr | null): string | undefined => {
    if (expr?.kind === 'call') return typeOf(expr.callee)
    if (expr?.kind === 'identifier') return /^[A-Z]/.test(expr.name) ? expr.name : undefined
    if (expr?.kind === 'memberAccess') return expr.base ? typeOf(expr.base) : undefined
    if (expr?.kind === 'arrayLiteral') { const element = typeOf(expr.elements[0] ?? null); return element && `[${element}]` }
    return undefined
  }
  return typeOf(value.initializer) ?? `= ${value.initializer ? text.slice(value.initializer.span.start, value.initializer.span.end) : ''}`
}

/** What a value is, as two declarations of one name are compared: kept in `@State` or not, and what it is made from. */
function kindOf(value: VarDecl, text: string): { readonly stateful: boolean; readonly type: string } {
  return { stateful: value.attributes.some(attribute => attribute.name === 'State'), type: madeFrom(value, text) }
}

/**
 * The values a pasted view brings to the screen it lands on (D6): each one the screen
 * lacks, declared as the view's own screen declared it. One the screen has already, of
 * the same kind, is the one the view reads there; one of another kind is a clash.
 */
export function pastedValues(ctx: FeatureContext, node: AuthoringNode, values: readonly string[]): { readonly member?: SourcePatch; readonly added: readonly string[] } | { readonly problem: string } {
  const owner = ownerOf(ctx, node)
  if (!owner) return { added: [] }
  const text = ctx.files.find(f => f.id === owner.span.file)?.text ?? ''
  const added: string[] = []
  for (const value of values) {
    const source = `struct __Paste {\n${value}\n}\n`
    const declared = Parser.parse(source, '__paste.swift').sourceFile.declarations[0]
    const pasted = declared?.kind === 'structDecl' ? declared.members[0] : undefined
    if (pasted?.kind !== 'varDecl') continue
    const existing = owner.members.find(member => 'name' in member && member.name === pasted.name)
    if (!existing) { added.push(value); continue }
    const here = existing.kind === 'varDecl' ? kindOf(existing, text) : undefined, brought = kindOf(pasted, source)
    if (here?.stateful !== brought.stateful || here.type !== brought.type) return { problem: `${owner.name} already has a \`${pasted.name}\` of another kind, so this view’s \`${pasted.name}\` can’t come along. Rename one of them in Code.` }
  }
  return added.length ? { member: insertMember(ctx, owner, added.join('\n    ')), added } : { added }
}
