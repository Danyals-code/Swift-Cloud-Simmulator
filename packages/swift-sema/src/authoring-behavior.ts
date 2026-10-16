import { Lexer, type CallExpr, type StructDecl } from '@studio/swift-syntax'
import { deploymentVersion, isHelperDefinition, tappableProblem, swiftIdentifier } from '@studio/shared'
import type { AlertActionSpec, AuthoringNode, BehaviorAction, BehaviorSettings, DesignValue, StateInput } from '@studio/shared'
import { allDeclarations, callOf, enumCases, expressionOf, hasComments, insertMember, layerById, lineIndent, literal, modifierIndent, namedStruct, ownerOf, patch, raw, scalarType, shadowsMember, signature, swiftValue, validScalar, type FeatureContext, type SourcePatch } from './authoring-context'
import { collectionFor, recordsSwift } from './authoring-collections'
import { namedActions } from './authoring-components'
import { styleExpression } from './authoring-resources'
import { insideNavigationStack } from './authoring-navigation'
import { appRoot } from './authoring-navigation-app'
import { screenStateInputs } from './authoring-states'
import { dotOf } from './authoring-modifiers'
import { buttonRole, literalText, swiftString, viewCallChain } from './design-controls'
import { actionClosure, appearSite, readAnimation } from './authoring-motion'

/**
 * The values a view's states can change. A screen's own definition also offers what its
 * conditions read, on it or on a model, with the states they draw (Wave 3b); a view's
 * settings, which bind controls and set values on tap, offer its own `@State` alone.
 */
