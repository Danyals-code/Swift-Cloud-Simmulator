import { MODIFIER_SLOTS, NEW_SWITCH_NAME, PRESENTATION_PARTS, isHelperDefinition, isNonView, swiftIdentifier, type AuthoringNode, type AuthoringOperation, type SourceFile, type StateInput, type ViewVisibility, type VisibilityOption, type VisibilityWhen } from '@studio/shared'
import { unwrapIf, wrapInIf, type Expr, type IfStmt } from '@studio/swift-syntax'
import { applyPatches, declarationsNamed, ifStatementOf, insertStoredMember, layerById, lineIndent, namedStruct, raw, shadowsMember, type FeatureContext, type SourcePatch } from './authoring-context'
import { createScreenValue } from './authoring-screens'
import { isComponent } from './authoring-components'
import { branchDraws, conditionAsks, conditionText, designerName, screenValues } from './authoring-states'

/**
 * Shown when (Wave 5a): a view shown only while a value holds, read from the `if` it is the
 * only view of, and the choices a screen's values give it. A condition Design can't write
 * back, of more than one value or one the screen can't set, is read as the code writes it,
 * with why only Code changes it.
 */

/** One choice of a screen's Shown when, with the Swift it writes and its other side's words. */
interface Choice { readonly option: VisibilityOption; readonly swift: string; readonly words: string; readonly otherWords: string }
/** What every view of a screen chooses from, worked out once for each screen. */
interface ScreenChoices {
  readonly options: readonly VisibilityOption[]
  readonly choices: ReadonlyMap<string, Choice>
  readonly definition: AuthoringNode
  /** What every view of the screen that is always shown says: they are most of its views. */
  readonly always: ViewVisibility
}

/** A screen with no value to show a view by, as most are: one for all of them. */
const NO_CHOICES: Map<string, Choice> = new Map(), NO_OPTIONS: VisibilityOption[] = []
const choiceKey = (when: VisibilityWhen) => `${when.input}\u0000${String(when.is)}`
const screenCache = new WeakMap<FeatureContext, { readonly definitions: ReadonlyMap<string, AuthoringNode>; readonly screens: Map<string, ScreenChoices | null> }>()

/** A value's choices: a Bool on or off, each case, a list empty or not, an optional set or not. */
function choicesOf(input: StateInput, name: string): [VisibilityWhen['is'], string, string][] {
  const path = input.name
  if (input.kind === 'list') return [['empty', `${name} is empty`, `${path}.isEmpty`], ['items', `${name} has items`, `!${path}.isEmpty`]]
  if (input.kind === 'optional' || input.optional) return [['some', `${name} is set`, `${path} != nil`], ['none', `${name} isn’t set`, `${path} == nil`]]
  if (input.type === 'Bool') return [[true, `${name} is on`, path], [false, `${name} is off`, `!${path}`]]
  const cases = input.options ?? (input.kind === 'case' ? input.choices?.map(choice => choice.value) : undefined)
  return cases?.map(value => [value, `${name} is ${designerName(value)}`, `${path} == .${value}`]) ?? []
}
/**
 * Each value's name in a designer's words (Wave 5a), told apart where two share one: the
 * screen's `items` is Items, and its model's `store.items` Store items.
 */
function namesOf(values: readonly StateInput[]): Map<string, string> {
  const last = (path: string) => designerName(path.slice(path.lastIndexOf('.') + 1)), count = new Map<string, number>()
  for (const { name } of values) count.set(last(name), (count.get(last(name)) ?? 0) + 1)
  const whole = (path: string) => path.split('.').map((part, index) => { const words = designerName(part); return index && /^[A-Z][a-z]/.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words }).join(' ')
  return new Map(values.map(({ name }) => [name, count.get(last(name))! > 1 && name.includes('.') ? whole(name) : last(name)]))
}

