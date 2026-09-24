import { deploymentVersion, nameInWords } from '@studio/shared'
import type { AuthoringNode, ComponentSettings, ComponentVariant, DesignControl, SourceFile } from '@studio/shared'
import { Parser, insertView, forEachChild, type FuncDecl, type Node, type TypeRef, type VarDecl } from '@studio/swift-syntax'
import { readsNoValue } from './authoring-clipboard'
import { AUTHORING_COLORS, swiftString, validateControlValue, designControlRecipes } from './design-controls'
import { applyPatches, allDeclarations, callOf, expressionOf, identifier, insertMember, insertArgument, literal, namedStruct, ownerOf, patch, raw, scalarType, shadowsMember, signature, type FeatureContext, type SourcePatch, sourceRoot } from './authoring-context'
import { SUPPORTED_VIEWS } from './builtins'
import { enclosingCollection } from './authoring-collections'
import { buildAuthoringModel } from './authoring'
import { Checker } from './checker'

export function namedActions(ctx: FeatureContext, node: AuthoringNode): FuncDecl[] {
  const owner = ownerOf(ctx, node)
  const actions = owner?.members.filter((m): m is FuncDecl => m.kind === 'funcDecl' && !m.params.length && !m.generics.length && !m.isAsync && !m.canThrow && !!m.body && (!m.returnType || m.returnType.kind === 'namedType' && m.returnType.name === 'Void') && !m.modifiers.some(x => x.name === 'static')) ?? []
  // Reject direct and indirect recursion before exposing an action in the designer.
  const references = (fn: FuncDecl) => {
    const result = new Set<string>()
    const visit = (n: Node) => { if (n.kind === 'call' && n.callee.kind === 'identifier') result.add(n.callee.name); if (n.kind === 'call' && n.callee.kind === 'memberAccess' && n.callee.base?.kind === 'selfExpr') result.add(n.callee.member); forEachChild(n, visit) }
    if (fn.body) visit(fn.body)
    return [...result]
  }
  const safe = (fn: FuncDecl, path: Set<string>): boolean => !path.has(fn.name) && references(fn).every(name => {
    const next = actions.find(a => a.name === name)
    return !next || safe(next, new Set([...path, fn.name]))
  })
  return actions.filter(fn => !shadowsMember(ctx, node, fn.name) && safe(fn, new Set()))
}
export function enumCases(ctx: FeatureContext, type: string): readonly string[] | undefined {
  const matches = allDeclarations(ctx).filter(d => 'name' in d && d.name === type)
  const decl = matches.length === 1 ? matches[0] : undefined
  return decl?.kind === 'enumDecl' && !decl.generics.length && decl.cases.length <= 32 && decl.cases.every(c => !c.associated.length) ? decl.cases.map(c => c.name) : undefined
}
const emptyComponentCache = new WeakMap<FeatureContext, string[]>()
export function emptyComponents(ctx: FeatureContext): string[] {
  const cached = emptyComponentCache.get(ctx)
  if (cached) return cached
  const names = ctx.ast.flatMap(f => f.declarations).filter(d => d.kind === 'structDecl' && d.inherits.some(t => t.name === 'View') && !d.generics.length && !d.members.some(m => m.kind === 'initDecl' || m.kind === 'varDecl' && !m.accessor && !m.initializer && !m.attributes.some(a => ['State', 'Environment'].includes(a.name)))).map(d => 'name' in d ? d.name ?? '' : '').filter(n => !!namedStruct(ctx, n))
  emptyComponentCache.set(ctx, names)
  return names
}

