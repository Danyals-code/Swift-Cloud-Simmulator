import { Lexer, type CallExpr, type StructDecl } from '@studio/swift-syntax'
import { deploymentVersion, isHelperDefinition, tappableProblem } from '@studio/shared'
import type { AuthoringNode, BehaviorAction, BehaviorSettings, DesignValue, StateInput } from '@studio/shared'
import { allDeclarations, callOf, expressionOf, hasComments, identifier, insertMember, layerById, literal, modifierIndent, namedStruct, ownerOf, patch, raw, scalarType, shadowsMember, signature, swiftValue, validScalar, type FeatureContext, type SourcePatch } from './authoring-context'
import { collectionFor, recordsSwift } from './authoring-collections'
import { enumCases, namedActions } from './authoring-components'
import { styleExpression } from './authoring-resources'
import { insideNavigationStack } from './authoring-navigation'
import { appRoot } from './authoring-navigation-app'
import { viewCallChain } from './design-controls'

export function stateInputs(ctx: FeatureContext, node: AuthoringNode): StateInput[] {
  // A helper is written inside its view, whose own definition reads the view's states (Wave 3a).
  if (isHelperDefinition(node)) return []
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
/** Whether a new value named `name` on `owner` would clash with a member of it, a type, or a local the view sees. */
function nameTaken(ctx: FeatureContext, node: AuthoringNode, owner: StructDecl | undefined, name: string): boolean {
  return shadowsMember(ctx, node, name) || !!owner?.members.some(m => 'name' in m && m.name === name) || allDeclarations(ctx).some(d => 'name' in d && d.name === name)
}

/** What Apple's examples call a control's value, by what it holds. */
const VALUE_NAMES: Readonly<Record<string, string>> = { Bool: 'isOn', String: 'text', Double: 'value', Int: 'count', Date: 'date', Color: 'color' }

/**
 * The name a new value for a `control` on `node`'s screen takes (D13): what it holds, as
 * Apple's examples name it, or a Picker's `selection`, numbered past every name taken. The
 * canvas binds a library control to it, and Saves to offers it first.
 */
function newValueName(ctx: FeatureContext, node: AuthoringNode, control: string, type: string): string {
  const owner = ownerOf(ctx, node), base = control === 'Picker' ? 'selection' : VALUE_NAMES[type] ?? 'value'
  let name = base
  for (let suffix = 2; nameTaken(ctx, node, owner, name); suffix++) name = base + suffix
  return name
}

export function behaviorSettings(ctx: FeatureContext, node: AuthoringNode): BehaviorSettings | undefined {
  const call = callOf(ctx, node)
  if (!call) return undefined
  const label = node.name === 'Toggle' ? 'isOn' : ['TextField', 'SecureField', 'TextEditor'].includes(node.name) ? 'text' : ['Picker', 'DatePicker', 'ColorPicker'].includes(node.name) ? 'selection' : ['Slider', 'Stepper'].includes(node.name) ? 'value' : undefined
  const argument = label && call.args.find(a => a.label === label)
  const inputs = stateInputs(ctx, node)
  const bindingState = argument && inputs.find(s => raw(ctx, argument.value.span) === '$' + s.name)
  const type = label === 'text' ? 'String' : label === 'isOn' ? 'Bool' : bindingState?.type ?? (node.name === 'Slider' ? 'Double' : node.name === 'DatePicker' ? 'Date' : node.name === 'ColorPicker' ? 'Color' : 'Int')
  const collections = node.name === 'Button' ? collectionLayers(ctx, node.owner).flatMap(n => { const c = collectionFor(ctx, n); return c ? [c] : [] }).filter((c, i, a) => a.findIndex(other => other.name === c.name) === i) : []
  const withTitle = node.name === 'Button' && call.args.length === 1 && call.args[0]?.label === null
  const canConfigureAction = (withTitle || labelledButton(call)) && !!call.trailingClosure && call.trailingClosure.params.length === 0
  // Any other view When tapped can make tappable, as a card or a row is (D16).
  const canMakeTappable = !canConfigureAction && !tappableProblem(ctx.nodes, node)
  const site = deploymentVersion(ctx.deploymentTarget) < 15 ? { problem: 'An appear animation needs an iOS 15 deployment target.' } : appearSite(ctx, node)
  const appear = 'problem' in site ? { problem: site.problem } : { by: site.by }
  return { appear, states: inputs, dependencies: stateDependencies(ctx, node.owner, inputs), collections, actions: node.name === 'Button' ? namedActions(ctx, node).map(f => f.name) : [], destinations: node.name === 'Button' || canMakeTappable ? tapDestinations(ctx, node) : [], canConfigureAction, canMakeTappable, titled: withTitle && call.args[0]!.value.kind === 'stringLiteral', currentAction: node.name === 'Button' && call.trailingClosure ? raw(ctx, call.trailingClosure.body.span) : undefined, binding: argument ? { label, type, current: raw(ctx, argument.value.span), newName: newValueName(ctx, node, node.name, type) } : undefined }
}

/** Each owner's collection layers, in their order: every Button asks for its own owner's. */
const collectionCache = new WeakMap<FeatureContext, Map<string, AuthoringNode[]>>()
function collectionLayers(ctx: FeatureContext, owner: string): readonly AuthoringNode[] {
  let byOwner = collectionCache.get(ctx)
  if (!byOwner) {
    collectionCache.set(ctx, byOwner = new Map())
    for (const layer of ctx.nodes) {
      if (layer.kind !== 'collection') continue
      const owned = byOwner.get(layer.owner)
      if (owned) owned.push(layer)
      else byOwner.set(layer.owner, [layer])
    }
  }
  return byOwner.get(owner) ?? []
}

/** The objects a view reads from its surroundings, by type. */
const environmentObjects = (ctx: FeatureContext, decl: StructDecl | undefined) => decl?.members.flatMap(m => m.kind === 'varDecl' && m.typeAnnotation && m.attributes.some(a => a.name === 'EnvironmentObject') ? [raw(ctx, m.typeAnnotation.span).replace(/\s/g, '')] : []) ?? []
const screenCache = new WeakMap<FeatureContext, { root?: string; screens: { name: string; reads: string[] }[]; opened: Map<string, Map<StructDecl | undefined, string[]>>; reachable: Map<string, string[]> }>()
/**
 * The screens a tap on `node` can open: made with no values, or needing only an object
 * its own screen reads from its surroundings, which a pushed or presented screen
 * inherits. Never the view the app's window shows, which holds every screen, and never
 * the screen the tap is on.
 */
function tapDestinations(ctx: FeatureContext, node: AuthoringNode): readonly string[] {
  let cached = screenCache.get(ctx)
  if (!cached) {
    const standalone = (d: StructDecl) => !d.generics.length && !d.members.some(m => m.kind === 'initDecl' || m.kind === 'varDecl' && !m.accessor && !m.initializer && !m.attributes.some(a => ['State', 'Environment', 'EnvironmentObject'].includes(a.name)))
    const screens = ctx.ast.flatMap(f => f.declarations).flatMap(d => d.kind === 'structDecl' && d.inherits.some(t => t.name === 'View') && standalone(d) && namedStruct(ctx, d.name) === d ? [{ name: d.name, reads: environmentObjects(ctx, d) }] : [])
    cached = { root: appRoot(ctx), screens, opened: new Map(), reachable: new Map() }
    screenCache.set(ctx, cached)
  }
  // The same for every view of a screen, so worked out once for each: a list of every screen for each view was quadratic.
  const owner = ownerOf(ctx, node), byOwner = cached.opened.get(node.owner) ?? new Map<StructDecl | undefined, string[]>()
  cached.opened.set(node.owner, byOwner)
  let opened = byOwner.get(owner)
  if (!opened) {
    // The screens open to every view that reads the same objects, less the view's own.
    const around = new Set(environmentObjects(ctx, owner)), key = JSON.stringify([...around].sort())
    let reachable = cached.reachable.get(key)
    if (!reachable) cached.reachable.set(key, reachable = cached.screens.filter(screen => screen.name !== cached.root && screen.reads.every(type => around.has(type))).map(screen => screen.name))
    opened = reachable.filter(name => name !== node.owner)
    byOwner.set(owner, opened)
  }
  return opened
}

/** `Button { … } label: { … }`: the action is the trailing closure, and what it shows is its label (D16). */
function labelledButton(call: CallExpr): boolean {
  return call.callee.kind === 'identifier' && call.callee.name === 'Button' && call.args.length === 1 && call.args[0]!.label === 'label' && call.args[0]!.value.kind === 'closure'
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
    if (nameTaken(ctx, node, owner, name)) throw new Error('This state name is already declared.')
    const type = settings.binding.type
    let expression: string
    // No value is today, written as Apple writes it (D13); a day chosen is that day.
    if (type === 'Date' && create.value === null) expression = 'Date()'
    else if (type === 'Date' && typeof create.value === 'number' && Number.isFinite(create.value)) expression = `Date(timeIntervalSince1970: ${create.value})`
    else if (type === 'Color' && typeof create.value === 'string') expression = styleExpression('color', create.value)
    else { if (!['String', 'Bool', 'Int', 'Double'].includes(type) || !validScalar(create.value, { type: type as 'String' | 'Bool' | 'Int' | 'Double', optional: false })) throw new Error('The initial value does not match this control’s binding type.'); expression = swiftValue(create.value) }
    patches.push(insertMember(ctx, owner, `@State private var ${name}: ${type} = ${expression}`))
  } else {
    const state = namedState(ctx, node, name)
    if (state.optional || state.type !== settings.binding.type) throw new Error('The chosen state must be nonoptional and match this control’s type.')
  }
  return patches
}
/** The type of the value a library control is bound to, by the constant it is written with. */
const LIVE_CONTROL_TYPES: Readonly<Record<string, (value: string) => string | null>> = {
  Toggle: () => 'Bool',
  TextField: () => 'String',
  Slider: () => 'Double',
  Stepper: value => (/^-?\d+$/.test(value) ? 'Int' : 'Double'),
  Picker: value => (/^-?\d+$/.test(value) ? 'Int' : /^".*"$/.test(value) ? 'String' : null),
  DatePicker: () => 'Date',
  ColorPicker: () => 'Color',
}