/** The Shown when choices of the screen `owner`, from the values a state can set on it. */
function screenChoices(ctx: FeatureContext, owner: string): ScreenChoices | null {
  let cache = screenCache.get(ctx)
  if (!cache) {
    const definitions = new Map<string, AuthoringNode>()
    for (const node of ctx.nodes) if (node.kind === 'definition' && !node.helper && !definitions.has(node.name)) definitions.set(node.name, node)
    screenCache.set(ctx, cache = { definitions, screens: new Map() })
  }
  const known = cache.screens.get(owner)
  if (known !== undefined) return known
  const definition = cache.definitions.get(owner), decl = namedStruct(ctx, owner)
  let found: ScreenChoices | null = null
  if (definition && decl?.inherits.some(type => type.name === 'View' || type.name === 'SwiftUI.View')) {
    const values = screenValues(ctx, definition, decl), choices = values.length ? new Map<string, Choice>() : NO_CHOICES, options: VisibilityOption[] = values.length ? [] : NO_OPTIONS
    const names = values.length ? namesOf(values) : undefined
    for (const input of values) {
      const sides = choicesOf(input, names!.get(input.name)!)
      sides.forEach(([is, words, swift], index) => {
        const option = { when: { input: input.name, is }, label: `When ${words}` }
        const other = sides.length === 2 ? sides[1 - index]![1] : `${words.replace(/ is /, ' isn’t ')}`
        options.push(option)
        choices.set(choiceKey(option.when), { option, swift, words, otherWords: other })
      })
    }
    // The new switch's name, numbered past any name the screen or the project has.
    let newName = NEW_SWITCH_NAME
    for (let suffix = 2; decl.members.some(m => 'name' in m && m.name === newName) || declarationsNamed(ctx, newName).length; suffix++) newName = `${NEW_SWITCH_NAME}${suffix}`
    // In a Main, a new switch is a property each copy sets (Wave 5b).
    found = { options, choices, definition, always: isComponent(ctx, owner) ? { options, newName, property: true, editable: true } : { options, newName, editable: true } }
  }
  cache.screens.set(owner, found)
  return found
}

/** Why a view can't be shown by a condition of its own, wherever it is: undefined when it can. */
function siteProblem(parent: AuthoringNode | undefined): string | undefined {
  if (!parent) return 'Select a view on a screen.'
  if (parent.kind === 'definition' && !isHelperDefinition(parent) && parent.children.length === 1) return 'This is the screen’s only view, so it is always shown. Put it in a stack first, or choose a view inside it.'
  if (parent.kind === 'branch' && parent.name === MODIFIER_SLOTS.toolbar) return 'A toolbar’s items are shown by a condition in Code. Change it there.'
  if (parent.kind === 'branch' && parent.name === PRESENTATION_PARTS.message) return 'An alert’s message is a single text, always shown with it.'
  return undefined
}

/** Whether a layer is a branch of an `if` or a `switch`, which draws the views it holds only while it holds. */
const showsOne = (layer: AuthoringNode) => layer.kind === 'branch' && (layer.name === 'Condition' || layer.name === 'Otherwise' || layer.name.startsWith('Case '))
/** The view a branch shows that `node` is, or is inside (Wave 5a): undefined when no branch holds it. */
function heldBy(ctx: FeatureContext, node: AuthoringNode): AuthoringNode | undefined {
  for (let view = node, parent = layerById(ctx, node.parentId); parent && parent.kind !== 'definition'; view = parent, parent = layerById(ctx, parent.parentId)) if (showsOne(parent)) return view
  return undefined
}
/** The `if` a Condition is the else of, for an `else if` (Wave 5a). */
function elseOf(ctx: FeatureContext, condition: AuthoringNode): AuthoringNode | undefined {
  const otherwise = layerById(ctx, condition.parentId), above = otherwise?.kind === 'branch' && otherwise.name === 'Otherwise' ? layerById(ctx, otherwise.parentId) : undefined
  return above?.kind === 'branch' && above.name === 'Condition' ? above : undefined
}

/** The other side of an `if`'s condition, as Swift says it: `!showDetails`, `show`, `!(count > 3)`, `user == nil`. */
function otherSide(ctx: FeatureContext, stmt: IfStmt): string {
  const [only, more] = stmt.conditions
  if (only?.kind === 'optionalBinding' && !more) return `${raw(ctx, only.value.span)} == nil`
  if (only?.kind !== 'expr' || more) return `!(${conditionText(ctx, stmt)})`
  if (only.expr.kind === 'unary' && only.expr.operator === '!') return raw(ctx, only.expr.operand.span)
  const text = raw(ctx, only.expr.span)
  return /^[\w.]+$/.test(text) ? `!${text}` : `!(${text})`
}
/** A condition's part that reads plainly beside another with `&&`: a name, `!name`, or one comparison of them. */
const PLAIN_PART = /^!?[\w.]+(?:\s*[!=]=\s*\.?[\w.]+)?$/
/**
 * When one side of a Condition is drawn, as Swift says it (Wave 5a): its condition, or the
 * other side of it, after the other side of each `if` it is the else of, `!a && b`; and how
 * many conditions above it must be false.
 */
