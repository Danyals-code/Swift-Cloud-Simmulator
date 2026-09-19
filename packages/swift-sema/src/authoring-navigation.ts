import type { AuthoringNode, NavigationDestination, NavigationSettings, SourceSpan } from '@studio/shared'
import { forEachChild, Parser, type CallExpr, type ClosureExpr, type Expr, type Node, type StructDecl, type VarDecl } from '@studio/swift-syntax'
import { callOf, expressionOf, hasComments, namedStruct, ownerOf, patch, raw, type FeatureContext, type SourcePatch } from './authoring-context'
import { viewCallChain } from './design-controls'
import { enumCases } from './authoring-components'

type Bindings = Map<string, string>
interface Site {
  readonly node: AuthoringNode
  readonly call?: CallExpr
  readonly value?: Expr
  readonly destination?: Expr
  readonly closure?: ClosureExpr
  readonly route?: CallExpr
  readonly scope: NavigationSettings['scope']
  readonly reason?: string
}
const wrappedState = new Set(['State', 'StateObject', 'Environment', 'EnvironmentObject', 'AppStorage', 'SceneStorage', 'FocusState', 'GestureState'])
const contains = (outer: SourceSpan, inner: SourceSpan) => outer.file === inner.file && outer.start <= inner.start && outer.end >= inner.end
const same = (a: SourceSpan, b: SourceSpan) => a.file === b.file && a.start === b.start && a.end === b.end
const member = (call: CallExpr) => call.callee.kind === 'memberAccess' ? call.callee.member : ''
const singleExpression = (closure?: ClosureExpr): Expr | undefined => {
  if (closure?.body.statements.length !== 1) return undefined
  const statement = closure.body.statements[0]!
  return statement.kind === 'exprStmt' ? statement.expression : statement.kind === 'returnStmt' ? statement.value ?? undefined : undefined
}
const typeName = (ctx: FeatureContext, declaration: VarDecl): string | undefined => declaration.typeAnnotation ? raw(ctx, declaration.typeAnnotation.span).replace(/\s/g, '') : undefined
const viewName = (expression?: Expr): string | undefined => {
  const base = expression && viewCallChain(expression)?.base
  return base?.callee.kind === 'identifier' ? base.callee.name : undefined
}
const friendly = (name: string) => name.replace(/View$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
const callCache = new WeakMap<FeatureContext, CallExpr[]>()
function allCalls(ctx: FeatureContext): CallExpr[] {
  const cached = callCache.get(ctx)
  if (cached) return cached
  const result: CallExpr[] = []
  const visit = (node: Node) => { if (node.kind === 'call') result.push(node); forEachChild(node, visit) }
  ctx.ast.forEach(visit)
  callCache.set(ctx, result)
  return result
}
function inferType(ctx: FeatureContext, expr: Expr, bindings: Bindings, depth = 0): string | undefined {
  if (depth > 8) return undefined
  if (expr.kind === 'stringLiteral') return 'String'
  if (expr.kind === 'integerLiteral') return 'Int'
  if (expr.kind === 'floatLiteral') return 'Double'
  if (expr.kind === 'booleanLiteral') return 'Bool'
  if (expr.kind === 'nilLiteral') return 'nil'
  if (expr.kind === 'identifier') return bindings.get(expr.name)
  if (expr.kind === 'unary') {
    const type = inferType(ctx, expr.operand, bindings, depth + 1)
    return expr.operator === '!' ? type === 'Bool' ? type : undefined : ['+', '-'].includes(expr.operator) && type && ['Int', 'Double', 'CGFloat'].includes(type) ? type : undefined
  }
  if (expr.kind === 'arrayLiteral') {
    const types = expr.elements.map(item => inferType(ctx, item, bindings, depth + 1))
    return types.length && types[0] && types.every(type => type === types[0]) ? `[${types[0]}]` : undefined
  }
  if (expr.kind === 'call') {
    if (expr.callee.kind !== 'identifier' || expr.trailingClosure) return undefined
    const declaration = namedStruct(ctx, expr.callee.name)
    if (!declaration) return expr.callee.name === 'UUID' && !expr.args.length ? 'UUID' : undefined
    const requirements = parameters(ctx, declaration)
    return requirements && !argumentsIssue(ctx, expr, requirements, bindings, depth + 1) ? declaration.name : undefined
  }
  if (expr.kind === 'memberAccess' && expr.base) {
    if (expr.base.kind === 'selfExpr') return bindings.get(expr.member)
    const base = inferType(ctx, expr.base, bindings, depth + 1)
    const declaration = base && namedStruct(ctx, base)
    const field = declaration && declaration.members.find((item): item is VarDecl => item.kind === 'varDecl' && item.name === expr.member)
    return field ? typeName(ctx, field) ?? (field.initializer ? inferType(ctx, field.initializer, bindings, depth + 1) : undefined) : undefined
  }
  return undefined
}
function lexicalBindings(ctx: FeatureContext, node: AuthoringNode): Bindings {
  const bindings: Bindings = new Map()
  const fields = ownerOf(ctx, node)?.members.filter((item): item is VarDecl => item.kind === 'varDecl') ?? []
  for (const field of fields) { const type = typeName(ctx, field); if (type) bindings.set(field.name, type) }
  for (let pass = 0; pass < 2; pass++) for (const field of fields) {
    if (!bindings.has(field.name) && field.initializer) { const type = inferType(ctx, field.initializer, bindings); if (type) bindings.set(field.name, type) }
  }
  for (const field of fields) {
    const type = bindings.get(field.name)
    if (type && !field.isLet && field.attributes.some(attribute => ['State', 'Binding'].includes(attribute.name))) bindings.set('$' + field.name, `Binding<${type}>`)
  }
  const calls = allCalls(ctx).filter(call => call.trailingClosure && contains(call.trailingClosure.span, node.source)).sort((a, b) => b.span.end - b.span.start - (a.span.end - a.span.start))
  for (const call of calls) {
    const closure = call.trailingClosure!
    const name = call.callee.kind === 'identifier' ? call.callee.name : member(call)
    let type: string | undefined
    if (['ForEach', 'List'].includes(name) && call.args[0]) {
      const collection = inferType(ctx, call.args[0].value, bindings)
      if (collection?.startsWith('[') && collection.endsWith(']')) type = collection.slice(1, -1)
    } else if (name === 'navigationDestination') {
      const argument = call.args.find(arg => arg.label === 'for')?.value
      if (argument?.kind === 'memberAccess' && argument.member === 'self' && argument.base?.kind === 'identifier') type = argument.base.name
    } else if (['sheet', 'fullScreenCover', 'popover'].includes(name)) {
      const item = call.args.find(arg => arg.label === 'item')?.value
      if (item) type = inferType(ctx, item, bindings)?.replace(/^Binding<(.+)>$/, '$1').replace(/\?$/, '')
    }
    for (const parameter of closure.params) {
      const declared = parameter.type ? raw(ctx, parameter.type.span).replace(/\s/g, '') : type
      if (declared) bindings.set(parameter.name, declared)
      else bindings.delete(parameter.name)
    }
    if (!closure.hasExplicitParams && type) bindings.set('$0', type)
  }
  const locals = (item: Node) => {
    if (!contains(item.span, node.source)) return
    if (item.kind === 'block') for (const statement of item.statements) {
      if (statement.span.start >= node.source.start || statement.kind !== 'declStmt' || statement.declaration.kind !== 'varDecl') continue
      const field = statement.declaration, type = typeName(ctx, field) ?? (field.initializer && inferType(ctx, field.initializer, bindings))
      if (type) bindings.set(field.name, type)
    }
    forEachChild(item, locals)
  }
  ctx.ast.forEach(locals)
  return bindings
}
function routeFor(ctx: FeatureContext, node: AuthoringNode, value: Expr): CallExpr | undefined {
  const valueType = inferType(ctx, value, lexicalBindings(ctx, node))
  let parent: AuthoringNode | undefined = node
  while (parent) {
    const expression = expressionOf(ctx, parent)
    const routes = ((expression && viewCallChain(expression)?.modifiers) ?? []).filter(call => member(call) === 'navigationDestination' && call.trailingClosure && call.args.some(arg => arg.label === 'for'))
    const matching = routes.filter(route => {
      const argument = route.args.find(arg => arg.label === 'for')?.value
      return argument?.kind === 'memberAccess' && argument.base?.kind === 'identifier' && argument.base.name === valueType
    })
    if (matching.length === 1) return matching[0]
    if (!valueType && routes.length === 1) return routes[0]
    if (matching.length > 1) return undefined
    parent = ctx.nodes.find(item => item.id === parent!.parentId)
  }
}
function siteFor(ctx: FeatureContext, node: AuthoringNode): Site | undefined {
  if (node.name === 'NavigationLink') {
    const call = callOf(ctx, node)
    if (!call) return undefined
    const direct = call.args.find(arg => arg.label === 'destination')?.value
    const label = call.args.find(arg => arg.label === 'label')
    const closure = direct?.kind === 'closure' ? direct : label ? call.trailingClosure ?? undefined : undefined
    if (direct || closure) return { node, call, destination: closure ? singleExpression(closure) : direct, closure, scope: 'link', ...(closure && !singleExpression(closure) ? { reason: 'This destination contains control flow. Edit its Swift to preserve that logic.' } : {}) }
    const value = call.args.find(arg => arg.label === 'value')?.value
    if (value) {
      const route = routeFor(ctx, node, value)
      return { node, call, value, route, destination: singleExpression(route?.trailingClosure ?? undefined), scope: 'link' }
    }
    return { node, scope: 'link', reason: 'This NavigationLink overload needs to be edited in Swift.' }
  }
  if (node.kind !== 'branch' || !['Destination', 'Sheet', 'Full screen cover'].includes(node.name)) return undefined
  const parent = ctx.nodes.find(item => item.id === node.parentId)
  const route = allCalls(ctx).find(call => call.trailingClosure && same(call.trailingClosure.span, node.source) && ['navigationDestination', 'sheet', 'fullScreenCover'].includes(member(call)))
  if (!route?.trailingClosure) return parent?.name === 'NavigationLink' ? siteFor(ctx, parent) : undefined
  const destination = singleExpression(route.trailingClosure)
  return { node, route, closure: route.trailingClosure, destination, scope: member(route) === 'navigationDestination' ? 'shared-route' : 'presentation', ...(!destination ? { reason: 'This destination contains control flow. Edit its Swift to preserve that logic.' } : {}) }
}
function currentExpression(ctx: FeatureContext, site: Site): string {
  const destination = site.destination
  if (!destination) return ''
  let text = raw(ctx, destination.span)
  if (!site.value || !site.route?.trailingClosure) return text
  const parameter = site.route.trailingClosure.params[0]?.name ?? '$0'
  const replacement = raw(ctx, site.value.span)
  const edits: SourceSpan[] = []
  const visit = (item: Node) => {
    if (item.kind === 'closure' && item.params.some(param => param.name === parameter)) return
    if (item.kind === 'identifier' && item.name === parameter) edits.push(item.span)
    forEachChild(item, visit)
  }
  visit(destination)
  for (const span of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, span.start - destination.span.start) + replacement + text.slice(span.end - destination.span.start)
  return text
}
function parameters(ctx: FeatureContext, declaration: StructDecl): NavigationDestination['requirements'] | undefined {
  if (declaration.generics.length || declaration.isReference) return undefined
  const initializers = declaration.members.filter(member => member.kind === 'initDecl')
  if (initializers.length > 1 || initializers.some(initializer => initializer.modifiers.some(modifier => ['private', 'fileprivate'].includes(modifier.name)) || initializer.params.some(parameter => parameter.isInout || parameter.isVariadic))) return undefined
  if (initializers.length) return initializers[0]!.params.map(param => ({ name: param.externalName === '_' ? '' : param.externalName ?? param.internalName, type: param.type ? raw(ctx, param.type.span).replace(/\s/g, '') : '?', required: !param.defaultValue }))
  const fields = declaration.members.filter((member): member is VarDecl => member.kind === 'varDecl' && !member.accessor && !member.modifiers.some(modifier => modifier.name === 'static') && !(member.isLet && member.initializer) && !member.attributes.some(attribute => wrappedState.has(attribute.name)))
  if (fields.some(field => field.modifiers.some(modifier => ['private', 'fileprivate'].includes(modifier.name)))) return undefined
  return fields.map(field => ({ name: field.name, type: field.attributes.some(attribute => attribute.name === 'Binding') ? `Binding<${typeName(ctx, field) ?? '?'}>` : typeName(ctx, field) ?? (field.initializer ? inferType(ctx, field.initializer, new Map()) : undefined) ?? '?', required: !field.initializer }))
}
function parseDestination(text: string): Expr | undefined {
  const parsed = Parser.parse(`let __destination = ${text}`, '__navigation_destination.swift')
  const declaration = parsed.sourceFile.declarations[0]
  return !parsed.diagnostics.some(d => d.severity === 'error') && parsed.sourceFile.declarations.length === 1 && declaration?.kind === 'varDecl' ? declaration.initializer ?? undefined : undefined
}
function argumentText(text: string, expression: Expr): string { return text.slice(expression.span.start - 'let __destination = '.length, expression.span.end - 'let __destination = '.length) }
function argumentsIssue(ctx: FeatureContext, base: CallExpr, requirements: NavigationDestination['requirements'], bindings: Bindings, depth = 0): string | undefined {
  if (depth > 8) return 'This value is too complex to validate in Settings.'
  const used = new Set<number>()
  let previousIndex = -1
  for (const argument of base.args) {
    const index = requirements.findIndex((requirement, index) => !used.has(index) && requirement.name === (argument.label ?? ''))
    const requirement = requirements[index]
    if (!requirement) return `Unexpected argument ${argument.label ?? ''}.`
    if (index <= previousIndex) return 'Keep destination arguments in their declared order.'
    previousIndex = index
    used.add(index)
    const enumCase = argument.value.kind === 'memberAccess' && (!argument.value.base || argument.value.base.kind === 'identifier' && argument.value.base.name === requirement.type) && enumCases(ctx, requirement.type)?.includes(argument.value.member)
    const actual = inferType(ctx, argument.value, bindings, depth + 1)
    if (!enumCase && (!actual || actual !== requirement.type && !(actual === 'Int' && ['Double', 'CGFloat'].includes(requirement.type)) && !(actual === 'nil' && requirement.type.endsWith('?')) && !(requirement.type.endsWith('?') && actual === requirement.type.slice(0, -1)))) return `Supply an available ${requirement.type} value for ${requirement.name || 'this argument'}.`
  }
  for (const [index, requirement] of requirements.entries()) if (requirement.required && !used.has(index)) return `requires ${requirement.name || 'an argument'} (${requirement.type}).`
  return undefined
}
function validateDestination(ctx: FeatureContext, node: AuthoringNode, text: string): { name: string; expression: Expr } {
  const expression = parseDestination(text)
  const base = expression && viewCallChain(expression)?.base
  const name = viewName(expression)
  const declaration = name ? namedStruct(ctx, name) : undefined
  if (!expression || !base || !declaration?.inherits.some(type => ['View', 'SwiftUI.View'].includes(type.name))) throw new Error('Choose a local screen view or type its complete View expression.')
  if (name === node.owner) throw new Error('Choose another screen; this destination would recursively create the current view.')
  const requirements = parameters(ctx, declaration)
  if (!requirements || base.trailingClosure) throw new Error('This screen initializer needs explicit configuration in Swift.')
  const issue = argumentsIssue(ctx, base, requirements, lexicalBindings(ctx, node))
  if (issue) throw new Error(`${name}: ${issue}`)
  return { name: name!, expression }
}
function destinationChoices(ctx: FeatureContext, site: Site, current: string): NavigationDestination[] {
  const bindings = lexicalBindings(ctx, site.node)
  const result: NavigationDestination[] = []
  const parsedCurrent = parseDestination(current), currentBase = parsedCurrent && viewCallChain(parsedCurrent)?.base
  for (const declaration of ctx.ast.flatMap(file => file.declarations).filter((item): item is StructDecl => item.kind === 'structDecl' && item.inherits.some(type => ['View', 'SwiftUI.View'].includes(type.name)))) {
    if (!namedStruct(ctx, declaration.name) || declaration.name === site.node.owner) continue
    const requirements = parameters(ctx, declaration) ?? []
    const arguments_: string[] = []
    for (const requirement of requirements.filter(requirement => requirement.required)) {
      const old = currentBase?.args.find(argument => argument.label === requirement.name)
      const oldText = old ? argumentText(current, old.value) : undefined
      const matching = [...bindings].filter(([, type]) => type === requirement.type)
      const value = oldText && inferType(ctx, old!.value, bindings) === requirement.type ? oldText : bindings.get(requirement.name) === requirement.type ? requirement.name : matching.length === 1 ? matching[0]![0] : undefined
      arguments_.push(`${requirement.name ? requirement.name + ': ' : ''}${value ?? '<' + requirement.type + '>'}`)
    }
    const candidates = [current && viewName(parsedCurrent) === declaration.name ? current : '', `${declaration.name}(${arguments_.join(', ')})`, ...ctx.nodes.filter(node => node.kind === 'component' && node.name === declaration.name).map(node => { const call = callOf(ctx, node); return call ? raw(ctx, call.span) : '' })].filter(Boolean)
    let added = false
    for (const expression of [...new Set(candidates)]) {
      try {
        validateDestination(ctx, site.node, expression)
        result.push({ title: friendly(declaration.name), expression, viewName: declaration.name, requirements, available: true, ...(expression === current && site.destination ? { source: site.destination.span } : {}) })
        added = true
      } catch { /* The scene may require data unavailable at this link. */ }
    }
    if (!added) result.push({ title: friendly(declaration.name), expression: `${declaration.name}(${arguments_.join(', ')})`, viewName: declaration.name, requirements, available: false, reason: requirements.some(item => item.required) ? `Needs ${requirements.filter(item => item.required).map(item => `${item.name}: ${item.type}`).join(', ')}` : 'This initializer needs configuration in Swift.' })
  }
  return result
}
export function navigationSettings(ctx: FeatureContext, node: AuthoringNode): NavigationSettings | undefined {
  const site = siteFor(ctx, node)
  if (!site) return undefined
  const destination = currentExpression(ctx, site)
  const name = viewName(parseDestination(destination))
  return { destination, display: name ? friendly(name) : site.value ? 'Value-based destination' : 'Configured destination', destinations: destinationChoices(ctx, site, destination), editable: !site.reason, reason: site.reason, scope: site.scope, scopeDescription: site.scope === 'shared-route' ? 'Changes every link using this destination rule.' : site.scope === 'presentation' ? 'Changes this presented screen.' : site.value ? 'Changes this link only. Other links keep their destination rule.' : 'Changes this link only.' }
}
export function configureNavigationTarget(ctx: FeatureContext, node: AuthoringNode, destination: string): SourcePatch[] {
  const site = siteFor(ctx, node)
  if (!site) throw new Error('Select a navigation link or destination setting.')
  if (site.reason) throw new Error(site.reason)
  const text = destination.trim()
  if (!text || text.length > 10_000) throw new Error('Enter one complete destination view expression.')
  validateDestination(ctx, site.node, text)
  if (currentExpression(ctx, site).trim() === text) return []
  if (site.value && site.call) {
    const argument = site.call.args.find(argument => argument.label === 'value')!
    if (!argument.labelSpan || hasComments(ctx, argument.value.span)) throw new Error('This value contains comments. Edit the destination in Swift to preserve them.')
    return [patch(argument.labelSpan, 'destination'), patch(argument.value.span, text)]
  }
  const target = site.destination?.span
  if (!target) throw new Error('This destination contains custom logic. Edit it in Swift.')
  if (hasComments(ctx, target)) throw new Error('This destination contains comments. Edit it in Swift to preserve them.')
  return [patch(target, text)]
}