export interface ComponentRecipe { control: DesignControl; portable: boolean; write(value: string): SourcePatch }
export function componentRecipes(ctx: FeatureContext, node: AuthoringNode): ComponentRecipe[] {
  if (node.kind !== 'component') return []
  const call = callOf(ctx, node), decl = namedStruct(ctx, node.name)
  if (!call || !decl || decl.isReference || decl.generics.length || decl.members.some(m => m.kind === 'initDecl')) return []
  const fields = decl.members.filter((m): m is VarDecl => m.kind === 'varDecl' && !m.accessor && !m.modifiers.some(x => ['static', 'private', 'fileprivate'].includes(x.name)) && !(m.isLet && m.initializer) && !m.attributes.some(a => a.name !== 'Binding'))
  if (call.args.some(a => !fields.some(f => f.name === a.label))) return []
  const descriptions = ctx.descriptions?.filter(d => d.owner === node.name) ?? []
  const description = descriptions.length === 1 && descriptions[0]?.signature === signature(ctx, decl) && descriptions[0].properties.every(p => fields.some(f => f.name === p.name)) ? descriptions[0] : undefined
  const result: ComponentRecipe[] = []
  for (const field of fields) {
    if (field.attributes.length) continue // Binding ownership belongs to the call site's state, never a literal override.
    const argument = call.args.find(a => a.label === field.name)
    const expr = argument?.value ?? field.initializer
    const type = field.typeAnnotation
    const scalar = scalarType(type, field.initializer) ?? (type?.kind === 'namedType' && ['CGFloat', 'Float'].includes(type.name) ? { type: 'Double' as const, optional: false } : undefined)
    let kind: DesignControl['kind'] = 'text', value: string | undefined, options: readonly string[] | undefined
    let format = (v: string) => swiftString(v)
    const input = literal(ctx, expr)
    if (scalar && !scalar.optional && input !== undefined && input !== null) {
      value = String(input)
      kind = scalar.type === 'String' ? 'text' : scalar.type === 'Bool' ? 'select' : 'number'
      options = scalar.type === 'Bool' ? ['true', 'false'] : undefined
      format = v => scalar.type === 'String' ? swiftString(v) : scalar.type === 'Bool' ? v : String(Number(v))
    } else if (type?.kind === 'namedType') {
      options = type.name === 'Color' && !allDeclarations(ctx).some(d => 'name' in d && d.name === 'Color') ? AUTHORING_COLORS.filter(c => deploymentVersion(ctx.deploymentTarget) >= 15 || !['mint', 'teal', 'cyan', 'indigo', 'brown'].includes(c)) : enumCases(ctx, type.name)
      if (options && expr?.kind === 'memberAccess' && (!expr.base || expr.base.kind === 'identifier' && expr.base.name === type.name) && options.includes(expr.member)) {
        value = expr.member; kind = 'select'; format = v => `${type.name}.${v}`
      }
    } else if (type?.kind === 'functionType' && !type.params.length && type.result.kind === 'namedType') {
      if (type.result.name === 'Void') {
        options = namedActions(ctx, node).map(f => f.name)
        if (expr?.kind === 'identifier' && options.includes(expr.name)) value = expr.name
        if (expr?.kind === 'closure' && !expr.params.length && !expr.body.statements.length) value = ''
        // Explicitly described action/slot properties are safe only when the existing expression is a known reference.
        kind = 'select'; format = v => v
      } else if (type.result.name === 'AnyView' && description?.properties.some(p => p.name === field.name)) {
        options = emptyComponents(ctx).filter(n => n !== node.name)
        const source = expr && raw(ctx, expr.span)
        const matched = options.find(name => source?.replace(/\s/g, '') === `{AnyView(${name}())}`)
        if (matched) value = matched
        kind = 'select'; format = v => `{ AnyView(${v}()) }`
      }
    }
    if (value === undefined) continue
    const descriptive = description?.properties.find(p => p.name === field.name)
    const probe = insertArgument(ctx, call, field.name, format(value), fields.map(f => f.name))
    if (!probe) continue
    const control: DesignControl = { id: `component:${field.name}`, source: argument?.value.span ?? call.span, group: descriptive?.group, label: descriptive?.label || field.name, description: descriptive?.description || 'Changes this call-site argument. Other component instances and the shared definition remain independent.', kind, value, options, min: descriptive?.min, max: descriptive?.max, scope: 'This component instance' }
    result.push({ control, portable: type?.kind !== 'functionType', write(v) {
      if (scalar?.type === 'Int' && !Number.isSafeInteger(Number(v))) throw new Error('Use a whole number for this component property.')
      return insertArgument(ctx, call, field.name, format(v), fields.map(f => f.name))!
    } })
  }
  return result
}
export function componentSettings(ctx: FeatureContext, node: AuthoringNode): ComponentSettings | undefined {
  if (!node.definitionId) return undefined
  const decl = namedStruct(ctx, node.name)
  if (!decl) return undefined
  const currentSignature = signature(ctx, decl)
  const desc = ctx.descriptions?.find(d => d.owner === node.name)
  return { reusable: 'call' in componentCopy(ctx, node.name), variantControls: componentRecipes(ctx, node).filter(r => r.portable).map(r => r.control.id), definitionId: node.definitionId, signature: currentSignature, propertyNames: decl.members.filter((m): m is VarDecl => m.kind === 'varDecl' && !m.accessor && !m.modifiers.some(x => ['private', 'fileprivate', 'static'].includes(x.name))).map(m => m.name), callSites: ctx.nodes.filter(n => n.definitionId === node.definitionId).map(n => n.source), controls: componentRecipes(ctx, node).map(r => r.control), descriptionStatus: !desc ? 'Inferred from the Swift interface' : desc.signature === currentSignature ? 'Description matches the Swift interface' : 'Description is outdated; using the Swift interface' }
}