function drawnWhen(ctx: FeatureContext, condition: AuthoringNode, truth: boolean): { readonly text: string; readonly above: number } {
  const parts: string[] = []
  for (let at: AuthoringNode | undefined = condition, side = truth; at; at = elseOf(ctx, at), side = false) {
    const stmt = ifStatementOf(ctx, at)
    if (stmt) parts.unshift(side ? conditionText(ctx, stmt) : otherSide(ctx, stmt))
  }
  return { text: parts.length === 1 ? parts[0]! : parts.map(part => PLAIN_PART.test(part) ? part : `(${part})`).join(' && '), above: parts.length - (truth ? 1 : 0) }
}

const MORE_THAN_ONE = 'This condition reads more than one value, so only Code changes it.'
/** Why Shown when can't offer a condition the preview can set as one of its choices. */
function unofferedProblem(expr: Expr): string {
  let at = expr, negated = false
  for (; at.kind === 'unary' && at.operator === '!'; at = at.operand) negated = !negated
  if (at.kind === 'binary' && (at.operator === '&&' || at.operator === '||')) return MORE_THAN_ONE
  const cased = at.kind === 'binary' && (at.operator === '==' || at.operator === '!=') && [at.left, at.right].some(side => side.kind === 'memberAccess' && !side.base)
  if (cased && (at.kind === 'binary' && at.operator === '!=') !== negated) return 'This view shows for every case but one, and Shown when offers each case on its own. Change it in Code.'
  return 'Shown when can’t set what this condition reads. Change it in Code.'
}
/** Whether a condition asks more than one thing, as `a && b` and `!(a || b)` do. */
function compound(expr: Expr): boolean {
  let at = expr
  while (at.kind === 'unary' && at.operator === '!') at = at.operand
  return at.kind === 'binary' && (at.operator === '&&' || at.operator === '||')
}

/**
 * When `node` is shown: always, while the `if` it is the only view of holds, or as the view
 * around it a branch shows is. Undefined for what is no view of its own: a view written as an
 * argument, part of joined text, a toolbar's item, or a view of the app or of a preview.
 */
export function visibilitySettings(ctx: FeatureContext, node: AuthoringNode): ViewVisibility | undefined {
  if (node.argument || node.textRun || isNonView(node) || node.kind !== 'view' && node.kind !== 'component' && node.kind !== 'collection') return undefined
  const screen = screenChoices(ctx, node.owner)
  if (!screen) return undefined
  const parent = layerById(ctx, node.parentId), problem = siteProblem(parent)
  if (problem || !parent) return readOnly(screen, problem)
  if (showsOne(parent)) return parent.name === 'Condition' ? conditionBranch(ctx, screen, parent) : otherBranch(ctx, screen, parent)
  // A view inside one a branch shows is shown with it, and that view's condition is set on it (Wave 5a).
  const holder = heldBy(ctx, parent), around = holder && heldVisibility(ctx, holder)
  if (around?.condition === undefined) return screen.always
  const { condition, label, hiddenWhile, shows } = around
  return readOnly(screen, `This view is in the ${holder!.name} shown when ${condition}. ${around.editable ? 'Set it there.' : 'Change it in Code.'}`, { condition, ...label ? { label } : {}, ...hiddenWhile ? { hiddenWhile } : {}, ...shows ? { shows } : {} })
}

const heldCache = new WeakMap<FeatureContext, Map<string, ViewVisibility | undefined>>()
/** What a view a branch shows says, worked out once for all the views inside it (Wave 5a). */
function heldVisibility(ctx: FeatureContext, holder: AuthoringNode): ViewVisibility | undefined {
  let known = heldCache.get(ctx)
  if (!known) heldCache.set(ctx, known = new Map())
  if (!known.has(holder.id)) known.set(holder.id, visibilitySettings(ctx, holder))
  return known.get(holder.id)
}

