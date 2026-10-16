import type { AuthoringNode, SourceFile } from '@studio/shared'
import { constantOf, forEachChild, isAtomic, substitute, type Block, type Expr, type Node, type StructDecl, type Substitution, type VarDecl } from '@studio/swift-syntax'
import { applyPatches, callOf, hasComments, lineIndent, namedStruct, patch, raw, type FeatureContext } from './authoring-context'
import { isAction, sampleOf } from './authoring-components'
import { detachProblem, fits, givenInputs, implicitStart, inputsOf, namedOf, swapProblem, typeOf } from './authoring-instance-settings'

/**
 * Swap and Detach on a copy of a component (Wave 5b). Loaded only when a designer uses one
 * (`prepareDesignEdit`), so the worker's first chunk doesn't carry them.
 */

/**
 * The copy `node` as a copy of `component`: its call renamed, each input the target has given
 * as the copy gave it when the types are the same, a sample for one it needs and the copy
 * lacks, as a new copy gets, and the modifiers on it kept. A closure after the call stays
 * after it when it is still the last input.
 */
export function swapInstance(ctx: FeatureContext, node: AuthoringNode, component: string): { files: SourceFile[]; offset: number } {
  const call = callOf(ctx, node), from = namedStruct(ctx, node.name), decl = namedStruct(ctx, component)
  const given = call && from && givenInputs(ctx, from, call)
  const problem = call && from && decl ? swapProblem(ctx, node, component, given, hasComments(ctx, call.span)) : 'This copy changed. Select it again.'
  if (problem) throw new Error(problem)
  const fields = inputsOf(ctx, decl!), inputs: string[] = []
  let trailing = ''
  for (const { field, type } of fields) {
    const value = given!.get(field.name)
    if (fits(value, type)) {
      if (value.trailing && field === fields.at(-1)?.field) trailing = ` ${raw(ctx, value.expr.span)}`
      else inputs.push(`${field.name}: ${raw(ctx, value.expr.span)}`)
    } else if (!field.initializer) {
      const sample = isAction(field.typeAnnotation) ? '{ }' : sampleOf(ctx, field.typeAnnotation, field.name)!
      inputs.push(`${field.name}: ${field.attributes.length && sample !== '{ }' ? `.constant(${sample})` : sample}`)
    }
  }
  return { files: applyPatches(ctx, [patch(call!.span, `${component}(${inputs.join(', ')})${trailing}`)]), offset: node.source.start }
}

/**
 * The copy `node` as the plain views it shows: the Main's body with each input put in place
 * by what the copy gives it, or its default, conditions that become constant folded, several
 * views in a `Group`, and the modifiers on the copy kept. The Main stays.
 */
export function detachInstance(ctx: FeatureContext, node: AuthoringNode): { files: SourceFile[]; offset: number } {
  const problem = detachProblem(ctx, node)
  if (problem) throw new Error(problem)
  const decl = namedStruct(ctx, node.name)!, call = callOf(ctx, node)!, given = givenInputs(ctx, decl, call)!
  const body = decl.members.find((m): m is VarDecl & { accessor: Block } => m.kind === 'varDecl' && m.name === 'body' && !!m.accessor)!
  // A type declared in the Main is written in full outside it: `Style` as `Pill.Style`.
  const renames = new Map(decl.members.flatMap(m => 'name' in m && ['enumDecl', 'structDecl'].includes(m.kind) ? [[m.name as string, `${decl.name}.${m.name as string}`] as const] : []))
  const { indent: callIndent, unit } = lineIndent(ctx, call.span.file, call.span.start)
  const values = new Map<string, Substitution>()
  for (const member of decl.members) {
    if (member.kind !== 'varDecl' || member.accessor || member.modifiers.some(m => m.name === 'static')) continue
    const argument = given.get(member.name)
    const expr = argument?.expr ?? member.initializer
    // An optional `var` left out is nil, as its memberwise initialiser has it.
    if (!expr && !member.isLet && member.typeAnnotation?.kind === 'optionalType') { values.set(member.name, { text: 'nil', atomic: true, constant: null }); continue }
    if (!expr) throw new Error(`This copy gives ${decl.name} no ${member.name}. Change it in Code.`)
    values.set(member.name, substitutionOf(ctx, decl, member, expr, argument ? callIndent : lineIndent(ctx, member.span.file, member.span.start).indent, renames, !argument))
  }
  const views = substitute(ctx.files.find(f => f.id === decl.span.file)!.text, body.accessor, values, renames)
  const at = (text: string, indent: string) => text.split('\n').map((line, i) => i && line ? indent + line : line).join('\n')
  const eol = ctx.files.find(f => f.id === call.span.file)?.text.includes('\r\n') ? '\r\n' : '\n'
  const one = views.length === 1 && views[0]!.expression ? views[0] : undefined
  // A view the copy's modifiers follow takes them as one: `(a + b).bold()`.
  const text = !views.length ? 'EmptyView()'
    : one ? (node.source.end > call.span.end && !one.atomic ? `(${at(one.text, callIndent)})` : at(one.text, callIndent))
    : `Group {${eol}${views.map(view => callIndent + unit + at(view.text, callIndent + unit)).join(eol)}${eol}${callIndent}}`
  return { files: applyPatches(ctx, [patch(call.span, text.replace(/\r?\n/g, eol))]), offset: node.source.start }
}

/**
 * What a read of `member` becomes: `expr` as written, its later lines dedented by `indent`, an
 * implicit member written with its type, and what it is when that is known. A default, `inMain`,
 * has the Main's own types written in full.
 */
function substitutionOf(ctx: FeatureContext, decl: StructDecl, member: VarDecl, expr: Expr, indent: string, renames: ReadonlyMap<string, string>, inMain: boolean): Substitution {
  const edits: { at: number; end: number; text: string }[] = []
  // `.secondary` read where no type is known says which type it is: `Pill.Style.secondary`.
  const type = namedOf(typeOf(ctx, decl, member)), start = implicitStart(expr)
  if (start && type) edits.push({ at: start.span.start, end: start.span.start, text: type })
  const visit = (n: Node) => { if (n.kind === 'identifier' && renames.has(n.name)) edits.push({ at: n.span.start, end: n.span.end, text: renames.get(n.name)! }); forEachChild(n, visit) }
  if (inMain) visit(expr)
  let text = raw(ctx, expr.span)
  for (const edit of edits.sort((a, b) => b.at - a.at)) text = text.slice(0, edit.at - expr.span.start) + edit.text + text.slice(edit.end - expr.span.start)
  text = text.split('\n').map((line, i) => i && line.startsWith(indent) ? line.slice(indent.length) : line).join('\n')
  const constant = constantOf(expr)
  // A whole number given a Double shows as one; words with markdown in them show as written only in a `Text(verbatim:)`.
  const interpolated = expr.kind === 'integerLiteral' && ['Double', 'CGFloat', 'Float'].includes(type!) ? `${text}.0` : undefined
  const words = typeof constant === 'string' && /[*_~`[]/.test(constant) ? `verbatim: ${text}` : undefined
  return { text, atomic: isAtomic(expr), constant, interpolated, words }
}
