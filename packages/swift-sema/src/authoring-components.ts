import { colorInputText, deploymentVersion, nameInWords, swiftIdentifier, swiftName } from '@studio/shared'
import type { AuthoringNode, ComponentInputKind, ComponentSettings, ComponentVariant, DesignControl, SourceFile } from '@studio/shared'
import { Parser, callParameter, fitsParameters, insertView, forEachChild, type Attribute, type CallExpr, type Expr, type FuncDecl, type InitDecl, type Node, type StructDecl, type TypeRef, type VarDecl } from '@studio/swift-syntax'
import { readsNoValue } from './authoring-clipboard'
import { AUTHORING_COLORS, CHANGE_IN_CODE, colorArgument, plainValue, swiftString, validateControlValue, designControlRecipes, viewCallChain } from './design-controls'
import { applyPatches, allDeclarations, callOf, enumCases, expressionOf, insertMember, insertStoredMember, insertArgument, layerById, literal, namedStruct, ownerOf, patch, raw, scalarType, shadowsMember, signature, type FeatureContext, type SourcePatch, sourceRoot } from './authoring-context'
import { SUPPORTED_VIEWS } from './builtins'
import { enclosingCollection } from './authoring-collections'
import { buildAuthoringModel } from './authoring'
import { layerProject } from './layer'
import { readColor } from './layer/color'
import { Checker } from './checker'
import { visibilityEdit } from './authoring-visibility'
import { pagesThrough } from './page-style'

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
const emptyComponentCache = new WeakMap<FeatureContext, string[]>()
export function emptyComponents(ctx: FeatureContext): string[] {
  const cached = emptyComponentCache.get(ctx)
  if (cached) return cached
  const names = ctx.ast.flatMap(f => f.declarations).filter(d => d.kind === 'structDecl' && d.inherits.some(t => t.name === 'View') && !d.generics.length && !d.members.some(m => m.kind === 'initDecl' || m.kind === 'varDecl' && !m.accessor && !m.initializer && !m.attributes.some(a => ['State', 'Environment'].includes(a.name)))).map(d => 'name' in d ? d.name ?? '' : '').filter(n => !!namedStruct(ctx, n))
  emptyComponentCache.set(ctx, names)
  return names
}

export interface ComponentRecipe { control: DesignControl; portable: boolean; write(value: string): SourcePatch }

/** A value a call of a component gives it: by the label it is written with, its type, and its own value when the call leaves it out. */
interface ComponentInput { readonly name: string; readonly typeAnnotation: TypeRef | null; readonly attributes: readonly Attribute[]; readonly initializer: Expr | null }

/**
 * What a call of a component writes its values as: the stored properties its memberwise
 * initialiser takes, or the labelled parameters of the one `init` of its own the call
 * fits (Wave 3a). Undefined when it fits none of those, or several.
 */
function componentInputs(decl: StructDecl, call: CallExpr): ComponentInput[] | undefined {
  const inits = decl.members.filter((m): m is InitDecl => m.kind === 'initDecl')
  if (!inits.length) return decl.members.filter((m): m is VarDecl => m.kind === 'varDecl' && !m.accessor && !m.modifiers.some(x => ['static', 'private', 'fileprivate'].includes(x.name)) && !(m.isLet && m.initializer) && !m.attributes.some(a => a.name !== 'Binding'))
  const fitting = inits.filter(init => fitsParameters(init.params.map(callParameter), call))
  return fitting.length === 1 ? fitting[0]!.params.flatMap(param => {
    const name = callParameter(param).label
    return name ? [{ name, typeAnnotation: param.type, attributes: param.attributes, initializer: param.defaultValue }] : []
  }) : undefined
}

/** Views a screen can be wrapped in and stay the screen, as a tab's `NavigationStack { Home() }` (Wave 5b). */
const AROUND_SCREENS = new Set(['NavigationStack', 'NavigationView', 'Group'])
/** Where a copy is a screen: the app's window, an iOS 18 `Tab`, or a part of a view pushed or presented over it. */
const SCREEN_PLACES = new Set(['WindowGroup', 'Tab', 'Destination', 'Sheet', 'Full screen cover', 'Popover'])
const componentCache = new WeakMap<FeatureContext, { readonly names: readonly string[]; readonly set: ReadonlySet<string> }>()
/**
 * The project's components, by name (Wave 5b): each View struct with a copy in a view, unless a
 * copy is placed as a screen is, as the navigator's `pageViews` reads one: in the app's window,
 * as a tab, pushed or presented, or as the whole of a screen's body. A component's Main is one
 * of these, never a screen; Swap lists them. Worked out once for the project.
 */