/** What a view Shown when can't set says: its screen's choices, the condition it is shown by when there is one, and why (Wave 5b). */
const readOnly = (screen: ScreenChoices, problem: string | undefined, read?: Partial<ViewVisibility>): ViewVisibility => ({ ...screen.always, ...read, editable: false, problem })

/** A view in an `if`: editable when it is the `if`'s only view and its one value is one of the screen's choices. */
function conditionBranch(ctx: FeatureContext, screen: ScreenChoices, branch: AuthoringNode): ViewVisibility {
  const stmt = ifStatementOf(ctx, branch)
  if (!stmt) return readOnly(screen, 'This condition is written in a form Shown when can’t read. Change it in Code.')
  const drawn = drawnWhen(ctx, branch, true), shows = branchDraws(ctx, screen.definition, branch, true)
  const read = readOnly(screen, undefined, { condition: drawn.text, ...shows ? { shows } : {} })
  if (drawn.above) return { ...read, problem: `This view is in an else if, shown only while ${drawn.above === 1 ? 'the condition above it is' : 'the conditions above it are'} false. Change it in Code.` }
  const others = stmt.then.statements.length - 1
  if (others > 0) return { ...read, problem: `This view shares its condition with ${others === 1 ? 'another view' : `${others} others`}. Change it in Code.` }
  if (stmt.else) return { ...read, problem: 'This if has an else as well, which shows another view. Change its condition in Code.' }
  const [only, more] = stmt.conditions
  if (!only || more || only.kind === 'expr' && compound(only.expr)) return { ...read, problem: MORE_THAN_ONE }
  if (only.kind === 'optionalBinding' || only.kind === 'caseMatch' && (only.pattern.kind !== 'enumCase' || only.pattern.bindings.length)) return { ...read, problem: 'This view uses the value it is shown by. Change its condition in Code.' }
  const asks = conditionAsks(ctx, screen.definition, branch)
  if (asks && 'problem' in asks) return { ...read, problem: `${asks.problem} Change it in Code.` }
  const choice = asks?.when && screen.choices.get(choiceKey(asks.when))
  if (!choice) return { ...read, problem: only.kind === 'expr' ? unofferedProblem(only.expr) : 'Shown when can’t set what this condition reads. Change it in Code.' }
  return { ...read, when: choice.option.when, editable: true, label: choice.words, hiddenWhile: choice.otherWords }
}

/** A view in an `if`'s else or in a case of a switch: shown by code, read as it is written. */
function otherBranch(ctx: FeatureContext, screen: ScreenChoices, branch: AuthoringNode): ViewVisibility {
  const owner = layerById(ctx, branch.parentId)
  if (owner?.name === 'Switch') {
    const subject = owner.properties.find(property => property.name === 'condition')?.expression ?? ''
    return readOnly(screen, 'This view is one case of a switch. Change it in Code.', { condition: `${subject} ${branch.name.startsWith('Case ') ? branch.name.replace(/^Case /, 'is ') : 'is none of the cases above'}` })
  }
  const drawn = owner && drawnWhen(ctx, owner, false), shows = owner && branchDraws(ctx, screen.definition, owner, false)
  return readOnly(screen, `This view is shown when ${drawn && drawn.above > 1 ? 'the conditions above it are' : 'the condition above it is'} false. Change it in Code.`, { condition: drawn?.text ?? '', ...shows ? { shows } : {} })
}

/** The Swift of a Shown when choice on `node`'s screen, or undefined when its screen offers none such. */
export function visibilitySwift(ctx: FeatureContext, node: AuthoringNode, when: VisibilityWhen): string | undefined {
  return screenChoices(ctx, node.owner)?.choices.get(choiceKey(when))?.swift
}

/**
 * Shown when, written (Wave 5a): the view wrapped in `if`, the condition of the `if` it is the
 * only view of rewritten, or with `when` null the `if` taken away. `create` declares a new
 * on/off switch first, which `when` shows the view by. A helper's view wrapped in `if` makes
 * the helper a `@ViewBuilder`, which Xcode needs to build it.
 */