/** Whether a view added at `node` goes into a row design: inside one, or into the rows of the list or Repeat selected. */
function addsToRows(ctx: FeatureContext, node: AuthoringNode): boolean {
  if (ctx.nodes.some(n => n.parentId === node.id && n.kind === 'template')) return true
  for (let item: AuthoringNode | undefined = node; item; item = ctx.nodes.find(n => n.id === item!.parentId)) if (item.kind === 'template') return true
  return false
}

/**
 * A control from the library, bound to a new value on its screen rather than to the
 * constant it is written with, so it switches, slides and takes typing in the preview
 * at once (D13). A control added to a list's rows keeps its constant, as one value would
 * switch every row together: Saves to binds it to the row's field. Null when the
 * snippet is not such a control.
 */
export function liveControl(ctx: FeatureContext, node: AuthoringNode, snippet: string): { readonly snippet: string; readonly member: SourcePatch; readonly declaration: string } | null {
  const control = /^[A-Za-z]+/.exec(snippet)?.[0] ?? '', typeOf = LIVE_CONTROL_TYPES[control]
  const at = snippet.indexOf('.constant(')
  if (!typeOf || at < 0 || addsToRows(ctx, node)) return null
  let depth = 0, close = at + '.constant('.length
  for (; close < snippet.length; close++) {
    if (snippet[close] === '(') depth++
    else if (snippet[close] === ')' && depth-- === 0) break
  }
  const value = snippet.slice(at + '.constant('.length, close).trim()
  const type = typeOf(value)
  const owner = ownerOf(ctx, node)
  if (!type || !owner) return null
  const name = newValueName(ctx, node, control, type)
  const declaration = `@State private var ${name}: ${type} = ${value}`
  return { snippet: snippet.slice(0, at) + '$' + name + snippet.slice(close + 1), member: insertMember(ctx, owner, declaration), declaration }
}

