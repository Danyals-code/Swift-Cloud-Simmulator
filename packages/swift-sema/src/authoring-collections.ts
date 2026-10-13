import { SUPPORTED_VIEWS } from './builtins'
import { deploymentVersion } from '@studio/shared'
import type { AuthoringNode, CollectionSettings, DesignValue, DesignRecord, RecordField } from '@studio/shared'
import { afterOffMarkers, Lexer, type Expr, type VarDecl } from '@studio/swift-syntax'
import { callOf, hasComments, shadowsMember, identifier, insertMember, lineIndent, literal, namedStruct, ownerOf, patch, raw, scalarType, signature, swiftValue, validScalar, type FeatureContext, type SourcePatch } from './authoring-context'
import { swiftString } from './design-controls'

export function recordDeclaration(ctx: FeatureContext, variable: VarDecl): { name: string; fields: RecordField[]; signature: string } | undefined {
  const type = variable.typeAnnotation
  const name = type?.kind === 'arrayType' && type.element.kind === 'namedType' ? type.element.name : undefined
  const decl = name && namedStruct(ctx, name)
  if (!decl || decl.isReference || decl.generics.length || decl.members.some(m => m.kind === 'initDecl') || !decl.inherits.some(t => t.name === 'Identifiable')) return undefined
  const fields: RecordField[] = []
  for (const member of decl.members) {
    if (member.kind !== 'varDecl' || member.accessor || member.modifiers.some(m => m.name === 'static')) continue
    if (member.attributes.length || member.modifiers.length || member.isLet && member.initializer || !identifier(member.name)) return undefined
    const type = scalarType(member.typeAnnotation)
    if (!type) return undefined
    const defaultValue = member.initializer ? literal(ctx, member.initializer) : undefined
    if (member.initializer && !validScalar(defaultValue, type)) return undefined
    fields.push({ name: member.name, mutable: !member.isLet, ...type, ...(defaultValue !== undefined ? { defaultValue } : {}) })
  }
  if (fields.length > 32 || !fields.some(f => f.name === 'id' && !f.optional && ['String', 'Int'].includes(f.type))) return undefined
  return { name: decl.name, fields, signature: signature(ctx, variable) + signature(ctx, decl) }
}
export function readRecords(ctx: FeatureContext, variable: VarDecl): DesignRecord[] | undefined {
  const schema = recordDeclaration(ctx, variable)
  const array = variable.initializer
  if (!schema || array?.kind !== 'arrayLiteral' || array.elements.length > 1000) return undefined
  const records: DesignRecord[] = []
  for (const expr of array.elements) {
    if (expr.kind !== 'call' || expr.callee.kind !== 'identifier' || expr.callee.name !== schema.name || expr.trailingClosure) return undefined
    const record: Record<string, DesignValue> = Object.create(null)
    if (expr.args.some((a, index) => !schema.fields.some(f => f.name === a.label) || expr.args.slice(0, index).some(old => old.label === a.label)) || expr.args.some((a, index) => index > 0 && schema.fields.findIndex(f => f.name === a.label) <= schema.fields.findIndex(f => f.name === expr.args[index - 1]?.label))) return undefined
    for (const field of schema.fields) {
      const arg = expr.args.find(a => a.label === field.name)
      const value = arg ? literal(ctx, arg.value) : field.defaultValue
      if (!validScalar(value, field)) return undefined
      record[field.name] = value
    }
    records.push(record)
  }
  return validateRecords(schema.fields, records) ? undefined : records
}
export function validateRecords(fields: readonly RecordField[], records: readonly DesignRecord[]): string | null {
  if (!Array.isArray(records) || records.length > 1000) return 'Use at most 1,000 local records.'
  const ids = new Set<string>()
  let characters = 0
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(k => !fields.some(f => f.name === k))) return 'A record contains an unknown field.'
    for (const field of fields) if (!validScalar(record[field.name] === undefined && field.optional ? null : record[field.name], field)) return `Invalid ${field.type}${field.optional ? '?' : ''} value for ${field.name}.`
    characters += Object.values(record).reduce<number>((total, value) => total + (typeof value === 'string' ? value.length : 8), 0)
    if (characters > 1_000_000) return 'Local records exceed the 1 MB text limit.'
    const key = JSON.stringify(record.id)
    if (ids.has(key)) return 'Each record needs a unique, stable id.'
    ids.add(key)
  }
  return null
}
export function recordsSwift(info: Pick<CollectionSettings, 'recordType' | 'fields'>, records: readonly DesignRecord[]): string {
  const problem = validateRecords(info.fields, records)
  if (problem) throw new Error(problem)
  return '[' + records.map(r => `${info.recordType}(${info.fields.map(f => `${f.name}: ${swiftValue(r[f.name] ?? null)}`).join(', ')})`).join(', ') + ']'
}
export function collectionFor(ctx: FeatureContext, node: AuthoringNode): CollectionSettings | undefined {
  if (node.kind !== 'collection') return undefined
  const call = callOf(ctx, node), owner = ownerOf(ctx, node)
  const value = call?.args[0]?.value, closure = call?.trailingClosure
  if (!owner || !value || value.kind !== 'identifier' || !closure || closure.params.length !== 1 || !identifier(closure.params[0]!.name.replace(/^\$/, '')) || closure.params[0]!.type) return undefined
  if (call.args.length > 2 || call.args[1] && (call.args[1].label !== 'id' || raw(ctx, call.args[1].value.span) !== '\\.id')) return undefined
  const variable = owner.members.find((m): m is VarDecl => m.kind === 'varDecl' && m.name === value.name.replace(/^\$/, '') && !m.accessor && !m.setter && !m.observers && m.attributes.every(a => a.name === 'State'))
  if (value.name.startsWith('$') !== closure.params[0]!.name.startsWith('$')) return undefined
  if (!variable || shadowsMember(ctx, node, variable.name)) return undefined
  const schema = recordDeclaration(ctx, variable), records = readRecords(ctx, variable)
  if (!schema || !records || !variable.initializer) return undefined
  return { name: variable.name, owner: node.owner, signature: schema.signature, recordType: schema.name, fields: schema.fields, records, binding: value.name.startsWith('$'), parameter: closure.params[0]!.name.replace(/^\$/, ''), source: variable.initializer.span, mutable: !variable.isLet && variable.attributes.some(a => a.name === 'State'), templateId: node.children.find(id => ctx.nodes.find(n => n.id === id)?.kind === 'template') }
}
export function enclosingCollection(ctx: FeatureContext, node: AuthoringNode): CollectionSettings | undefined {
  let parent = ctx.nodes.find(n => n.id === node.parentId)
  while (parent) {
    if (parent.kind === 'collection') return collectionFor(ctx, parent)
    parent = ctx.nodes.find(n => n.id === parent!.parentId)
  }
  return undefined
}
export function bindField(ctx: FeatureContext, node: AuthoringNode, fieldName: string): SourcePatch[] {
  const info = enclosingCollection(ctx, node), call = callOf(ctx, node)
  const field = info?.fields.find(f => f.name === fieldName)
  if (!info || !field || !call) throw new Error('Select a Text or Image inside a supported row template.')
  if (['Toggle', 'TextField', 'SecureField'].includes(node.name)) {
    if (deploymentVersion(ctx.deploymentTarget) < 15) throw new Error('Editable collection rows require iOS 15 or later.')
    const type = node.name === 'Toggle' ? 'Bool' : 'String', label = node.name === 'Toggle' ? 'isOn' : 'text'
    const argument = call.args.find(a => a.label === label)
    if (!argument || !info.mutable || !field.mutable || field.optional || field.type !== type) throw new Error(`This control needs a mutable, nonoptional ${type} field in a local @State collection.`)
    const existing = raw(ctx, argument.value.span)
    if (!(existing.startsWith('$' + info.parameter + '.') && info.fields.some(f => existing === `$${info.parameter}.${f.name}`)) && !(argument.value.kind === 'call' && argument.value.callee.kind === 'memberAccess' && !argument.value.callee.base && argument.value.callee.member === 'constant')) throw new Error('This control has a custom binding. Preserve its logic and change it in Swift.')
    const patches = [patch(argument.value.span, `$${info.parameter}.${field.name}`)]
    if (!info.binding) {
      const collection = ctx.nodes.find(n => n.kind === 'collection' && info.templateId && n.children.includes(info.templateId))
      const collectionCall = collection && callOf(ctx, collection)
      if (!collectionCall?.trailingClosure) throw new Error('The collection template changed. Select the control again.')
      patches.push(patch(collectionCall.args[0]!.value.span, '$' + info.name), patch(collectionCall.trailingClosure.params[0]!.span, '$' + info.parameter))
    }
    return patches
  }
  if (!['Text', 'Image'].includes(node.name) || call.args.length !== 1) throw new Error('This view has no supported row-field input.')
  if (node.name === 'Image' && (field.type !== 'String' || field.optional)) throw new Error('Images require a nonoptional String field.')
  const argument = call.args[0]!
  const old = raw(ctx, argument.value.span)
  // A binding change is explicit, but must not erase arbitrary developer formatting.
  const simple = literal(ctx, argument.value) !== undefined || info.fields.some(f => old === `${info.parameter}.${f.name}` || old === `(${info.parameter}.${f.name} ?? "")` || old === `String(${info.parameter}.${f.name}${f.optional ? ' ?? ' + (f.type === 'Bool' ? 'false' : '0') : ''})`)
  if (!simple) throw new Error('This field uses a custom expression. Change its mapping in Swift to preserve the formatting.')
  let value = `${info.parameter}.${field.name}`
  if (field.type === 'String' && field.optional) value = `(${value} ?? "")`
  else if (field.type !== 'String') value = `String(${value}${field.optional ? ' ?? ' + (field.type === 'Bool' ? 'false' : '0') : ''})`
  return [patch(argument.value.span, value)]
}
/** A row that is `Text` of one unnamed value: that value, and the row reading its words from a record instead. */
function textRow(ctx: FeatureContext, row: AuthoringNode | undefined): { readonly words: Expr; readonly template: string } | null {
  const call = row?.name === 'Text' ? callOf(ctx, row) : undefined
  const words = call?.args.length === 1 && call.args[0]!.label === null ? call.args[0]!.value : undefined
  if (!row || !words) return null
  const text = raw(ctx, row.source)
  return { words, template: text.slice(0, words.span.start - row.source.start) + 'item.title' + text.slice(words.span.end - row.source.start) }
}