function componentsOf(ctx: FeatureContext) {
  let found = componentCache.get(ctx)
  if (found) return found
  const screens = new Set<string>(), copies = new Set<string>(), roots: [string, string][] = []
  for (const node of ctx.nodes) {
    if (node.kind !== 'component') continue
    copies.add(node.name)
    let around = layerById(ctx, node.parentId)
    while (around?.kind === 'view' && AROUND_SCREENS.has(around.name)) around = layerById(ctx, around.parentId)
    const place = around?.name ?? ''
    if (around?.kind === 'definition') roots.push([place, node.name])
    // A TabView's tab, unless it swipes through pages; `NavigationLink("Title") { Detail() }`'s closure is where it goes.
    else if (SCREEN_PLACES.has(place) || place === 'TabView' && !pagesThrough(viewCallChain(expressionOf(ctx, around!)!)?.modifiers ?? []) || place === 'NavigationLink' && callOf(ctx, around!)?.args[0]?.label === null) screens.add(node.name)
  }
  // The view a screen's body is, the tabs `MainTabs()` holds, is that screen still.
  for (let grew = true; grew;) {
    grew = false
    for (const [screen, root] of roots) if (screens.has(screen) && !screens.has(root)) grew = !!screens.add(root)
  }
  const names = [...copies].filter(name => { const decl = !screens.has(name) && namedStruct(ctx, name); return !!decl && !decl.isReference && decl.inherits.some(t => t.name === 'View') }).sort()
  componentCache.set(ctx, found = { names, set: new Set(names) })
  return found
}
/** Every component of the project, by name in order (Wave 5b): the Mains Swap chooses among. */
export const projectComponents = (ctx: FeatureContext): readonly string[] => componentsOf(ctx).names
/** Whether `name` is a component, whose Main each copy is drawn from, rather than a screen (Wave 5b). */
export const isComponent = (ctx: FeatureContext, name: string): boolean => componentsOf(ctx).set.has(name)
/** Whether a Main has an init of its own, which every copy calls, so its inputs can't be told apart (Wave 5b). */
export const ownInit = (decl: StructDecl): boolean => decl.members.some(m => m.kind === 'initDecl')

const usesCache = new WeakMap<StructDecl, ReadonlyMap<string, 'symbol' | 'image'>>()
/**
 * The inputs a Main shows as a symbol, `Image(systemName: icon)` or `Label(…, systemImage:
 * icon)`, or as an image, `Image(artwork)` (Wave 5b): read once for each Main.
 */
function inputUses(decl: StructDecl): ReadonlyMap<string, 'symbol' | 'image'> {
  let uses = usesCache.get(decl)
  if (uses) return uses
  const found = new Map<string, 'symbol' | 'image'>()
  const name = (value: Expr) => value.kind === 'identifier' ? value.name : value.kind === 'memberAccess' && value.base?.kind === 'selfExpr' ? value.member : undefined
  const visit = (n: Node) => {
    if (n.kind === 'call') for (const [index, arg] of n.args.entries()) {
      const input = name(arg.value)
      if (input && (arg.label === 'systemName' || arg.label === 'systemImage')) found.set(input, 'symbol')
      else if (input && index === 0 && arg.label === null && n.args.length === 1 && n.callee.kind === 'identifier' && n.callee.name === 'Image') found.set(input, 'image')
    }
    forEachChild(n, visit)
  }
  for (const member of decl.members) if (member.kind === 'varDecl' && member.name === 'body') visit(member)
  usesCache.set(decl, uses = found)
  return uses
}

/** A view's properties where the expression read is in another file than the view: none of them are its (Wave 5b). */
const ELSEWHERE = { properties: [] }