export function extractComponent(ctx: FeatureContext, node: AuthoringNode, name: string): { patches: SourcePatch[]; files: SourceFile[] } {
  if (!identifier(name) || allDeclarations(ctx).some(d => 'name' in d && d.name === name) || SUPPORTED_VIEWS.has(name)) throw new Error('Choose an unused component name.')
  const expr = expressionOf(ctx, node), owner = ownerOf(ctx, node)
  if (!expr || !owner || node.kind === 'definition' || node.name === 'WindowGroup') throw new Error('Select one view expression to extract.')
  const dependencies = new Set<string>()
  let uncertain = false
  const visit = (n: Node) => {
    if (n.kind === 'identifier') dependencies.add(n.name)
    if (n.kind === 'selfExpr' || n.kind === 'closure' && n.params.length || n.kind === 'declStmt') uncertain = true
    forEachChild(n, visit)
  }
  visit(expr)
  if (uncertain) throw new Error('This selection contains local scope or self references. Extract it in Swift so its dependencies stay explicit.')
  const parameters: string[] = [], arguments_: string[] = []
  const collection = enclosingCollection(ctx, node)
  const globals = new Set(['Color', 'Font', 'String', 'Int', 'Double', 'Bool', 'AnyView', 'Alignment', 'HorizontalAlignment', 'VerticalAlignment'])
  for (const reference of dependencies) {
    const key = reference.replace(/^\$/, '')
    if (arguments_.some(a => a.startsWith(key + ':'))) continue
    if (SUPPORTED_VIEWS.has(key) || globals.has(key) || namedStruct(ctx, key) || enumCases(ctx, key)) continue
    if (collection?.parameter === key) {
      if (reference.startsWith('$') && !collection.binding) throw new Error(`The row ${key} does not have editable storage.`)
      parameters.push(`${collection.binding ? '@Binding var' : 'let'} ${key}: ${collection.recordType}`)
      arguments_.push(`${key}: ${collection.binding ? '$' : ''}${key}`)
      continue
    }
    const member = owner.members.find(m => 'name' in m && m.name === key)
    if (shadowsMember(ctx, node, key)) throw new Error(`The local dependency “${key}” needs explicit parameterization in Swift.`)
    if (member?.kind === 'varDecl' && !member.accessor && !member.setter && !member.observers && member.attributes.every(a => ['State', 'Binding'].includes(a.name))) {
      const simple = scalarType(member.typeAnnotation, member.initializer)
      const type = member.typeAnnotation ? raw(ctx, member.typeAnnotation.span) : simple?.type
      if (!type || !(simple || enumCases(ctx, type) || namedStruct(ctx, type))) throw new Error(`Cannot infer an explicit parameter for ${key}.`)
      const binding = member.attributes.some(a => ['State', 'Binding'].includes(a.name))
      if (reference.startsWith('$') && !binding) throw new Error(`Cannot bind ${key}.`)
      parameters.push(`${binding ? '@Binding var' : 'let'} ${key}: ${type}`)
      arguments_.push(`${key}: ${binding ? '$' : ''}${key}`)
    } else if (member?.kind === 'funcDecl' && namedActions(ctx, node).includes(member)) {
      parameters.push(`let ${key}: () -> Void`); arguments_.push(`${key}: ${key}`)
    } else throw new Error(`The dependency “${key}” cannot be parameterized safely. Extract this selection in Swift.`)
  }
  const eol = ctx.files.find(f => f.id === node.source.file)?.text.includes('\r\n') ? '\r\n' : '\n'
  const file = `${sourceRoot(ctx)}DesignSystem/Components/${name}.swift`
  const text = `import SwiftUI\n\nstruct ${name}: View {\n    ${parameters.join('\n    ')}\n    var body: some View {\n        ${raw(ctx, node.source)}\n    }\n}\n`.replace(/\r?\n/g, eol)
  return { patches: [patch(node.source, `${name}(${arguments_.join(', ')})`)], files: [{ id: file, text }] }
}