/** A row that is plain Text of a literal: its words, and the row reading them from a record instead. */
function plainTextRow(ctx: FeatureContext, row: AuthoringNode | undefined): { readonly title: string; readonly template: string } | null {
  const found = textRow(ctx, row)
  const title = found && literal(ctx, found.words)
  return found && typeof title === 'string' ? { title, template: found.template } : null
}

/**
 * The rows a Repeat over a range draws, as the library writes it:
 * `ForEach(0..<3, id: \.self) { index in Text("Row \(index)") }`. One title per number,
 * the row reading it from a record. Null for anything else; refused, saying why, when
 * the rows use their number outside their text, which a record would not keep.
 */
function rangeRows(ctx: FeatureContext, node: AuthoringNode): { readonly titles: string[]; readonly template: string } | null {
  const call = callOf(ctx, node), closure = call?.trailingClosure
  const range = call?.args[0]?.label === null ? call.args[0]!.value : undefined
  if (!call || !closure || !range || range.kind !== 'binary' || !['..<', '...'].includes(range.operator) || closure.params.length !== 1 || closure.body.statements.length !== 1) return null
  const from = literal(ctx, range.left), to = literal(ctx, range.right)
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isInteger(from) || !Number.isInteger(to)) return null
  const last = range.operator === '...' ? to : to - 1
  if (last < from || last - from >= 50) return null
  const row = textRow(ctx, ctx.nodes.find(n => n.parentId === node.id && n.kind === 'template')?.children.map(id => ctx.nodes.find(n => n.id === id)).find(Boolean))
  const words = row?.words, param = closure.params[0]!.name
  if (!row || words?.kind !== 'stringLiteral' || words.segments.some(s => s.kind === 'interpolation' && (s.expression.kind !== 'identifier' || s.expression.name !== param))) return null
  const tokens = Lexer.tokenize(row.template, node.source.file).tokens
  if (tokens.some((token, i) => token.kind === 'identifier' && token.text === param && tokens[i - 1]?.text !== '.')) throw new Error(`These rows use \`${param}\` outside their text, which a record would not keep. Keep the Repeat, or use \`${param}\` in the text only.`)
  const titles: string[] = []
  for (let n = from; n <= last; n++) titles.push(words.segments.map(s => s.kind === 'text' ? s.value : String(n)).join(''))
  return { titles, template: row.template }
}