export function configureAction(ctx: FeatureContext, node: AuthoringNode, action: BehaviorAction, replace: boolean): SourcePatch[] {
  const settings = behaviorSettings(ctx, node), call = callOf(ctx, node), owner = ownerOf(ctx, node)
  if (!settings?.canConfigureAction || !call?.trailingClosure || !owner) throw new Error('Select a Button with a title or a label, and one action closure.')
  if ((call.trailingClosure.body.statements.length || hasComments(ctx, call.trailingClosure.span)) && !replace) throw new Error('Review the existing action and explicitly choose Replace action before changing it.')
  const patches: SourcePatch[] = []
  let body = ''
  if (action.type === 'dismiss' && !action.state) {
    if (deploymentVersion(ctx.deploymentTarget) < 15) throw new Error('Environment dismissal requires an iOS 15 deployment target.')
    const existing = owner.members.find(m => m.kind === 'varDecl' && m.attributes.some(a => a.name === 'Environment' && a.args.some(arg => raw(ctx, arg.value.span) === '\\.dismiss')))
    // `dismiss`, as Apple writes it (D13).
    let name = existing?.kind === 'varDecl' ? existing.name : 'dismiss'
    if (!existing) {
      let suffix = 2
      while (owner.members.some(m => 'name' in m && m.name === name)) name = 'dismiss' + suffix++
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
      if (!insideNavigationStack(ctx.nodes, node)) throw new Error('Place this Button inside a NavigationStack before configuring navigation.')
      // A card stays the link's label, as `NavigationLink { Detail() } label: { … }` writes it (D16).
      const label = call.args[0]!
      if (label.label === 'label' && label.labelSpan) return [{ file: call.span.file, start: call.span.start, end: label.labelSpan.start, text: `NavigationLink { ${action.destination}() } ` }]
      return [patch(call.span, `NavigationLink(${raw(ctx, label.value.span)}, destination: ${action.destination}())`)]
    }
    const expression = expressionOf(ctx, node)!
    if (viewCallChain(expression)?.modifiers.some(m => m.callee.kind === 'memberAccess' && ['sheet', 'fullScreenCover'].includes(m.callee.member))) throw new Error('This view already presents a screen. Change that Navigate to instead.')
    let name = 'is' + action.destination + 'Presented', suffix = 2
    while (owner.members.some(m => 'name' in m && m.name === name)) name = 'is' + action.destination + 'Presented' + suffix++
    patches.push(insertMember(ctx, owner, `@State private var ${name}: Bool = false`))
    // On a line of its own under the view, indented as a modifier is (D13).
    const modifier = `.${action.type === 'cover' ? 'fullScreenCover' : 'sheet'}(isPresented: $${name}) { ${action.destination}() }`
    patches.push({ file: node.source.file, start: node.source.end, end: node.source.end, text: `\n${modifierIndent(ctx, node)}${modifier}` })
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
/**
 * How a view comes and goes, which is when a transition plays: by an if or a switch, or as
 * a row a collection adds. `owner` is the ancestor that stays while it does, where the
 * animation goes, and `value` what it animates on for rows.
 */
function appearSite(ctx: FeatureContext, node: AuthoringNode): { by: 'branch' | 'row'; owner: AuthoringNode; value?: string } | { problem: string } {
  const expression = expressionOf(ctx, node), chain = expression && viewCallChain(expression)
  if (!chain || chain.modifiers.some(m => m.callee.kind === 'memberAccess' && ['animation', 'transition'].includes(m.callee.member))) return { problem: 'Existing animation code is developer-owned. Edit it in Swift.' }
  let parent = layerById(ctx, node.parentId), inserted: AuthoringNode | undefined, owner = node
  while (parent && parent.kind !== 'definition') {
    if (!inserted && (parent.kind === 'branch' && ['Condition', 'Otherwise', 'Switch'].includes(parent.name) || parent.kind === 'template')) inserted = parent
    // A ForEach lays nothing out, so a modifier on it would land on every row.
    if (inserted && parent.kind !== 'template' && parent.name !== 'ForEach' && expressionOf(ctx, parent)) { owner = parent; break }
    parent = layerById(ctx, parent.parentId)
  }
  if (!inserted) return { problem: APPEAR_ALWAYS_SHOWN }
  if (owner === node) return { problem: 'An appear animation needs a container that stays while this view comes and goes. Put it in a stack first.' }
  if (viewCallChain(expressionOf(ctx, owner)!)?.modifiers.some(m => m.callee.kind === 'memberAccess' && m.callee.member === 'animation')) return { problem: 'The enclosing container already controls animation. Preserve it and add the transition in Swift.' }
  if (inserted.kind !== 'template') return { by: 'branch', owner }
  // Rows come and go as their collection does: its count changes with every row added or removed.
  const collection = layerById(ctx, inserted.parentId), data = collection && callOf(ctx, collection)?.args[0]?.value
  const name = data && /^\$?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(raw(ctx, data.span)) ? raw(ctx, data.span).replace(/^\$/, '') : undefined
  const fixed = data?.kind === 'identifier' && ownerOf(ctx, node)?.members.some(m => m.kind === 'varDecl' && m.name === name && m.isLet && !!m.initializer)
  if (!name || fixed) return { problem: 'An appear animation on rows plays as rows are added or removed, and these rows are fixed in the code rather than read from a collection that changes, such as ForEach(items). Add it in Code.' }
  return { by: 'row', owner, value: `${name}.count` }
}
export function configureTransition(ctx: FeatureContext, node: AuthoringNode, state: string, style: 'opacity' | 'slide' | 'scale', duration: number): SourcePatch[] {
  if (deploymentVersion(ctx.deploymentTarget) < 15) throw new Error('Value-driven animation requires an iOS 15 deployment target.')
  if (!['opacity', 'slide', 'scale'].includes(style) || !Number.isFinite(duration) || duration < 0 || duration > 2) throw new Error('Use a supported transition and a duration from 0 to 2 seconds.')
  const site = appearSite(ctx, node)
  if ('problem' in site) throw new Error(site.problem)
  if (site.by === 'branch') namedState(ctx, node, state)
  // Keep the animation transaction on a surviving ancestor; a removed child cannot
  // observe the state change that should animate its exit.
  const animation = `.animation(.easeInOut(duration: ${duration}), value: ${site.value ?? state})`
  const transition: SourcePatch = { file: node.source.file, start: node.source.end, end: node.source.end, text: `.transition(.${style})` }
  return [transition, { file: site.owner.source.file, start: site.owner.source.end, end: site.owner.source.end, text: animation }]
}
/** Why an appear animation does not apply to a view that is always there. */
const APPEAR_ALWAYS_SHOWN = 'An appear animation plays when a view is added or removed, and this view is always shown. Use it on a view inside an if or a switch, or on the rows of a collection.'