export function componentRecipes(ctx: FeatureContext, node: AuthoringNode): ComponentRecipe[] {
  if (node.kind !== 'component') return []
  const call = callOf(ctx, node), decl = namedStruct(ctx, node.name)
  const fields = call && decl && !decl.isReference ? componentInputs(decl, call) : undefined
  if (!call || !decl || !fields || call.args.some(a => !fields.some(f => f.name === a.label))) return []
  /** A type a generic container is given at its call, `Content`, which takes no literal. */
  const generic = (type: TypeRef | null) => type?.kind === 'namedType' && decl.generics.some(parameter => parameter.name === type.name)
  const descriptions = ctx.descriptions?.filter(d => d.owner === node.name) ?? []
  const description = descriptions.length === 1 && descriptions[0]?.signature === signature(ctx, decl) && descriptions[0].properties.every(p => fields.some(f => f.name === p.name)) ? descriptions[0] : undefined
  const result: ComponentRecipe[] = []
  for (const field of fields) {
    // Binding ownership belongs to the call site's state, and a view type to what the call gives it: never a literal override.
    if (field.attributes.length || generic(field.typeAnnotation)) continue
    const argument = call.args.find(a => a.label === field.name)
    const expr = argument?.value ?? field.initializer
    const type = field.typeAnnotation
    const scalar = scalarType(type, field.initializer) ?? (type?.kind === 'namedType' && ['CGFloat', 'Float'].includes(type.name) ? { type: 'Double' as const, optional: false } : undefined)
    let kind: DesignControl['kind'] = 'text', value: string | undefined, options: readonly string[] | undefined
    let format = (v: string) => swiftString(v), inputKind: DesignControl['inputKind'], disabledReason: string | undefined
    const input = literal(ctx, expr)
    if (scalar && !scalar.optional && input !== undefined && input !== null) {
      value = String(input)
      kind = scalar.type === 'String' ? 'text' : scalar.type === 'Bool' ? 'toggle' : 'number'
      format = v => scalar.type === 'String' ? swiftString(v) : scalar.type === 'Bool' ? v : String(Number(v))
      if (scalar.type === 'String') inputKind = inputUses(decl).get(field.name)
    } else if (type?.kind === 'namedType') {
      if (type.name === 'Color' && !allDeclarations(ctx).some(d => 'name' in d && d.name === 'Color')) {
        // A colour input reads a name, a hex or a token, each in the file it is written in, and
        // writes what the colour control gives it; one it can't say is shown read only (Wave 5b).
        options = AUTHORING_COLORS.filter(c => deploymentVersion(ctx.deploymentTarget) >= 15 || !['mint', 'teal', 'cyan', 'indigo', 'brown'].includes(c))
        if (expr) {
          const file = expr.span.file, text = ctx.files.find(f => f.id === file)?.text ?? '', read = readColor(expr, { text, node: file === node.source.file ? node : ELSEWHERE })
          value = read.state === 'code' ? undefined : colorInputText(read.value)
          if (value === undefined) { value = text.slice(expr.span.start, expr.span.end); disabledReason = read.disabledReason ?? `This color has an opacity a copy’s color can’t hold. ${CHANGE_IN_CODE}` }
          kind = 'select'; inputKind = 'color'; format = v => colorArgument(v, deploymentVersion(ctx.deploymentTarget))
        }
      } else {
        // A case is written as `.secondary`, which names a nested enum's case as well as any other's (Wave 5b).
        options = enumCases(ctx, type.name)
        if (options && expr?.kind === 'memberAccess' && (!expr.base || expr.base.kind === 'identifier' && expr.base.name === type.name) && options.includes(expr.member)) {
          value = expr.member; kind = 'select'; format = v => `.${v}`
        }
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
    // A value it can read but not write here, a colour newer than the target, is shown read only with why.
    try { if (!disabledReason && !insertArgument(ctx, call, field.name, format(value), fields.map(f => f.name))) continue } catch (error) { disabledReason = (error as Error).message }
    const control: DesignControl = { id: `component:${field.name}`, source: argument?.value.span ?? call.span, group: descriptive?.group, label: descriptive?.label || field.name, description: descriptive?.description || 'Changes this call-site argument. Other component instances and the shared definition remain independent.', kind, value, options, min: descriptive?.min, max: descriptive?.max, scope: 'This component instance', inputKind, disabledReason }
    result.push({ control, portable: type?.kind !== 'functionType' && !disabledReason, write(v) {
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
  if (!swiftIdentifier(name) || allDeclarations(ctx).some(d => 'name' in d && d.name === name) || SUPPORTED_VIEWS.has(name)) throw new Error('Choose an unused component name.')
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
export function sampleOf(ctx: FeatureContext, type: TypeRef | null, label: string): string | undefined {
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

export const isAction = (type: TypeRef | null) => type?.kind === 'functionType' && !type.params.length && type.result.kind === 'namedType' && type.result.name === 'Void'

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

/** The name an input of each kind takes when the designer gives none (Wave 5b), numbered past any the Main has; a number's is what it sets, `padding`, and Shown's the view's, `showsImage`. */
const INPUT_NAMES: Readonly<Record<Exclude<ComponentInputKind, 'number' | 'shown'>, string>> = { text: 'label', symbol: 'icon', image: 'image', color: 'tint' }

/**
 * What a view's control in a Main can become as an input of each copy (Wave 5b): a value
 * written plainly where the control reads it, `"star"`, `.red` or `8`, so the Main still
 * shows what it showed. A text is the view's own words, or a symbol's or an image's name.
 */
function exposeKind(ctx: FeatureContext, node: AuthoringNode, control: DesignControl, written: string): DesignControl['exposeAs'] {
  const plain = plainValue(control, written), { id } = control
  if (plain !== 'text') return plain === 'toggle' ? undefined : plain
  // An Image's name is an asset's, unless it is given as its systemName; a Label's and a Button's is a symbol's.
  return id === 'content' || id === 'title' ? 'text' : id === 'image' && node.name === 'Image' && callOf(ctx, node)?.args[0]?.label !== 'systemName' ? 'image' : id === 'image' || id === 'icon' ? 'symbol' : undefined
}
/** A view's controls in a Main, each that can become a copy's input saying what kind (Wave 5b); any other view's as they are. */
export function exposable(ctx: FeatureContext, node: AuthoringNode, controls: DesignControl[] | undefined): DesignControl[] | undefined {
  if (!controls || node.kind !== 'view' || !isComponent(ctx, node.owner)) return controls
  const text = ctx.files.find(f => f.id === node.source.file)?.text ?? ''
  return controls.map(control => { const as = control.source.file === node.source.file ? exposeKind(ctx, node, control, text.slice(control.source.start, control.source.end)) : undefined; return as ? { ...control, exposeAs: as } : control })
}
/** What each kind of input can be made from, for why a value can't become one. */
const KIND_WORDS: Readonly<Record<Exclude<ComponentInputKind, 'text' | 'shown'>, string>> = { symbol: 'a symbol written by its name', image: 'an image written by its asset name', color: 'a color written by its name, such as .red,', number: 'a number written as a number' }

/**
 * A value of a Main each copy can set (Wave 5b), as a defaulted input, so the copies there
 * build still and keep what they showed: text as before, a symbol, an image, a colour or a
 * number in place of the value the control reads, or `shown`, an on/off input the selected
 * view is shown by. An empty `name` takes the kind's own, numbered past any taken.
 */
export function exposeComponentInput(ctx: FeatureContext, node: AuthoringNode, control: string, name: string, as: ComponentInputKind = 'text'): SourcePatch[] | ReturnType<typeof visibilityEdit> {
  const owner = ownerOf(ctx, node), expression = expressionOf(ctx, node)
  if (!owner || !expression || !isComponent(ctx, owner.name)) throw new Error('Select text inside a reusable component’s shared design.')
  if (ownInit(owner)) throw new Error(`${owner.name} has an init of its own, which every copy calls. Add the input in Code.`)
  const free = (n: string) => swiftIdentifier(n) && !owner.members.some(m => 'name' in m && m.name === n) && !shadowsMember(ctx, node, n)
  const text = ctx.files.find(f => f.id === node.source.file)!.text
  const recipe = as === 'shown' ? undefined : designControlRecipes(node, expression, text, layerProject(ctx.ast, ctx.deploymentTarget, ctx.files), ctx.deploymentTarget).find(r => r.control.id === control)
  if (!name) for (let suffix = 2, base = name = as === 'shown' ? `shows${node.name}` : as === 'number' ? swiftName(recipe?.control.label ?? '') || 'amount' : INPUT_NAMES[as]; !free(name); suffix++) name = `${base}${suffix}`
  if (!free(name)) throw new Error('Choose an unused input name on a component without a custom initializer.')
  if (as === 'shown') return visibilityEdit(ctx, node, { kind: 'visibility', when: { input: name, is: true }, create: { name, value: true } })
  if (!recipe || exposeKind(ctx, node, recipe.control, text.slice(recipe.control.source.start, recipe.control.source.end)) !== as) throw new Error(as === 'text' ? 'Only plain text or a plain control title can become a text input here. Linked or conditional text keeps its existing connection.' : `Only ${KIND_WORDS[as]} can become a ${as} input here. ${CHANGE_IN_CODE}`)
  const { source, value } = recipe.control
  return as === 'text' ? [insertMember(ctx, owner, `var ${name}: String = ${swiftString(value)}`), patch(source, `self.${name}`)]
    : [insertStoredMember(ctx, owner, as === 'color' ? `var ${name}: Color = .${value}` : as === 'number' ? `var ${name}: ${recipe.control.integer ? 'Int' : 'CGFloat'} = ${Number(value)}` : `var ${name}: String = ${swiftString(value)}`), patch(source, name)]
}