export function stateInputs(ctx: FeatureContext, node: AuthoringNode): StateInput[] {
  // A helper is written inside its view, whose own definition reads the view's states (Wave 3a).
  if (isHelperDefinition(node)) return []
  if (node.kind !== 'definition') return ownStates(ctx, node)
  // A screen's are worked out once for each model, as its views and its States all ask (Wave 5a).
  let screens = screenInputs.get(ctx)
  if (!screens) screenInputs.set(ctx, screens = new Map())
  let inputs = screens.get(node.id)
  if (!inputs) screens.set(node.id, inputs = screenStateInputs(ctx, node, ownStates(ctx, node)))
  return inputs
}
const screenInputs = new WeakMap<FeatureContext, Map<string, StateInput[]>>()
/** A view's own `@State` scalars, enums, dates and colours, as a state or a control sets them. */
function ownStates(ctx: FeatureContext, node: AuthoringNode): StateInput[] {
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
export function nameTaken(ctx: FeatureContext, node: AuthoringNode, owner: StructDecl | undefined, name: string): boolean {
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
  // A title, with a symbol and a role or not (Wave 4a): `Button("Delete", role: .destructive) { }`.
  const withTitle = node.name === 'Button' && call.args[0]?.label === null && call.args.every((a, i) => !i || a.label === 'systemImage' || a.label === 'role')
  const canConfigureAction = (withTitle || labelledButton(call)) && !!call.trailingClosure && call.trailingClosure.params.length === 0
  // Any other view When tapped can make tappable, as a card or a row is (D16).
  const canMakeTappable = !canConfigureAction && !tappableProblem(ctx.nodes, node)
  const site = appearSite(ctx, node)
  const appear = 'problem' in site ? { problem: site.problem } : { by: site.by }
  const animation = canConfigureAction ? readAnimation(ctx, call.trailingClosure!) : undefined
  return { appear, states: inputs, dependencies: stateDependencies(ctx, node.owner, inputs), collections, actions: node.name === 'Button' ? namedActions(ctx, node).map(f => f.name) : [], destinations: node.name === 'Button' || canMakeTappable ? tapDestinations(ctx, node) : [], canConfigureAction, canMakeTappable, titled: withTitle && call.args[0]!.value.kind === 'stringLiteral', shows: canConfigureAction ? shownOnTap(ctx, node, call) : undefined, currentAction: node.name === 'Button' && call.trailingClosure ? raw(ctx, call.trailingClosure.body.span) : undefined, binding: argument ? { label, type, current: raw(ctx, argument.value.span), newName: newValueName(ctx, node, node.name, type) } : undefined, animation }
}

/** Each owner's alerts and confirmation dialogs, by the modifier that writes them: read from their layers once. */
const presentationCache = new WeakMap<FeatureContext, Map<string, CallExpr[]>>()
function presentationsOf(ctx: FeatureContext, owner: string): readonly CallExpr[] {
  let byOwner = presentationCache.get(ctx)
  if (!byOwner) {
    presentationCache.set(ctx, byOwner = new Map())
    for (const layer of ctx.nodes) {
      if (layer.kind !== 'branch' || layer.name !== 'Alert' && layer.name !== 'Confirmation dialog') continue
      const view = layerById(ctx, layer.parentId), expression = view && expressionOf(ctx, view)
      const modifier = expression && viewCallChain(expression)?.modifiers.find(m => m.span.end === layer.source.end)
      if (modifier) byOwner.set(layer.owner, [...byOwner.get(layer.owner) ?? [], modifier])
    }
  }
  return byOwner.get(owner) ?? []
}
/** The alert or dialog of a Button's screen its action presents, by setting the value it is presented by to true, and that value. */
function presentedOnTap(ctx: FeatureContext, node: AuthoringNode, call: CallExpr): { readonly modifier: CallExpr; readonly state: string } | undefined {
  const [only, more] = call.trailingClosure?.body.statements ?? []
  const state = !more && only?.kind === 'exprStmt' && only.expression.kind === 'assign' && only.expression.operator === '=' && only.expression.target.kind === 'identifier' && raw(ctx, only.expression.value.span) === 'true' ? only.expression.target.name : undefined
  const modifier = state && presentationsOf(ctx, node.owner).find(m => m.args.some(a => a.label === 'isPresented' && raw(ctx, a.value.span) === '$' + state))
  return modifier ? { modifier, state: state! } : undefined
}

type Shows = NonNullable<BehaviorSettings['shows']>
/** An alert or a dialog as When tapped reads it, with what writing it again keeps. */
interface ReadPresentation {
  readonly shows: Shows
  /** What each plain button that does something does, as written, by its title: kept when it is written again. */
  readonly kept: readonly { readonly title: string; readonly action: string }[]
  /** A dialog's `titleVisibility:`, as written. */
  readonly titleVisibility?: string
}
/**
 * An alert or a dialog a tap shows, read as When tapped's Show alert and Show options write
 * it (Wave 4a). Only a title of plain words, plain buttons with a role or none, and one Text
 * of plain words as its message can be written back exactly. Any other is still described,
 * its words as the code writes them, with `readOnly` saying why, so that nothing in it is
 * turned into words or lost.
 */
function readPresentation(ctx: FeatureContext, modifier: CallExpr): ReadPresentation {
  const type = modifier.callee.kind === 'memberAccess' && modifier.callee.member === 'alert' ? 'alert' : 'dialog'
  let readOnly: string | undefined
  const refuse = (reason: string) => { readOnly ??= `${reason} Change it in Code.` }
  const title = modifier.args[0]?.label === null ? modifier.args[0].value : undefined
  const closure = (label: string) => { const value = modifier.args.find(a => a.label === label)?.value; return value?.kind === 'closure' ? value : undefined }
  // Written with labels, `actions:` comes first, and a closure after the parentheses is its message.
  const actions = closure('actions') ?? modifier.trailingClosure ?? undefined
  const message = closure('message') ?? (closure('actions') ? modifier.trailingClosure ?? undefined : undefined)
  for (const arg of modifier.args) {
    if (arg.label === 'presenting') refuse(`This ${type} shows the value it presents.`)
    else if (!(arg.label === null && arg.value === title || arg.label === 'isPresented' || arg.label === 'actions' || arg.label === 'message' || arg.label === 'titleVisibility' && type === 'dialog')) refuse(`This ${type} has settings When tapped doesn’t know.`)
  }
  // SwiftUI's older `.alert(isPresented:) { Alert(…) }` has its title inside.
  if (!title) refuse(`This ${type} is written in a form When tapped doesn’t write.`)
  else if (literalText(title) === undefined) refuse(`This ${type}’s title is more than plain words.`)
  const described: AlertActionSpec[] = [], kept: { title: string; action: string }[] = []
  for (const statement of actions?.body.statements ?? []) {
    const chain = statement.kind === 'exprStmt' && statement.expression.kind === 'call' ? viewCallChain(statement.expression) : undefined
    const button = chain?.base.callee.kind === 'identifier' && chain.base.callee.name === 'Button' ? chain.base : undefined
    if (!button) { refuse(`This ${type} holds more than buttons.`); continue }
    const titled = button.args[0]?.label === null ? button.args[0].value : undefined, roleArgument = button.args.find(a => a.label === 'role')
    const words = literalText(titled), role = buttonRole(roleArgument && raw(ctx, roleArgument.value.span))
    const closed = button.trailingClosure && !button.trailingClosure.params.length ? button.trailingClosure : undefined
    if (words === undefined || !role || !closed || chain!.modifiers.length || button.args.some(a => a.value !== titled && a !== roleArgument)) refuse(`One of this ${type}’s buttons is more than a title and a role.`)
    else if (closed.body.statements.length) kept.push({ title: words, action: raw(ctx, closed.span) })
    const shown = words ?? raw(ctx, (titled ?? button.args.find(a => a.label === 'label')?.value ?? button).span)
    described.push(role === 'destructive' || role === 'cancel' ? { title: shown, role } : { title: shown })
  }
  const [text, more] = message?.body.statements ?? []
  const said = text?.kind === 'exprStmt' && text.expression.kind === 'call' ? viewCallChain(text.expression) : undefined
  const words = said?.base.callee.kind === 'identifier' && said.base.callee.name === 'Text' && !said.modifiers.length && said.base.args.length === 1 && said.base.args[0]!.label === null && !said.base.trailingClosure ? literalText(said.base.args[0]!.value) : undefined
  if (text && (more || words === undefined)) refuse(`This ${type}’s message is more than one plain text.`)
  const dot = modifier.callee.kind === 'memberAccess' ? modifier.callee.memberSpan.start : modifier.span.start
  if (hasComments(ctx, { file: modifier.span.file, start: dot, end: modifier.span.end })) refuse(`This ${type} has comments in it, which only Code keeps.`)
  const visibility = modifier.args.find(a => a.label === 'titleVisibility')
  return {
    shows: { type, title: literalText(title) ?? (title ? raw(ctx, title.span) : ''), message: text ? words ?? raw(ctx, text.span) : undefined, actions: described, readOnly },
    kept, titleVisibility: visibility && raw(ctx, visibility.value.span),
  }
}
/** What a tap on a Button shows (Wave 4a): an alert or a dialog of its screen presented by the value its action sets to true. */
function shownOnTap(ctx: FeatureContext, node: AuthoringNode, call: CallExpr): Shows | undefined {
  const modifier = presentedOnTap(ctx, node, call)?.modifier
  return modifier && readPresentation(ctx, modifier).shows
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
  const label = call.args.at(-1)
  return call.callee.kind === 'identifier' && call.callee.name === 'Button' && label?.label === 'label' && label.value.kind === 'closure' && call.args.every(a => a === label || a.label === 'role')
}
function namedState(ctx: FeatureContext, node: AuthoringNode, name: string): StateInput {
  const input = stateInputs(ctx, node).find(s => s.name === name)
  if (!input) throw new Error('Choose an existing local @State property with a supported type.')
  return input
}
export function configureBinding(ctx: FeatureContext, node: AuthoringNode, name: string, create?: { readonly value: DesignValue }): SourcePatch[] {
  const settings = behaviorSettings(ctx, node), owner = ownerOf(ctx, node), call = callOf(ctx, node)
  if (!settings?.binding || !owner || !call || !swiftIdentifier(name)) throw new Error('Select an input, toggle or picker and a valid state name.')
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
      if (!insideNavigationStack(ctx, node)) throw new Error('Place this Button inside a NavigationStack before configuring navigation.')
      if (call.args.some(a => a.label === 'role')) throw new Error('A link has no role. Set Role to None, then choose where it goes.')
      // A card stays the link's label, as `NavigationLink { Detail() } label: { … }` writes it (D16).
      const label = call.args[0]!, symbol = call.args.find(a => a.label === 'systemImage')
      if (label.label === 'label' && label.labelSpan) return [{ file: call.span.file, start: call.span.start, end: label.labelSpan.start, text: `NavigationLink { ${action.destination}() } ` }]
      // A link has no symbol of its own, so the button's is kept in its label.
      if (symbol) return [patch(call.span, `NavigationLink { ${action.destination}() } label: { Label(${raw(ctx, label.value.span)}, systemImage: ${raw(ctx, symbol.value.span)}) }`)]
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
  } else if (action.type === 'alert' || action.type === 'dialog') {
    if (deploymentVersion(ctx.deploymentTarget) < 15) throw new Error(action.type === 'alert' ? 'An alert shown on tap needs an iOS 15 deployment target.' : 'Options shown on tap need an iOS 15 deployment target.')
    // One the button shows already is rewritten where it is, with the value that shows it,
    // and the button's action, which sets that value already, stays as it is written.
    const shown = presentedOnTap(ctx, node, call)
    if (shown) {
      const read = readPresentation(ctx, shown.modifier)
      if (read.shows.readOnly) throw new Error(read.shows.readOnly)
      const file = shown.modifier.span.file, at = dotOf(shown.modifier, ctx.files.find(f => f.id === file)?.text ?? ''), { indent, unit } = lineIndent(ctx, file, at)
      return [{ file, start: at, end: shown.modifier.span.end, text: presentationSwift(action, shown.state, indent, unit, read) }]
    }
    const base = action.type === 'alert' ? 'isShowingAlert' : 'isShowingOptions'
    let name = base
    for (let suffix = 2; nameTaken(ctx, node, owner, name); suffix++) name = base + suffix
    patches.push(insertMember(ctx, owner, `@State private var ${name} = false`))
    const indent = modifierIndent(ctx, node)
    patches.push({ file: node.source.file, start: node.source.end, end: node.source.end, text: `\n${indent}${presentationSwift(action, name, indent, lineIndent(ctx, node.source.file, node.source.start).unit)}` })
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
  // A change of a value, a list or a call can animate (Wave 5a): Replace keeps the animation it had.
  const animates = ['toggle', 'set', 'append', 'delete', 'call'].includes(action.type) || action.type === 'dismiss' && !!action.state
  patches.push(patch(call.trailingClosure.span, actionClosure(ctx, call.trailingClosure, body, animates, action.animation)))
  return patches
}

/**
 * An alert or a confirmation dialog a tap shows, as Apple's examples write it: its buttons
 * one to a line, each with its role, then its message as a Text. With no buttons given it
 * has the OK iOS would show anyway, so the designer has a layer to change. Written again in
 * place of one `read` (Wave 4a), each button that did something does it still, matched by
 * its title, and a dialog keeps its `titleVisibility:`; an alert always shows its title, so
 * it has none. A button that did something and is no longer there is refused, never lost.
 */
function presentationSwift(action: Extract<BehaviorAction, { type: 'alert' | 'dialog' }>, name: string, indent: string, unit: string, read?: ReadPresentation): string {
  if (typeof action.title !== 'string' || !Array.isArray(action.actions) || action.message !== undefined && typeof action.message !== 'string' || action.actions.some(a => typeof a?.title !== 'string' || a.role !== undefined && a.role !== 'destructive' && a.role !== 'cancel')) throw new Error('Give the alert a title and buttons with a title and a role of None, Destructive or Cancel.')
  const inner = indent + unit, unused = [...read?.kept ?? []]
  const buttons = (action.actions.length ? action.actions : [{ title: 'OK' }]).map((button: AlertActionSpec) => {
    const kept = unused.findIndex(k => k.title === button.title)
    const does = kept < 0 ? '{ }' : unused.splice(kept, 1)[0]!.action
    return `${inner}Button(${swiftString(button.title)}${button.role ? `, role: .${button.role}` : ''}) ${does}\n`
  }).join('')
  const lost = unused[0]
  if (lost) throw new Error(`This ${read!.shows.type}’s ${lost.title} button does something when tapped. Keep a button called ${lost.title}, or change it in Code.`)
  const message = action.message === undefined ? '' : ` message: {\n${inner}Text(${swiftString(action.message)})\n${indent}}`
  const visibility = action.type === 'dialog' && read?.titleVisibility ? `, titleVisibility: ${read.titleVisibility}` : ''
  return `.${action.type === 'alert' ? 'alert' : 'confirmationDialog'}(${swiftString(action.title)}, isPresented: $${name}${visibility}) {\n${buttons}${indent}}${message}`
}