/**
 * Makes a static list, or the library's Repeat over a range, a collection of typed
 * records (D13): one record for each row it drew, each row drawn by one design that
 * reads its record. Rows that differ are left alone, as one design would lose what
 * makes each different.
 */
export function convertCollection(ctx: FeatureContext, node: AuthoringNode, name: string, recordType: string): SourcePatch[] {
  const owner = ownerOf(ctx, node), call = callOf(ctx, node)
  const range = node.name === 'ForEach' ? rangeRows(ctx, node) : null
  if (!owner || !call?.trailingClosure || (node.name === 'List' ? node.kind !== 'view' || call.args.length > 0 : !range)) throw new Error('Only a static List of Text rows, or a Repeat over a range, can become a collection.')
  if (!identifier(name) || !identifier(recordType) || SUPPORTED_VIEWS.has(recordType) || ['String', 'Int', 'Double', 'Bool', 'Color', 'Font', 'View', 'App', 'UUID', 'CGFloat', 'Array', 'Dictionary', 'Optional'].includes(recordType) || name === recordType || owner.members.some(m => 'name' in m && m.name === name) || ctx.ast.some(f => f.declarations.some(d => 'name' in d && d.name === recordType))) throw new Error('Choose unused Swift names for the collection and record type.')
  if (hasComments(ctx, call.span)) throw new Error('This list has comments whose ownership would change during conversion. Convert it in Swift.')
  let titles: readonly string[], template: string
  if (range) ({ titles, template } = range)
  else {
    const rows = node.children.map(id => plainTextRow(ctx, ctx.nodes.find(n => n.id === id)))
    if (!rows.length || rows.some(row => !row) || new Set(rows.map(row => row!.template)).size > 1) throw new Error('Rows that differ would lose what makes each one different in a single row design. Keep the static list, or make every row plain Text written alike.')
    titles = rows.map(row => row!.title)
    template = rows[0]!.template
  }
  const { indent, unit } = lineIndent(ctx, owner.span.file, call.span.start)
  const records = titles.map((title, i) => `${recordType}(id: "item-${i + 1}", title: ${swiftString(title)})`).join(', ')
  // Preserve the list's modifier chain, replacing only its constructor and content.
  return [patch(call.span, `${node.name}(${name}) { item in\n${indent}${unit}${template}\n${indent}}`), insertMember(ctx, owner, `@State private var ${name}: [${recordType}] = [${records}]`), { file: owner.span.file, start: owner.span.end, end: owner.span.end, text: `\n\nstruct ${recordType}: Identifiable {\n    let id: String\n    var title: String\n}\n` }]
}
export function emptyState(ctx: FeatureContext, node: AuthoringNode, message: string): SourcePatch[] {
  const info = collectionFor(ctx, node)
  if (!info || message.length > 16_384) throw new Error('Select a supported collection to add its empty state.')
  let parent = ctx.nodes.find(n => n.id === node.parentId)
  while (parent) { if (parent.kind === 'branch' && parent.properties.some(p => p.expression.includes(`${info.name}.isEmpty`))) throw new Error('This collection already has an empty-state branch. Edit its Text layer.'); parent = ctx.nodes.find(n => n.id === parent!.parentId) }
  // A modifier switched off at the end of the collection's chain is written after it, and goes inside with it.
  const source = { ...node.source, end: afterOffMarkers(ctx.files.find(f => f.id === node.source.file)?.text ?? '', node.source.end) }
  // Indented from the list's own line: the list goes two levels in, into the branch (D13).
  const { indent, unit } = lineIndent(ctx, source.file, source.start)
  const list = raw(ctx, source).replace(/\n/g, `\n${unit}${unit}`)
  return [patch(source, `Group {\n${indent}${unit}if ${info.name}.isEmpty {\n${indent}${unit}${unit}Text(${swiftString(message)})\n${indent}${unit}} else {\n${indent}${unit}${unit}${list}\n${indent}${unit}}\n${indent}}`)]
}


/** Defaults preserve every existing initializer, including developer action bodies. */
export function addCollectionField(ctx: FeatureContext, node: AuthoringNode, name: string, type: RecordField['type'], optional: boolean, value: DesignValue): SourcePatch[] {
  const info = collectionFor(ctx, node), decl = info && namedStruct(ctx, info.recordType)
  if (!info || !decl || !identifier(name) || !['String', 'Int', 'Double', 'Bool'].includes(type) || !validScalar(value, { type, optional })) throw new Error('Choose a supported field name, type and default value.')
  if (decl.members.some(m => 'name' in m && m.name === name) || info.fields.length >= 32) throw new Error('The field already exists or the record has reached its 32-field limit.')
  const eol = ctx.files.find(f => f.id === decl.span.file)?.text.includes('\r\n') ? '\r\n' : '\n'
  return [{ file: decl.span.file, start: decl.span.end - 1, end: decl.span.end - 1, text: `${eol}    var ${name}: ${type}${optional ? '?' : ''} = ${swiftValue(value)}${eol}` }]
}
