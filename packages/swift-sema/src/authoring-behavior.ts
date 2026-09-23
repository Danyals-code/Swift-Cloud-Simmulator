import { Lexer } from '@studio/swift-syntax'
import { deploymentVersion } from '@studio/shared'
import type { AuthoringNode, BehaviorAction, BehaviorSettings, DesignValue, StateInput } from '@studio/shared'
import { allDeclarations, callOf, expressionOf, hasComments, identifier, insertMember, literal, ownerOf, patch, raw, scalarType, shadowsMember, signature, swiftValue, validScalar, type FeatureContext, type SourcePatch } from './authoring-context'
import { collectionFor, recordsSwift } from './authoring-collections'
import { emptyComponents, enumCases, namedActions } from './authoring-components'
import { styleExpression } from './authoring-resources'
import { viewCallChain } from './design-controls'

export function stateInputs(ctx: FeatureContext, node: AuthoringNode): StateInput[] {
  const owner = ownerOf(ctx, node)
  if (!owner) return []
  return owner.members.flatMap((member): StateInput[] => {
    if (member.kind !== 'varDecl' || member.isLet || member.accessor || member.setter || member.observers || member.attributes.length !== 1 || member.attributes[0]?.name !== 'State' || !member.initializer) return []
    const simple = scalarType(member.typeAnnotation, member.initializer)
    const options = member.typeAnnotation?.kind === 'namedType' ? enumCases(ctx, member.typeAnnotation.name) : undefined
    const value = simple ? literal(ctx, member.initializer) : options && member.initializer.kind === 'memberAccess' && options.includes(member.initializer.member) ? member.initializer.member : undefined
    const annotation = member.typeAnnotation?.kind === 'namedType' ? member.typeAnnotation.name : undefined
    const initializer = member.initializer
    const nameOf = (e: typeof initializer): string | undefined => e.kind === 'identifier' ? e.name : e.kind === 'memberAccess' ? e.member : undefined
    const inferredType = (expr: typeof initializer): string | undefined => {
      if (expr.kind === 'call') {
        if (expr.callee.kind === 'identifier') return expr.callee.name
        if (expr.callee.kind === 'memberAccess' && expr.callee.base) {
          if (['opacity', 'addingTimeInterval'].includes(expr.callee.member)) return inferredType(expr.callee.base)
          if (expr.callee.base.kind === 'identifier' && ['Foundation', 'SwiftUI'].includes(expr.callee.base.name)) return expr.callee.member
        }
      }
      if (expr.kind === 'memberAccess' && expr.base) return nameOf(expr.base)
      return undefined
    }
    const inferred = inferredType(initializer)
    const special = annotation ?? inferred
    if ((special === 'Date' || special === 'Color') && !allDeclarations(ctx).some(d => 'name' in d && d.name === special)) {
      // The type makes a direct state binding safe. Evaluating its initial value is
      // a separate capability: null keeps computed defaults owned by the source.
      const number = (expr: typeof initializer): number | undefined => {
        const value = raw(ctx, expr.span).replace(/\s/g, '')
        return ['integerLiteral', 'floatLiteral', 'unary'].includes(expr.kind) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : undefined
      }
      let initial: DesignValue = null
      if (special === 'Date' && initializer.kind === 'call') {
        const timestamp = initializer.args.find(a => a.label === 'timeIntervalSince1970')?.value
        if (timestamp) initial = number(timestamp) ?? null
      } else if (special === 'Color') {
        const expression = raw(ctx, initializer.span).replace(/\s/g, '')
        const named = /^(?:(?:SwiftUI\.)?Color)?\.([A-Za-z]+)$/.exec(expression)
        if (named) initial = named[1]!
        else if (initializer.kind === 'call' && ['Color', 'SwiftUI.Color'].includes(raw(ctx, initializer.callee.span))) {
          const components = ['red', 'green', 'blue', 'opacity'].map(label => {
            const arg = initializer.args.find(a => a.label === label)?.value
            return arg ? number(arg) : label === 'opacity' ? 1 : undefined
          })
          if (components.every((v): v is number => v !== undefined && v >= 0 && v <= 1)) initial = '#' + (components[3] === 1 ? components.slice(0, 3) : components).map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
        }
      }
      if (!shadowsMember(ctx, node, member.name)) return [{ owner: node.owner, name: member.name, type: special, value: initial, signature: signature(ctx, member), source: member.initializer.span }]
    }
    const type = simple?.type ?? (member.typeAnnotation?.kind === 'namedType' ? member.typeAnnotation.name : undefined)
    if (shadowsMember(ctx, node, member.name) || !type || value === undefined || simple && !validScalar(value, simple)) return []
    return [{ owner: node.owner, name: member.name, type, value, optional: simple?.optional, signature: signature(ctx, member), options, source: member.initializer.span }]
  })
}
const dependencyCache = new WeakMap<FeatureContext, Map<string, Map<string, Set<string>>>>()
function stateDependencies(ctx: FeatureContext, owner: string, inputs: readonly StateInput[]) {
  let owners = dependencyCache.get(ctx)
  if (!owners) {
    owners = new Map()
    for (const layer of ctx.nodes) {
      if (!['view', 'component', 'collection'].includes(layer.kind)) continue
      const values = owners.get(layer.owner) ?? new Map<string, Set<string>>()
      for (const property of layer.properties) {
        if (!['data-binding', 'computed'].includes(property.valueKind) || property.expression.trim().startsWith('{')) continue
        const tokens = Lexer.tokenize(property.expression, layer.source.file).tokens
        tokens.forEach((token, index) => {
          if (token.kind !== 'identifier' || tokens[index - 1]?.text === '.' && tokens[index - 2]?.text !== 'self') return
          const name = token.text.replace(/^\$/, ''), ids = values.get(name) ?? new Set<string>()
          ids.add(layer.id); values.set(name, ids)
        })
      }
      owners.set(layer.owner, values)
    }
    dependencyCache.set(ctx, owners)
  }
  return inputs.map(input => ({ state: input.name, nodeIds: [...(owners.get(owner)?.get(input.name) ?? [])] }))
}
export function behaviorSettings(ctx: FeatureContext, node: AuthoringNode): BehaviorSettings | undefined {
  const call = callOf(ctx, node)
  if (!call) return undefined
  const label = node.name === 'Toggle' ? 'isOn' : ['TextField', 'SecureField', 'TextEditor'].includes(node.name) ? 'text' : ['Picker', 'DatePicker', 'ColorPicker'].includes(node.name) ? 'selection' : ['Slider', 'Stepper'].includes(node.name) ? 'value' : undefined
  const argument = label && call.args.find(a => a.label === label)
  const inputs = stateInputs(ctx, node)
  const bindingState = argument && inputs.find(s => raw(ctx, argument.value.span) === '$' + s.name)
  const collections = node.name === 'Button' ? ctx.nodes.filter(n => n.owner === node.owner && n.kind === 'collection').flatMap(n => { const c = collectionFor(ctx, n); return c ? [c] : [] }).filter((c, i, a) => a.findIndex(other => other.name === c.name) === i) : []
  return { states: inputs, dependencies: stateDependencies(ctx, node.owner, inputs), collections, actions: node.name === 'Button' ? namedActions(ctx, node).map(f => f.name) : [], destinations: node.name === 'Button' ? emptyComponents(ctx).filter(n => n !== node.owner) : [], canConfigureAction: node.name === 'Button' && call.args.length === 1 && call.args[0]?.label === null && !!call.trailingClosure && call.trailingClosure.params.length === 0, currentAction: node.name === 'Button' && call.trailingClosure ? raw(ctx, call.trailingClosure.body.span) : undefined, binding: argument ? { label, type: label === 'text' ? 'String' : label === 'isOn' ? 'Bool' : bindingState?.type ?? (node.name === 'Slider' ? 'Double' : node.name === 'DatePicker' ? 'Date' : node.name === 'ColorPicker' ? 'Color' : 'Int'), current: raw(ctx, argument.value.span) } : undefined }
}
function namedState(ctx: FeatureContext, node: AuthoringNode, name: string): StateInput {
  const input = stateInputs(ctx, node).find(s => s.name === name)
  if (!input) throw new Error('Choose an existing local @State property with a supported type.')
  return input
}
export function configureBinding(ctx: FeatureContext, node: AuthoringNode, name: string, create?: { readonly value: DesignValue }): SourcePatch[] {
  const settings = behaviorSettings(ctx, node), owner = ownerOf(ctx, node), call = callOf(ctx, node)
  if (!settings?.binding || !owner || !call || !identifier(name)) throw new Error('Select an input, toggle or picker and a valid state name.')
  const argument = call.args.find(a => a.label === settings.binding!.label)!
  if (!argument) throw new Error('This binding overload is not supported.')
  // Preserve arbitrary Binding(get:set:) logic; explicit .constant is eligible for replacement.
  const simpleBinding = argument.value.kind === 'identifier' && settings.states.some(s => argument.value.kind === 'identifier' && argument.value.name === '$' + s.name)
  const constant = argument.value.kind === 'call' && argument.value.callee.kind === 'memberAccess' && !argument.value.callee.base && argument.value.callee.member === 'constant'
  if (!simpleBinding && !constant) throw new Error('This binding has developer logic. Wire it in Swift.')
  const patches = [patch(argument.value.span, '$' + name)]
  if (create) {
    if (shadowsMember(ctx, node, name) || owner.members.some(m => 'name' in m && m.name === name) || allDeclarations(ctx).some(d => 'name' in d && d.name === name)) throw new Error('This state name is already declared.')
    const type = settings.binding.type
    let expression: string
    if (type === 'Date' && typeof create.value === 'number' && Number.isFinite(create.value)) expression = `Date(timeIntervalSince1970: ${create.value})`
    else if (type === 'Color' && typeof create.value === 'string') expression = styleExpression('color', create.value)
    else { if (!['String', 'Bool', 'Int', 'Double'].includes(type) || !validScalar(create.value, { type: type as 'String' | 'Bool' | 'Int' | 'Double', optional: false })) throw new Error('The initial value does not match this control’s binding type.'); expression = swiftValue(create.value) }
    patches.push(insertMember(ctx, owner, `@State private var ${name}: ${type} = ${expression}`))
  } else {
    const state = namedState(ctx, node, name)
    if (state.optional || state.type !== settings.binding.type) throw new Error('The chosen state must be nonoptional and match this control’s type.')
  }
  return patches
}
export function configureAction(ctx: FeatureContext, node: AuthoringNode, action: BehaviorAction, replace: boolean): SourcePatch[] {
  const settings = behaviorSettings(ctx, node), call = callOf(ctx, node), owner = ownerOf(ctx, node)
  if (!settings?.canConfigureAction || !call?.trailingClosure || !owner) throw new Error('Select a Button with a title and one action closure.')
  if ((call.trailingClosure.body.statements.length || hasComments(ctx, call.trailingClosure.span)) && !replace) throw new Error('Review the existing action and explicitly choose Replace action before changing it.')
  const patches: SourcePatch[] = []
  let body = ''
  if (action.type === 'dismiss' && !action.state) {
    if (deploymentVersion(ctx.deploymentTarget) < 15) throw new Error('Environment dismissal requires an iOS 15 deployment target.')
    const existing = owner.members.find(m => m.kind === 'varDecl' && m.attributes.some(a => a.name === 'Environment' && a.args.some(arg => raw(ctx, arg.value.span) === '\\.dismiss')))
    let name = existing?.kind === 'varDecl' ? existing.name : 'dismissPresentedView'
    if (!existing) {
      let suffix = 2
      while (owner.members.some(m => 'name' in m && m.name === name)) name = 'dismissPresentedView' + suffix++
      patches.push(insertMember(ctx, owner, `@Environment(\\.dismiss) private var ${name}`))
    }
    if (shadowsMember(ctx, node, name)) throw new Error('The dismiss action is shadowed by a local declaration.')
    body = `${name}()`
  } else if (action.type === 'toggle' || action.type === 'dismiss' || action.type === 'set') {
    const input = namedState(ctx, node, action.state)
    if (action.type !== 'set' && (input.type !== 'Bool' || input.optional)) throw new Error('Toggle and dismiss require nonoptional Boolean state.')
    if (action.type === 'toggle') body = `${input.name}.toggle()`
    else if (action.type === 'dismiss') body = `${input.name} = false`
    else {
      if (input.options ? typeof action.value !== 'string' || !input.options.includes(action.value) : !validScalar(action.value, { type: input.type as 'String' | 'Int' | 'Double' | 'Bool', optional: input.optional ?? false })) throw new Error('The action value does not match the state type.')
      body = `${input.name} = ${input.options ? '.' + action.value : swiftValue(action.value)}`
    }
  } else if (action.type === 'call') {
    if (!settings.actions.includes(action.name)) throw new Error('The named action is missing, recursive, async, throwing, or needs parameters. Open its source to adapt its interface.')
    body = action.name + '()'
  } else if (action.type === 'navigate' || action.type === 'sheet' || action.type === 'cover') {
    if (!settings.destinations.includes(action.destination)) throw new Error('Choose a local View that has a supported no-argument initializer.')
    if (action.type === 'navigate') {
      let parent = ctx.nodes.find(n => n.id === node.parentId)
      while (parent && !['NavigationStack', 'NavigationView'].includes(parent.name)) parent = ctx.nodes.find(n => n.id === parent!.parentId)
      if (!parent) throw new Error('Place this Button inside a NavigationStack before configuring navigation.')
      return [patch(call.span, `NavigationLink(${raw(ctx, call.args[0]!.value.span)}, destination: ${action.destination}())`)]
    }
    const expression = expressionOf(ctx, node)!
    if (viewCallChain(expression)?.modifiers.some(m => m.callee.kind === 'memberAccess' && ['sheet', 'fullScreenCover'].includes(m.callee.member))) throw new Error('This view already presents a screen. Change that Navigate to instead.')
    let name = 'is' + action.destination + 'Presented', suffix = 2
    while (owner.members.some(m => 'name' in m && m.name === name)) name = 'is' + action.destination + 'Presented' + suffix++
    patches.push(insertMember(ctx, owner, `@State private var ${name}: Bool = false`))
    patches.push({ file: node.source.file, start: node.source.end, end: node.source.end, text: `.${action.type === 'cover' ? 'fullScreenCover' : 'sheet'}(isPresented: $${name}) { ${action.destination}() }` })
    body = `${name} = true`
  } else {
    const info = settings.collections.find(c => c.name === action.collection && c.mutable)
    if (!info) throw new Error('Choose a supported local @State collection.')
    if (action.type === 'append') {
      const item = recordsSwift(info, [action.record]).slice(1, -1)
      body = `if !${info.name}.contains(where: { $0.id == ${swiftValue(action.record.id!)} }) { ${info.name}.append(${item}) }`
    } else {
      if (!validScalar(action.id, info.fields.find(f => f.name === 'id')!)) throw new Error('The record id has the wrong type.')
      body = `${info.name}.removeAll { $0.id == ${swiftValue(action.id)} }`
    }
  }
  patches.push(patch(call.trailingClosure.span, `{ ${body} }`))
  return patches
}
export function configureTransition(ctx: FeatureContext, node: AuthoringNode, state: string, style: 'opacity' | 'slide' | 'scale', duration: number): SourcePatch[] {
  if (deploymentVersion(ctx.deploymentTarget) < 15) throw new Error('Value-driven animation requires an iOS 15 deployment target.')
  if (!['opacity', 'slide', 'scale'].includes(style) || !Number.isFinite(duration) || duration < 0 || duration > 2) throw new Error('Use a supported transition and a duration from 0 to 2 seconds.')
  namedState(ctx, node, state)
  const expression = expressionOf(ctx, node), chain = expression && viewCallChain(expression)
  if (!chain || chain.modifiers.some(m => m.callee.kind === 'memberAccess' && ['animation', 'transition'].includes(m.callee.member))) throw new Error('Existing animation code is developer-owned. Edit it in Swift.')
  let parent = ctx.nodes.find(n => n.id === node.parentId), conditional = false, animationOwner = node
  while (parent && parent.kind !== 'definition') {
    if (parent.kind === 'branch' && ['Condition', 'Otherwise', 'Switch'].includes(parent.name)) conditional = true
    if (conditional && expressionOf(ctx, parent)) { animationOwner = parent; break }
    parent = ctx.nodes.find(n => n.id === parent!.parentId)
  }
  if (conditional && animationOwner === node) throw new Error('Wrap this conditional in a Group or stack before configuring its transition.')
  if (animationOwner !== node) {
    const ownerChain = viewCallChain(expressionOf(ctx, animationOwner)!)
    if (ownerChain?.modifiers.some(m => m.callee.kind === 'memberAccess' && m.callee.member === 'animation')) throw new Error('The enclosing container already controls animation. Preserve it and add the transition in Swift.')
  }
  // Keep the animation transaction on a surviving ancestor of a conditional;
  // a removed child cannot observe the state change that should animate its exit.
  const animation = `.animation(.easeInOut(duration: ${duration}), value: ${state})`
  const transition: SourcePatch = { file: node.source.file, start: node.source.end, end: node.source.end, text: `.transition(.${style})` }
  return animationOwner === node ? [{ ...transition, text: transition.text + animation }] : [transition, { file: animationOwner.source.file, start: animationOwner.source.end, end: animationOwner.source.end, text: animation }]
}