/**
 * A value of `type` for a new copy to start with, when its screen's own cannot come along:
 * words from the input's name, zero, false, blue, an enum's first case, or no value at all.
 */
function sampleOf(ctx: FeatureContext, type: TypeRef | null, label: string): string | undefined {
  if (type?.kind === 'optionalType') return 'nil'
  if (type?.kind !== 'namedType') return undefined
  switch (type.name) {
    case 'String': return swiftString(nameInWords(label).replace(/^./, first => first.toUpperCase()))
    case 'Int': case 'Double': case 'CGFloat': case 'Float': return '0'
    case 'Bool': return 'false'
    case 'Color': return '.blue'
  }
  const first = enumCases(ctx, type.name)?.[0]
  return first === undefined ? undefined : `.${first}`
}

const isAction = (type: TypeRef | null) => type?.kind === 'functionType' && !type.params.length && type.result.kind === 'namedType' && type.result.name === 'Void'

/**
 * A new copy of component `name`, to put on any screen (D6): each input as a copy can
 * have it on its own. A literal, a colour or a token stays as the first copy wrote it;
 * an action starts empty, to be set in When tapped; a value from the copy's screen gives
 * way to the input's default, or to what another copy wrote, or to a sample of its type,
 * which the settings panel can change - held in `.constant` for a binding. Says why when
 * an input is something no sample fits.
 */
export function componentCopy(ctx: FeatureContext, name: string): { readonly call: string } | { readonly problem: string } {
  const instances = ctx.nodes.filter(n => n.kind === 'component' && n.name === name)
  const call = instances[0] && callOf(ctx, instances[0]), decl = namedStruct(ctx, name)
  if (!call || !decl) return { problem: `${name} has no copy to start a new one from.` }
  const calls = instances.flatMap(instance => callOf(ctx, instance) ?? [])
  const fields = decl.members.filter((m): m is VarDecl => m.kind === 'varDecl')
  const inputs: string[] = []
  for (const argument of call.args) {
    const field = fields.find(f => f.name === argument.label)
    const type = field?.typeAnnotation ?? null
    if (!argument.label || !field) return { problem: `${name}’s inputs are written in a way a new copy can’t follow. Duplicate a copy instead.` }
    if (isAction(type)) { inputs.push(`${argument.label}: { }`); continue }
    if (readsNoValue(argument.value)) { inputs.push(`${argument.label}: ${raw(ctx, argument.value.span)}`); continue }
    if (field.initializer) continue
    const written = calls.flatMap(other => other.args.filter(a => a.label === argument.label && readsNoValue(a.value))).at(0)
    const sample = sampleOf(ctx, type, argument.label)
    const value = written ? raw(ctx, written.value.span) : sample !== undefined && field.attributes.some(a => a.name === 'Binding') ? `.constant(${sample})` : sample
    if (value === undefined) return { problem: `${name}’s ${argument.label} comes from the screen it is on, and a copy elsewhere can’t have it. Duplicate a copy on that screen instead.` }
    inputs.push(`${argument.label}: ${value}`)
  }
  // A closure after the call is its last closure input: an action starts empty, as one in the parentheses does.
  const trailing = [...fields].reverse().find(f => f.typeAnnotation?.kind === 'functionType')
  const content = !call.trailingClosure ? '' : isAction(trailing?.typeAnnotation ?? null) ? ' { }' : readsNoValue(call.trailingClosure) ? ` ${raw(ctx, call.trailingClosure.span)}` : undefined
  if (content === undefined) return { problem: `${name}’s content comes from the screen it is on, and a copy elsewhere can’t have it. Duplicate a copy on that screen instead.` }
  return { call: `${name}(${inputs.join(', ')})${content}` }
}