export function visibilityEdit(ctx: FeatureContext, node: AuthoringNode, operation: Extract<AuthoringOperation, { kind: 'visibility' }>): { files: SourceFile[]; offset: number } {
  const settings = visibilitySettings(ctx, node)
  if (!settings) throw new Error('Select a view on a screen. A view written inside another’s settings, or a toolbar’s item, is shown with it.')
  if (!settings.editable) throw new Error(settings.problem ?? 'Shown when can’t be set here. Change it in Code.')
  const { when, create } = operation
  const patches: SourcePatch[] = []
  let condition: string | undefined
  if (create) {
    if (!when || when.input !== create.name || typeof when.is !== 'boolean' || typeof create.value !== 'boolean') throw new Error('Give the new switch a name and whether it starts on or off, and show the view while it is on or off.')
    // In a Main, a property each copy sets, which the copies there leave on as they were (Wave 5b).
    if (settings.property) {
      const owner = namedStruct(ctx, node.owner)!
      if (!swiftIdentifier(create.name) || owner.members.some(m => 'name' in m && m.name === create.name) || shadowsMember(ctx, node, create.name)) throw new Error(`${node.owner} already has something called “${create.name}”.`)
      patches.push(insertStoredMember(ctx, owner, `var ${create.name}: Bool = ${create.value}`))
    } else patches.push(...createScreenValue(ctx, node, create.name, create.value, true))
    condition = when.is ? create.name : `!${create.name}`
  } else if (when) {
    condition = visibilitySwift(ctx, node, when)
    if (!condition) throw new Error('Choose a value this screen has.')
  }
  const file = ctx.files.find(f => f.id === node.source.file)!
  let refusal = 'Shown when can’t be set here. Change it in Code.'
  const refuse = (reason: string) => { refusal = reason }
  let edit: { text: string; offset: number } | null
  if (settings.condition === undefined) {
    if (!condition) return { files: [...ctx.files], offset: node.source.start }
    edit = wrapInIf(file.text, file.id, node.source.start, condition, refuse)
    const helper = layerById(ctx, node.parentId)
    if (edit && helper && isHelperDefinition(helper)) patches.push(...viewBuilder(ctx, helper))
  } else if (condition) {
    // The whole condition between `if` and its brace, so `if (a)` and `if case .a = b` are written plainly too.
    const stmt = ifStatementOf(ctx, layerById(ctx, node.parentId)!)!, head = file.text.slice(stmt.span.start, stmt.then.span.start)
    const start = stmt.span.start + /^if\s*/.exec(head)![0].length, end = stmt.span.start + head.trimEnd().length
    if (/\/\/|\/\*/.test(file.text.slice(start, end))) throw new Error('A note in this condition keeps it as it is. Change it in Code.')
    edit = { text: file.text.slice(0, start) + condition + file.text.slice(end), offset: node.source.start + condition.length - (end - start) }
  } else edit = unwrapIf(file.text, file.id, node.source.start, refuse)
  if (!edit) throw new Error(refusal)
  // The `if` as a patch of what changed, beside a new value or `@ViewBuilder`; what of those goes before the view moves it along.
  const after = edit.text, before = file.text
  let start = 0, end = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  const moved = patches.filter(p => p.file === file.id && p.start <= node.source.start).reduce((n, p) => n + p.text.length, 0)
  return { files: applyPatches(ctx, [...patches, { file: file.id, start, end: before.length - end, text: after.slice(start, after.length - end) }]), offset: edit.offset + moved }
}

/** `@ViewBuilder` on a helper that has none, so an `if` in it builds. */
function viewBuilder(ctx: FeatureContext, helper: AuthoringNode): SourcePatch[] {
  const decl = declarationsNamed(ctx, helper.name).find(d => d.span.file === helper.source.file && d.span.start === helper.source.start)
  if (!decl || !('attributes' in decl) || decl.attributes.some(a => a.name === 'ViewBuilder')) return []
  // On a line of its own above the declaration and its modifiers, `private var header`.
  const text = ctx.files.find(f => f.id === helper.source.file)?.text ?? '', { indent } = lineIndent(ctx, helper.source.file, decl.span.start)
  const at = text.lastIndexOf('\n', decl.span.start - 1) + 1 + indent.length
  return [{ file: helper.source.file, start: at, end: at, text: `@ViewBuilder${text.includes('\r\n') ? '\r\n' : '\n'}${indent}` }]
}