export function insertComponent(ctx: FeatureContext, target: AuthoringNode, name: string) {
  const copy = componentCopy(ctx, name)
  if ('problem' in copy) throw new Error(copy.problem)
  const dependsOn = (owner: string, seen = new Set<string>()): boolean => {
    if (owner === target.owner) return true
    if (seen.has(owner)) return false
    seen.add(owner)
    return ctx.nodes.filter(n => n.owner === owner && n.kind === 'component').some(n => dependsOn(n.name, seen))
  }
  if (dependsOn(name)) throw new Error('A component cannot contain itself, directly or through another component.')
  const file = ctx.files.find(f => f.id === target.source.file)!
  const inserted = insertView(file.text, file.id, target.source.start, copy.call)
  if (!inserted) throw new Error('Select a layout or a layer inside a screen before adding this component.')
  return { files: ctx.files.map(f => f.id === file.id ? { ...f, text: inserted.text } : f), offset: inserted.offset }
}

export function applyComponentVariant(ctx: FeatureContext, node: AuthoringNode, variant: ComponentVariant) {
  const decl = namedStruct(ctx, node.name)
  if (node.kind !== 'component' || !decl || variant.owner !== node.name || variant.signature !== signature(ctx, decl)) throw new Error('This variant belongs to a different component interface. Save a new variant from the current inputs.')
  if (!variant.values.length || variant.values.length > 100 || new Set(variant.values.map(v => v.control)).size !== variant.values.length) throw new Error('A variant needs unique editable inputs.')
  let current = ctx, selected = node
  // Reparse each argument so missing/default arguments can share one insertion
  // point without producing malformed commas. The caller commits once, atomically.
  for (const value of variant.values) {
    const recipe = componentRecipes(current, selected).find(r => r.portable && r.control.id === value.control)
    if (!recipe) throw new Error('A saved input is now linked or unavailable. Preserve its connection and save a new variant.')
    const error = validateControlValue(recipe.control, value.value)
    if (error) throw new Error(error)
    const files = applyPatches(current, [recipe.write(value.value)])
    const ast = files.map(f => Parser.parse(f.text, f.id).sourceFile)
    const model = buildAuthoringModel({ projectId: 'variant', revision: 0, files, parsed: ast, diagnostics: Checker.check(ast).diagnostics })
    const next = model.nodes.find(n => n.name === node.name && n.owner === node.owner && n.source.file === node.source.file && n.source.start === node.source.start)
    if (!next) throw new Error('The component instance changed while applying its variant.')
    selected = next; current = { ...current, files, ast, nodes: model.nodes }
  }
  return { files: [...current.files], offset: node.source.start }
}

/** Promote a literal label to a defaulted input without changing existing instances. */
export function exposeComponentInput(ctx: FeatureContext, node: AuthoringNode, control: string, name: string) {
  const owner = ownerOf(ctx, node), expression = expressionOf(ctx, node)
  if (!owner || !expression || !ctx.nodes.some(n => n.kind === 'component' && n.name === owner.name)) throw new Error('Select text inside a reusable component’s shared design.')
  if (!identifier(name) || owner.members.some(m => 'name' in m && m.name === name) || owner.members.some(m => m.kind === 'initDecl')) throw new Error('Choose an unused input name on a component without a custom initializer.')
  const recipe = designControlRecipes(node, expression, ctx.files.find(f => f.id === node.source.file)!.text, ctx.deploymentTarget).find(r => ['content', 'title'].includes(r.control.id) && r.control.id === control && r.control.kind === 'text')
  if (!recipe) throw new Error('Only plain text or a plain control title can become a text input here. Linked or conditional text keeps its existing connection.')
  const patches = [insertMember(ctx, owner, `var ${name}: String = ${swiftString(recipe.control.value)}`), patch(recipe.control.source, `self.${name}`)]
  return { files: applyPatches(ctx, patches), offset: node.source.start + patches.filter(p => p.file === node.source.file && p.end <= node.source.start).reduce((delta, p) => delta + p.text.length - (p.end - p.start), 0) }
}
